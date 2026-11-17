import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Search, X, Loader2, Filter } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ProviderFilterDrawer from './ProviderFilterDrawer'
import LobbyTabs from './LobbyTabs'
import { ALL_TAB, type LobbyCategory } from './lobbyModel'
import LobbyTile from './LobbyTile'
import { scrollBehavior } from './lobbyScroll'
import type { CasinoCardItem } from '@/types'
import { getCasinoGames, getCasinoCategories, getCasinoProviders } from '@/lib/api/user'
import { useLocation, useNavigate } from 'react-router-dom'

type Props = {
  slotsOnly?: boolean
  selectedProviders?: string[]
  onProvidersChange?: (providers: string[]) => void
  /** The rows the lobby rendered, in order, with their totals; null until they have all loaded. */
  rowCategories: LobbyCategory[] | null
  /** Games in the whole lobby, for the "All" tab: undefined while it loads, null if it could not be read. */
  totalCount: number | null | undefined
}

/** The lobby's category tabs, search toolbar, provider filter and search results. */
export default function CasinoSearch({
  slotsOnly = false,
  selectedProviders = [],
  onProvidersChange,
  rowCategories,
  totalCount,
}: Props) {
  const { t } = useTranslation()
  const location = useLocation()
  // Start from the URL's `q`, so the URL-sync effect below does not strip a shared search link on mount.
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') || '')
  const [showResults, setShowResults] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const [results, setResults] = useState<CasinoCardItem[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRequestRef = useRef(0)
  const navigate = useNavigate()
  const [categories, setCategories] = useState<LobbyCategory[]>([])
  const [providerList, setProviderList] = useState<Array<{ name: string; slug: string | null }>>([])
  const [providerDrawerOpen, setProviderDrawerOpen] = useState(false)
  const [activeCategoryId, setActiveCategoryId] = useState<string>(ALL_TAB)

  const mapGame = useCallback((g: any): CasinoCardItem | null => {
    if (!g) return null
    const title = g?.title || g?.game_name || g?.name || g?.gameName || ''
    const provider = g?.provider_name || g?.provider || g?.vendorName || g?.vendor || 'Provider'
    const category = g?.category || g?.mainCategory || ''
    const imageUrl =
      g?.imageUrl ||
      g?.thumbnail ||
      g?.thumbnailUrl ||
      g?.image ||
      g?.game_images ||
      g?.gameImages ||
      g?.imageUrlThumb ||
      '/dice-bg.svg'
    const gameIdRaw = g?.gameId || g?.game_id || g?.id || g?.externalId || g?.gameID
    const gameId = gameIdRaw != null ? String(gameIdRaw) : ''
    if (!gameId) return null
    return { title: title || 'Game', provider, imageUrl, gameId, category }
  }, [])

  // Category icons (for rows that come without one) and the provider list for the filter.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [catRes, provRes] = await Promise.all([
          getCasinoCategories({ liveOnly: !slotsOnly, slotsOnly }),
          getCasinoProviders({ liveOnly: !slotsOnly }),
        ])
        if (cancelled) return
        const catData = (catRes as any)?.data ?? []
        const catItems: LobbyCategory[] = (Array.isArray(catData) ? catData : []).map((c: any) => {
          const name = String(c?.name ?? '').trim()
          return { id: name.toLowerCase().replace(/\s+/g, '-'), name, count: null, iconData: c?.iconData ?? null }
        }).filter((c: LobbyCategory) => c.id && c.name)
        setCategories(catItems)
        const provData = (provRes as any)?.data ?? []
        setProviderList(Array.isArray(provData) ? provData : [])
      } catch (_) {
        if (!cancelled) setCategories([])
      }
    })()
    return () => { cancelled = true }
  }, [slotsOnly])

  // Tabs: All, then the rows' list in row order. Until the rows and the total have both loaded the strip
  // shows placeholders, then every tab and count at once, so it never jumps while loading (owner 2026-11-01).
  const tabsLoading = rowCategories === null || totalCount === undefined
  const tabs = useMemo<LobbyCategory[]>(() => {
    const icons = new Map(categories.map((c) => [c.id, c.iconData]))
    const list = (rowCategories ?? []).map((row) => ({ ...row, iconData: row.iconData ?? icons.get(row.id) ?? null }))
    return [{ id: ALL_TAB, name: t('casinoLobby.all', { defaultValue: 'All' }), count: totalCount ?? null, iconData: null }, ...list]
  }, [categories, rowCategories, totalCount, t])

  // The rows' scrollspy moves the red tab; at the top of the page, or above the first row, it is "All".
  useEffect(() => {
    const atTop = () => {
      const first = tabs[1] ? document.getElementById(`cat-${tabs[1].id}`) : null
      return window.scrollY < 24 || Boolean(first && first.getBoundingClientRect().top > window.innerHeight * 0.4)
    }
    const handleCategoryInView = (event: Event) => {
      const catId = (event as CustomEvent<{ catId?: string }>).detail?.catId
      if (atTop()) setActiveCategoryId(ALL_TAB)
      else if (catId && tabs.some((tab) => tab.id === catId)) setActiveCategoryId(catId)
    }
    const handleScroll = () => {
      if (atTop()) setActiveCategoryId(ALL_TAB)
    }
    window.addEventListener('stakex:category-in-view', handleCategoryInView)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('stakex:category-in-view', handleCategoryInView)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [tabs])

  const selectTab = (id: string) => {
    setActiveCategoryId(id)
    if (id === ALL_TAB) window.scrollTo({ top: 0, behavior: scrollBehavior() })
    else document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }

  // Sync initial query from URL param `q`
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const q = params.get('q') || ''
    setQuery(q)
  }, [location.search])

  // Keep URL in sync when user types (without breaking back button)
  useEffect(() => {
    const q = query.trim()
    const params = new URLSearchParams(location.search)
    if (q) params.set('q', q)
    else params.delete('q')
    const newSearch = params.toString()
    const target = { pathname: location.pathname, search: newSearch ? `?${newSearch}` : '' }
    // Only push if different to avoid loops
    const isSame = `${location.pathname}${location.search}` === `${target.pathname}${target.search}`
    if (!isSame) navigate(target, { replace: true })
  }, [query])

  useEffect(() => {
    const q = query.trim()
    const requestId = ++searchRequestRef.current
    setShowResults(q.length > 0)
    if (!q) {
      setLoading(false)
      setSearchError(null)
      setResults([])
      setTotal(null)
      setPage(1)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true)
        setSearchError(null)
        const provs = selectedProviders.length > 0 ? selectedProviders : undefined
        const res = await getCasinoGames(slotsOnly ? { search: q, page: 1, limit: 12, slots: true, providers: provs } : { search: q, page: 1, limit: 12, liveOnly: true, providers: provs })
        if (requestId !== searchRequestRef.current) return
        const list: CasinoCardItem[] = Array.isArray(res?.data) ? (res.data.map(mapGame).filter(Boolean) as CasinoCardItem[]) : []
        setResults(list)
        const meta: any = (res as any)?.meta
        setTotal(typeof meta?.total === 'number' ? meta.total : null)
        setPage(1)
      } catch (_) {
        if (requestId !== searchRequestRef.current) return
        setResults([])
        setTotal(null)
        setPage(1)
        setSearchError('Search results could not be loaded. Please try again.')
      } finally {
        if (requestId === searchRequestRef.current) setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [mapGame, query, retryToken, selectedProviders, slotsOnly])

  const hasResults = results.length > 0
  const hasMoreResults = total !== null && total > results.length

  const handleLoadMore = async () => {
    if (!showResults || !hasMoreResults || loadingMore) return
    const q = query.trim()
    if (!q) return
    try {
      setLoadingMore(true)
      const nextPage = page + 1
      const provs = selectedProviders.length > 0 ? selectedProviders : undefined
      const res = await getCasinoGames(slotsOnly ? { search: q, page: nextPage, limit: 24, slots: true, providers: provs } : { search: q, page: nextPage, limit: 24, liveOnly: true, providers: provs })
      const list: CasinoCardItem[] = Array.isArray(res?.data) ? (res.data.map(mapGame).filter(Boolean) as CasinoCardItem[]) : []
      setResults(prev => [...prev, ...list])
      setPage(nextPage)
      const meta: any = (res as any)?.meta
      if (typeof meta?.total === 'number') setTotal(meta.total)
    } finally {
      setLoadingMore(false)
    }
  }

  const handleClear = () => {
    setQuery('')
    setShowResults(false)
    inputRef.current?.focus()
  }

  const providerCount = selectedProviders.length

  return (
    <>
      <LobbyTabs tabs={tabs} active={activeCategoryId} onSelect={selectTab} loading={tabsLoading} label={t('casinoLobby.categories', { defaultValue: 'Game categories' })} />

      <div className="nova-lobby-toolbar">
        <div className="nova-lobby-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={slotsOnly
              ? t('casinoLobby.searchSlots', { defaultValue: 'Search slots or providers…' })
              : t('casinoLobby.searchGames', { defaultValue: 'Search games or providers…' })}
            aria-label={t('common.search')}
            autoComplete="off"
          />
          {query.length > 0 && (
            <button type="button" className="nova-lobby-search-clear" aria-label={t('casinoLobby.clearSearch', { defaultValue: 'Clear search' })} onClick={handleClear}>
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        {onProvidersChange && (
          <button type="button" className="nova-lobby-providers-btn" onClick={() => setProviderDrawerOpen(open => !open)} disabled={providerList.length === 0} aria-haspopup="dialog" aria-expanded={providerDrawerOpen}>
            <Filter aria-hidden="true" />
            <span className="nova-lobby-providers-label">{t('casinoLobby.providers', { defaultValue: 'Providers' })}</span>
            {providerCount > 0 && <b>{providerCount}</b>}
          </button>
        )}
      </div>

      {onProvidersChange && providerCount > 0 && (
        <div className="nova-lobby-chips">
          <span>{t('casinoLobby.showingFrom', { defaultValue: 'Showing games from' })}</span>
          {selectedProviders.slice(0, 4).map((provider) => <span key={provider} className="nova-lobby-chip">{provider}</span>)}
          {providerCount > 4 && <span className="nova-lobby-chip">+{providerCount - 4}</span>}
          <button type="button" onClick={() => onProvidersChange([])}>{t('common.clear')}</button>
        </div>
      )}

      {showResults && (
        <section className="nova-lobby-section" aria-labelledby="nova-lobby-search-title" aria-busy={loading || undefined}>
          <header className="nova-ex-section-head">
            <Search className="nova-lobby-head-icon" aria-hidden="true" />
            <h2 id="nova-lobby-search-title">{t('casinoLobby.searchResults', { defaultValue: 'Search results' })}</h2>
            {!loading && !searchError && typeof total === 'number' && <span className="nova-ex-section-count">{total.toLocaleString()}</span>}
            <button type="button" className="nova-ex-section-all nova-lobby-toggle" onClick={handleClear}>{t('common.clear')}</button>
          </header>
          {loading ? (
            <div className="nova-lobby-grid" role="status" aria-label={t('casinoLobby.searching', { defaultValue: 'Searching games' })}>
              {Array.from({ length: 6 }, (_, index) => <span key={index} className="nova-ex-tile is-skeleton" aria-hidden="true" />)}
            </div>
          ) : searchError ? (
            <div className="nova-lobby-panel is-error" role="alert">
              <strong>{searchError}</strong>
              <button type="button" className="nova-lobby-btn is-primary" onClick={() => setRetryToken(value => value + 1)}>{t('nova.tryAgain')}</button>
            </div>
          ) : !hasResults ? (
            <div className="nova-lobby-panel">
              <strong>{t('casinoLobby.noResults', { defaultValue: 'No games found' })}</strong>
              <p>{t('casinoLobby.noResultsHint', { defaultValue: 'Try another name or provider, or browse the categories below.' })}</p>
            </div>
          ) : (
            <>
              <div className="nova-lobby-grid">
                {results.map((game, index) => <LobbyTile key={`${game.gameId ?? game.title}-${index}`} item={game} />)}
              </div>
              {hasMoreResults && (
                <div className="nova-lobby-foot">
                  <button type="button" className="nova-lobby-btn is-primary" onClick={handleLoadMore} disabled={loadingMore}>
                    {loadingMore && <Loader2 className="nova-lobby-spin" aria-hidden="true" />}
                    {loadingMore ? t('common.loading') : t('casinoLobby.moreResults', { defaultValue: 'View more results' })}
                    {!loadingMore && typeof total === 'number' && <small>{Math.max(0, total - results.length).toLocaleString()}</small>}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {onProvidersChange && (
        <ProviderFilterDrawer
          isOpen={providerDrawerOpen}
          onClose={() => setProviderDrawerOpen(false)}
          providers={providerList.map((p) => ({ name: p.name, slug: p.slug ?? '' }))}
          loading={false}
          selectedProviders={selectedProviders}
          onSelectProviders={onProvidersChange}
        />
      )}
    </>
  )
}
