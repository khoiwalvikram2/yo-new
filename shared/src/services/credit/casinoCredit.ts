/**
 * Shared, transaction-driven credit module for CASINO bets.
 *
 * Ported from admin-backend BetCreditValidationService (lockCreditForBet L87,
 * releaseCreditForBet L179, reLockCreditForBet L431), specialized to domain='casino'.
 *
 * Invariant:
 *   - player credit_used   = open exposure (sports book + open casino stake)
 *   - settlement_balance   = realized P&L (= sports + casino + matka)
 *   - credit_available     = max(0, credit_limit - credit_used + settlement_balance)
 *     (agent_player_credits: the same, with current_balance as the settlement)
 *   - agent credit_used    = the credit the agent HANDED DOWN (Σ child agents' limits +
 *     Σ direct players' limits). A player's exposure is NOT cascaded into it: the
 *     player's whole limit is already counted there (plan W7). Agents and whitelabels
 *     receive settlement deltas only.
 * Casino P&L lands in settlement_balance_casino; settlement_balance is kept in sync
 * as the sum of the three domain columns.
 *
 * Lock and release are exact inverses for a void; for win/loss they net to the
 * realized casino P&L.
 *
 * MONEY-CRITICAL: every read inside a mutation uses SELECT ... FOR UPDATE and every
 * write uses raw SQL via tx.execute(sql`...`). Both pg result shapes are handled
 * (`result.rows?.[0]` for node-postgres, `result[0]` for array-shaped drivers).
 */
import { sql } from 'drizzle-orm'

const CREDIT_TYPES = new Set(['AGENT_CREDIT', 'WHITELABEL_CREDIT'])

/** Extract the first row from a drizzle/pg execute() result, tolerant of both shapes. */
function firstRow(result: any): any | null {
	return result?.rows?.[0] ?? result?.[0] ?? null
}

function num(v: any): number {
	return Number(v || 0)
}

function isCreditType(playerType: string | null | undefined): boolean {
	return CREDIT_TYPES.has(playerType ?? '')
}

/**
 * agent_player_credits for one player, under the player's FOR UPDATE lock (the caller holds
 * it): open_exposure / credit_used mirror the player's credit_used, current_balance moves by
 * the settlement delta, and credit_available uses the player invariant
 *   max(0, credit_limit - credit_used + current_balance).
 * One UPDATE; a missing row is left alone (as before).
 */
async function syncApcExposure(
	tx: any,
	agentId: string,
	userId: number,
	playerCreditUsed: number,
	balanceDelta: number
): Promise<void> {
	await (tx as any).execute(sql`
		UPDATE agent_player_credits
		SET current_balance = COALESCE(current_balance, 0) + ${balanceDelta},
			open_exposure = ${playerCreditUsed},
			credit_used = ${playerCreditUsed},
			credit_available = GREATEST(0, COALESCE(credit_limit, 0) - ${playerCreditUsed} + COALESCE(current_balance, 0) + ${balanceDelta}),
			updated_at = now()
		WHERE agent_id = ${agentId} AND player_id = ${userId}
	`)
}

/**
 * The agent's casino settlement moves by `delta` (one UPDATE computed from the row itself):
 * settlement_balance stays the sum of the three domain columns and credit_available is
 * recomputed. credit_used is NOT touched: it is the credit the agent handed down, not its
 * players' exposure (plan W7).
 */
async function applyAgentCasinoSettlementDelta(tx: any, agentId: string, delta: number): Promise<void> {
	if (!Number.isFinite(delta) || delta === 0) return
	await (tx as any).execute(sql`
		UPDATE agents
		SET settlement_balance_casino = COALESCE(settlement_balance_casino, 0) + ${delta},
			settlement_balance = COALESCE(settlement_balance_sports, 0) + COALESCE(settlement_balance_casino, 0) + COALESCE(settlement_balance_matka, 0) + ${delta},
			credit_available = GREATEST(0, COALESCE(credit_limit, 0) - COALESCE(credit_used, 0)
				+ COALESCE(settlement_balance_sports, 0) + COALESCE(settlement_balance_casino, 0) + COALESCE(settlement_balance_matka, 0) + ${delta})
		WHERE id = ${agentId}
	`)
}

/**
 * Read-only credit balance for the casino balance callback.
 * No lock needed (plain select). Returns creditPlayer=false for non-credit players.
 */
export async function getCasinoCreditBalance(
	executor: any,
	userId: number,
	tenant: string
): Promise<{ creditPlayer: boolean; creditAvailable: number }> {
	const result = await (executor as any).execute(sql`
		SELECT
			player_type,
			credit_limit,
			credit_used,
			settlement_balance
		FROM users
		WHERE id = ${userId} AND tenant = ${tenant}
		LIMIT 1
	`)
	const row = firstRow(result)
	if (!row) {
		return { creditPlayer: false, creditAvailable: 0 }
	}
	if (!isCreditType(row.player_type)) {
		return { creditPlayer: false, creditAvailable: 0 }
	}
	const creditLimit = num(row.credit_limit)
	const creditUsed = num(row.credit_used)
	const settlementBalance = num(row.settlement_balance)
	const available = Math.max(0, creditLimit - creditUsed + settlementBalance)
	return { creditPlayer: true, creditAvailable: available }
}

/**
 * Open casino stake for a player: the stakes of casino bets that have not settled yet
 * (status 'pending' or 'active').
 *
 * For a credit player this is the part of credit_used that lockCasinoCreditForBet added
 * and releaseCasinoCreditForBet has not released yet. Any code that recomputes
 * credit_used from scratch (e.g. the sports exposure recalculation) must add it back,
 * or it erases the casino locks.
 *
 * Read-only. Pass the caller's tx so the sum is read under the same locks.
 */
export async function getOpenCasinoStake(
	executor: any,
	userId: number,
	tenant: string,
	includeMatka = false
): Promise<number> {
	const result = await (executor as any).execute(sql`
		SELECT COALESCE(SUM(stake), 0) + ${includeMatka ? sql`(SELECT COALESCE(SUM(bet_amount),0) FROM matka_bets WHERE user_id=${userId} AND tenant=${tenant} AND status IN ('pending','active') AND wallet_type='credit')` : sql`0`} AS total
		FROM casino_bets
		WHERE user_id = ${userId}
			AND tenant = ${tenant}
			AND status IN ('pending', 'active')
	`)
	return num(firstRow(result)?.total)
}

/**
 * Lock credit for a casino bet (fail-closed). Increases open exposure (credit_used)
 * by betAmount on the player, and agent_player_credits follows it; the agent's own row
 * and all settlement balances are unchanged.
 *
 * Returns { creditPlayer:false, ok:true } for non-credit players (caller uses cash path).
 * Returns { ok:false, reason:'insufficient_credit' } and MUTATES NOTHING when the bet
 * exceeds available credit.
 */
export async function lockCasinoCreditForBet(
	tx: any,
	args: { userId: number; tenant: string; betAmount: number; betId?: string }
): Promise<{ creditPlayer: boolean; ok: boolean; creditAvailable: number; reason?: string }> {
	const { userId, tenant, betAmount } = args

	if (!Number.isFinite(betAmount) || betAmount <= 0) {
		throw new Error(`Invalid bet amount: ${betAmount}. Must be a positive number.`)
	}

	const result = await (tx as any).execute(sql`
		SELECT
			id,
			player_type,
			agent_id,
			credit_limit,
			credit_used,
			credit_available,
			settlement_balance
		FROM users
		WHERE id = ${userId} AND tenant = ${tenant}
		FOR UPDATE
		LIMIT 1
	`)
	const row = firstRow(result)
	if (!row) {
		throw new Error('Player not found')
	}

	if (!isCreditType(row.player_type)) {
		return { creditPlayer: false, ok: true, creditAvailable: 0 }
	}

	const agentId: string | null = row.agent_id
	const creditLimit = num(row.credit_limit)
	const creditUsed = num(row.credit_used)
	const settlementBalance = num(row.settlement_balance)
	const available = creditLimit - creditUsed + settlementBalance

	// FAIL-CLOSED: insufficient credit -> mutate nothing.
	if (betAmount > available) {
		return {
			creditPlayer: true,
			ok: false,
			creditAvailable: Math.max(0, available),
			reason: 'insufficient_credit',
		}
	}

	// Apply lock: exposure increases by betAmount, settlement unchanged.
	const newUsed = creditUsed + betAmount
	const newAvailable = Math.max(0, creditLimit - newUsed + settlementBalance)

	await (tx as any).execute(sql`
		UPDATE users
		SET credit_used = ${newUsed},
			credit_available = ${newAvailable}
		WHERE id = ${userId} AND tenant = ${tenant}
	`)

	if (agentId) {
		// AGENT_CREDIT: the agent's own row is NOT touched. Its credit_used is the credit it
		// handed down (this player's whole limit is already in it); adding the exposure too
		// counted it twice. Only the agent's view of this player follows the exposure.
		await syncApcExposure(tx, agentId, userId, newUsed, 0)
	}
	// NOTE: No whitelabel branch on lock. WHITELABEL_CREDIT players (agentId = null) track
	// open exposure ONLY on their `users` row (credit_used += betAmount, recomputed
	// above). The `whitelabels` aggregate receives SETTLEMENT updates only (on
	// release/relock), never credit_used changes, so a void is a perfect inverse
	// at the player level. Agents follow the same rule.

	return { creditPlayer: true, ok: true, creditAvailable: newAvailable }
}

/**
 * Release credit when a casino bet settles. Ports releaseCreditForBet (domain='casino').
 *
 * balanceDelta (casino P&L into settlement_balance_casino):
 *   - win:  +payoutAmount
 *   - loss: -(payoutAmount>0 ? payoutAmount : betAmount)
 *   - void: 0
 * Exposure (credit_used) is released by betAmount on the player and agent_player_credits.
 * Agent and whitelabel credit_used are NOT changed: they receive the settlement delta only.
 */
export async function releaseCasinoCreditForBet(
	tx: any,
	args: {
		userId: number
		tenant: string
		betAmount: number
		betResult: 'win' | 'loss' | 'void'
		payoutAmount: number
		betId?: string
	}
): Promise<{ creditPlayer: boolean }> {
	const { userId, tenant, betAmount, betResult, payoutAmount } = args

	// betAmount === 0 is allowed: a zero-stake marker bet (e.g. GMAG zero-amount placeholder) has no
	// locked exposure to release, but may still carry a settlement delta (a zero-stake "win"). With
	// betAmount 0 the exposure release is a no-op and only the settlement delta is applied — never throw,
	// which would otherwise abort the whole round-settlement transaction. Only a negative amount is invalid.
	if (!Number.isFinite(betAmount) || betAmount < 0) {
		throw new Error(`Invalid bet amount: ${betAmount}. Must be a non-negative number.`)
	}
	if (!Number.isFinite(payoutAmount) || payoutAmount < 0) {
		throw new Error(`Invalid payout amount: ${payoutAmount}. Must be a non-negative number.`)
	}
	if (!['win', 'loss', 'void'].includes(betResult)) {
		throw new Error(`Invalid bet result: ${betResult}. Must be 'win', 'loss', or 'void'.`)
	}

	const exposureRelease = betAmount

	const result = await (tx as any).execute(sql`
		SELECT
			id,
			player_type,
			agent_id,
			credit_limit,
			credit_used,
			settlement_balance,
			settlement_balance_sports,
			settlement_balance_casino,
			settlement_balance_matka
		FROM users
		WHERE id = ${userId} AND tenant = ${tenant}
		FOR UPDATE
		LIMIT 1
	`)
	const row = firstRow(result)
	if (!row) {
		throw new Error('Player not found')
	}
	if (!isCreditType(row.player_type)) {
		return { creditPlayer: false }
	}

	const agentId: string | null = row.agent_id

	// Casino P&L delta into settlement_balance_casino.
	let balanceDelta = 0
	if (betResult === 'win') {
		balanceDelta = payoutAmount
	} else if (betResult === 'loss') {
		const actualLoss = payoutAmount > 0 ? payoutAmount : betAmount
		balanceDelta = -actualLoss
	} else {
		balanceDelta = 0
	}

	// Player settlement balances.
	const sbSports = num(row.settlement_balance_sports)
	const sbCasino = num(row.settlement_balance_casino) + balanceDelta
	const sbMatka = num(row.settlement_balance_matka)
	const newSettlement = sbSports + sbCasino + sbMatka

	// Release exposure.
	const creditLimit = num(row.credit_limit)
	const newUsed = Math.max(0, num(row.credit_used) - exposureRelease)
	const newAvailable = Math.max(0, creditLimit - newUsed + newSettlement)

	await (tx as any).execute(sql`
		UPDATE users
		SET credit_used = ${newUsed},
			credit_available = ${newAvailable},
			settlement_balance = ${newSettlement},
			settlement_balance_sports = ${sbSports},
			settlement_balance_casino = ${sbCasino},
			settlement_balance_matka = ${sbMatka}
		WHERE id = ${userId} AND tenant = ${tenant}
	`)

	if (agentId) {
		// Agent: casino settlement only. Its credit_used (the credit it handed down) does not
		// move when a player's exposure is released.
		await applyAgentCasinoSettlementDelta(tx, agentId, balanceDelta)

		// agent_player_credits: exposure follows the player's released credit_used,
		// current_balance += balanceDelta, available recomputed.
		await syncApcExposure(tx, agentId, userId, newUsed, balanceDelta)
	} else if (row.player_type === 'WHITELABEL_CREDIT' && tenant && tenant !== 'default') {
		// Whitelabel: settlement only; credit_used NOT changed on release (original L386-388).
		const wlRes = await (tx as any).execute(sql`
			SELECT credit_limit, credit_used,
				settlement_balance_sports, settlement_balance_casino, settlement_balance_matka
			FROM whitelabels
			WHERE id = ${tenant}
			FOR UPDATE
			LIMIT 1
		`)
		const wlRow = firstRow(wlRes)
		if (wlRow) {
			const wSports = num(wlRow.settlement_balance_sports)
			const wCasino = num(wlRow.settlement_balance_casino) + balanceDelta
			const wMatka = num(wlRow.settlement_balance_matka)
			const wSettle = wSports + wCasino + wMatka
			const wLimit = num(wlRow.credit_limit)
			const wUsed = num(wlRow.credit_used)
			const wAvail = Math.max(0, wLimit - wUsed + wSettle)
			await (tx as any).execute(sql`
				UPDATE whitelabels
				SET settlement_balance = ${wSettle},
					credit_available = ${wAvail},
					settlement_balance_sports = ${wSports},
					settlement_balance_casino = ${wCasino},
					settlement_balance_matka = ${wMatka},
					updated_at = now()
				WHERE id = ${tenant}
			`)
		}
	}

	return { creditPlayer: true }
}

/**
 * Pure positive settlement credit for a casino payout that has NO exposure to release
 * (e.g. a manual jackpot "payUp", or an additional win booked on an already-settled bet
 * whose exposure was freed at the first settle).
 *
 * Mirrors the settlement cascade of releaseCasinoCreditForBet on a win, MINUS the
 * exposure (credit_used) change: settlement_balance_casino += amount on the player and
 * its agent (AGENT_CREDIT) or whitelabel (WHITELABEL_CREDIT) aggregate; credit_used is
 * left untouched everywhere. credit_available is recomputed from the new settlement.
 *
 * Returns { creditPlayer:false } for non-credit players (caller uses the cash path).
 */
export async function creditCasinoSettlement(
	tx: any,
	args: { userId: number; tenant: string; amount: number; betId?: string }
): Promise<{ creditPlayer: boolean }> {
	const { userId, tenant, amount } = args

	if (!Number.isFinite(amount) || amount < 0) {
		throw new Error(`Invalid settlement amount: ${amount}. Must be a non-negative number.`)
	}

	const result = await (tx as any).execute(sql`
		SELECT
			id,
			player_type,
			agent_id,
			credit_limit,
			credit_used,
			settlement_balance,
			settlement_balance_sports,
			settlement_balance_casino,
			settlement_balance_matka
		FROM users
		WHERE id = ${userId} AND tenant = ${tenant}
		FOR UPDATE
		LIMIT 1
	`)
	const row = firstRow(result)
	if (!row) {
		throw new Error('Player not found')
	}
	if (!isCreditType(row.player_type)) {
		return { creditPlayer: false }
	}

	const agentId: string | null = row.agent_id
	const balanceDelta = amount

	// Player settlement balances; exposure (credit_used) UNCHANGED.
	const sbSports = num(row.settlement_balance_sports)
	const sbCasino = num(row.settlement_balance_casino) + balanceDelta
	const sbMatka = num(row.settlement_balance_matka)
	const newSettlement = sbSports + sbCasino + sbMatka

	const creditLimit = num(row.credit_limit)
	const creditUsed = num(row.credit_used)
	const newAvailable = Math.max(0, creditLimit - creditUsed + newSettlement)

	await (tx as any).execute(sql`
		UPDATE users
		SET credit_available = ${newAvailable},
			settlement_balance = ${newSettlement},
			settlement_balance_sports = ${sbSports},
			settlement_balance_casino = ${sbCasino},
			settlement_balance_matka = ${sbMatka}
		WHERE id = ${userId} AND tenant = ${tenant}
	`)

	if (agentId) {
		// Agent: casino settlement only; credit_used untouched.
		await applyAgentCasinoSettlementDelta(tx, agentId, balanceDelta)

		// agent_player_credits: current_balance += amount; exposure UNCHANGED (still the
		// player's credit_used), available recomputed.
		await syncApcExposure(tx, agentId, userId, creditUsed, balanceDelta)
	} else if (row.player_type === 'WHITELABEL_CREDIT' && tenant && tenant !== 'default') {
		const wlRes = await (tx as any).execute(sql`
			SELECT credit_limit, credit_used,
				settlement_balance_sports, settlement_balance_casino, settlement_balance_matka
			FROM whitelabels
			WHERE id = ${tenant}
			FOR UPDATE
			LIMIT 1
		`)
		const wlRow = firstRow(wlRes)
		if (wlRow) {
			const wSports = num(wlRow.settlement_balance_sports)
			const wCasino = num(wlRow.settlement_balance_casino) + balanceDelta
			const wMatka = num(wlRow.settlement_balance_matka)
			const wSettle = wSports + wCasino + wMatka
			const wLimit = num(wlRow.credit_limit)
			const wUsed = num(wlRow.credit_used)
			const wAvail = Math.max(0, wLimit - wUsed + wSettle)
			await (tx as any).execute(sql`
				UPDATE whitelabels
				SET settlement_balance = ${wSettle},
					credit_available = ${wAvail},
					settlement_balance_sports = ${wSports},
					settlement_balance_casino = ${wCasino},
					settlement_balance_matka = ${wMatka},
					updated_at = now()
				WHERE id = ${tenant}
			`)
		}
	}

	return { creditPlayer: true }
}

/**
 * Re-lock credit when a casino settlement is reversed. Ports reLockCreditForBet
 * (domain='casino'). Re-adds exposure (credit_used += betAmount) and applies the
 * NEGATION of the prior release's settlement delta to settlement_balance_casino,
 * cascading the settlement (not the exposure) to agent/whitelabel, syncing
 * agent_player_credits, and writes ONE agent_credit_ledger audit row.
 *
 * @param balanceChange the settlement delta the release applied (e.g. -1000 for a loss);
 *        relock applies its negation (settlement_balance_casino += -balanceChange).
 *
 * CURRENCY DECISION: currency defaults to 'INR' here. The admin-only
 * getWhitelabelCurrency helper is not trivially importable from shared/, so we hardcode
 * 'INR' for the ledger audit row (documented in the task report).
 */
export async function reLockCasinoCreditForBet(
	tx: any,
	args: { userId: number; tenant: string; betAmount: number; balanceChange: number; betId?: string }
): Promise<{ creditPlayer: boolean }> {
	const { userId, tenant, betAmount, balanceChange, betId } = args

	if (!Number.isFinite(betAmount) || betAmount <= 0) {
		throw new Error(`Invalid bet amount: ${betAmount}. Must be a positive number.`)
	}
	if (!Number.isFinite(balanceChange)) {
		throw new Error(`Invalid balance change: ${balanceChange}. Must be a finite number.`)
	}

	const exposureReLock = betAmount
	const balanceDelta = -balanceChange

	const result = await (tx as any).execute(sql`
		SELECT
			id,
			player_type,
			agent_id,
			credit_limit,
			credit_used,
			settlement_balance,
			settlement_balance_sports,
			settlement_balance_casino,
			settlement_balance_matka
		FROM users
		WHERE id = ${userId} AND tenant = ${tenant}
		FOR UPDATE
		LIMIT 1
	`)
	const row = firstRow(result)
	if (!row) {
		throw new Error('Player not found')
	}
	if (!isCreditType(row.player_type)) {
		return { creditPlayer: false }
	}

	const agentId: string | null = row.agent_id

	const sbSports = num(row.settlement_balance_sports)
	const sbCasino = num(row.settlement_balance_casino) + balanceDelta
	const sbMatka = num(row.settlement_balance_matka)
	const newSettlement = sbSports + sbCasino + sbMatka

	const currentUsedBefore = num(row.credit_used)
	const newUsedAfter = Math.max(0, currentUsedBefore + exposureReLock)
	const creditLimit = num(row.credit_limit)
	const newAvailable = Math.max(0, creditLimit - newUsedAfter + newSettlement)

	await (tx as any).execute(sql`
		UPDATE users
		SET credit_used = ${newUsedAfter},
			credit_available = ${newAvailable},
			settlement_balance = ${newSettlement},
			settlement_balance_sports = ${sbSports},
			settlement_balance_casino = ${sbCasino},
			settlement_balance_matka = ${sbMatka}
		WHERE id = ${userId} AND tenant = ${tenant}
	`)

	if (agentId) {
		// Agent: reverse the casino settlement only; credit_used untouched.
		await applyAgentCasinoSettlementDelta(tx, agentId, balanceDelta)

		// agent_player_credits: exposure follows the player's re-locked credit_used.
		await syncApcExposure(tx, agentId, userId, newUsedAfter, balanceDelta)
	} else if (row.player_type === 'WHITELABEL_CREDIT' && tenant && tenant !== 'default') {
		const wlRes = await (tx as any).execute(sql`
			SELECT credit_limit, credit_used,
				settlement_balance_sports, settlement_balance_casino, settlement_balance_matka
			FROM whitelabels
			WHERE id = ${tenant}
			FOR UPDATE
			LIMIT 1
		`)
		const wlRow = firstRow(wlRes)
		if (wlRow) {
			const wSports = num(wlRow.settlement_balance_sports)
			const wCasino = num(wlRow.settlement_balance_casino) + balanceDelta
			const wMatka = num(wlRow.settlement_balance_matka)
			const wSettle = wSports + wCasino + wMatka
			const wLimit = num(wlRow.credit_limit)
			const wUsed = num(wlRow.credit_used)
			const wAvail = Math.max(0, wLimit - wUsed + wSettle)
			await (tx as any).execute(sql`
				UPDATE whitelabels
				SET settlement_balance = ${wSettle},
					credit_available = ${wAvail},
					settlement_balance_sports = ${wSports},
					settlement_balance_casino = ${wCasino},
					settlement_balance_matka = ${wMatka},
					updated_at = now()
				WHERE id = ${tenant}
			`)
		}
	}

	// ONE audit ledger row. bet_id is a UUID column: only set it when provided.
	const currency = 'INR' // see CURRENCY DECISION above
	const playerIdStr = userId.toString()
	if (betId) {
		await (tx as any).execute(sql`
			INSERT INTO agent_credit_ledger (
				tenant_id, from_entity_type, from_entity_id, to_entity_type, to_entity_id,
				transaction_type, amount, currency, balance_before, balance_after,
				reason, bet_id, created_by_type, created_at
			) VALUES (
				${tenant}, 'player', ${playerIdStr}, 'player', ${playerIdStr},
				'USAGE', ${betAmount}, ${currency}, ${currentUsedBefore}, ${newUsedAfter},
				'Casino settlement reversal - re-lock credit', ${betId}, 'system', now()
			)
		`)
	} else {
		await (tx as any).execute(sql`
			INSERT INTO agent_credit_ledger (
				tenant_id, from_entity_type, from_entity_id, to_entity_type, to_entity_id,
				transaction_type, amount, currency, balance_before, balance_after,
				reason, created_by_type, created_at
			) VALUES (
				${tenant}, 'player', ${playerIdStr}, 'player', ${playerIdStr},
				'USAGE', ${betAmount}, ${currency}, ${currentUsedBefore}, ${newUsedAfter},
				'Casino settlement reversal - re-lock credit', 'system', now()
			)
		`)
	}

	return { creditPlayer: true }
}
