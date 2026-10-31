import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { IconArrowBackUp, IconDeviceFloppy, IconEye, IconEyeOff, IconRefresh } from '@tabler/icons-react'
import clsx from 'clsx'
import { WHITELABEL_PG_SETTINGS, UPSERT_PG_SETTINGS, REGENERATE_PG_WEBHOOK_TOKEN } from '@/lib/graphql/pgSettings'
import { useAppConfig } from '@/shared/core/AppConfigProvider'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { formatDateTime } from '@/shared/services/formatting'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { confirm } from '@/ui/components/confirm'
import { CopyButton } from '@/ui/components/CopyButton'
import { FieldShell } from '@/ui/components/FieldShell'
import { Form, FormActions } from '@/ui/components/Form'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Textarea } from '@/ui/components/Textarea'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { useForm, type FieldBinding, type FormApi } from '@/ui/form/useForm'
import {
  EMPTY_PG_VALUES,
  MIN_DEPOSIT_FLOOR,
  buildPgSettingsInput,
  mutationErrorMessage,
  pgFormValues,
  pgSettingsSchema,
  secretKeyHelp,
  secretKeyPlaceholder,
  type PgSettings,
  type PgSettingsFormValues,
} from './pgSettingsModel'
import styles from './PgSettingsPage.module.css'

const PG_ACCESS_REQUIREMENT = [{ domain: 'payments.pgsettings', actions: ['view'] }]

/**
 * The secret is a password input with a show/hide toggle, as antd's Input.Password was. It keeps its own
 * toggle names ("Show secret site key"), so it stays a kit-faced FieldShell rather than PasswordField.
 */
function SecretKeyField({
  binding,
  settings,
}: {
  binding: FieldBinding<PgSettingsFormValues, 'secretSiteKey'>
  settings: PgSettings | undefined
}) {
  const [visible, setVisible] = useState(false)
  return (
    <FieldShell id={binding.id} label="Secret Site Key" help={secretKeyHelp(settings)} error={binding.error}>
      {(accessibility) => (
        <span className={clsx(styles.secretFace, binding.error && styles.secretInvalid)}>
          <input
            {...accessibility}
            className={styles.secretInput}
            name={binding.name}
            type={visible ? 'text' : 'password'}
            value={binding.value}
            placeholder={secretKeyPlaceholder(settings)}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => binding.onChange(event.target.value)}
            onBlur={binding.onBlur}
          />
          <IconButton
            className={styles.secretToggle}
            size="sm"
            label={visible ? 'Hide secret site key' : 'Show secret site key'}
            icon={visible ? <IconEyeOff size={15} stroke={strokeFor(15)} /> : <IconEye size={15} stroke={strokeFor(15)} />}
            onClick={() => setVisible((shown) => !shown)}
          />
        </span>
      )}
    </FieldShell>
  )
}

export default function PgSettingsPage() {
  return (
    <RBACGuard required={PG_ACCESS_REQUIREMENT}>
      <PgSettingsContent />
    </RBACGuard>
  )
}

function PgSettingsContent() {
  const pageEyebrow = usePageEyebrow()
  const { data, loading, refetch } = useQuery(WHITELABEL_PG_SETTINGS, { fetchPolicy: 'cache-and-network' })
  const s: PgSettings | undefined = data?.whitelabelPgSettings

  // The form mounts only once the settings are here (or the query has finished without them), so its first
  // render already holds them. Seeding a form that was mounted before them, from an effect, put an empty form
  // on screen first and the limits up to two renders later.
  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title="Payment Gateway (PG) Settings"
        sub="Configure the WeLivePay UPI gateway for this whitelabel."
      />

      {!s && loading ? (
        <LoadingState label="Loading PG settings" minHeight={256} />
      ) : (
        <PgSettingsForm settings={s} refetch={refetch} />
      )}
    </Page>
  )
}

/** What is stored and live now, beside the form: the form shows the draft, this shows the saved state. */
function LiveSummary({ settings: s }: { settings: PgSettings | undefined }) {
  const { baseCurrency, timeZone } = useAppConfig()
  const money = (value: number) => {
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: baseCurrency || 'INR', maximumFractionDigits: 0 }).format(value)
    } catch {
      return value.toLocaleString('en-IN')
    }
  }
  const min = s?.minDeposit ?? null
  const max = s?.maxDeposit ?? null
  const range = min === null && max === null ? 'No limits set' : `${min === null ? 'Any' : money(min)} – ${max === null ? 'Any' : money(max)}`
  const redirects = [s?.redirectSuccessUrl, s?.redirectFailureUrl].filter(Boolean).length
  const rows: Array<{ term: string; value: ReactNode }> = [
    { term: 'Gateway', value: s?.enabled ? <StatusPill tone="ok">On</StatusPill> : <StatusPill tone="muted">Off</StatusPill> },
    { term: 'Secret key', value: s?.hasSecretSiteKey ? <StatusPill tone="ok">Saved</StatusPill> : <StatusPill tone="warn">Not set</StatusPill> },
    { term: 'Deposits', value: range },
    { term: 'Redirects', value: `${redirects} of 2 set` },
    { term: 'Last saved', value: s?.updatedAt ? <time dateTime={s.updatedAt}>{formatDateTime(s.updatedAt, timeZone)}</time> : 'Never' },
  ]
  return (
    <Card title="Live configuration" sub="What players get now">
      <dl className={styles.summary}>
        {rows.map((row) => (
          <div key={row.term} className={styles.summaryRow}>
            <dt>{row.term}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function PgSettingsForm({ settings: s, refetch }: { settings: PgSettings | undefined; refetch: () => Promise<unknown> }) {
  const enabledId = useId()
  // Set when a save completes, so the refetched settings replace the saved form.
  const savedRef = useRef(false)

  const [upsert, { loading: saving }] = useMutation(UPSERT_PG_SETTINGS, {
    onCompleted: () => {
      savedRef.current = true
      toast({ message: 'PG settings saved', tone: 'ok' })
      void refetch()
    },
    onError: (e) => toast({ message: mutationErrorMessage(e, 'Failed to save'), tone: 'error' }),
  })
  const [regen] = useMutation(REGENERATE_PG_WEBHOOK_TOKEN, {
    onCompleted: () => {
      toast({ message: 'Webhook token regenerated', tone: 'ok' })
      void refetch()
    },
    onError: (e) => toast({ message: mutationErrorMessage(e, 'Failed to regenerate'), tone: 'error' }),
  })

  const form: FormApi<PgSettingsFormValues> = useForm<PgSettingsFormValues>({
    schema: pgSettingsSchema,
    // useForm reads its initial values on the first render only.
    initialValues: s ? pgFormValues(s) : EMPTY_PG_VALUES,
    onSubmit: async (values) => {
      await upsert({ variables: { input: buildPgSettingsInput(values) } })
      // The secret is never kept in the form after a save attempt, as before.
      form.setValue('secretSiteKey', '')
    },
  })
  const { dirty, reset, setValue, values } = form

  // The stored settings fill the form when they arrive and after a save; a refetch (the cache-and-network
  // answer, a regenerated webhook) does not overwrite edits the admin has not saved.
  useEffect(() => {
    if (!s) return
    if (dirty && !savedRef.current) return
    savedRef.current = false
    reset(pgFormValues(s))
  }, [dirty, reset, s])

  const displayName = form.field('displayName')
  const secretSiteKey = form.field('secretSiteKey')
  const minDeposit = form.field('minDeposit')
  const maxDeposit = form.field('maxDeposit')
  const redirectSuccessUrl = form.field('redirectSuccessUrl')
  const redirectFailureUrl = form.field('redirectFailureUrl')
  const webhookUrl = s?.webhookUrl ?? ''
  const busy = saving || form.submitting

  // Regenerating breaks the URL WeLivePay holds, so it is confirmed first (it was one click before).
  const requestRegenerate = () => {
    void confirm({
      title: 'Regenerate the webhook URL?',
      description: 'The current URL stops working at once. Paste the new URL into WeLivePay onboarding straight away, or payment updates will not credit wallets.',
      confirmLabel: 'Regenerate',
      tone: 'danger',
      onConfirm: async () => { await regen() },
    })
  }

  return (
    <Form
      className={styles.form}
      onSubmit={form.handleSubmit}
      errorAnnouncement={form.errorAnnouncement}
      errorAnnouncementRevision={form.errorAnnouncementRevision}
    >
      <div className={styles.layout}>
        <div className={styles.main}>
          <Card title="Gateway" sub="WeLivePay · UPI deposits">
            <div className={styles.cardBody}>
              <div className={styles.toggleRow}>
                <span className={styles.toggleText}>
                  <label className={styles.toggleLabel} htmlFor={enabledId}>Enable WeLivePay</label>
                  <span className={styles.toggleHelp} id={`${enabledId}-help`}>Offer this gateway to players for deposits on this whitelabel.</span>
                </span>
                <Switch
                  id={enabledId}
                  label="Enable WeLivePay"
                  hideLabel
                  aria-describedby={`${enabledId}-help`}
                  checked={values.enabled}
                  onChange={(checked) => setValue('enabled', checked)}
                />
              </div>
              <TextField {...displayName} label="Display Name" placeholder="UPI (Instant)" required />
            </div>
          </Card>

          <Card
            title="Credentials"
            sub="The secret site key from WeLivePay"
            tools={s?.hasSecretSiteKey ? <StatusPill tone="ok">Key saved</StatusPill> : <StatusPill tone="warn">Not set</StatusPill>}
          >
            <SecretKeyField binding={secretSiteKey} settings={s} />
          </Card>

          <Card title="Deposit limits" sub="For one deposit through this gateway">
            <div className={styles.pair}>
              <NumberField {...minDeposit} label="Min Deposit" min={MIN_DEPOSIT_FLOOR} step={10} grouping="en-IN" />
              <NumberField {...maxDeposit} label="Max Deposit" min={MIN_DEPOSIT_FLOOR} step={100} grouping="en-IN" />
            </div>
          </Card>

          <Card title="Redirects" sub="Where players land after paying">
            <div className={styles.cardBody}>
              <TextField
                {...redirectSuccessUrl}
                type="url"
                label="Success Redirect URL"
                placeholder="https://your-site.com/payment-success"
              />
              <TextField
                {...redirectFailureUrl}
                type="url"
                label="Failure Redirect URL"
                placeholder="https://your-site.com/payment-failed"
              />
            </div>
          </Card>
        </div>

        <aside className={styles.side} aria-label="Webhook and live configuration">
          <Card title="Webhook URL">
            <div className={styles.cardBody}>
              <p className={styles.webhookText}>
                Paste this into WeLivePay onboarding so payment status updates auto-credit wallets.
              </p>
              {/* the whole URL, wrapped, so it can be checked by eye before it is pasted */}
              <Textarea
                label="Webhook URL"
                hideLabel
                readOnly
                rows={2}
                value={webhookUrl}
                placeholder="Not created yet"
                onChange={() => undefined}
                textareaClassName={styles.mono}
              />
              <div className={styles.regenerate}>
                <span className={styles.copyWrap}>
                  <CopyButton
                    variant="bordered"
                    value={webhookUrl}
                    label="Copy webhook URL"
                    copiedLabel="Webhook URL copied"
                    errorLabel="Failed to copy"
                    disabled={!webhookUrl}
                  />
                </span>
                <Button
                  size="sm"
                  icon={<IconRefresh size={14} stroke={strokeFor(14)} />}
                  aria-label="Regenerate webhook URL"
                  onClick={requestRegenerate}
                >
                  Regenerate
                </Button>
                <span className={styles.regenerateNote}>Makes a new URL; the old one stops working.</span>
              </div>
            </div>
          </Card>
          <LiveSummary settings={s} />
        </aside>
      </div>

      <FormActions className={clsx(styles.saveBar, dirty && styles.savePending)}>
        <span className={styles.saveHint}><span className={styles.saveDot} aria-hidden="true" />{dirty ? 'Unsaved changes' : 'Settings are up to date'}</span>
        <Button onClick={() => reset()} disabled={!dirty || busy} icon={<IconArrowBackUp size={16} stroke={strokeFor(16)} />}>
          Discard
        </Button>
        <Button
          type="submit"
          variant="primary"
          icon={<IconDeviceFloppy size={16} stroke={strokeFor(16)} />}
          loading={busy}
        >
          Save PG Settings
        </Button>
      </FormActions>
    </Form>
  )
}
