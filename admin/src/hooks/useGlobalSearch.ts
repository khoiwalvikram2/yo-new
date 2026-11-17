import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLazyQuery } from '@apollo/client'
import { GLOBAL_SEARCH_QUERY } from '@/lib/graphql/globalSearch'
import type { GlobalSearchResult, ParentChainItem } from '@/lib/graphql/globalSearch'
import { useAuthStore } from '@/shared/core/authStore'

export interface SearchResultParentChainItem {
  id: string
  username: string
  levelIndex: number | null
  route: string
}

export interface SearchResult {
  type: 'player' | 'agent' | 'whitelabel' | 'casinoGame' | 'sport' | 'league' | 'event' | 'vipMember' | 'matka' | 'referralCode' | 'bet' | 'bonus' | 'page'
  id: string
  label: string
  subtitle?: string
  route: string
  icon: string
  metadata?: {
    userId?: string
    amount?: number
    currency?: string
    status?: string
    referralCode?: string
    referrerId?: string
    /** An agent's scheme (COMMISSION, SHARING, CREDIT): the agents list shows one scheme at a time. */
    schemeType?: string
  }
  parentChain?: SearchResultParentChainItem[] | null
}

function iconForType(type: string): string {
  switch (type) {
    case 'player': return 'fa-user'
    case 'agent': return 'fa-users'
    case 'whitelabel': return 'fa-globe'
    case 'casinoGame': return 'fa-gamepad'
    case 'sport':
    case 'league':
    case 'event': return 'fa-trophy'
    case 'vipMember': return 'fa-crown'
    case 'matka': return 'fa-ticket'
    case 'referralCode': return 'fa-link'
    case 'bet': return 'fa-receipt'
    case 'bonus': return 'fa-gift'
    default: return 'fa-circle'
  }
}

function mapItem(item: { id: string; type: string; label: string; subtitle: string | null; route: string; status: string | null; metadata: Record<string, unknown> | null; parentChain?: ParentChainItem[] | null }): SearchResult {
  const type = item.type as SearchResult['type']
  return {
    type: type ?? 'player',
    id: item.id,
    label: item.label,
    subtitle: item.subtitle ?? undefined,
    route: item.route,
    icon: iconForType(item.type),
    metadata: item.metadata ? { ...item.metadata } as SearchResult['metadata'] : undefined,
    parentChain: item.parentChain ?? null,
  }
}

export interface CategorizedResults {
  /** GlobalSearch Pages group (decision 10): client-side page matches, first here and first in allResults */
  pages: SearchResult[]
  players: SearchResult[]
  agents: SearchResult[]
  whitelabels: SearchResult[]
  casinoGames: SearchResult[]
  sports: SearchResult[]
  vipMembers: SearchResult[]
  matkas: SearchResult[]
  referralCodes: SearchResult[]
  bets: SearchResult[]
  bonuses: SearchResult[]
}

const IP_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

const RECENT_SEARCHES_KEY = 'gd-global-search-recent'
const RECENT_MAX = 10

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

function saveRecentSearches(list: string[]) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, RECENT_MAX)))
  } catch {
    // ignore
  }
}

/** Must match globalSearchRepo `want('players'|'agents')` keys, not GraphQL result item `type`. */
const AGENT_SEARCH_CATEGORIES = ['players', 'agents']

/**
 * `matchPageResults` returns the Pages group for a query (usePageMatcher). It must be referentially stable,
 * because the pages, results and allResults memos depend on it. Without it, pages is always empty.
 */
export function useGlobalSearch(isOpen = false, matchPageResults?: (query: string) => SearchResult[]) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches)
  const isAgent = useAuthStore((s) => s.isAgent())

  const [search, { data, loading, error }] = useLazyQuery<GlobalSearchResult>(GLOBAL_SEARCH_QUERY, {
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  // Stable ref for the Apollo search function so it never resets the debounce timer
  const searchRef = useRef(search)
  useEffect(() => { searchRef.current = search }, [search])

  const addToRecent = useCallback((q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter((x) => x !== trimmed)].slice(0, RECENT_MAX)
      saveRecentSearches(next)
      return next
    })
  }, [])

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([])
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY)
    } catch {
      // ignore
    }
  }, [])

  // Debounce search — uses ref for `search` so the timer is only reset by real input changes
  useEffect(() => {
    if (!isOpen) {
      return
    }

    const trimmedQuery = query.trim()
    const isIP = IP_REGEX.test(trimmedQuery)
    const minLength = isIP ? 1 : 2

    if (trimmedQuery.length < minLength) {
      return
    }

    const timeoutId = setTimeout(() => {
      const categories = isAgent
        ? AGENT_SEARCH_CATEGORIES
        : categoryFilter ? [categoryFilter] : undefined
      searchRef.current({
        variables: {
          query: trimmedQuery,
          limit: 10,
          categories,
        },
      }).catch(() => {})
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [query, isOpen, categoryFilter, isAgent])

  // Pages group (decision 10): client-side page matches. They do not depend on the entity query's threshold,
  // loading or error state; matchPages applies its own 2-character threshold. The caller memoises
  // matchPageResults, so this reruns only when the query or the visible navigation changes.
  const pages = useMemo(
    () => (matchPageResults ? matchPageResults(query) : []),
    [matchPageResults, query],
  )

  // Format results into categorized structure (unified API returns SearchResultItem[] per category)
  const results = useMemo<CategorizedResults>(() => {
    const trimmedQuery = query.trim()
    const isIP = IP_REGEX.test(trimmedQuery)
    const minLength = isIP ? 1 : 2
    // Avoid stale results when query is below threshold (UI shows categories / "keep typing")
    if (trimmedQuery.length < minLength) {
      return {
        pages,
        players: [],
        agents: [],
        whitelabels: [],
        casinoGames: [],
        sports: [],
        vipMembers: [],
        matkas: [],
        referralCodes: [],
        bets: [],
        bonuses: [],
      }
    }

    if (!data?.globalSearch) {
      return {
        pages,
        players: [],
        agents: [],
        whitelabels: [],
        casinoGames: [],
        sports: [],
        vipMembers: [],
        matkas: [],
        referralCodes: [],
        bets: [],
        bonuses: [],
      }
    }

    const g = data.globalSearch
    return {
      pages,
      players: (g.players || []).map(mapItem),
      agents: (g.agents || []).map(mapItem),
      whitelabels: (g.whitelabels || []).map(mapItem),
      casinoGames: (g.casinoGames || []).map(mapItem),
      sports: (g.sports || []).map(mapItem),
      vipMembers: (g.vipMembers || []).map(mapItem),
      matkas: (g.matkas || []).map(mapItem),
      referralCodes: (g.referralCodes || []).map(mapItem),
      bets: (g.bets || []).map(mapItem),
      bonuses: (g.bonuses || []).map(mapItem),
    }
  }, [data, query, pages])

  // Flatten results for keyboard navigation
  // Page matches come first in both branches, so SearchResults' group offsets start after them. Bets come last
  // (B006): that group is only the generic "Search bets: <term>" shortcut, never a match, and listed above the
  // Bonuses it was the default selection, so Enter on a campaign's name opened an empty bet list. SearchResults
  // renders the groups in this same order.
  const allResults = useMemo(() => {
    if (isAgent) {
      return [
        ...results.pages,
        ...results.players,
        ...results.agents,
      ]
    }
    return [
      ...results.pages,
      ...results.players,
      ...results.agents,
      ...results.whitelabels,
      ...results.casinoGames,
      ...results.sports,
      ...results.vipMembers,
      ...results.matkas,
      ...results.referralCodes,
      ...results.bonuses,
      ...results.bets,
    ]
  }, [results, isAgent])

  // Reset selected index when query changes or results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query, allResults.length])

  // Clamp selected index to valid range (prevent infinite loops)
  useEffect(() => {
    if (allResults.length === 0) {
      if (selectedIndex !== 0) {
        setSelectedIndex(0)
      }
      return
    }
    
    // Only update if index is actually out of bounds
    // Use functional update to prevent unnecessary re-renders
    if (selectedIndex < 0) {
      setSelectedIndex(0)
    } else if (selectedIndex >= allResults.length) {
      const maxIndex = Math.max(0, allResults.length - 1)
      if (selectedIndex !== maxIndex) {
        setSelectedIndex(maxIndex)
      }
    }
  }, [selectedIndex, allResults.length])

  const navigateUp = useCallback(() => {
    if (allResults.length === 0) return
    setSelectedIndex((prev) => Math.max(0, prev - 1))
  }, [allResults.length])

  const navigateDown = useCallback(() => {
    if (allResults.length === 0) return
    setSelectedIndex((prev) => Math.min(allResults.length - 1, prev + 1))
  }, [allResults.length])

  const selectResult = useCallback(
    (index?: number) => {
      const targetIndex = index !== undefined ? index : selectedIndex
      // Bounds check to prevent array index out of bounds
      if (targetIndex < 0 || targetIndex >= allResults.length) {
        return null
      }
      const result = allResults[targetIndex]
      if (result) {
        return result
      }
      return null
    },
    [allResults, selectedIndex]
  )

  const reset = useCallback(() => {
    setQuery('')
    setSelectedIndex(0)
    // Note: We don't clear the Apollo cache as it's useful for quick re-searches
    // The data will be replaced when a new search is performed
    // The loading state will be handled by the query itself
  }, [])

  return {
    query,
    setQuery,
    results,
    allResults,
    loading,
    error: error?.message || null,
    selectedIndex,
    setSelectedIndex,
    navigateUp,
    navigateDown,
    selectResult,
    reset,
    categoryFilter,
    setCategoryFilter,
    recentSearches,
    addToRecent,
    clearRecentSearches,
  }
}

