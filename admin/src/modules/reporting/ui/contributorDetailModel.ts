import type { DetailFilter } from './drillDownModel'

/**
 * The contributor detail page (a player's bets, or an agent's figures, in a drilled report selection)
 * replaced the Contributors card's drawer. Its URL carries the whole selection, so the page survives a
 * reload or a shared link: /reporting/<domain>/contributors/<kind>/<id>?name=…&context=…&f=<filter JSON>.
 * The filter travels as JSON so every field the report filtered on (drill ids, dates, currency, active
 * filters) keeps its value and its type, and the page's figures match the card's.
 */
export type ContributorDomain = 'sports' | 'casino'
export type ContributorKind = 'player' | 'agent'

/** A player row of the report's player breakdown. */
export interface ContributorPlayer {
  playerId: string
  playerUsername?: string
  directAgentId?: string
  directAgentName?: string
  totalStakes: number
  grossGamingRevenue: number
  betCount: number
  avgStake?: number
  winRate?: number
}

/** An agent row of the report's agent breakdown. */
export interface ContributorAgent {
  agentId: string
  agentName?: string
  totalStakes: number
  grossGamingRevenue: number
  netGgr: number
  commission: number
  playerCount: number
  betCount: number
}

export interface ContributorLink {
  /** the player's username or the agent's name, for the page title before its data loads */
  name: string
  /** the drilled path in words, e.g. "Cricket › Indian Premier League › RCB v CSK" */
  context?: string
  filter?: DetailFilter
}

type Scalar = string | number | boolean

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** The filter's plain fields, without the report's local refresh counter. */
function portableFilter(filter: DetailFilter | undefined): Record<string, Scalar> {
  const out: Record<string, Scalar> = {}
  for (const [key, value] of Object.entries(filter ?? {})) {
    if (key !== '_refreshKey' && isScalar(value) && value !== '') out[key] = value
  }
  return out
}

export function contributorDetailPath(domain: ContributorDomain, kind: ContributorKind, id: string, link: ContributorLink): string {
  const params = new URLSearchParams()
  params.set('name', link.name)
  if (link.context) params.set('context', link.context)
  const filter = portableFilter(link.filter)
  if (Object.keys(filter).length) params.set('f', JSON.stringify(filter))
  return `/reporting/${domain}/contributors/${kind}/${encodeURIComponent(id)}?${params.toString()}`
}

export interface ContributorSearch {
  name: string | null
  context: string | null
  filter: DetailFilter
}

/** Reads a contributor URL back; a damaged filter reads as no selection rather than throwing. */
export function parseContributorSearch(params: URLSearchParams): ContributorSearch {
  let filter: DetailFilter = {}
  const raw = params.get('f')
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) filter = portableFilter(parsed as DetailFilter) as DetailFilter
    } catch {
      filter = {}
    }
  }
  return { name: params.get('name'), context: params.get('context'), filter }
}

export function contributorDomainOf(pathname: string): ContributorDomain {
  return pathname.startsWith('/reporting/casino/') ? 'casino' : 'sports'
}

export function isContributorKind(value: string | undefined): value is ContributorKind {
  return value === 'player' || value === 'agent'
}
