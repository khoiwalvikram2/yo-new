export interface Sport {
  key: string
  name: string
  subtitle: string
  icon: string
  colorClass: string
  selected: boolean
  status?: 'active' | 'inactive'
  sort?: number
}

export interface League {
  id: string
  key: string
  sportKey: string
  name: string
  selected: boolean
  alreadyAdded?: boolean
}

export interface Event {
  id: string
  key: string
  leagueKey: string
  sportKey: string
  name: string
  selected: boolean
  startTime?: string
  alreadyAdded?: boolean
}

export interface Runner {
  id: string
  name: string
  sortPriority?: number
}

export interface AutoConfigRow {
  id: string
  sportId: string
  leagueCodes?: string[] | null
  frequencyHours: number
  active: boolean
  lastRunAt?: string | null
  nextRunAt?: string | null
  lastRunStatus?: string | null
}

export interface AutoRunRow {
  id: string
  startedAt: string
  finishedAt?: string | null
  status: string
  leaguesAdded: number
  eventsAdded: number
  marketsAdded: number
  runnersAdded: number
  skippedEventsCount: number
}

export interface BuilderAuditRow {
  id: string
  actorId: string
  domain: string
  action: string
  resourceType: string
  resourceId: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  timestamp: string
}

export interface ProviderMarket {
  id: string
  name: string
  eventId: string
  startTime?: string
  runners: Runner[]
}

