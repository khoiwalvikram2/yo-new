export interface AgentActivity { id: string; type?: string; timestamp?: string; playerName?: string; details?: string }
export interface ActivityResult { agents?: { agentActivity?: AgentActivity[] | null } }
export interface GgrTrend { date?: string; sportsGGR?: number; casinoGGR?: number; matkaGGR?: number; totalGGR?: number }
export interface GgrResult { reporting?: { ggrTrends?: GgrTrend[] | null } }
export interface DomainResult { reporting?: { domainBreakdown?: { domain?: string; ggr?: number; percentage?: number; totalBets?: number; totalStake?: number }[] | null } }
export interface PlayerActivityResult { reporting?: { playerActivity?: { date?: string; newPlayers?: number; activePlayers?: number; totalBets?: number; totalDeposits?: number }[] | null } }
/** Preserves the legacy raw Statistic values; conversion belongs to the existing caller. */
export function rawAmount(value: number, symbol: string): string {
  return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export function effectiveCommission(value: { effectiveCalculatedTotal?: number | null; calculatedTotal?: number | null }): number {
  return Number(value.effectiveCalculatedTotal ?? value.calculatedTotal ?? 0)
}
