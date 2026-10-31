import type { Bet } from './types'

/** The player's bets on this event. The side column's count and its table both use it, so they agree. */
export function betsForEvent(bets: Bet[], eventId: string): Bet[] {
  const targetEventId = String(eventId || '')
  return bets.filter((bet: any) => String(bet.eventId || bet.event || '') === targetEventId)
}
