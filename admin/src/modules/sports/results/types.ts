export interface SportsResult {
  id: string
  tenant?: string
  whitelabelId: string
  isGlobal?: boolean
  sportId: string
  leagueId: string
  eventId: string
  marketId: string
  marketType: 'exchange' | 'bookmaker' | 'fancy'
  runnerId?: string | null
  selectionName?: string | null
  result?: string | null
  declaredBy: string
  declaredByName?: string | null
  declaredAt: string
  rolledBackAt?: string | null
  rolledBackBy?: string | null
  rolledBackByName?: string | null
  rollbackReason?: string | null
  rollbackTag?: string | null
  createdAt: string
  // Resolved fields
  sport?: {
    id: string
    name: string
    sportCode: string
  } | null
  league?: {
    id: string
    name: string
  } | null
  event?: {
    id: string
    name: string
    startTime?: string | null
  } | null
  market?: {
    id: string
    name: string
    type: string
  } | null
  runner?: {
    id: string
    name: string
  } | null
}

export interface SportsResultFilters {
  sportId?: string
  leagueId?: string
  eventId?: string
  marketId?: string
  marketType?: 'exchange' | 'bookmaker' | 'fancy'
  dateFrom?: string
  dateTo?: string
  search?: string
  rolledBack?: boolean
  page?: number
  limit?: number
  sort?: string
}

