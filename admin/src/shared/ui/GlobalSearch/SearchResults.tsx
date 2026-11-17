import React from 'react'
import type { CategorizedResults, SearchResult } from '@/hooks/useGlobalSearch'
import { SearchResultItem } from './SearchResultItem'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import { IconAlertTriangle } from '@tabler/icons-react'
import { EmptyState as KitEmptyState } from '@/ui/components/EmptyState'
import { ROUTES } from '@/shared/core/constants'
import styles from './GlobalSearch.module.css'

/**
 * Routes for "See all" per category; param is the query string. GlobalSearch navigates by this same table.
 * Each path is the list page itself: /players redirects to /players/search and the redirect dropped the query.
 * A category whose records no page lists by a typed term has no See all: VIP members (/vip opens the tier list),
 * referral codes (an exact code, one result at most) and bets (its one row is already the bet-list search).
 */
export const CATEGORY_SEE_ALL_ROUTES: Record<string, { path: string; param: string }> = {
  players: { path: ROUTES.PLAYERS_SEARCH, param: 'search' },
  agents: { path: '/agents', param: 'search' },
  whitelabels: { path: '/config/whitelabels', param: 'search' },
  casinoGames: { path: '/casino/management', param: 'search' },
  sports: { path: '/sports/events', param: 'search' },
  matkas: { path: '/matka/management', param: 'search' },
  bonuses: { path: '/bonuses', param: 'search' },
}

const AGENT_SCHEMES = new Set(['COMMISSION', 'SHARING', 'CREDIT'])

/**
 * The scheme the agents list should open on for these matches (B005). That list shows one scheme at a time (?type=,
 * else the last one used, else COMMISSION), so See all names the scheme the matched agents share, or the one most
 * of them have (the first to reach that count on a tie). Null when no match records a scheme.
 */
export function agentsSchemeOf(agents: SearchResult[]): string | null {
  const counts = new Map<string, number>()
  for (const agent of agents) {
    const scheme = agent.metadata?.schemeType
    if (scheme && AGENT_SCHEMES.has(scheme)) counts.set(scheme, (counts.get(scheme) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [scheme, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = scheme
  return best
}

/** Where a group's See all goes: its list page with the typed term, and for agents the scheme of the matches. */
export function seeAllPath(categoryKey: string, query: string, results?: Partial<CategorizedResults>): string | null {
  const route = CATEGORY_SEE_ALL_ROUTES[categoryKey]
  if (!route) return null
  const term = query.trim()
  const params = term ? [`${route.param}=${encodeURIComponent(term)}`] : []
  const scheme = categoryKey === 'agents' ? agentsSchemeOf(results?.agents ?? []) : null
  if (scheme) params.push(`type=${scheme}`)
  return params.length ? `${route.path}?${params.join('&')}` : route.path
}

interface SearchResultsProps {
  results: CategorizedResults
  allResults: SearchResult[]
  selectedIndex: number
  loading: boolean
  error: string | null
  query: string
  onSelect: (result: SearchResult) => void
  onParentChainClick?: (route: string) => void
  onSeeAll?: (categoryKey: keyof CategorizedResults, query: string) => void
  isAgent?: boolean
  idPrefix?: string
}

const ALL_CATEGORIES = [
  { key: 'pages' as const, label: 'Pages' },
  { key: 'players' as const, label: 'Players' },
  { key: 'agents' as const, label: 'Agents' },
  { key: 'whitelabels' as const, label: 'Whitelabels' },
  { key: 'casinoGames' as const, label: 'Casino Games' },
  { key: 'sports' as const, label: 'Sports' },
  { key: 'vipMembers' as const, label: 'VIP Members' },
  { key: 'matkas' as const, label: 'Matka' },
  { key: 'referralCodes' as const, label: 'Referrals' },
  { key: 'bonuses' as const, label: 'Bonuses' },
  // Last, after every real match (B006): the Bets group is only the "Search bets: <term>" shortcut. The order is
  // useGlobalSearch's allResults order, which keyboard selection and these groups' offsets share.
  { key: 'bets' as const, label: 'Bets' },
]

const AGENT_CATEGORY_KEYS = new Set(['pages', 'players', 'agents'])

export const SearchResults: React.FC<SearchResultsProps> = ({
  results, allResults, selectedIndex, loading, error, query, onSelect, onParentChainClick, onSeeAll, isAgent, idPrefix = 'global-search',
}) => {
  const categories = isAgent
    ? ALL_CATEGORIES.filter((cat) => AGENT_CATEGORY_KEYS.has(cat.key))
    : ALL_CATEGORIES

  const pagesCategory = categories.find((cat) => cat.key === 'pages')
  const entityCategories = categories.filter((cat) => cat.key !== 'pages')
  const showPages = pagesCategory !== undefined && results.pages.length > 0
  // allResults is [...pages, ...entities] (useGlobalSearch, T50), so this is the entity count alone.
  const entityResultCount = allResults.length - results.pages.length

  let idx = results.pages.length
  const offsets: Record<string, number> = {}
  entityCategories.forEach((cat) => {
    if (results[cat.key].length > 0) {
      offsets[cat.key] = idx
      idx += results[cat.key].length
    }
  })

  const renderCategory = (
    cat: { key: keyof CategorizedResults; label: string },
    items: SearchResult[],
    offset: number
  ) => (
    <section key={cat.key} className={styles.category} aria-label={cat.label}>
      <div className={styles.categoryHead}>
        <span className={styles.categoryLabel}>
          {cat.label}
        </span>
        <span className={styles.count}>
          {items.length}
        </span>
        {onSeeAll && CATEGORY_SEE_ALL_ROUTES[cat.key] && (
          <button
            type="button"
            className={styles.seeAll}
            aria-label={'See all ' + cat.label}
            onClick={() => onSeeAll(cat.key, query)}
          >
            See all
          </button>
        )}
      </div>
      <div className={styles.resultList}>
        {items.map((result, i) => (
          <SearchResultItem
            key={`${result.type}-${result.id}-${i}`}
            id={`${idPrefix}-option-${offset + i}`}
            result={result}
            isSelected={offset + i === selectedIndex}
            onClick={() => onSelect(result)}
            onParentChainClick={onParentChainClick}
          />
        ))}
      </div>
    </section>
  )

  let entityBody: React.ReactNode = null
  if (loading) {
    entityBody = <LoadingState />
  } else if (error) {
    entityBody = (
      <div role="alert"><KitEmptyState icon={<IconAlertTriangle size={24} />} title="Search failed" description={error} /></div>
    )
  } else if (entityResultCount <= 0) {
    entityBody = showPages ? null : <EmptyState query={query} />
  } else {
    entityBody = entityCategories.map((cat) => {
      const items = results[cat.key]
      if (items.length === 0) return null
      return renderCategory(cat, items, offsets[cat.key] ?? 0)
    })
  }

  return (
    <div id={`${idPrefix}-results`} role="listbox" aria-label="Search results" className={styles.results}>
      {showPages && pagesCategory && renderCategory(pagesCategory, results.pages, 0)}
      {entityBody}
    </div>
  )
}
