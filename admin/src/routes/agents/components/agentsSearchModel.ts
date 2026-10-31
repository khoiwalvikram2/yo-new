export type AgentScheme = 'SHARING' | 'CREDIT' | 'COMMISSION'
export interface AgentListStats {
  activePlayers?: number | null; lastLogin?: string | null; daysSinceLastBet?: number | null
  totalDeposits?: number | null; totalWithdrawals?: number | null; ggr?: number | null
  totalExposure?: number | null; profitLoss?: number | null; plTrend?: string | null; betCount?: number | null
  pendingSettlement?: number | null; totalSettled?: number | null; lastSettlementDate?: string | null
  turnover?: number | null; commissionEarned?: number | null; commissionTrend?: string | null
}
export interface AgentListRow {
  id: string; tenantId?: string; username?: string | null; phone?: string | null; schemeType: string; status: string
  parentAgentId?: string | null; parentAgent?: { id: string; username?: string | null } | null; levelIndex?: number | null
  tallyEnabled?: boolean; tallyDomains?: string[]; allowedDomains?: string[]; createdAt?: string
  sharingRates?: Array<{ domain: string; rate: number }>; commissionRates?: Array<{ domain: string; rate: number }>
  creditLimit?: number; creditUsed?: number; creditAvailable?: number
  stats?: AgentListStats | null; children?: AgentListRow[]
}
export interface AgentsPageData {
  agents?: { agentsPage?: { items?: AgentListRow[]; total?: number; itemsWithStats?: Array<{ agent: { id: string }; stats: AgentListStats }> } }
}
export interface AgentSettlementSelection {
  agentId: string; agent: { id: string; username?: string | null; schemeType: string }; pendingAmount: number; settlementType?: string
  /** From the agent's pending row: who pays, the window end the settle must post (SHARING) and the domain breakdown. */
  schemeType?: string; settlementDirection?: string | null; periodTo?: string | null
  settlementBreakdownByDomain?: Array<{ domain: string; amount: number; percentage: number; cutAmount: number; cutPercentage: number; agentShare?: number | null; shareRate?: number | string | null }>
}
export const agentLevelNames: Record<number, string> = { 1: 'Super Master', 2: 'Master', 3: 'Agent', 4: 'Sub Agent' }
export const agentDomainIcons: Record<string, string> = { sports: '⚽', casino: '🎰', matka: '🎲' }
export function agentTree(roots: AgentListRow[], children: Record<string, AgentListRow[]>): AgentListRow[] {
  return roots.map(root => ({ ...root, children: children[root.id]?.length ? agentTree(children[root.id].map(child => ({ ...child, stats: null })), children) : [] }))
    .sort((a, b) => (a.username || a.id).localeCompare(b.username || b.id))
}
/**
 * Which money actions a row offers. An agent settles and pays its DIRECT children only (never itself or a
 * grandchild). An admin settles any agent but pays commission only to a top-level commission agent: one under
 * a commission parent is paid by that parent (paying it from the admin side paid it twice). Whitelabel admins
 * do not pay commission from the list.
 */
export function agentRowMoneyActions(row: Pick<AgentListRow, 'schemeType' | 'parentAgentId'>, caller: { agentId?: string | null; isWhitelabelAdmin?: boolean }) {
  const directChild = !!caller.agentId && row.parentAgentId === caller.agentId
  const sharingOrCredit = row.schemeType === 'SHARING' || row.schemeType === 'CREDIT'
  return {
    settle: sharingOrCredit && (caller.agentId ? directChild : true),
    pay: row.schemeType === 'COMMISSION' && (caller.agentId ? directChild : !caller.isWhitelabelAdmin && !row.parentAgentId),
  }
}

/** Above this share of its limit an agent counts as high credit use, in the list and in the stats card. */
export const HIGH_CREDIT_USE = 0.8
/** A credit agent's limit, use and headroom as the list shows them. */
export function creditUsage(row: Pick<AgentListRow, 'creditLimit' | 'creditUsed' | 'creditAvailable'>) {
  const limit = Number(row.creditLimit ?? 0)
  const used = Number(row.creditUsed ?? 0)
  const available = row.creditAvailable != null ? Number(row.creditAvailable) : Math.max(0, limit - used)
  return {
    limit, used, available,
    percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    high: limit > 0 && used / limit > HIGH_CREDIT_USE,
  }
}

/**
 * The agents of one scheme whose parent is not in the same list. Their figures already hold their
 * sub-agents' (turnover, P/L and pending cover the whole downline; a parent's credit used is what it
 * allocated below it), so network totals add up these agents only.
 */
export function topLevelAgents<T extends { id: string; parentAgentId?: string | null }>(rows: readonly T[]): T[] {
  const ids = new Set(rows.map(row => row.id))
  return rows.filter(row => !row.parentAgentId || !ids.has(row.parentAgentId))
}

export type AgentRowAction = 'settle' | 'pay' | 'reactivate' | 'credit' | 'view'
/**
 * The one action a row puts in front; the rest live in its menu. Money that is due comes first,
 * then bringing a suspended agent back, then the scheme's routine action.
 */
export function agentPrimaryAction(row: Pick<AgentListRow, 'schemeType' | 'status' | 'stats'>,
  allowed: { settle: boolean; pay: boolean; hasPending: boolean }): AgentRowAction {
  if (allowed.settle && allowed.hasPending) return 'settle'
  if (allowed.pay && (row.stats?.commissionEarned ?? 0) > 0) return 'pay'
  if (row.status === 'SUSPENDED') return 'reactivate'
  if (row.schemeType === 'CREDIT') return 'credit'
  return 'view'
}
