export type Market = {
  id: string
  sport: string
  competition: string
  event: string
  name: string
  eventId?: string
  state: 'open'|'suspended'|'void'|'settled'
  kind: 'exchange'|'bookmaker'|'fancy'
  liquidity?: number
  unmatchedOrders?: number
  cutoffAt: string
  tickSize: number
  createdBy: string
  updatedAt: string
  runners?: { id: string; name: string; sortOrder: number }[]
}

export type MarketParams = { state?: string; sport?: string; from?: string; to?: string; marketId?: string; whitelabelId?: string }

type CacheEntry<T> = { data: T; expiresAt: number }

const marketsCache: Map<string, CacheEntry<Market[]>> = new Map()
const TTL_MS = 5_000

function cacheKey(params: MarketParams): string {
  return JSON.stringify(params || {})
}

export async function fetchMarkets(params: MarketParams): Promise<Market[]> {
  const key = cacheKey(params)
  const cached = marketsCache.get(key)
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.data

  // TODO: Replace with real third-party API call + mapping
  const demoEvents: { id: string; sport: string; competition: string; name: string; startTime: string; status: 'upcoming'|'in_play'|'finished' }[] = [
    { id: 'evt-1001', sport: 'Cricket', competition: 'IPL', name: 'MI vs CSK', startTime: new Date(Date.now()+3600_000).toISOString(), status: 'in_play' },
    { id: 'evt-1002', sport: 'Football', competition: 'EPL', name: 'Arsenal vs Chelsea', startTime: new Date(Date.now()+7200_000).toISOString(), status: 'upcoming' },
    { id: 'evt-1003', sport: 'Tennis', competition: 'Wimbledon', name: 'Djokovic vs Nadal', startTime: new Date(Date.now()+1800_000).toISOString(), status: 'upcoming' },
  ]

  const demo: Market[] = [
    { 
      id: 'mkt-1001',
      sport: 'Cricket',
      competition: 'IPL',
      event: 'MI vs CSK',
      name: 'Match Odds',
      eventId: 'evt-1001',
      state: 'open',
      kind: 'exchange',
      liquidity: 250000, 
      unmatchedOrders: 120, 
      cutoffAt: new Date(Date.now()+3600_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-mi', name: 'MI', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-csk', name: 'CSK', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1002', 
      sport: 'Football', 
      competition: 'EPL', 
      event: 'Arsenal vs Chelsea',
      name: 'Match Winner',
      eventId: 'evt-1002',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 120000, 
      unmatchedOrders: 45, 
      cutoffAt: new Date(Date.now()+7200_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-home', name: 'Arsenal', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-away', name: 'Chelsea', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1003', 
      sport: 'Tennis', 
      competition: 'Wimbledon', 
      event: 'Djokovic vs Nadal',
      name: 'Total Games',
      eventId: 'evt-1003',
      state: 'open', 
      kind: 'fancy',
      liquidity: 80000, 
      unmatchedOrders: 10, 
      cutoffAt: new Date(Date.now()+1800_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
    },
    { 
      id: 'mkt-1004', 
      sport: 'Basketball', 
      competition: 'NBA', 
      event: 'Lakers vs Warriors',
      name: 'Match Winner',
      eventId: 'evt-1004',
      state: 'open', 
      kind: 'exchange',
      liquidity: 180000, 
      unmatchedOrders: 85, 
      cutoffAt: new Date(Date.now()+5400_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-lakers', name: 'Lakers', sortOrder: 1 },
        { id: 'sel-warriors', name: 'Warriors', sortOrder: 2 },
      ],
    },
    { 
      id: 'mkt-1005', 
      sport: 'Cricket', 
      competition: 'IPL', 
      event: 'RCB vs KKR',
      name: 'Match Odds',
      eventId: 'evt-1005',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 220000, 
      unmatchedOrders: 95, 
      cutoffAt: new Date(Date.now()+9000_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-rcb', name: 'RCB', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-kkr', name: 'KKR', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1006', 
      sport: 'Football', 
      competition: 'La Liga', 
      event: 'Real Madrid vs Barcelona',
      name: 'Match Winner',
      eventId: 'evt-1006',
      state: 'open', 
      kind: 'exchange',
      liquidity: 350000, 
      unmatchedOrders: 150, 
      cutoffAt: new Date(Date.now()+10800_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-rm', name: 'Real Madrid', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-barca', name: 'Barcelona', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1007', 
      sport: 'Horse Racing', 
      competition: 'Royal Ascot', 
      event: 'The Gold Cup',
      name: 'Race Winner',
      eventId: 'evt-1007',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 95000, 
      unmatchedOrders: 30, 
      cutoffAt: new Date(Date.now()+12600_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-horse1', name: 'Thunder Strike', sortOrder: 1 },
        { id: 'sel-horse2', name: 'Lightning Bolt', sortOrder: 2 },
        { id: 'sel-horse3', name: 'Storm Runner', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1008', 
      sport: 'Tennis', 
      competition: 'US Open', 
      event: 'Federer vs Murray',
      name: 'Match Winner',
      eventId: 'evt-1008',
      state: 'open', 
      kind: 'exchange',
      liquidity: 140000, 
      unmatchedOrders: 65, 
      cutoffAt: new Date(Date.now()+14400_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-federer', name: 'Federer', sortOrder: 1 },
        { id: 'sel-murray', name: 'Murray', sortOrder: 2 },
      ],
    },
    { 
      id: 'mkt-1009', 
      sport: 'Football', 
      competition: 'Champions League', 
      event: 'Manchester City vs Liverpool',
      name: 'Match Winner',
      eventId: 'evt-1009',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 280000, 
      unmatchedOrders: 110, 
      cutoffAt: new Date(Date.now()+16200_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-mcity', name: 'Man City', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-liverpool', name: 'Liverpool', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1010', 
      sport: 'Cricket', 
      competition: 'IPL', 
      event: 'DC vs SRH',
      name: 'Match Odds',
      eventId: 'evt-1010',
      state: 'open', 
      kind: 'fancy',
      liquidity: 195000, 
      unmatchedOrders: 75, 
      cutoffAt: new Date(Date.now()+18000_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
    },
    { 
      id: 'mkt-1011', 
      sport: 'Football', 
      competition: 'Serie A', 
      event: 'AC Milan vs Inter Milan',
      name: 'Match Winner',
      eventId: 'evt-1011',
      state: 'open', 
      kind: 'exchange',
      liquidity: 320000, 
      unmatchedOrders: 140, 
      cutoffAt: new Date(Date.now()+19800_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-milan', name: 'AC Milan', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-inter', name: 'Inter Milan', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1012', 
      sport: 'Basketball', 
      competition: 'NBA', 
      event: 'Celtics vs Heat',
      name: 'Match Winner',
      eventId: 'evt-1012',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 165000, 
      unmatchedOrders: 70, 
      cutoffAt: new Date(Date.now()+21600_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-celtics', name: 'Celtics', sortOrder: 1 },
        { id: 'sel-heat', name: 'Heat', sortOrder: 2 },
      ],
    },
    { 
      id: 'mkt-1013', 
      sport: 'Cricket', 
      competition: 'IPL', 
      event: 'PBKS vs GT',
      name: 'Match Odds',
      eventId: 'evt-1013',
      state: 'open', 
      kind: 'exchange',
      liquidity: 210000, 
      unmatchedOrders: 88, 
      cutoffAt: new Date(Date.now()+23400_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-pbks', name: 'PBKS', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-gt', name: 'GT', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1014', 
      sport: 'Tennis', 
      competition: 'French Open', 
      event: 'Alcaraz vs Sinner',
      name: 'Match Winner',
      eventId: 'evt-1014',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 175000, 
      unmatchedOrders: 55, 
      cutoffAt: new Date(Date.now()+25200_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-alcaraz', name: 'Alcaraz', sortOrder: 1 },
        { id: 'sel-sinner', name: 'Sinner', sortOrder: 2 },
      ],
    },
    { 
      id: 'mkt-1015', 
      sport: 'Football', 
      competition: 'Bundesliga', 
      event: 'Bayern Munich vs Dortmund',
      name: 'Match Winner',
      eventId: 'evt-1015',
      state: 'open', 
      kind: 'exchange',
      liquidity: 380000, 
      unmatchedOrders: 165, 
      cutoffAt: new Date(Date.now()+27000_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-bayern', name: 'Bayern Munich', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-dortmund', name: 'Dortmund', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1016', 
      sport: 'Horse Racing', 
      competition: 'Epsom Derby', 
      event: 'The Derby',
      name: 'Race Winner',
      eventId: 'evt-1016',
      state: 'open', 
      kind: 'fancy',
      liquidity: 125000, 
      unmatchedOrders: 40, 
      cutoffAt: new Date(Date.now()+28800_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
    },
    { 
      id: 'mkt-1017', 
      sport: 'Basketball', 
      competition: 'NBA', 
      event: 'Nuggets vs Suns',
      name: 'Match Winner',
      eventId: 'evt-1017',
      state: 'open', 
      kind: 'exchange',
      liquidity: 155000, 
      unmatchedOrders: 60, 
      cutoffAt: new Date(Date.now()+30600_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-nuggets', name: 'Nuggets', sortOrder: 1 },
        { id: 'sel-suns', name: 'Suns', sortOrder: 2 },
      ],
    },
    { 
      id: 'mkt-1018', 
      sport: 'Cricket', 
      competition: 'IPL', 
      event: 'LSG vs RR',
      name: 'Match Odds',
      eventId: 'evt-1018',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 230000, 
      unmatchedOrders: 100, 
      cutoffAt: new Date(Date.now()+32400_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-lsg', name: 'LSG', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-rr', name: 'RR', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1019', 
      sport: 'Football', 
      competition: 'Ligue 1', 
      event: 'PSG vs Marseille',
      name: 'Match Winner',
      eventId: 'evt-1019',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 290000, 
      unmatchedOrders: 125, 
      cutoffAt: new Date(Date.now()+34200_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-psg', name: 'PSG', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-marseille', name: 'Marseille', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1020', 
      sport: 'Tennis', 
      competition: 'Australian Open', 
      event: 'Medvedev vs Tsitsipas',
      name: 'Match Winner',
      eventId: 'evt-1020',
      state: 'open', 
      kind: 'exchange',
      liquidity: 160000, 
      unmatchedOrders: 50, 
      cutoffAt: new Date(Date.now()+36000_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-medvedev', name: 'Medvedev', sortOrder: 1 },
        { id: 'sel-tsitsipas', name: 'Tsitsipas', sortOrder: 2 },
      ],
    },
    { 
      id: 'mkt-1021', 
      sport: 'Golf', 
      competition: 'Masters', 
      event: 'The Masters Tournament',
      name: 'Tournament Winner',
      eventId: 'evt-1021',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 110000, 
      unmatchedOrders: 35, 
      cutoffAt: new Date(Date.now()+37800_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-golfer1', name: 'Tiger Woods', sortOrder: 1 },
        { id: 'sel-golfer2', name: 'Rory McIlroy', sortOrder: 2 },
        { id: 'sel-golfer3', name: 'Jon Rahm', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1022', 
      sport: 'Football', 
      competition: 'World Cup', 
      event: 'Brazil vs Argentina',
      name: 'Match Winner',
      eventId: 'evt-1022',
      state: 'open', 
      kind: 'exchange',
      liquidity: 450000, 
      unmatchedOrders: 200, 
      cutoffAt: new Date(Date.now()+39600_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-brazil', name: 'Brazil', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-argentina', name: 'Argentina', sortOrder: 3 },
      ],
    },
    { 
      id: 'mkt-1023', 
      sport: 'Cricket', 
      competition: 'IPL', 
      event: 'MI vs RR',
      name: 'Match Odds',
      eventId: 'evt-1023',
      state: 'open', 
      kind: 'fancy',
      liquidity: 270000, 
      unmatchedOrders: 115, 
      cutoffAt: new Date(Date.now()+41400_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
    },
    { 
      id: 'mkt-1024', 
      sport: 'Basketball', 
      competition: 'NBA', 
      event: 'Bucks vs 76ers',
      name: 'Match Winner',
      eventId: 'evt-1024',
      state: 'open', 
      kind: 'bookmaker',
      liquidity: 145000, 
      unmatchedOrders: 58, 
      cutoffAt: new Date(Date.now()+43200_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-bucks', name: 'Bucks', sortOrder: 1 },
        { id: 'sel-76ers', name: '76ers', sortOrder: 2 },
      ],
    },
    { 
      id: 'mkt-1025', 
      sport: 'Football', 
      competition: 'EPL', 
      event: 'Tottenham vs Newcastle',
      name: 'Match Winner',
      eventId: 'evt-1025',
      state: 'open', 
      kind: 'exchange',
      liquidity: 185000, 
      unmatchedOrders: 78, 
      cutoffAt: new Date(Date.now()+45000_000).toISOString(), 
      tickSize: 0.01, 
      createdBy: 'sys', 
      updatedAt: new Date().toISOString(),
      runners: [
        { id: 'sel-spurs', name: 'Tottenham', sortOrder: 1 },
        { id: 'sel-draw', name: 'Draw', sortOrder: 2 },
        { id: 'sel-newcastle', name: 'Newcastle', sortOrder: 3 },
      ],
    },
  ]

  const filtered = demo.filter(m => (
    (!params.marketId || m.id === params.marketId) &&
    (!params.sport || m.sport.toLowerCase() === params.sport.toLowerCase()) &&
    (!params.state || m.state === params.state)
  ))

  marketsCache.set(key, { data: filtered, expiresAt: now + TTL_MS })
  return filtered
}

export type SportsEvent = {
  id: string
  sport: string
  competition: string
  name: string
  startTime: string
  status?: 'upcoming'|'in_play'|'finished'|'suspended'
  marketCount: number
  matchedVolume?: number
  totalLiquidity?: number
  betsCount?: number
  inPlay: boolean
  updatedAt: string
  lastBetAt?: string | null
  eventCode?: string | null // External event ID for WebSocket subscription (fancy/bookmaker)
}

export type FetchEventsSummaryParams = {
  whitelabelId: string
  sport?: string
  from?: string
  to?: string
}

export async function fetchEventsSummary(params: FetchEventsSummaryParams): Promise<SportsEvent[]> {
  const { getRunningEvents } = await import('@src/repos/sports/sportsRepo.js')
  
  const events = await getRunningEvents({
    whitelabelId: params.whitelabelId,
    sport: params.sport,
    from: params.from,
    to: params.to,
  })

  // Map RunningEvent to SportsEvent format
  return events.map(e => ({
    id: e.id,
    sport: e.sport,
    competition: e.competition,
    name: e.name,
    startTime: e.startTime || new Date().toISOString(),
    status: e.status,
    marketCount: e.marketCount,
    matchedVolume: e.matchedVolume,
    totalLiquidity: e.totalLiquidity,
    betsCount: e.betsCount,
    inPlay: e.inPlay,
    updatedAt: e.updatedAt,
    lastBetAt: e.lastBetAt,
  }))
}

export type FetchEventDetailParams = {
  eventId: string
  whitelabelId: string
}

export async function fetchEventDetail(params: FetchEventDetailParams): Promise<{ event: SportsEvent, markets: Market[] }> {
  const { getEventDetail } = await import('@src/repos/sports/sportsRepo.js')
  
  const result = await getEventDetail(params.eventId, params.whitelabelId)
  
  if (!result) {
    // Return empty result if event not found
    const emptyEvent: SportsEvent = {
      id: params.eventId,
      sport: 'Unknown',
      competition: 'Unknown',
      name: 'Event Not Found',
      startTime: new Date().toISOString(),
      status: 'suspended',
      marketCount: 0,
      matchedVolume: 0,
      totalLiquidity: 0,
      betsCount: 0,
      inPlay: false,
      updatedAt: new Date().toISOString(),
    }
    return { event: emptyEvent, markets: [] }
  }

  // Map RunningEvent to SportsEvent
  const event: SportsEvent = {
    id: result.event.id,
    sport: result.event.sport,
    competition: result.event.competition,
    name: result.event.name,
    startTime: result.event.startTime || new Date().toISOString(),
    status: result.event.status,
    marketCount: result.event.marketCount,
    matchedVolume: result.event.matchedVolume,
    totalLiquidity: result.event.totalLiquidity,
    betsCount: result.event.betsCount,
    inPlay: result.event.inPlay,
    updatedAt: result.event.updatedAt,
    eventCode: result.event.eventCode || null, // External event ID for WebSocket subscription
  }

  // Map markets to Market format
  const markets: Market[] = result.markets.map(m => ({
    id: m.id,
    sport: result.event.sport,
    competition: result.event.competition,
    event: result.event.name,
    name: m.name,
    eventId: m.eventId,
    state: m.state,
    kind: m.kind,
    liquidity: m.liquidity,
    unmatchedOrders: m.unmatchedOrders,
    cutoffAt: m.cutoffAt,
    tickSize: m.tickSize,
    createdBy: m.createdBy,
    updatedAt: m.updatedAt,
    runners: m.runners,
    marketCode: (m as any).marketCode || null, // For WebSocket odds subscription
  }))

  return { event, markets }
}

// Provider-powered sports list for seeding
export type ProviderSport = { eventType: { id: string; name: string }; marketCount: number }

export async function fetchProviderSports(url: string): Promise<ProviderSport[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch sports: ${res.status}`)
  const data = await res.json()
  return data as ProviderSport[]
}

