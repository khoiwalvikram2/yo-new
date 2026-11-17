import type { ChipAccount } from '@/modules/chips'

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
  /** A CREDIT agent's credit reference (the input name is creditLimit); its credit used/available are retired. */
  creditLimit?: number | null
  /** A CREDIT agent's chips (spec 2026-11-02 §7 AgentAccount.chips), read beside the list (agentChips.ts). */
  chips?: ChipAccount | null
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
 * do not pay commission from the list. Only SHARING settles: a CREDIT agent's chips move by Deposit /
 * Withdraw, and settling with it is a D/W of its Ref P/L (spec 2026-11-02 decision 8, §6).
 */
export function agentRowMoneyActions(row: Pick<AgentListRow, 'schemeType' | 'parentAgentId'>, caller: { agentId?: string | null; isWhitelabelAdmin?: boolean }) {
  const directChild = !!caller.agentId && row.parentAgentId === caller.agentId
  return {
    settle: row.schemeType === 'SHARING' && (caller.agentId ? directChild : true),
    pay: row.schemeType === 'COMMISSION' && (caller.agentId ? directChild : !caller.isWhitelabelAdmin && !row.parentAgentId),
  }
}

/**
 * The agents of one scheme whose parent is not in the same list. Their figures already hold their
 * sub-agents' (turnover, P/L and pending cover the whole downline; an agent's downline balance and Ref P/L
 * cover every chip beneath it), so network totals add up these agents only.
 */
export function topLevelAgents<T extends { id: string; parentAgentId?: string | null }>(rows: readonly T[]): T[] {
  const ids = new Set(rows.map(row => row.id))
  return rows.filter(row => !row.parentAgentId || !ids.has(row.parentAgentId))
}

export type AgentRowAction = 'settle' | 'pay' | 'reactivate' | 'chips' | 'view'
/**
 * The one action a row puts in front; the rest live in its menu. Money that is due comes first,
 * then bringing a suspended agent back, then the scheme's routine action: a CREDIT agent's chips
 * (D / W / CR, offered where the caller is its direct parent).
 */
export function agentPrimaryAction(row: Pick<AgentListRow, 'schemeType' | 'status' | 'stats'>,
  allowed: { settle: boolean; pay: boolean; hasPending: boolean; chips?: boolean }): AgentRowAction {
  if (allowed.settle && allowed.hasPending) return 'settle'
  if (allowed.pay && (row.stats?.commissionEarned ?? 0) > 0) return 'pay'
  if (row.status === 'SUSPENDED') return 'reactivate'
  if (row.schemeType === 'CREDIT' && allowed.chips) return 'chips'
  return 'view'
}
