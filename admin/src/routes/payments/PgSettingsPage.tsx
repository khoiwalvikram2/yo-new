import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconBuildingStore,
  IconDeviceFloppy,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconRefresh,
} from '@tabler/icons-react'
import clsx from 'clsx'
import {
  REGENERATE_PG_WEBHOOK_TOKEN,
  UPSERT_PG_SETTINGS,
  WELIVEPAY_AVAILABLE_GATEWAYS,
  WHITELABEL_PG_SETTINGS,
} from '@/lib/graphql/pgSettings'
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
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Textarea } from '@/ui/components/Textarea'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { useForm, type FieldBinding, type FormApi } from '@/ui/form/useForm'
import { SELECT_WHITELABEL_MESSAGE, SELECT_WHITELABEL_TITLE, scopeAcceptsTenant } from './paymentWhitelabelScope'
import {
  MIN_DEPOSIT_FLOOR,
  MIN_PAYOUT_FLOOR,
  PAYIN_GATEWAY_HELP,
  PAYOUT_GATEWAY_HELP,
  WELIVEPAY_DOCS_URL,
  buildPgSettingsInput,
  gatewayListStatus,
  gatewayName,
  mutationErrorMessage,
  payinGatewayOptions,
  payinGatewayWarning,
  payoutGatewayOptions,
  payoutGatewayWarning,
  pgFormValues,
  pgSettingsSchema,
  secretKeyHelp,
  secretKeyPlaceholder,
  type AvailableGateways,
  type GatewayListStatus,
  type PgSettings,
  type PgSettingsFormValues,
} from './pgSettingsModel'
import { usePaymentWhitelabelScope, type PaymentWhitelabelScope } from './usePaymentWhitelabelScope'
import styles from './PgSettingsPage.module.css'

const PG_ACCESS_REQUIREMENT = [{ domain: 'payments.pgsettings', actions: ['view'] }]

/**
 * The merchant key is a password input with a show/hide toggle, as antd's Input.Password was. It keeps its
 * own toggle names ("Show merchant API key"), so it stays a kit-faced FieldShell rather than PasswordField.
 */
function SecretKeyField({
  binding,
  settings,
}: {
  binding: FieldBinding<PgSettingsFormValues, 'secretSiteKey'>
  settings: PgSettings
}) {
  const [visible, setVisible] = useState(false)
  return (
    <FieldShell id={binding.id} label="Merchant API Key" help={secretKeyHelp(settings)} error={binding.error}>
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
            label={visible ? 'Hide merchant API key' : 'Show merchant API key'}
            icon={visible ? <IconEyeOff size={15} stroke={strokeFor(15)} /> : <IconEye size={15} stroke={strokeFor(15)} />}
            onClick={() => setVisible((shown) => !shown)}
          />
        </span>
      )}
    </FieldShell>
  )
}

/** A switch as a settings row: its name and what it does, the switch at the end of the row. */
function ToggleRow({
  label,
  help,
  checked,
  onChange,
}: {
  label: string
  help: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  const helpId = `${id}-help`
  return (
    <div className={styles.toggleRow}>
      <span className={styles.toggleText}>
        <label className={styles.toggleLabel} htmlFor={id}>{label}</label>
        <span className={styles.toggleHelp} id={helpId}>{help}</span>
      </span>
      <Switch id={id} label={label} hideLabel aria-describedby={helpId} checked={checked} onChange={onChange} />
    </div>
  )
}

/** A select's help line as a warning: the select keeps its value, the line says what WeLivePay will refuse. */
function WarningText({ children }: { children: ReactNode }) {
  return (
    <span className={styles.warnText}>
      <IconAlertTriangle className={styles.warnIcon} size={14} stroke={strokeFor(14)} aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}

/** What the live gateway list holds, or why there is none, with its reload. */
function GatewayListLine({
  status,
  canReload,
  reloading,
  onReload,
}: {
  status: GatewayListStatus
  canReload: boolean
  reloading: boolean
  onReload: () => void
}) {
  return (
    <div className={styles.gatewayList}>
      <p className={clsx(styles.gatewayListText, status.tone === 'error' && styles.gatewayListError)} aria-live="polite">
        {status.text}
      </p>
      {canReload ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<IconRefresh size={14} stroke={strokeFor(14)} />}
          loading={reloading}
          onClick={onReload}
        >
          Reload gateways
        </Button>
      ) : null}
    </div>
  )
}

/** One webhook URL, whole and wrapped so it can be checked by eye before it is pasted, with its copy action. */
function WebhookUrlField({ label, copyLabel, value }: { label: string; copyLabel: string; value: string }) {
  return (
    <div className={styles.urlRow}>
      <Textarea
        label={label}
        readOnly
        rows={2}
        value={value}
        placeholder="Not created yet"
        onChange={() => undefined}
        textareaClassName={styles.mono}
      />
      <span className={styles.copyWrap}>
        <CopyButton
          variant="bordered"
          value={value}
          label={copyLabel}
          copiedLabel={`${label} copied`}
          errorLabel="Failed to copy"
          disabled={!value}
        />
      </span>
    </div>
  )
}

export default function PgSettingsPage() {
  return (
    <RBACGuard required={PG_ACCESS_REQUIREMENT}>
      <PgSettingsForWhitelabel />
    </RBACGuard>
  )
}

/** One page per payment whitelabel: switching the site remounts it, so nothing of the last site's form stays. */
function PgSettingsForWhitelabel() {
  const scope = usePaymentWhitelabelScope()
  return <PgSettingsContent key={scope.key} scope={scope} />
}

function PgSettingsContent({ scope }: { scope: PaymentWhitelabelScope }) {
  const pageEyebrow = usePageEyebrow()
  // A Super Admin with no site selected would only be refused, so nothing is asked.
  const { data, loading, error, refetch } = useQuery(WHITELABEL_PG_SETTINGS, {
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
    skip: scope.selectionRequired,
  })
  const received: PgSettings | undefined = data?.whitelabelPgSettings
  // A Super Admin's answer must be for the selected site: another site's, cached before a switch, is not shown.
  const s = received && scopeAcceptsTenant(scope, received.tenant) ? received : undefined

  // The form mounts only once the settings are here, so its first render already holds them. Seeding a form
  // that was mounted before them, from an effect, put an empty form on screen first and the limits up to two
  // renders later. A failed load shows no form at all: saving an empty one would wipe the site's settings.
  let body: ReactNode
  if (scope.selectionRequired) {
    body = (
      <Notice tone="info" icon={<IconBuildingStore size={18} stroke={strokeFor(18)} />} title={SELECT_WHITELABEL_TITLE}>
        {SELECT_WHITELABEL_MESSAGE}
      </Notice>
    )
  } else if (s) {
    body = <PgSettingsForm settings={s} refetch={refetch} scope={scope} />
  } else if (error && !loading) {
    body = (
      <Notice
        tone="error"
        title="Unable to load the PG settings"
        action={(
          <Button size="sm" icon={<IconRefresh size={14} stroke={strokeFor(14)} />} onClick={() => void refetch().catch(() => undefined)}>
            Retry
          </Button>
        )}
      >
        {error.message}
      </Notice>
    )
  } else {
    body = <LoadingState label="Loading PG settings" minHeight={256} />
  }

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title="Payment Gateway (PG) Settings"
        sub="Configure WeLivePay payment collection and IMPS bank payouts for this whitelabel."
        meta={s ? `Whitelabel: ${s.tenant}` : undefined}
      />
      {body}
    </Page>
  )
}

/** What is stored and live now, beside the form: the form shows the draft, this shows the saved state. */
function LiveSummary({ settings: s, available }: { settings: PgSettings; available: AvailableGateways | undefined }) {
  const { baseCurrency, timeZone } = useAppConfig()
  const money = (value: number) => {
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: baseCurrency || 'INR', maximumFractionDigits: 0 }).format(value)
    } catch {
      return value.toLocaleString('en-IN')
    }
  }
  const min = s.minDeposit ?? null
  const max = s.maxDeposit ?? null
  const range = min === null && max === null ? 'No limits set' : `${min === null ? 'Any' : money(min)} – ${max === null ? 'Any' : money(max)}`
  const redirects = [s.redirectSuccessUrl, s.redirectFailureUrl].filter(Boolean).length
  const onOff = (on: boolean) => (on ? <StatusPill tone="ok">On</StatusPill> : <StatusPill tone="muted">Off</StatusPill>)
  const rows: Array<{ term: string; value: ReactNode }> = [
    { term: 'Pay-in', value: onOff(s.enabled) },
    { term: 'Pay-in gateway', value: gatewayName(s.payinGateway, available?.payin) },
    { term: 'Payouts', value: onOff(s.payoutEnabled) },
    { term: 'Merchant key', value: s.hasSecretSiteKey ? <StatusPill tone="ok">Saved</StatusPill> : <StatusPill tone="warn">Not set</StatusPill> },
    { term: 'Deposits', value: range },
    { term: 'Redirects', value: `${redirects} of 2 set` },
    { term: 'Last saved', value: s.updatedAt ? <time dateTime={s.updatedAt}>{formatDateTime(s.updatedAt, timeZone)}</time> : 'Never' },
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

function PgSettingsForm({
  settings: s,
  refetch,
  scope,
}: {
  settings: PgSettings
  refetch: () => Promise<unknown>
  scope: PaymentWhitelabelScope
}) {
  // Set when a save completes, so the refetched settings replace the saved form.
  const savedRef = useRef(false)

  // The gateways WeLivePay lists for the saved key. Without a key the server refuses the question, so it is
  // not asked; a first key starts it once the refetched settings report the key.
  const gateways = useQuery(WELIVEPAY_AVAILABLE_GATEWAYS, {
    skip: !s.hasSecretSiteKey,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  })
  const available: AvailableGateways | undefined = s.hasSecretSiteKey
    ? gateways.data?.welivepayAvailableGateways
    : undefined
  const reloadGateways = () => {
    if (!scope.isCurrent()) return
    void gateways.refetch().catch(() => undefined)
  }

  const [upsert, { loading: saving }] = useMutation(UPSERT_PG_SETTINGS, {
    onCompleted: () => {
      savedRef.current = true
      toast({ message: 'PG settings saved', tone: 'ok' })
      void refetch().catch(() => undefined)
    },
    onError: (e) => toast({ message: mutationErrorMessage(e, 'Failed to save'), tone: 'error' }),
  })
  const [regen] = useMutation(REGENERATE_PG_WEBHOOK_TOKEN, {
    onCompleted: () => {
      toast({ message: 'Webhook token regenerated', tone: 'ok' })
      void refetch().catch(() => undefined)
    },
    onError: (e) => toast({ message: mutationErrorMessage(e, 'Failed to regenerate'), tone: 'error' }),
  })

  const form: FormApi<PgSettingsFormValues> = useForm<PgSettingsFormValues>({
    schema: pgSettingsSchema,
    // useForm reads its initial values on the first render only.
    initialValues: pgFormValues(s),
    onSubmit: async (values) => {
      // A save begun just before a whitelabel switch is dropped rather than sent to the new site.
      if (!scope.isCurrent()) return
      const input = buildPgSettingsInput(values)
      const result = await upsert({ variables: { input } })
      // The key is never kept in the form after a save attempt, as before.
      form.setValue('secretSiteKey', '')
      // A replaced key may belong to another WeLivePay project, so its gateways are read again. (A first key
      // starts the list by itself, once the refetched settings report it.)
      if (result.data && 'secretSiteKey' in input && s.hasSecretSiteKey) reloadGateways()
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
  const payinGateway = form.field('payinGateway')
  const payoutGateway = form.field('payoutGateway')
  const minPayout = form.field('minPayout')
  const maxPayout = form.field('maxPayout')
  const secretSiteKey = form.field('secretSiteKey')
  const minDeposit = form.field('minDeposit')
  const maxDeposit = form.field('maxDeposit')
  const redirectSuccessUrl = form.field('redirectSuccessUrl')
  const redirectFailureUrl = form.field('redirectFailureUrl')
  const busy = saving || form.submitting
  const payinWarning = payinGatewayWarning(available, values.payinGateway)
  const payoutWarning = payoutGatewayWarning(available, values.payoutGateway, values.payoutEnabled)
  const listStatus = gatewayListStatus({ hasKey: s.hasSecretSiteKey, available, error: gateways.error })

  // Regenerating breaks both URLs WeLivePay holds, so it is confirmed first (it was one click before).
  const requestRegenerate = () => {
    void confirm({
      title: 'Regenerate the webhook URLs?',
      description: 'The pay-in and payout URLs both stop working at once. Paste the new URLs into WeLivePay straight away, or payment and payout updates will not reach this whitelabel.',
      confirmLabel: 'Regenerate',
      tone: 'danger',
      onConfirm: async () => {
        if (!scope.isCurrent()) return
        await regen()
      },
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
          <Card title="Gateway" sub="WeLivePay pay-in · UPI deposits">
            <div className={styles.cardBody}>
              <ToggleRow
                label="Enable WeLivePay pay-in"
                help="Offer this gateway to players for deposits on this whitelabel."
                checked={values.enabled}
                onChange={(checked) => setValue('enabled', checked)}
              />
              <TextField {...displayName} label="Display Name" placeholder="UPI (Instant)" required />
              <Select
                {...payinGateway}
                label="Pay-in Gateway"
                layout="stacked"
                options={payinGatewayOptions(available, s.payinGateway)}
                help={payinWarning ? <WarningText>{payinWarning}</WarningText> : PAYIN_GATEWAY_HELP}
              />
              <GatewayListLine
                status={listStatus}
                canReload={s.hasSecretSiteKey}
                reloading={gateways.loading}
                onReload={reloadGateways}
              />
            </div>
          </Card>

          <Card
            title="Credentials"
            sub="The merchant project API key from WeLivePay"
            tools={s.hasSecretSiteKey ? <StatusPill tone="ok">Key saved</StatusPill> : <StatusPill tone="warn">Not set</StatusPill>}
          >
            <div className={styles.cardBody}>
              <SecretKeyField binding={secretSiteKey} settings={s} />
              <p className={styles.cardNote}>
                Saving a new key reloads the gateways WeLivePay has assigned to its project.{' '}
                <a
                  className={styles.docLink}
                  href={WELIVEPAY_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Merchant API guide (opens in a new tab)"
                >
                  Merchant API guide
                  <IconExternalLink size={13} stroke={strokeFor(13)} aria-hidden="true" />
                </a>
              </p>
            </div>
          </Card>

          <Card title="Deposit limits" sub="For one deposit through this gateway">
            <div className={styles.pair}>
              <NumberField {...minDeposit} label="Min Deposit" min={MIN_DEPOSIT_FLOOR} step={10} grouping="en-IN" />
              <NumberField {...maxDeposit} label="Max Deposit" min={MIN_DEPOSIT_FLOOR} step={100} grouping="en-IN" />
            </div>
          </Card>

          <Card title="Redirects" sub="Where players land after checkout">
            <div className={styles.cardBody}>
              <TextField
                {...redirectSuccessUrl}
                type="url"
                label="Checkout Return URL"
                placeholder="https://your-site.com/deposit"
                help="WeLivePay returns the player here after checkout, e.g. to your deposit page. Returning from checkout does not confirm a payment: the backend verifies its status."
              />
              <TextField
                {...redirectFailureUrl}
                type="url"
                label="Failure Redirect URL"
                placeholder="https://your-site.com/payment-failed"
                help="Not sent to WeLivePay: its checkout returns every payment to the return URL above."
              />
            </div>
          </Card>

          <Card title="IMPS Payouts" sub="WeLivePay · bank withdrawals">
            <div className={styles.cardBody}>
              <ToggleRow
                label="Enable WeLivePay payouts"
                help="Adds Pay via WeLivePay to approved bank withdrawals in Withdrawal Requests."
                checked={values.payoutEnabled}
                onChange={(checked) => setValue('payoutEnabled', checked)}
              />
              <Select
                {...payoutGateway}
                label="Payout Gateway"
                layout="stacked"
                options={payoutGatewayOptions(available, s.payoutGateway)}
                help={payoutWarning ? <WarningText>{payoutWarning}</WarningText> : PAYOUT_GATEWAY_HELP}
              />
              <div className={styles.pair}>
                <NumberField {...minPayout} label="Min Payout (INR)" min={MIN_PAYOUT_FLOOR} precision={2} step={100} grouping="en-IN" />
                <NumberField {...maxPayout} label="Max Payout (INR)" min={MIN_PAYOUT_FLOOR} precision={2} step={100} grouping="en-IN" />
              </div>
              <p className={styles.cardNote}>
                The player receives the full withdrawal amount. WeLivePay charges the payout fee to the merchant
                project's collection balance.
              </p>
            </div>
          </Card>
        </div>

        <aside className={styles.side} aria-label="Webhooks and live configuration">
          <Card title="Webhook URLs">
            <div className={styles.cardBody}>
              <p className={styles.webhookText}>
                Save both in your WeLivePay project's Developer settings: the pay-in URL as the Payin webhook URL
                (siteUrl), the payout URL as the Payout webhook URL. Payment and payout updates reach this whitelabel
                only through them.
              </p>
              <WebhookUrlField label="Pay-in webhook URL" copyLabel="Copy pay-in webhook URL" value={s.webhookUrl} />
              <WebhookUrlField label="Payout webhook URL" copyLabel="Copy payout webhook URL" value={s.payoutWebhookUrl} />
              <div className={styles.regenerate}>
                <Button
                  size="sm"
                  icon={<IconRefresh size={14} stroke={strokeFor(14)} />}
                  aria-label="Regenerate webhook URLs"
                  onClick={requestRegenerate}
                >
                  Regenerate
                </Button>
                <span className={styles.regenerateNote}>Makes new URLs; both old ones stop working.</span>
              </div>
            </div>
          </Card>
          <LiveSummary settings={s} available={available} />
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
