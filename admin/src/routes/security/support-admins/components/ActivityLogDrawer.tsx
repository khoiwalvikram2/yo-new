import type { RefObject } from 'react'
import { IconHistory, IconUser } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableProps, type DataTableColumn } from '@/ui/components/DataTable'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { strokeFor } from '@/ui/components/icons'
import { StatusPill } from '@/ui/components/StatusPill'
import {
  activityTone,
  auditDetails,
  formatAction,
  resourceIdLabel,
  type AdminUser,
  type AuditEvent,
} from '../supportAdminsModel'
import styles from '../SupportAdminsPage.module.css'
import { DrawerFooter, DrawerIntro } from './DrawerParts'

interface ActivityLogDrawerProps {
  open: boolean
  admin: AdminUser
  pagination?: DataTableProps<AuditEvent>['pagination']
  events: readonly AuditEvent[]
  loading: boolean
  formatDate: (value: string) => string
  formatTime: (value: string) => string
  restoreFocusTo: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
}

export function ActivityLogDrawer({
  open,
  admin,
  events, pagination,
  loading,
  formatDate,
  formatTime,
  restoreFocusTo,
  onOpenChange,
}: ActivityLogDrawerProps) {
  const columns: DataTableColumn<AuditEvent>[] = [
    {
      key: 'time',
      header: 'Time',
      minWidth: 150,
      cell: (event) => event.timestamp ? (
        <span className={styles.stack}>
          <span>{formatDate(event.timestamp)}</span>
          <span className={styles.secondary}>{formatTime(event.timestamp)}</span>
        </span>
      ) : <span className={styles.dim}>—</span>,
    },
    {
      key: 'action',
      header: 'Action',
      minWidth: 170,
      cell: (event) => <StatusPill tone={activityTone(event.action)}>{formatAction(event.action)}</StatusPill>,
    },
    {
      key: 'domain',
      header: 'Domain',
      minWidth: 140,
      cell: (event) => event.domain ? <StatusPill tone="neutral">{event.domain}</StatusPill> : <span className={styles.dim}>—</span>,
    },
    {
      key: 'resource',
      header: 'Resource',
      minWidth: 180,
      cell: (event) => (
        <span className={styles.stack}>
          <span>{event.resourceType || '—'}</span>
          <span className={styles.secondary}>{resourceIdLabel(event.resourceId)}</span>
        </span>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      minWidth: 300,
      cell: (event) => {
        const details = auditDetails(event)
        if (!details) return <span className={styles.dim}>No details</span>
        return (
          <span className={styles.details}>
            {details.before ? <span><span className={styles.before}>Before:</span> {details.before}</span> : null}
            {details.after ? <span><span className={styles.after}>After:</span> {details.after}</span> : null}
          </span>
        )
      },
    },
  ]

  return (
    <Drawer
      title="Activity Log - Administrator"
      size="lg"
      open={open}
      onOpenChange={onOpenChange}
      themeFrom={restoreFocusTo}
      restoreFocusTo={restoreFocusTo}
      footer={(
        <DrawerFooter hint="Showing activity history (last 7 days, up to 100 most recent events)">
          <Button size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </DrawerFooter>
      )}
    >
      <div className={styles.drawerBody}>
        <DrawerIntro
          icon={<IconUser size={17} stroke={strokeFor(17)} />}
          title={admin.name}
          sub="Administrator activity log"
          tag="Activity Log"
          tagTone="info"
        />
        <div className={styles.tableBox}>
          <DataTable
            columns={columns}
            rows={events}
            rowKey={(event) => event.id}
            label="Administrator activity log"
            state={loading ? 'loading' : 'ready'}
            width="wide"
            density="compact"
            pagination={pagination ?? 'client'}
            empty={(
              <EmptyState
                title="No activity found"
                description="This support admin hasn't performed any actions yet."
                icon={<IconHistory size={20} stroke={strokeFor(20)} />}
                inset="none"
              />
            )}
          />
        </div>
      </div>
    </Drawer>
  )
}
