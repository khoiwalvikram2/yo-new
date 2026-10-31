import { useId, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { IconAlertCircle, IconAlertTriangle, IconPlus } from '@tabler/icons-react'
import {
  WHITELABEL_CRM_USERS,
  WHITELABEL_CRM_ROLES,
  WHITELABEL_CRM_CREATE_USER,
  WHITELABEL_CRM_UPDATE_USER,
  WHITELABEL_CRM_SET_USER_STATUS,
  WHITELABEL_CRM_RESET_PASSWORD,
  WHITELABEL_CRM_SET_USER_ROLES,
  WHITELABEL_CRM_DELETE_USER,
  CRM_WHITELABELS,
} from '@/lib/graphql/crm'
import { notify } from '@/shared/services/notification'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { confirm } from '@/ui/components/confirm'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Dialog } from '@/ui/components/Dialog'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form } from '@/ui/components/Form'
import { Meter } from '@/ui/components/Meter'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { PasswordField } from '@/ui/components/PasswordField'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { TextField } from '@/ui/components/TextField'
import { strokeFor } from '@/ui/components/icons'
import { useForm, type FormApi } from '@/ui/form/useForm'
import {
  EMPTY_CREATE_USER,
  EMPTY_RESET_PASSWORD,
  FAILED_TITLE,
  LOAD_FAILED_TITLE,
  PASSWORD_RESET,
  REMOVE_CONFIRM,
  REMOVE_FAILED_TITLE,
  ROLES_UPDATED,
  SAVED_TITLE,
  STATUS_CHANGED,
  STATUS_FAILED_TITLE,
  USER_CREATED,
  USER_REMOVED,
  USER_SAVED,
  assignRoleOptions,
  createRoleOptions,
  createUserSchema,
  createUserVariables,
  editTitle,
  editUserInitialValues,
  editUserSchema,
  editUserVariables,
  removeVariables,
  resetPasswordSchema,
  resetPasswordVariables,
  resetTitle,
  rolesInitialValues,
  rolesSchema,
  rolesTitle,
  rolesVariables,
  seatSummary,
  settleResult,
  statusActionLabel,
  statusTone,
  statusVariables,
  when,
  whitelabelOptions,
  type CreateUserValues,
  type CrmMutationResult,
  type CrmRoleRow,
  type CrmUserRow,
  type CrmUsersPageData,
  type EditUserValues,
  type ResetPasswordValues,
  type RolesValues,
} from './crmUsersModel'
import styles from './CrmUsersPage.module.css'

const ICON_SIZE = 18

/** A CRM user mutation's answer, as Apollo hands it back. */
interface CrmMutationResponse {
  data?: Record<string, CrmMutationResult | null | undefined> | null
}

/**
 * CRM logins, managed by whoever owns the whitelabel.
 *
 * The CRM administers its own users, which is the right home for it — until the
 * whitelabel has no working CRM login, which is exactly when somebody needs to
 * make one. That is what this page is for.
 *
 * Two things it says out loud, because both are easy to get wrong:
 *   - the seat allowance belongs to the Super Admin, so running out is not
 *     something to solve here;
 *   - deleting a CRM user takes their name off the record of every player whose
 *     contact details they ever read, which suspending does not.
 */
export default function CrmUsersPage() {
  const pageEyebrow = usePageEyebrow()
  const [tenant, setTenant] = useState<string | undefined>(undefined)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<CrmUserRow | null>(null)
  const [resetting, setResetting] = useState<CrmUserRow | null>(null)
  const [rolesFor, setRolesFor] = useState<CrmUserRow | null>(null)

  const { data, loading, refetch } = useQuery(WHITELABEL_CRM_USERS, {
    variables: { tenant: tenant ?? null },
    fetchPolicy: 'cache-and-network',
    onError: (err) => notify.error(err.message, LOAD_FAILED_TITLE),
  })
  const page: CrmUsersPageData | undefined = data?.whitelabelCrmUsers
  const canChooseTenant: boolean = page?.canChooseTenant ?? false

  // Only a Super Admin gets a whitelabel picker, and only they can read this.
  const { data: wlData } = useQuery(CRM_WHITELABELS, { skip: !canChooseTenant })

  const { data: roleData } = useQuery(WHITELABEL_CRM_ROLES, {
    variables: { tenant: tenant ?? null },
    skip: !page?.enabled,
  })
  const roles: CrmRoleRow[] = roleData?.whitelabelCrmRoles ?? []

  const done = (label: string) => () => {
    notify.success(label, SAVED_TITLE)
    refetch()
  }
  const failed = (label: string) => (err: Error) => notify.error(err.message, label)

  const [createUser, { loading: creating }] = useMutation(WHITELABEL_CRM_CREATE_USER)
  const [updateUser] = useMutation(WHITELABEL_CRM_UPDATE_USER)
  const [setStatus] = useMutation(WHITELABEL_CRM_SET_USER_STATUS, {
    onCompleted: done(STATUS_CHANGED),
    onError: failed(STATUS_FAILED_TITLE),
  })
  const [resetPassword, { loading: resettingPw }] = useMutation(WHITELABEL_CRM_RESET_PASSWORD)
  const [setRoles] = useMutation(WHITELABEL_CRM_SET_USER_ROLES)
  const [deleteUser] = useMutation(WHITELABEL_CRM_DELETE_USER, {
    onCompleted: done(USER_REMOVED),
    onError: failed(REMOVE_FAILED_TITLE),
  })

  /** Unwraps the { ok, error } result every CRM mutation returns. */
  const settle = (key: string, res: CrmMutationResponse | undefined, okMessage: string): boolean => {
    const outcome = settleResult(res?.data?.[key])
    if (outcome.ok) {
      notify.success(okMessage, SAVED_TITLE)
      refetch()
      return true
    }
    notify.error(outcome.error, FAILED_TITLE)
    return false
  }

  const users: CrmUserRow[] = page?.users ?? []
  const seats = seatSummary(page)
  const { enabled, full } = seats

  /* The dialogs' submits. Each runs only after its form validated; a dialog closes on a settled success and
     stays open with its values otherwise, as before. */
  const submitCreate = async (values: CreateUserValues) => {
    const res = await createUser({ variables: createUserVariables(tenant, values) })
    if (settle('whitelabelCrmCreateUser', res, USER_CREATED)) setCreateOpen(false)
  }
  const submitEdit = async (user: CrmUserRow, values: EditUserValues) => {
    const res = await updateUser({ variables: editUserVariables(tenant, user, values) })
    if (settle('whitelabelCrmUpdateUser', res, USER_SAVED)) setEditing(null)
  }
  const submitReset = async (user: CrmUserRow, values: ResetPasswordValues) => {
    const res = await resetPassword({ variables: resetPasswordVariables(tenant, user, values) })
    if (settle('whitelabelCrmResetPassword', res, PASSWORD_RESET)) setResetting(null)
  }
  const submitRoles = async (user: CrmUserRow, values: RolesValues) => {
    const res = await setRoles({ variables: rolesVariables(tenant, user, values) })
    if (settle('whitelabelCrmSetUserRoles', res, ROLES_UPDATED)) setRolesFor(null)
  }

  // The legacy Popconfirm copy, now a modal confirmation (D5).
  const requestRemove = (user: CrmUserRow) => {
    void confirm({
      ...REMOVE_CONFIRM,
      onConfirm: async () => {
        await deleteUser({ variables: removeVariables(tenant, user) })
      },
    })
  }

  const columns: DataTableColumn<CrmUserRow>[] = [
    {
      key: 'user',
      header: 'User',
      cell: (user) => (
        <span className={styles.user}>
          <span className={styles.userName}>{user.name}</span>
          <span className={styles.userLogin}>{user.username ?? '—'}</span>
        </span>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (user) =>
        user.roleNames.length ? (
          <span className={styles.roles}>
            {user.roleNames.map((name) => (
              <StatusPill key={name} tone="neutral">
                {name}
              </StatusPill>
            ))}
          </span>
        ) : (
          <span className={styles.dim}>None</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 150,
      cell: (user) => (
        <span className={styles.status}>
          <StatusPill tone={statusTone(user.status)}>{user.status}</StatusPill>
          {user.requirePasswordReset ? <span className={styles.statusNote}>must change password</span> : null}
        </span>
      ),
    },
    { key: 'lastSeen', header: 'Last seen', width: 170, cell: (user) => when(user.lastSeenAt) },
  ]

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title="CRM Users"
        sub="Logins for the CRM at crm.<your domain>. These are separate accounts from the admin panel — a CRM user cannot sign in here, and an admin cannot sign in there."
        actions={
          <>
            {canChooseTenant ? (
              <Select
                className={styles.tenantSelect}
                label="Whitelabel"
                hideLabel
                placeholder="Whitelabel"
                value={tenant ?? ''}
                onChange={(value) => setTenant(value)}
                options={whitelabelOptions(wlData?.crmWhitelabels)}
              />
            ) : null}
            <Button
              variant="primary"
              icon={<IconPlus size={16} stroke={strokeFor(16)} />}
              disabled={!enabled || full}
              onClick={() => setCreateOpen(true)}
            >
              New CRM user
            </Button>
          </>
        }
      />

      <div className={styles.content}>
        {/* Shown once the answer says so; before it arrives nothing is known about the whitelabel. */}
        {page && !enabled ? (
          <Notice
            tone="warn"
            icon={<IconAlertTriangle size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
            title="The CRM is switched off for this whitelabel"
          >
            Existing users are listed below but nothing can be changed. Only a Super Admin can switch the CRM on,
            from Config → CRM Access.
          </Notice>
        ) : null}

        <Card title="CRM Users" body="table">
          {enabled ? (
            <div className={styles.seats}>
              <p className={styles.seatsText}>{seats.text}</p>
              {/* The figure is printed above, so the bar is decoration (the kit Meter's unlabelled form). */}
              <Meter className={styles.seatsMeter} value={seats.percent} tone={full ? 'neg' : 'acc'} />
              {full ? (
                <p className={styles.seatsFull}>Every seat is taken. A Super Admin can raise the allowance.</p>
              ) : null}
            </div>
          ) : null}
          <DataTable
            columns={columns}
            rows={users}
            rowKey={(user) => user.id}
            label="CRM users"
            state={loading ? 'loading' : 'ready'}
            width="wide"
            empty={<EmptyState title="No CRM users yet. The first one you create can sign in immediately." />}
            rowActions={(user) => ({
              primary: (
                <span className={styles.rowActions}>
                  <Button size="xs" aria-label={`Edit ${user.name}`} disabled={!enabled} onClick={() => setEditing(user)}>
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    aria-label={`Roles for ${user.name}`}
                    disabled={!enabled}
                    onClick={() => setRolesFor(user)}
                  >
                    Roles
                  </Button>
                  <Button
                    size="xs"
                    aria-label={`Reset password for ${user.name}`}
                    disabled={!enabled}
                    onClick={() => setResetting(user)}
                  >
                    Reset password
                  </Button>
                  <Button
                    size="xs"
                    aria-label={`${statusActionLabel(user.status)} ${user.name}`}
                    disabled={!enabled}
                    onClick={() => void setStatus({ variables: statusVariables(tenant, user) })}
                  >
                    {statusActionLabel(user.status)}
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    aria-label={`Remove ${user.name}`}
                    disabled={!enabled}
                    onClick={() => requestRemove(user)}
                  >
                    Remove
                  </Button>
                </span>
              ),
            })}
          />
        </Card>
      </div>

      {/* Each dialog is mounted only while open, so its form starts from the record it edits (or empty). */}
      {createOpen ? (
        <CreateUserDialog roles={roles} creating={creating} onSubmit={submitCreate} onClose={() => setCreateOpen(false)} />
      ) : null}
      {editing ? (
        <EditUserDialog
          key={editing.id}
          user={editing}
          onSubmit={(values) => submitEdit(editing, values)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {resetting ? (
        <ResetPasswordDialog
          key={resetting.id}
          user={resetting}
          resetting={resettingPw}
          onSubmit={(values) => submitReset(resetting, values)}
          onClose={() => setResetting(null)}
        />
      ) : null}
      {rolesFor ? (
        <RolesDialog
          key={rolesFor.id}
          user={rolesFor}
          roles={roles}
          onSubmit={(values) => submitRoles(rolesFor, values)}
          onClose={() => setRolesFor(null)}
        />
      ) : null}
    </Page>
  )
}

// ---------- dialogs ----------

interface DialogFrameProps {
  title: string
  description?: string
  formId: string
  submitLabel: string
  busy: boolean
  initialFocus: { current: HTMLInputElement | null }
  onClose: () => void
  children: ReactNode
}

/** The legacy Modal frame: title, optional paragraph, Cancel and the OK action in the footer. */
function DialogFrame({ title, description, formId, submitLabel, busy, initialFocus, onClose, children }: DialogFrameProps) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={title}
      description={description}
      size="md"
      initialFocus={initialFocus as { current: HTMLElement | null }}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {/* In the dialog's footer, outside the form element, so it names its form. */}
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}

function useFormId(prefix: string): string {
  return `${prefix}-${useId().replace(/:/g, '')}`
}

/** What a thrown mutation said (legacy: nothing was shown and the dialog stayed open). */
function FormErrorNotice({ message }: { message: string | undefined }) {
  if (!message) return null
  return (
    <Notice tone="error" icon={<IconAlertCircle size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}>
      {message}
    </Notice>
  )
}

function CreateUserDialog({
  roles,
  creating,
  onSubmit,
  onClose,
}: {
  roles: readonly CrmRoleRow[]
  creating: boolean
  onSubmit: (values: CreateUserValues) => Promise<void>
  onClose: () => void
}) {
  const formId = useFormId('crm-new-user')
  const nameRef = useRef<HTMLInputElement>(null)
  const form: FormApi<CreateUserValues> = useForm<CreateUserValues>({
    schema: createUserSchema,
    initialValues: EMPTY_CREATE_USER,
    onSubmit,
  })

  return (
    <DialogFrame
      title="New CRM user"
      description="They sign in at the CRM, not here. Give them the password directly — they will be asked to choose their own the first time they sign in."
      formId={formId}
      submitLabel="Create"
      busy={creating || form.submitting}
      initialFocus={nameRef}
      onClose={onClose}
    >
      <Form
        id={formId}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        <FormErrorNotice message={form.formError} />
        {/* Required is announced (aria-required) but not marked: the legacy forms hid required marks. */}
        <TextField {...form.field('name')} ref={nameRef} label="Name" placeholder="Asha Menon" aria-required />
        <TextField {...form.field('username')} label="Username" placeholder="asha" autoComplete="off" aria-required />
        <PasswordField {...form.field('password')} label="Password" autoComplete="new-password" aria-required />
        <TextField {...form.field('email')} label="Email" />
        <MultiSelect
          {...form.field('roleIds')}
          label="Roles"
          placeholder="Choose one or more"
          clearable
          options={createRoleOptions(roles)}
          help="Without a role they can sign in and do nothing."
        />
      </Form>
    </DialogFrame>
  )
}

function EditUserDialog({
  user,
  onSubmit,
  onClose,
}: {
  user: CrmUserRow
  onSubmit: (values: EditUserValues) => Promise<void>
  onClose: () => void
}) {
  const formId = useFormId('crm-edit-user')
  const nameRef = useRef<HTMLInputElement>(null)
  const form: FormApi<EditUserValues> = useForm<EditUserValues>({
    schema: editUserSchema,
    // useForm reads its initial values on the first render only; the dialog mounts with the record.
    initialValues: editUserInitialValues(user),
    onSubmit,
  })

  return (
    <DialogFrame
      title={editTitle(user.name)}
      formId={formId}
      submitLabel="Save"
      busy={form.submitting}
      initialFocus={nameRef}
      onClose={onClose}
    >
      <Form
        id={formId}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        <FormErrorNotice message={form.formError} />
        <TextField {...form.field('name')} ref={nameRef} label="Name" aria-required />
        <TextField {...form.field('email')} label="Email" />
        <TextField {...form.field('phone')} label="Phone" />
      </Form>
    </DialogFrame>
  )
}

function ResetPasswordDialog({
  user,
  resetting,
  onSubmit,
  onClose,
}: {
  user: CrmUserRow
  resetting: boolean
  onSubmit: (values: ResetPasswordValues) => Promise<void>
  onClose: () => void
}) {
  const formId = useFormId('crm-reset-password')
  const passwordRef = useRef<HTMLInputElement>(null)
  const form: FormApi<ResetPasswordValues> = useForm<ResetPasswordValues>({
    schema: resetPasswordSchema,
    initialValues: EMPTY_RESET_PASSWORD,
    onSubmit,
  })

  return (
    <DialogFrame
      title={resetTitle(user.name)}
      description="They will have to choose a new one the first time they sign in with it, so a password you send over chat cannot stay in use."
      formId={formId}
      submitLabel="Reset"
      busy={resetting || form.submitting}
      initialFocus={passwordRef}
      onClose={onClose}
    >
      <Form
        id={formId}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        <FormErrorNotice message={form.formError} />
        <PasswordField
          {...form.field('newPassword')}
          ref={passwordRef}
          label="New password"
          autoComplete="new-password"
          aria-required
        />
      </Form>
    </DialogFrame>
  )
}

function RolesDialog({
  user,
  roles,
  onSubmit,
  onClose,
}: {
  user: CrmUserRow
  roles: readonly CrmRoleRow[]
  onSubmit: (values: RolesValues) => Promise<void>
  onClose: () => void
}) {
  const formId = useFormId('crm-user-roles')
  const rolesRef = useRef<HTMLInputElement>(null)
  const form: FormApi<RolesValues> = useForm<RolesValues>({
    schema: rolesSchema,
    // useForm reads its initial values on the first render only; the dialog mounts with the record.
    initialValues: rolesInitialValues(user),
    onSubmit,
  })

  return (
    <DialogFrame
      title={rolesTitle(user.name)}
      formId={formId}
      submitLabel="Save"
      busy={form.submitting}
      initialFocus={rolesRef}
      onClose={onClose}
    >
      <Form
        id={formId}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        <FormErrorNotice message={form.formError} />
        <MultiSelect {...form.field('roleIds')} ref={rolesRef} label="Roles" clearable options={assignRoleOptions(roles)} />
      </Form>
    </DialogFrame>
  )
}
