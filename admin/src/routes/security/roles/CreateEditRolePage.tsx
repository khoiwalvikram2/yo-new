import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@apollo/client'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconDeviceFloppy,
  IconShieldLock,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { ROLE_QUERY, PERMISSIONS_QUERY, CREATE_RBAC_ROLE_MUTATION, UPDATE_RBAC_ROLE_MUTATION } from '@/lib/graphql/roles'
import { useAuthStore } from '@/shared/core/authStore'
import { notify } from '@/shared/services/notification'
import { PermissionsSelector } from './components/PermissionsSelector'
import { ROUTES } from '@/shared/core/constants'
import type { Permission } from '@/state/rbacStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Card } from '@/ui/components/Card'
import { Form, FormActions } from '@/ui/components/Form'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { TextField } from '@/ui/components/TextField'
import { useForm } from '@/ui/form/useForm'
import {
  EMPTY_ROLE_VALUES,
  buildCreateRoleInput,
  buildUpdateRoleInput,
  groupPermissionsByDomain,
  pageSub,
  pageTitle,
  roleFormSchema,
  roleFormValues,
  submitLabel,
  type RoleFormValues,
} from './roleFormModel'
import styles from './CreateEditRolePage.module.css'

export default function CreateEditRolePage() {
  return (
    <RBACGuard required={[{ domain: 'security.roles', actions: ['view', 'create', 'update'] }]}>
      <CreateEditRolePageContent />
    </RBACGuard>
  )
}

function CreateEditRolePageContent() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)

  const permissions = useAuthStore(s => s.permissions)
  const hasWritePermission = hasPermissionWithNested(permissions, 'security.roles', 'create') || hasPermissionWithNested(permissions, 'security.roles', 'update')

  // The same check as before, now made before the editor mounts, so a caller who may only view roles starts
  // no request for the role or the permission list.
  if (!hasWritePermission) {
    return (
      <Page>
        <Notice
          tone="error"
          icon={<IconShieldLock size={18} stroke={strokeFor(18)} />}
          title="Access Denied"
        >
          You don&apos;t have permission to create or edit roles. Please contact your administrator.
        </Notice>
      </Page>
    )
  }

  // One editor per route, so its form's first values always belong to the role being edited.
  return <RoleEditor key={id ?? 'new'} id={id} isEdit={isEdit} />
}

function RoleEditor({ id, isEdit }: { id: string | undefined; isEdit: boolean }) {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  // The load error can be closed, as antd's closable Alert could; a new error shows again.
  const [dismissedError, setDismissedError] = useState<unknown>(null)

  // Fetch role data if editing
  const { data: roleData, loading: roleLoading, error: roleError } = useQuery(ROLE_QUERY, {
    variables: { id: id! },
    skip: !isEdit || !id,
    errorPolicy: 'all',
  })

  // Fetch all available permissions
  const { data: permissionsData, loading: permsLoading, error: permsError } = useQuery(PERMISSIONS_QUERY, {
    errorPolicy: 'all',
  })

  const [createRole, { loading: creating }] = useMutation(CREATE_RBAC_ROLE_MUTATION, {
    onCompleted: (data) => {
      if (data?.createRBACRole?.success) {
        notify.success(data.createRBACRole.message || 'Role created successfully!')
        navigate(ROUTES.SECURITY_ROLES)
      } else {
        notify.error(data?.createRBACRole?.message || 'Failed to create role')
      }
    },
    onError: (error) => {
      notify.error(error.message || 'Failed to create role')
    },
  })

  const [updateRole, { loading: updating }] = useMutation(UPDATE_RBAC_ROLE_MUTATION, {
    onCompleted: (data) => {
      if (data?.updateRBACRole?.success) {
        notify.success(data.updateRBACRole.message || 'Role updated successfully!')
        navigate(ROUTES.SECURITY_ROLES)
      } else {
        notify.error(data?.updateRBACRole?.message || 'Failed to update role')
      }
    },
    onError: (error) => {
      notify.error(error.message || 'Failed to update role')
    },
  })

  const role = roleData?.role
  const allPermissions = useMemo<Permission[]>(() => permissionsData?.permissions || [], [permissionsData])

  // Group permissions by domain
  const permissionsByDomain = useMemo(() => groupPermissionsByDomain(allPermissions), [allPermissions])

  // The input is the legacy one: `{ id, name, permissions }` to update, `{ name, permissions }` to create,
  // each permission as `{ domain, actions }`. The mutation's own handlers report the outcome.
  const handleSubmit = async (values: RoleFormValues) => {
    try {
      if (isEdit && id) {
        await updateRole({
          variables: {
            input: buildUpdateRoleInput(id, values),
          },
        })
      } else {
        await createRole({
          variables: {
            input: buildCreateRoleInput(values),
          },
        })
      }
    } catch {
      // reported by the mutation's onError, as before
    }
  }

  const saving = creating || updating
  // Back to Roles is a real link with the button's look (it was a button that navigated).
  const backLinkClass = buttonClassName({ variant: 'secondary' })
  const backLink = (
    <Link to={ROUTES.SECURITY_ROLES} className={backLinkClass}>
      <IconArrowLeft size={16} stroke={strokeFor(16)} aria-hidden="true" />
      <span>Back to Roles</span>
    </Link>
  )

  if (isEdit && roleLoading) {
    return (
      <Page>
        <PageHeader eyebrow={pageEyebrow} title={pageTitle(isEdit)} sub={pageSub(isEdit)} back={{ to: ROUTES.SECURITY_ROLES, label: 'Back to Roles' }} />
        <LoadingState label="Loading role" />
      </Page>
    )
  }

  if (isEdit && roleError && !role) {
    return (
      <Page>
        <PageHeader eyebrow={pageEyebrow} title={pageTitle(isEdit)} sub={pageSub(isEdit)} />
        <Notice
          tone="error"
          icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
          title="Error Loading Role"
          action={backLink}
        >
          {roleError.message || 'Failed to load role data'}
        </Notice>
      </Page>
    )
  }

  const loadError = roleError || permsError
  const showError = Boolean(loadError) && dismissedError !== loadError

  return (
    <Page>
      <PageHeader eyebrow={pageEyebrow} title={pageTitle(isEdit)} sub={pageSub(isEdit)} back={{ to: ROUTES.SECURITY_ROLES, label: 'Back to Roles' }} />

      <div className={styles.content}>
        {showError && (
          <Notice
            tone="error"
            icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
            title="Error loading data"
            action={(
              <IconButton
                size="sm"
                label="Close error message"
                icon={<IconX size={15} stroke={strokeFor(15)} />}
                onClick={() => setDismissedError(loadError)}
              />
            )}
          >
            {roleError?.message || permsError?.message || 'Failed to load data'}
          </Notice>
        )}

        {/* Mounted only once the role is here (or the query finished without it): the form reads its first
            values on its first render, so it never shows empty and fills in later. */}
        <RoleForm
          isEdit={isEdit}
          initialValues={role ? roleFormValues(role) : EMPTY_ROLE_VALUES}
          permissionsByDomain={permissionsByDomain}
          permsLoading={permsLoading}
          saving={saving}
          onSubmit={handleSubmit}
          onCancel={() => navigate(ROUTES.SECURITY_ROLES)}
        />
      </div>
    </Page>
  )
}

function RoleForm({
  isEdit,
  initialValues,
  permissionsByDomain,
  permsLoading,
  saving,
  onSubmit,
  onCancel,
}: {
  isEdit: boolean
  initialValues: RoleFormValues
  permissionsByDomain: Record<string, string[]>
  permsLoading: boolean
  saving: boolean
  onSubmit: (values: RoleFormValues) => Promise<void>
  onCancel: () => void
}) {
  const form = useForm<RoleFormValues>({
    schema: roleFormSchema,
    // useForm reads its initial values on the first render only.
    initialValues,
    onSubmit,
  })
  const name = form.field('name')

  return (
    <Form
      className={styles.form}
      onSubmit={form.handleSubmit}
      errorAnnouncement={form.errorAnnouncement}
      errorAnnouncementRevision={form.errorAnnouncementRevision}
    >
      <Card title="Basic Information">
        <TextField
          {...name}
          className={styles.nameField}
          label="Role Name"
          required
          placeholder="e.g., Support Admin, Content Manager, Marketing Viewer"
          prefix={<IconUser size={16} stroke={strokeFor(16)} />}
        />
      </Card>

      <Card
        title="Role Permissions"
        sub="Configure granular access for each module"
        body="flush"
        className={styles.permissionsCard}
      >
        <PermissionsSelector
          permissionsByDomain={permissionsByDomain}
          loading={permsLoading}
          value={form.values.permissions}
          onChange={(next) => form.setValue('permissions', next)}
        />
      </Card>

      <FormActions className={styles.footer}>
        <p className={styles.footerHint}>
          <span className={styles.requiredMark} aria-hidden="true">*</span> Required fields
        </p>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          loading={saving || form.submitting}
          icon={isEdit
            ? <IconDeviceFloppy size={16} stroke={strokeFor(16)} />
            : <IconCircleCheck size={16} stroke={strokeFor(16)} />}
        >
          {submitLabel(isEdit)}
        </Button>
      </FormActions>
    </Form>
  )
}

