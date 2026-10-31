import { useId, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import {
  IconBell,
  IconBrandAws,
  IconBrandTwilio,
  IconCheck,
  IconDownload,
  IconInbox,
  IconInfoCircle,
  IconLock,
  IconMessage,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconRotate,
  IconShieldHalf,
  IconStarFilled,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { OTP_PROVIDERS, UPSERT_OTP_PROVIDER } from '@/lib/graphql/otp'
import { OTP_PROVIDER_OPTIONS } from '@/shared/constants/otp'
import { useTableExport } from '@/shared/hooks/useTableExport'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { CopyButton } from '@/ui/components/CopyButton'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form, FormField, FormSection } from '@/ui/components/Form'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { PasswordField } from '@/ui/components/PasswordField'
import { Select } from '@/ui/components/Select'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { Tooltip } from '@/ui/components/Tooltip'
import { useForm, type FormApi } from '@/ui/form/useForm'
import {
  PAGE_SIZE_OPTIONS,
  SAVE_FAILED,
  SAVE_SUCCEEDED,
  TOGGLE_FAILED,
  buildOtpProviderInput,
  configChips,
  createFormValues,
  credentialPlaceholder,
  detailRows,
  drawerHint,
  drawerSub,
  drawerTitle,
  editFormValues,
  exportTitle,
  filledStars,
  getMaskedValue,
  messageOr,
  metaFieldsFor,
  metaPlaceholder,
  otpExportColumns,
  otpProviderSchema,
  pageSlice,
  priorityLabel,
  providerCountLabel,
  providerLabel,
  secretFieldsFor,
  submitLabel,
  thrownMessage,
  toggleInput,
  toggleSucceededMessage,
  withProvider,
  type ConfigChip,
  type DrawerMode,
  type MetaFieldName,
  type OtpFormValues,
  type OtpProviderRow,
  type SecretFieldName,
} from './otpProvidersModel'
import styles from './OtpProvidersPage.module.css'

const OTP_ACCESS_REQUIREMENT = [{ domain: 'config.otp-providers', actions: ['view'] }]
const STAR_NUMBERS = [1, 2, 3, 4, 5] as const

type UpsertOtpProviderData = {
  upsertOtpProvider?: { success?: boolean | null; message?: string | null } | null
}

type FormatDateTime = (date: string | Date, formatStr?: string) => string

/* The legacy provider tiles were brand-coloured gradients; here each provider keeps its own hue from the
   decorative ramp (never a semantic colour), and an unknown provider keeps the neutral bell. */
const TILE_HUES: Record<string, string | undefined> = {
  TWILIO: styles.hueRed,
  AWS_SNS: styles.hueAmb,
  MSG91: styles.hueBlu,
  TWO_FACTOR: styles.hueVio,
}

const CHIP_HUES: Record<ConfigChip['key'], string | undefined> = {
  sender: styles.chipSender,
  template: styles.chipTemplate,
  region: styles.chipRegion,
}

function ProviderGlyph({ provider }: { provider: string }) {
  const size = 18
  const stroke = strokeFor(size)
  if (provider === 'TWILIO') return <IconBrandTwilio size={size} stroke={stroke} />
  if (provider === 'AWS_SNS') return <IconBrandAws size={size} stroke={stroke} />
  if (provider === 'MSG91') return <IconMessage size={size} stroke={stroke} />
  if (provider === 'TWO_FACTOR') return <IconShieldHalf size={size} stroke={stroke} />
  return <IconBell size={size} stroke={stroke} />
}

function ProviderDetails({ row, formatDateTime }: { row: OtpProviderRow; formatDateTime: FormatDateTime }) {
  const lines = detailRows(row)
  return (
    <div className={styles.providerCell}>
      <span className={clsx(styles.providerTile, TILE_HUES[row.provider] ?? styles.hueNeutral)} aria-hidden="true">
        <ProviderGlyph provider={row.provider} />
      </span>
      <div className={styles.providerBody}>
        <div className={styles.providerTitleRow}>
          <span className={styles.providerName}>{providerLabel(row.provider)}</span>
          {row.active ? (
            <StatusPill tone="ok" icon={<IconCheck size={11} stroke={strokeFor(11)} />}>
              Active
            </StatusPill>
          ) : null}
        </div>
        {lines.length ? (
          <dl className={styles.detailList}>
            {lines.map((line) => (
              <div key={line.label} className={styles.detailRow}>
                <dt className={styles.detailTerm}>{line.label}</dt>
                <dd className={styles.detailValue}>
                  <code className={styles.detailText} title={line.value}>
                    {line.value}
                  </code>
                  <CopyButton
                    size="sm"
                    value={line.value}
                    label={`Copy ${line.label}`}
                    copiedLabel={`${line.label} copied`}
                    errorLabel="Failed to copy"
                  />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {row.updatedAt ? (
          <p className={styles.updated}>Updated: {formatDateTime(row.updatedAt, 'MMM d, yyyy HH:mm')}</p>
        ) : null}
      </div>
    </div>
  )
}

function ConfigurationCell({ row }: { row: OtpProviderRow }) {
  const chips = configChips(row)
  if (!chips.length) return <span className={styles.noConfig}>No configuration</span>
  return (
    <ul className={styles.chips}>
      {chips.map((chip) => (
        <li key={chip.key} className={clsx(styles.chip, CHIP_HUES[chip.key])}>
          <span className={styles.chipLabel}>{chip.label}</span>
          {chip.key === 'region' ? (
            <span className={styles.chipValue}>{chip.value}</span>
          ) : (
            <code className={styles.chipValue}>{chip.value}</code>
          )}
        </li>
      ))}
    </ul>
  )
}

function Priority({ priority }: { priority: number }) {
  const filled = filledStars(priority)
  return (
    <div className={styles.priority}>
      <span className={styles.stars} aria-hidden="true">
        {STAR_NUMBERS.map((star) => (
          <IconStarFilled key={star} size={12} className={star <= filled ? styles.starOn : undefined} />
        ))}
      </span>
      <span className={styles.priorityText}>{priorityLabel(priority)}</span>
    </div>
  )
}

function RowActions({
  row,
  busy,
  onEdit,
  onToggle,
}: {
  row: OtpProviderRow
  busy: boolean
  onEdit: () => void
  onToggle: (nextActive: boolean) => void
}) {
  const name = providerLabel(row.provider)
  return (
    <span className={styles.rowActions}>
      <Tooltip content="Edit Provider">
        <IconButton
          size="sm"
          label={`Edit ${name}`}
          icon={<IconPencil size={15} stroke={strokeFor(15)} />}
          onClick={onEdit}
        />
      </Tooltip>
      <span className={styles.toggle}>
        <Tooltip content={row.active ? 'Deactivate' : 'Activate'}>
          <Switch
            size="sm"
            checked={row.active}
            label={`${name} active`}
            hideLabel
            aria-disabled={busy ? true : undefined}
            aria-busy={busy ? true : undefined}
            onChange={onToggle}
          />
        </Tooltip>
        {busy ? <Spinner size="sm" decorative /> : null}
      </span>
    </span>
  )
}

/** A stored credential: the legacy "Stored" tag and its lock line, then the variable name. */
function StoredCredentialHelp({ description }: { description?: string }) {
  return (
    <span className={styles.storedHelp}>
      <StatusPill tone="info" icon={<IconCheck size={11} stroke={strokeFor(11)} />}>
        Stored
      </StatusPill>
      <span className={styles.keepNote}>
        <IconLock size={12} stroke={strokeFor(12)} aria-hidden="true" />
        Leave blank to keep existing value
      </span>
      {description ? <span className={styles.envName}>{description}</span> : null}
    </span>
  )
}

export default function OtpProvidersPage() {
  // The guard wraps the data-owning content, so a denied caller starts no query and no mutation hook.
  return (
    <RBACGuard required={OTP_ACCESS_REQUIREMENT}>
      <OtpProvidersContent />
    </RBACGuard>
  )
}

interface DrawerState {
  mode: DrawerMode
  record: OtpProviderRow | null
  initialValues: OtpFormValues
  /** A fresh form for every opening. */
  key: number
}

function OtpProvidersContent() {
  const pageEyebrow = usePageEyebrow()
  const { formatDateTime } = useFormatDate()
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const openings = useRef(0)

  const { data, loading, refetch } = useQuery<{ otpProviders: OtpProviderRow[] }>(OTP_PROVIDERS, {
    fetchPolicy: 'network-only',
    errorPolicy: 'all',
  })

  const [saveProvider, { loading: saving }] = useMutation<UpsertOtpProviderData>(UPSERT_OTP_PROVIDER)

  const providers = useMemo(() => data?.otpProviders ?? [], [data?.otpProviders])
  const exportColumns = useMemo(() => otpExportColumns(), [])

  const { exporting, handleExport } = useTableExport({
    data: providers,
    columns: exportColumns,
    filename: 'OTP-Providers',
    sheetName: 'OTP Providers',
    title: exportTitle(providers.length),
  })

  const handleToggle = async (record: OtpProviderRow, nextActive: boolean) => {
    setTogglingId(record.id)
    try {
      const { data: response } = await saveProvider({ variables: toggleInput(record, nextActive) })
      const success = response?.upsertOtpProvider?.success
      if (success) {
        toast({
          message: toggleSucceededMessage(response?.upsertOtpProvider?.message, nextActive),
          tone: 'ok',
          duration: 2000,
        })
        void refetch()
      } else {
        toast({ message: messageOr(response?.upsertOtpProvider?.message, TOGGLE_FAILED), tone: 'error', duration: 4000 })
      }
    } catch (error) {
      toast({ message: thrownMessage(error, TOGGLE_FAILED), tone: 'error', duration: 5000 })
    } finally {
      setTogglingId(null)
    }
  }

  function openDrawer(mode: DrawerMode, record?: OtpProviderRow) {
    openings.current += 1
    setDrawer({
      mode,
      record: record ?? null,
      initialValues: mode === 'edit' && record ? editFormValues(record) : createFormValues(providers),
      key: openings.current,
    })
  }

  function closeDrawer() {
    setDrawer(null)
  }

  // Named change: any thrown error is reported. Legacy reported only a plain `Error`, which an Apollo failure
  // never is, so a rejected or failed save closed nothing and said nothing.
  const submitProvider = async (values: OtpFormValues) => {
    try {
      const { data: response } = await saveProvider({ variables: { input: buildOtpProviderInput(values) } })
      const success = response?.upsertOtpProvider?.success
      if (success) {
        toast({ message: messageOr(response?.upsertOtpProvider?.message, SAVE_SUCCEEDED), tone: 'ok', duration: 3000 })
        closeDrawer()
        void refetch()
      } else {
        toast({ message: messageOr(response?.upsertOtpProvider?.message, SAVE_FAILED), tone: 'error', duration: 5000 })
      }
    } catch (error) {
      toast({ message: thrownMessage(error, SAVE_FAILED), tone: 'error', duration: 5000 })
    }
  }

  const columns: DataTableColumn<OtpProviderRow>[] = [
    {
      key: 'details',
      header: 'Provider Details',
      cell: (row) => <ProviderDetails row={row} formatDateTime={formatDateTime} />,
    },
    { key: 'configuration', header: 'Configuration', cell: (row) => <ConfigurationCell row={row} /> },
    { key: 'priority', header: 'Priority', cell: (row) => <Priority priority={row.priority} /> },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <StatusPill tone={row.active ? 'ok' : 'neutral'}>{row.active ? 'Active' : 'Inactive'}</StatusPill>
      ),
    },
  ]

  const showList = !loading && providers.length > 0

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="OTP Providers"
        sub="Manage Twilio, AWS SNS, MSG91, and 2Factor credentials for sending OTPs."
        actions={
          <>
            <Button
              icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
              onClick={() => void refetch()}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={<IconPlus size={16} stroke={strokeFor(16)} />}
              onClick={() => openDrawer('create')}
            >
              Add Provider
            </Button>
          </>
        }
      />

      <Card
        title="OTP Providers List"
        sub={loading ? 'Loading...' : providerCountLabel(providers.length)}
        tools={
          showList ? (
            <Button
              size="sm"
              icon={<IconDownload size={15} stroke={strokeFor(15)} />}
              loading={exporting}
              disabled={!providers.length}
              onClick={() => void handleExport()}
            >
              Export Excel
            </Button>
          ) : null
        }
        body="table"
      >
        <DataTable
          columns={columns}
          rows={pageSlice(providers, currentPage, pageSize)}
          rowKey={(row) => String(row.id)}
          label="OTP providers"
          state={loading ? 'loading' : 'ready'}
          width="wide"
          empty={<EmptyState title="No OTP providers found" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />}
          rowActions={(row) => ({
            primary: (
              <RowActions
                row={row}
                busy={togglingId === row.id}
                onEdit={() => openDrawer('edit', row)}
                onToggle={(nextActive) => void handleToggle(row, nextActive)}
              />
            ),
          })}
        />
        {showList ? (
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={providers.length}
            onChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            itemName="providers"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            variant="embedded"
          />
        ) : null}
      </Card>

      {/* Mounted only while open, so each opening's form starts from the record it edits (or the defaults). */}
      {drawer ? (
        <OtpProviderDrawer
          key={drawer.key}
          mode={drawer.mode}
          record={drawer.record}
          initialValues={drawer.initialValues}
          saving={saving}
          onSubmit={submitProvider}
          onClose={closeDrawer}
        />
      ) : null}
    </Page>
  )
}
// ---------- the add / edit drawer ----------

interface OtpProviderDrawerProps {
  mode: DrawerMode
  record: OtpProviderRow | null
  initialValues: OtpFormValues
  saving: boolean
  onSubmit: (values: OtpFormValues) => Promise<void>
  onClose: () => void
}

/* The drawer has no mockup drawing; its frame is the kit Drawer (.drawer, .dr-* M:1136-1167) and its fields wear
   the .searchfield face (M:693-701). The page-local rules are marked BEYOND-MOCKUP in the module. */
function OtpProviderDrawer({ mode, record, initialValues, saving, onSubmit, onClose }: OtpProviderDrawerProps) {
  const formId = `otp-provider-${useId().replace(/:/g, '')}`
  const providerRef = useRef<HTMLSelectElement | null>(null)
  const priorityRef = useRef<HTMLInputElement | null>(null)
  const schema = useMemo(() => otpProviderSchema(mode), [mode])
  // useForm reads its initial values on the first render only; the drawer mounts with them.
  const form: FormApi<OtpFormValues> = useForm<OtpFormValues>({ schema, initialValues, onSubmit })
  const { values } = form
  const provider = mode === 'edit' && record ? record.provider : values.provider
  const metaFields = metaFieldsFor(values.provider)
  const credentialFields = secretFieldsFor(values.provider)
  const providerBinding = form.field('provider')
  // Create starts in the provider choice; edit (the provider is fixed) in Priority.
  const initialFocus: MutableRefObject<HTMLElement | null> = mode === 'create' ? providerRef : priorityRef

  // A text field the admin has not touched holds `undefined` (it is then left out of the payload, as before).
  const text = (name: MetaFieldName | SecretFieldName) => {
    const binding = form.field(name)
    return {
      id: binding.id,
      name: binding.name,
      value: binding.value ?? '',
      onChange: (next: string) => binding.onChange(next),
      onBlur: binding.onBlur,
      error: binding.error,
    }
  }

  return (
    <Drawer
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={
        <span className={styles.drawerTitle}>
          <span>{drawerTitle(mode, provider)}</span>
          {/* The legacy New / Edit tag; the title already says which, so it is not read twice. */}
          <StatusPill tone={mode === 'create' ? 'info' : 'ok'} aria-hidden="true">
            {mode === 'create' ? 'New' : 'Edit'}
          </StatusPill>
        </span>
      }
      sub={drawerSub(mode, provider)}
      initialFocus={initialFocus}
      footer={
        <div className={styles.drawerFoot}>
          <p className={styles.footHint}>
            <IconInfoCircle size={13} stroke={strokeFor(13)} aria-hidden="true" />
            <span>{drawerHint(mode)}</span>
          </p>
          <div className={styles.footActions}>
            <Button size="sm" icon={<IconRotate size={14} stroke={strokeFor(14)} />} onClick={() => form.reset()}>
              Reset
            </Button>
            <Button size="sm" onClick={onClose}>
              Cancel
            </Button>
            {/* In the drawer's footer, outside the form element, so it names its form. */}
            <Button
              size="sm"
              type="submit"
              form={formId}
              variant="primary"
              icon={<IconCheck size={14} stroke={strokeFor(14)} />}
              loading={saving || form.submitting}
            >
              {submitLabel(mode)}
            </Button>
          </div>
        </div>
      }
    >
      <Form
        id={formId}
        className={styles.drawerForm}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        <Select
          ref={providerRef}
          id={providerBinding.id}
          name="provider"
          layout="stacked"
          label="Provider Type"
          options={OTP_PROVIDER_OPTIONS}
          value={values.provider}
          onChange={(next) => form.setValues(withProvider(form.values, next))}
          disabled={mode === 'edit'}
          required
          help="Choose the OTP service provider"
          error={providerBinding.error}
        />

        <FormSection title="Basic Settings" description="Priority and activation status">
          <NumberField
            {...form.field('priority')}
            ref={priorityRef}
            label="Priority"
            min={0}
            step={1}
            help="Lower numbers have higher priority"
          />
          <FormField label="Status">
            <span className={styles.statusRow}>
              <Switch
                label="Active"
                hideLabel
                checked={values.active}
                onChange={(checked) => form.setValue('active', checked)}
              />
              <span className={styles.statusText}>{values.active ? 'Active' : 'Inactive'}</span>
            </span>
          </FormField>
        </FormSection>

        {metaFields.length > 0 ? (
          <FormSection
            title="Delivery Metadata"
            description={
              <>
                Details the provider uses to render or route OTP messages
                {/* The legacy info tooltip, now visible text. */}
                <span className={styles.sectionNote}>
                  <IconInfoCircle size={13} stroke={strokeFor(13)} aria-hidden="true" />
                  Sender IDs, templates, and regions vary per provider
                </span>
              </>
            }
          >
            {metaFields.map((field) => (
              <TextField
                key={field.name}
                {...text(field.name)}
                label={field.label}
                placeholder={metaPlaceholder(field)}
                help={field.description}
                required={mode === 'create'}
              />
            ))}
          </FormSection>
        ) : null}

        <FormSection
          title="Credential Secrets"
          description="Rotate keys periodically and store production values securely"
          cols={{ base: 1 }}
        >
          {credentialFields.map((field) => {
            const masked = getMaskedValue(record, field.name)
            const shared = {
              ...text(field.name),
              label: field.label,
              placeholder: credentialPlaceholder(field, masked),
              help: masked ? <StoredCredentialHelp description={field.description} /> : field.description,
              required: mode === 'create' && !masked,
            }
            // The legacy page masked every credential but the 2Factor Number, which stays a plain text field.
            return field.type === 'text' ? (
              <TextField key={field.name} {...shared} autoComplete="off" />
            ) : (
              <PasswordField key={field.name} {...shared} autoComplete="new-password" />
            )
          })}
        </FormSection>
      </Form>
    </Drawer>
  )
}


