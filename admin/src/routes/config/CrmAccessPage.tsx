import { useId, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react'
import { CRM_WHITELABELS, SET_CRM_WHITELABEL_SETTINGS, CRM_CREATE_FIRST_ADMIN } from '@/lib/graphql/crm'
import { notify } from '@/shared/services/notification'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Dialog } from '@/ui/components/Dialog'
import { Form } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { PasswordField } from '@/ui/components/PasswordField'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { TextField } from '@/ui/components/TextField'
import { strokeFor } from '@/ui/components/icons'
import { useForm, type FormApi } from '@/ui/form/useForm'
import {
  EMPTY_FIRST_ADMIN,
  FIRST_ADMIN_CREATED_MESSAGE,
  FIRST_ADMIN_CREATED_TITLE,
  FIRST_ADMIN_FAILED_TITLE,
  FIRST_ADMIN_FALLBACK_ERROR,
  SAVED_TITLE,
  SAVE_FAILED_TITLE,
  SEAT_LIMIT_MAX,
  SEAT_LIMIT_MIN,
  boundedSeatStep,
  canCreateFirstAdmin,
  crmAddress,
  draftValue,
  firstAdminOutcome,
  firstAdminSchema,
  firstAdminTitle,
  firstAdminVariables,
  isDirty,
  saveVariables,
  savedMessage,
  seatUsage,
  stepDirection,
  withEdit,
  withSeatLimitClamped,
  withTypedSeatLimit,
  withoutDraft,
  type CrmAccessDrafts,
  type CrmAccessRow,
  type FirstAdminValues,
  type FirstAdminVariables,
} from './crmAccessModel'
import styles from './CrmAccessPage.module.css'

const NOTICE_ICON_SIZE = 18

/**
 * Super Admin control over which whitelabels have a CRM, and how many people
 * each may put on it.
 *
 * Both gates start closed. A whitelabel with no allowance here has no CRM at
 * all — its crm.<domain> refuses every sign-in — so granting access is always a
 * deliberate act rather than something a new whitelabel inherits.
 */
export default function CrmAccessPage() {
  const pageEyebrow = usePageEyebrow()
  const seatRangeId = useId()
  const { data, loading, error, refetch } = useQuery(CRM_WHITELABELS, { fetchPolicy: 'cache-and-network' })

  /** Edits held locally until saved, so a half-typed seat count is never applied. */
  const [drafts, setDrafts] = useState<CrmAccessDrafts>({})
  const [bootstrapFor, setBootstrapFor] = useState<CrmAccessRow | null>(null)

  const [save, { loading: saving }] = useMutation(SET_CRM_WHITELABEL_SETTINGS, {
    onCompleted: (result) => {
      const row = result.setCrmWhitelabelSettings
      notify.success(savedMessage(row), SAVED_TITLE)
      setDrafts((prev) => withoutDraft(prev, row.tenant))
      refetch()
    },
    onError: (err) => notify.error(err.message, SAVE_FAILED_TITLE),
  })

  const [createAdmin, { loading: creating }] = useMutation(CRM_CREATE_FIRST_ADMIN, {
    onCompleted: (res) => {
      const outcome = firstAdminOutcome(res.crmCreateFirstAdmin)
      if (outcome.ok) {
        notify.success(FIRST_ADMIN_CREATED_MESSAGE, FIRST_ADMIN_CREATED_TITLE)
        // Closing unmounts the dialog's form, which is what the legacy form.resetFields() did.
        setBootstrapFor(null)
        refetch()
      } else {
        notify.error(outcome.error, FIRST_ADMIN_FAILED_TITLE)
      }
    },
    onError: (err) => notify.error(err.message, FIRST_ADMIN_FALLBACK_ERROR),
  })

  const edit = (tenant: string, patch: Partial<CrmAccessRow>) => setDrafts((prev) => withEdit(prev, tenant, patch))

  const rows: CrmAccessRow[] = data?.crmWhitelabels ?? []

  const columns: DataTableColumn<CrmAccessRow>[] = [
    {
      key: 'whitelabel',
      header: 'Whitelabel',
      cell: (row) => (
        <span className={styles.whitelabel}>
          <span className={styles.whitelabelName}>{row.name}</span>
          <span className={styles.whitelabelAddress}>{crmAddress(row)}</span>
        </span>
      ),
    },
    {
      key: 'crm',
      header: 'CRM',
      width: 130,
      cell: (row) => {
        const on = draftValue(row, drafts, 'enabled')
        return (
          <span className={styles.switchCell}>
            <Switch
              label={`CRM for ${row.name}`}
              hideLabel
              checked={on}
              onChange={(checked) => edit(row.tenant, { enabled: checked })}
            />
            <span className={styles.switchState} aria-hidden="true">
              {on ? 'On' : 'Off'}
            </span>
          </span>
        )
      },
    },
    {
      key: 'seats',
      header: 'Seats',
      width: 150,
      cell: (row) => (
        <NumberField
          className={styles.seatField}
          size="sm"
          label={`Seats for ${row.name}`}
          hideLabel
          aria-describedby={seatRangeId}
          value={draftValue(row, drafts, 'seatLimit')}
          // antd kept the seats within 0-500; the kit field reports what is typed, so each value is clamped here
          // and again on blur, and an arrow step that would leave the range is taken here and stops at the bound.
          onChange={(value) => setDrafts((prev) => withTypedSeatLimit(prev, row, value))}
          onBlur={() => setDrafts((prev) => withSeatLimitClamped(prev, row.tenant))}
          onKeyDown={(event) => {
            const direction = stepDirection(event.key)
            if (direction === null) return
            const current = draftValue(row, drafts, 'seatLimit')
            const next = boundedSeatStep(event.currentTarget.value, current, direction, event.shiftKey ? 10 : 1)
            if (next === null) return
            event.preventDefault()
            if (next !== current) edit(row.tenant, { seatLimit: next })
          }}
          disabled={!draftValue(row, drafts, 'enabled')}
        />
      ),
    },
    {
      key: 'inUse',
      header: 'In use',
      width: 120,
      cell: (row) => {
        const usage = seatUsage(row, draftValue(row, drafts, 'seatLimit'))
        if (!usage) return <span className={styles.dash}>—</span>
        return <StatusPill tone={usage.tone}>{usage.text}</StatusPill>
      },
    },
  ]

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title="CRM Access"
        sub={
          <>
            Which whitelabels have a CRM at <code className={styles.code}>crm.&lt;their-domain&gt;</code>, and how
            many people each may put on it.
          </>
        }
      />

      <div className={styles.content}>
        <Notice
          tone="info"
          icon={<IconInfoCircle size={NOTICE_ICON_SIZE} stroke={strokeFor(NOTICE_ICON_SIZE)} />}
          title="Both gates start closed"
        >
          A whitelabel with no allowance here has no CRM: its crm. address refuses every sign-in. Once enabled, the
          whitelabel creates and controls its own CRM users, roles and permissions — you set only whether it may,
          and how many.
        </Notice>

        {error ? (
          <Notice
            tone="error"
            icon={<IconAlertCircle size={NOTICE_ICON_SIZE} stroke={strokeFor(NOTICE_ICON_SIZE)} />}
            title="Could not load CRM access"
          >
            {error.message}
          </Notice>
        ) : null}

        <Card title="CRM Access" body="table">
          <span id={seatRangeId} className={styles.visuallyHidden}>
            {`Seats can be set from ${SEAT_LIMIT_MIN} to ${SEAT_LIMIT_MAX}.`}
          </span>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.tenant}
            label="CRM access by whitelabel"
            state={loading ? 'loading' : 'ready'}
            width="wide"
            rowActions={(row) => ({
              primary: (
                <span className={styles.rowActions}>
                  {canCreateFirstAdmin(row) ? (
                    <Button
                      size="xs"
                      aria-label={`Create first administrator for ${row.name}`}
                      onClick={() => setBootstrapFor(row)}
                    >
                      Create first administrator
                    </Button>
                  ) : null}
                  <Button
                    size="xs"
                    variant="primary"
                    aria-label={`Save ${row.name}`}
                    disabled={!isDirty(drafts, row.tenant)}
                    loading={saving}
                    onClick={() => void save({ variables: saveVariables(row, drafts) })}
                  >
                    Save
                  </Button>
                </span>
              ),
            })}
          />
        </Card>
      </div>

      {bootstrapFor ? (
        <FirstAdminDialog
          row={bootstrapFor}
          creating={creating}
          onCreate={(variables) => createAdmin({ variables })}
          onClose={() => setBootstrapFor(null)}
        />
      ) : null}
    </Page>
  )
}

interface FirstAdminDialogProps {
  row: CrmAccessRow
  creating: boolean
  onCreate: (variables: FirstAdminVariables) => Promise<unknown>
  onClose: () => void
}

/**
 * The first CRM administrator for a whitelabel with nobody on its CRM. Mounted only while it is open, so
 * every opening starts empty (legacy: `destroyOnHidden` and `form.resetFields()` on Cancel and success).
 * The password goes to the server in the mutation and nowhere else.
 */
function FirstAdminDialog({ row, creating, onCreate, onClose }: FirstAdminDialogProps) {
  const formId = `crm-first-admin-${useId().replace(/:/g, '')}`
  // Focus starts in Full name (the kit Dialog would otherwise start on its close button).
  const nameRef = useRef<HTMLInputElement>(null)

  const form: FormApi<FirstAdminValues> = useForm<FirstAdminValues>({
    schema: firstAdminSchema,
    initialValues: EMPTY_FIRST_ADMIN,
    onSubmit: async (values) => {
      await onCreate(firstAdminVariables(row.tenant, values))
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={firstAdminTitle(row.name)}
      description="This account can create the whitelabel's other CRM users and set what each role grants. It is offered only while the whitelabel has no active administrator of its own — after that, further users are created inside the CRM."
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {/* In the dialog's footer, outside the form element, so it names its form. */}
          <Button type="submit" form={formId} variant="primary" loading={creating || form.submitting}>
            Create
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        {form.formError ? (
          <Notice tone="error" icon={<IconAlertCircle size={NOTICE_ICON_SIZE} stroke={strokeFor(NOTICE_ICON_SIZE)} />}>
            {form.formError}
          </Notice>
        ) : null}
        {/* Required is announced (aria-required) but not marked: the legacy form hid required marks. */}
        <TextField {...form.field('name')} ref={nameRef} label="Full name" aria-required />
        <TextField {...form.field('username')} label="Username" autoComplete="off" aria-required />
        <PasswordField
          {...form.field('password')}
          label="Temporary password"
          autoComplete="new-password"
          help="They will be asked to choose their own on first sign-in."
          aria-required
        />
        <TextField {...form.field('email')} type="email" label="Email" />
      </Form>
    </Dialog>
  )
}
