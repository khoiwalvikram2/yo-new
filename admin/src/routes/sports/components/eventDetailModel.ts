import type { StatusPillTone } from '@/ui/components/StatusPill'
import type { BettingPatternType, PatternSeverity } from './PatternBadge'
import type { FancyBookEntry } from '../utils/fancyBookCalculator'

export interface ProfileBet {
  id: string; createdAt?: string | null; marketId?: string | null; selectionId?: string | null
  stake?: number | null; liability?: number | null; price?: number | null
  side?: string | null; status?: string | null; currency?: string | null
}
export interface PlayerIntelligenceProfile {
  user?: { id: string; name?: string | null; username?: string | null; email?: string | null; phone?: string | null; status?: string | null }
  statistics?: { totalBets?: number | null; winRate?: number | null; netProfit?: number | null; roi?: number | null } | null
  patterns?: {
    peakBettingHours?: number[] | null; averageSessionDuration?: number; typicalStakeRange?: { min?: number | null; max?: number | null } | null
    bettingSidePreference?: string | null
    streakBehavior?: { chasingLosses?: boolean | null; stopAfterWin?: boolean | null; averageStreakLength?: number | null } | null
    marketPreferences?: { marketType: string; percentage?: number | null; totalBets?: number | null }[] | null
  } | null
  riskProfile?: {
    riskLevel?: string | null; suspiciousActivityCount?: number | null; lastReviewedAt?: string | null; notes?: string | null
    manualFlags?: string[] | null; patternFlags?: string[] | null
    patterns?: { id: string; patternType: BettingPatternType; severity: PatternSeverity; detectedAt?: string | null }[] | null
  } | null
  devices?: { ipAddress?: string | null; userAgent?: string | null; location?: string | null; country?: string | null; firstUsed?: string | null; lastUsed?: string | null; betCount?: number | null }[] | null
  relatedPlayers?: { userId: string; userName?: string | null; relationshipType?: string | null; confidence: number }[] | null
  /** creditLimit is a CREDIT agent's credit reference since the chips model (spec 2026-11-02 decision 9). */
  agentChain?: { agentId: string; agentName?: string | null; commissionRate?: number | null; creditLimit?: number | null }[] | null
  recentBets?: ProfileBet[] | null
}

/** Preserve the existing player intelligence side/stake/liability calculation, not a settlement recalculation. */
export function profileBetPnL(bet: ProfileBet): number {
  const status = String(bet.status || '').toLowerCase()
  const side = String(bet.side || '').toLowerCase()
  const stake = Number(bet.stake) || 0
  const liability = Number(bet.liability) || 0
  if (status === 'won') return side === 'back' ? liability : stake
  if (status === 'lost') return side === 'back' ? -stake : -liability
  return 0
}

export function riskTone(level?: string | null): StatusPillTone {
  switch (level?.toUpperCase()) {
    case 'HIGH': case 'CRITICAL': return 'neg'
    case 'MEDIUM': return 'warn'
    case 'LOW': return 'ok'
    default: return 'neutral'
  }
}

/** This intentionally operates only on the recent-bet snapshot already returned by the profile query. */
export function filterProfileBets(bets: readonly ProfileBet[], filter: { search: string; status: string; from: string; to: string }, calendarDate: (value: string) => string): ProfileBet[] {
  const needle = filter.search.trim().toLocaleLowerCase('en-US')
  return bets.filter(bet => {
    if (filter.status && String(bet.status || '').toLowerCase() !== filter.status) return false
    if (needle && ![bet.id, bet.marketId, bet.selectionId, bet.side, bet.status].some(value => String(value || '').toLocaleLowerCase('en-US').includes(needle))) return false
    if (filter.from || filter.to) {
      if (!bet.createdAt) return false
      const day = calendarDate(bet.createdAt)
      if (!day || (filter.from && day < filter.from) || (filter.to && day > filter.to)) return false
    }
    return true
  })
}

export function profileBetsCsv(bets: readonly ProfileBet[]): string {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return [
    ['Bet ID', 'Time', 'Market', 'Selection', 'Stake', 'Odds', 'Side', 'Status', 'P&L', 'Currency'],
    ...bets.map(bet => [bet.id, bet.createdAt, bet.marketId, bet.selectionId, bet.stake, bet.price, bet.side, bet.status,
      ['won', 'lost'].includes(String(bet.status || '').toLowerCase()) ? profileBetPnL(bet) : '', bet.currency]),
  ].map(row => row.map(escape).join(',')).join('\r\n')
}

export interface ProfitCalculation { side: 'back' | 'lay'; profit: string; loss: string; roi: string; totalReturn?: string; liability?: string }
/** The legacy local USD calculator's exact formulas and two-decimal display rounding. */
export function calculateProfit(side: 'back' | 'lay', stake: number, odds: number, commission: number): ProfitCalculation {
  const commissionRate = commission / 100
  if (side === 'back') {
    const profit = (stake * odds) - stake
    const netProfit = profit * (1 - commissionRate)
    return { side, profit: netProfit.toFixed(2), totalReturn: (stake + netProfit).toFixed(2), loss: stake.toFixed(2), roi: ((netProfit / stake) * 100).toFixed(2) }
  }
  const liability = stake * (odds - 1)
  const profit = stake * (1 - commissionRate)
  return { side, profit: profit.toFixed(2), liability: liability.toFixed(2), loss: liability.toFixed(2), roi: ((profit / liability) * 100).toFixed(2) }
}

export function fancyBookSummary(entries: readonly FancyBookEntry[], fullRange: boolean): FancyBookEntry[] {
  if (fullRange) return [...entries]
  const profitable = entries.filter(entry => entry.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 5)
  const losses = entries.filter(entry => entry.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 5)
  const breakEven = entries.filter(entry => entry.pnl === 0).slice(0, 1)
  return [...profitable, ...breakEven, ...losses].sort((a, b) => a.position - b.position)
}

/** Export the full raw book, not its summary or display-currency conversion. */
export function fancyBookCsv(entries: readonly FancyBookEntry[]): string {
  return ['Position,P/L', ...entries.map(entry => `${entry.position},${Number.isFinite(entry.pnl) ? entry.pnl.toFixed(2) : '0.00'}`)].join('\n')
}
