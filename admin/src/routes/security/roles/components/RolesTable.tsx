import { useMemo, type ReactNode } from 'react'
import { IconDownload, IconEye, IconPencil, IconShieldHalf, IconTrash } from '@tabler/icons-react'
import type { GraphQLRole } from '../types'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useTableExport } from '@/shared/hooks/useTableExport'
import type { TableExportColumn } from '@/shared/utils/tableExport'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { confirm } from '@/ui/components/confirm'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import {
  DELETE_ROLE_TITLE,
  ROW_CONFIRM,
  TABLE_TITLE,
  exportTitle,
  isShownUpdatedAt,
  permissionCount,
  plural,
  roleCountLabel,
  roleExportColumns,
  uniqueDomains,
  visibleDomains,
  visiblePermissions,
} from '../rolesManagementModel'
import styles from '../RolesManagementPage.module.css'

type RolesTableProps = {
  /** The rows on the current page. */
  roles: GraphQLRole[]
  /** Every role the search matched, on every page: the card's count and the export. Defaults to `roles`. */
  allRoles?: GraphQLRole[]
  fetching: boolean
  onEdit: (role: GraphQLRole) => void
  onView: (role: GraphQLRole) => void
  onDelete: (roleId: string) => void | Promise<void>
  deleting: boolean
  footer?: ReactNode
}

const ACTION_ICON = 15

function Dash() {
  return <span className={styles.dash}>—</span>
}

function PermissionsCell({ role }: { role: GraphQLRole }) {
  if (role.permissions.length === 0) return <Dash />
  const totalPerms = permissionCount(role)
  const { shown, more } = visiblePermissions(role)

  return (
    <span className={styles.permissions}>
      <span className={styles.permTotal}>
        <IconShieldHalf size={12} stroke={strokeFor(12)} aria-hidden="true" />
        {totalPerms} {plural(totalPerms, 'permission', 'permissions')}
      </span>
      <span className={styles.chips}>
        {shown.map((permission) => (
          <Tooltip
            key={`${permission.domain}:${permission.actions.join('|')}`}
            content={`${permission.domain}: ${permission.actions.join(', ')}`}
          >
            <span className={styles.permChip}>
              <span className={styles.chipDomain}>{permission.domain}</span>
              <span className={styles.chipDot} aria-hidden="true">•</span>
              <span className={styles.chipCount}>{permission.actions.length}</span>
              <span className={styles.srOnly}>: {permission.actions.join(', ')}</span>
            </span>
          </Tooltip>
        ))}
        {more > 0 ? <span className={styles.permChip}>+{more}</span> : null}
      </span>
    </span>
  )
}

function DomainsCell({ role }: { role: GraphQLRole }) {
  const domains = uniqueDomains(role)
  if (domains.length === 0) return <Dash />
  const { shown, more } = visibleDomains(domains)

  return (
    <span className={styles.chips}>
      {shown.map((domain) => (
        <StatusPill key={domain} tone="info">{domain}</StatusPill>
      ))}
      {more > 0 ? <StatusPill tone="neutral">+{more}</StatusPill> : null}
    </span>
  )
}

function UpdatedCell({
  updatedAt,
  formatDate,
  formatTime,
}: {
  updatedAt: string
  formatDate: (date: string, formatStr?: string) => string
  formatTime: (date: string, formatStr?: string) => string
}) {
  if (!isShownUpdatedAt(updatedAt)) return <Dash />

  try {
    return (
      <span className={styles.updated}>
        <span className={styles.updatedDate}>{formatDate(updatedAt, 'MMM dd, yyyy')}</span>
        <span className={styles.updatedTime}>{formatTime(updatedAt, 'HH:mm')}</span>
      </span>
    )
  } catch {
    return <Dash />
  }
}

/* The legacy table on the kit Card + DataTable. The card's count and the export cover every role the
   search matched, not just this page: with 15 roles it said "10 roles" and exported 10, silently leaving
   5 out (as Support Admins does, the export takes the filtered list). Delete keeps the legacy two-step
   confirmation: this row confirmation invokes the page's final confirmation as a nested confirm action,
   preserving one focus-return chain. */
export function RolesTable({
  roles,
  allRoles = roles,
  fetching,
  onEdit,
  onView,
  onDelete,
  deleting,
  footer,
}: RolesTableProps) {
  const { formatDate, formatTime } = useFormatDate()
  const exportColumns: TableExportColumn<GraphQLRole>[] = useMemo(
    () => roleExportColumns(formatDate),
    [formatDate],
  )
  const { exporting, handleExport } = useTableExport({
    data: allRoles,
    columns: exportColumns,
    filename: 'Roles',
    sheetName: 'Roles',
    title: exportTitle(allRoles.length),
  })

  const requestDelete = (role: GraphQLRole) => {
    void confirm({
      title: DELETE_ROLE_TITLE,
      description: (
        <>
          {ROW_CONFIRM.lead} <strong>&quot;{role.name}&quot;</strong>?
          <span className={styles.confirmNote}>{ROW_CONFIRM.note}</span>
        </>
      ),
      confirmLabel: ROW_CONFIRM.confirmLabel,
      cancelLabel: ROW_CONFIRM.cancelLabel,
      tone: 'danger',
      onConfirm: () => onDelete(role.id),
    })
  }

  const columns: DataTableColumn<GraphQLRole>[] = [
    {
      key: 'role',
      header: 'Role',
      emphasis: 'key',
      cell: (role) => (
        <span className={styles.roleCell}>
          <span className={styles.roleTile} aria-hidden="true">
            <IconShieldHalf size={15} stroke={strokeFor(15)} />
          </span>
          <span className={styles.roleName}>{role.name}</span>
        </span>
      ),
    },
    { key: 'permissions', header: 'Permissions', cell: (role) => <PermissionsCell role={role} /> },
    { key: 'domains', header: 'Domains', cell: (role) => <DomainsCell role={role} /> },
    {
      key: 'updated',
      header: 'Updated',
      cell: (role) => (
        <UpdatedCell updatedAt={role.updatedAt} formatDate={formatDate} formatTime={formatTime} />
      ),
    },
  ]

  return (
    <Card
      title={TABLE_TITLE}
      sub={roleCountLabel(allRoles.length)}
      body="table"
      tools={
        <Button
          variant="primary"
          size="sm"
          icon={<IconDownload size={15} stroke={strokeFor(15)} />}
          loading={exporting}
          onClick={() => void handleExport()}
          disabled={!allRoles.length || fetching}
        >
          Export Excel
        </Button>
      }
    >
      <DataTable
        columns={columns}
        rows={roles}
        rowKey={(role) => role.id}
        label="Roles"
        state={fetching ? 'loading' : 'ready'}
        width="wide"
        empty={
          <EmptyState
            title="No roles found"
            icon={<IconShieldHalf size={20} stroke={strokeFor(20)} />}
          />
        }
        rowActions={(role) => ({
          primary: (
            <span className={styles.rowActions}>
              <Tooltip content="View Role">
                <IconButton
                  size="sm"
                  label={`View ${role.name}`}
                  icon={<IconEye size={ACTION_ICON} stroke={strokeFor(ACTION_ICON)} />}
                  onClick={() => onView(role)}
                />
              </Tooltip>
              <Tooltip content="Edit Role">
                <IconButton
                  size="sm"
                  label={`Edit ${role.name}`}
                  icon={<IconPencil size={ACTION_ICON} stroke={strokeFor(ACTION_ICON)} />}
                  onClick={() => onEdit(role)}
                />
              </Tooltip>
              <RBACGuard required={[{ domain: 'security.roles', actions: ['delete'] }]} fallback={null}>
                <Tooltip content="Delete Role">
                  <IconButton
                    size="sm"
                    label={`Delete ${role.name}`}
                    icon={<IconTrash size={ACTION_ICON} stroke={strokeFor(ACTION_ICON)} />}
                    aria-disabled={deleting || undefined}
                    aria-busy={deleting || undefined}
                    onClick={() => requestDelete(role)}
                  />
                </Tooltip>
              </RBACGuard>
            </span>
          ),
        })}
      />
      {footer}
    </Card>
  )
}
