import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Dices } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFeatureFlags } from '../../../hooks/useAppSettings'
import { useAuth } from '../../../lib/auth'
import { getThemeMode } from '../../../lib/theme'
import { getWhitelabelId } from '../../../lib/whitelabel'
import { getMatkaMarkets } from '../../../lib/api/matka'
import { asKitMarket, matkaFavoritesKey, orderMarketsForBoard, readMatkaFavorites } from '../../../features/matka/model'
import { DirectoryMarketCard } from '../../../features/matka/kit/MarketBoard.jsx'
import SectionHeader from './SectionHeader'
// The Matka page's card and the stylesheets it is drawn with (all scoped to .m99-kit / .gw-matka).
import '../../../features/matka/kit/ui-kit.css'
import '../../../features/matka/kit/compact.css'
import '../../../features/matka/matka.css'
import '../../../features/matka/kit/market-board-refresh.css'
import './matka-strip.css'

/** Cards the home strip shows; See All opens the full Matka page. */
const STRIP_SIZE = 12

/**
 * The home page's Matka strip (owner 2026-11-02): the Matka page's own market cards, in the page's order (the player's
 * favourites first, then by game time). The card's star, rules, charts and View market act as they do on the page;
 * a star set here moves the market to the front at once.
 */
function MatkaMarkets() {
  const { t } = useTranslation()
  const headingId = useId()
  const navigate = useNavigate()
  const { user, isAuthenticated, isHydrating } = useAuth()
  const tenant = getWhitelabelId()
  const owner = isAuthenticated ? `user:${user?.id ?? 'pending'}` : 'guest'
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['home', 'matka-markets', tenant, owner],
    queryFn: async () => {
      // Players are offered Worli markets only (owner 2026-11-01), the same as the Matka page. The whole list is read so
      // the strip can order it like the page (below); it then shows the first STRIP_SIZE.
      const response = await getMatkaMarkets({ kind: 'WORLI', page: 1, limit: 100 })
      if (response?.meta?.code !== 200 || !Array.isArray(response.data)) throw new Error('Invalid Matka catalogue')
      return response
    },
    enabled: !isHydrating && (!isAuthenticated || Boolean(user?.id)),
    staleTime: 5000, refetchInterval: 15000, refetchIntervalInBackground: false, retry: 1,
  })
  // Favourites live on this device under the Matka page's key; a star toggled here writes the same list.
  const favoritesKey = matkaFavoritesKey(tenant, isAuthenticated, user?.id)
  const [favoriteRead, setFavoriteRead] = useState(() => ({ key: favoritesKey, ids: readMatkaFavorites(favoritesKey) }))
  const favorites = favoriteRead.key === favoritesKey ? favoriteRead.ids : readMatkaFavorites(favoritesKey)
  const toggleFavorite = (id: string) => {
    const ids = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id]
    try { localStorage.setItem(favoritesKey, JSON.stringify(ids)) } catch { /* Kept for this visit only. */ }
    setFavoriteRead({ key: favoritesKey, ids })
  }
  // The card follows the app theme like the Matka page does.
  const [theme, setTheme] = useState(getThemeMode)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getThemeMode()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  const markets = orderMarketsForBoard(data?.data.filter(market => market.id && market.name) ?? [], favorites).slice(0, STRIP_SIZE)
  const goMarket = (market: { id: string; code?: string }) => navigate(`/matka/markets/${encodeURIComponent(market.code || market.id)}`)
  const goChart = (market: { id: string; code?: string }, type: string) => navigate(`/matka/markets/${encodeURIComponent(market.code || market.id)}/charts/${type}`)

  const track = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const syncEdges = useCallback(() => {
    const el = track.current
    if (el) setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 })
  }, [])
  useEffect(() => {
    syncEdges()
    window.addEventListener('resize', syncEdges)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncEdges)
    if (track.current) observer?.observe(track.current)
    return () => { window.removeEventListener('resize', syncEdges); observer?.disconnect() }
  }, [syncEdges, markets.length, isPending, isError])
  const step = (direction: 1 | -1) => {
    const el = track.current
    const width = el?.firstElementChild?.getBoundingClientRect().width
    if (el && width) el.scrollBy({ left: direction * (width + 12), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return <section className="nova-ex-matka" aria-labelledby={headingId} data-real-adapter="matka-strip">
    <SectionHeader icon={<Dices aria-hidden="true" />} title={t('homeMatka.title')} titleId={headingId} count={!isPending && !isError ? data?.meta.total ?? markets.length : undefined}>
      <Link to="/matka" className="nova-ex-section-all">{t('exchangeHome.seeAll', { defaultValue: 'See All' })}</Link>
      {!isPending && !isError && markets.length > 0 && !(edges.start && edges.end) && <span className="nova-ex-section-arrows">
        <button type="button" disabled={edges.start} aria-label={t('nova.scrollLeft')} onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></button>
        <button type="button" disabled={edges.end} aria-label={t('nova.scrollRight')} onClick={() => step(1)}><ChevronRight aria-hidden="true" /></button>
      </span>}
    </SectionHeader>
    {isPending ? <div className="nova-ex-matka-loading" role="status"><span className="sr-only">{t('homeMatka.loading')}</span><i /><i /><i /><i /></div>
      : isError ? <div className="nova-ex-matka-note" role="alert"><p>{t('homeMatka.error')}</p><button type="button" onClick={() => { void refetch() }}>{t('homeMatka.retry')}</button></div>
        : markets.length === 0 ? <p className="nova-ex-matka-note" role="status">{t('homeMatka.empty')}</p>
          : <div className="m99-kit gw-matka nova-ex-matka-board" data-theme={theme}>
            <ul className="nova-ex-matka-track" ref={track}>{markets.map((market, index) => <li key={market.id}>
              <DirectoryMarketCard market={asKitMarket(market)} index={index} favorite={favorites.includes(market.id)} onFavorite={toggleFavorite} onMarket={goMarket} onChart={goChart} />
            </li>)}</ul>
          </div>}
  </section>
}

export default function MatkaStrip() {
  const { matkaEnabled } = useFeatureFlags()
  return matkaEnabled ? <MatkaMarkets /> : null
}
