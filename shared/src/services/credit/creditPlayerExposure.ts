/**
 * Credit players (AGENT_CREDIT / WHITELABEL_CREDIT): write the player's whole open exposure.
 *
 *   credit_used      = sports book exposure + open casino stake
 *   credit_available = max(0, credit_limit - credit_used + settlement_balance)
 *
 * The same rule as user-backend's syncCreditPlayerOpenExposureInTx (plan W5, D1), shared so
 * admin-backend's sports settlement recalculation uses it too (plan W7). Writing the sports
 * figure alone erased the casino locks (lockCasinoCreditForBet adds the stake to
 * credit_used until releaseCasinoCreditForBet takes it out again).
 *
 * agent_player_credits follows the same figure:
 *   open_exposure = credit_used = the player's credit_used,
 *   credit_available = max(0, credit_limit - credit_used + current_balance).
 * The agent's own row is NOT touched: an agent's credit_used is the credit it handed down
 * (this player's whole limit is already in it), so the exposure is not added to it.
 *
 * Must run inside a transaction: it takes the users row lock (FOR UPDATE), the same lock
 * the casino credit lock and sports placement take, so the sum cannot interleave with them.
 * Returns null (and writes nothing) for a missing or non-credit player.
 */
import { sql } from 'drizzle-orm'
import { getOpenCasinoStake } from './casinoCredit.js'
import { isCreditPlayer } from './isCreditPlayer.js'

function firstRow(result: any): any | null {
	return result?.rows?.[0] ?? result?.[0] ?? null
}

function round2(n: number): number {
	return Math.round(n * 100) / 100
}

export async function syncCreditPlayerOpenExposureInTx(
	tx: any,
	args: { userId: number; tenant: string; sportsExposure: number }
): Promise<{ creditUsed: number; creditAvailable: number; openCasinoStake: number } | null> {
	const { userId, tenant } = args
	const userRes = await tx.execute(sql`
		SELECT player_type, agent_id::text AS agent_id, credit_limit, settlement_balance
		FROM users
		WHERE id = ${userId} AND tenant = ${tenant}
		FOR UPDATE
	`)
	const row = firstRow(userRes)
	if (!row || !isCreditPlayer(row.player_type)) return null

	const openCasinoStake = await getOpenCasinoStake(tx, userId, tenant, true)
	const creditUsed = round2(Math.max(0, Number(args.sportsExposure) || 0) + openCasinoStake)
	const creditLimit = Number(row.credit_limit ?? 0)
	const settlement = Number(row.settlement_balance ?? 0)
	const creditAvailable = round2(Math.max(0, creditLimit - creditUsed + settlement))

	await tx.execute(sql`
		UPDATE users
		SET credit_used = ${creditUsed},
			credit_available = ${creditAvailable}
		WHERE id = ${userId} AND tenant = ${tenant}
	`)

	const agentId: string | null = row.agent_id ?? null
	if (agentId) {
		// One UPDATE computed from the apc row itself (its own credit_limit / current_balance).
		await tx.execute(sql`
			UPDATE agent_player_credits
			SET open_exposure = ${creditUsed},
				credit_used = ${creditUsed},
				credit_available = GREATEST(0, COALESCE(credit_limit, 0) - ${creditUsed} + COALESCE(current_balance, 0)),
				updated_at = now()
			WHERE agent_id = ${agentId} AND player_id = ${userId}
		`)
	}

	return { creditUsed, creditAvailable, openCasinoStake }
}
