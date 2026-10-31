import type { LiveFeature } from './LiveWorkspace'
import type { StatDelta, StatHue } from '@/ui/components/Stat'
import type { StatusPillTone } from '@/ui/components/StatusPill'

export interface LiveStatsTrends {
  stakeTrend?: number
  exposureTrend?: number
  ggrTrend?: number
  wageredTrend?: number
  betsTrend?: number
  playersTrend?: number
}

export interface LiveMetric {
  key: string
  label: string
  value: number
  format: 'money' | 'count' | 'rate' | 'odds' | 'percent'
  tooltip: string
  hue: StatHue
  delta?: StatDelta
  quality?: { label: string; tone: StatusPillTone }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function finite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function delta(value: number | undefined): StatDelta | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return { value: `${Math.abs(value).toFixed(1)}%`, dir: value >= 0 ? 'up' : 'down' }
}

export function liveMetrics(feature: LiveFeature, dashboard: unknown,
  trends: LiveStatsTrends | null, windowMins = 10): LiveMetric[] {
  if (!isRecord(dashboard) || !isRecord(dashboard.kpis)) return []
  const k = dashboard.kpis
  const n = (key: string) => finite(k[key])
  if (feature === 'sports') return [
    { key: 'stake', label: 'Total Stake', value: n('totalStake'), format: 'money',
      tooltip: 'Total stake from all open bets', hue: 'blu', delta: delta(trends?.stakeTrend) },
    { key: 'liability', label: 'Liability', value: n('totalLiability'), format: 'money',
      tooltip: 'Total liability from all open bets', hue: 'red' },
    { key: 'markets', label: 'Markets', value: n('activeMarkets'), format: 'count',
      tooltip: 'Number of active running markets', hue: 'grn' },
    { key: 'players', label: 'Players', value: n('activePlayers'), format: 'count',
      tooltip: 'Number of active players with open bets', hue: 'vio', delta: delta(trends?.playersTrend) },
    { key: 'bets', label: 'Bets/Min', value: n('betsPerMin'), format: 'rate',
      tooltip: 'Average bets per minute', hue: 'amb' },
    { key: 'odds', label: 'Avg Odds', value: n('avgOdds'), format: 'odds',
      tooltip: 'Average odds across all bets', hue: 'ind' },
  ]
  if (feature === 'casino') {
    const rtp = n('rtp')
    const margin = n('wagered') > 0 ? n('ggr') / n('wagered') * 100 : 0
    return [
      { key: 'wagered', label: 'Wagered', value: n('wagered'), format: 'money',
        tooltip: `Total wagered in last ${windowMins} minutes`, hue: 'blu', delta: delta(trends?.ggrTrend) },
      { key: 'ggr', label: 'GGR', value: n('ggr'), format: 'money',
        tooltip: `Gross Gaming Revenue in last ${windowMins} minutes`, hue: 'grn', delta: delta(trends?.ggrTrend) },
      { key: 'rtp', label: 'RTP', value: rtp, format: 'percent',
        tooltip: 'Return to Player percentage', hue: 'vio',
        quality: rtp < 95 ? { label: 'Good', tone: 'ok' } : rtp < 105 ? { label: 'Fair', tone: 'warn' } : { label: 'High', tone: 'neg' } },
      { key: 'bets', label: 'Bets/Min', value: n('betsPerMin'), format: 'rate',
        tooltip: `Average bets per minute in last ${windowMins} minutes`, hue: 'amb', delta: delta(trends?.betsTrend) },
      { key: 'players', label: 'Players', value: n('activePlayers'), format: 'count',
        tooltip: `Active players in last ${windowMins} minutes`, hue: 'vio', delta: delta(trends?.playersTrend) },
      { key: 'payouts', label: 'Payouts', value: n('payouts'), format: 'money',
        tooltip: `Total payouts in last ${windowMins} minutes`, hue: 'red' },
      { key: 'margin', label: 'House Edge', value: margin, format: 'percent',
        tooltip: 'House edge percentage (GGR / Wagered)', hue: 'ind',
        quality: margin > 5 ? { label: 'Strong', tone: 'ok' } : margin > 2 ? { label: 'Normal', tone: 'warn' } : { label: 'Low', tone: 'neg' } },
    ]
  }
  const breakdown = isRecord(dashboard.breakdown) ? dashboard.breakdown : undefined
  const byType = Array.isArray(breakdown?.byType) ? breakdown.byType : []
  const bets = byType.reduce((sum: number, stat: unknown) => sum + (isRecord(stat) ? finite(stat.bets) : 0), 0)
  return [
    { key: 'wagered', label: 'Wagered', value: n('wagered'), format: 'money',
      tooltip: 'Total wagered (open bets)', hue: 'blu', delta: delta(trends?.wageredTrend) },
    { key: 'exposure', label: 'Exposure', value: Math.max(0, n('wagered') - n('payouts')), format: 'money',
      tooltip: 'Net exposure (Wagered - Potential Payouts)', hue: 'red' },
    { key: 'bets', label: 'Bets/Min', value: n('betsPerMin'), format: 'rate',
      tooltip: 'Average bets per minute (open bets)', hue: 'amb', delta: delta(trends?.betsTrend) },
    { key: 'players', label: 'Players', value: n('activePlayers'), format: 'count',
      tooltip: 'Active players (open bets)', hue: 'vio', delta: delta(trends?.playersTrend) },
    { key: 'payouts', label: 'Potential Payouts', value: n('payouts'), format: 'money',
      tooltip: 'Potential payouts (open bets)', hue: 'grn' },
    { key: 'total-bets', label: 'Total Bets', value: bets, format: 'count',
      tooltip: 'Total open bets across all Matka types', hue: 'ind' },
  ]
}

export function formatLiveMetric(metric: LiveMetric, money: (value: number) => string) {
  switch (metric.format) {
    case 'money': return money(metric.value)
    case 'count': return metric.value.toLocaleString()
    case 'rate': return metric.value.toFixed(1)
    case 'odds': return metric.value.toFixed(2)
    case 'percent': return `${metric.value.toFixed(2)}%`
  }
}
