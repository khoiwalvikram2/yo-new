import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Dices, Gamepad2, LoaderCircle, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCasinoGameList } from '../../casino/useCasinoGameList'
import { useLaunchGame } from '../../casino/useLaunchGame'
import SectionHeader from './SectionHeader'
import './game-strip.css'

/** Auto-run speed in px per second: slow enough to read titles as they pass. */
const SPEED = 40
/** After an arrow, swipe or wheel, autoplay waits this long before moving again. */
const MANUAL_HOLD_MS = 3500
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

type StripGame = { key: string; title: string; provider: string; image: string; gameId?: string }

function TileBody({ game, live, busy }: { game: StripGame; live: boolean; busy?: boolean }) {
  const { t } = useTranslation()
  // Provider art is landscape (3:2); it keeps its shape and the name sits underneath, not over the logo.
  return <>
    <span className="nova-ex-tile-art">
      <img src={game.image} alt="" loading="lazy" decoding="async" draggable={false} onError={event => {
        const image = event.currentTarget
        if (image.dataset.fallbackApplied) { image.style.display = 'none'; return }
        image.dataset.fallbackApplied = 'true'
        image.src = '/dice-bg.svg'
      }} />
      {live && <span className="nova-ex-tile-live" aria-hidden="true"><i />{t('nova.live')}</span>}
    </span>
    <span className="nova-ex-tile-copy">
      <span className="nova-ex-tile-name"><strong>{game.title}</strong><small>{game.provider}</small></span>
      <span className="nova-ex-tile-play" aria-hidden="true">{busy ? <LoaderCircle className="is-spinning" /> : <Play />}</span>
    </span>
  </>
}

function LaunchTile({ game, live, clone }: { game: StripGame; live: boolean; clone: boolean }) {
  const { t } = useTranslation()
  const { launch, loading } = useLaunchGame(game.gameId)
  return <button type="button" className="nova-ex-tile" onClick={() => void launch()} disabled={loading}
    aria-label={t('nova.openGame', { title: game.title })} aria-hidden={clone || undefined} tabIndex={clone ? -1 : undefined}>
    <TileBody game={game} live={live} busy={loading} />
  </button>
}

/**
 * A row of game tiles that drifts continuously (a second copy of the row makes the loop
 * seamless). Hover, focus, touch, an off-screen row or a hidden tab all hold it still.
 * Only real games from the API: an empty (or failed) list says so in one line.
 */
export default function GameStrip({ kind, title, allTo }: { kind: 'live' | 'slots'; title: string; allTo: string }) {
  const { t } = useTranslation()
  const { items: games, loading } = useCasinoGameList(kind)
  const empty = !loading && games.length === 0
  const live = kind === 'live'

  const track = useRef<HTMLDivElement>(null)
  const position = useRef(0)
  const holdUntil = useRef(0)
  const hovered = useRef(false)
  const visible = useRef(true)
  const [loops, setLoops] = useState(false)

  // Loop only when one copy of the row is wider than the viewport; otherwise there is nothing to run.
  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    const firstCopyWidth = el.scrollWidth / (loops ? 2 : 1)
    setLoops(firstCopyWidth > el.clientWidth + 4)
  }, [loops])
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure, games.length])

  // Width of one copy: where the clone of the first tile starts.
  const loopWidth = useCallback(() => {
    const el = track.current
    const clone = el?.children[games.length] as HTMLElement | undefined
    return el && clone ? clone.offsetLeft - (el.children[0] as HTMLElement).offsetLeft : 0
  }, [games.length])

  useEffect(() => {
    const el = track.current
    if (!el || !loops || reducedMotion()) return
    const observer = new IntersectionObserver(([entry]) => { visible.current = entry.isIntersecting })
    observer.observe(el)
    position.current = el.scrollLeft
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64) / 1000
      last = now
      const width = loopWidth()
      const held = hovered.current || now < holdUntil.current || document.hidden || !visible.current
      if (held) {
        position.current = el.scrollLeft
      } else if (width > 0) {
        position.current += SPEED * dt
        if (position.current >= width) position.current -= width
        el.scrollLeft = position.current
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [loops, loopWidth])

  const hold = () => { holdUntil.current = performance.now() + MANUAL_HOLD_MS }
  const step = (direction: 1 | -1) => {
    const el = track.current
    const tile = el?.firstElementChild as HTMLElement | null
    if (!el || !tile) return
    hold()
    const distance = (tile.getBoundingClientRect().width + 10) * 2
    const width = loopWidth()
    // In loop mode, step back from the very start by jumping to the identical spot in the copy.
    if (direction === -1 && loops && width > 0 && el.scrollLeft < distance) el.scrollLeft += width
    el.scrollBy({ left: direction * distance, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  const rendered = loops ? [...games, ...games] : games
  const Icon = live ? Dices : Gamepad2

  return <section className={`nova-ex-strip gw-home-strip is-${kind}`} aria-labelledby={`nova-ex-strip-${kind}`}>
    <SectionHeader icon={<Icon className="nova-ex-strip-icon" aria-hidden="true" />} title={title} titleId={`nova-ex-strip-${kind}`} badge={live ? <span className="nova-ex-live-badge"><i aria-hidden="true" />{t('nova.live')}</span> : undefined}>
      <Link to={allTo} className="nova-ex-section-all">{t('exchangeHome.seeAll', { defaultValue: 'See All' })}</Link>
      {!empty && <span className="nova-ex-section-arrows">
        <button type="button" onClick={() => step(-1)} aria-label={t('nova.scrollLeft')}><ChevronLeft aria-hidden="true" /></button>
        <button type="button" onClick={() => step(1)} aria-label={t('nova.scrollRight')}><ChevronRight aria-hidden="true" /></button>
      </span>}
    </SectionHeader>
    {loading
      ? <div className="nova-ex-strip-track" aria-busy="true">{Array.from({ length: 8 }, (_, index) => <span key={index} className="nova-ex-tile is-skeleton" />)}</div>
      : empty
        ? <p className="nova-ex-section-note" role="status">{t(live ? 'nova.noTopCasino' : 'nova.noTopSlots')}</p>
        : <div
          className="nova-ex-strip-track"
          ref={track}
          onMouseEnter={() => { hovered.current = true }}
          onMouseLeave={() => { hovered.current = false }}
          onFocus={() => { hovered.current = true }}
          onBlur={() => { hovered.current = false }}
          onPointerDown={hold}
          onWheel={hold}
          onTouchMove={hold}
        >
          {rendered.map((game, index) => {
            const clone = index >= games.length
            return <LaunchTile key={`${game.key}${clone ? '-copy' : ''}`} game={game} live={live} clone={clone} />
          })}
        </div>}
  </section>
}
