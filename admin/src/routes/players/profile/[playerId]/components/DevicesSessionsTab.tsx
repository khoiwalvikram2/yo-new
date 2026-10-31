import { useQuery, gql } from '@apollo/client'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { Skeleton } from '@/ui/components/Skeleton'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../PlayerProfile.module.css'
const PLAYER_DEVICES_QUERY = gql`
  query PlayerDevices($playerId: ID!) {
    playerDevices(playerId: $playerId) {
      id
      deviceId
      deviceType
      os
      browser
      ipAddress
      location
      isTrusted
      firstSeen
      lastSeen
    }
  }
`

const PLAYER_SESSIONS_QUERY = gql`
  query PlayerSessions($playerId: ID!) {
    playerSessions(playerId: $playerId) {
      id
      deviceId
      deviceType
      ipAddress
      location
      userAgent
      startedAt
      lastActivity
      isActive
    }
  }
`


interface Device { id: string; deviceId: string; deviceType?: string; os?: string; browser?: string; ipAddress?: string; location?: string; isTrusted?: boolean; firstSeen?: string; lastSeen?: string }
interface Session { id: string; deviceType?: string; ipAddress?: string; location?: string; startedAt?: string; lastActivity?: string; isActive?: boolean }
export function DevicesSessionsTab({ playerId }: { playerId: string }) {
  const { formatDate, formatTime } = useFormatDate()
  const devicesQuery = useQuery<{ playerDevices: Device[] }>(PLAYER_DEVICES_QUERY, { variables: { playerId }, errorPolicy: 'all' })
  const sessionsQuery = useQuery<{ playerSessions: Session[] }>(PLAYER_SESSIONS_QUERY, { variables: { playerId }, errorPolicy: 'all' })
  const devices = devicesQuery.data?.playerDevices || []
  const sessions = sessionsQuery.data?.playerSessions || []
  const devicesPending = devicesQuery.loading && !devicesQuery.data
  const sessionsPending = sessionsQuery.loading && !sessionsQuery.data
  const dateCell = (value?: string) => value ? <div><p>{formatDate(value, 'dd MMM yyyy')}</p><p className={styles.subtle}>{formatTime(value, 'HH:mm')}</p></div> : '—'
  const sessionColumns: DataTableColumn<Session>[] = [
    { key: 'device', header: 'Device', cell: (row) => row.deviceType || 'Unknown' },
    { key: 'ip', header: 'IP Address', cell: (row) => row.ipAddress || '—', emphasis: 'id' },
    { key: 'location', header: 'Location', cell: (row) => row.location || '—' },
    { key: 'started', header: 'Started', cell: (row) => dateCell(row.startedAt) },
    { key: 'last', header: 'Last Activity', cell: (row) => dateCell(row.lastActivity) },
    { key: 'status', header: 'Status', cell: (row) => <StatusPill tone={row.isActive ? 'ok' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</StatusPill> },
    { key: 'actions', header: 'Actions', cell: () => <RBACGuard required={[{ domain: 'players.sessions', actions: ['delete'] }]}><Button size="sm" variant="danger" disabled title="Session termination is not connected to a server action">Terminate</Button></RBACGuard> },
  ]
  const deviceColumns: DataTableColumn<Device>[] = [
    { key: 'device', header: 'Device', cell: (row) => <div>{row.deviceType || 'Unknown'}<p className={styles.subtle}>{row.os} • {row.browser}</p></div> },
    { key: 'id', header: 'Device ID', cell: (row) => `${(row.deviceId || '').slice(0, 16)}...`, emphasis: 'id' },
    { key: 'ip', header: 'IP Address', cell: (row) => row.ipAddress || '—', emphasis: 'id' },
    { key: 'location', header: 'Location', cell: (row) => row.location || '—' },
    { key: 'trusted', header: 'Trusted', cell: (row) => <StatusPill tone={row.isTrusted ? 'ok' : 'muted'}>{row.isTrusted ? 'Yes' : 'No'}</StatusPill> },
    { key: 'first', header: 'First Seen', cell: (row) => dateCell(row.firstSeen) },
    { key: 'last', header: 'Last Seen', cell: (row) => dateCell(row.lastSeen) },
  ]
  return <div className={styles.stack}>
    <div className={styles.fields} aria-busy={sessionsPending || devicesPending || undefined}><Stat label="Active Sessions" value={sessions.filter((session) => session.isActive).length} note={`${sessions.length} total`} loading={sessionsPending} /><Stat label="Known Devices" value={devices.length} note={`${devices.filter((device) => device.isTrusted).length} trusted`} loading={devicesPending} /></div>
    <Notice title="Session management is read-only" tone="info">The existing termination controls are not connected to a server action. No session will be terminated from this screen.</Notice>
    <Card title="Active Sessions" sub={sessionsPending ? <Skeleton width={72} height={12} /> : `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`} body="table" tools={<RBACGuard required={[{ domain: 'players.sessions', actions: ['delete'] }]}><Button variant="danger" disabled title="Session termination is not connected to a server action">Terminate All</Button></RBACGuard>}>
      <DataTable rows={sessions} columns={sessionColumns} rowKey={(row) => row.id} label="Active Sessions" pagination={false} state={sessionsQuery.error ? 'error' : sessionsPending ? 'loading' : 'ready'} error={sessionsQuery.error?.message} onRetry={() => void sessionsQuery.refetch()} empty={<EmptyState title="No active sessions" />} />
    </Card>
    <Card title="Known Devices" sub={devicesPending ? <Skeleton width={72} height={12} /> : `${devices.length} ${devices.length === 1 ? 'device' : 'devices'}`} body="table">
      <DataTable rows={devices} columns={deviceColumns} rowKey={(row) => row.id} label="Known Devices" pagination={false} state={devicesQuery.error ? 'error' : devicesPending ? 'loading' : 'ready'} error={devicesQuery.error?.message} onRetry={() => void devicesQuery.refetch()} empty={<EmptyState title="No devices found" />} />
    </Card>
  </div>
}

