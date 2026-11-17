import type { EventItem } from '@/types'
import { isStale, startOf } from './exchangeShared'

/**
 * The feed's live matches when it reports any. Otherwise every open fixture, so the home is not empty while markets
 * are open (owner 2026-11-02): matches that started within the last day and are not settled come first, latest
 * first, because the feed list never marks a match in play and one of them may be (its card shows LIVE from the
 * odds socket); then scheduled starts, soonest first.
 */
export function selectHomeSportsEvents(events: readonly EventItem[], now = Date.now()): EventItem[] {
  const dated = events.filter(event => Number.isFinite(startOf(event)))
  const live = dated.filter(event => event.isLive)
  if (live.length) return live.sort((a, b) => startOf(a) - startOf(b))
  const started = dated.filter(event => startOf(event) < now && !isStale(event, now)).sort((a, b) => startOf(b) - startOf(a))
  const upcoming = dated.filter(event => startOf(event) >= now).sort((a, b) => startOf(a) - startOf(b))
  return [...started, ...upcoming]
}
