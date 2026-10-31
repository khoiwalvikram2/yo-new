/**
 * Commission vs CREDIT/SHARING settlement contract.
 * All commission-specific logic (payCommission, cycle, adjustments, readiness) MUST apply only to COMMISSION.
 * CREDIT and SHARING MUST use settleAgent (executeSettleAgent) only; they must never be routed to payCommission.
 * Resolvers enforce this; tests in __tests__/schemeIsolation.test.ts provide non-regression coverage.
 */

export type AgentScheme = 'COMMISSION' | 'SHARING' | 'CREDIT';

/** Schemes that use settleAgent (P/L or CREDIT settlement). */
export const SETTLE_AGENT_SCHEMES: AgentScheme[] = ['SHARING', 'CREDIT'];

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
