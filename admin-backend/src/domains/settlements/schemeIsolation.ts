/**
 * Settlement contract per agent scheme.
 * All commission-specific logic (payCommission, cycle, adjustments, readiness) MUST apply only to COMMISSION.
 * SHARING MUST use settleAgent (executeSettleAgent) only; it must never be routed to payCommission.
 * CREDIT is settled by neither: since 2026-11-02 a CREDIT account's chips move only by Deposit / Withdraw from
 * its direct parent (ChipService), and "settling" is a D/W of its Ref P/L (spec
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md §6). settleAgent (top-level and the legacy
 * AgentsMutation one) refuses it, and the credit-limit model's adjustPlayerCredit is gone from the API.
 * Resolvers enforce this; tests in __tests__/schemeIsolation.test.ts provide non-regression coverage.
 */

export type AgentScheme = 'COMMISSION' | 'SHARING' | 'CREDIT';

/** Schemes that use settleAgent (P/L settlement). */
export const SETTLE_AGENT_SCHEMES: AgentScheme[] = ['SHARING'];

/** The refusal of every retired CREDIT money path: credit moves as chips now. */
export const CREDIT_MOVES_AS_CHIPS = 'Credit now moves as chips: use Deposit / Withdraw';

/** Schemes that use payCommission (IST Monday–Monday full-cycle payout). */
export const PAY_COMMISSION_SCHEMES: AgentScheme[] = ['COMMISSION'];

export function isCommissionOnly(scheme: AgentScheme): boolean {
  return scheme === 'COMMISSION';
}

export function usesSettleAgent(scheme: AgentScheme): boolean {
  return SETTLE_AGENT_SCHEMES.includes(scheme);
}

export function usesPayCommission(scheme: AgentScheme): boolean {
  return PAY_COMMISSION_SCHEMES.includes(scheme);
}
