import type { MatkaBet } from '@/lib/api/matka'
import type { getUserBets } from '@/lib/api/user'

export type SportsOpenBet = Awaited<ReturnType<typeof getUserBets>>['data'][number]
export type BetsTab = 'sports' | 'matka'
export type SportsMarketGroup = { key: string; eventId: string; eventName: string; marketName: string; bets: SportsOpenBet[] }
export type MatkaMarketGroup = { key: string; marketId: string; marketName: string; runDate: string; bets: MatkaBet[] }

export const isOpenSportsBet = (bet: SportsOpenBet) => ['matched', 'unmatched', 'pending', 'open'].includes((bet.status || '').toLowerCase())
export const isOpenMatkaBet = (bet: MatkaBet) => ['active', 'pending'].includes((bet.status || '').toLowerCase()) && !bet.settledAt

export function groupSportsMarkets(bets: SportsOpenBet[]): SportsMarketGroup[] {
  const groups = new Map<string, SportsMarketGroup>()
  for (const bet of bets.filter(isOpenSportsBet)) {
    // Names alone can collide across both events and markets.
    const key = JSON.stringify([bet.eventId, bet.marketId || [bet.marketType, bet.marketName || bet.market]])
    const group = groups.get(key) || { key, eventId: bet.eventId, eventName: bet.eventName || `Event ${bet.eventId}`, marketName: bet.marketName || bet.market || 'Market', bets: [] }
    group.bets.push(bet)
    groups.set(key, group)
  }
  return [...groups.values()]
}

export function groupMatkaMarkets(bets: MatkaBet[]): MatkaMarketGroup[] {
  const groups = new Map<string, MatkaMarketGroup>()
  for (const bet of bets.filter(isOpenMatkaBet)) {
    const key = JSON.stringify([bet.marketId, bet.runDate])
    const group = groups.get(key) || { key, marketId: bet.marketId, marketName: bet.marketName, runDate: bet.runDate, bets: [] }
    group.bets.push(bet)
    groups.set(key, group)
  }
  return [...groups.values()]
}

export function matkaGameLabel(bidType: string) {
  return ({ SINGLE: 'Single Digit', JODI: 'Jodi', SINGLE_PANNA: 'Single Pana', DOUBLE_PANNA: 'Double Pana', TRIPLE_PANNA: 'Triple Pana', HALF_SANGAM: 'Half Sangam', FULL_SANGAM: 'Full Sangam' } as Record<string, string>)[bidType] || bidType.replaceAll('_', ' ')
}
