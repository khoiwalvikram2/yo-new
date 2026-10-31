import clsx from 'clsx'
import { useQuery, gql } from '@apollo/client'
import { IconActivity, IconKey, IconLogin, IconShieldX } from '@tabler/icons-react'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import { Card } from '@/ui/components/Card'
import { StatusPill } from '@/ui/components/StatusPill'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import styles from './AgentProfileComponents.module.css'

const AGENT_SECURITY_AUDIT_QUERY = gql`
  query AgentSecurityAudit($agentId: ID!, $limit: Int) {
    agents {
      agentSecurityAudit(agentId: $agentId, limit: $limit) {
        id
        type
        description
        timestamp
        ipAddress
        userAgent
        success
        metadata
      }
    }
  }
`

const EVENT_LIMIT = 100

const sentence = (text: string) => { const words = text.replace(/[_-]+/g, ' ').trim().toLowerCase(); return words ? words[0].toUpperCase() + words.slice(1) : words }
// "agents:login_failed" reads "Login failed"; a description in words is kept as it is.
const eventTitle = (description?: string, type?: string) => description && /^[\w.-]+:[\w.-]+$/.test(description) ? sentence(description.slice(description.indexOf(':') + 1)) : description || sentence(type || 'event')
// "Chrome on Android 10" from the user agent; anything unrecognised falls back to its first 50 characters.
function deviceName(userAgent?: string) {
  if (!userAgent) return '—'
  const os = /Android [\d.]+/.exec(userAgent)?.[0] ?? (/iPhone|iPad/.test(userAgent) ? 'iOS' : /Windows/.test(userAgent) ? 'Windows' : /Mac OS X/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : null)
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /OPR\//.test(userAgent) ? 'Opera' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : null
  if (browser && os) return `${browser} on ${os}`
  return browser || os || (userAgent.length > 50 ? `${userAgent.slice(0, 50)}…` : userAgent)
}

interface AgentSecurityAuditTabProps {
  agentId: string
}

export function AgentSecurityAuditTab({ agentId }: AgentSecurityAuditTabProps) {
  const { formatDate, formatTime } = useFormatDate()
  // On a phone the table keeps the event, its result and the time.
  const { isMobile } = useBreakpoint()
  const { data, loading, error, refetch } = useQuery(AGENT_SECURITY_AUDIT_QUERY, {
    variables: { agentId: String(agentId), limit: EVENT_LIMIT },
    errorPolicy: 'all',
    skip: !agentId,
  })

  const events = data?.agents?.agentSecurityAudit || []
  const pending = loading && !data

  type AuditEvent = { id?: string; type?: string; success?: boolean; description?: string; ipAddress?: string; userAgent?: string; timestamp?: string }
  const logins = events.filter((event: AuditEvent) => event.type === 'login' && event.success)
  const failed = events.filter((event: AuditEvent) => event.type === 'login' && !event.success)
  const passwordChanges = events.filter((event: AuditEvent) => ['password_change', 'change_password'].includes(event.type || ''))
  // Each figure's note is the date of its latest event.
  const latest = (list: AuditEvent[]) => {
    const times = list.map(event => event.timestamp ? new Date(event.timestamp).getTime() : NaN).filter(Number.isFinite)
    return times.length ? `Last ${formatDate(new Date(Math.max(...times)).toISOString(), 'dd MMM yyyy')}` : 'None in the latest events'
  }
  const columns: DataTableColumn<AuditEvent>[] = [
    { key: 'event', header: 'Event', cell: event => { const title = eventTitle(event.description, event.type), kind = sentence(event.type || ''); return <div className={styles.rowDetails}><strong>{title}</strong>{kind && !title.toLowerCase().startsWith(kind.toLowerCase()) && <span className={styles.muted}>{kind}</span>}</div> } },
    { key: 'status', header: 'Status', cell: event => <StatusPill tone={event.success ? 'ok' : 'neg'}>{event.success ? 'Success' : 'Failed'}</StatusPill> },
    { key: 'ip', header: 'IP Address', hidden: isMobile, cell: event => <span className={styles.mono}>{event.ipAddress || '—'}</span> },
    { key: 'agent', header: 'Device', hidden: isMobile, cell: event => <span className={styles.auditAgent} title={event.userAgent}>{deviceName(event.userAgent)}</span> },
    { key: 'timestamp', header: 'Time', cell: event => <div className={styles.rowDetails}><span>{event.timestamp ? formatDate(event.timestamp, 'dd MMM yyyy') : '—'}</span><span className={styles.muted}>{event.timestamp ? formatTime(event.timestamp, 'HH:mm') : '—'}</span></div> },
  ]
  return <div className={clsx(styles.stack, styles.tabPanel)}>
    <div className={styles.tabKpis} role="group" aria-label="Activity figures">
      <AccountListMetric label="Total Events" value={events.length} note={`The latest ${EVENT_LIMIT} at most`} icon={<IconActivity size={18} />} hue="blu" loading={pending} />
      <AccountListMetric label="Successful Logins" value={logins.length} note={latest(logins)} icon={<IconLogin size={18} />} hue="grn" loading={pending} />
      <AccountListMetric label="Failed Logins" value={failed.length} note={latest(failed)} icon={<IconShieldX size={18} />} hue="red" loading={pending} />
      <AccountListMetric label="Password Changes" value={passwordChanges.length} note={latest(passwordChanges)} icon={<IconKey size={18} />} hue="vio" loading={pending} />
    </div>
    <Card title="Security Events" sub={`${events.length} ${events.length === 1 ? 'event' : 'events'} · sign-ins and account changes`} body="table" tools={<Button size="sm" onClick={() => void refetch()}>Refresh</Button>}>
      <DataTable label="Agent security events" columns={columns} rows={events} rowKey={event => String(event.id)} state={loading ? 'loading' : error ? 'error' : 'ready'} error={error?.message || 'Failed to load activity log'} onRetry={() => void refetch()} empty={<EmptyState title="No security events found" />} pagination="client"
        density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} />
    </Card>
  </div>
}
