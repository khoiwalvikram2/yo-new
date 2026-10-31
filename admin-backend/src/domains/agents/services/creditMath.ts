export type CreditSnapshot = { creditLimit: number; creditUsed: number; settlementBalance: number }

/**
 * Pure helper that decides whether a credit usage delta can be applied to a snapshot.
 *
 * The availability formula mirrors the one used everywhere else in the credit code:
 *   available = creditLimit - creditUsed + settlementBalance
 *
 * MONEY-CRITICAL: callers MUST evaluate this against a snapshot read UNDER the same
 * `FOR UPDATE` lock as the subsequent write, otherwise a concurrent op can read the
 * same `creditUsed` and both write `creditUsed + amount`, over-allocating the pool.
 */
export function canApplyCreditDelta(
	s: CreditSnapshot,
	amount: number,
): { ok: true; newUsed: number } | { ok: false; reason: 'insufficient' } {
	const available = s.creditLimit - s.creditUsed + s.settlementBalance
	if (amount > available) return { ok: false, reason: 'insufficient' }
	return { ok: true, newUsed: s.creditUsed + amount }
}

/**
 * THE CREDIT MODEL (owner decision 2, plan W7). One set of rules for every writer.
 *
 * Player (AGENT_CREDIT / WHITELABEL_CREDIT), users row:
 *   credit_used      = the player's open exposure (sports book exposure + open casino stake)
 *   credit_available = max(0, credit_limit - credit_used + settlement_balance)
 *
 * agent_player_credits (the agent's view of one direct player): the same invariant, with
 * current_balance as that player's settlement balance:
 *   credit_used = open_exposure = the player's credit_used
 *   credit_available = max(0, credit_limit - credit_used + current_balance)
 *
 * CREDIT agent:
 *   credit_used      = credit it has handed down = Σ child agents' credit_limit
 *                      + Σ its direct AGENT_CREDIT players' credit_limit
 *   credit_available = max(0, credit_limit - credit_used + settlement_balance)
 * A player's open exposure stays on the player. It is NOT added into the agent's
 * credit_used: the player's whole limit is already counted there, so adding the exposure
 * too made an agent that had allocated its full limit look over-limit once players bet.
 *
 * Whitelabel pool: debited only when the ROOT agent's limit changes (admin -> root agent)
 * and for WHITELABEL_CREDIT players. Agent -> sub-agent and agent -> player allocations
 * come out of the parent's credit, not the pool; releases mirror allocations exactly.
 */
export type CreditBalanceRow = { creditLimit: number; creditUsed: number; settlementBalance: number }

/** max(0, limit - used + settlement): the availability formula for players, agents and apc rows. */
export function creditAvailableOf(s: CreditBalanceRow): number {
	return Math.max(0, round2(s.creditLimit - s.creditUsed + s.settlementBalance))
}

/** A CREDIT agent's credit_used: the limits it has handed down, never its players' exposure. */
export function agentCreditUsedFromAllocations(
	childAgentLimits: readonly number[],
	directPlayerLimits: readonly number[],
): number {
	const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + (Number.isFinite(Number(x)) ? Number(x) : 0), 0)
	return round2(sum(childAgentLimits) + sum(directPlayerLimits))
}

export type PoolTarget = 'root_agent' | 'sub_agent' | 'agent_player' | 'whitelabel_player'

/**
 * Whether a credit limit change on `target` moves the whitelabel pool. Only the root agent
 * (whose limit the admin sets from the pool) and WHITELABEL_CREDIT players draw on the pool;
 * a sub-agent or an agent's player is funded by its parent. The 'default' tenant has no pool.
 */
export function shouldMoveWhitelabelPool(tenantId: string | null | undefined, target: PoolTarget): boolean {
	if (!tenantId || tenantId === 'default') return false
	return target === 'root_agent' || target === 'whitelabel_player'
}

export type CreditAlertType = 'THRESHOLD_EXCEEDED' | 'OVER_LIMIT'

/**
 * The alert an agent's credit row calls for, if any. Usage is credit_used / credit_limit
 * (the share of its limit the agent has handed down). OVER_LIMIT when used > limit.
 */
export function creditAlertTypeFor(s: {
	creditLimit: number
	creditUsed: number
	creditAlertThreshold: number
}): { type: CreditAlertType; usagePercentage: number } | null {
	const limit = Number(s.creditLimit) || 0
	const used = Number(s.creditUsed) || 0
	if (limit <= 0) {
		return used > 0 ? { type: 'OVER_LIMIT', usagePercentage: 100 } : null
	}
	const usagePercentage = (used / limit) * 100
	if (used > limit) return { type: 'OVER_LIMIT', usagePercentage }
	const threshold = Number.isFinite(Number(s.creditAlertThreshold)) ? Number(s.creditAlertThreshold) : 80
	if (usagePercentage >= threshold) return { type: 'THRESHOLD_EXCEEDED', usagePercentage }
	return null
}

/**
 * Player credit adjustment types. A settlement is its own explicit type: a DECREASE whose
 * amount happens to equal |settlement_balance| is a DECREASE, never a settlement.
 */
export const PLAYER_CREDIT_ADJUSTMENT_TYPES = ['INCREASE', 'DECREASE', 'LIMIT_CHANGE', 'SETTLE'] as const
export type PlayerCreditAdjustmentType = (typeof PLAYER_CREDIT_ADJUSTMENT_TYPES)[number]

export function isPlayerCreditAdjustmentType(t: unknown): t is PlayerCreditAdjustmentType {
	return typeof t === 'string' && (PLAYER_CREDIT_ADJUSTMENT_TYPES as readonly string[]).includes(t)
}

/** True only for the explicit SETTLE type (never inferred from the amount). */
export function isPlayerSettlementAdjustment(adjustmentType: unknown): boolean {
	return adjustmentType === 'SETTLE'
}

function round2(n: number): number {
	return Math.round(n * 100) / 100
}
