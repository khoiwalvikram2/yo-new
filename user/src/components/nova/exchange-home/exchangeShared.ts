// Helpers shared by the exchange home and the sports page: sport naming and icons, IST time,
// event links and reading match-odds payloads into back/lay pairs.
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { EventItem, SportType } from '@/types'
import { generateEventId } from '@/lib/sportsHelpers'
import { getSportsIconSlug, type SportsIconStyle } from '../../../../../shared/src/theme/sportsIcons'

export const RACING: SportType[] = ['horseracing', 'greyhoundracing']
/** Display order for sports everywhere (tabs, sections, quick leagues): cricket leads. */
export const BOARD_ORDER: SportType[] = ['cricket', 'football', 'tennis', 'basketball', 'horseracing', 'greyhoundracing', 'ice-hockey', 'baseball']
const SPORT_TITLES: Partial<Record<SportType, string>> = {
  football: 'Soccer', cricket: 'Cricket', tennis: 'Tennis', basketball: 'Basketball', baseball: 'Baseball',
  hockey: 'Hockey', 'ice-hockey': 'Ice Hockey', volleyball: 'Volleyball', boxing: 'Boxing', mma: 'MMA',
  rugby: 'Rugby', darts: 'Darts', snooker: 'Snooker', cycling: 'Cycling', golf: 'Golf', esports: 'Esports',
  horseracing: 'Horse Racing', greyhoundracing: 'Greyhound Racing',
}

export type Price = { price?: number; size?: number }
export type PricePair = { back: Price; lay: Price }
/** Price columns per row: 3 = 1 X 2, 2 = 1 2, 0 = racing (no head-to-head prices). */
export type Ways = 0 | 2 | 3
export type MarketBadge = 'MO' | 'BM' | 'F'
export const BADGE_TITLES: Record<MarketBadge, string> = { MO: 'Match Odds', BM: 'Bookmaker', F: 'Fancy' }

export const ALL_TAB = 'all'
export const IN_PLAY_TAB = 'inplay'
export type SportTab = { key: string; label: string; count: number; sport?: SportType }

export const sportTitle = (sport: string) => SPORT_TITLES[sport as SportType] ?? sport.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
export const istDayKey = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
export const istClock = (date: Date) => date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
export const startOf = (event: EventItem) => new Date(event.startISO).getTime()
/**
 * Nothing closes finished events automatically (an admin result does), so the lists hide events
 * that started over a day ago and are not in play. A live multi-day match stays while it reports live.
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000
export const isStale = (event: EventItem, now = Date.now()) => !event.isLive && startOf(event) < now - STALE_AFTER_MS
export const eventUrl = (event: EventItem) => {
  const slug = generateEventId(event.eventName)
  return event.eventId ? `/sports/event/${slug}?id=${encodeURIComponent(event.eventId)}` : `/sports/event/${slug}`
}

const SPORT_ICON_FILES = import.meta.glob('../../../assets/images/*.png', { eager: true, import: 'default' }) as Record<string, string>
const SPORT_ICON_NAMES: Partial<Record<SportType, string>> = { horseracing: 'horse-racing', greyhoundracing: 'greyhound-racing', hockey: 'ice-hockey' }
const STYLED_SPORT_ICON_FILES = import.meta.glob('../../../assets/images/{flat,3d}/*.png', { eager: true, import: 'default' }) as Record<string, string>
/** The colourful icon's module key in the whitelabel's chosen set, or null (default set, Live, Politics, unknown sports). */
export const styledSportIconKey = (sport: string, style: SportsIconStyle): string | null => {
  if (style === 'default') return null
  const slug = getSportsIconSlug(SPORT_ICON_NAMES[sport as SportType] ?? sport)
  return slug ? `../../../assets/images/${style}/${slug}.png` : null
}
const styledSportIcon = (sport: string, style: SportsIconStyle) => {
  const key = styledSportIconKey(sport, style)
  return key ? STYLED_SPORT_ICON_FILES[key] : undefined
}
export const sportIcon = (sport: string, style: SportsIconStyle = 'default') =>
  styledSportIcon(sport, style) ?? SPORT_ICON_FILES[`../../../assets/images/${SPORT_ICON_NAMES[sport as SportType] ?? sport}.png`]
/** Colourful icons keep their own colours: this class turns off the tint filters the single-colour set uses. */
export const COLORFUL_SPORT_ICON_CLASS = 'mb-sport-icon-colorful'
export const sportIconClass = (sport: string, style: SportsIconStyle, base = ''): string | undefined =>
  [base, styledSportIcon(sport, style) ? COLORFUL_SPORT_ICON_CLASS : ''].filter(Boolean).join(' ') || undefined
export const rankSport = (sport: string) => {
  const index = BOARD_ORDER.indexOf(sport as SportType)
  return index < 0 ? BOARD_ORDER.length : index
}
/** 1 X 2 for sports that can draw; the draw cell locks when a market has no draw runner. */
export const waysFor = (sport: string): Ways => RACING.includes(sport as SportType) ? 0 : sport === 'football' || sport === 'cricket' ? 3 : 2

/** "Team A v Team B" → ["Team A", "Team B"]; anything unsplittable stays on one line. */
export function splitTeams(name: string): [string, string] {
  const parts = name.split(/\s+(?:v|vs\.?|versus)\s+|\s+-\s+/i)
  return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : [name, '']
}

/** A price a punter can take: a finite number above zero. Anything else is shown as a locked box. */
export function hasPrice(price?: unknown): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price > 0
}

export function formatPrice(price?: number) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return '–'
  return String(Number(price.toFixed(2)))
}

/** Matched volume the way exchanges print it: 840, 8K, 183K. */
export function formatVolume(size?: number) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return ''
  return size >= 1000 ? `${Math.round(size / 1000)}K` : String(Math.round(size))
}

/** Reads the socket payload of a match-odds market into [home, (draw), away] back/lay pairs. */
/** Prices per column (1, X, 2 or 1, 2). A runner the market does not have (no draw) is `undefined`. */
export function readMarket(live: any, ways: 2 | 3): (PricePair | undefined)[] | null {
  let runners: any[] = []
  if (Array.isArray(live?.runners)) runners = live.runners
  else if (Array.isArray(live?.selections)) runners = live.selections
  else if (live?.runners && typeof live.runners === 'object') runners = Object.values(live.runners)
  else if (live && typeof live === 'object') runners = Object.values(live)
  runners = runners.filter(runner => runner && typeof runner === 'object')
  if (runners.length < 2) return null

  const name = (runner: any) => String(runner?.selectionName ?? runner?.runnerName ?? runner?.name ?? '').toLowerCase()
  const drawIndex = runners.findIndex(runner => name(runner).includes('draw'))
  const others = runners.filter((_, index) => index !== drawIndex)
  const ordered = ways === 3
    ? [others[0], drawIndex >= 0 ? runners[drawIndex] : undefined, others[1]]
    : [others[0], others[others.length - 1]]

  return ordered.map(runner => {
    if (!runner) return undefined
    const ex = runner.ex
    if (ex) {
      const backs = Array.isArray(ex.availableToBack) ? ex.availableToBack : []
      const lays = Array.isArray(ex.availableToLay) ? ex.availableToLay : []
      const back = backs[backs.length - 1]
      const lay = lays[0]
      return { back: { price: back?.price, size: back?.size }, lay: { price: lay?.price, size: lay?.size } }
    }
    return { back: { price: runner.back }, lay: { price: runner.lay } }
  })
}

/** "Today" / "Tomorrow" / "16 Oct" in IST. */
export function useDayLabel() {
  const { t } = useTranslation()
  return useCallback((date: Date) => {
    const key = istDayKey(date)
    const now = new Date()
    if (key === istDayKey(now)) return t('exchangeHome.today', { defaultValue: 'Today' })
    if (key === istDayKey(new Date(now.getTime() + 86_400_000))) return t('exchangeHome.tomorrow', { defaultValue: 'Tomorrow' })
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })
  }, [t])
}
