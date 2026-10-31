import { z } from 'zod'
import type { Player } from '@/shared/types/player'

export interface ProfileWallet { userId?: string; currency?: string; balance?: number; bonus?: number; exposure?: number; referralBalance?: number; referralBonusBalance?: number; updatedAt?: string }
export interface PlayerProfile extends Omit<Player, 'wallet' | 'email' | 'phone'> {
  email?: string | null
  phone: string | null
  tenant?: string
  lastBet?: string | null
  firstDeposit?: string | null
  kycLevel?: string | number | null
  kycStatus?: string | null
  kycLastUpdate?: string | null
  wallet?: ProfileWallet | null
  limits?: { dailyStakeLimit?: number | null; weeklyStakeLimit?: number | null; exposureCapOverride?: number | null; cooldownSeconds?: number | null; maxBetSports?: number | null; maxBetCasino?: number | null; maxBetMatka?: number | null }
  access?: { canLogin?: boolean; canDeposit?: boolean; canWithdraw?: boolean; bonusEligible?: boolean; sports?: { visible?: boolean; canBet?: boolean }; casino?: { visible?: boolean; canBet?: boolean }; matka?: { visible?: boolean; canBet?: boolean } }
}
export interface ProfileActivity { id?: string; type?: string; timestamp?: string; description?: string; metadata?: unknown }
export interface ProfileProduct { product?: string; identifier?: string; name?: string; betCount?: number; totalStake?: number; totalReturn?: number; netAmount?: number }
export interface WalletBreakdown { cash?: number; bonus?: number; referralBonus?: number }
export interface ProductBreakdown { sports?: number; casino?: number; matka?: number }
export interface ProfileKpis {
  totalStake?: number; totalReturn?: number; activeBets?: number
  lifetimeValue?: number; totalWagered?: number; totalWinnings?: number; netGamingRevenue?: number; netDeposits?: number; depositCount?: number; depositVolume?: number; withdrawalCount?: number; withdrawalVolume?: number; manualDepositCount?: number; manualDepositVolume?: number; manualWithdrawalCount?: number; manualWithdrawalVolume?: number; chargebackCount?: number; chargebackVolume?: number; openBetsCount?: number; settledBetsCount?: number; averageBetSize?: number; bonusBalance?: number; activeBonusesCount?: number; wageringCompletionPercent?: number; casinoRTP?: number; casinoHitRate?: number; activeDays?: number; sessionsCount?: number; averageSessionLength?: number; ggr?: number; profitLoss?: number; ggrByWalletType?: WalletBreakdown; plByWalletType?: WalletBreakdown; bonusToCashTransfer?: number; referralToCashTransfer?: number; settledBetCountByWalletType?: WalletBreakdown; plByProduct?: ProductBreakdown; ggrByProduct?: ProductBreakdown; totalSportsStake?: number; totalSportsOpenStake?: number; totalCasinoStake?: number; totalMatkaStake?: number
}
export interface ProfileOverview { profile?: PlayerProfile; kpis?: ProfileKpis; recentActivity?: ProfileActivity[]; exposureByProduct?: { product?: string; exposure?: number; currency?: string }[]; topProducts?: ProfileProduct[] }
export function profileError(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback }
export const PLAYER_PASSWORD_INITIAL = { newPassword: '', confirmPassword: '', adminPassword: '' }
export const PLAYER_NOTE_INITIAL = { content: '', category: '', tags: '', isPinned: false }
export const playerNoteSchema = z.object({ content: z.string().min(1, 'Please enter content'), category: z.string(), tags: z.string(), isPinned: z.boolean() })
export function playerNoteInput(playerId: string, values: typeof PLAYER_NOTE_INITIAL) {
  return { playerId, content: values.content, category: values.category || null, tags: values.tags ? String(values.tags).split(',').map((tag) => tag.trim()).filter(Boolean) : [], isPinned: Boolean(values.isPinned) }
}
export type ProfileCreditAction = 'INCREASE' | 'DECREASE' | 'LIMIT_CHANGE'
export function profileCreditSchema(type: ProfileCreditAction, limit: number, available: number) {
  return z.object({ amount: z.number().nullable(), notes: z.string() }).superRefine((values, context) => {
    const message = values.amount == null ? 'Please enter amount' : values.amount < 0.01 ? 'Amount must be greater than 0' : type === 'DECREASE' && values.amount > limit ? 'Cannot decrease more than current limit' : type === 'DECREASE' && values.amount > available ? 'Cannot decrease more than available credit' : undefined
    if (message) context.addIssue({ code: 'custom', path: ['amount'], message })
  })
}
export const playerPasswordSchema = z.object({
  newPassword: z.string().min(1, 'Please enter the new password').min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(1, 'Please confirm the new password'),
  adminPassword: z.string().min(1, 'Please enter your login password to confirm'),
}).superRefine((values, context) => {
  if (values.confirmPassword && values.newPassword !== values.confirmPassword) context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match' })
})
export function profilePlayerType(type?: string | null): string {
  return type === 'AGENT_CREDIT' ? 'Credit' : type === 'WHITELABEL_CREDIT' ? 'Whitelabel Credit' : type === 'SHARING_AGENT_PLAYER' ? 'Sharing Player' : type === 'COMMISSION_AGENT_PLAYER' ? 'Commission Player' : 'Normal'
}
export function relativeProfileTime(value?: string | null, now = Date.now()): string {
  if (!value) return 'Never'
  const difference = Math.max(0, now - new Date(value).getTime())
  const minutes = Math.floor(difference / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`
}
export function profileForModal(profile: PlayerProfile): Player {
  return { id: profile.id, name: profile.name, email: profile.email || undefined, phone: profile.phone || '', username: profile.username, status: profile.status, bonusAllowed: profile.bonusAllowed ?? false, playerType: profile.playerType, creditLimit: profile.creditLimit, creditUsed: profile.creditUsed, creditAvailable: profile.creditAvailable,
    wallet: profile.wallet ? { userId: profile.wallet.userId || profile.id, currency: profile.wallet.currency || '', balance: profile.wallet.balance || 0, bonus: profile.wallet.bonus || 0, exposure: profile.wallet.exposure || 0, updatedAt: profile.wallet.updatedAt || new Date().toISOString() } : null }
}
