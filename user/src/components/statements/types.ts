export type WalletTxn = {
  id: string
  dateISO: string
  type: string
  amount: number
  direction?: 'credit' | 'debit' | 'neutral'
  status: 'Success' | 'Pending' | 'Failed' | 'Processing'
  description?: string | null
  bonusCampaignName?: string | null
  bonusCampaignType?: string | null
}

export type Bet = {
  id: string
  dateISO: string
  title: string
  market: string
  stake: number
  odds?: number
  /** Outcome / lifecycle for statements Status column */
  result:
    | 'Win'
    | 'Lose'
    | 'Pending'
    | 'Void'
    | 'Matched'
    | 'Unmatched'
    | 'Settled'
    | 'Cancelled'
  payout: number
  side?: string | null
  oddsSize?: number | null
  marketType?: string | null
  walletType?: string | null
  /** Runner/selection name for sports bets */
  selection?: string | null
  /** Liability amount for sports bets */
  liability?: number | null
  /** Declared event/market result (e.g. winning runner, fancy result) for sports */
  eventResult?: string | null
}

export type MatkaStatement = {
  id: string; dateISO: string; market: string; runDate: string; session: string; bidType: string; selection: string
  stake: number; multiplier: number; payout: number | null; pl: number | null; result: Bet['result']; eventResult: string | null
  walletType: string; currency: string; settledAt: string | null
}

export type TabKey = 'wallet' | 'sports' | 'casino' | 'matka'


