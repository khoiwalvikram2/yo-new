import { useState, type RefObject } from 'react'
import { IconHistory, IconUserShield } from '@tabler/icons-react'
import clsx from 'clsx'
import type { Role } from '@/state/rbacStore'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { StatusPill } from '@/ui/components/StatusPill'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import {
  effectivePermissions,
  formatAction,
  permissionCountLabel,
  timelineTone,
  type AdminUser,
  type AuditEvent,
} from '../supportAdminsModel'
import styles from '../SupportAdminsPage.module.css'
import { DrawerFooter, DrawerIntro, DrawerSection } from './DrawerParts'

type RolesTab = 'roles' | 'activity'

const TABS: TabItem<RolesTab>[] = [
  { value: 'roles', label: 'Roles' },
  { value: 'activity', label: 'Activity' },
]

interface ManageRolesDrawerProps {
  open: boolean
  admin: AdminUser
  assignedRoles: readonly Role[]
  availableRoles: readonly Role[]
  rolesLoading: boolean
  auditEvents: readonly AuditEvent[]
  auditLoading: boolean
  canAssign: boolean
  formatDateTime: (value: string) => string
  restoreFocusTo: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onAssign: (roleId: string) => Promise<void>
  onRevoke: (roleId: string) => Promise<void>
}

export function ManageRolesDrawer({
  open,
  admin,
  assignedRoles,
  availableRoles,
  rolesLoading,
  auditEvents,
  auditLoading,
  canAssign,
  formatDateTime,
  restoreFocusTo,
  onOpenChange,
  onAssign,
  onRevoke,
}: ManageRolesDrawerProps) {
  const [tab, setTab] = useState<RolesTab>('roles')
  const [busyRole, setBusyRole] = useState<string | null>(null)
  const permissions = effectivePermissions(assignedRoles)

  const runRoleAction = async (roleId: string, action: (id: string) => Promise<void>) => {
    setBusyRole(roleId)
    try {
      await action(roleId)
    } finally {
      setBusyRole(null)
    }
  }

  const assignedColumns: DataTableColumn<Role>[] = [
    { key: 'name', header: 'Role Name', cell: (role) => role.name, emphasis: 'key' },
    { key: 'permissions', header: 'Permissions', cell: (role) => <StatusPill tone="info">{permissionCountLabel(role)}</StatusPill> },
  ]
  const availableColumns: DataTableColumn<Role>[] = [...assignedColumns]

  return (
    <Drawer
      title="Manage Roles - Administrator"
      size="md"
      open={open}
      onOpenChange={onOpenChange}
      themeFrom={restoreFocusTo}
      restoreFocusTo={restoreFocusTo}
      footer={(
        <DrawerFooter hint="Manage role assignments and permissions for this administrator">
          <Button size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </DrawerFooter>
      )}
    >
      <div className={styles.drawerBody}>
        <DrawerIntro
          icon={<IconUserShield size={17} stroke={strokeFor(17)} />}
          title={admin.name}
          sub="Role management and permissions"
          tag="Manage Roles"
          tagTone="info"
        />
        {permissions.length > 0 ? (
          <section className={styles.permissions} aria-label="Effective permissions">
            <h3 className={styles.sectionTitle}>Effective Permissions</h3>
            <div className={styles.tagList}>
              {permissions.map((permission) => (
                <StatusPill key={permission.domain} tone="info">{permission.label}</StatusPill>
              ))}
            </div>
          </section>
        ) : null}
        <Tabs value={tab} items={TABS} onChange={setTab} label="Administrator details" idPrefix="support-admin-roles" size="sm" />
        <div
          className={styles.tabPanel}
          role="tabpanel"
          id={tabPanelId('support-admin-roles', tab)}
          aria-labelledby={tabId('support-admin-roles', tab)}
        >
          {tab === 'roles' ? (
            <>
              <DrawerSection title="Assigned Roles">
                <div className={styles.tableBox}>
                  <DataTable
                    columns={assignedColumns}
                    rows={assignedRoles}
                    rowKey={(role) => role.id}
                    label="Assigned roles"
                    state={rolesLoading ? 'loading' : 'ready'}
                    density="compact"
                    empty={<EmptyState title="No roles assigned" inset="none" />}
                    pagination={false}
                    rowActions={canAssign ? (role) => ({
                      primary: (
                        <Button
                          size="xs"
                          variant="danger"
                          loading={busyRole === role.id}
                          onClick={() => void runRoleAction(role.id, onRevoke)}
                        >
                          Revoke
                        </Button>
                      ),
                    }) : undefined}
                  />
                </div>
              </DrawerSection>
              <DrawerSection title="Available Roles">
                <div className={styles.tableBox}>
                  <DataTable
                    columns={availableColumns}
                    rows={availableRoles}
                    rowKey={(role) => role.id}
                    label="Available roles"
                    density="compact"
                    empty={<EmptyState title="All roles are assigned" inset="none" />}
                    pagination={false}
                    rowActions={canAssign ? (role) => ({
                      primary: (
                        <Button
                          size="xs"
                          variant="link"
                          loading={busyRole === role.id}
                          onClick={() => void runRoleAction(role.id, onAssign)}
                        >
                          Assign
                        </Button>
                      ),
                    }) : undefined}
                  />
                </div>
              </DrawerSection>
            </>
          ) : auditLoading ? (
            <LoadingState label="Loading administrator activity" minHeight={192} />
          ) : auditEvents.length > 0 ? (
            <ol className={styles.timeline} aria-label="Administrator activity">
              {auditEvents.map((event) => {
                const tone = timelineTone(event.action)
                return (
                  <li key={event.id} className={styles.timelineItem}>
                    <span className={clsx(styles.dot, tone === 'ok' ? styles.dotOk : tone === 'neg' && styles.dotNeg)} aria-hidden="true" />
                    <span className={styles.timelineBody}>
                      <span className={styles.timelineAction}>{formatAction(event.action)}</span>
                      <span className={styles.timelineMeta}>{event.timestamp ? formatDateTime(event.timestamp) : '—'}</span>
                      {event.domain ? <span className={styles.timelineMeta}>Domain: {event.domain} | Resource: {event.resourceType}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ol>
          ) : (
            <EmptyState
              title="No activity found"
              icon={<IconHistory size={20} stroke={strokeFor(20)} />}
              inset="none"
            />
          )}
        </div>
      </div>
    </Drawer>
  )
}
