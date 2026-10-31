import { useQuery } from '@apollo/client'
import { IconRepeat, IconUsers } from '@tabler/icons-react'
import { DASHBOARD_PLAYER_RETENTION_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import { Notice } from '@/ui/components/Notice'
import { FigureSection } from './FigureSection'
import { count, formatShare, periodLabel, plural, ratio } from './insightFormat'

/* The Players tab's retention and conversion (the owner's ask, 2026-10-29), from
   Query.dashboardPlayerRetention. "Active" means placed a bet, the one activity every product records.
   Daily, weekly and monthly are trailing windows from now; the rest follow the period. */

interface Retention {
  dailyActive: number
  weeklyActive: number
  monthlyActive: number
  activeInPeriod: number
  activePrevious: number
  returning: number
  newPlayers: number
  newDepositors: number
  repeatDepositors: number
  depositors: number
  lapsing: number
}

export function RetentionSections() {
  const { getDateRangeForQuery, filters } = useDashboardStore()
  const period = periodLabel(filters?.dateRange?.preset)
  const { data, loading, error } = useQuery(DASHBOARD_PLAYER_RETENTION_QUERY, {
    variables: { dateRange: getDateRangeForQuery() },
    pollInterval: 120000,
    errorPolicy: 'all',
  })
  if (error && !data) return <Notice tone="error" title="Retention figures unavailable">{error.message}</Notice>
  const pending = loading && !data
  const r: Retention = data?.dashboardPlayerRetention ?? {
    dailyActive: 0, weeklyActive: 0, monthlyActive: 0, activeInPeriod: 0, activePrevious: 0, returning: 0,
    newPlayers: 0, newDepositors: 0, repeatDepositors: 0, depositors: 0, lapsing: 0,
  }
  return (
    <>
      <FigureSection title="Active Players" sub="Placed a bet · trailing windows from now" icon={IconUsers} accent="violet" pending={pending} figures={[
        { label: 'Daily Active', value: count(r.dailyActive), note: 'Since midnight IST', accent: 'violet', drill: { kind: 'bettors', arg: 'today' } },
        { label: 'Weekly Active', value: count(r.weeklyActive), note: 'Last 7 days', drill: { kind: 'bettors', arg: 'mins:10080' } },
        { label: 'Monthly Active', value: count(r.monthlyActive), note: 'Last 30 days', drill: { kind: 'bettors', arg: 'mins:43200' } },
        { label: 'Stickiness', value: formatShare(ratio(r.dailyActive, r.monthlyActive)), note: 'Daily ÷ monthly active' },
      ]} />
      <FigureSection title="Retention & Conversion" sub={period} icon={IconRepeat} accent="green" pending={pending} figures={[
        { label: 'Active in Period', value: count(r.activeInPeriod), note: `${count(r.activePrevious)} in the period before`, drill: { kind: 'bettors' } },
        { label: 'Returning Players', value: count(r.returning), note: `${formatShare(ratio(r.returning, r.activePrevious))} of last period's players came back`, accent: 'green' },
        { label: 'Lapsing Players', value: count(r.lapsing), note: 'Bet in the month before, not in the last 7 days', accent: r.lapsing > 0 ? 'amber' : undefined },
        { label: 'New Players', value: count(r.newPlayers), note: 'Registered in the period', drill: { kind: 'players', arg: 'registered:period' } },
        { label: 'First-Deposit Conversion', value: formatShare(ratio(r.newDepositors, r.newPlayers)), note: `${count(r.newDepositors)} of the new players deposited`, accent: 'blue' },
        { label: 'Repeat Depositors', value: count(r.repeatDepositors), note: `${formatShare(ratio(r.repeatDepositors, r.depositors))} of ${plural(r.depositors, 'depositor')} deposited twice or more` },
      ]} />
    </>
  )
}
