import type { BetSlipData } from './types'

function normalizeLabel(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function extractRunnerBackLay(r: any): { back: number; lay: number } {
  // Fancy feed (b1 / l1)
  if (r?.b1 != null || r?.l1 != null) {
    return { back: Number(r.b1 || 0), lay: Number(r.l1 || 0) }
  }
  const ex = r?.ex
  if (ex) {
    const atb = Array.isArray(ex.availableToBack) ? ex.availableToBack : []
    const atl = Array.isArray(ex.availableToLay) ? ex.availableToLay : []
    let back = 0
    if (atb.length > 0) {
      const backPrices = atb
        .map((item: any) => Number(item?.price || 0))
        .filter((price: number) => Number.isFinite(price) && price > 1)
      if (backPrices.length > 0) back = Math.max(...backPrices)
    }
    let lay = 0
    if (atl.length > 0) {
      const layPrices = atl
        .map((item: any) => Number(item?.price || 0))
        .filter((price: number) => Number.isFinite(price) && price > 1)
      if (layPrices.length > 0) lay = Math.min(...layPrices)
    }
    return { back, lay }
  }
  const back = r?.back ?? r?.backPrice ?? r?.oddsBack ?? r?.b
  const lay = r?.lay ?? r?.layPrice ?? r?.oddsLay ?? r?.l
  return { back: Number(back || 0), lay: Number(lay || 0) }
}

export type FancyLiveSnapshot = {
  back: number
  lay: number
  fancyBackSize?: number
  fancyLaySize?: number
  fancyStatus?: string
}

/**
 * Reads current fancy runner line from the same socket payload as `useOddsSocket` (`fancy-{eventCode}`).
 */
export function getFancyLiveSnapshot(
  oddsSocketData: Record<string, unknown> | undefined,
  bet: Pick<BetSlipData, 'marketType' | 'selectionId' | 'team' | 'backOdds' | 'odds' | 'layOdds'>,
  eventCode: string | number | undefined
): FancyLiveSnapshot | null {
  if (!oddsSocketData || bet.marketType !== 'fancy' || eventCode == null || eventCode === '') {
    return null
  }

  const socketMarketData = (oddsSocketData as Record<string, any>)[`fancy-${String(eventCode)}`]
  if (!socketMarketData) return null

  let runners: any[] = []
  if (Array.isArray(socketMarketData?.runners)) {
    runners = socketMarketData.runners
  } else if (Array.isArray(socketMarketData?.selections)) {
    runners = socketMarketData.selections
  } else if (socketMarketData?.runners && typeof socketMarketData.runners === 'object') {
    runners = Object.values(socketMarketData.runners)
  } else if (Array.isArray(socketMarketData)) {
    runners = socketMarketData
  }

  const betSelectionNormalized = normalizeLabel(bet.team)
  const betSelectionId = bet.selectionId != null ? Number(bet.selectionId) : undefined

  const runner = runners.find((r: any) => {
    if (betSelectionId != null && Number.isFinite(betSelectionId) && (r.selectionId != null || r.id != null)) {
      return Number(r.selectionId || r.id) === betSelectionId
    }
    const runnerName = normalizeLabel(r?.runnerName || r?.selectionName || r?.name || '')
    return runnerName.length > 0 && runnerName === betSelectionNormalized
  })

  if (!runner) return null

  const { back, lay } = extractRunnerBackLay(runner)
  const bs = Number(runner.bs1)
  const ls = Number(runner.ls1)

  return {
    back: back > 0 ? back : bet.backOdds || bet.odds || 0,
    lay: lay > 0 ? lay : bet.layOdds || 0,
    fancyBackSize: Number.isFinite(bs) && bs > 0 ? bs : undefined,
    fancyLaySize: Number.isFinite(ls) && ls > 0 ? ls : undefined,
    fancyStatus:
      runner.status1 != null
        ? String(runner.status1)
        : runner.status != null
          ? String(runner.status)
          : undefined,
  }
}
