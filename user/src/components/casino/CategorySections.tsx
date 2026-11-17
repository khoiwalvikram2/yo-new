import { Flame } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CasinoCardItem } from "@/types";
import CategorySlider from "./CategorySlider";
import CategoryHeaderControls from "./CategoryHeaderControls";
import LobbyTile from "./LobbyTile";
import { categoryIconSrc, type LobbyCategory } from "./lobbyModel";
import { scrollBehavior } from "./lobbyScroll";
import { getCasinoCategories, getCasinoGames, getCasinoSummary } from '@/lib/api/user'
import { useLocation } from 'react-router-dom'
import { mapConcurrent } from '@/lib/mapConcurrent'

type TopItem = { title: string; provider: string; imageUrl?: string; gameId?: string; badge?: "HOT" | "NEW"; category?: string };

type Props = {
  slotsOnly?: boolean
  providers?: string[]
  /** The rows actually rendered (ids, names, totals) in order, for the tab strip above them; null while they load. */
  onCategoriesChange?: (rows: LobbyCategory[] | null) => void
  /** Offered when the provider filter leaves no games. */
  onClearProviders?: () => void
}
export default function CategorySections({ slotsOnly = false, providers, onCategoriesChange, onClearProviders }: Props) {
  const { t } = useTranslation()

  type Category = { id: string; name: string; subtitle?: string | null; items: TopItem[]; totalCount?: number; filterCategory?: string; type?: string; order?: number | null; iconData?: string | null };
  const [expanded, setExpanded] = useState<string | null>(null);
  const location = useLocation()
  const [reloadToken, setReloadToken] = useState(0)
  const scope = JSON.stringify([slotsOnly, [...(providers || [])].sort(), reloadToken])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const [displayScope, setDisplayScope] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [visibleByCat, setVisibleByCat] = useState<Record<string, number>>({})
  const [pageByCat, setPageByCat] = useState<Record<string, number>>({})
  const [hasMoreByCat, setHasMoreByCat] = useState<Record<string, boolean>>({})
  const [cursorByCat, setCursorByCat] = useState<Record<string, string | null>>({})
  const [, setTotalByCat] = useState<Record<string, number>>({})
  // Whether the whole load has finished (every row, not just the first), for the tab strip report below.
  const [settled, setSettled] = useState(false)
  const handledCatRef = useRef<string | null>(null)
  // sentinel handled via DOM query per expanded section

  const mapGame = useCallback((g: any): TopItem | null => {
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
    return {
      title: title || 'Game',
      provider,
      imageUrl,
      gameId,
      category,
    }
  }, [])

  const mapGames = useCallback(
    (data: any): TopItem[] => {
      const items: any[] = Array.isArray(data) ? data : []
      return items.map(mapGame).filter(Boolean) as TopItem[]
    },
    [mapGame]
  )

  const normalizeCat = (c: any) => String(c ?? '').trim()

  const categoryPriority = useCallback((name: string) => {
    const n = normalizeCat(name).toLowerCase()
    if (n.includes('featured')) return 0
    if (n.includes('top')) return 1
    return 2
  }, [])

  useEffect(() => {
    let cancelled = false
    const current = () => !cancelled && currentScope.current === scope
    const publish = (seeded: Category[], names: string[], visible: Record<string, number>, pages: Record<string, number>, more: Record<string, boolean>, cursors: Record<string, string | null>, totals: Record<string, number>) => {
      if (!current()) return
      setCategories([...seeded].sort((a, b) => names.indexOf(a.filterCategory || a.name) - names.indexOf(b.filterCategory || b.name)))
      setVisibleByCat({ ...visible }); setPageByCat({ ...pages }); setHasMoreByCat({ ...more }); setCursorByCat({ ...cursors }); setTotalByCat({ ...totals })
      setDisplayScope(scope)
      if (seeded.length) setLoading(false)
    }
    const load = async () => {
      setLoading(true)
      setLoadError(null)
      setCategories([])
      setSettled(false)
      try {
        if (slotsOnly) {
          // Slots-only: fetch categories from API (admin-managed), hydrate each with first page
          const catsRes = await getCasinoCategories({ slotsOnly: true })
          const catData = Array.isArray(catsRes?.data) ? catsRes.data : []
          const catTypeMap = new Map<string, string>()
          const catSubtitleMap = new Map<string, string | null>()
          const catOrderMap = new Map<string, number | null>()
          const catIconMap = new Map<string, string | null>()
          const catNames = Array.from(
            new Set(
              catData.map((c: any) => {
                const name = typeof c === 'string' ? c : c?.name
                const key = normalizeCat(name)
                if (!key) return null
                const typeVal = typeof c === 'string' ? '' : (c?.type || '')
                const subVal = typeof c === 'string' ? null : (c?.subtitle ?? null)
                const orderVal = typeof c === 'string' ? null : (c?.order ?? null)
                const iconVal = typeof c === 'string' ? null : (c?.iconData ?? null)
                catTypeMap.set(key, typeVal)
                catSubtitleMap.set(key, subVal)
                catOrderMap.set(key, orderVal)
                catIconMap.set(key, iconVal)
                return key
              }).filter(Boolean) as string[]
            )
          ).filter(Boolean)
            .sort((a, b) => {
              const orderA = catOrderMap.get(a) ?? 9999
              const orderB = catOrderMap.get(b) ?? 9999
              if (orderA !== orderB) return (orderA ?? 9999) - (orderB ?? 9999)
              return categoryPriority(a) - categoryPriority(b)
            })

          const seeded: Category[] = []
          const nextVisible: Record<string, number> = {}
          const nextPage: Record<string, number> = {}
          const nextHasMore: Record<string, boolean> = {}
          const nextCursor: Record<string, string | null> = {}
          const nextTotal: Record<string, number> = {}

          let failedCategories = 0
          await mapConcurrent(catNames, 3, async (rawCat) => {
            if (!current()) return
            try {
              const cat = normalizeCat(rawCat)
              if (!cat) return
              const res = await getCasinoGames({ category: cat, page: 1, limit: 48, providers: providers || undefined })
              if (!current()) return
              const mapped: TopItem[] = mapGames((res as any)?.data)
              // Only keep slot categories
              if (mapped.length === 0 || mapped.every((m) => (m.category || '').toLowerCase() !== 'slots')) return

              const id = cat.toLowerCase().replace(/\s+/g, '-')
              const total = Number((res as any)?.meta?.total ?? mapped.length)
              const page = Number((res as any)?.meta?.page ?? 1)
              const hasMore = Boolean((res as any)?.meta?.hasMore ?? (mapped.length < total))
              const catType = (catTypeMap.get(cat) || '').toLowerCase()
              const catSubtitle = catSubtitleMap.get(cat) ?? null
              const catOrder = catOrderMap.get(cat) ?? null
              const catIcon = catIconMap.get(cat) ?? null

              seeded.push({ id, name: cat, subtitle: catSubtitle, filterCategory: cat, totalCount: total, items: mapped, type: catType, order: catOrder, iconData: catIcon })
              nextVisible[id] = mapped.length
              nextPage[id] = page
              nextHasMore[id] = hasMore
              nextCursor[id] = (res as any)?.meta?.cursor ?? null
              nextTotal[id] = total
              publish(seeded, catNames, nextVisible, nextPage, nextHasMore, nextCursor, nextTotal)
            } catch (_) { failedCategories++ }
          })
          if (!current()) return
          if (!seeded.length && failedCategories === catNames.length && catNames.length) throw new Error('Category reads failed')

          // Fallback to summary grouping if no categories returned games
          if (seeded.length === 0) {
            const summary = await getCasinoSummary({ limit: 120, sort: 'popularity', slots: true, providers: providers || undefined })
            const data = Array.isArray(summary?.data) ? summary.data : []
            const grouped = new Map<string, TopItem[]>()
            data.forEach((g: any) => {
              const cat = (g?.category || g?.mainCategory || 'slots').toString()
              const item = mapGame(g)
              if (!item) return
              if (!grouped.has(cat)) grouped.set(cat, [])
              grouped.get(cat)!.push(item)
            })
            if (grouped.size === 0) {
              const res = await getCasinoGames({ slots: true, page: 1, limit: 48, sort: 'popularity' as any, providers: providers || undefined })
              const mapped: TopItem[] = mapGames((res as any)?.data)
              const fallbackCats: Category[] = [{ id: 'slots', name: 'Slots', totalCount: (res as any)?.meta?.total, items: mapped, iconData: null }]
              if (!current()) return
              setCategories(fallbackCats)
              const nextVis: Record<string, number> = { slots: mapped.length }
              const nextPg: Record<string, number> = { slots: (res as any)?.meta?.page || 1 }
              const nextCur: Record<string, string | null> = { slots: (res as any)?.meta?.cursor || null }
              const nextHas: Record<string, boolean> = { slots: Boolean((res as any)?.meta?.hasMore || nextCur.slots) }
              const nextTot: Record<string, number> = { slots: Number((res as any)?.meta?.total ?? mapped.length) }
              setVisibleByCat(nextVis)
              setPageByCat(nextPg)
              setHasMoreByCat(nextHas)
              setCursorByCat(nextCur)
              setTotalByCat(nextTot)
            } else {
              const nextVis: Record<string, number> = {}
              const nextPg: Record<string, number> = {}
              const nextCur: Record<string, string | null> = {}
              const nextHas: Record<string, boolean> = {}
              const nextTot: Record<string, number> = {}
              const fallbackCats: Category[] = []
              grouped.forEach((items, catRaw) => {
                const cat = normalizeCat(catRaw)
                const id = cat.toLowerCase().replace(/\s+/g, '-')
                const catType = (catTypeMap.get(cat) || '').toLowerCase()
                const catSubtitle = catSubtitleMap.get(cat) ?? null
                const catOrder = catOrderMap.get(cat) ?? null
                const catIcon = catIconMap.get(cat) ?? null
                fallbackCats.push({
                  id,
                  name: cat.replace(/_/g, ' '),
                  subtitle: catSubtitle,
                  filterCategory: cat,
                  totalCount: items.length,
                  items,
                  type: catType,
                  order: catOrder,
                  iconData: catIcon,
                })
                nextVis[id] = items.length
                nextPg[id] = 1
                nextCur[id] = null
                nextHas[id] = true
                nextTot[id] = items.length
              })
              fallbackCats.sort((a, b) => {
                const orderA = a.order ?? 9999
                const orderB = b.order ?? 9999
                if (orderA !== orderB) return orderA - orderB
                return categoryPriority(a.name) - categoryPriority(b.name) || catNames.indexOf(a.name) - catNames.indexOf(b.name)
              })
              if (!current()) return
              setCategories(fallbackCats)
              setVisibleByCat(nextVis)
              setPageByCat(nextPg)
              setHasMoreByCat(nextHas)
              setCursorByCat(nextCur)
              setTotalByCat(nextTot)
            }
          } else {
            seeded.sort((a, b) => {
              const orderA = a.order ?? 9999
              const orderB = b.order ?? 9999
              if (orderA !== orderB) return orderA - orderB
              return categoryPriority(a.name) - categoryPriority(b.name) || catNames.indexOf(a.name) - catNames.indexOf(b.name)
            })
          if (!current()) return
          setCategories([...seeded])
          setVisibleByCat(nextVisible)
          setPageByCat(nextPage)
          setHasMoreByCat(nextHasMore)
          setCursorByCat(nextCursor)
          setTotalByCat(nextTotal)
          }
        } else {
          const catsRes = await getCasinoCategories({ liveOnly: true })
          const catData = Array.isArray(catsRes?.data) ? catsRes.data : []
          const catIconMap = new Map<string, string | null>()
          const catNames = Array.from(
            new Set(
              catData.map((c: any) => {
                const name = typeof c === 'string' ? c : c?.name
                const key = normalizeCat(name)
                if (!key) return null
                const iconVal = typeof c === 'string' ? null : (c?.iconData ?? null)
                catIconMap.set(key, iconVal)
                return key
              }).filter(Boolean) as string[]
            )
          ).filter((c) => c && c.toLowerCase() !== 'slots')
            .sort((a, b) => categoryPriority(a) - categoryPriority(b))

          // Fetch first page for each category from DB to seed UI
          const seeded: Category[] = []
          const nextVisible: Record<string, number> = {}
          const nextPage: Record<string, number> = {}
          const nextHasMore: Record<string, boolean> = {}
          const nextCursor: Record<string, string | null> = {}
          const nextTotal: Record<string, number> = {}

          let failedCategories = 0
          await mapConcurrent(catNames, 3, async (cat) => {
            if (!current()) return
            try {
              const res = await getCasinoGames({ category: cat, page: 1, limit: 24, liveOnly: true, providers: providers || undefined })
              if (!current()) return
              const mapped: TopItem[] = mapGames((res as any)?.data)

              const id = cat.toLowerCase().replace(/\s+/g, '-')
              const total = Number((res as any)?.meta?.total ?? mapped.length)
              const page = Number((res as any)?.meta?.page ?? 1)
              const hasMore = Boolean((res as any)?.meta?.hasMore ?? (mapped.length < total))
              const catIcon = catIconMap.get(cat) ?? null

              seeded.push({ id, name: cat, filterCategory: cat, totalCount: total, items: mapped, iconData: catIcon })
              nextVisible[id] = mapped.length
              nextPage[id] = page
              nextHasMore[id] = hasMore
              nextCursor[id] = (res as any)?.meta?.cursor ?? null
              nextTotal[id] = total
              publish(seeded, catNames, nextVisible, nextPage, nextHasMore, nextCursor, nextTotal)
            } catch (_) { failedCategories++ }
          })
          if (!current()) return
          if (!seeded.length && failedCategories === catNames.length && catNames.length) throw new Error('Category reads failed')

          // Fallback: if nothing seeded, try summary list once
          if (seeded.length === 0) {
            const summary = await getCasinoSummary({ limit: 50, sort: 'popularity', liveOnly: true, providers: providers || undefined })
            const data = Array.isArray(summary?.data) ? summary.data : []
            const grouped = new Map<string, TopItem[]>()
            data.forEach((g: any) => {
              const cat = (g.category || g.mainCategory || 'live_casino').toString()
              const item = mapGame(g)
              if (!item) return
              if (!grouped.has(cat)) grouped.set(cat, [])
              grouped.get(cat)!.push(item)
            })
            grouped.forEach((items, cat) => {
              if (items.length === 0) return
              const id = cat.toLowerCase().replace(/\s+/g, '-')
              const catIcon = catIconMap.get(cat) ?? null
              seeded.push({
                id,
                name: cat.replace(/_/g, ' '),
                filterCategory: cat,
                totalCount: items.length,
                items: items.slice(0, 20),
                iconData: catIcon,
              })
              nextVisible[id] = Math.min(20, items.length)
              nextPage[id] = 1
              nextHasMore[id] = items.length > 20
              nextCursor[id] = null
              nextTotal[id] = items.length
            })
          }

            seeded.sort((a, b) => categoryPriority(a.name) - categoryPriority(b.name) || catNames.indexOf(a.name) - catNames.indexOf(b.name))
          if (!current()) return
          setCategories([...seeded])
          setVisibleByCat(nextVisible)
          setPageByCat(nextPage)
          setHasMoreByCat(nextHasMore)
          setCursorByCat(nextCursor)
          setTotalByCat(nextTotal)
        }
      } catch (_) {
        if (current()) {
          setCategories([])
          setLoadError('Casino categories could not be loaded. Please try again.')
        }
      } finally {
        if (current()) { setDisplayScope(scope); setLoading(false); setSettled(true) }
      }
    }
    load()
    return () => { cancelled = true }
  // scope uses provider values, avoiding a reload for an equivalent array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsOnly, mapGames, scope])

  // Tell the tab strip which rows exist, in row order with their counts, once the whole load has finished;
  // null while it runs, when the strip shows placeholders. Rows arrive one by one, and reporting each would
  // rebuild and shift the strip on every row (owner 2026-11-01).
  useEffect(() => {
    onCategoriesChange?.(settled ? categories.map((c) => ({
      id: c.id,
      name: c.name,
      count: typeof c.totalCount === 'number' ? c.totalCount : null,
      iconData: c.iconData ?? null,
    })) : null)
  }, [settled, categories, onCategoriesChange])

  // Scroll to category based on URL query param (?cat=slug)
  useEffect(() => {
    if (slotsOnly) return
    const sp = new URLSearchParams(location.search)
    const catSlug = sp.get('cat')
    if (!catSlug) return
    if (handledCatRef.current === catSlug) return
    const match = categories.find(c => c.id === catSlug)
    if (!match) return
    setTimeout(() => {
      document.getElementById(`cat-${match.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
    handledCatRef.current = catSlug
  }, [location.search, categories, slotsOnly])

  // Scrollspy: announce category in view so sidebar and tabs can highlight
  useEffect(() => {
    if (!categories || categories.length === 0) return
    const options: IntersectionObserverInit = {
      root: null,
      rootMargin: '-30% 0px -60% 0px',
      threshold: [0, 0.25, 0.5, 0.75, 1],
    }
    const handle: IntersectionObserverCallback = (entries) => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      const top = visible[0]
      if (!top) return
      const id = top.target.getAttribute('id') || ''
      const catId = id.startsWith('cat-') ? id.slice(4) : id
      if (!catId) return
      window.dispatchEvent(new CustomEvent('stakex:category-in-view', { detail: { catId } }))
    }
    const io = new IntersectionObserver(handle, options)
    categories.forEach(c => {
      const el = document.getElementById(`cat-${c.id}`)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [categories])

  // Infinite scroll observer for expanded category
  useEffect(() => {
    if (!expanded) return
    const root = document.getElementById(`cat-${expanded}`)
    const sentinel = root?.querySelector('[data-infinite-sentinel]') as HTMLDivElement | null
    if (!sentinel) return

    let fetching = false
    let cancelled = false
    const obs = new IntersectionObserver(async (entries) => {
      const e = entries[0]
      if (!e.isIntersecting) return
      if (fetching) return
      const cat = categories.find(c => c.id === expanded)
      if (!cat) return
      if (!hasMoreByCat[cat.id]) return
      fetching = true
      try {
        const existingCursor = cursorByCat[cat.id]
        const filterCategory = cat.filterCategory ?? cat.name
        const base = { category: filterCategory, limit: slotsOnly ? 48 : 24, liveOnly: !slotsOnly, slots: slotsOnly } as any
        if (providers && providers.length > 0) base.providers = providers
        const params = existingCursor
          ? { ...base, cursor: existingCursor }
          : { ...base, page: (pageByCat[cat.id] || 1) + 1 }
        const res = await getCasinoGames(params as any)
        if (cancelled || currentScope.current !== scope) return
        const mapped: TopItem[] = mapGames(res?.data)
        if (mapped.length > 0) {
          setCategories((prev) => prev.map((s) => s.id === cat.id ? { ...s, items: [...s.items, ...mapped] } : s))
          setVisibleByCat((prev) => ({ ...prev, [cat.id]: (prev[cat.id] || 0) + mapped.length }))
        }
        setPageByCat((prev) => ({ ...prev, [cat.id]: (res as any)?.meta?.page || (prev[cat.id] || 1) + 1 }))
        const nextCursor = (res as any)?.meta?.cursor || null
        setCursorByCat((prev) => ({ ...prev, [cat.id]: nextCursor }))
        const total = Number((res as any)?.meta?.total ?? (categories.find((s) => s.id === cat.id)?.totalCount ?? (visibleByCat[cat.id] || 0) + mapped.length))
        setTotalByCat((prev) => ({ ...prev, [cat.id]: total }))
        setHasMoreByCat((prev) => ({
          ...prev,
          [cat.id]: Boolean((res as any)?.meta?.hasMore || nextCursor || (visibleByCat[cat.id] || 0) + mapped.length < total),
        }))
      } catch (_) {
      } finally {
        fetching = false
      }
    }, { root: null, rootMargin: '400px 0px', threshold: 0.01 })

    obs.observe(sentinel)
    return () => { cancelled = true; obs.disconnect() }
  }, [expanded, categories, pageByCat, hasMoreByCat, mapGames, providers, slotsOnly, cursorByCat, visibleByCat, scope])

  const toggle = (id: string, isExpanded: boolean) => {
    setExpanded(isExpanded ? null : id)
    // Opening or closing changes the page height under the visitor; keep this row's bar in view.
    setTimeout(() => document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }), 0)
  }

  if (loading || displayScope !== scope) {
    return (
      <div className="nova-lobby-rows" role="status" aria-label={t('casinoLobby.loading', { defaultValue: 'Loading games' })}>
        {Array.from({ length: 3 }, (_, row) => (
          <div key={row} className="nova-lobby-section" aria-hidden="true">
            <div className="nova-lobby-skeleton-bar" />
            <div className="nova-ex-strip-track nova-lobby-track">
              {Array.from({ length: 6 }, (_, tile) => <span key={tile} className="nova-ex-tile is-skeleton" />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="nova-lobby-panel is-error" role="alert">
        <strong>{t('casinoLobby.loadError', { defaultValue: 'Games could not be loaded.' })}</strong>
        <p>{t('casinoLobby.loadErrorHint', { defaultValue: 'Check your connection and try again.' })}</p>
        <button type="button" className="nova-lobby-btn is-primary" onClick={() => setReloadToken((value) => value + 1)}>{t('nova.tryAgain')}</button>
      </div>
    )
  }

  if (categories.length === 0) {
    const filtered = Boolean(providers && providers.length > 0)
    return (
      <div className="nova-lobby-panel">
        <strong>{filtered
          ? t('casinoLobby.noProviderGames', { defaultValue: 'No games from these providers' })
          : t('casinoLobby.noGames', { defaultValue: 'No games are available right now' })}</strong>
        <p>{filtered
          ? t('casinoLobby.noProviderGamesHint', { defaultValue: 'Pick other providers or clear the filter.' })
          : t('casinoLobby.noGamesHint', { defaultValue: 'Please check again later.' })}</p>
        {filtered && onClearProviders && (
          <button type="button" className="nova-lobby-btn" onClick={onClearProviders}>{t('casinoLobby.clearProviders', { defaultValue: 'Clear providers' })}</button>
        )}
      </div>
    )
  }

  return (
    <div className="nova-lobby-rows">
      {categories.map((cat) => {
        const isExpanded = expanded === cat.id
        const items = cat.items.slice(0, visibleByCat[cat.id] ?? 24) as CasinoCardItem[]
        return (
          <section key={cat.id} id={`cat-${cat.id}`} className="nova-lobby-section" aria-labelledby={`cat-title-${cat.id}`}>
            <header className="nova-ex-section-head">
              {cat.iconData
                ? <span className="nova-lobby-cat-icon" aria-hidden="true"><img src={categoryIconSrc(cat.iconData)} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} /></span>
                : <Flame className="nova-lobby-head-icon" aria-hidden="true" />}
              <h2 id={`cat-title-${cat.id}`}>{cat.name}</h2>
              {typeof cat.totalCount === 'number' && <span className="nova-ex-section-count">{cat.totalCount.toLocaleString()}</span>}
              <CategoryHeaderControls isExpanded={isExpanded} onToggle={() => toggle(cat.id, isExpanded)} catId={cat.id} />
            </header>
            <div id={`cat-body-${cat.id}`}>
              {isExpanded ? (
                <>
                  <div className="nova-lobby-grid">
                    {items.map((item, index) => <LobbyTile key={`${cat.id}-${item.gameId ?? item.title}-${index}`} item={item} />)}
                  </div>
                  {/* Infinite scroll sentinel: the next page loads as it nears the viewport. */}
                  <div data-infinite-sentinel className="nova-lobby-sentinel" />
                  <div className="nova-lobby-foot">
                    <button type="button" className="nova-lobby-btn" onClick={() => toggle(cat.id, true)}>{t('casinoLobby.showLess', { defaultValue: 'Show less' })}</button>
                  </div>
                </>
              ) : (
                <CategorySlider items={cat.items as CasinoCardItem[]} catId={cat.id} />
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
