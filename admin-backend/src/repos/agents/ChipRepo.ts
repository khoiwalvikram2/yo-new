/**
 * SQL for the CREDIT scheme on Deposit/Withdraw chips.
 * Spec: docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md (§2 figures, §4 operations).
 * The rules live in domains/agents/services/ChipService.ts; this file only reads and writes rows.
 *
 * Where each account's chips live:
 *   - CREDIT agent: agents.chip_balance; credit reference agents.credit_limit.
 *   - credit player (AGENT_CREDIT / WHITELABEL_CREDIT): wallets.cash of its wallet row for the tenant, with
 *     wallets.exposure as its open sports liability; credit reference users.credit_limit.
 *   - the whitelabel pool: whitelabels.credit_available. Only WhitelabelCreditService moves it; this file locks
 *     and reads it.
 *
 * `wallets` has no unique (user_id, tenant) index, so a player's wallet is always its lowest-id row for the
 * tenant, here and in every batch read.
 *
 * Locking reads take SELECT ... FOR UPDATE and must run inside the caller's transaction. Each balance write is a
 * single UPDATE with its guard in the WHERE clause, so a balance can never go below zero even if a caller skipped
 * the lock. Batch readers take a list of ids and run one query per figure kind, so list screens stay at a fixed
 * number of queries.
 */
import { sql, type SQL } from 'drizzle-orm';
import { currencyService } from '@src/services/currencyService.js';
import type { CurrencyCode } from '@src/types/currency.js';

/** A database handle or a transaction: anything that runs raw SQL. Both `db` and a drizzle `tx` fit. */
export interface ChipExecutor {
	execute(query: SQL): PromiseLike<{ rows: unknown[] }>;
}

export type ChipLedgerAccountType = 'agent' | 'player' | 'whitelabel';
export type ChipLedgerKind = 'OPENING' | 'DEPOSIT' | 'WITHDRAW' | 'CREDIT_REFERENCE';
export type ChipMemberType = 'AGENT' | 'PLAYER';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INT4 = 2147483647;
/** Postgres regexes that guard the casts in the statement joins, so a malformed id finds no name instead of failing. */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const DIGITS_PATTERN = '^[0-9]{1,18}$';

/** agents.id is a uuid column: anything else would make Postgres raise a cast error instead of "not found". */
export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** users.id is int4. Returns null for anything that is not a positive int4, so callers can answer "not found". */
export function parsePlayerId(value: unknown): number | null {
	const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
	if (!/^\d{1,10}$/.test(text)) return null;
	const id = Number(text);
	return id >= 1 && id <= MAX_INT4 ? id : null;
}

function num(value: unknown): number {
	if (value == null) return 0;
	const n = Number(value);
	if (!Number.isFinite(n)) throw new Error(`Chip figure is not a number: ${String(value)}`);
	return n;
}

function text(value: unknown): string | null {
	return value == null ? null : String(value);
}

async function rows<T>(executor: ChipExecutor, query: SQL): Promise<T[]> {
	const result = await executor.execute(query);
	return (result?.rows ?? []) as T[];
}

/** A 2-decimal numeric parameter. Values reaching here are already rounded by the service. */
function money(n: number): SQL {
	return sql`${n.toFixed(2)}::numeric`;
}

function moneyOrNull(n: number | null): SQL {
	return n == null ? sql`NULL::numeric` : money(n);
}

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

const CREDIT_PLAYER_TYPES = sql`('AGENT_CREDIT', 'WHITELABEL_CREDIT')`;

export interface ChipAgentRow {
	id: string;
	tenantId: string;
	schemeType: string;
	status: string;
	parentAgentId: string | null;
	chipBalance: number;
	creditLimit: number;
	username: string | null;
}

export interface ChipPlayerRow {
	id: number;
	tenant: string;
	username: string | null;
	name: string | null;
	email: string | null;
	status: string;
	playerType: string;
	agentId: string | null;
	creditLimit: number;
}

export interface ChipWalletRow {
	id: number;
	cash: number;
	exposure: number;
	currency: string;
}

export interface ChipPoolRow {
	id: string;
	name: string | null;
	creditLimit: number;
	creditUsed: number;
	creditAvailable: number;
}

/** One credit_chip_ledger row. amount is signed from the account's side: + chips in, - chips out. */
export interface ChipLedgerInsert {
	tenantId: string;
	transferId: string;
	accountType: ChipLedgerAccountType;
	accountId: string;
	counterpartyType: ChipLedgerAccountType | null;
	counterpartyId: string | null;
	kind: ChipLedgerKind;
	amount: number;
	balanceBefore: number;
	balanceAfter: number;
	creditReferenceBefore: number | null;
	creditReferenceAfter: number | null;
	remark: string | null;
	createdBy: string | null;
	createdByType: string | null;
}

/** The player's own wallet statement for a chip deposit or withdrawal (ledger_entries + wallet_ledger). */
export interface PlayerChipStatementInsert {
	tenant: string;
	walletId: number;
	userId: number;
	direction: 'DEPOSIT' | 'WITHDRAW';
	/** Positive. */
	amount: number;
	cashBefore: number;
	cashAfter: number;
	exposure: number;
	currency: string;
	transferId: string;
	counterpartyType: ChipLedgerAccountType;
	counterpartyId: string;
	counterpartyName: string;
	remark: string | null;
}

export interface ChipAgentBase {
	id: string;
	status: string;
	parentAgentId: string | null;
	chipBalance: number;
	creditLimit: number;
	username: string | null;
}

export interface ChipPlayerBase {
	id: number;
	username: string | null;
	name: string | null;
	status: string;
	playerType: string;
	agentId: string | null;
	creditLimit: number;
	cash: number;
	exposure: number;
}

export interface ChipDownlineMember {
	accountType: ChipMemberType;
	id: string;
}

export interface ChipStatementDbRow {
	id: string;
	createdAt: string;
	kind: ChipLedgerKind;
	amount: number;
	balanceBefore: number;
	balanceAfter: number;
	creditReferenceBefore: number | null;
	creditReferenceAfter: number | null;
	counterpartyType: ChipLedgerAccountType | null;
	counterpartyId: string | null;
	counterpartyName: string | null;
	remark: string | null;
	createdBy: string | null;
	createdByType: string | null;
	createdByName: string | null;
}

type RawAgentRow = {
	id: string;
	tenant_id: string;
	scheme_type: string;
	status: string;
	parent_agent_id: string | null;
	chip_balance: string;
	credit_limit: string;
	username: string | null;
};

type RawPlayerRow = {
	id: number;
	tenant: string;
	username: string | null;
	name: string | null;
	email: string | null;
	status: string;
	player_type: string;
	agent_id: string | null;
	credit_limit: string;
};

type RawWalletRow = { id: number; cash: string; exposure: string; currency: string | null };
type RawPoolRow = { id: string; name: string | null; credit_limit: string; credit_used: string; credit_available: string };

function toAgentRow(r: RawAgentRow): ChipAgentRow {
	return {
		id: String(r.id),
		tenantId: String(r.tenant_id ?? '').trim(),
		schemeType: String(r.scheme_type),
		status: String(r.status),
		parentAgentId: text(r.parent_agent_id),
		chipBalance: num(r.chip_balance),
		creditLimit: num(r.credit_limit),
		username: text(r.username),
	};
}

function toPlayerRow(r: RawPlayerRow): ChipPlayerRow {
	return {
		id: Number(r.id),
		tenant: String(r.tenant),
		username: text(r.username),
		name: text(r.name),
		email: text(r.email),
		status: String(r.status),
		playerType: String(r.player_type),
		agentId: text(r.agent_id),
		creditLimit: num(r.credit_limit),
	};
}

function toWalletRow(r: RawWalletRow): ChipWalletRow {
	return { id: Number(r.id), cash: num(r.cash), exposure: num(r.exposure), currency: r.currency || 'INR' };
}

function toPoolRow(r: RawPoolRow): ChipPoolRow {
	return {
		id: String(r.id),
		name: text(r.name),
		creditLimit: num(r.credit_limit),
		creditUsed: num(r.credit_used),
		creditAvailable: num(r.credit_available),
	};
}

const AGENT_COLUMNS = sql`a.id::text AS id, a.tenant_id, a.scheme_type::text AS scheme_type, a.status,
	a.parent_agent_id::text AS parent_agent_id, a.chip_balance, COALESCE(a.credit_limit, 0) AS credit_limit, c.username`;

const PLAYER_COLUMNS = sql`u.id, u.tenant, u.username, u.name, u.email, u.status::text AS status,
	u.player_type::text AS player_type, u.agent_id::text AS agent_id, COALESCE(u.credit_limit, 0) AS credit_limit`;

export class ChipRepo {
	// ---- Locks: call inside a transaction, parent before child, a player's users row before its wallet. ----

	/** Lock an agent row (FOR UPDATE). Null when the id is not a uuid or no such agent exists. */
	async lockAgent(tx: ChipExecutor, agentId: string): Promise<ChipAgentRow | null> {
		if (!isUuid(agentId)) return null;
		const [row] = await rows<RawAgentRow>(tx, sql`
			SELECT ${AGENT_COLUMNS}
			FROM agents a
			LEFT JOIN agent_credentials c ON c.agent_id = a.id
			WHERE a.id = ${agentId.trim()}::uuid
			FOR UPDATE OF a`);
		return row ? toAgentRow(row) : null;
	}

	/** Read an agent row without a lock. */
	async readAgent(executor: ChipExecutor, agentId: string): Promise<ChipAgentRow | null> {
		if (!isUuid(agentId)) return null;
		const [row] = await rows<RawAgentRow>(executor, sql`
			SELECT ${AGENT_COLUMNS}
			FROM agents a
			LEFT JOIN agent_credentials c ON c.agent_id = a.id
			WHERE a.id = ${agentId.trim()}::uuid`);
		return row ? toAgentRow(row) : null;
	}

	/** Lock a player's users row (FOR UPDATE) in its tenant. */
	async lockPlayer(tx: ChipExecutor, playerId: number, tenant: string): Promise<ChipPlayerRow | null> {
		const [row] = await rows<RawPlayerRow>(tx, sql`
			SELECT ${PLAYER_COLUMNS}
			FROM users u
			WHERE u.id = ${playerId} AND u.tenant = ${tenant}
			FOR UPDATE`);
		return row ? toPlayerRow(row) : null;
	}

	/** Read a player's users row without a lock. */
	async readPlayer(executor: ChipExecutor, playerId: number, tenant: string): Promise<ChipPlayerRow | null> {
		const [row] = await rows<RawPlayerRow>(executor, sql`
			SELECT ${PLAYER_COLUMNS}
			FROM users u
			WHERE u.id = ${playerId} AND u.tenant = ${tenant}`);
		return row ? toPlayerRow(row) : null;
	}

	/** Lock the player's wallet row for the tenant (its lowest-id row). Null when it has none. */
	async lockPlayerWallet(tx: ChipExecutor, playerId: number, tenant: string): Promise<ChipWalletRow | null> {
		const [row] = await rows<RawWalletRow>(tx, sql`
			SELECT id, cash, exposure, currency
			FROM wallets
			WHERE user_id = ${playerId} AND tenant = ${tenant}
			ORDER BY id
			LIMIT 1
			FOR UPDATE`);
		return row ? toWalletRow(row) : null;
	}

	/** Read the player's wallet row for the tenant without a lock. */
	async readPlayerWallet(executor: ChipExecutor, playerId: number, tenant: string): Promise<ChipWalletRow | null> {
		const [row] = await rows<RawWalletRow>(executor, sql`
			SELECT id, cash, exposure, currency
			FROM wallets
			WHERE user_id = ${playerId} AND tenant = ${tenant}
			ORDER BY id
			LIMIT 1`);
		return row ? toWalletRow(row) : null;
	}

	/**
	 * Create the player's wallet row. Only called with the player's users row locked, so two deposits cannot
	 * both create one.
	 */
	async createPlayerWallet(tx: ChipExecutor, playerId: number, tenant: string, currency: string): Promise<ChipWalletRow> {
		const [row] = await rows<RawWalletRow>(tx, sql`
			INSERT INTO wallets (tenant, user_id, currency, cash, bonus, exposure)
			VALUES (${tenant}, ${playerId}, ${currency}, 0, 0, 0)
			RETURNING id, cash, exposure, currency`);
		if (!row) throw new Error('Could not create the player wallet');
		return toWalletRow(row);
	}

	/** Lock the whitelabel row that holds the pool (FOR UPDATE). */
	async lockPool(tx: ChipExecutor, tenant: string): Promise<ChipPoolRow | null> {
		const [row] = await rows<RawPoolRow>(tx, sql`
			SELECT id, name, COALESCE(credit_limit, 0) AS credit_limit, COALESCE(credit_used, 0) AS credit_used,
				COALESCE(credit_available, 0) AS credit_available
			FROM whitelabels
			WHERE id = ${tenant}
			FOR UPDATE`);
		return row ? toPoolRow(row) : null;
	}

	/** Read the pool without a lock (inside a transaction it sees that transaction's own writes). */
	async readPool(executor: ChipExecutor, tenant: string): Promise<ChipPoolRow | null> {
		const [row] = await rows<RawPoolRow>(executor, sql`
			SELECT id, name, COALESCE(credit_limit, 0) AS credit_limit, COALESCE(credit_used, 0) AS credit_used,
				COALESCE(credit_available, 0) AS credit_available
			FROM whitelabels
			WHERE id = ${tenant}`);
		return row ? toPoolRow(row) : null;
	}

	/** Is `agentId` the ancestor itself or one of its descendants (agent_hierarchy_closure, any depth)? */
	async isAgentInSubtree(executor: ChipExecutor, ancestorId: string, agentId: string): Promise<boolean> {
		if (!isUuid(ancestorId) || !isUuid(agentId)) return false;
		if (ancestorId.trim().toLowerCase() === agentId.trim().toLowerCase()) return true;
		const [row] = await rows<{ ok: boolean }>(executor, sql`
			SELECT EXISTS (
				SELECT 1 FROM agent_hierarchy_closure
				WHERE ancestor_id = ${ancestorId.trim()}::uuid AND descendant_id = ${agentId.trim()}::uuid
			) AS ok`);
		return row?.ok === true;
	}

	/**
	 * Which of `ids` are the ancestor itself or one of its descendants (agent_hierarchy_closure, any depth), in one
	 * query for a whole list. The list fields (AgentAccount.chips, User.chips) use it to keep an agent caller inside
	 * its own subtree. Ids come back lower-case.
	 */
	async agentsInSubtree(executor: ChipExecutor, ancestorId: string, ids: readonly string[]): Promise<Set<string>> {
		const out = new Set<string>();
		if (!isUuid(ancestorId)) return out;
		const ancestor = ancestorId.trim().toLowerCase();
		const wanted = [...new Set(ids.map((id) => String(id ?? '').trim().toLowerCase()).filter((id) => isUuid(id)))];
		if (wanted.includes(ancestor)) out.add(ancestor);
		const others = wanted.filter((id) => id !== ancestor);
		if (others.length === 0) return out;
		const found = await rows<{ id: string }>(executor, sql`
			SELECT descendant_id::text AS id
			FROM agent_hierarchy_closure
			WHERE ancestor_id = ${ancestor}::uuid AND descendant_id = ANY(${sql.param(others)}::uuid[])`);
		for (const r of found) out.add(String(r.id).toLowerCase());
		return out;
	}

	// ---- Writes: single guarded UPDATEs/INSERTs, inside the money transaction. ----

	/**
	 * chip_balance += delta. Returns the new balance, or null when the guard refused because the balance would
	 * go below zero.
	 */
	async moveAgentChips(tx: ChipExecutor, agentId: string, delta: number): Promise<number | null> {
		const [row] = await rows<{ chip_balance: string }>(tx, sql`
			UPDATE agents
			SET chip_balance = chip_balance + ${money(delta)}
			WHERE id = ${agentId}::uuid AND chip_balance + ${money(delta)} >= 0
			RETURNING chip_balance`);
		return row ? num(row.chip_balance) : null;
	}

	/**
	 * wallets.cash += delta. A negative delta may take only free chips (cash - exposure). Returns the new cash and
	 * exposure, or null when the guard refused.
	 */
	async moveWalletCash(tx: ChipExecutor, walletId: number, delta: number): Promise<{ cash: number; exposure: number } | null> {
		const [row] = await rows<{ cash: string; exposure: string }>(tx, sql`
			UPDATE wallets
			SET cash = cash + ${money(delta)}
			WHERE id = ${walletId} AND (${money(delta)} >= 0 OR cash - exposure + ${money(delta)} >= 0)
			RETURNING cash, exposure`);
		return row ? { cash: num(row.cash), exposure: num(row.exposure) } : null;
	}

	async setAgentCreditReference(tx: ChipExecutor, agentId: string, value: number): Promise<void> {
		await tx.execute(sql`UPDATE agents SET credit_limit = ${money(value)} WHERE id = ${agentId}::uuid`);
	}

	async setPlayerCreditReference(tx: ChipExecutor, playerId: number, tenant: string, value: number): Promise<void> {
		await tx.execute(sql`UPDATE users SET credit_limit = ${money(value)} WHERE id = ${playerId} AND tenant = ${tenant}`);
	}

	/** Insert credit_chip_ledger rows in one statement. Returns their ids in input order. */
	async insertLedgerRows(tx: ChipExecutor, entries: ChipLedgerInsert[]): Promise<string[]> {
		if (entries.length === 0) return [];
		const values = entries.map(
			(e) => sql`(${e.tenantId}, ${e.transferId}::uuid, ${e.accountType}::credit_entity_type, ${e.accountId},
				${e.counterpartyType}::credit_entity_type, ${e.counterpartyId}, ${e.kind}::chip_movement_kind,
				${money(e.amount)}, ${money(e.balanceBefore)}, ${money(e.balanceAfter)},
				${moneyOrNull(e.creditReferenceBefore)}, ${moneyOrNull(e.creditReferenceAfter)},
				${e.remark}, ${e.createdBy}, ${e.createdByType})`
		);
		const inserted = await rows<{ id: string }>(tx, sql`
			INSERT INTO credit_chip_ledger (tenant_id, transfer_id, account_type, account_id, counterparty_type,
				counterparty_id, kind, amount, balance_before, balance_after, credit_reference_before,
				credit_reference_after, remark, created_by, created_by_type)
			VALUES ${sql.join(values, sql`, `)}
			RETURNING id::text AS id`);
		return inserted.map((r) => String(r.id));
	}

	/**
	 * The player's wallet statement, written the way adjustWalletDb records a cash deposit: a ledger_entries row
	 * (base-currency amount, cash before/after, meta.originalAmount signed) and a wallet_ledger row (cash wallet,
	 * free chips before/after). The ledger_entries type is CHIP_DEPOSIT / CHIP_WITHDRAW, not credit/debit, so
	 * chip moves never count as cash deposits (first deposit, deposit KPIs, VIP, referral deposit hooks).
	 *
	 * Inserted directly rather than through createWalletLedgerEntry, which swallows errors by design: a failed
	 * insert inside this transaction must fail the transfer, not leave money moved without its statement row.
	 */
	async insertPlayerStatement(tx: ChipExecutor, e: PlayerChipStatementInsert): Promise<void> {
		const deposit = e.direction === 'DEPOSIT';
		const currency = e.currency as CurrencyCode;
		if (!currencyService.isValidCurrency(currency)) {
			throw new Error(`Invalid currency: ${e.currency}`);
		}
		const baseAmount = currencyService.toBaseCurrency(e.amount, currency);
		const type = deposit ? 'CHIP_DEPOSIT' : 'CHIP_WITHDRAW';
		const category = deposit ? 'chip_deposit' : 'chip_withdraw';
		const description = `${deposit ? 'Chips deposited by' : 'Chips withdrawn by'} ${e.counterpartyName}`.slice(0, 256);
		const meta = {
			type: category,
			transferId: e.transferId,
			originalAmount: deposit ? e.amount : -e.amount,
			originalCurrency: currency,
			baseAmount,
			baseCurrency: currencyService.getBaseCurrency(),
			counterpartyType: e.counterpartyType,
			counterpartyId: e.counterpartyId,
			counterpartyName: e.counterpartyName,
			remark: e.remark,
			description,
			status: 'completed',
		};
		await tx.execute(sql`
			INSERT INTO ledger_entries (tenant, wallet_id, type, amount, balance_before, balance_after, meta)
			VALUES (${e.tenant}, ${e.walletId}, ${type}, ${String(baseAmount)}::numeric, ${money(e.cashBefore)},
				${money(e.cashAfter)}, ${JSON.stringify(meta)}::jsonb)`);
		// wallet_ledger keeps the cash wallet's free chips (cash - exposure, floored at 0), as adjustWalletDb does.
		const freeBefore = Math.max(0, e.cashBefore - e.exposure);
		const freeAfter = Math.max(0, e.cashAfter - e.exposure);
		await tx.execute(sql`
			INSERT INTO wallet_ledger (tenant, wallet_id, user_id, wallet_type, category, direction, amount,
				balance_before, balance_after, description, reference_type, reference_id, meta)
			VALUES (${e.tenant}, ${e.walletId}, ${e.userId}, 'cash', ${category}, ${deposit ? 'credit' : 'debit'},
				${money(e.amount)}, ${money(freeBefore)}, ${money(freeAfter)}, ${description},
				'credit_chip_transfer', ${e.transferId}, ${JSON.stringify(meta)}::jsonb)`);
	}

	// ---- Batch reads: one query per figure kind for a list of ids. ----

	/** CREDIT agents of the tenant among `ids`. */
	async agentBases(executor: ChipExecutor, tenant: string, ids: string[]): Promise<ChipAgentBase[]> {
		if (ids.length === 0) return [];
		const found = await rows<RawAgentRow>(executor, sql`
			SELECT ${AGENT_COLUMNS}
			FROM agents a
			LEFT JOIN agent_credentials c ON c.agent_id = a.id
			WHERE a.tenant_id = ${tenant} AND a.scheme_type = 'CREDIT' AND a.id = ANY(${sql.param(ids)}::uuid[])`);
		return found.map((r) => {
			const a = toAgentRow(r);
			return {
				id: a.id,
				status: a.status,
				parentAgentId: a.parentAgentId,
				chipBalance: a.chipBalance,
				creditLimit: a.creditLimit,
				username: a.username,
			};
		});
	}

	/** Σ chip_balance of every CREDIT agent below each of `ids` (closure depth > 0), keyed by ancestor id. */
	async descendantAgentChips(executor: ChipExecutor, tenant: string, ids: string[]): Promise<Map<string, number>> {
		const out = new Map<string, number>();
		if (ids.length === 0) return out;
		const found = await rows<{ id: string; chips: string }>(executor, sql`
			SELECT p.ancestor_id::text AS id, COALESCE(SUM(d.chip_balance), 0) AS chips
			FROM (
				SELECT DISTINCT ancestor_id, descendant_id
				FROM agent_hierarchy_closure
				WHERE ancestor_id = ANY(${sql.param(ids)}::uuid[]) AND depth > 0 AND ancestor_id <> descendant_id
			) p
			JOIN agents d ON d.id = p.descendant_id AND d.tenant_id = ${tenant} AND d.scheme_type = 'CREDIT'
			GROUP BY p.ancestor_id`);
		for (const r of found) out.set(String(r.id), num(r.chips));
		return out;
	}

	/**
	 * Σ wallets.cash and Σ wallets.exposure of every credit player whose users.agent_id is the agent itself or one
	 * of its descendants, keyed by agent id. The agent itself is added explicitly, so a missing depth-0 closure
	 * row cannot drop its own players.
	 */
	async subtreePlayerWallets(
		executor: ChipExecutor,
		tenant: string,
		ids: string[]
	): Promise<Map<string, { cash: number; exposure: number }>> {
		const out = new Map<string, { cash: number; exposure: number }>();
		if (ids.length === 0) return out;
		const found = await rows<{ id: string; cash: string; exposure: string }>(executor, sql`
			WITH scope AS (
				SELECT ancestor_id, descendant_id
				FROM agent_hierarchy_closure
				WHERE ancestor_id = ANY(${sql.param(ids)}::uuid[]) AND depth > 0
				UNION
				SELECT x, x FROM unnest(${sql.param(ids)}::uuid[]) AS x
			)
			SELECT s.ancestor_id::text AS id, COALESCE(SUM(w.cash), 0) AS cash, COALESCE(SUM(w.exposure), 0) AS exposure
			FROM scope s
			JOIN users u ON u.agent_id = s.descendant_id AND u.tenant = ${tenant} AND u.player_type IN ${CREDIT_PLAYER_TYPES}
			LEFT JOIN LATERAL (
				SELECT cash, exposure FROM wallets
				WHERE wallets.user_id = u.id AND wallets.tenant = u.tenant
				ORDER BY wallets.id
				LIMIT 1
			) w ON true
			GROUP BY s.ancestor_id`);
		for (const r of found) out.set(String(r.id), { cash: num(r.cash), exposure: num(r.exposure) });
		return out;
	}

	/** Direct downline size: direct CREDIT sub-agents + own AGENT_CREDIT players, keyed by agent id. */
	async directDownlineCounts(executor: ChipExecutor, tenant: string, ids: string[]): Promise<Map<string, number>> {
		const out = new Map<string, number>();
		if (ids.length === 0) return out;
		const found = await rows<{ id: string; n: number }>(executor, sql`
			SELECT id, SUM(n)::int AS n FROM (
				SELECT parent_agent_id::text AS id, COUNT(*) AS n
				FROM agents
				WHERE tenant_id = ${tenant} AND scheme_type = 'CREDIT' AND parent_agent_id = ANY(${sql.param(ids)}::uuid[])
				GROUP BY parent_agent_id
				UNION ALL
				SELECT agent_id::text AS id, COUNT(*) AS n
				FROM users
				WHERE tenant = ${tenant} AND player_type = 'AGENT_CREDIT' AND agent_id = ANY(${sql.param(ids)}::uuid[])
				GROUP BY agent_id
			) t
			GROUP BY id`);
		for (const r of found) out.set(String(r.id), Number(r.n) || 0);
		return out;
	}

	/** Credit players of the tenant among `ids`, with their wallet's cash and exposure (0 when they have none). */
	async playerBases(executor: ChipExecutor, tenant: string, ids: number[]): Promise<ChipPlayerBase[]> {
		if (ids.length === 0) return [];
		const found = await rows<RawPlayerRow & { cash: string; exposure: string }>(executor, sql`
			SELECT ${PLAYER_COLUMNS}, COALESCE(w.cash, 0) AS cash, COALESCE(w.exposure, 0) AS exposure
			FROM users u
			LEFT JOIN LATERAL (
				SELECT cash, exposure FROM wallets
				WHERE wallets.user_id = u.id AND wallets.tenant = u.tenant
				ORDER BY wallets.id
				LIMIT 1
			) w ON true
			WHERE u.tenant = ${tenant} AND u.player_type IN ${CREDIT_PLAYER_TYPES} AND u.id = ANY(${sql.param(ids)}::int[])`);
		return found.map((r) => {
			const p = toPlayerRow(r);
			return {
				id: p.id,
				username: p.username,
				name: p.name,
				status: p.status,
				playerType: p.playerType,
				agentId: p.agentId,
				creditLimit: p.creditLimit,
				cash: num(r.cash),
				exposure: num(r.exposure),
			};
		});
	}

	/**
	 * The direct downline of an agent (its direct CREDIT sub-agents and its own AGENT_CREDIT players), or of the
	 * whitelabel when `parentAgentId` is null (root CREDIT agents and WHITELABEL_CREDIT players). Agents first,
	 * then players, each by username. `query` matches username, name, email, phone, or the exact id.
	 */
	async downlineMembers(
		executor: ChipExecutor,
		p: { tenant: string; parentAgentId: string | null; query: string | null; accountType: ChipMemberType | null }
	): Promise<ChipDownlineMember[]> {
		const like = p.query ? `%${escapeLike(p.query)}%` : null;
		const parts: SQL[] = [];
		if (p.accountType !== 'PLAYER') {
			const parent = p.parentAgentId
				? sql`a.parent_agent_id = ${p.parentAgentId}::uuid`
				: sql`a.parent_agent_id IS NULL`;
			const search = like
				? sql` AND (c.username ILIKE ${like} OR a.phone ILIKE ${like} OR a.id::text = ${p.query})`
				: sql.empty();
			parts.push(sql`
				SELECT 'AGENT'::text AS account_type, a.id::text AS id, lower(COALESCE(c.username, '')) AS sort_key
				FROM agents a
				LEFT JOIN agent_credentials c ON c.agent_id = a.id
				WHERE a.tenant_id = ${p.tenant} AND a.scheme_type = 'CREDIT' AND ${parent}${search}`);
		}
		if (p.accountType !== 'AGENT') {
			const parent = p.parentAgentId
				? sql`u.player_type = 'AGENT_CREDIT' AND u.agent_id = ${p.parentAgentId}::uuid`
				: sql`u.player_type = 'WHITELABEL_CREDIT'`;
			const search = like
				? sql` AND (u.username ILIKE ${like} OR u.name ILIKE ${like} OR u.email ILIKE ${like} OR u.phone ILIKE ${like} OR u.id::text = ${p.query})`
				: sql.empty();
			parts.push(sql`
				SELECT 'PLAYER'::text AS account_type, u.id::text AS id, lower(COALESCE(u.username, u.name, '')) AS sort_key
				FROM users u
				WHERE u.tenant = ${p.tenant} AND ${parent}${search}`);
		}
		if (parts.length === 0) return [];
		const found = await rows<{ account_type: ChipMemberType; id: string }>(executor, sql`
			SELECT account_type, id FROM (${sql.join(parts, sql` UNION ALL `)}) m
			ORDER BY account_type, sort_key, id`);
		return found.map((r) => ({ accountType: r.account_type, id: String(r.id) }));
	}

	/** One account's credit_chip_ledger rows, newest first, with the counterparty's and creator's names. */
	async statementPage(
		executor: ChipExecutor,
		p: {
			tenant: string;
			accountType: ChipLedgerAccountType;
			accountId: string;
			from: Date | null;
			toBefore: Date | null;
			offset: number;
			limit: number;
		}
	): Promise<{ rows: ChipStatementDbRow[]; total: number }> {
		const conditions: SQL[] = [
			sql`l.tenant_id = ${p.tenant}`,
			sql`l.account_type = ${p.accountType}::credit_entity_type`,
			sql`l.account_id = ${p.accountId}`,
		];
		if (p.from) conditions.push(sql`l.created_at >= ${p.from.toISOString()}::timestamptz`);
		if (p.toBefore) conditions.push(sql`l.created_at < ${p.toBefore.toISOString()}::timestamptz`);
		const where = sql.join(conditions, sql` AND `);

		type RawStatementRow = {
			id: string;
			created_at: string;
			kind: ChipLedgerKind;
			amount: string;
			balance_before: string;
			balance_after: string;
			credit_reference_before: string | null;
			credit_reference_after: string | null;
			counterparty_type: ChipLedgerAccountType | null;
			counterparty_id: string | null;
			counterparty_name: string | null;
			remark: string | null;
			created_by: string | null;
			created_by_type: string | null;
			created_by_name: string | null;
		};
		const [counted, page] = await Promise.all([
			rows<{ total: number }>(executor, sql`SELECT COUNT(*)::int AS total FROM credit_chip_ledger l WHERE ${where}`),
			rows<RawStatementRow>(executor, sql`
				WITH page AS (
					SELECT l.* FROM credit_chip_ledger l
					WHERE ${where}
					ORDER BY l.created_at DESC, l.id DESC
					LIMIT ${p.limit} OFFSET ${p.offset}
				)
				SELECT pg.id::text AS id,
					to_char(pg.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
					pg.kind::text AS kind, pg.amount, pg.balance_before, pg.balance_after,
					pg.credit_reference_before, pg.credit_reference_after,
					pg.counterparty_type::text AS counterparty_type, pg.counterparty_id, pg.remark,
					pg.created_by, pg.created_by_type,
					CASE pg.counterparty_type::text
						WHEN 'agent' THEN ca.username
						WHEN 'player' THEN COALESCE(cu.username, cu.name)
						WHEN 'whitelabel' THEN cw.name
					END AS counterparty_name,
					CASE pg.created_by_type
						WHEN 'agent' THEN ba.username
						WHEN 'admin' THEN COALESCE(bu.username, bu.name, bu.email)
					END AS created_by_name
				FROM page pg
				LEFT JOIN agent_credentials ca ON pg.counterparty_type = 'agent'
					AND ca.agent_id = (CASE WHEN pg.counterparty_id ~* ${UUID_PATTERN} THEN pg.counterparty_id::uuid END)
				LEFT JOIN users cu ON pg.counterparty_type = 'player' AND cu.tenant = pg.tenant_id
					AND cu.id = (CASE WHEN pg.counterparty_id ~ ${DIGITS_PATTERN} THEN pg.counterparty_id::bigint END)
				LEFT JOIN whitelabels cw ON pg.counterparty_type = 'whitelabel' AND cw.id = pg.counterparty_id
				LEFT JOIN agent_credentials ba ON pg.created_by_type = 'agent'
					AND ba.agent_id = (CASE WHEN pg.created_by ~* ${UUID_PATTERN} THEN pg.created_by::uuid END)
				LEFT JOIN users bu ON pg.created_by_type = 'admin'
					AND bu.id = (CASE WHEN pg.created_by ~ ${DIGITS_PATTERN} THEN pg.created_by::bigint END)
				ORDER BY pg.created_at DESC, pg.id DESC`),
		]);
		return {
			total: Number(counted[0]?.total ?? 0),
			rows: page.map((r) => ({
				id: String(r.id),
				createdAt: String(r.created_at),
				kind: r.kind,
				amount: num(r.amount),
				balanceBefore: num(r.balance_before),
				balanceAfter: num(r.balance_after),
				creditReferenceBefore: r.credit_reference_before == null ? null : num(r.credit_reference_before),
				creditReferenceAfter: r.credit_reference_after == null ? null : num(r.credit_reference_after),
				counterpartyType: r.counterparty_type,
				counterpartyId: text(r.counterparty_id),
				counterpartyName: text(r.counterparty_name),
				remark: text(r.remark),
				createdBy: text(r.created_by),
				createdByType: text(r.created_by_type),
				createdByName: text(r.created_by_name),
			})),
		};
	}
}
