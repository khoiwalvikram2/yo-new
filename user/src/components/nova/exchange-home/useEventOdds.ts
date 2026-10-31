import { useEffect, useState } from 'react'
import type { EventItem } from '@/types'
import { useOddsSocket } from '@/lib/hooks/useOddsSocket'
import { readMarket, type MarketBadge, type PricePair, type Ways } from './exchangeShared'

/** Socket market payloads say in-play explicitly; the DB list does not, so the socket is the live signal. */
function isInPlay(payload: any) {
  const status = String(payload?.status ?? payload?.marketStatus ?? '').toUpperCase()
  return Boolean(payload?.inplay || payload?.inPlay) && status !== 'CLOSED'
}

/**
 * Match-odds prices for one event from the odds socket, plus which market families answered.
 * Events that are not in play take a single snapshot; once a payload reports in-play the
 * subscription switches to continuous updates. Racing (ways 0) has no head-to-head market.
 */
export function useEventOdds(event: EventItem, ways: Ways) {
  const marketCode = ways === 0 ? undefined : event.primaryMarketCode
  // bookmaker-/fancy- channels are keyed by the feed event id; older lists only carry the DB id.
  const channelEventId = ways === 0 ? undefined : event.eventCode || event.eventId
  const [inPlay, setInPlay] = useState(false)
  const live = Boolean(event.isLive) || inPlay
  const oddsMap = useOddsSocket(marketCode ? [marketCode] : [], { once: !live, eventId: channelEventId })
  const [pairs, setPairs] = useState<(PricePair | undefined)[]>([])
  // The feed keeps sending a suspended market's last ladder; those prices are not available to bet.
  const [suspended, setSuspended] = useState(false)
  useEffect(() => {
    if (ways === 0) return
    const payload = (marketCode && oddsMap[marketCode]) || (channelEventId ? oddsMap[`bookmaker-${channelEventId}`] : undefined)
    if (!payload) return
    if (marketCode && oddsMap[marketCode]) {
      setInPlay(isInPlay(oddsMap[marketCode]))
      setSuspended(String(oddsMap[marketCode]?.status ?? '').toUpperCase() === 'SUSPENDED')
    }
    try {
      const next = readMarket(payload, ways)
      if (next) setPairs(next)
    } catch { /* malformed odds payload: keep the last good prices */ }
  }, [oddsMap, marketCode, channelEventId, ways])

  const badges: MarketBadge[] = []
  if (marketCode) badges.push('MO')
  if (channelEventId && hasMarkets(oddsMap[`bookmaker-${channelEventId}`])) badges.push('BM')
  if (channelEventId && hasMarkets(oddsMap[`fancy-${channelEventId}`])) badges.push('F')
  return { pairs, loaded: pairs.length > 0, suspended, badges, live }
}

/** The socket answers bookmaker/fancy channels even when empty ([] or { markets: [] }). */
function hasMarkets(payload: any) {
  if (!payload) return false
  if (Array.isArray(payload)) return payload.length > 0
  if (Array.isArray(payload.markets)) return payload.markets.length > 0
  if (Array.isArray(payload.data)) return payload.data.length > 0
  return Boolean(payload.data)
}
