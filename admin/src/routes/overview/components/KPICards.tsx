import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import clsx from 'clsx'
import { IconChartBar, IconCoins, IconReceipt, IconTrendingUp } from '@tabler/icons-react'
import { DASHBOARD_KPIS_QUERY, DASHBOARD_TRENDS_QUERY } from '../graphql'
import { useDashboardStore, type DateRangePreset } from '@/state/dashboardStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { nowIST } from '@/shared/utils/date'
import { Stat, type StatHue } from '@/ui/components/Stat'
import type { Accent } from '@/ui/components/accent'
import { DrillButton } from './DrilldownDialog'
import styles from './KpiCards.module.css'

/** Every tabler glyph shares one component type; this is the least brittle way to name it. */
type TablerIcon = typeof IconTrendingUp

/** The comparison line under each delta: the previous window of the same length, named for the preset. */
const COMPARISON: Record<DateRangePreset, string> = {
  today: 'vs yesterday',
  yesterday: 'vs the day before',
  last7days: 'vs previous 7 days',
  last30days: 'vs previous 30 days',
  thisMonth: 'vs previous period',
  lastMonth: 'vs previous period',
  custom: 'vs previous period',
}

/** The sparklines' window: the kit draws the last 14 days, whatever period the cards show. */
const SPARK_DAYS = 14

/** A step of the decorative hue ramp — the player skin draws every tile charcoal; it carries no meaning. */
type Hue = 1 | 2 | 3 | 4

const STAT_HUE: Record<Hue, StatHue> = {
  1: 'ind',
  2: 'red',
  3: 'grn',
  4: 'vio',
}

/* ===================== TOOLTIP BREAKDOWN ===================== */

interface TooltipBreakdownRow {
  label: string
  value: string
  /** When true, the row is shown as a total with a rule above it and added emphasis. */
  isTotal?: boolean
}

function TooltipBreakdown({
  title = 'Breakdown',
  rows,
  highlightLastRow = true,
}: {
  title?: string
  rows: TooltipBreakdownRow[]
  highlightLastRow?: boolean
}) {
  return (
    <div className={styles.tip}>
      <div className={styles.tipHead}>{title}</div>
      <div>
        {rows.map((row, i) => {
          const isLast = i === rows.length - 1
          const showAsTotal = row.isTotal ?? (highlightLastRow && isLast)
          return (
            <div key={row.label} className={clsx(styles.tipRow, showAsTotal && styles.tipTotal)}>
              <span className={styles.tipLabel}>{row.label}</span>
              <span className={styles.tipValue}>{row.value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ===================== ONE CARD ===================== */

interface Trend {
  percent: number
  isPositive: boolean
}

/** What a comparing card lays out under its placeholder while a period loads, so its delta line is reserved. */
const PENDING_TREND: Trend = { percent: 0, isPositive: true }

interface KpiCardProps {
  label: string
  value: ReactNode
  icon: TablerIcon
  hue: Hue
  trend?: Trend
  /** The line beside the delta: the comparison, or what the figure counts. */
  trendNote: string
  /** Stands in for the delta line on a card that has no trend to show. */
  note?: ReactNode
  tooltip: ReactNode
  /** Waiting for its figures: the value and comparison line become placeholders of the same height. */
  loading?: boolean
  /** The last 14 days, oldest first; [] keeps the slot while the series loads. */
  spark?: readonly number[]
  /** For a card with no series: the content of the same slot. */
  footer?: ReactNode
  /** The card's colour: its tile, top rule and sparkline. */
  accent: Accent
}

/**
 * The kit's dashboard stat (kit .stat, the Overview screen): a 40px charcoal tile, a caps label, a
 * 26px figure, a tinted delta chip with its comparison, and a 14-day sparkline across the card's foot
 * whose latest point is red. Figures are whole rupees, as the kit prints them.
 */
function KpiCard({ label, value, icon: Glyph, hue, trend, trendNote, note, tooltip, loading, spark, footer, accent }: KpiCardProps) {
  return (
    <Stat
      label={label}
      value={value}
      icon={<Glyph size={19} stroke={1.8} />}
      hue={STAT_HUE[hue]}
      accent={accent}
      delta={trend ? {
        value: `${Math.abs(trend.percent).toFixed(1)}%`,
        dir: trend.isPositive ? 'up' : 'down',
        note: trendNote,
      } : undefined}
      note={trend ? undefined : (note ?? trendNote)}
      tooltip={tooltip}
      loading={loading}
      spark={spark}
      footer={footer}
    />
  )
}

/* ===================== DATA ===================== */

interface TrendPoint {
  date: string
  turnover?: number
  ggr?: number
  ngr?: number
  deposits?: number
  withdrawals?: number
  activePlayers?: number
  betCount?: number
}

/** The Gross Revenue card's foot: its two parts as a bar of shares over a one-line legend, each part in
    the colour of its own card (GGR green; commission violet, as Net GGR, which it comes out of). */
function RevenueSplit({ parts, format }: { parts: ReadonlyArray<{ label: string; amount: number; accent: Accent }>; format: (value: number) => string }) {
  const shown = parts.filter((part) => part.amount > 0)
  const total = shown.reduce((sum, part) => sum + part.amount, 0)
  // Nothing to split (GGR at or below zero, no commission): say what the parts were rather than "no revenue".
  if (!total) return <span className={styles.splitEmpty}>{parts.map((part) => `${part.label} ${format(part.amount)}`).join(' · ')}</span>
  const share = (amount: number) => (amount / total) * 100
  return (
    <span className={styles.split}>
      <span className={styles.splitBar} aria-hidden="true">
        {shown.map((part, index) => (
          <span key={part.label} className={styles.splitSeg} data-step={index} data-accent={part.accent} style={{ flexGrow: Math.max(share(part.amount), 1) }} />
        ))}
      </span>
      <span className={styles.splitLegend}>
        {shown.map((part) => (
          <span key={part.label} className={styles.splitKey} data-accent={part.accent}>{`${part.label} ${share(part.amount).toFixed(0)}%`}</span>
        ))}
      </span>
    </span>
  )
}

/* The owner's four (2026-10-29): Gross Revenue, GGR, Net GGR and Turnover. Gross Revenue is GGR plus the
   commission paid to agents, the house's take before it pays them; Net GGR is GGR after that commission
   and bonuses (Query.overviewKPIs' ngr). Each figure opens the rows that add up to it: Gross Revenue and
   Net GGR list their parts (GGR by player, each top-level agent's commission, each bonus paid), not GGR
   alone. The operations figures sit in OperationsSections below. */
export function KPICards() {
  const { getDateRangeForQuery, filters } = useDashboardStore()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const dateRange = getDateRangeForQuery()
  const preset: DateRangePreset = filters?.dateRange?.preset ?? 'custom'
  const comparison = COMPARISON[preset] ?? COMPARISON.custom

  const { data, loading, error } = useQuery(DASHBOARD_KPIS_QUERY, {
    variables: { dateRange },
    pollInterval: 60000,
    errorPolicy: 'all',
  })

  const previousDateRange = useMemo(() => {
    if (!dateRange?.dateFrom || !dateRange?.dateTo) return undefined
    const from = new Date(dateRange.dateFrom)
    const to = new Date(dateRange.dateTo)
    const diff = to.getTime() - from.getTime()
    return {
      dateFrom: new Date(from.getTime() - diff).toISOString(),
      dateTo: from.toISOString(),
    }
  }, [dateRange])

  const { data: previousData, loading: previousLoading } = useQuery(DASHBOARD_KPIS_QUERY, {
    variables: { dateRange: previousDateRange },
    skip: !previousDateRange,
    errorPolicy: 'all',
  })

  // The sparklines' own window, fixed when the row mounts: the last 14 IST days with today included,
  // and those days' keys, so a day with no activity draws as 0 rather than dropping out of the line.
  const { sparkRange, sparkDays } = useMemo(() => {
    const now = nowIST()
    return {
      sparkRange: {
        dateFrom: now.subtract(SPARK_DAYS - 1, 'day').startOf('day').toDate().toISOString(),
        dateTo: now.endOf('day').toDate().toISOString(),
      },
      sparkDays: Array.from({ length: SPARK_DAYS }, (_, index) => now.subtract(SPARK_DAYS - 1 - index, 'day').format('YYYY-MM-DD')),
    }
  }, [])
  const { data: trendsData, loading: trendsLoading } = useQuery(DASHBOARD_TRENDS_QUERY, {
    variables: { dateRange: sparkRange },
    pollInterval: 60000,
    errorPolicy: 'all',
  })

  const kpis = data?.overviewKPIs
  const prev = previousData?.overviewKPIs
  // Whole rupees, as the kit prints its figures; a loss keeps its minus in front of the currency.
  const fmt = (val: number) => `${val < 0 ? '-' : ''}${formatAmount(convertFromWhitelabelCurrency(Math.abs(val)), undefined, { fractionDigits: 0 })}`
  // Until both periods answer the cards hold their height with placeholders; a refetch keeps the last figures.
  const pending = (loading && !data) || (previousLoading && !previousData)

  const trend = (cur: number, pre?: number): Trend | undefined => {
    if (pending && previousDateRange) return PENDING_TREND
    if (pre === undefined || pre === 0) return undefined
    const pct = ((cur - pre) / Math.abs(pre)) * 100
    return { percent: pct, isPositive: pct >= 0 }
  }

  const byDay = new Map<string, TrendPoint>(((trendsData?.dashboardTrends ?? []) as TrendPoint[]).map((point) => [String(point.date).slice(0, 10), point]))
  const series = (pick: (point: TrendPoint) => number | undefined): readonly number[] => {
    if (trendsLoading && !trendsData) return []
    return sparkDays.map((day) => { const point = byDay.get(day); return point ? Number(pick(point) ?? 0) : 0 })
  }

  if (error && !data && !loading) {
    return (
      <div className={styles.error}>
        <p>Failed to load KPIs: {error.message}</p>
      </div>
    )
  }

  const turnover = kpis?.turnover || 0
  const ggr = kpis?.ggr || 0
  const ngr = kpis?.ngr || 0
  const agentCommission = kpis?.agentCommission ?? 0
  const bonusPayouts = kpis?.bonusPayouts ?? 0
  const grossRevenue = ggr + agentCommission
  const prevGrossRevenue = prev ? Number(prev.ggr ?? 0) + Number(prev.agentCommission ?? 0) : undefined

  const sportsGGR = kpis?.sportsGGR ?? 0
  const casinoGGR = kpis?.casinoGGR ?? 0
  const matkaGGR = kpis?.matkaGGR ?? 0
  const sportsTurnover = kpis?.sportsTurnover ?? 0
  const casinoTurnover = kpis?.casinoTurnover ?? 0
  const matkaTurnover = kpis?.matkaTurnover ?? 0

  const grossTooltip = (
    <TooltipBreakdown
      title="Gross revenue"
      rows={[
        { label: 'GGR', value: fmt(ggr) },
        { label: '+ Agent commission', value: fmt(agentCommission) },
        { label: 'Gross revenue', value: fmt(grossRevenue), isTotal: true },
      ]}
    />
  )
  const ggrTooltip = (
    <TooltipBreakdown
      title="GGR by product"
      rows={[
        { label: 'Sports', value: fmt(sportsGGR) },
        { label: 'Casino', value: fmt(casinoGGR) },
        { label: 'Matka', value: fmt(matkaGGR) },
        { label: 'GGR', value: fmt(ggr), isTotal: true },
      ]}
    />
  )
  const ngrTooltip = (
    <TooltipBreakdown
      title="Net GGR"
      rows={[
        { label: 'GGR', value: fmt(ggr) },
        { label: '− Agent commission', value: fmt(agentCommission) },
        { label: '− Bonus payouts', value: fmt(bonusPayouts) },
        { label: 'Net GGR', value: fmt(ngr), isTotal: true },
      ]}
    />
  )
  const turnoverTooltip = (
    <TooltipBreakdown
      title="Turnover by product"
      rows={[
        { label: 'Sports', value: fmt(sportsTurnover) },
        { label: 'Casino', value: fmt(casinoTurnover) },
        { label: 'Matka', value: fmt(matkaTurnover) },
        { label: 'Total turnover', value: fmt(turnover), isTotal: true },
      ]}
    />
  )

  // The grid sits inside .kpiRow, the container its four-across step queries: a container cannot
  // query itself. KpiCards.module.css (KPI ROW) explains why that step is not a viewport query.
  return (
    <div className={styles.kpiRow}>
      <div className={styles.kpis} aria-busy={pending || undefined}>
        <KpiCard
          label="Gross Revenue"
          accent="blue"
          value={<DrillButton drill={{ kind: 'gross_revenue', title: 'Gross revenue' }}>{fmt(grossRevenue)}</DrillButton>}
          icon={IconCoins}
          hue={1}
          trend={trend(grossRevenue, prevGrossRevenue)}
          trendNote={comparison}
          note="GGR plus agent commission"
          tooltip={grossTooltip}
          loading={pending}
          footer={<RevenueSplit format={fmt} parts={[{ label: 'GGR', amount: ggr, accent: 'green' }, { label: 'Commission', amount: agentCommission, accent: 'violet' }]} />}
        />
        <KpiCard
          label="GGR"
          accent="green"
          value={<DrillButton drill={{ kind: 'ggr_players', title: 'GGR by player' }}>{fmt(ggr)}</DrillButton>}
          icon={IconReceipt}
          hue={2}
          trend={trend(ggr, prev?.ggr)}
          trendNote={comparison}
          note="Stakes minus winnings"
          tooltip={ggrTooltip}
          loading={pending}
          spark={series((point) => point.ggr)}
        />
        <KpiCard
          label="Net GGR"
          accent="violet"
          value={<DrillButton drill={{ kind: 'net_ggr', title: 'Net GGR' }}>{fmt(ngr)}</DrillButton>}
          icon={IconTrendingUp}
          hue={3}
          trend={trend(ngr, prev?.ngr)}
          trendNote="after commission and bonus"
          tooltip={ngrTooltip}
          loading={pending}
          spark={series((point) => point.ngr)}
        />
        <KpiCard
          label="Turnover"
          accent="amber"
          value={<DrillButton drill={{ kind: 'turnover_players', title: 'Turnover by player' }}>{fmt(turnover)}</DrillButton>}
          icon={IconChartBar}
          hue={4}
          trend={trend(turnover, prev?.turnover)}
          trendNote={comparison}
          note="Total stakes"
          tooltip={turnoverTooltip}
          loading={pending}
          spark={series((point) => point.turnover)}
        />
      </div>
    </div>
  )
}
