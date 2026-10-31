import { useMemo, useState } from 'react'
import { useQuery, gql } from '@apollo/client'
import { IconShieldCheck, IconLogin, IconKey, IconDevices, IconWorld, IconDeviceMobile, IconDeviceTablet, IconDeviceDesktop, IconRefresh, IconInfoCircle } from '@tabler/icons-react'
import { UAParser } from 'ua-parser-js'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Select } from '@/ui/components/Select'
import { FilterBar } from '@/ui/components/FilterBar'
import { Popover } from '@/ui/components/Popover'
import { Notice } from '@/ui/components/Notice'
import styles from '../PlayerProfile.module.css'
const PLAYER_SECURITY_AUDIT_QUERY = gql`
  query PlayerSecurityAudit($playerId: ID!, $limit: Int, $offset: Int, $type: String, $success: Boolean, $ascending: Boolean) {
    playerSecurityAuditPage(playerId: $playerId, limit: $limit, offset: $offset, type: $type, success: $success, ascending: $ascending) {
      total
      items {
      id
      type
      description
      timestamp
      ipAddress
      userAgent
      success
      metadata
      location
      language
      screenResolution
      timezone
      platform
      }
    }
  }
`

interface ParsedEvent {
  id: string
  type: string
  description: string
  timestamp: string
  ipAddress: string | null
  userAgent: string | null
  success: boolean
  metadata: string | null
  location: string | null
  language: string | null
  screenResolution: string | null
  timezone: string | null
  platform: string | null
  browser: string
  os: string
  device: string
  deviceType: string
}

function parseUA(ua: string | null | undefined): { browser: string; os: string; device: string; deviceType: string } {
  if (!ua) return { browser: '—', os: '—', device: '—', deviceType: 'unknown' }
  const parser = new UAParser(ua)
  const b = parser.getBrowser()
  const o = parser.getOS()
  const d = parser.getDevice()

  const browser = [b.name, b.version?.split('.')[0]].filter(Boolean).join(' ') || '—'
  const os = [o.name, o.version].filter(Boolean).join(' ') || '—'
  const deviceType = d.type || 'desktop'
  let device = d.vendor && d.model ? `${d.vendor} ${d.model}` : d.model || d.vendor || ''
  if (!device) {
    device = deviceType === 'mobile' ? 'Mobile' : deviceType === 'tablet' ? 'Tablet' : 'Desktop'
  }
  return { browser, os, device, deviceType }
}


function DeviceIcon({ type }: { type: string }) {
  return type === 'mobile' ? <IconDeviceMobile size={16} /> : type === 'tablet' ? <IconDeviceTablet size={16} /> : <IconDeviceDesktop size={16} />
}
export function SecurityAuditTab({ playerId }: { playerId: string }) {
  return <RBACGuard required={[{ domain: 'players.security-audit', actions: ['view'] }]}><SecurityAuditTabContent playerId={playerId} /></RBACGuard>
}
function SecurityAuditTabContent({ playerId }: { playerId: string }) {
  const { formatDate, formatTime } = useFormatDate()
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [sort, setSort] = useState<DataTableSort | null>({ key: 'timestamp', dir: 'desc' })
  const { data, loading, error, refetch } = useQuery<{ playerSecurityAuditPage?: { total: number; items: Omit<ParsedEvent, 'browser' | 'os' | 'device' | 'deviceType'>[] } }>(PLAYER_SECURITY_AUDIT_QUERY, {
    variables: { playerId: String(playerId), limit: pageSize, offset: (page - 1) * pageSize, type: type || null, success: status ? status === 'true' : null, ascending: sort?.dir === 'asc' }, errorPolicy: 'all', skip: !playerId, notifyOnNetworkStatusChange: true,
  })
  const events = useMemo(() => (data?.playerSecurityAuditPage?.items || []).map((event) => ({ ...event, ...parseUA(event.userAgent) })), [data])
  const successfulLogins = events.filter((event) => event.type === 'login' && event.success).length
  const failedLogins = events.filter((event) => event.type === 'login' && !event.success).length
  const passwordChanges = events.filter((event) => event.type === 'password_change' || event.type === 'change_password').length
  const uniqueIPs = new Set(events.map((event) => event.ipAddress).filter(Boolean)).size
  const uniqueDevices = new Set(events.map((event) => `${event.browser}-${event.os}-${event.deviceType}`)).size
  const columns: DataTableColumn<ParsedEvent>[] = [
    { key: 'type', header: 'Type', minWidth: 130, cell: (row) => <StatusPill tone="neutral">{row.type.replace(/_/g, ' ')}</StatusPill> },
    { key: 'success', header: 'Status', minWidth: 100, cell: (row) => <StatusPill tone={row.success ? 'ok' : 'neg'}>{row.success ? 'Success' : 'Failed'}</StatusPill> },
    { key: 'device', header: 'Device', minWidth: 150, cell: (row) => <span className={styles.row}><DeviceIcon type={row.deviceType} /><span>{row.device}<span className={styles.subtle}> · {row.deviceType}</span></span></span> },
    { key: 'browser', header: 'Browser', minWidth: 130, cell: (row) => row.browser },
    { key: 'os', header: 'OS', minWidth: 130, cell: (row) => row.os },
    { key: 'ipAddress', header: 'IP Address', minWidth: 130, emphasis: 'id', cell: (row) => row.ipAddress || '—' },
    { key: 'location', header: 'Location', minWidth: 160, cell: (row) => row.location || '—' },
    { key: 'timestamp', header: 'Timestamp', minWidth: 150, sort: (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(), cell: (row) => <span>{formatDate(row.timestamp, 'dd MMM yyyy')}<span className={styles.subtle}> · {formatTime(row.timestamp, 'HH:mm:ss')}</span></span> },
    { key: 'extra', header: 'Extra', align: 'center', minWidth: 80, cell: (row) => {
      const parts: string[] = []
      if (row.language) parts.push(`Language: ${row.language}`)
      if (row.screenResolution) parts.push(`Screen: ${row.screenResolution}`)
      if (row.timezone) parts.push(`Timezone: ${row.timezone}`)
      if (row.platform) parts.push(`Platform: ${row.platform}`)
      if (row.userAgent) parts.push(`UA: ${row.userAgent}`)
      return parts.length ? <Popover label="Event metadata" trigger={<IconButton label={`Show metadata for event ${row.id}`} icon={<IconInfoCircle size={16} />} />}><div className={styles.metadata}>{parts.map((part) => <p key={part}>{part}</p>)}</div></Popover> : '—'
    } },
  ]
  return <div className={styles.stack}>
    <div className={styles.auditStats}>
      <Stat label="Matching Events" value={data?.playerSecurityAuditPage?.total ?? 0} icon={<IconShieldCheck size={18} />} />
      <Stat label="Page: Successful Logins" value={successfulLogins} icon={<IconLogin size={18} />} hue="grn" />
      <Stat label="Page: Failed Logins" value={failedLogins} icon={<IconLogin size={18} />} hue="red" />
      <Stat label="Page: Password Changes" value={passwordChanges} icon={<IconKey size={18} />} hue="vio" />
      <Stat label="Page: Unique IPs" value={uniqueIPs} icon={<IconWorld size={18} />} hue="blu" />
      <Stat label="Page: Unique Devices" value={uniqueDevices} icon={<IconDevices size={18} />} hue="amb" />
    </div>
    {error && data ? <Notice tone="warn">{error.message}</Notice> : null}
    <Card title="Security Events" sub={`${events.length} ${events.length === 1 ? 'event' : 'events'}`} body="table" tools={<Button size="sm" icon={<IconRefresh size={16} />} loading={loading} onClick={() => void refetch()}>Refresh</Button>}>
      <FilterBar label="Security event filters" activeCount={Number(Boolean(type)) + Number(Boolean(status))} onClearAll={() => { setType(''); setStatus(''); setPage(1) }}>
        <Select label="Type" value={type} options={[{ value: '', label: 'All types' }, { value: 'login', label: 'Login' }, { value: 'change_password', label: 'Password Change' }]} onChange={(value) => { setType(value); setPage(1) }} />
        <Select label="Status" value={status} options={[{ value: '', label: 'All statuses' }, { value: 'true', label: 'Success' }, { value: 'false', label: 'Failed' }]} onChange={(value) => { setStatus(value); setPage(1) }} />
      </FilterBar>
      <DataTable columns={columns} rows={events} rowKey={(row) => row.id} label="Player security events" width="wide" state={loading ? 'loading' : error && !data ? 'error' : 'ready'} error={error?.message} onRetry={() => void refetch()} sort={sort} onSortChange={(next) => { setSort(next); setPage(1) }} pagination={{ current: page, pageSize, total: data?.playerSecurityAuditPage?.total ?? 0, onChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1) }, pageSizeOptions: [10, 20, 50, 100], itemName: 'events' }} />
    </Card>
  </div>
}
