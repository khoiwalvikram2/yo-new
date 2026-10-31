import { startOfDay, endOfDay, addDays, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'

export type BetCampaign = {
  id: string
  name: string
  type?: string | null
  distributionType?: string | null
  wageringReq?: number | null
  validTo?: string | null
  validFrom?: string | null
  domain?: string | null
  status?: string | null
  startDate?: string | null
  endDate?: string | null
  amount?: number | null
  percentage?: number | null
  amountType?: string | null
}

export type BetRow = {
  id: string
  product: string
  userId: string
  status: string
  stake: number
  liability?: number | null
  return: number | null
  netAmount: number
  currency: string
  createdAt: string
  settledAt: string | null
  sportId?: string | null
  sportName?: string | null
  leagueId?: string | null
  leagueName?: string | null
  eventId?: string | null
  eventName?: string | null
  marketId?: string | null
  marketName?: string | null
  selectionId?: string | null
  selectionName?: string | null
  odds?: number | null
  oddsSize?: number | null
  side?: string | null
  pl?: number | null
  result?: string | null
  eventResult?: string | null
  ipAddress?: string | null
  deviceInfo?: string | null
  location?: string | null
  country?: string | null
  gameId?: string | null
  gameName?: string | null
  providerId?: string | null
  providerName?: string | null
  vendorName?: string | null
  tableId?: string | null
  winAmount?: number | null
  sessionId?: string | null
  gameRoundId?: string | null
  transactionId?: string | null
  matkaId?: string | null
  matkaName?: string | null
  matkaType?: string | null
  bidType?: string | null
  bidNumbers?: string | null
  marketSession?: string | null
  payoutMultiplier?: number | null
  potentialWin?: number | null
  actualWin?: number | null
  payout?: number | null
  walletType?: string | null
  campaign?: BetCampaign | null
}

export type ProductTab = 'sports' | 'casino' | 'matka'
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]
export const DEFAULT_PAGE_SIZE = 50
export function resolveDateRange(dateRange: string, dateFrom: string | null, dateTo: string | null): { from?: string; to?: string } {
  if (dateFrom && dateTo) return { from: dateFrom, to: dateTo }
  if (!dateRange || dateRange === 'all_time') return {}
  const now = new Date()
  const tz = DEFAULT_ADMIN_TZ
  if (dateRange === 'today') {
    return { from: startOfDay(now, tz).toISOString(), to: endOfDay(now, tz).toISOString() }
  }
  if (dateRange === 'yesterday') {
    const yesterdayStart = addDays(startOfDay(now, tz), -1)
    return { from: yesterdayStart.toISOString(), to: endOfDay(yesterdayStart, tz).toISOString() }
  }
  const ranges: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }
  const days = ranges[dateRange]
  if (!days) return {}
  return {
    from: addDays(startOfDay(now, tz), -days).toISOString(),
    to: endOfDay(now, tz).toISOString(),
  }
}

export function playerBetSearch(rows: BetRow[], search: string) {
  if (!search) return rows
  return rows.filter(row => [row.id, row.product, row.eventName, row.marketName, row.selectionName, row.gameName, row.providerName, row.vendorName, row.matkaName, row.bidType, row.campaign?.name].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()))
}
export function playerBetTotals(rows: BetRow[]) {
  const totalStake = rows.reduce((sum, row) => row.product === 'sports' ? sum + (Number(row.liability) || Number(row.stake) || 0) : sum + (row.stake || 0), 0)
  const totalPL = rows.reduce((sum, row) => {
    if (row.product === 'sports') return sum + (Number(row.pl) || 0)
    if (row.product === 'matka') return ['void', 'cancelled'].includes(String(row.status).toLowerCase()) ? sum : sum + ((Number(row.actualWin) || 0) - (Number(row.stake) || 0))
    return sum + (row.netAmount || 0)
  }, 0)
  return { totalStake, totalPL, currency: rows[0]?.currency || 'INR' }
}
export function playerBetsCsv(rows: BetRow[]) {
  const quote = (value: unknown) => {
    const text = String(value ?? '')
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const header = ['Bet ID', 'Product', 'Status', 'Wallet', 'Campaign', 'Stake', 'Return', 'Net', 'Currency', 'Created']
  const values = rows.map(row => [row.id, row.product, row.status, String(row.walletType || 'cash'), row.campaign?.name || '', row.stake || 0, row.return ?? '', row.netAmount ?? '', row.currency, row.createdAt])
  return [header, ...values].map(row => row.map(quote).join(',')).join('\n')
}
