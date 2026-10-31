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
  creditLimit?: number; creditUsed?: number; creditAvailable?: number; creditAlertThreshold?: number; createdAt?: string
  stats?: ProfileStats | null
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
  CREDIT: 'Manage credit allocation for players',
}
