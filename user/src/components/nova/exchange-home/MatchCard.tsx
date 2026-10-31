import { Link } from 'react-router-dom'
import { Bookmark, ChevronRight, Clock, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { EventItem } from '@/types'
import { addEventToRecent } from '@/lib/sportsHelpers'
import {
  BADGE_TITLES,
  eventUrl,
  formatPrice,
  formatVolume,
  istClock,
  splitTeams,
  useDayLabel,
  type MarketBadge,
  type PricePair,
  type Ways,
} from './exchangeShared'
import { useEventOdds } from './useEventOdds'
import { LivePulse } from './LivePulse'
import './nova-exchange-home.css'

/** Bookmark state comes from the list: the bookmarks hook fetches on mount, so it is used once per list. */
export type CardBookmark = { active: boolean; onToggle: () => void }

/** What a card and a list row both show for one match. */
type MatchView = {
  to: string
  onOpen?: () => void
  league: string
  home: string
  away: string
  start: Date
  live?: boolean
  ways: Ways
  pairs: (PricePair | undefined)[]
  /** False until the first odds arrive: show dashes, not locks. */
  loaded: boolean
  /** The market is suspended: its last prices are shown muted under a label, not as live prices. */
  suspended?: boolean
  badges: MarketBadge[]
  bookmark?: CardBookmark
  /** Matched volume, when the feed provides it (it does not today, so rows leave it out). */
  matched?: number
}

/** One runner's back/lay pair. A runner without prices (suspended) shows locked; a runner the market does not
 *  have at all (no draw in a two-runner market) is a blank cell on the list's fixed 1 X 2 columns. */
function OddsPair({ pair, loaded }: { pair?: PricePair; loaded: boolean }) {
  const { t } = useTranslation()
  if (loaded && !pair) {
    return <span className="nova-ex-pair is-none" aria-hidden="true"><span className="nova-ex-price is-back" /><span className="nova-ex-price is-lay" /></span>
  }
  if (loaded && !pair?.back.price && !pair?.lay.price) {
    return <span className="nova-ex-pair is-locked" title={t('exchangeHome.suspended', { defaultValue: 'Suspended' })}>
      <span className="nova-ex-price is-back"><Lock aria-hidden="true" /></span>
      <span className="nova-ex-price is-lay"><Lock aria-hidden="true" /></span>
    </span>
  }
  return <span className="nova-ex-pair">
    <span className="nova-ex-price is-back"><strong>{formatPrice(pair?.back.price)}</strong><small>{formatVolume(pair?.back.size)}</small></span>
    <span className="nova-ex-price is-lay"><strong>{formatPrice(pair?.lay.price)}</strong><small>{formatVolume(pair?.lay.size)}</small></span>
  </span>
}

/**
 * The back/lay columns. Before the first odds the tiles are muted (`is-pending`); a suspended market keeps its
 * last prices muted under a label. A card has no fixed columns, so a market without a draw drops the X column
 * there (`collapse`); list rows keep it, blank, to stay aligned with the 1 X 2 header.
 */
function Prices({ ways, pairs, loaded, suspended, collapse, className }: { ways: Ways; pairs: (PricePair | undefined)[]; loaded: boolean; suspended?: boolean; collapse?: boolean; className: string }) {
  const { t } = useTranslation()
  if (ways === 0) return <span className="nova-ex-card-race">{t('exchangeHome.raceCard', { defaultValue: 'Race card' })}<ChevronRight aria-hidden="true" /></span>
  const noDraw = collapse && ways === 3 && loaded && !pairs[1]
  const shown = noDraw ? [pairs[0], pairs[2]] : Array.from({ length: ways }, (_, index) => pairs[index])
  const state = !loaded ? ' is-pending' : suspended ? ' is-suspended' : ''
  return <span className={`${className} ways-${shown.length}${state}`}>
    {shown.map((pair, index) => <OddsPair key={index} pair={pair} loaded={loaded} />)}
    {loaded && suspended && <span className="nova-ex-suspended"><span>{t('exchangeHome.suspended', { defaultValue: 'Suspended' })}</span></span>}
  </span>
}

function BookmarkButton({ bookmark, title }: { bookmark: CardBookmark; title: string }) {
  const { t } = useTranslation()
  return <button
    type="button"
    className={`nova-ex-card-bookmark${bookmark.active ? ' is-active' : ''}`}
    aria-pressed={bookmark.active}
    aria-label={`${t(bookmark.active ? 'nova.removeBookmark' : 'nova.addBookmark')}: ${title}`}
    onClick={bookmark.onToggle}
  ><Bookmark aria-hidden="true" /></button>
}

/** The team link stretches over the whole card; the bookmark button sits above it. */
export function MatchCard({ to, onOpen, league, home, away, start, live, ways, pairs, loaded, suspended, badges, bookmark }: MatchView) {
  const { t } = useTranslation()
  const dayLabel = useDayLabel()
  const title = away ? `${home} v ${away}` : home
  return <article className={`nova-ex-card${live ? ' is-live' : ''}`}>
    <span className="nova-ex-card-top">
      <span className="nova-ex-card-league">{league}</span>
      {badges.length > 0 && <span className="nova-ex-card-badges">{badges.map(badge => <abbr key={badge} title={BADGE_TITLES[badge]}>{badge}</abbr>)}</span>}
      {bookmark && <BookmarkButton bookmark={bookmark} title={title} />}
    </span>
    <Link to={to} onClick={onOpen} className="nova-ex-card-link" title={title}>
      <strong className="nova-ex-card-teams">{away ? <>{home} <em>v</em> {away}</> : home}</strong>
    </Link>
    <span className="nova-ex-card-time">
      {live
        ? <span className="is-live"><i aria-hidden="true" />{t('nova.live')}<LivePulse /></span>
        : <><Clock aria-hidden="true" />{dayLabel(start)}, {istClock(start)}</>}
    </span>
    <Prices ways={ways} pairs={pairs} loaded={loaded} suspended={suspended} collapse className="nova-ex-card-odds" />
  </article>
}

/**
 * The sports page's list row (matchbook style): day and time, the two sides on two lines,
 * competition and matched volume, then the back/lay prices in fixed columns.
 */
export function MatchRow({ to, onOpen, league, home, away, start, live, ways, pairs, loaded, suspended, badges, bookmark, matched }: MatchView) {
  const { t } = useTranslation()
  const dayLabel = useDayLabel()
  const title = away ? `${home} v ${away}` : home
  return <article className={`nova-sx-row${live ? ' is-live' : ''}`}>
    {live
      ? <span className="nova-sx-row-when is-live">
        <strong><i aria-hidden="true" />{t('nova.live')}</strong>
        <LivePulse />
      </span>
      : <span className="nova-sx-row-when">
        <strong>{dayLabel(start)}</strong>
        <small><Clock aria-hidden="true" />{istClock(start)}</small>
      </span>}
    <Link to={to} onClick={onOpen} className="nova-sx-row-link" title={title}>
      <strong>{home}{away && <> <em>vs</em> {away}</>}</strong>
      <span className="nova-sx-row-league">{league}</span>
    </Link>
    {/* Kept even when empty so every row has the same columns. */}
    <span className="nova-sx-row-meta">
      {(badges.length > 0 || matched) && <small>
        {badges.map(badge => <abbr key={badge} title={BADGE_TITLES[badge]}>{badge}</abbr>)}
        {matched ? <span>{formatVolume(matched)}</span> : null}
      </small>}
    </span>
    {bookmark ? <BookmarkButton bookmark={bookmark} title={title} /> : <span className="nova-sx-row-spacer" aria-hidden="true" />}
    <Prices ways={ways} pairs={pairs} loaded={loaded} suspended={suspended} className="nova-sx-row-odds" />
  </article>
}

/** A real event as a card on the home page. */
export function LiveMatchCard({ event, ways, bookmark }: { event: EventItem; ways: Ways; bookmark?: CardBookmark }) {
  const { pairs, loaded, suspended, badges, live } = useEventOdds(event, ways)
  const [home, away] = splitTeams(event.eventName)
  return <MatchCard to={eventUrl(event)} onOpen={() => { void addEventToRecent(event) }} league={event.league} home={home} away={away}
    start={new Date(event.startISO)} live={live} ways={ways} pairs={pairs} loaded={loaded} suspended={suspended} badges={badges} bookmark={bookmark} />
}

/** A real event as a list row on the sports page. */
export function LiveMatchRow({ event, ways, bookmark }: { event: EventItem; ways: Ways; bookmark?: CardBookmark }) {
  const { pairs, loaded, suspended, badges, live } = useEventOdds(event, ways)
  const [home, away] = splitTeams(event.eventName)
  return <MatchRow to={eventUrl(event)} onOpen={() => { void addEventToRecent(event) }} league={event.league} home={home} away={away}
    start={new Date(event.startISO)} live={live} ways={ways} pairs={pairs} loaded={loaded} suspended={suspended} badges={badges} bookmark={bookmark} />
}
