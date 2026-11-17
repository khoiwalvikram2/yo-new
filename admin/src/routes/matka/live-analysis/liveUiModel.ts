export interface MatkaBet {
  id: string
  userId: string | number
  userName?: string | null
  matkaId: string
  matkaName?: string | null
  matkaType: string
  marketName: string
  marketSession?: string | null
  bidType: string
  betNumbers: string
  betAmount: number
  potentialWin?: number | null
  actualWin?: number | null
  payoutMultiplier: number
  status: string
  currency?: string | null
  createdAt: string
}
export interface MatkaUser { id: string | number; createdAt: string; vipTierName?: string | null; status?: string | null }
export interface MatkaBetsData { matkaBets: MatkaBet[] }
export interface MatkaUsersData { users: MatkaUser[] }
export interface MatkaMetrics { wagered: number; payouts: number; ggr: number; bets: number }
export interface MatkaMarketMetrics extends MatkaMetrics { matkaId: string; matkaName?: string | null; potentialPayouts?: number | null }
/** `payouts` counts settled wins, so it is 0 on open bets; `potentialPayouts` is what they pay if they all win. */
export interface MatkaKpis { at: string; betsPerMin: number; wagered: number; payouts: number; ggr: number; rtp: number; activePlayers: number; potentialPayouts?: number | null; timestamp?: number }
export interface MatkaBreakdown {
  byMatka: MatkaMarketMetrics[]
  byType: Array<MatkaMetrics & { matkaType: string }>
  byMarket: Array<MatkaMetrics & { marketName: string }>
  byBidType: Array<MatkaMetrics & { bidType: string }>
  byDigit: Array<{ digit: string; wagered: number; payouts: number; exposure: number; bets: number }>
  bySession: Array<MatkaMetrics & { marketSession: string | null; potentialPayouts?: number | null }>
  bySelection: Array<{ selection: string; matkaId: string; matkaName?: string | null; marketName: string; marketSession: string | null; bidType: string; wagered: number; payouts: number; exposure: number; bets: number }>
  /** Every selection summed (bySelection holds the riskiest 200); null on a frame cached before it existed. */
  selectionTotals?: MatkaSelectionTotals | null
}
export interface MatkaSelectionTotals { selections: number; wagered: number; payouts: number; exposure: number; bets: number }
export interface MatkaDashboard { kpis?: MatkaKpis; breakdown?: MatkaBreakdown }
export function isGoodMatkaSnapshot(snapshot: MatkaDashboard | null | undefined): snapshot is MatkaDashboard & { kpis: MatkaKpis } {
  if (!snapshot?.kpis) return false
  const kpis = snapshot.kpis
  // Preserve the original Matka snapshot acceptance criteria.
  return [kpis.betsPerMin, kpis.wagered, kpis.payouts, kpis.activePlayers].every(value => typeof value === 'number' && Number.isFinite(value))
}
export interface MatkaPlayerEvent { id?: string; at?: string; userId: string | number; userName?: string | null; matkaType?: string | null; marketName: string; bidType: string; betAmount: number; potentialWin?: number | null; status: string }
export function appendMatkaEvent(events: MatkaPlayerEvent[], event: MatkaPlayerEvent) {
  const visibleKey = (item: MatkaPlayerEvent) => JSON.stringify([item.id, item.at, item.userId, item.userName, item.matkaType, item.marketName, item.bidType, item.betAmount, item.potentialWin, item.status])
  if (event.id && events.some(item => visibleKey(item) === visibleKey(event))) return events
  return [{ ...event }, ...events].slice(0, 200)
}
export interface MatkaRiskAlert { id: string; type?: string; title: string; description: string; severity: string; entity: string }
export interface MatkaExposureSelection { selectionKey: string; bidType: string; bets: number; totalStake: number; potentialPayout: number; exposure: number }
export interface MatkaExposureMarket { marketName: string; marketSession?: string | null; bets: number; totalStake: number; potentialPayout: number; exposure: number; selections: MatkaExposureSelection[] }
export interface MatkaExposureBook { at?: string; markets: MatkaExposureMarket[] }

/** Open-bet snapshots cannot produce a realised RTP reading. Also drop stale
 * RTP frames from a backend/cache that is still on the previous version. */
export function isOpenMatkaRiskAlert(alert: MatkaRiskAlert): boolean {
  return alert.type !== 'rtp' && !alert.id.startsWith('rtp-')
}
