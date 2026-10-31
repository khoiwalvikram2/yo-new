type Numeric = string | number | null | undefined
type SettledBet = {
  status: string
  result?: string | null
  pl?: Numeric
  side: string
  stake: Numeric
  price: Numeric
  liability?: Numeric
  oddsSize?: Numeric
  marketType?: string | null
}

export const OPEN_BET_STATUSES = ['matched', 'unmatched', 'pending', 'open'] as const

/** Settlement P/L and potential winnings are separate quantities. */
export function settledSportsBetProfit(bet: SettledBet): number | undefined {
  if ((OPEN_BET_STATUSES as readonly string[]).includes(bet.status.toLowerCase())) return undefined
  if (bet.pl != null && Number.isFinite(Number(bet.pl))) return Number(bet.pl)
  if (['void', 'cancelled'].includes(bet.status.toLowerCase())) return 0
  const stake = Number(bet.stake || 0), odds = Number(bet.price || 0)
  const fancy = bet.marketType?.toLowerCase() === 'fancy'
  const size = bet.oddsSize != null ? Number(bet.oddsSize) : 100
  const liability = bet.liability != null ? Number(bet.liability) : fancy ? stake * size / 100 : stake * (odds - 1)
  if (bet.status === 'won' || bet.result === 'won') return bet.side === 'lay' ? stake : fancy ? stake * size / 100 : stake * (odds - 1)
  if (bet.status === 'lost' || bet.result === 'lost') return bet.side === 'back' ? -stake : -liability
  return 0
}
