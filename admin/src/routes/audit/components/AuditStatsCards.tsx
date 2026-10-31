import { useMemo } from 'react'
import { IconFileAnalytics, IconClock, IconUsers, IconChartBar } from '@tabler/icons-react'
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { ReportChartTip } from '@/modules/reporting/ui/ReportChartTip'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { auditSampleBuckets, auditChartHue, EMPTY_AUDIT_STATS, type AuditStatistics } from './auditStatsModel'
import styles from './AuditSurfaces.module.css'
interface AuditStatsCardsProps {
  data?: AuditStatistics
  loading?: boolean
  error?: { message?: string } | null
  activeFilterCount?: number
}
export function AuditStatsCards({ data, loading, error, activeFilterCount = 0 }: AuditStatsCardsProps) {
  const { formatDateTime } = useFormatDate()
  const stats = data ?? EMPTY_AUDIT_STATS
  const buckets = useMemo(() => auditSampleBuckets(stats.recentEvents), [stats.recentEvents])
  const timeline = useMemo(() => buckets.timeline.map((bucket) => ({ time: formatDateTime(bucket.timestamp, 'MMM d, h a'), count: bucket.count })), [buckets.timeline, formatDateTime])
  const domains = stats.byDomain.map((entry) => ({ name: entry.domain, value: entry.count }))
  const actions = stats.byAction.map((entry) => ({ name: entry.action, count: entry.count }))
  // Until the first answer the cards hold their height with placeholders; a refetch keeps the last figures.
  const pending = !!loading && !data
  if (error && !data && !loading) return <Notice tone="error">Failed to load statistics: {error.message ?? 'Unknown error'}</Notice>
  const slots = { ind: 'hInd', red: 'hRed', grn: 'hGrn', vio: 'hVio', blu: 'hBlu', amb: 'hAmb' } as const
  return <div className={styles.workspace}><div className={styles.stack}>
    {activeFilterCount > 0 && <p className={styles.secondary}>Statistics reflect current filters ({activeFilterCount} active).</p>}
    {error && data && <Notice tone="warn">Statistics could not refresh: {error.message ?? 'Unknown error'}. Showing the last available figures.</Notice>}
    <div className={styles.metrics} role="group" aria-label="Audit figures" aria-busy={pending || undefined}>
      <Stat label="Total Events" value={stats.total.toLocaleString()} icon={<IconFileAnalytics size={18} stroke={strokeFor(18)} />} hue="blu" loading={pending} />
      <Stat label="Events Today" value={stats.today.toLocaleString()} icon={<IconClock size={18} stroke={strokeFor(18)} />} hue="grn" loading={pending} />
      <Stat label="Active Actors" value={stats.uniqueActors.toLocaleString()} icon={<IconUsers size={18} stroke={strokeFor(18)} />} hue="ind" loading={pending} />
      <Stat label="Recent Events" value={stats.recentEvents.length} icon={<IconChartBar size={18} stroke={strokeFor(18)} />} hue="red" loading={pending} />
    </div>
    <div className={styles.charts}>
      <Card title="Events by Domain">
        {pending ? <LoadingState label="Loading domain chart" height={250} /> : domains.length ? <>
          <div className={styles.plot}><ResponsiveContainer width="100%" height={250}><PieChart>
            <Pie data={domains} dataKey="value" cx="50%" cy="50%" outerRadius={80} labelLine={false} label={(props: PieLabelRenderProps) => `${props.name ?? ''}: ${(Number(props.percent ?? 0) * 100).toFixed(0)}%`}>
              {domains.map((entry, index) => <Cell key={index} className={styles[auditChartHue(entry.name)]} />)}
            </Pie><Tooltip content={<ReportChartTip slotOf={(entry) => slots[auditChartHue(String(entry.name ?? ''))]} format={(value) => value.toLocaleString()} />} />
          </PieChart></ResponsiveContainer></div>
          <ul className={styles.summary} aria-label="Domain event counts">{domains.map((entry, index) => <li key={index}>{entry.name}: {entry.value.toLocaleString()}</li>)}</ul>
        </> : <EmptyState title="No data" />}
      </Card>
      <Card title="Events by Action">
        {pending ? <LoadingState label="Loading action chart" height={250} /> : actions.length ? <>
          <div className={styles.plot}><ResponsiveContainer width="100%" height={250}><BarChart data={actions}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip content={(props) => <ReportChartTip {...props} slotOf={() => slots[auditChartHue(String(props.label ?? ''))]} format={(value) => value.toLocaleString()} />} />
            <Bar dataKey="count">{actions.map((entry, index) => <Cell key={index} className={styles[auditChartHue(entry.name)]} />)}</Bar>
          </BarChart></ResponsiveContainer></div>
          <ul className={styles.summary} aria-label="Action event counts">{actions.map((entry, index) => <li key={index}>{entry.name}: {entry.count.toLocaleString()}</li>)}</ul>
        </> : <EmptyState title="No data" />}
      </Card>
      <Card title="Events Timeline (sample: 5 most recent)" sub="Rolling 24-hour buckets from the recent-event sample, not complete activity totals.">
        {pending ? <LoadingState label="Loading timeline chart" height={250} /> : <div className={styles.plot}><ResponsiveContainer width="100%" height={250}><LineChart data={timeline}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" /><YAxis allowDecimals={false} />
          <Tooltip content={<ReportChartTip slotOf={() => 'hBlu'} format={(value) => value.toLocaleString()} />} />
          <Line type="monotone" dataKey="count" className={styles.line} strokeWidth={2} dot={{ r: 4 }} activeDot={{ className: styles.dot }} />
        </LineChart></ResponsiveContainer></div>}
      </Card>
      <Card title="Events by Hour (sample: 5 most recent)" sub="Recent-event sample grouped by local hour, not complete activity totals.">
        {pending ? <LoadingState label="Loading hourly chart" height={250} /> : <div className={styles.plot}><ResponsiveContainer width="100%" height={250}><BarChart data={buckets.hourly}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hour" /><YAxis allowDecimals={false} />
          <Tooltip content={<ReportChartTip slotOf={() => 'hGrn'} format={(value) => value.toLocaleString()} />} />
          <Bar dataKey="count" className={styles.bar} />
        </BarChart></ResponsiveContainer></div>}
      </Card>
    </div>
  </div></div>
}
