import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { AgentsRepo } from './AgentsRepo';
import { lockAgentCreditRow } from './creditBalanceSql';
import { getOpenCasinoStake } from '@shared/services/credit/casinoCredit.js';
import { agentCreditUsedFromAllocations, creditAvailableOf } from '@/domains/agents/services/creditMath';

export interface CreditRecalculationResult {
	playerId: number;
	currentUsed: number;
	calculatedUsed: number;
	delta: number;
	currentBalance: number;
	openExposure: number;
}

export interface AgentCreditRecalculationResult {
	agentId: string;
	currentUsed: number;
	calculatedUsed: number;
	delta: number;
	affectedPlayers: CreditRecalculationResult[];
	subAgentAllocations: number;
}

function rows(result: any): any[] {
	return result?.rows ?? (Array.isArray(result) ? result : []);
}

function num(v: unknown): number {
	const n = Number(v ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * The limits a CREDIT agent has handed down: its child agents' credit_limit and its direct
 * AGENT_CREDIT players' credit_limit (see creditMath.ts for the model). Pass a transaction
 * to read under the caller's locks.
 */
export async function handedDownCreditLimits(
	executor: any,
	agentId: string
): Promise<{ childAgentLimits: number[]; directPlayerLimits: number[] }> {
	const children = await executor.execute(sql`
		SELECT credit_limit FROM agents WHERE parent_agent_id = ${agentId}
	`);
	const players = await executor.execute(sql`
		SELECT credit_limit FROM users WHERE agent_id = ${agentId} AND player_type = 'AGENT_CREDIT'
	`);
	return {
		childAgentLimits: rows(children).map((r) => num(r.credit_limit)),
		directPlayerLimits: rows(players).map((r) => num(r.credit_limit)),
	};
}

export class CreditCalculationRepo {
	constructor(private agentsRepo: AgentsRepo) {}

	/**
	 * Recalculate credit used for a player from authoritative sources (read-only preview).
	 *
	 * A credit player's credit_used is its open exposure: the sports book exposure (kept in
	 * wallets.exposure by every sports recalculation) plus the stake of its open casino bets.
	 * The old version summed sports_bets.liability and left the casino stake out, so applying
	 * it erased the casino locks.
	 *
	 * currentBalance is the player's settlement balance (realised P&L).
	 */
	async recalculateCreditUsedForPlayer(
		playerId: number,
		tenant: string
	): Promise<CreditRecalculationResult> {
		const result = await db.execute(sql`
			SELECT u.credit_used, u.settlement_balance,
				(SELECT COALESCE(w.exposure, 0) FROM wallets w
					WHERE w.user_id = u.id AND w.tenant = u.tenant LIMIT 1) AS sports_exposure
			FROM users u
			WHERE u.id = ${playerId} AND u.tenant = ${tenant}
		`);
		const row = rows(result)[0] ?? null;
		const sportsExposure = num(row?.sports_exposure);
		const openCasinoStake = await getOpenCasinoStake(db, playerId, tenant, true);
		const calculatedUsed = round2(sportsExposure + openCasinoStake);
		const currentUsed = num(row?.credit_used);

		return {
			playerId,
			currentUsed,
			calculatedUsed,
			delta: round2(calculatedUsed - currentUsed),
			currentBalance: num(row?.settlement_balance),
			openExposure: calculatedUsed,
		};
	}

	/**
	 * Recalculate credit used for an agent (read-only preview).
	 * Formula: agentCreditUsed = Σ child agents' credit_limit + Σ direct AGENT_CREDIT players'
	 * credit_limit. Player exposure is NOT part of it (it stays on the player; the player's
	 * whole limit is already counted). affectedPlayers lists the direct players' own
	 * exposure recalculation, which apply runs too.
	 */
	async recalculateCreditUsedForAgent(
		agentId: string,
		tenant: string
	): Promise<AgentCreditRecalculationResult> {
		const { childAgentLimits, directPlayerLimits } = await handedDownCreditLimits(db, agentId);
		const subAgentAllocations = agentCreditUsedFromAllocations(childAgentLimits, []);
		const calculatedUsed = agentCreditUsedFromAllocations(childAgentLimits, directPlayerLimits);

		const players = await db.execute(sql`
			SELECT id FROM users
			WHERE agent_id = ${agentId} AND tenant = ${tenant} AND player_type = 'AGENT_CREDIT'
			ORDER BY id
		`);
		const affectedPlayers: CreditRecalculationResult[] = [];
		for (const p of rows(players)) {
			affectedPlayers.push(await this.recalculateCreditUsedForPlayer(Number(p.id), tenant));
		}

		const agentCredit = await this.agentsRepo.getCreditFields(agentId);
		const currentUsed = agentCredit?.creditUsed || 0;

		return {
			agentId,
			currentUsed,
			calculatedUsed,
			delta: round2(calculatedUsed - currentUsed),
			affectedPlayers,
			subAgentAllocations,
		};
	}

	/**
	 * Apply the player recalculation. The value is recomputed under the player's row lock by
	 * the sports exposure recalculation (credit_used = sports book exposure + open casino
	 * stake, agent_player_credits synced), not taken from a preview computed earlier.
	 * `calculatedUsed` is accepted for backward compatibility and ignored.
	 */
	async applyRecalculationForPlayer(
		playerId: number,
		tenant: string,
		_calculatedUsed?: number
	): Promise<void> {
		const { recalculateUserExposure } = await import('@src/services/sports/sportsSettlementService.js');
		await db.transaction(async (tx) => {
			await recalculateUserExposure(playerId, tenant, tx);
		});
	}

	/**
	 * Apply the agent recalculation: credit_used = Σ handed-down limits, recomputed in one
	 * transaction under the agent's FOR UPDATE lock (allocations to its children or players
	 * lock this row first, so they cannot interleave). credit_available =
	 * max(0, credit_limit - credit_used + settlement_balance).
	 * `calculatedUsed` (a preview value) is accepted for backward compatibility and ignored.
	 */
	async applyRecalculationForAgent(
		agentId: string,
		_calculatedUsed?: number
	): Promise<{ previousUsed: number; creditUsed: number; creditAvailable: number }> {
		return db.transaction(async (tx) => {
			const locked = await lockAgentCreditRow(tx, agentId);
			if (!locked) {
				throw new Error('Agent not found');
			}
			const { childAgentLimits, directPlayerLimits } = await handedDownCreditLimits(tx, agentId);
			const creditUsed = agentCreditUsedFromAllocations(childAgentLimits, directPlayerLimits);
			const creditAvailable = creditAvailableOf({
				creditLimit: locked.creditLimit,
				creditUsed,
				settlementBalance: locked.settlementBalance,
			});
			await tx.execute(sql`
				UPDATE agents
				SET credit_used = ${creditUsed},
					credit_available = ${creditAvailable}
				WHERE id = ${agentId}
			`);
			return { previousUsed: locked.creditUsed, creditUsed, creditAvailable };
		});
	}
}
