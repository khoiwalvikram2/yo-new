import { useEffect, useMemo, useState } from 'react'
import type { Market } from './types'
import { useOddsSocket } from '@/lib/hooks/useOddsSocket'

export type OddsPoint = { timestamp: number; backOdds: number; layOdds: number }
export type DepthLevel = { price: number; volume: number }
export type MomentumPoint = { timestamp: number; value: number }

export interface AnalyticsResult {
  primarySelection: string
  oddsHistory: Record<string, OddsPoint[]>
  depth: { back: DepthLevel[]; lay: DepthLevel[] }
  winProb: { home: number; away: number; draw?: number }
  momentumHistory: MomentumPoint[]
  momentumValue: number
}

// Max lengths to keep UI snappy
const MAX_ODDS_POINTS = 60
const MAX_MOMENTUM_POINTS = 40
const MAX_DEPTH_LEVELS = 10

const safeNumber = (v: any, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const pickBestBack = (runner: any) => {
  const atb = Array.isArray(runner?.ex?.availableToBack) ? runner.ex.availableToBack : []
  if (atb.length) return safeNumber(atb[atb.length - 1]?.price, safeNumber(runner?.back))
  return safeNumber(runner?.back)
}

const pickBestLay = (runner: any) => {
  const atl = Array.isArray(runner?.ex?.availableToLay) ? runner.ex.availableToLay : []
  if (atl.length) return safeNumber(atl[0]?.price, safeNumber(runner?.lay))
  return safeNumber(runner?.lay)
}

const toDepthLevels = (side: 'back' | 'lay', runner: any): DepthLevel[] => {
  const arr = Array.isArray(side === 'back' ? runner?.ex?.availableToBack : runner?.ex?.availableToLay)
    ? (side === 'back' ? runner.ex.availableToBack : runner.ex.availableToLay)
    : []
  return arr.slice(0, MAX_DEPTH_LEVELS).map((lvl: any) => ({
    price: safeNumber(lvl.price),
    volume: safeNumber(lvl.size),
  }))
}

export function useEventAnalytics(eventId: string, markets: Market[]): AnalyticsResult {
  // Target the primary market (match-odds preferred)
  const primaryMarket = useMemo(
    () => markets.find(m => m.type === 'match-odds') || markets[0],
    [markets]
  )

  const marketCodes = useMemo(() => {
    const codes = markets.map(m => (m as any).marketCode).filter(Boolean)
    return codes as string[]
  }, [markets])

  const oddsMap = useOddsSocket(marketCodes, { eventId })

  const [oddsHistory, setOddsHistory] = useState<Record<string, OddsPoint[]>>({})
  const [depth, setDepth] = useState<{ back: DepthLevel[]; lay: DepthLevel[] }>({ back: [], lay: [] })
  const [winProb, setWinProb] = useState<{ home: number; away: number; draw?: number }>({ home: 0, away: 0 })
  const [momentumHistory, setMomentumHistory] = useState<MomentumPoint[]>([])
  const [momentumValue, setMomentumValue] = useState(0)

  // Helper to extract runners from live or static market data
  const extractRunners = (mkt: Market, live: any) => {
    if (live?.payload?.runners) return live.payload.runners
    if (Array.isArray(live?.runners)) return live.runners
    if (Array.isArray((mkt as any)?.odds)) return (mkt as any).odds
    return []
  }

  useEffect(() => {
    if (!primaryMarket) return
    const live = primaryMarket.marketCode ? oddsMap[primaryMarket.marketCode] : null
    const runners = extractRunners(primaryMarket, live)
    if (!Array.isArray(runners) || runners.length === 0) return

    // Choose primary selection (first runner)
    const primaryRunner = runners[0]
    // selectionName calculated but not used

    // Update odds history (back/lay per runner)
    const now = Date.now()
    const nextHistory = { ...oddsHistory }
    runners.forEach((runner: any) => {
      const selKey =
        (runner?.selectionId ? String(runner.selectionId) : runner?.selection || runner?.name || 'selection').toString()
      const backOdds = pickBestBack(runner)
      const layOdds = pickBestLay(runner)
      const arr = nextHistory[selKey] ? [...nextHistory[selKey]] : []
      arr.push({ timestamp: now, backOdds, layOdds })
      if (arr.length > MAX_ODDS_POINTS) arr.shift()
      nextHistory[selKey] = arr
    })
    setOddsHistory(nextHistory)

    // Update depth for primary runner
    setDepth({
      back: toDepthLevels('back', primaryRunner),
      lay: toDepthLevels('lay', primaryRunner),
    })

    // Win probability from implied odds (best back)
    const implied = runners.map((runner: any) => {
      const price = pickBestBack(runner)
      return price > 0 ? 1 / price : 0
    })
    const total = implied.reduce((a, b) => a + b, 0) || 1
    const normalized = implied.map(v => (v / total) * 100)
    const homeProb = safeNumber(normalized[0], 0)
    const awayProb = safeNumber(normalized[1], 0)
    const drawProb = normalized[2] !== undefined ? safeNumber(normalized[2], 0) : undefined
    setWinProb({ home: homeProb, away: awayProb, draw: drawProb })

    // Momentum: difference between home and away probabilities
    const diff = homeProb - awayProb
    setMomentumValue(diff)
    setMomentumHistory(prev => {
      const next = [...prev, { timestamp: now, value: diff }]
      if (next.length > MAX_MOMENTUM_POINTS) next.shift()
      return next
    })
  }, [primaryMarket, oddsMap, markets]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    primarySelection: primaryMarket?.name || 'Market',
    oddsHistory,
    depth,
    winProb,
    momentumHistory,
    momentumValue,
  }
}

