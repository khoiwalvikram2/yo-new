import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { IconAlertCircle, IconPlus, IconShieldLock } from '@tabler/icons-react'
import {
  ADD_IP_TO_ALLOWLIST,
  ADMIN_ROLES,
  ASSIGN_ROLE_TO_ADMIN,
  CREATE_SUPPORT_ADMIN,
  IP_ALLOWLIST,
  REMOVE_IP_FROM_ALLOWLIST,
  REVOKE_ROLE_FROM_ADMIN,
  ROLES,
  SUPPORT_ADMINS,
} from '@/lib/graphql/rbac'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { usePresence } from '@/shared/hooks/usePresence'
import { useTableExport } from '@/shared/hooks/useTableExport'
import { addDays, DEFAULT_ADMIN_TZ, startOfDay } from '@/shared/utils/date'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { usePresenceStore } from '@/state/presenceStore'
import type { Role } from '@/state/rbacStore'
import { Button } from '@/ui/components/Button'
import { confirm } from '@/ui/components/confirm'
import { strokeFor } from '@/ui/components/icons'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { ActivityLogDrawer } from './components/ActivityLogDrawer'
import { CreateSupportAdminDrawer } from './components/CreateSupportAdminDrawer'
import { IpAllowlistDrawer } from './components/IpAllowlistDrawer'
import { ManageRolesDrawer } from './components/ManageRolesDrawer'
import { SupportAdminsTable, type SupportAdminActions } from './components/SupportAdminsTable'
import {
  AUDIT_QUERY,
  ADMIN_ACTIVITY_PAGE,
  DELETE_USER,
  FORCE_LOGOUT,
  SET_REQUIRE_PASSWORD_RESET,
  SET_USER_STATUS,
} from './supportAdminsOperations'
import {
  DELETE_CONFIRM,
  EXPORT_FILENAME,
  EXPORT_SHEET,
  REMOVE_IP_CONFIRM,
  addIpVariables,
  availableRoles,
  clampPage,
  createAdminVariables,
  deactivateVariables,
  deleteVariables,
  exportTitle,
  filterAdmins,
  forceLogoutVariables,
  latestActivityByAdmin,
  pageOfAdmins,
  reactivateVariables,
  resetPasswordVariables,
  roleVariables,
  supportAdminExportColumns,
  visibleAdmins,
  type AdminUser,
  type AuditEvent,
  type CreateAdminValues,
  type IpAllowlistEntry,
  type IpValues,
} from './supportAdminsModel'
import styles from './SupportAdminsPage.module.css'

interface SupportAdminsData { supportAdmins: AdminUser[] }
interface RolesData { roles: Role[] }
interface AdminRolesData { adminRoles: Role[] }
interface AuditData { audit: AuditEvent[]; auditEvents?: { items: AuditEvent[]; total: number } }
interface IpAllowlistData { ipAllowlist: IpAllowlistEntry[] }
interface CreateResult { createSupportAdmin: { success: boolean; message?: string | null } }

const PAGE_TITLE = 'Support Admins'
const PAGE_SUB = 'Manage support admin users and their role assignments'

export default function SupportAdminsPage() {
  return (
    <RBACGuard required={[{ domain: 'security.support-admins', actions: ['view'] }]}>
      <SupportAdminsPageContent />
    </RBACGuard>
  )
}

function SupportAdminsPageContent() {
  usePresence()
  const pageEyebrow = usePageEyebrow()
  const onlineIds = usePresenceStore((state) => state.onlineAdminIds)
  const { formatDate, formatTime, formatDateTime } = useFormatDate()
  const permissions = useAuthStore((state) => state.permissions) || []
  const currentUserId = useAuthStore((state) => state.user?.id)
  const hasRolesRead = hasPermissionWithNested(permissions, 'security.support-admins', 'view')
  const hasRolesAssign = hasPermissionWithNested(permissions, 'security.roles', 'assign')
  const hasReadPermission = hasRolesRead || hasRolesAssign
  const hasWritePermission = hasPermissionWithNested(permissions, 'security.support-admins', 'create')
  const hasAssignPermission = hasPermissionWithNested(permissions, 'security.roles', 'assign')

  const [createOpen, setCreateOpen] = useState(false)
  const [manageRolesOpen, setManageRolesOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [selectedAdmin, setSelectedAdmin] = useState<AdminUser | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const overlayTriggerRef = useRef<HTMLElement | null>(null)

  const { data, loading, error, refetch } = useQuery<SupportAdminsData>(SUPPORT_ADMINS, {
    errorPolicy: 'all',
    skip: !hasReadPermission,
  })
  const { data: rolesData } = useQuery<RolesData>(ROLES, {
    errorPolicy: 'all',
    skip: !hasReadPermission,
  })
  const { data: adminRolesData, loading: rolesLoading, refetch: refetchRoles } = useQuery<AdminRolesData>(ADMIN_ROLES, {
    variables: { userId: selectedAdmin?.id || '' },
    skip: !selectedAdmin || !hasReadPermission,
    errorPolicy: 'all',
  })

  const [activityPage, setActivityPage] = useState(1)
  const [activityPageSize, setActivityPageSize] = useState(20)
  const auditVariables = useMemo(() => {
    const now = new Date()
    return {
      actorId: selectedAdmin?.id || '',
      from: addDays(startOfDay(now, DEFAULT_ADMIN_TZ), -7).toISOString(),
      to: now.toISOString(),
    }
  }, [selectedAdmin?.id])
  const { data: auditData, loading: auditLoading } = useQuery<AuditData>(ADMIN_ACTIVITY_PAGE, {
    variables: { filters: { ...auditVariables, limit: activityPageSize, page: activityPage } },
    skip: !selectedAdmin || (!manageRolesOpen && !auditOpen),
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: false,
  })

  const admins = useMemo(() => visibleAdmins(data?.supportAdmins, currentUserId), [currentUserId, data?.supportAdmins])
  const recentVariables = useMemo(() => {
    const now = new Date()
    return {
      from: addDays(startOfDay(now, DEFAULT_ADMIN_TZ), -7).toISOString(),
      to: now.toISOString(),
      limit: 500,
    }
  }, [])
  const { data: recentData } = useQuery<AuditData>(AUDIT_QUERY, {
    variables: recentVariables,
    skip: !hasReadPermission || loading,
    errorPolicy: 'all',
    fetchPolicy: 'cache-first',
  })
  const { data: ipData, loading: ipLoading, refetch: refetchIp } = useQuery<IpAllowlistData>(IP_ALLOWLIST, {
    variables: { userId: selectedAdmin?.id || '' },
    skip: !selectedAdmin || !securityOpen,
    errorPolicy: 'all',
  })

  const [createSupportAdmin, { loading: creating }] = useMutation<CreateResult>(CREATE_SUPPORT_ADMIN)
  const [assignRole] = useMutation(ASSIGN_ROLE_TO_ADMIN)
  const [revokeRole] = useMutation(REVOKE_ROLE_FROM_ADMIN)
  const [setUserStatus] = useMutation(SET_USER_STATUS)
  const [forceLogout] = useMutation(FORCE_LOGOUT)
  const [setRequirePasswordReset] = useMutation(SET_REQUIRE_PASSWORD_RESET)
  const [deleteUser] = useMutation(DELETE_USER)
  const [addIp, { loading: addingIp }] = useMutation(ADD_IP_TO_ALLOWLIST)
  const [removeIp] = useMutation(REMOVE_IP_FROM_ALLOWLIST)

  const filtered = useMemo(() => filterAdmins(admins, search), [admins, search])
  const shownPage = clampPage(page, filtered.length, pageSize)
  const rows = useMemo(() => pageOfAdmins(filtered, shownPage, pageSize), [filtered, pageSize, shownPage])
  const latestActivity = useMemo(
    () => latestActivityByAdmin(recentData?.audit, admins),
    [admins, recentData?.audit],
  )
  const allRoles = rolesData?.roles ?? []
  const assignedRoles = adminRolesData?.adminRoles ?? []
  const unassignedRoles = availableRoles(allRoles, assignedRoles)
  const exportColumns = useMemo(() => supportAdminExportColumns((value) => formatDate(value)), [formatDate])
  const { exporting, handleExport } = useTableExport({
    data: filtered,
    columns: exportColumns,
    filename: EXPORT_FILENAME,
    sheetName: EXPORT_SHEET,
    title: exportTitle(filtered.length),
  })

  const closeSelectedOverlay = () => {
    setManageRolesOpen(false)
    setSecurityOpen(false)
    setAuditOpen(false)
    setSelectedAdmin(null)
  }
  const rememberTrigger = (event: MouseEvent<HTMLElement>) => {
    overlayTriggerRef.current = event.currentTarget
  }
  const selectAndOpen = (admin: AdminUser, open: (value: boolean) => void) => {
    setSelectedAdmin(admin)
    open(true)
  }

  const submitCreate = async (values: CreateAdminValues) => {
    const result = await createSupportAdmin({ variables: createAdminVariables(values) })
    if (result.data?.createSupportAdmin?.success) {
      setCreateOpen(false)
      await refetch()
    }
  }
  const submitAssign = async (roleId: string) => {
    if (!selectedAdmin) return
    const result = await assignRole({ variables: roleVariables(selectedAdmin.id, roleId) })
    if (result.data?.assignRoleToAdmin?.success) await Promise.all([refetchRoles(), refetch()])
  }
  const submitRevoke = async (roleId: string) => {
    if (!selectedAdmin) return
    const result = await revokeRole({ variables: roleVariables(selectedAdmin.id, roleId) })
    if (result.data?.revokeRoleFromAdmin?.success) await Promise.all([refetchRoles(), refetch()])
  }
  const submitAddIp = async (values: IpValues) => {
    if (!selectedAdmin) return
    await addIp({ variables: addIpVariables(selectedAdmin.id, values) })
    await refetchIp()
  }
  const submitRemoveIp = async (entry: IpAllowlistEntry) => {
    await confirm({
      title: REMOVE_IP_CONFIRM.title,
      confirmLabel: REMOVE_IP_CONFIRM.confirmLabel,
      cancelLabel: REMOVE_IP_CONFIRM.cancelLabel,
      tone: REMOVE_IP_CONFIRM.tone,
      onConfirm: async () => {
        await removeIp({ variables: { id: entry.id } })
        await refetchIp()
      },
    })
  }

  const actions: SupportAdminActions = {
    onTrigger: rememberTrigger,
    onManageRoles: (admin) => selectAndOpen(admin, setManageRolesOpen),
    onOpenAudit: (admin) => selectAndOpen(admin, setAuditOpen),
    onOpenSecurity: (admin) => selectAndOpen(admin, setSecurityOpen),
    onDeactivate: (admin) => { void setUserStatus({ variables: deactivateVariables(admin) }).then(() => refetch()) },
    onReactivate: (admin) => { void setUserStatus({ variables: reactivateVariables(admin) }).then(() => refetch()) },
    onForceLogout: (admin) => { void forceLogout({ variables: forceLogoutVariables(admin) }).then(() => refetch()) },
    onResetPassword: (admin) => {
      void setRequirePasswordReset({ variables: resetPasswordVariables(admin) }).then(() => refetch())
    },
    onDelete: (admin) => {
      void confirm({
        title: DELETE_CONFIRM.title,
        description: (
          <>
            <span className={styles.line}>Are you sure you want to delete <strong>{admin.name}</strong>?</span>
            <span className={styles.warning}>{DELETE_CONFIRM.warning}</span>
          </>
        ),
        confirmLabel: DELETE_CONFIRM.confirmLabel,
        cancelLabel: DELETE_CONFIRM.cancelLabel,
        tone: DELETE_CONFIRM.tone,
        onConfirm: async () => {
          await deleteUser({ variables: deleteVariables(admin) })
          await refetch()
        },
      })
    },
  }

  if (!hasReadPermission) {
    return (
      <Page maxWidth="wide">
        <PageHeader eyebrow={pageEyebrow} title={PAGE_TITLE} sub={PAGE_SUB} />
        <Notice tone="error" icon={<IconShieldLock size={18} stroke={strokeFor(18)} />} title="Access Denied">
          <span className={styles.line}>You don&apos;t have permission to view support admins. Please contact your administrator.</span>
          <span className={styles.line}>Required permission: <code className={styles.code}>roles:read</code></span>
        </Notice>
      </Page>
    )
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title={PAGE_TITLE}
        sub={PAGE_SUB}
        actions={hasWritePermission && hasAssignPermission ? (
          <Button
            variant="primary"
            icon={<IconPlus size={16} stroke={strokeFor(16)} />}
            onClick={(event) => {
              rememberTrigger(event)
              setCreateOpen(true)
            }}
          >
            Create Support Admin
          </Button>
        ) : null}
      />
      <div className={styles.content}>
        {error ? (
          <Notice
            tone="error"
            live="assertive"
            icon={<IconAlertCircle size={18} stroke={strokeFor(18)} />}
            title="Error loading support admins"
          >
            {error.message || 'Failed to load support admins. Please try again.'}
          </Notice>
        ) : null}
        <SupportAdminsTable
          rows={rows}
          total={filtered.length}
          loading={loading && !data}
          onlineIds={onlineIds}
          activity={latestActivity}
          now={new Date()}
          formatDate={(value, pattern) => formatDate(value, pattern)}
          formatTime={(value, pattern) => formatTime(value, pattern)}
          search={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          exporting={exporting}
          onExport={() => void handleExport()}
          page={shownPage}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(next) => { setPageSize(next); setPage(1) }}
          actions={actions}
        />
      </div>

      {createOpen ? (
        <CreateSupportAdminDrawer
          open
          roles={allRoles}
          creating={creating}
          restoreFocusTo={overlayTriggerRef}
          onOpenChange={setCreateOpen}
          onSubmit={submitCreate}
        />
      ) : null}
      {selectedAdmin && manageRolesOpen ? (
        <ManageRolesDrawer
          open
          admin={selectedAdmin}
          assignedRoles={assignedRoles}
          availableRoles={unassignedRoles}
          rolesLoading={rolesLoading}
          auditEvents={auditData?.auditEvents?.items ?? []}
          auditLoading={auditLoading}
          canAssign={hasAssignPermission}
          formatDateTime={(value) => formatDateTime(value)}
          restoreFocusTo={overlayTriggerRef}
          onOpenChange={(open) => { if (!open) closeSelectedOverlay() }}
          onAssign={submitAssign}
          onRevoke={submitRevoke}
        />
      ) : null}
      {selectedAdmin && securityOpen ? (
        <IpAllowlistDrawer
          open
          admin={selectedAdmin}
          entries={ipData?.ipAllowlist ?? []}
          loading={ipLoading}
          adding={addingIp}
          formatDate={(value) => formatDate(value)}
          formatTime={(value) => formatTime(value)}
          restoreFocusTo={overlayTriggerRef}
          onOpenChange={(open) => { if (!open) closeSelectedOverlay() }}
          onAdd={submitAddIp}
          onRemove={submitRemoveIp}
        />
      ) : null}
      {selectedAdmin && auditOpen ? (
        <ActivityLogDrawer
          open
          admin={selectedAdmin}
          events={auditData?.auditEvents?.items ?? []}
          pagination={{ current: activityPage, pageSize: activityPageSize, total: auditData?.auditEvents?.total ?? 0, onChange: setActivityPage, onPageSizeChange: size => { setActivityPageSize(size); setActivityPage(1) } }}
          loading={auditLoading}
          formatDate={(value) => formatDate(value)}
          formatTime={(value) => formatTime(value)}
          restoreFocusTo={overlayTriggerRef}
          onOpenChange={(open) => { if (!open) closeSelectedOverlay() }}
        />
      ) : null}
    </Page>
  )
}
