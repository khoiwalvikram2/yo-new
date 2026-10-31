import { db } from '../../db/client';
import { agentPlayerCredits, users } from '@shared/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export interface PlayerCreditSummary {
	id: string;
	agentId: string;
	playerId: number;
	playerName: string;
	creditLimit: number;
	currentBalance: number;
	openExposure: number;
	creditUsed: number;
	creditAvailable: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface AllocateToPlayerInput {
	agentId: string;
	playerId: number;
	creditLimit: number;
}

export interface UpdatePlayerCreditInput {
	id: string;
	creditLimit?: number;
	currentBalance?: number;
	openExposure?: number;
}

export class AgentPlayerCreditsRepo {
	/**
	 * Allocate credit to a player
	 */
	async allocateToPlayer(input: AllocateToPlayerInput, tx: any = db): Promise<PlayerCreditSummary> {
		const ctx = tx ?? db;
		const creditLimit = input.creditLimit.toString();
		// An apc row may already exist (created at AGENT_CREDIT player creation, or via
		// the 0087 backfill) by the time an admin allocates credit. Upsert on the
		// (agent_id, player_id) unique index so the allocate sets the new limit instead
		// of crashing with 23505. We deliberately preserve any existing exposure state:
		// credit_used / current_balance / open_exposure are NOT reset; we only set the
		// new creditLimit and recompute creditAvailable consistently with updatePlayerCredit
		// (creditAvailable = max(0, creditLimit - creditUsed + currentBalance)).
		const [record] = await ctx
			.insert(agentPlayerCredits)
			.values({
				agentId: input.agentId,
				playerId: input.playerId,
				creditLimit,
				currentBalance: '0',
				openExposure: '0',
				creditUsed: '0',
				creditAvailable: creditLimit,
			})
			.onConflictDoUpdate({
				target: [agentPlayerCredits.agentId, agentPlayerCredits.playerId],
				set: {
					creditLimit,
					creditAvailable: sql`GREATEST(0, ${input.creditLimit} - ${agentPlayerCredits.creditUsed} + ${agentPlayerCredits.currentBalance})`,
					updatedAt: new Date(),
				},
			})
			.returning();

		return this.mapToPlayerCreditSummary(record, '');
	}

	/**
	 * Update player credit details
	 */
	async updatePlayerCredit(
		input: UpdatePlayerCreditInput,
		tx: any = db
	): Promise<PlayerCreditSummary> {
		const ctx = tx ?? db;
		const updates: any = {
			updatedAt: new Date(),
		};

		if (input.creditLimit !== undefined) {
			updates.creditLimit = input.creditLimit.toString();
		}
		if (input.currentBalance !== undefined) {
			updates.currentBalance = input.currentBalance.toString();
		}
		if (input.openExposure !== undefined) {
			updates.openExposure = input.openExposure.toString();
		}

		// Recalculate creditUsed and creditAvailable
		const current = await this.findById(input.id, ctx);
		if (!current) {
			throw new Error('Player credit record not found');
		}

		const settlementBalance = input.currentBalance !== undefined ? input.currentBalance : current.currentBalance;
		const exposure = input.openExposure !== undefined ? input.openExposure : current.openExposure;
		const limit = input.creditLimit !== undefined ? input.creditLimit : current.creditLimit;

		// creditUsed = exposure (locked bets)
		// creditAvailable = creditLimit - creditUsed + settlementBalance
		updates.creditUsed = exposure.toString();
		updates.creditAvailable = Math.max(0, limit - exposure + settlementBalance).toString();

		const [updated] = await ctx
			.update(agentPlayerCredits)
			.set(updates)
			.where(eq(agentPlayerCredits.id, input.id))
			.returning();

		return this.mapToPlayerCreditSummary(updated, current.playerName);
	}

	/**
	 * Release credit allocation from player (deletes the tracking row only; it does not
	 * move any credit back to the agent).
	 */
	async releaseFromPlayer(agentId: string, playerId: number): Promise<void> {
		await db
			.delete(agentPlayerCredits)
			.where(
				and(
					eq(agentPlayerCredits.agentId, agentId),
					eq(agentPlayerCredits.playerId, playerId)
				)
			);
	}

	/**
	 * Get player credit summary
	 */
	async getPlayerCreditSummary(
		agentId: string,
		playerId: number,
		tx: any = db
	): Promise<PlayerCreditSummary | null> {
		const ctx = tx ?? db;
		const [record] = await ctx
			.select()
			.from(agentPlayerCredits)
			.where(
				and(
					eq(agentPlayerCredits.agentId, agentId),
					eq(agentPlayerCredits.playerId, playerId)
				)
			)
			.limit(1);

		if (!record) {
			return null;
		}

		// Get player name
		const [player] = await ctx
			.select({ name: users.name })
			.from(users)
			.where(eq(users.id, playerId))
			.limit(1);

		return this.mapToPlayerCreditSummary(record, player?.name || '');
	}

	/**
	 * List all players under an agent with credit info
	 */
	async listAgentPlayers(agentId: string): Promise<PlayerCreditSummary[]> {
		const records = await db
			.select({
				credit: agentPlayerCredits,
				playerName: users.name,
			})
			.from(agentPlayerCredits)
			.innerJoin(users, eq(agentPlayerCredits.playerId, users.id))
			.where(eq(agentPlayerCredits.agentId, agentId));

		return records.map((r) => this.mapToPlayerCreditSummary(r.credit, r.playerName));
	}

	/**
	 * Find by ID
	 */
	async findById(id: string, tx: any = db): Promise<PlayerCreditSummary | null> {
		const ctx = tx ?? db;
		const [record] = await ctx
			.select()
			.from(agentPlayerCredits)
			.where(eq(agentPlayerCredits.id, id))
			.limit(1);

		if (!record) {
			return null;
		}

		// Get player name
		const [player] = await ctx
			.select({ name: users.name })
			.from(users)
			.where(eq(users.id, record.playerId))
			.limit(1);

		return this.mapToPlayerCreditSummary(record, player?.name || '');
	}

	/**
	 * Find by agent and player
	 */
	async findByAgentAndPlayer(
		agentId: string,
		playerId: number,
		tx: any = db
	): Promise<PlayerCreditSummary | null> {
		return this.getPlayerCreditSummary(agentId, playerId, tx);
	}

	/**
	 * Update player balance and recalculate credit.
	 *
	 * One UPDATE computed from the row itself (plan W7, lost updates): the old version read
	 * the row with a plain SELECT and wrote absolute values back, so a concurrent writer
	 * landing in between was erased.
	 *   current_balance += balanceDelta
	 *   open_exposure    = max(0, open_exposure + exposureDelta), credit_used follows it
	 *   credit_available = max(0, credit_limit - credit_used + current_balance)
	 */
	async updatePlayerBalance(
		agentId: string,
		playerId: number,
		balanceDelta: number,
		exposureDelta: number,
		tx: any = db
	): Promise<void> {
		const ctx = tx ?? db;
		const result = await ctx.execute(sql`
			UPDATE agent_player_credits
			SET current_balance = COALESCE(current_balance, 0) + ${balanceDelta},
				open_exposure = GREATEST(0, COALESCE(open_exposure, 0) + ${exposureDelta}),
				credit_used = GREATEST(0, COALESCE(open_exposure, 0) + ${exposureDelta}),
				credit_available = GREATEST(0, COALESCE(credit_limit, 0)
					- GREATEST(0, COALESCE(open_exposure, 0) + ${exposureDelta})
					+ COALESCE(current_balance, 0) + ${balanceDelta}),
				updated_at = now()
			WHERE agent_id = ${agentId} AND player_id = ${playerId}
			RETURNING id
		`);
		const row = (result as any)?.rows?.[0] ?? (result as any)?.[0] ?? null;
		if (!row) {
			throw new Error('Player credit record not found');
		}
	}

	/**
	 * Mirror a player's credit row into the agent's agent_player_credits row, creating it
	 * when missing (upsert on the (agent_id, player_id) unique index).
	 *
	 * The values come from the caller's FOR UPDATE-locked users row, so they are current:
	 * credit_limit and credit_used / open_exposure follow the player; the apc row keeps its
	 * own current_balance (a new row starts from the player's settlement balance), and
	 * credit_available = max(0, credit_limit - credit_used + current_balance).
	 */
	async upsertFromPlayer(
		input: { agentId: string; playerId: number; creditLimit: number; creditUsed: number; settlementBalance: number },
		tx: any = db
	): Promise<void> {
		const ctx = tx ?? db;
		const limit = Number(input.creditLimit) || 0;
		const used = Number(input.creditUsed) || 0;
		const balance = Number(input.settlementBalance) || 0;
		const available = Math.max(0, Math.round((limit - used + balance) * 100) / 100);
		await ctx.execute(sql`
			INSERT INTO agent_player_credits (agent_id, player_id, credit_limit, current_balance, open_exposure, credit_used, credit_available)
			VALUES (${input.agentId}, ${input.playerId}, ${limit}, ${balance}, ${used}, ${used}, ${available})
			ON CONFLICT (agent_id, player_id) DO UPDATE
			SET credit_limit = EXCLUDED.credit_limit,
				open_exposure = EXCLUDED.open_exposure,
				credit_used = EXCLUDED.credit_used,
				credit_available = GREATEST(0, EXCLUDED.credit_limit - EXCLUDED.credit_used + agent_player_credits.current_balance),
				updated_at = now()
		`);
	}

	/**
	 * Map database row to PlayerCreditSummary
	 */
	private mapToPlayerCreditSummary(row: any, playerName: string): PlayerCreditSummary {
		return {
			id: row.id,
			agentId: row.agentId,
			playerId: row.playerId,
			playerName,
			creditLimit: Number(row.creditLimit),
			currentBalance: Number(row.currentBalance),
			openExposure: Number(row.openExposure),
			creditUsed: Number(row.creditUsed),
			creditAvailable: Number(row.creditAvailable),
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}

