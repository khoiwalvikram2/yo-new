import type { EventItem } from '@/types'
import { startOf } from './exchangeShared'

/** Prefer the feed's live matches. With none live, show only scheduled future starts. */
export function selectHomeSportsEvents(events: readonly EventItem[], now = Date.now()): EventItem[] {
  const dated = events.filter(event => Number.isFinite(startOf(event)))
  const live = dated.filter(event => event.isLive)
  const selected = live.length ? live : dated.filter(event => startOf(event) >= now)
  return selected.sort((a, b) => startOf(a) - startOf(b))
}
