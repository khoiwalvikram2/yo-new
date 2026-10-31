/**
 * SettlementModal rules (W10). Sign convention of the settlement engine: a SHARING pending amount is positive
 * when the agent is owed (TO_AGENT: you pay the agent its share) and negative when the agent owes (FROM_AGENT).
 */

/** The direction a settlement goes: the backend's settlementDirection, else the sign of the pending amount. */
export function settlementModalDirection(direction: string | null | undefined, pending: number): 'TO_AGENT' | 'FROM_AGENT' {
  if (direction === 'TO_AGENT' || direction === 'FROM_AGENT') return direction
  return pending >= 0 ? 'TO_AGENT' : 'FROM_AGENT'
}

/**
 * What is still owed after settling `amount` in `direction`, signed (positive = you still owe the agent,
 * negative = the agent still owes you). `pending` may be signed (SHARING) or absolute (CREDIT): its
 * magnitude is taken in `owedDirection`. The display is |remaining|.
 */
export function remainingAfterSettlement(pending: number, owedDirection: 'TO_AGENT' | 'FROM_AGENT', direction: string, amount: number): number {
  const signed = owedDirection === 'FROM_AGENT' ? -Math.abs(pending) : Math.abs(pending)
  return signed - (direction === 'FROM_AGENT' ? -amount : amount)
}
