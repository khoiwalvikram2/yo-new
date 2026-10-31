/**
 * Atomic credit balance writes (plan W7, lost updates).
 *
 * Every function here is ONE UPDATE whose new values are computed by Postgres from the row
 * being updated. The UPDATE takes the row lock itself, and under READ COMMITTED a waiting
 * UPDATE re-reads the newest row version before applying (and re-checks its WHERE), so two
 * concurrent writers can no longer both start from the same stale read and erase each
 * other. Guards live in the WHERE clause: when one fails nothing is written and the
 * function throws.
 *
 * The availability formula is the one in creditMath.ts:
 *   credit_available = max(0, credit_limit - credit_used + settlement_balance)
 *
 * Note: the agents table has no updated_at column (whitelabels and agent_player_credits do).
 */
import { sql, type SQL } from 'drizzle-orm';

function firstRow(result: any): any | null {
	return result?.rows?.[0] ?? result?.[0] ?? null;
}

function num(v: unknown): number {
	const n = Number(v ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

export type CreditRowSnapshot = {
	creditLimit: number;
	creditUsed: number;
	creditAvailable: number;
	settlementBalance: number;
};

export type AgentCreditRow = CreditRowSnapshot & {
	creditAlertThreshold: number;
	tenantId: string;
	parentAgentId: string | null;
	schemeType: string | null;
};

function toSnapshot(row: any): CreditRowSnapshot {
	return {
		creditLimit: num(row.credit_limit),
		creditUsed: num(row.credit_used),
		creditAvailable: num(row.credit_available),
		settlementBalance: num(row.settlement_balance),
	};
}

/** Lock an agent's row (FOR UPDATE) and return its credit fields; null when missing. */
export async function lockAgentCreditRow(tx: any, agentId: string): Promise<AgentCreditRow | null> {
	const result = await tx.execute(sql`
		SELECT tenant_id, parent_agent_id::text AS parent_agent_id, scheme_type,
			credit_limit, credit_used, credit_available, settlement_balance, credit_alert_threshold
		FROM agents
		WHERE id = ${agentId}
		FOR UPDATE
	`);
	const row = firstRow(result);
	if (!row) return null;
	return {
		...toSnapshot(row),
		creditAlertThreshold: row.credit_alert_threshold == null ? 80 : num(row.credit_alert_threshold),
		tenantId: String(row.tenant_id ?? 'default'),
		parentAgentId: row.parent_agent_id ?? null,
		schemeType: row.scheme_type ?? null,
	};
}

export type PlayerCreditRow = CreditRowSnapshot & {
	agentId: string | null;
	playerType: string | null;
	settlementBalanceSports: number;
	settlementBalanceCasino: number;
	settlementBalanceMatka: number;
};

/**
 * Lock a player's users row (FOR UPDATE) and return its credit fields; null when missing.
 * Take this lock before the agent's: bet placement and settlement lock player -> agent ->
 * agent_player_credits, and every credit operation follows the same order.
 */
export async function lockPlayerCreditRow(tx: any, userId: number, tenant: string): Promise<PlayerCreditRow | null> {
	const result = await tx.execute(sql`
		SELECT agent_id::text AS agent_id, player_type,
			credit_limit, credit_used, credit_available, settlement_balance,
			settlement_balance_sports, settlement_balance_casino, settlement_balance_matka
		FROM users
		WHERE id = ${userId} AND tenant = ${tenant}
		FOR UPDATE
	`);
	const row = firstRow(result);
	if (!row) return null;
	return {
		...toSnapshot(row),
		agentId: row.agent_id ?? null,
		playerType: row.player_type ?? null,
		settlementBalanceSports: num(row.settlement_balance_sports),
		settlementBalanceCasino: num(row.settlement_balance_casino),
		settlementBalanceMatka: num(row.settlement_balance_matka),
	};
}

export type LimitDeltaGuards = {
	/** Before the change: limit - used + settlement must be at least this much. */
	requireAvailable?: number;
	/** After the change the limit must still cover credit_used (what was handed down / is exposed). */
	keepLimitCoveringUsed?: boolean;
};

function limitDeltaConditions(delta: number, guards?: LimitDeltaGuards): SQL[] {
	const conds: SQL[] = [sql`COALESCE(credit_limit, 0) + ${delta} >= 0`];
	if (guards?.requireAvailable !== undefined) {
		conds.push(
			sql`COALESCE(credit_limit, 0) - COALESCE(credit_used, 0) + COALESCE(settlement_balance, 0) >= ${guards.requireAvailable}`
		);
	}
	if (guards?.keepLimitCoveringUsed) {
		conds.push(sql`COALESCE(credit_limit, 0) + ${delta} >= COALESCE(credit_used, 0)`);
	}
	return conds;
}

function explainLimitGuardFailure(
	who: string,
	row: any,
	delta: number,
	guards?: LimitDeltaGuards
): Error {
	const limit = num(row.credit_limit);
	const used = num(row.credit_used);
	const available = round2(limit - used + num(row.settlement_balance));
	if (limit + delta < 0) {
		return new Error(`${who} credit limit cannot go below zero. Limit: ${limit}, Change: ${delta}`);
	}
	if (guards?.requireAvailable !== undefined && available < guards.requireAvailable) {
		return new Error(`${who} does not have enough available credit. Available: ${available}, Requested: ${guards.requireAvailable}`);
	}
	if (guards?.keepLimitCoveringUsed && limit + delta < used) {
		return new Error(`${who} credit limit cannot be set below its used credit. Used: ${used}, New limit: ${round2(limit + delta)}`);
	}
	return new Error(`${who} credit update was refused`);
}

/**
 * agents.credit_limit += delta (one UPDATE). credit_available follows; credit_used and the
 * settlement balances are untouched. Throws when the agent is missing or a guard fails.
 */
export async function applyAgentCreditLimitDelta(
	tx: any,
	agentId: string,
	delta: number,
	guards?: LimitDeltaGuards
): Promise<CreditRowSnapshot> {
	const d = round2(Number(delta));
	if (!Number.isFinite(d)) throw new Error(`Invalid credit limit change: ${delta}`);
	const where = sql.join([sql`id = ${agentId}`, ...limitDeltaConditions(d, guards)], sql` AND `);
	const result = await tx.execute(sql`
		UPDATE agents
		SET credit_limit = COALESCE(credit_limit, 0) + ${d},
			credit_available = GREATEST(0, COALESCE(credit_limit, 0) + ${d} - COALESCE(credit_used, 0) + COALESCE(settlement_balance, 0))
		WHERE ${where}
		RETURNING credit_limit, credit_used, credit_available, settlement_balance
	`);
	const row = firstRow(result);
	if (row) return toSnapshot(row);
	const current = firstRow(
		await tx.execute(sql`SELECT credit_limit, credit_used, settlement_balance FROM agents WHERE id = ${agentId}`)
	);
	if (!current) throw new Error('Agent not found');
	throw explainLimitGuardFailure('Agent', current, d, guards);
}

/**
 * users.credit_limit += delta for one player (one UPDATE). credit_available follows;
 * credit_used and the settlement balances are untouched. Throws when the player is
 * missing or a guard fails.
 */
export async function applyPlayerCreditLimitDelta(
	tx: any,
	userId: number,
	tenant: string,
	delta: number,
	guards?: LimitDeltaGuards
): Promise<CreditRowSnapshot> {
	const d = round2(Number(delta));
	if (!Number.isFinite(d)) throw new Error(`Invalid credit limit change: ${delta}`);
	const where = sql.join(
		[sql`id = ${userId}`, sql`tenant = ${tenant}`, ...limitDeltaConditions(d, guards)],
		sql` AND `
	);
	const result = await tx.execute(sql`
		UPDATE users
		SET credit_limit = COALESCE(credit_limit, 0) + ${d},
			credit_available = GREATEST(0, COALESCE(credit_limit, 0) + ${d} - COALESCE(credit_used, 0) + COALESCE(settlement_balance, 0))
		WHERE ${where}
		RETURNING credit_limit, credit_used, credit_available, settlement_balance
	`);
	const row = firstRow(result);
	if (row) return toSnapshot(row);
	const current = firstRow(
		await tx.execute(sql`SELECT credit_limit, credit_used, settlement_balance FROM users WHERE id = ${userId} AND tenant = ${tenant}`)
	);
	if (!current) throw new Error('Player not found');
	throw explainLimitGuardFailure('Player', current, d, guards);
}

export type SettlementDomainDeltas = { sports?: number; casino?: number; matka?: number };

/**
 * Settlement balance deltas on an agents or whitelabels row (one UPDATE). The per-domain
 * columns move by their delta, settlement_balance stays the sum of the three, and
 * credit_available is recomputed. credit_used is never touched: realised P&L is settlement,
 * not usage.
 */
export async function applySettlementDeltas(
	tx: any,
	table: 'agents' | 'whitelabels',
	id: string,
	deltas: SettlementDomainDeltas
): Promise<CreditRowSnapshot | null> {
	// `|| 0` turns -0 (the negation of a zero balance) into 0.
	const ds = round2(Number(deltas.sports ?? 0)) || 0;
	const dc = round2(Number(deltas.casino ?? 0)) || 0;
	const dm = round2(Number(deltas.matka ?? 0)) || 0;
	if (![ds, dc, dm].every(Number.isFinite)) throw new Error('Invalid settlement balance change');
	const total = round2(ds + dc + dm);
	if (ds === 0 && dc === 0 && dm === 0) return null;
	const tableSql = table === 'agents' ? sql.raw('agents') : sql.raw('whitelabels');
	const touch = table === 'whitelabels' ? sql`, updated_at = now()` : sql``;
	const result = await tx.execute(sql`
		UPDATE ${tableSql}
		SET settlement_balance_sports = COALESCE(settlement_balance_sports, 0) + ${ds},
			settlement_balance_casino = COALESCE(settlement_balance_casino, 0) + ${dc},
			settlement_balance_matka = COALESCE(settlement_balance_matka, 0) + ${dm},
			settlement_balance = COALESCE(settlement_balance_sports, 0) + COALESCE(settlement_balance_casino, 0) + COALESCE(settlement_balance_matka, 0) + ${total},
			credit_available = GREATEST(0, COALESCE(credit_limit, 0) - COALESCE(credit_used, 0)
				+ COALESCE(settlement_balance_sports, 0) + COALESCE(settlement_balance_casino, 0) + COALESCE(settlement_balance_matka, 0) + ${total})${touch}
		WHERE id = ${id}
		RETURNING credit_limit, credit_used, credit_available, settlement_balance
	`);
	const row = firstRow(result);
	return row ? toSnapshot(row) : null;
}

/** settlement deltas for one domain, as applySettlementDeltas expects. */
export function domainDelta(domain: 'sports' | 'casino' | 'matka', delta: number): SettlementDomainDeltas {
	return { [domain]: delta } as SettlementDomainDeltas;
}
