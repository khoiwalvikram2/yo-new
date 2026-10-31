import { useCallback, useEffect, useState } from 'react'
import type { EventItem, SportType } from '@/types'
import { getSportsList } from '@/lib/api/user'

const sportAliases: Record<string, SportType> = {
  soccer: 'football',
  'horse-racing': 'horseracing',
  'greyhound-racing': 'greyhoundracing',
  icehockey: 'ice-hockey',
}

const supportedSports = new Set<SportType>([
  'cricket', 'football', 'tennis', 'basketball', 'baseball', 'hockey', 'ice-hockey',
  'volleyball', 'boxing', 'mma', 'rugby', 'horseracing', 'greyhoundracing', 'darts',
  'snooker', 'cycling', 'golf', 'esports',
])

export const normalizeSportKey = (raw: string): SportType | null => {
  const key = raw.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').trim()
  const aliased = sportAliases[key] ?? key
  return supportedSports.has(aliased as SportType) ? aliased as SportType : null
}

const normalizeEventStart = (raw: unknown): string | null => {
  if (raw === null || raw === undefined || raw === '') return null
  try {
    const value = typeof raw === 'number'
      ? new Date(raw < 1e12 ? raw * 1000 : raw)
      : typeof raw === 'string' && /^\d+$/.test(raw.trim())
        ? new Date(Number(raw.trim()) < 1e12 ? Number(raw.trim()) * 1000 : Number(raw.trim()))
        : raw instanceof Date
          ? new Date(raw.getTime())
          : new Date(String(raw))
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  } catch {
    return null
  }
}

/** Loads the sports -> leagues -> events tree once and flattens it into EventItems. */
export function useSportsEventsData() {
  const [events, setAllEvents] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    const loadEvents = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await getSportsList()
        if (cancelled) return
        const sports: any[] = Array.isArray(res?.data) ? res.data : []
        const events: EventItem[] = []

        for (const sport of sports) {
          const sportName = normalizeSportKey((sport?.slugName || sport?.name || '').toString())
          if (!sportName) continue
          const leagues: any[] = Array.isArray(sport?.leagues) ? sport.leagues : []

          for (const lg of leagues) {
            const leagueName = (lg?.name || lg?.slugName || '').toString()
            const lgEvents: any[] = Array.isArray(lg?.events) ? lg.events : []

            for (const ev of lgEvents) {
              const eventName = String(ev?.name || ev?.slugName || '').trim()
              const start = normalizeEventStart(ev?.date ?? ev?.startISO ?? ev?.startTime ?? ev?.start ?? ev?.time)
              if (!eventName || !start) continue

              let primaryMarketCode: string | undefined
              let initialIsLive = false
              let runners: EventItem['runners'] = []
              try {
                const markets: any[] = Array.isArray(ev?.markets) ? ev.markets : []
                const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
                const isBookOrFancy = (m: any) => /book|fancy/.test(norm(m?.type)) || /bookmaker/.test(norm(m?.marketName))

                const synonymTests = [
                  (m: any) => norm(m?.marketName) === 'match odds',
                  (m: any) => /\b1x2\b/.test(norm(m?.marketName)),
                  (m: any) => /full\s*time\s*result/.test(norm(m?.marketName)),
                  (m: any) => /match\s*result/.test(norm(m?.marketName)),
                  (m: any) => /money\s*line|moneyline/.test(norm(m?.marketName)),
                ]
                let primary: any
                for (const test of synonymTests) {
                  primary = markets.find(test)
                  if (primary) break
                }
                if (!primary) primary = markets.find((m: any) => !isBookOrFancy(m))
                primaryMarketCode = primary?.marketId || primary?._id
                const rawRunners = Array.isArray(primary?.runners)
                  ? primary.runners
                  : Array.isArray(primary?.selections)
                    ? primary.selections
                    : Array.isArray(ev?.runners)
                      ? ev.runners
                      : []
                runners = rawRunners.flatMap((runner: any) => {
                  const name = String(runner?.name || runner?.runnerName || runner?.selectionName || '').trim()
                  return name ? [{ name }] : []
                })

                const liveFromEvent = (() => {
                  const direct = ev?.inplay ?? ev?.inPlay ?? ev?.live ?? ev?.isLive
                  if (typeof direct === 'boolean') return direct
                  const s = String(ev?.status || '').toLowerCase()
                  return /(^|\b)(live|inplay|running)(\b|$)/.test(s)
                })()
                const liveFromMarkets = markets.some((m: any) => {
                  return m?.inplay === true || m?.inPlay === true
                })
                initialIsLive = liveFromEvent || liveFromMarkets
              } catch { /* ignore */ }

              events.push({
                eventId: String(ev?._id || ev?.id || ''),
                eventCode: ev?.eventCode ? String(ev.eventCode) : undefined,
                sport: sportName,
                eventName,
                league: leagueName,
                startISO: start,
                isLive: initialIsLive,
                primaryMarketCode,
                runners,
              })
            }
          }
        }
        if (!cancelled) setAllEvents(events)
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load sports events')
          setAllEvents([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadEvents()
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = useCallback(() => setReload(value => value + 1), [])
  return { events, loading, error, reload }
}
