import { useQuery } from '@apollo/client'
import { IconCalendarStats, IconFlame } from '@tabler/icons-react'
import { DASHBOARD_TIME_TAB_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { FigureSection, type Figure } from './FigureSection'
import { WEEKDAYS, count, hourLabel, periodLabel, plural, useWholeMoney } from './insightFormat'
import { ColumnChart, HeatGrid } from './TabCharts'
import styles from './DashboardTabs.module.css'

/* The Time tab, rebuilt on Query.dashboardTimeTab (the owner's redesign, 2026-10-29): when players bet, by
   IST weekday and hour (a heatmap), the hourly and weekday profiles, the peaks, and this month's run rate
   against last month to the same day. The run rate is arithmetic, not a forecast: month to date divided
   by the days gone, times the days in the month. A period under a week reads the last 30 days instead,
   and the cards say so. */

interface TimeTabData {
  windowFrom: string
  windowTo: string
  windowDays: number
  widened: boolean
  heatmap: Array<{ weekday: number; hour: number; bets: number; stake: number }>
  hourly: Array<{ hour: number; bets: number; stake: number; ggr: number; players: number }>
  weekdays: Array<{ weekday: number; bets: number; stake: number; ggr: number; players: number }>
  month: {
    month: string
    daysElapsed: number
    daysInMonth: number
    ggr: number
    turnover: number
    bets: number
    previousGgr: number
    previousTurnover: number
    previousBets: number
  }
}

/** The figure against last month to the same day: "▲ 12.5% vs ₹40,000", green up and rose down. */
function versus(current: number, previous: number, show: (value: number) => string): Pick<Figure, 'note' | 'accent'> {
  if (previous === 0) return { note: current !== 0 ? 'Nothing last month to this day' : 'None this month or last' }
  const pct = ((current - previous) / Math.abs(previous)) * 100
  return { note: `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% vs ${show(previous)} last month`, accent: pct >= 0 ? 'green' : 'rose' }
}

export function TimeTab() {
  const { getDateRangeForQuery, filters } = useDashboardStore()
  const money = useWholeMoney()
  const { data, loading, error } = useQuery(DASHBOARD_TIME_TAB_QUERY, {
    variables: { dateRange: getDateRangeForQuery() },
    pollInterval: 120000,
    errorPolicy: 'all',
  })
  if (error && !data) return <Notice tone="error" title="Time analysis unavailable">{error.message}</Notice>
  const d: TimeTabData | undefined = data?.dashboardTimeTab
  const pending = loading && !data
  if (!d) return <LoadingState height={520} label="Loading time analysis" />

  const span = d.widened ? `Last ${d.windowDays} days (the period is under a week)` : periodLabel(filters?.dateRange?.preset)
  const busiestHour = d.hourly.reduce((best, row) => (row.bets > best.bets ? row : best), d.hourly[0] ?? { hour: 0, bets: 0, stake: 0, ggr: 0, players: 0 })
  const quietHour = d.hourly.reduce((low, row) => (row.bets < low.bets ? row : low), d.hourly[0] ?? { hour: 0, bets: 0, stake: 0, ggr: 0, players: 0 })
  const busiestDay = d.weekdays.reduce((best, row) => (row.bets > best.bets ? row : best), d.weekdays[0] ?? { weekday: 1, bets: 0, stake: 0, ggr: 0, players: 0 })
  const bestGgrHour = d.hourly.reduce((best, row) => (row.ggr > best.ggr ? row : best), d.hourly[0] ?? { hour: 0, bets: 0, stake: 0, ggr: 0, players: 0 })
  const totalBets = d.hourly.reduce((sum, row) => sum + row.bets, 0)
  const any = totalBets > 0

  const m = d.month
  const project = (value: number) => (m.daysElapsed > 0 ? (value / m.daysElapsed) * m.daysInMonth : 0)
  const monthName = new Date(`${m.month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className={styles.tab}>
      <FigureSection title="Peak Times" sub={`${span} · IST`} icon={IconFlame} accent="amber" pending={pending} figures={[
        { label: 'Busiest Hour', value: any ? hourLabel(busiestHour.hour) : '—', note: any ? `${plural(busiestHour.bets, 'bet')} · ${money(busiestHour.stake)} staked` : 'No bets in this window', accent: any ? 'amber' : undefined },
        { label: 'Busiest Day', value: any ? WEEKDAYS[busiestDay.weekday - 1] : '—', note: any ? `${plural(busiestDay.bets, 'bet')} · ${money(busiestDay.stake)} staked` : 'No bets in this window' },
        { label: 'Quietest Hour', value: any ? hourLabel(quietHour.hour) : '—', note: any ? plural(quietHour.bets, 'bet') : 'No bets in this window' },
        { label: 'Best GGR Hour', value: any && bestGgrHour.ggr > 0 ? hourLabel(bestGgrHour.hour) : '—', note: any && bestGgrHour.ggr > 0 ? `${money(bestGgrHour.ggr)} GGR` : 'No hour ended in profit', accent: any && bestGgrHour.ggr > 0 ? 'green' : undefined },
        { label: 'Bets per Day', value: (totalBets / Math.max(1, d.windowDays)).toFixed(1), note: `${count(totalBets)} over ${plural(d.windowDays, 'day')}` },
      ]} />

      <Card title="When Players Bet" sub={`${span} · bets by IST weekday and hour`} accent="blue">
        <HeatGrid unit="bets" format={count} cells={d.heatmap.map((cell) => ({ weekday: cell.weekday, hour: cell.hour, value: cell.bets }))} />
      </Card>

      <div className={styles.pair}>
        <Card title="By Hour" sub={`${span} · bets placed in each IST hour`}>
          <ColumnChart
            label="Bets by hour"
            categories={d.hourly.map((row) => String(row.hour).padStart(2, '0'))}
            series={[{ name: 'Bets', accent: 'blue', values: d.hourly.map((row) => row.bets) }]}
            format={count}
            axis={(value) => count(value)}
          />
        </Card>
        <Card title="By Weekday" sub={`${span} · staked and GGR`}>
          <ColumnChart
            label="Staked and GGR by weekday"
            categories={d.weekdays.map((row) => WEEKDAYS[row.weekday - 1])}
            series={[
              { name: 'Staked', accent: 'violet', values: d.weekdays.map((row) => row.stake) },
              { name: 'GGR', accent: 'green', values: d.weekdays.map((row) => row.ggr) },
            ]}
            format={money}
          />
        </Card>
      </div>

      <FigureSection title="This Month's Run Rate" sub={`${monthName} · day ${m.daysElapsed} of ${m.daysInMonth}, against last month to the same day`} icon={IconCalendarStats} accent="blue" pending={pending} figures={[
        { label: 'GGR So Far', value: money(m.ggr), ...versus(m.ggr, m.previousGgr, money) },
        { label: 'GGR at This Pace', value: money(project(m.ggr)), note: `${money(m.ggr / Math.max(1, m.daysElapsed))} a day × ${m.daysInMonth} days`, accent: m.ggr < 0 ? 'rose' : m.ggr > 0 ? 'green' : undefined },
        { label: 'Turnover So Far', value: money(m.turnover), ...versus(m.turnover, m.previousTurnover, money) },
        { label: 'Turnover at This Pace', value: money(project(m.turnover)), note: `${money(m.turnover / Math.max(1, m.daysElapsed))} a day` },
        { label: 'Bets So Far', value: count(m.bets), ...versus(m.bets, m.previousBets, count) },
        { label: 'Bets at This Pace', value: count(Math.round(project(m.bets))), note: `${(m.bets / Math.max(1, m.daysElapsed)).toFixed(1)} a day` },
      ]} />
    </div>
  )
}
