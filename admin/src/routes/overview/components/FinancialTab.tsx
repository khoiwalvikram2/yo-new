import { useMemo } from 'react'
import { useQuery } from '@apollo/client'
import { DASHBOARD_TRENDS_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import type { Accent } from '@/ui/components/accent'
import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/ui/components/Table'
import { count, formatShare, periodLabel, ratio, useWholeMoney } from './insightFormat'
import { ColumnChart, SplitBar } from './TabCharts'
import { DrillButton } from './DrilldownDialog'
import type { DrillRequest } from './drilldownContext'
import styles from './DashboardTabs.module.css'

/* The Financial tab's own cards (the owner's redesign, 2026-10-29): the period's money as a statement
   (cash in and out, then GGR down to NGR) from the period KPIs, the daily money and GGR from
   Query.dashboardTrends with every day of the period drawn (a quiet day is a zero, not a gap), and the
   products side by side. The Financial Summary, Casino Providers and Bonus Analysis follow it on the tab. */

export interface FinancialKpis {
  totalDeposits?: number
  totalWithdrawals?: number
  netDeposits?: number
  turnover?: number
  ggr?: number
  ngr?: number
  agentCommission?: number
  bonusPayouts?: number
  sportsGGR?: number
  casinoGGR?: number
  matkaGGR?: number
  sportsTurnover?: number
  casinoTurnover?: number
  matkaTurnover?: number
  sportsBets?: number
  casinoBets?: number
  matkaBets?: number
}

interface TrendPoint {
  date: string
  ggr?: number
  deposits?: number
  withdrawals?: number
}

/** The daily charts draw at most this many days; a longer period shows its last ones. */
const MAX_DAYS = 62
const IST_MS = 330 * 60_000
const DAY_MS = 86_400_000

/** Every IST day of the period, oldest first, as "YYYY-MM-DD". */
function periodDays(dateFrom?: string, dateTo?: string): string[] {
  const to = dateTo ? Date.parse(dateTo) : Date.now()
  const from = dateFrom ? Date.parse(dateFrom) : to
  const istDay = (t: number) => new Date(t + IST_MS).toISOString().slice(0, 10)
  const days: string[] = []
  for (let t = Math.max(from, to - (MAX_DAYS - 1) * DAY_MS); istDay(t) <= istDay(to) && days.length < MAX_DAYS; t += DAY_MS) {
    const day = istDay(t)
    if (days[days.length - 1] !== day) days.push(day)
  }
  return days
}

const shortDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`)
  return `${date.getUTCDate()} ${date.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}`
}

interface Line {
  label: string
  value: number
  accent: Accent
  total?: boolean
  /** Shown as a deduction: the figure is printed with its minus. */
  minus?: boolean
  /** The rows behind the line, for the drill-down modal. */
  drill?: DrillRequest
}

/** One block of the statement: its lines with bars against the block's largest figure. */
function Statement({ lines, money }: { lines: Line[]; money: (value: number) => string }) {
  const max = Math.max(1, ...lines.map((line) => Math.abs(line.value)))
  return (
    <>
      {lines.map((line) => {
        const tone = line.total ? (line.value < 0 ? styles.loss : styles.gain) : line.minus ? styles.loss : ''
        return (
          <div key={line.label} className={line.total ? `${styles.line} ${styles.lineTotal}` : styles.line}>
            <dt>{line.drill ? <DrillButton drill={{ title: line.label, ...line.drill }}>{line.label}</DrillButton> : line.label}</dt>
            <dd data-accent={line.accent}><Meter className={styles.lineBar} value={(Math.abs(line.value) / max) * 100} /></dd>
            <dd className={`${styles.lineValue} ${tone}`}>{line.minus && line.value !== 0 ? `− ${money(Math.abs(line.value))}` : money(line.value)}</dd>
          </div>
        )
      })}
    </>
  )
}

export function FinancialTab({ kpis }: { kpis?: FinancialKpis }) {
  const { getDateRangeForQuery, filters } = useDashboardStore()
  const period = periodLabel(filters?.dateRange?.preset)
  const money = useWholeMoney()
  const dateRange = getDateRangeForQuery()
  const { data, loading } = useQuery(DASHBOARD_TRENDS_QUERY, {
    variables: { dateRange },
    pollInterval: 120000,
    errorPolicy: 'all',
  })
  const days = useMemo(() => periodDays(dateRange?.dateFrom, dateRange?.dateTo), [dateRange?.dateFrom, dateRange?.dateTo])
  const byDay = useMemo(() => {
    const map = new Map<string, TrendPoint>()
    for (const point of (data?.dashboardTrends ?? []) as TrendPoint[]) map.set(String(point.date).slice(0, 10), point)
    return map
  }, [data])
  const pick = (key: keyof TrendPoint) => days.map((day) => Number(byDay.get(day)?.[key] ?? 0))

  const k = kpis ?? {}
  const products = [
    { key: 'sports', label: 'Sports', accent: 'blue' as Accent, turnover: k.sportsTurnover ?? 0, ggr: k.sportsGGR ?? 0, bets: k.sportsBets ?? 0 },
    { key: 'casino', label: 'Casino', accent: 'violet' as Accent, turnover: k.casinoTurnover ?? 0, ggr: k.casinoGGR ?? 0, bets: k.casinoBets ?? 0 },
    { key: 'matka', label: 'Matka', accent: 'amber' as Accent, turnover: k.matkaTurnover ?? 0, ggr: k.matkaGGR ?? 0, bets: k.matkaBets ?? 0 },
  ]
  const totalTurnover = products.reduce((sum, p) => sum + p.turnover, 0)
  const totalGgr = products.reduce((sum, p) => sum + p.ggr, 0)
  const totalBets = products.reduce((sum, p) => sum + p.bets, 0)
  const dayLabels = days.map(shortDay)

  return (
    <div className={styles.tab}>
      <div className={`${styles.pair} ${styles.wideFirst}`}>
        <Card title="Money Flow" sub={`${period} · cash in and out, then GGR down to NGR`} body="flush">
          <dl className={styles.statement}>
            <Statement money={money} lines={[
              { label: 'Deposits', value: k.totalDeposits ?? 0, accent: 'green', drill: { kind: 'deposits' } },
              { label: 'Withdrawals', value: k.totalWithdrawals ?? 0, accent: 'rose', minus: true, drill: { kind: 'withdrawals' } },
              { label: 'Net deposits', value: k.netDeposits ?? 0, accent: 'blue', total: true, drill: { kind: 'net_deposits' } },
            ]} />
          </dl>
          <dl className={styles.statement}>
            <Statement money={money} lines={[
              { label: 'Turnover (settled stakes)', value: k.turnover ?? 0, accent: 'cyan', drill: { kind: 'turnover_players', title: 'Turnover by player' } },
              { label: 'GGR', value: k.ggr ?? 0, accent: (k.ggr ?? 0) < 0 ? 'rose' : 'green', drill: { kind: 'ggr_players', title: 'GGR by player' } },
              { label: 'Agent commission', value: k.agentCommission ?? 0, accent: 'violet', minus: true },
              { label: 'Bonus paid', value: k.bonusPayouts ?? 0, accent: 'amber', minus: true },
              { label: 'NGR', value: k.ngr ?? 0, accent: 'blue', total: true },
            ]} />
          </dl>
        </Card>
        <Card title="Products" sub={`${period} · settled bets`}>
          <div className={styles.stack}>
            <SplitBar title="Turnover by product" format={money} segments={products.map((p) => ({ label: p.label, value: p.turnover, accent: p.accent }))} />
            <Table caption="Products by turnover" width="fill" inset>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH align="right">GGR</TH>
                  <TH align="right">Hold</TH>
                  <TH align="right">Bets</TH>
                </TR>
              </THead>
              <TBody>
                {products.map((p) => (
                  <TR key={p.key}>
                    <TD emphasis="key">{p.label}</TD>
                    <TD align="right" tone={p.ggr < 0 ? 'neg' : p.ggr > 0 ? 'pos' : undefined}>{money(p.ggr)}</TD>
                    <TD align="right">{formatShare(ratio(p.ggr, p.turnover))}</TD>
                    <TD align="right">{count(p.bets)}</TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD emphasis="key">All products</TD>
                  <TD align="right" emphasis="key" tone={totalGgr < 0 ? 'neg' : totalGgr > 0 ? 'pos' : undefined}>{money(totalGgr)}</TD>
                  <TD align="right" emphasis="key">{formatShare(ratio(totalGgr, totalTurnover))}</TD>
                  <TD align="right" emphasis="key">{count(totalBets)}</TD>
                </TR>
              </TFoot>
            </Table>
          </div>
        </Card>
      </div>

      <div className={styles.pair}>
        <Card title="Money In & Out" sub={`Per IST day · ${days.length} days`}>
          {loading && !data ? <LoadingState height={220} label="Loading daily money" /> : (
            <ColumnChart
              label="Daily deposits and withdrawals"
              categories={dayLabels}
              series={[
                { name: 'Deposits', accent: 'green', values: pick('deposits') },
                { name: 'Withdrawals', accent: 'rose', values: pick('withdrawals') },
              ]}
              format={money}
            />
          )}
        </Card>
        <Card title="Daily GGR" sub={`Per IST day · the house's gain or loss`}>
          {loading && !data ? <LoadingState height={220} label="Loading daily GGR" /> : (
            <ColumnChart label="Daily GGR" categories={dayLabels} series={[{ name: 'GGR', accent: 'green', values: pick('ggr') }]} format={money} signed />
          )}
        </Card>
      </div>
    </div>
  )
}
