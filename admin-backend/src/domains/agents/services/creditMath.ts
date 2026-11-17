export type CreditSnapshot = { creditLimit: number; creditUsed: number; settlementBalance: number }

/**
 * Pure helper that decides whether a credit usage delta can be applied to a snapshot.
 *
 * Its one caller is the whitelabel credit pool (repos/common/whitelabelCreditRepo.ts). The CREDIT agents' and
 * players' credit-limit model that shared it moved to Deposit/Withdraw chips on 2026-11-02 and was deleted.
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
