// Types for the sports event data
export interface TeamInfo {
  name: string
  logo?: string
  score?: number
  color?: string
}

export interface MatchOdds {
  selection: string
  back: number
  lay: number
  volume?: number
  selectionId?: number
  fancyData?: {
    bs1?: string
    ls1?: string
    status1?: string
    odd_type?: string
    id?: string
  }
}

export interface Market {
  id: string
  name: string
  type: 'match-odds' | 'bookmaker' | 'fancy'
  status: 'active' | 'suspended' | 'closed'
  odds: MatchOdds[]
  // External identifiers from IBF backend (non-UI, used for betting/odds streams)
  marketCode?: string // e.g. Betfair marketId
  marketType?: 'exchange' | 'bookmaker' | 'fancy'
}

export interface Bet {
  id: string
  selection: string
  odds: number
  stake: number
  type: 'back' | 'lay'
  pl?: number
  market?: string
  marketId?: string
  eventId?: string
}

export interface EventDetails {
  id: string
  homeTeam: TeamInfo
  awayTeam: TeamInfo
  league: string
  venue: string
  startTime: string
  status: 'upcoming' | 'live' | 'completed'
  timeRemaining?: string
  markets: Market[]
  sportName?: string
  // Additional fields for betting
  sportId?: string | number
  leagueId?: string | number
  eventId?: string
  // External provider event code used by fancy/bookmaker channels
  eventCode?: string | number
}

// Raw IBF shapes (source-of-truth from ibf-goa-user). These are adapted to the
// UI-facing EventDetails/Market structures above without changing UI components.
export interface IbfRunner {
  selectionId: number
  runnerName: string
  sortPriority?: number
}

export interface IbfMarket {
  marketName: string
  _id: string
  marketId: string // external market code (e.g. betfair)
  type: 'bookmaker' | 'BOOKMAKER' | 'exchange' | 'EXCHANGE' | string
  runners: IbfRunner[]
}

export interface IbfEventDetailsRaw {
  _id: string
  id: string
  name: string // e.g. "Team A v Team B"
  sportId: string | number
  sportName: string
  sportCode?: string | number
  leagueId: string | number
  leagueName: string
  eventDate: string
  markets: IbfMarket[]
}

export type IbfToUiEventAdapter = (raw: IbfEventDetailsRaw) => EventDetails

export interface BetSlipData {
  team: string
  odds: number
  type: 'back' | 'lay'
  market: string
  teamIndex: number
  stake?: number
  potential?: number
  buttonElement?: HTMLElement
  buttonId?: string
  inline?: boolean
  // Additional fields for betting
  marketId?: string
  selectionId?: string | number
  marketType?: 'exchange' | 'bookmaker' | 'fancy'
  odds_size?: number
  oddsSize?: number // For fancy bets: price size (e.g., 100 means 100%)
  marketCode?: string
  // Live odds for both back and lay
  backOdds?: number
  layOdds?: number
  // Fancy status (for validation)
  fancyStatus?: string
  // Cashout mode
  isCashout?: boolean
  cashoutMarketId?: string
  /** Unique id per odds-click open; used to force fresh slip reset when re-opening */
  openId?: number
}
