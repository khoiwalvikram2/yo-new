import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, LoaderCircle, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFeaturedCasinoGames } from '../../casino/useFeaturedCasinoGames'
import { useLaunchGame } from '../../casino/useLaunchGame'
import SectionHeader from './SectionHeader'

const AUTOPLAY_MS = 5000
const MAX_SLIDES = 12
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

type RailGame = { key: string; title: string; provider: string; image: string; gameId?: string }

function SlideArt({ game, children }: { game: RailGame; children?: ReactNode }) {
  const { t } = useTranslation()
  return <>
    <img src={game.image} alt="" loading="lazy" decoding="async" onError={event => {
      const image = event.currentTarget
      if (image.dataset.fallbackApplied) { image.style.display = 'none'; return }
      image.dataset.fallbackApplied = 'true'
      image.src = '/dice-bg.svg'
    }} />
    <span className="nova-ex-slide-shade" aria-hidden="true" />
    <span className="nova-ex-slide-meta">
      <small>{game.provider}</small>
      <strong>{game.title}</strong>
    </span>
    <span className="nova-ex-slide-play" aria-hidden="true"><Play /><span>{t('exchangeHome.playNow', { defaultValue: 'Play now' })}</span></span>
    {children}
  </>
}

/** A real featured game: the whole artwork launches it (login first for guests). */
function LaunchSlide({ game }: { game: RailGame }) {
  const { t } = useTranslation()
  const { launch, loading, error } = useLaunchGame(game.gameId)
  return <div className="nova-ex-slide">
    <button type="button" className="nova-ex-slide-art" onClick={() => void launch()} disabled={loading} aria-label={t('nova.openGame', { title: game.title })}>
      <SlideArt game={game}>{loading && <span className="nova-ex-slide-loading" role="status"><LoaderCircle aria-hidden="true" /></span>}</SlideArt>
    </button>
    {error && <p className="nova-ex-slide-error" role="alert">{error}</p>}
  </div>
}

/**
 * One featured game at a time (the owner removed the thumbnail strip under it, 2026-10-29); arrows, a counter and a
 * progress bar on the artwork; auto-advances, pauses on hover or focus.
 * Only the admin's featured category: with none configured (or no games in it) the rail is left out,
 * and a failed request says so in one line.
 */
export default function FeaturedGameRail({ variant, title, seeAllTo }: { variant: 'default' | 'slots'; title: string; seeAllTo: string }) {
  const { t } = useTranslation()
  const headingId = useId()
  const { items, loading, error } = useFeaturedCasinoGames(variant)
  const games: RailGame[] = useMemo(
    () => items.slice(0, MAX_SLIDES).map((game, index) => ({ key: `${game.game_id}-${index}`, title: game.title, provider: game.provider, image: game.image, gameId: game.game_id })),
    [items],
  )
  const count = games.length
  const track = useRef<HTMLDivElement>(null)
  const settleUntil = useRef(0)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const autoplay = !loading && count > 1 && !reducedMotion()

  const goTo = useCallback((next: number, smooth = true) => {
    const el = track.current
    if (!el || count === 0) return
    const target = (next + count) % count
    settleUntil.current = Date.now() + 700
    el.scrollTo({ left: target * el.clientWidth, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
    setIndex(target)
  }, [count])

  // A manual swipe lands on a slide boundary; follow it so autoplay continues from there.
  const syncFromScroll = () => {
    const el = track.current
    if (Date.now() < settleUntil.current) return
    if (el && el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }

  useEffect(() => {
    if (paused || !autoplay) return
    const id = window.setTimeout(() => { if (!document.hidden) goTo(index + 1) }, AUTOPLAY_MS)
    return () => window.clearTimeout(id)
  }, [paused, autoplay, index, goTo])

  useEffect(() => {
    const realign = () => goTo(index, false)
    window.addEventListener('resize', realign)
    return () => window.removeEventListener('resize', realign)
  }, [goTo, index])

  if (!loading && count === 0 && !error) return null

  return <section
    className={`nova-ex-games${variant === 'default' ? ' is-live' : ''}`}
    aria-roledescription="carousel"
    aria-labelledby={headingId}
    onMouseEnter={() => setPaused(true)}
    onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)}
    onBlur={() => setPaused(false)}
  >
    <SectionHeader variant="featured" title={title} titleId={headingId} badge={variant === 'default' ? <span className="nova-ex-live-badge"><i aria-hidden="true" />{t('nova.live')}</span> : undefined}>
      <Link to={seeAllTo} className="nova-ex-games-all">{t('exchangeHome.seeAll', { defaultValue: 'See All' })}<ChevronRight aria-hidden="true" /></Link>
    </SectionHeader>

    {loading
      ? <div className="nova-ex-games-skeleton" role="status"><span className="sr-only">{t('nova.loadingCasino')}</span><i /></div>
      : count === 0
        ? <p className="nova-ex-section-note" role="alert">{t('nova.casinoLoadError')}</p>
        : <>
          <div className="nova-ex-games-stage">
            <div className="nova-ex-games-track" ref={track} onScroll={syncFromScroll}>
              {games.map((game, slide) => <div key={game.key} className="nova-ex-games-slide" role="group" aria-roledescription="slide" aria-label={`${slide + 1} / ${count}`}>
                <LaunchSlide game={game} />
              </div>)}
            </div>
            {count > 1 && <>
              <button type="button" className="nova-ex-games-arrow is-prev" onClick={() => goTo(index - 1)} aria-label={t('nova.scrollLeft')}><ChevronLeft aria-hidden="true" /></button>
              <button type="button" className="nova-ex-games-arrow" onClick={() => goTo(index + 1)} aria-label={t('nova.scrollRight')}><ChevronRight aria-hidden="true" /></button>
              <span className="nova-ex-games-count" aria-hidden="true">{index + 1} / {count}</span>
            </>}
            {autoplay && <span key={index} className={`nova-ex-games-progress${paused ? ' is-paused' : ''}`} aria-hidden="true" />}
          </div>
        </>}
  </section>
}
