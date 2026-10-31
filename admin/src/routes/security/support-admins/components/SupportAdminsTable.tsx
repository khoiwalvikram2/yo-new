import type { MouseEvent } from 'react'
import {
  IconDots,
  IconDownload,
  IconHistory,
  IconKey,
  IconLock,
  IconLockOpen,
  IconLogout,
  IconSettings,
  IconShieldLock,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { Menu, MenuItem, MenuSeparator } from '@/ui/components/Menu'
import { SearchField } from '@/ui/components/SearchField'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import {
  activityTone,
  adminCountLabel,
  adminStatus,
  formatAction,
  isActiveAdmin,
  shortAdminId,
  timeAgo,
  type AdminUser,
  type AuditEvent,
} from '../supportAdminsModel'
import styles from '../SupportAdminsPage.module.css'

const ROW_ICON = 15
const MENU_ICON = 16

export interface SupportAdminActions {
  onManageRoles: (admin: AdminUser) => void
  onOpenAudit: (admin: AdminUser) => void
  onDeactivate: (admin: AdminUser) => void
  onReactivate: (admin: AdminUser) => void
  onForceLogout: (admin: AdminUser) => void
  onResetPassword: (admin: AdminUser) => void
  onOpenSecurity: (admin: AdminUser) => void
  onDelete: (admin: AdminUser) => void
  /** Remembers the row control that opened a drawer or confirmation, so focus can return to it. */
  onTrigger: (event: MouseEvent<HTMLElement>) => void
}

export interface SupportAdminsTableProps {
  /** The admins of the current page. */
  rows: readonly AdminUser[]
  /** Every admin the search matches (the count line and the pager). */
  total: number
  loading: boolean
  onlineIds: ReadonlySet<string>
  activity: ReadonlyMap<string, AuditEvent>
  now: Date
  formatDate: (value: string, pattern?: string) => string
  formatTime: (value: string, pattern?: string) => string
  search: string
  onSearchChange: (value: string) => void
  exporting: boolean
  onExport: () => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  actions: SupportAdminActions
}

/** The support admins card: the legacy six columns, the row gear and menu, search, export and the pager. */
export function SupportAdminsTable({
  rows,
  total,
  loading,
  onlineIds,
  activity,
  now,
  formatDate,
  formatTime,
  search,
  onSearchChange,
  exporting,
  onExport,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  actions,
}: SupportAdminsTableProps) {
  const columns: DataTableColumn<AdminUser>[] = [
    {
      key: 'details',
      header: 'Admin Details',
      cell: (admin) => (
        <span className={styles.who}>
          <Avatar name={admin.name} size={22} hue="auto" />
          <span className={styles.whoText}>
            <span className={styles.nameRow}>
              <span className={styles.name}>{admin.name}</span>
              {onlineIds.has(admin.id) ? <StatusPill tone="ok">Online</StatusPill> : null}
            </span>
            <dl className={styles.meta}>
              <span className={styles.metaRow}>
                <dt className={styles.metaTerm}>Email:</dt>
                <dd className={styles.metaValue}>{admin.email || '—'}</dd>
              </span>
              <span className={styles.metaRow}>
                <dt className={styles.metaTerm}>ID:</dt>
                <dd className={styles.metaValue}>{shortAdminId(admin.id)}</dd>
              </span>
            </dl>
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (admin) => {
        const status = adminStatus(admin)
        return <StatusPill tone={status.tone}>{status.label}</StatusPill>
      },
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (admin) =>
        admin.roles.length > 0 ? (
          <span className={styles.pills}>
            {admin.roles.map((role) => (
              <StatusPill key={role.id} tone="info">
                {role.name}
              </StatusPill>
            ))}
          </span>
        ) : (
          <span className={styles.dim}>No roles</span>
        ),
    },
    {
      key: 'activity',
      header: 'Recent Activity',
      cell: (admin) => {
        const event = activity.get(admin.id)
        if (!event) return <span className={styles.dim}>No recent activity</span>
        return (
          <span className={styles.stack}>
            <StatusPill tone={activityTone(event.action)}>{formatAction(event.action)}</StatusPill>
            <span className={styles.secondary}>{timeAgo(event.timestamp, now)}</span>
          </span>
        )
      },
    },
    {
      key: 'created',
      header: 'Created',
      cell: (admin) =>
        admin.createdAt ? (
          <span className={styles.stack}>
            <span>{formatDate(admin.createdAt, 'MMM d, yyyy')}</span>
            <span className={styles.secondary}>{formatTime(admin.createdAt, 'HH:mm')}</span>
          </span>
        ) : (
          <span className={styles.dim}>—</span>
        ),
    },
  ]

  return (
    <Card
      title="Support Admins"
      sub={adminCountLabel(total)}
      body="table"
      tools={
        <>
          <SearchField
            className={styles.search}
            size="sm"
            label="Search support admins"
            placeholder="Search by name, email or role"
            value={search}
            onChange={onSearchChange}
          />
          <Button
            variant="primary"
            size="sm"
            icon={<IconDownload size={ROW_ICON} stroke={strokeFor(ROW_ICON)} />}
            loading={exporting}
            disabled={!total}
            onClick={onExport}
          >
            Export Excel
          </Button>
        </>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(admin) => admin.id}
        label="Support admins"
        state={loading ? 'loading' : 'ready'}
        width="wide"
        empty={
          <EmptyState
            title="No support admins found"
            icon={<IconUsers size={20} stroke={strokeFor(20)} />}
          />
        }
        pagination={
          total > 0
            ? {
                current: page,
                pageSize,
                total,
                onChange: onPageChange,
                onPageSizeChange,
                itemName: 'admins',
                pageSizeOptions: [10, 20, 50, 100],
              }
            : false
        }
        rowActions={(admin) => ({ primary: <RowActions admin={admin} actions={actions} /> })}
      />
    </Card>
  )
}

/** The legacy gear (Manage Roles) and the More Actions menu, in the legacy order with its dividers. */
function RowActions({ admin, actions }: { admin: AdminUser; actions: SupportAdminActions }) {
  const active = isActiveAdmin(admin)
  const icon = (Glyph: typeof IconHistory) => <Glyph size={MENU_ICON} stroke={strokeFor(MENU_ICON)} />

  return (
    <span className={styles.rowActions}>
      <Tooltip content="Manage Roles">
        <IconButton
          size="sm"
          label={`Manage roles for ${admin.name}`}
          icon={<IconSettings size={ROW_ICON} stroke={strokeFor(ROW_ICON)} />}
          onClick={(event) => {
            actions.onTrigger(event)
            actions.onManageRoles(admin)
          }}
        />
      </Tooltip>
      <Menu
        trigger={
          <IconButton
            size="sm"
            label={`More actions for ${admin.name}`}
            icon={<IconDots size={ROW_ICON} stroke={strokeFor(ROW_ICON)} />}
            onClick={actions.onTrigger}
          />
        }
      >
        <MenuItem icon={icon(IconHistory)} onSelect={() => actions.onOpenAudit(admin)}>
          View All Activity
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={icon(IconSettings)} onSelect={() => actions.onManageRoles(admin)}>
          Manage Roles
        </MenuItem>
        <MenuSeparator />
        {active ? (
          <MenuItem icon={icon(IconLock)} tone="danger" onSelect={() => actions.onDeactivate(admin)}>
            Deactivate
          </MenuItem>
        ) : (
          <MenuItem icon={icon(IconLockOpen)} onSelect={() => actions.onReactivate(admin)}>
            Reactivate
          </MenuItem>
        )}
        <MenuItem icon={icon(IconLogout)} onSelect={() => actions.onForceLogout(admin)}>
          Force Logout
        </MenuItem>
        <MenuItem icon={icon(IconKey)} onSelect={() => actions.onResetPassword(admin)}>
          Reset Password
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={icon(IconShieldLock)} onSelect={() => actions.onOpenSecurity(admin)}>
          IP Allowlist
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={icon(IconTrash)} tone="danger" onSelect={() => actions.onDelete(admin)}>
          Delete
        </MenuItem>
      </Menu>
    </span>
  )
}
