/* /agent/credit: a CREDIT agent's Chips page (spec docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md
   §8): its own figures, its direct downline with Deposit / Withdraw / Credit reference, and its chip
   statement. The credit-limit overview, adjustments and settlements went with the credit-limit model. */

export type AgentChipsTab = 'downline' | 'statement'

export const AGENT_CHIPS_TABS: readonly { value: AgentChipsTab; label: string }[] = [
  { value: 'downline', label: 'Downline' },
  { value: 'statement', label: 'Statement' },
]

export interface AgentLike {
  schemeType?: string | null
}

export type AgentChipsAccess = 'unauthenticated' | 'denied' | 'allowed'

/** Only a signed-in CREDIT agent has chips; the other schemes have their own pages. */
export function agentChipsAccess(agent?: AgentLike | null): AgentChipsAccess {
  if (!agent) return 'unauthenticated'
  return agent.schemeType === 'CREDIT' ? 'allowed' : 'denied'
}
