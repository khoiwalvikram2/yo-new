import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Clock, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { EventItem, SportType } from '@/types'
import { useFeatureFlags, useLogo, useParsedSettings, useSportsIconStyle } from '../../../hooks/useAppSettings'
import { useSportsEventsData } from '../../sports/useSportsEventsData'
import CasinoLounge from './CasinoLounge'
import FeaturedGameRail from './FeaturedGameRail'
import GameStrip from './GameStrip'
import HomeFaq from './HomeFaq'
import ProviderShowcase from './ProviderShowcase'
import SectionHeader from './SectionHeader'
import { LiveMatchCard } from './MatchCard'
import PopularNavigation from './PopularNavigation'
import MatkaStrip from './MatkaStrip'
import { selectHomeSportsEvents } from './homeSportsFeed'
import {
  RACING,
  eventUrl,
  istClock,
  istDayKey,
  isStale,
  rankSport,
  splitTeams,
  sportIcon,
  sportIconClass,
  sportTitle,
  startOf,
  useDayLabel,
  waysFor,
} from './exchangeShared'
import PromotionFolio from './PromotionFolio'
import './nova-exchange-home.css'

const sportArt = (sport: string) => sport === 'cricket' ? 'cricket-light.webp' : sport === 'tennis' ? 'tennis-light.webp' : 'football-light.webp'
const artSrc = (art: string) => `/nova/${art}`

/* --------------------------------------------------------- sport games */

type GameEntry = { key: string; sport: SportType; live: boolean; at: number; event: EventItem }

const ALL_ROW_LIMIT = 10
function gameEntries(events: EventItem[]): GameEntry[] {
  return selectHomeSportsEvents(events)
    .map((event): GameEntry => ({ key: event.eventId || `${event.eventName}-${event.startISO}`, sport: event.sport, live: Boolean(event.isLive), at: startOf(event), event }))
}

/** One sport's cards in a single row: as many as fit are visible, the rest scroll sideways. */
function SportRail({ sport, total, children }: { sport: SportType; total: number; children: ReactNode }) {
  const { t } = useTranslation()
  const track = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const count = Children.count(children)
  const syncEdges = useCallback(() => {
    const el = track.current
    if (el) setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 })
  }, [])
  useEffect(() => {
    syncEdges()
    window.addEventListener('resize', syncEdges)
    return () => window.removeEventListener('resize', syncEdges)
  }, [syncEdges, count])
  const step = (direction: 1 | -1) => {
    const el = track.current
    const card = el?.firstElementChild as HTMLElement | null
    if (!el) return
    const width = card ? card.getBoundingClientRect().width + parseFloat(getComputedStyle(el).columnGap || '0') : el.clientWidth
    el.scrollBy({ left: direction * width, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  const headingId = `nova-ex-section-${sport}`
  const iconStyle = useSportsIconStyle()
  const icon = sportIcon(sport, iconStyle)

  return <section className="nova-ex-sport-section" aria-labelledby={headingId}>
    <SectionHeader icon={icon ? <img src={icon} alt="" className={sportIconClass(sport, iconStyle)} /> : undefined} title={sportTitle(sport)} titleId={headingId} count={total}>
      <Link to={`/sports?sport=${sport}`} className="nova-ex-section-all">{t('exchangeHome.seeAll', { defaultValue: 'See All' })}</Link>
      {!(edges.start && edges.end) && <span className="nova-ex-section-arrows">
        <button type="button" disabled={edges.start} onClick={() => step(-1)} aria-label={t('nova.scrollLeft')}><ChevronLeft aria-hidden="true" /></button>
        <button type="button" disabled={edges.end} onClick={() => step(1)} aria-label={t('nova.scrollRight')}><ChevronRight aria-hidden="true" /></button>
      </span>}
    </SectionHeader>
    <div className="nova-ex-cards" ref={track} onScroll={syncEdges}>{children}</div>
  </section>
}

/**
 * Home shows live sports only, falling back to the open matches (started today, then upcoming) when none are live.
 * Real events only: an empty feed says so, a failed request says so and offers a retry.
 */
function SportsGames({ events, loading, error, onRetry }: { events: EventItem[]; loading: boolean; error: string | null; onRetry: () => void }) {
  const { t } = useTranslation()
  const entries = useMemo(() => gameEntries(events), [events])
  const boards = useMemo(() => {
    const bySport = new Map<SportType, GameEntry[]>()
    for (const entry of entries) {
      if (!bySport.has(entry.sport)) bySport.set(entry.sport, [])
      bySport.get(entry.sport)!.push(entry)
    }
    return [...bySport.entries()]
      .sort(([sportA, a], [sportB, b]) => a[0].at - b[0].at || rankSport(sportA) - rankSport(sportB))
      .map(([sport, list]) => ({ sport, ways: waysFor(sport), total: list.length, entries: list.slice(0, ALL_ROW_LIMIT) }))
  }, [entries])

  // Keep an unavailable feed distinct from a successful empty response.
  const failed = !loading && Boolean(error) && entries.length === 0

  return <div id="nova-ex-games" className="nova-ex-games-list">
      {loading
        ? <div className="nova-ex-cards" aria-busy="true">{[0, 1, 2].map(index => <div key={index} className="nova-ex-card is-skeleton"><i /><i /><i /><i /></div>)}</div>
        : failed
          ? <div className="nova-ex-empty" role="alert">
            <strong>{t('nova.eventLoadError')}</strong>
            <button type="button" onClick={onRetry}>{t('nova.tryAgain')}</button>
          </div>
          : entries.length === 0
            ? <div className="nova-ex-empty" role="status"><strong>{t('nova.noUpcoming')}</strong></div>
            : boards.map(board => <SportRail key={board.sport} sport={board.sport} total={board.total}>
                {board.entries.map(entry => <LiveMatchCard key={entry.key} event={entry.event} ways={board.ways} />)}
              </SportRail>)}
    </div>
}

/* ----------------------------------------------------------- side column */

type Fixture = { key: string; sport: SportType; league: string; home: string; away: string; at: number; live: boolean; to: string }

/** Real events in one shape for the side widgets; with none, the widgets are left out. */
function sideFixtures(events: EventItem[]): Fixture[] {
  return events.filter(event => !isStale(event)).map((event): Fixture => {
    const [home, away] = splitTeams(event.eventName)
    return { key: event.eventId || `${event.eventName}-${event.startISO}`, sport: event.sport, league: event.league, home, away, at: startOf(event), live: Boolean(event.isLive), to: eventUrl(event) }
  })
}

const QUICK_LEAGUE_LIMIT = 6
const UP_NEXT_LIMIT = 4

/** Competitions one tap from their market list: priority sports first (cricket leads), busiest within each. */
function QuickLeagues({ fixtures }: { fixtures: Fixture[] }) {
  const iconStyle = useSportsIconStyle()
  const { t } = useTranslation()
  const leagues = useMemo(() => {
    const counts = new Map<string, { sport: SportType; league: string; count: number }>()
    for (const fixture of fixtures) {
      if (!fixture.league) continue
      const key = `${fixture.sport}|${fixture.league}`
      const entry = counts.get(key) ?? { sport: fixture.sport, league: fixture.league, count: 0 }
      entry.count += 1
      counts.set(key, entry)
    }
    return [...counts.values()]
      .sort((a, b) => rankSport(a.sport) - rankSport(b.sport) || b.count - a.count)
      .slice(0, QUICK_LEAGUE_LIMIT)
  }, [fixtures])
  if (leagues.length === 0) return null

  return <section className="nova-ex-widget" aria-labelledby="nova-ex-leagues-title">
    <SectionHeader icon={<Star className="nova-ex-strip-icon" aria-hidden="true" />} title={t('exchangeHome.quickLeagues', { defaultValue: 'Quick leagues' })} titleId="nova-ex-leagues-title" />
    <ul className="nova-ex-widget-list">
      {leagues.map(entry => {
        const icon = sportIcon(entry.sport, iconStyle)
        return <li key={`${entry.sport}|${entry.league}`}>
          <Link to={`/sports?sport=${entry.sport}&league=${encodeURIComponent(entry.league)}`} className="nova-ex-league">
            {icon && <img className={sportIconClass(entry.sport, iconStyle, 'sport-img')} src={icon} alt="" />}
            <span className="nova-ex-league-name">{entry.league}</span>
            <span className="nova-ex-league-count">{entry.count}</span>
            <ChevronRight aria-hidden="true" />
          </Link>
        </li>
      })}
    </ul>
  </section>
}

/** The next fixtures to start (in-play ones are already on the cards). */
function UpNext({ fixtures }: { fixtures: Fixture[] }) {
  const { t } = useTranslation()
  const dayLabel = useDayLabel()
  const next = useMemo(() => {
    const now = Date.now()
    return fixtures.filter(fixture => !fixture.live && fixture.at >= now).sort((a, b) => a.at - b.at).slice(0, UP_NEXT_LIMIT)
  }, [fixtures])
  if (next.length === 0) return null
  const today = istDayKey(new Date())

  return <section className="nova-ex-widget" aria-labelledby="nova-ex-upnext-title">
    <SectionHeader icon={<Clock className="nova-ex-strip-icon" aria-hidden="true" />} title={t('exchangeHome.upNext', { defaultValue: 'Up next' })} titleId="nova-ex-upnext-title">
      <span className="nova-ex-widget-zone">IST</span>
    </SectionHeader>
    <ul className="nova-ex-widget-list">
      {next.map(fixture => {
        const start = new Date(fixture.at)
        // Any whitespace: some engines put a narrow no-break space (U+202F) before AM/PM.
        const [clock, meridiem] = istClock(start).split(/\s+/)
        return <li key={fixture.key}>
          <Link to={fixture.to} className="nova-ex-upnext">
            <span className="nova-ex-upnext-time">
              {istDayKey(start) !== today && <small>{dayLabel(start)}</small>}
              <strong>{clock}<span>{meridiem}</span></strong>
            </span>
            <span className="nova-ex-upnext-match">
              <strong>{fixture.away ? `${fixture.home} v ${fixture.away}` : fixture.home}</strong>
              <small>{fixture.league}</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        </li>
      })}
    </ul>
  </section>
}

/**
 * Casino on: featured live-casino and slot games; casino off: brand promo and featured competition.
 * Quick leagues and Up next follow either way.
 */
function SideColumn({ events, loading }: { events: EventItem[]; loading: boolean }) {
  const { t } = useTranslation()
  const features = useFeatureFlags()
  // While the list loads the cards show skeletons; the side lists wait too instead of flashing placeholders.
  const fixtures = useMemo(() => loading ? [] : sideFixtures(events), [events, loading])

  return <aside className="nova-ex-side" aria-label={t('exchangeHome.featured', { defaultValue: 'Featured' })}>
    {features.casinoEnabled
      ? <>
        <FeaturedGameRail variant="default" title={t('nav.liveCasino')} seeAllTo="/casino" />
        <FeaturedGameRail variant="slots" title={t('nav.slots')} seeAllTo="/slots" />
      </>
      : <FeaturedSports events={events} />}
    <QuickLeagues fixtures={fixtures} />
    <UpNext fixtures={fixtures} />
  </aside>
}

function FeaturedSports({ events }: { events: EventItem[] }) {
  const { t } = useTranslation()
  const { appName } = useParsedSettings()
  const { logoSrc } = useLogo()
  const featured = useMemo(() => {
    const counts = new Map<string, { sport: SportType; league: string; count: number }>()
    for (const event of events) {
      if (RACING.includes(event.sport) || !event.league) continue
      const key = `${event.sport}|${event.league}`
      const entry = counts.get(key) ?? { sport: event.sport, league: event.league, count: 0 }
      entry.count += 1
      counts.set(key, entry)
    }
    const top = [...counts.values()].sort((a, b) => b.count - a.count)[0]
    if (!top) return null
    return { label: `${sportTitle(top.sport)} - ${top.league}`, art: sportArt(top.sport), overlay: top.league, to: `/sports?sport=${top.sport}` }
  }, [events])

  // This column only renders with casino disabled, so the brand card opens the exchange, not /casino.
  // The featured competition is the busiest real one; with no events there is none to feature.
  return <>
    <Link to="/sports" className="nova-ex-brand-card">
      <span>{t('exchangeHome.tryTheNew', { defaultValue: 'Try the all new' })}</span>
      {appName ? <strong>{appName}</strong> : logoSrc ? <img src={logoSrc} alt="" /> : <strong>{t('nova.sportsExchange')}</strong>}
      <small>{t('exchangeHome.earlyAccess', { defaultValue: 'Click for early access' })}</small>
    </Link>
    {featured && <section className="nova-ex-featured" aria-labelledby="nova-ex-featured-title">
      <h2 id="nova-ex-featured-title"><Link to={featured.to}>{featured.label}</Link></h2>
      <Link to={featured.to} className="nova-ex-featured-art" tabIndex={-1} aria-hidden="true">
        <img src={artSrc(featured.art)} alt="" />
        <strong>{featured.overlay}</strong>
      </Link>
    </section>}
  </>
}

/* ------------------------------------------------------------------ page */

export default function NovaExchangeHome() {
  const { events, loading, error, reload } = useSportsEventsData()
  const features = useFeatureFlags()
  const { t } = useTranslation()
  return <div className="nova-ex-grid nova-ex-home">
    <div className="nova-ex-main">
      <PromotionFolio />
      <PopularNavigation onInPlay={reload} />
      {features.sportsEnabled && <SportsGames events={events} loading={loading} error={error} onRetry={reload} />}
      {features.casinoEnabled && <>
        <CasinoLounge />
        <GameStrip kind="live" title={t('nav.liveCasino')} allTo="/casino" />
        <GameStrip kind="slots" title={t('nav.slots')} allTo="/slots" />
      </>}
      {/* Matka sits after the slots row (owner 2026-10-30); the game providers stay last. */}
      {features.matkaEnabled && <MatkaStrip />}
      {features.casinoEnabled && <ProviderShowcase />}
    </div>
    <SideColumn events={events} loading={loading} />
    {/* The FAQ closes the page: under the main column on desktop, after the side column (Quick leagues, Up next)
        once the columns stack (owner 2026-11-02 polish). */}
    <div className="nova-ex-main nova-ex-foot"><HomeFaq /></div>
  </div>
}
