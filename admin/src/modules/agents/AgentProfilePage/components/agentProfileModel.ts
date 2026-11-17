import type { StatHue } from '@/ui/components/Stat'
import { nowIST } from '@/shared/utils/date'
import { toast, type ToastTone } from '@/ui/components/toast'
function report(tone: ToastTone, value: { message: string; description?: string; duration?: number }) {
  toast({ tone, title: value.description ? value.message : undefined, message: value.description || value.message, duration: value.duration === undefined ? undefined : value.duration * 1000 })
}
export const profileNotification = {
  success: (value: { message: string; description?: string; duration?: number }) => report('ok', value),
  error: (value: { message: string; description?: string; duration?: number }) => report('error', value),
}
export interface ProfileStats {
  totalPlayers?: number; activePlayers24h?: number; newPlayersToday?: number; pendingDeposits?: number; pendingDepositsAmount?: number
  pendingWithdrawals?: number; pendingWithdrawalsAmount?: number; totalDeposits?: number; totalWithdrawals?: number
  directDeposits?: number; directWithdrawals?: number; manualDeposits?: number; manualWithdrawals?: number; ggr?: number; profitLoss?: number
  ggrByWalletType?: { cash?: number; bonus?: number; referralBonus?: number }; plByWalletType?: { cash?: number; bonus?: number; referralBonus?: number }
  directPlayerCount?: number; subAgentPlayerCount?: number; totalSubAgents?: number; totalDownlineBalance?: number; totalDownlineExposure?: number
  sportsGgr?: number; sportsPl?: number; casinoGgr?: number; casinoPl?: number; matkaGgr?: number; matkaPl?: number
}
export interface ProfileAgent {
  id: string; tenantId?: string; username?: string; phone?: string; schemeType: string; status?: string
  parentAgentId?: string; levelIndex?: number; tallyEnabled?: boolean; tallyDomains?: string[]; allowedDomains?: string[]
  sharingRates?: Array<{ domain: string; rate: number }>; commissionRates?: Array<{ domain: string; rate: number }>
  createdAt?: string
  stats?: ProfileStats | null
  // No credit limit, used, available or alert threshold: a CREDIT agent's figures are its chips account
  // (spec 2026-11-02), read apart from the profile.
}
export const profileLevelNames: Record<number, string> = { 1: 'Super Master', 2: 'Master', 3: 'Agent', 4: 'Sub Agent' }
export const profileDomainIcons: Record<string, string> = { sports: '⚽', casino: '🎰', matka: '🎲' }
export const profileHue: Record<string, StatHue> = { blue: 'blu', emerald: 'grn', green: 'grn', grey: 'ind', yellow: 'amb', purple: 'vio', orange: 'amb', red: 'red', cyan: 'blu', pink: 'vio', amber: 'amb', indigo: 'ind', teal: 'grn' }

/** The stats period presets of the Overview, in the order they are offered. */
export const PROFILE_STATS_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last week' },
  { value: '30d', label: 'Last month' },
  { value: 'all_time', label: 'All time' },
  { value: 'custom', label: 'Custom' },
] as const
/** A preset's IST calendar dates for agentDashboardStats; all time (and anything unknown) is null to null. */
export function profileStatsRange(preset: string): { from: string | null; to: string | null } {
  const today = nowIST()
  switch (preset) {
    case 'today': return { from: today.format('YYYY-MM-DD'), to: today.format('YYYY-MM-DD') }
    case 'yesterday': { const day = today.subtract(1, 'day'); return { from: day.format('YYYY-MM-DD'), to: day.format('YYYY-MM-DD') } }
    case '7d': return { from: today.subtract(6, 'day').format('YYYY-MM-DD'), to: today.format('YYYY-MM-DD') }
    case '30d': return { from: today.subtract(29, 'day').format('YYYY-MM-DD'), to: today.format('YYYY-MM-DD') }
    default: return { from: null, to: null }
  }
}
export const profileSchemeLabels: Record<string, string> = { COMMISSION: 'Commission', SHARING: 'Sharing', CREDIT: 'Credit' }
export const profileSchemeNotes: Record<string, string> = {
  COMMISSION: 'Earn commission only when players lose',
  SHARING: 'Earn percentage share of GGR revenue',
  CREDIT: 'Deposits and withdraws chips for its downline',
}
/** The nearest ancestor whose status restricts an agent whatever its own status says (AgentAccount.blockedByAncestor). */
export interface AgentRestriction { id: string; username?: string | null; status: string }
/**
 * What that ancestor's status does to the agent. A restriction cascades down the subtree (owner decision 1,
 * 2026-10-21) but is applied at sign-in and per request only, so the agent's own status still reads Active. A
 * SUSPENDED or BLOCKED ancestor refuses its sign-in, an INACTIVE one makes it read-only, and under either its
 * players can place no new bets (the player API's betting gate wants the whole chain ACTIVE). `text` follows the
 * ancestor's name.
 */
export function agentRestrictionNotice(restriction: AgentRestriction, parentAgentId?: string | null): { tone: 'error' | 'warn'; title: string; text: string } {
  const status = restriction.status.toUpperCase()
  const blocks = status === 'SUSPENDED' || status === 'BLOCKED'
  const where = restriction.id === parentAgentId ? 'parent' : 'upline'
  return {
    tone: blocks ? 'error' : 'warn',
    title: blocks ? `Blocked by its ${where}` : `Read-only through its ${where}`,
    text: `${where === 'parent' ? ', its parent,' : ', higher in its upline,'} is ${status.toLowerCase()}. Until it is active again this agent ${blocks ? 'cannot sign in' : 'can only view'} and its players cannot place new bets, whatever its own status shows.`,
  }
}
