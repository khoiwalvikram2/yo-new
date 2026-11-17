import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { IconAlertTriangle, IconLock, IconPlus, IconRefresh } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { DELETE_RBAC_ROLE_MUTATION, ROLES_QUERY } from '@/lib/graphql/roles'
import { ROUTES } from '@/shared/core/constants'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { notify } from '@/shared/services/notification'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { confirm } from '@/ui/components/confirm'
import { strokeFor } from '@/ui/components/icons'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { FiltersBar } from './components/FiltersBar'
import { RolesTable } from './components/RolesTable'
import { StatsCards } from './components/StatsCards'
import { ViewRoleModal } from './components/ViewRoleModal'
import {
  ACCESS_DENIED,
  DEFAULT_PAGE_SIZE,
  DELETE_ROLE_TITLE,
  LOAD_ERROR_FALLBACK,
  LOAD_ERROR_TITLE,
  MODAL_CONFIRM,
  PAGE_SIZE_OPTIONS,
  PAGE_SUB,
  PAGE_TITLE,
  clampPage,
  filterRoles,
  pageSlice,
  roleEditPath,
} from './rolesManagementModel'
import type { GraphQLRole } from './types'
import styles from './RolesManagementPage.module.css'

type RolesResult = { roles?: GraphQLRole[] | null }
type DeleteRoleResult = {
  deleteRBACRole?: { success: boolean; message?: string | null } | null
}
const EMPTY_ROLES: GraphQLRole[] = []

export default function RolesManagementPage() {
  const [searchText, setSearchText] = useState('')
  const [roleToView, setRoleToView] = useState<GraphQLRole | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [dismissedError, setDismissedError] = useState<Error | null>(null)
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const permissions = useAuthStore((state) => state.permissions)
  const hasReadPermission = hasPermissionWithNested(permissions, 'security.roles', 'view')
  const hasWritePermission =
    hasPermissionWithNested(permissions, 'security.roles', 'create') ||
    hasPermissionWithNested(permissions, 'security.roles', 'update')

  const {
    data: rolesData,
    loading: rolesLoading,
    error: rolesError,
    refetch,
  } = useQuery<RolesResult>(ROLES_QUERY, {
    errorPolicy: 'all',
    skip: !hasReadPermission,
  })

  const [deleteRole, { loading: deleting }] = useMutation<DeleteRoleResult, { id: string }>(
    DELETE_RBAC_ROLE_MUTATION,
    {
      // The outcome is toasted below; the global notification link stays quiet (it toasted it twice).
      context: { skipNotification: true },
      onCompleted: (data) => {
        if (data.deleteRBACRole?.success) {
          notify.success(data.deleteRBACRole.message || 'Role deleted successfully!')
          void refetch()
          return
        }
        notify.error(data.deleteRBACRole?.message || 'Failed to delete role')
      },
      onError: (error) => {
        notify.error(error.message || 'Failed to delete role')
      },
    },
  )

  const roles = rolesData?.roles ?? EMPTY_ROLES
  const filteredRoles = useMemo(() => filterRoles(roles, searchText), [roles, searchText])
  const visiblePage = clampPage(currentPage, filteredRoles.length, pageSize)
  const paginatedRoles = useMemo(
    () => pageSlice(filteredRoles, visiblePage, pageSize),
    [filteredRoles, pageSize, visiblePage],
  )

  const handleDelete = async (roleId: string) => {
    const role = roles.find((candidate) => candidate.id === roleId)
    if (!role) return

    await confirm({
      title: DELETE_ROLE_TITLE,
      description: (
        <>
          {MODAL_CONFIRM.lead} <strong>&quot;{role.name}&quot;</strong>?
          <span className={styles.confirmNote}>{MODAL_CONFIRM.note}</span>
        </>
      ),
      confirmLabel: MODAL_CONFIRM.confirmLabel,
      cancelLabel: MODAL_CONFIRM.cancelLabel,
      tone: 'danger',
      onConfirm: async () => {
        await deleteRole({ variables: { id: role.id } })
      },
    })
  }

  if (!hasReadPermission) {
    return (
      <Page maxWidth="wide" className={styles.content}>
        <PageHeader title={PAGE_TITLE} eyebrow={pageEyebrow} sub={PAGE_SUB} />
        <Notice
          tone="error"
          icon={<IconLock size={18} stroke={strokeFor(18)} />}
          title={ACCESS_DENIED.title}
        >
          {ACCESS_DENIED.text}
          <span className={styles.accessRequirement}>
            {ACCESS_DENIED.requirementLead}{' '}
            <code className={styles.accessCode}>{ACCESS_DENIED.requirement}</code>
          </span>
        </Notice>
      </Page>
    )
  }

  return (
    <Page maxWidth="wide" className={styles.content}>
      <PageHeader
        title={PAGE_TITLE}
        eyebrow={pageEyebrow}
        sub={PAGE_SUB}
        actions={
          <div className={styles.headerActions}>
            <Button
              size="sm"
              icon={<IconRefresh size={15} stroke={strokeFor(15)} />}
              disabled={rolesLoading}
              onClick={() => {
                setDismissedError(null)
                void refetch()
              }}
            >
              Refresh
            </Button>
            {hasWritePermission ? (
              <Button
                variant="primary"
                size="sm"
                icon={<IconPlus size={15} stroke={strokeFor(15)} />}
                onClick={() => navigate(ROUTES.SECURITY_ROLES_CREATE)}
              >
                Create Role
              </Button>
            ) : null}
          </div>
        }
      />

      {rolesError && rolesError !== dismissedError ? (
        <Notice
          tone="error"
          live="polite"
          icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
          title={LOAD_ERROR_TITLE}
          action={
            <Button variant="link" size="sm" onClick={() => setDismissedError(rolesError)}>
              Dismiss
            </Button>
          }
        >
          {rolesError.message || LOAD_ERROR_FALLBACK}
        </Notice>
      ) : null}

      <StatsCards />

      <FiltersBar
        query={searchText}
        onChangeQuery={setSearchText}
        onClearAll={() => setSearchText('')}
      />

      <RolesTable
        roles={paginatedRoles}
        allRoles={filteredRoles}
        fetching={rolesLoading}
        onEdit={(role) => navigate(roleEditPath(role.id))}
        onView={setRoleToView}
        onDelete={handleDelete}
        deleting={deleting}
        footer={
          filteredRoles.length > 0 ? (
            <Pagination
              current={visiblePage}
              pageSize={pageSize}
              total={filteredRoles.length}
              onChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              itemName="roles"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              variant="embedded"
            />
          ) : undefined
        }
      />

      <ViewRoleModal
        open={roleToView !== null}
        role={roleToView}
        onClose={() => setRoleToView(null)}
      />
    </Page>
  )
}
