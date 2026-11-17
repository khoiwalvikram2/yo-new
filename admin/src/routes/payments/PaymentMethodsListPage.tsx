import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { Link, useNavigate } from 'react-router-dom'
import {
  IconBuildingBank,
  IconChartLine,
  IconCheck,
  IconCurrencyTether,
  IconInbox,
  IconPencil,
  IconPlus,
  IconQrcode,
  IconStarFilled,
  IconTrash,
  IconWallet,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { WHITELABEL_PAYMENT_METHODS, UPSERT_WHITELABEL_PAYMENT_METHODS } from '@/lib/graphql/deposits'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Card } from '@/ui/components/Card'
import { confirm } from '@/ui/components/confirm'
import { CopyButton } from '@/ui/components/CopyButton'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Dialog } from '@/ui/components/Dialog'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { Spinner } from '@/ui/components/Spinner'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { StoredImage } from '@/ui/components/StoredImage'
import { Switch } from '@/ui/components/Switch'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { toast } from '@/ui/components/toast'
import { Tooltip } from '@/ui/components/Tooltip'
import { CRYPTO_COIN, cryptoNetworkLabel, cryptoWalletTitle } from './cryptoWalletModel'
import {
  CRYPTO_NO_RATE_NOTICE,
  DELETE_CONFIRM_DESCRIPTION,
  PAGE_SIZE_OPTIONS,
  addMethodLabel,
  addMethodPath,
  bankDetailLines,
  buildCryptoBonusInput,
  buildCryptoRateInput,
  buildDeleteBankInput,
  buildDeleteCryptoInput,
  buildDeleteUpiInput,
  buildToggleBankInput,
  buildToggleCryptoInput,
  buildToggleUpiInput,
  canSaveCryptoBonus,
  canSaveCryptoRate,
  cryptoBonusDraftError,
  cryptoBonusExample,
  cryptoBonusPreview,
  cryptoRateDraftError,
  cryptoRateExample,
  cryptoRatePreview,
  deleteConfirmTitle,
  editMethodPath,
  hasQrCode,
  maxLimitLabel,
  methodName,
  minLimitLabel,
  pageSlice,
  paymentMethodStats,
  priorityStarCount,
  statusSwitchLabel,
  tabCountLabel,
  tabEmptyTitle,
  tabItemName,
  tabTitle,
  upiTitle,
  type BankDetail,
  type CryptoDetail,
  type CryptoUpsertInput,
  type FormatDepositAmount,
  type PaymentMethodType,
  type PaymentMethodsTab,
  type PaymentMethodsUpsertInput,
  type UpiDetail,
  type WhitelabelPaymentMethodsData,
} from './paymentMethodsListModel'
import styles from './PaymentMethodsListPage.module.css'

const METHODS_ACCESS_REQUIREMENT = [{ domain: 'payments.methods', actions: ['view'] }]
const TABS_ID = 'payment-methods'
const STAR_NUMBERS = [1, 2, 3, 4, 5] as const

type FormatAmount = (amount: number) => string

/** The QR code the preview dialog shows: a UPI account's or a crypto wallet's. */
interface QrView {
  /** The dialog title and the image's alt text, e.g. "UPI QR Code". */
  title: string
  /** The method's shown name, after the title. */
  name: string
  qrUrl?: string | null
  qrKey?: string | null
}

/** A detail value with its copy action. An empty value shows a dash and offers nothing to copy. */
function DetailValue({ label, value, mono }: { label: string; value: string; mono: boolean }) {
  if (!value) return <dd className={styles.detailValue}>—</dd>
  return (
    <dd className={styles.detailValue}>
      {mono ? (
        <code className={styles.detailText} title={value}>{value}</code>
      ) : (
        <span className={styles.detailText} title={value}>{value}</span>
      )}
      <CopyButton
        size="sm"
        value={value}
        label={`Copy ${label}`}
        copiedLabel={`${label} copied`}
        errorLabel="Failed to copy"
      />
    </dd>
  )
}

function VerifiedPill() {
  return (
    <StatusPill status="verified" icon={<IconCheck size={11} stroke={strokeFor(11)} />}>
      Verified
    </StatusPill>
  )
}

function BankDetailsCell({ bank }: { bank: BankDetail }) {
  return (
    <div className={styles.methodCell}>
      <span className={clsx(styles.methodIcon, styles.bankIcon)} aria-hidden="true">
        <IconBuildingBank size={18} stroke={strokeFor(18)} />
      </span>
      <div className={styles.methodBody}>
        <div className={styles.methodTitleRow}>
          <span className={styles.methodTitle} title={bank.accountName}>{bank.accountName}</span>
          {bank.enabled ? <VerifiedPill /> : null}
        </div>
        <dl className={styles.detailList}>
          {bankDetailLines(bank).map((line) => (
            <div key={line.key} className={styles.detailRow}>
              <dt className={styles.detailTerm}>{line.label}</dt>
              <DetailValue label={line.label} value={line.value} mono={line.mono} />
            </div>
          ))}
        </dl>
        {bank.notes ? <p className={styles.notes} title={bank.notes}>{bank.notes}</p> : null}
      </div>
    </div>
  )
}

/** A UPI account's or wallet's QR state: a button that opens the preview, or "No QR Code". */
function QrStatus({ uploaded, name, onView }: { uploaded: boolean; name: string; onView: () => void }) {
  return (
    <div className={styles.qrRow}>
      {uploaded ? (
        <button
          type="button"
          className={styles.qrButton}
          aria-haspopup="dialog"
          aria-label={`QR Code Uploaded, view the QR code for ${name}`}
          onClick={onView}
        >
          <IconCheck size={11} stroke={strokeFor(11)} aria-hidden="true" />
          QR Code Uploaded
        </button>
      ) : (
        <StatusPill tone="neutral">No QR Code</StatusPill>
      )}
    </div>
  )
}

function UpiDetailsCell({ upi, onViewQr }: { upi: UpiDetail; onViewQr: (upi: UpiDetail) => void }) {
  const title = upiTitle(upi)
  return (
    <div className={styles.methodCell}>
      <span className={clsx(styles.methodIcon, styles.upiIcon)} aria-hidden="true">
        <IconQrcode size={18} stroke={strokeFor(18)} />
      </span>
      <div className={styles.methodBody}>
        <div className={styles.methodTitleRow}>
          <span className={styles.methodTitle} title={title}>{title}</span>
          {upi.enabled ? <VerifiedPill /> : null}
        </div>
        <dl className={styles.detailList}>
          <div className={styles.detailRow}>
            <dt className={styles.detailTerm}>UPI ID</dt>
            <DetailValue label="UPI ID" value={upi.upiId || ''} mono />
          </div>
          {upi.displayName ? (
            <div className={styles.detailRow}>
              <dt className={styles.detailTerm}>Name</dt>
              <dd className={styles.detailValue}>
                <span className={styles.detailText} title={upi.displayName}>{upi.displayName}</span>
              </dd>
            </div>
          ) : null}
        </dl>
        <QrStatus uploaded={hasQrCode(upi)} name={methodName(title, 'upi')} onView={() => onViewQr(upi)} />
      </div>
    </div>
  )
}

/** A USDT wallet: its name, the network players must send on, and the address with its copy action. */
function CryptoDetailsCell({ crypto, onViewQr }: { crypto: CryptoDetail; onViewQr: (crypto: CryptoDetail) => void }) {
  const title = cryptoWalletTitle(crypto)
  const network = `${CRYPTO_COIN} · ${cryptoNetworkLabel(crypto.network)}`
  return (
    <div className={styles.methodCell}>
      <span className={clsx(styles.methodIcon, styles.cryptoIcon)} aria-hidden="true">
        <IconCurrencyTether size={18} stroke={strokeFor(18)} />
      </span>
      <div className={styles.methodBody}>
        <div className={styles.methodTitleRow}>
          <span className={styles.methodTitle} title={title}>{title}</span>
          {crypto.enabled ? <VerifiedPill /> : null}
        </div>
        <dl className={styles.detailList}>
          <div className={styles.detailRow}>
            <dt className={styles.detailTerm}>Network</dt>
            <dd className={styles.detailValue}>
              <span className={styles.detailText} title={network}>{network}</span>
            </dd>
          </div>
          <div className={styles.detailRow}>
            <dt className={styles.detailTerm}>Address</dt>
            <DetailValue label="Address" value={crypto.walletAddress || ''} mono />
          </div>
        </dl>
        <QrStatus uploaded={hasQrCode(crypto)} name={methodName(title, 'crypto')} onView={() => onViewQr(crypto)} />
      </div>
    </div>
  )
}

function LimitRange({
  min,
  max,
  formatAmount,
}: {
  min: number | null | undefined
  max: number | null | undefined
  formatAmount: FormatAmount
}) {
  return (
    <dl className={styles.limits}>
      <dt className={styles.limitTerm}>Min</dt>
      <dd className={styles.limitValue}>{minLimitLabel(min, formatAmount)}</dd>
      <dt className={styles.limitTerm}>Max</dt>
      <dd className={styles.limitValue}>{maxLimitLabel(max, formatAmount)}</dd>
    </dl>
  )
}

function Priority({ weight }: { weight: number }) {
  const filled = priorityStarCount(weight)
  return (
    <div className={styles.priority}>
      <span className={styles.stars} aria-hidden="true">
        {STAR_NUMBERS.map((star) => (
          <IconStarFilled key={star} size={12} className={star <= filled ? styles.starOn : undefined} />
        ))}
      </span>
      <span className={styles.weight}>Weight: {weight}</span>
    </div>
  )
}

function StatusCell({
  name,
  type,
  enabled,
  busy,
  onToggle,
}: {
  name: string
  type: PaymentMethodType
  enabled: boolean | undefined
  busy: boolean
  onToggle: (enabled: boolean) => void
}) {
  return (
    <div className={styles.statusCell}>
      <Switch
        size="sm"
        checked={Boolean(enabled)}
        onChange={onToggle}
        label={statusSwitchLabel(name, type)}
        hideLabel
        aria-disabled={busy ? true : undefined}
        aria-busy={busy ? true : undefined}
      />
      <span className={clsx(styles.statusText, enabled && styles.statusActive)}>
        {enabled ? 'Active' : 'Inactive'}
      </span>
      {busy ? <Spinner size="sm" decorative /> : null}
    </div>
  )
}

function RowActions({
  name,
  noun = 'Account',
  onEdit,
  onDelete,
}: {
  name: string
  /** The tooltips' noun: "Account" for banks and UPIs, "Wallet" for crypto. */
  noun?: string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <span className={styles.rowActions}>
      <Tooltip content={`Edit ${noun}`}>
        <IconButton
          size="sm"
          label={`Edit ${name}`}
          icon={<IconPencil size={15} stroke={strokeFor(15)} />}
          onClick={onEdit}
        />
      </Tooltip>
      <Tooltip content={`Delete ${noun}`}>
        <IconButton
          size="sm"
          label={`Delete ${name}`}
          icon={<IconTrash size={15} stroke={strokeFor(15)} />}
          onClick={onDelete}
        />
      </Tooltip>
    </span>
  )
}

function PaymentMethodsStats({
  banks,
  upis,
  cryptos,
}: {
  banks: BankDetail[]
  upis: UpiDetail[]
  cryptos: CryptoDetail[]
}) {
  const stats = paymentMethodStats(banks, upis, cryptos)
  return (
    <div className={styles.statsFrame}>
      <div className={styles.stats} role="group" aria-label="Payment method statistics">
        <Stat
          label="Bank Accounts"
          value={stats.banks.total}
          note={`Active: ${stats.banks.active} · Inactive: ${stats.banks.inactive}`}
          icon={<IconBuildingBank size={18} stroke={strokeFor(18)} />}
          hue="blu"
        />
        <Stat
          label="UPI Accounts"
          value={stats.upis.total}
          note={`Active: ${stats.upis.active} · Inactive: ${stats.upis.inactive}`}
          icon={<IconQrcode size={18} stroke={strokeFor(18)} />}
          hue="vio"
        />
        <Stat
          label="Crypto Wallets"
          value={stats.cryptos.total}
          note={`Active: ${stats.cryptos.active} · Inactive: ${stats.cryptos.inactive}`}
          icon={<IconCurrencyTether size={18} stroke={strokeFor(18)} />}
          hue="amb"
        />
        <Stat
          label="Total Methods"
          value={stats.total}
          note={`Banks: ${stats.banks.total} · UPI: ${stats.upis.total} · Crypto: ${stats.cryptos.total}`}
          icon={<IconWallet size={18} stroke={strokeFor(18)} />}
          hue="grn"
        />
        <Stat
          label="Active Rate"
          value={`${stats.activeRate}%`}
          note={`Active: ${stats.active} · Total: ${stats.total}`}
          icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
          hue="ind"
        />
      </div>
    </div>
  )
}

/**
 * One crypto setting: its field and Save on one row, the worked example under them. The example and any
 * error sit outside the field so the button lines up with the input; both are tied to it for assistive tech.
 */
function CryptoSettingRow({
  label,
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
  example,
  error,
  saveLabel,
  canSave,
  saving,
  disabled,
  onSave,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  prefix?: ReactNode
  suffix?: ReactNode
  placeholder: string
  example: string
  error: string | null
  saveLabel: string
  canSave: boolean
  saving: boolean
  disabled: boolean
  onSave: () => void
}) {
  const exampleId = useId()
  const errorId = useId()
  return (
    <form
      className={styles.setting}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave && !saving) onSave()
      }}
    >
      <div className={styles.settingControls}>
        <NumberField
          className={styles.settingField}
          label={label}
          value={value}
          onChange={onChange}
          prefix={prefix}
          suffix={suffix}
          placeholder={placeholder}
          precision={2}
          status={error ? 'error' : 'default'}
          aria-describedby={error ? `${errorId} ${exampleId}` : exampleId}
          disabled={disabled || saving}
        />
        <Button type="submit" variant="primary" loading={saving} disabled={!canSave && !saving}>
          {saveLabel}
        </Button>
      </div>
      {error ? (
        <p id={errorId} className={styles.settingError} role="alert">{error}</p>
      ) : null}
      <p id={exampleId} className={styles.settingExample}>{example}</p>
    </form>
  )
}

/**
 * The whitelabel's one USDT rate and one deposit bonus. Each saves on its own and sends nothing else; the
 * examples follow what is typed, so a rate entered the wrong way round is visible before it is saved.
 */
function CryptoSettingsCard({
  rate,
  bonusPercent,
  loading,
  currencySymbol,
  formatAmount,
  onSave,
}: {
  rate: number | null
  bonusPercent: number | null
  loading: boolean
  currencySymbol: string
  formatAmount: FormatDepositAmount
  onSave: (input: CryptoUpsertInput) => Promise<void>
}) {
  const [rateDraft, setRateDraft] = useState<number | null>(rate)
  const [bonusDraft, setBonusDraft] = useState<number | null>(bonusPercent)
  const [saving, setSaving] = useState<'rate' | 'bonus' | null>(null)

  // A saved (or refetched) value replaces the draft; a failed save leaves the typed value to retry.
  useEffect(() => {
    setRateDraft(rate)
  }, [rate])
  useEffect(() => {
    setBonusDraft(bonusPercent)
  }, [bonusPercent])

  const save = async (setting: 'rate' | 'bonus', input: CryptoUpsertInput) => {
    setSaving(setting)
    try {
      await onSave(input)
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card title="Crypto settings" sub={`One ${CRYPTO_COIN} rate and deposit bonus for every crypto wallet`}>
      <div className={styles.cryptoSettings}>
        {!loading && rate === null ? <Notice tone="warn">{CRYPTO_NO_RATE_NOTICE}</Notice> : null}
        <div className={styles.settingsGrid}>
          <CryptoSettingRow
            label={`${CRYPTO_COIN} rate`}
            value={rateDraft}
            onChange={setRateDraft}
            prefix={`1 ${CRYPTO_COIN} = ${currencySymbol}`}
            placeholder="Set rate"
            example={cryptoRateExample(cryptoRatePreview(rateDraft, rate), formatAmount)}
            error={cryptoRateDraftError(rateDraft)}
            saveLabel="Save Rate"
            canSave={canSaveCryptoRate(rateDraft, rate) && saving === null}
            saving={saving === 'rate'}
            disabled={loading}
            onSave={() => void save('rate', buildCryptoRateInput(rateDraft as number))}
          />
          <CryptoSettingRow
            label="Deposit bonus"
            value={bonusDraft}
            onChange={setBonusDraft}
            suffix="%"
            placeholder="0"
            example={cryptoBonusExample(cryptoBonusPreview(bonusDraft, bonusPercent), formatAmount)}
            error={cryptoBonusDraftError(bonusDraft)}
            saveLabel="Save Bonus"
            canSave={canSaveCryptoBonus(bonusDraft, bonusPercent) && saving === null}
            saving={saving === 'bonus'}
            disabled={loading}
            onSave={() => void save('bonus', buildCryptoBonusInput(bonusDraft))}
          />
        </div>
      </div>
    </Card>
  )
}

export default function PaymentMethodsListPage() {
  return (
    <RBACGuard required={METHODS_ACCESS_REQUIREMENT}>
      <PaymentMethodsContent />
    </RBACGuard>
  )
}

function PaymentMethodsContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const [activeTab, setActiveTab] = useState<PaymentMethodsTab>('banks')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [qrModalVisible, setQrModalVisible] = useState(false)
  const [qrView, setQrView] = useState<QrView | null>(null)
  const [qrImageLoading, setQrImageLoading] = useState(true)
  const [qrImageError, setQrImageError] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const { formatAmount, getCurrencySymbol } = useCurrency()
  const formatDepositAmount: FormatDepositAmount = (amount, wholeUnits) =>
    formatAmount(amount, undefined, wholeUnits ? { fractionDigits: 0 } : undefined)

  // Reset pagination when tab changes
  useEffect(() => {
    setCurrentPage(1)
  }, [activeTab])

  const { data, loading, refetch } = useQuery(WHITELABEL_PAYMENT_METHODS, {
    errorPolicy: 'all',
  })

  const [upsertMethods] = useMutation(UPSERT_WHITELABEL_PAYMENT_METHODS, {
    // Apollo notification link handles success/error messages automatically
    // Don't refetch here - we'll handle it manually after mutation
  })

  const methods: WhitelabelPaymentMethodsData | undefined = data?.whitelabelPaymentMethods
  const banks: BankDetail[] = useMemo(() => methods?.banks ?? [], [methods?.banks])
  const upis: UpiDetail[] = useMemo(() => methods?.upis ?? [], [methods?.upis])
  const cryptos: CryptoDetail[] = useMemo(() => methods?.cryptos ?? [], [methods?.cryptos])
  const cryptoRate = methods?.cryptoRate ?? null
  const cryptoBonusPercent = methods?.cryptoBonusPercent ?? null

  // The whole method set is written back on every change; the list refetches whether or not it worked.
  const saveMethods = async (input: PaymentMethodsUpsertInput) => {
    try {
      await upsertMethods({ variables: { input } })
      await refetch()
    } catch {
      await refetch()
    }
  }

  // A crypto save sends only the wallets, the rate or the bonus; the server keeps everything else. Apollo's
  // links do not report a failed mutation, and the server's reason (an address on the wrong network, a rate
  // out of range) is what the admin needs, so it is shown here. The list refetches either way.
  const saveCryptoMethods = async (input: CryptoUpsertInput) => {
    try {
      await upsertMethods({ variables: { input } })
    } catch (error: unknown) {
      toast({
        message: error instanceof Error && error.message ? error.message : 'Failed to save crypto settings',
        tone: 'error',
      })
    }
    await refetch()
  }

  const handleToggle = async (type: PaymentMethodType, id: string, enabled: boolean) => {
    setTogglingId(id)
    try {
      if (type === 'crypto') {
        await saveCryptoMethods(buildToggleCryptoInput(methods, id, enabled))
      } else {
        await saveMethods(type === 'bank'
          ? buildToggleBankInput(methods, id, enabled)
          : buildToggleUpiInput(methods, id, enabled))
      }
    } finally {
      setTogglingId(null)
    }
  }

  // The legacy Popconfirm copy, now a modal confirmation (D5). The delete resolves either way, as before;
  // the outcome is reported by Apollo's notification link.
  const requestDelete = (type: PaymentMethodType, id: string) => {
    void confirm({
      title: deleteConfirmTitle(type),
      description: DELETE_CONFIRM_DESCRIPTION,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => {
        if (type === 'crypto') return saveCryptoMethods(buildDeleteCryptoInput(methods, id))
        return saveMethods(type === 'bank' ? buildDeleteBankInput(methods, id) : buildDeleteUpiInput(methods, id))
      },
    })
  }

  const openQrCode = (view: QrView) => {
    setQrView(view)
    setQrImageLoading(true)
    setQrImageError(false)
    setQrModalVisible(true)
  }

  const openUpiQrCode = (upi: UpiDetail) =>
    openQrCode({ title: 'UPI QR Code', name: upiTitle(upi), qrUrl: upi.qrUrl, qrKey: upi.qrKey })

  const openCryptoQrCode = (crypto: CryptoDetail) =>
    openQrCode({
      title: 'Wallet QR Code',
      name: cryptoWalletTitle(crypto),
      qrUrl: crypto.qrUrl,
      qrKey: crypto.qrKey,
    })

  const closeQrCode = () => {
    setQrModalVisible(false)
    setQrView(null)
    setQrImageLoading(true)
    setQrImageError(false)
  }

  const bankColumns: DataTableColumn<BankDetail>[] = [
    { key: 'details', header: 'Bank Details', cell: (bank) => <BankDetailsCell bank={bank} /> },
    {
      key: 'limits',
      header: 'Limit Range',
      cell: (bank) => <LimitRange min={bank.minAmount} max={bank.maxAmount} formatAmount={formatAmount} />,
    },
    { key: 'priority', header: 'Priority', cell: (bank) => <Priority weight={bank.weight} /> },
    {
      key: 'status',
      header: 'Status',
      cell: (bank) => (
        <StatusCell
          name={bank.accountName}
          type="bank"
          enabled={bank.enabled}
          busy={togglingId === bank.id}
          onToggle={(checked) => void handleToggle('bank', bank.id, checked)}
        />
      ),
    },
  ]

  const upiColumns: DataTableColumn<UpiDetail>[] = [
    { key: 'details', header: 'UPI Details', cell: (upi) => <UpiDetailsCell upi={upi} onViewQr={openUpiQrCode} /> },
    {
      key: 'limits',
      header: 'Limit Range',
      cell: (upi) => <LimitRange min={upi.minAmount} max={upi.maxAmount} formatAmount={formatAmount} />,
    },
    { key: 'priority', header: 'Priority', cell: (upi) => <Priority weight={upi.weight} /> },
    {
      key: 'status',
      header: 'Status',
      cell: (upi) => (
        <StatusCell
          name={upiTitle(upi)}
          type="upi"
          enabled={upi.enabled}
          busy={togglingId === upi.id}
          onToggle={(checked) => void handleToggle('upi', upi.id, checked)}
        />
      ),
    },
  ]

  const cryptoColumns: DataTableColumn<CryptoDetail>[] = [
    {
      key: 'details',
      header: 'Wallet Details',
      cell: (crypto) => <CryptoDetailsCell crypto={crypto} onViewQr={openCryptoQrCode} />,
    },
    {
      key: 'limits',
      header: 'Limit Range',
      cell: (crypto) => <LimitRange min={crypto.minAmount} max={crypto.maxAmount} formatAmount={formatAmount} />,
    },
    { key: 'priority', header: 'Priority', cell: (crypto) => <Priority weight={crypto.weight} /> },
    {
      key: 'status',
      header: 'Status',
      cell: (crypto) => (
        <StatusCell
          name={cryptoWalletTitle(crypto)}
          type="crypto"
          enabled={crypto.enabled}
          busy={togglingId === crypto.id}
          onToggle={(checked) => void handleToggle('crypto', crypto.id, checked)}
        />
      ),
    },
  ]

  const tabItems: TabItem<PaymentMethodsTab>[] = [
    {
      value: 'banks',
      label: `Bank Accounts (${banks.length})`,
      icon: <IconBuildingBank size={15} stroke={strokeFor(15)} />,
    },
    {
      value: 'upis',
      label: `UPI Accounts (${upis.length})`,
      icon: <IconQrcode size={15} stroke={strokeFor(15)} />,
    },
    {
      value: 'cryptos',
      label: `Crypto Wallets (${cryptos.length})`,
      icon: <IconCurrencyTether size={15} stroke={strokeFor(15)} />,
    },
  ]

  const tabTotal = activeTab === 'banks' ? banks.length : activeTab === 'upis' ? upis.length : cryptos.length
  const tableState = loading ? 'loading' : 'ready'
  const emptyState = (
    <EmptyState title={tabEmptyTitle(activeTab)} icon={<IconInbox size={20} stroke={strokeFor(20)} />} />
  )
  // The add action is a router link with the primary button's look.
  const addLinkClass = buttonClassName({ variant: 'primary', className: styles.addLink })

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Payment Methods"
        sub="Manage bank accounts, UPI IDs and crypto wallets organized by amount tiers"
        actions={(
          <>
            <Tabs
              value={activeTab}
              items={tabItems}
              onChange={setActiveTab}
              label="Payment method type"
              idPrefix={TABS_ID}
              className={styles.tabs}
            />
            <Link to={addMethodPath(activeTab)} className={addLinkClass}>
              <IconPlus size={16} stroke={strokeFor(16)} aria-hidden="true" />
              <span>{addMethodLabel(activeTab)}</span>
            </Link>
          </>
        )}
      />

      <div className={styles.content}>
        <PaymentMethodsStats banks={banks} upis={upis} cryptos={cryptos} />

        <div
          className={styles.panel}
          role="tabpanel"
          id={tabPanelId(TABS_ID, activeTab)}
          aria-labelledby={tabId(TABS_ID, activeTab)}
        >
          {activeTab === 'cryptos' ? (
            <CryptoSettingsCard
              rate={cryptoRate}
              bonusPercent={cryptoBonusPercent}
              loading={loading}
              currencySymbol={getCurrencySymbol()}
              formatAmount={formatDepositAmount}
              onSave={saveCryptoMethods}
            />
          ) : null}
          <Card title={tabTitle(activeTab)} sub={tabCountLabel(activeTab, tabTotal)} body="table">
            {activeTab === 'banks' ? (
              <DataTable
                key="banks"
                columns={bankColumns}
                rows={pageSlice(banks, currentPage, pageSize)}
                rowKey={(bank) => bank.id}
                label="Bank accounts"
                state={tableState}
                width="wide"
                empty={emptyState}
                rowActions={(bank) => ({
                  primary: (
                    <RowActions
                      name={methodName(bank.accountName, 'bank')}
                      onEdit={() => navigate(editMethodPath('bank', bank.id))}
                      onDelete={() => requestDelete('bank', bank.id)}
                    />
                  ),
                })}
              />
            ) : activeTab === 'upis' ? (
              <DataTable
                key="upis"
                columns={upiColumns}
                rows={pageSlice(upis, currentPage, pageSize)}
                rowKey={(upi) => upi.id}
                label="UPI accounts"
                state={tableState}
                width="wide"
                empty={emptyState}
                rowActions={(upi) => ({
                  primary: (
                    <RowActions
                      name={methodName(upiTitle(upi), 'upi')}
                      onEdit={() => navigate(editMethodPath('upi', upi.id))}
                      onDelete={() => requestDelete('upi', upi.id)}
                    />
                  ),
                })}
              />
            ) : (
              <DataTable
                key="cryptos"
                columns={cryptoColumns}
                rows={pageSlice(cryptos, currentPage, pageSize)}
                rowKey={(crypto) => crypto.id}
                label="Crypto wallets"
                state={tableState}
                width="wide"
                empty={emptyState}
                rowActions={(crypto) => ({
                  primary: (
                    <RowActions
                      name={methodName(cryptoWalletTitle(crypto), 'crypto')}
                      noun="Wallet"
                      onEdit={() => navigate(editMethodPath('crypto', crypto.id))}
                      onDelete={() => requestDelete('crypto', crypto.id)}
                    />
                  ),
                })}
              />
            )}
            {!loading && tabTotal > 0 ? (
              <Pagination
                current={currentPage}
                pageSize={pageSize}
                total={tabTotal}
                onChange={setCurrentPage}
                onPageSizeChange={setPageSize}
                itemName={tabItemName(activeTab)}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                variant="embedded"
              />
            ) : null}
          </Card>
        </div>
      </div>

      <Dialog
        open={qrModalVisible}
        onOpenChange={(open) => {
          if (!open) closeQrCode()
        }}
        size="sm"
        title={(
          <>
            {qrView?.title ?? 'QR Code'}
            {qrView ? (
              <>
                {' '}
                <span className={styles.qrTitleName}>({qrView.name})</span>
              </>
            ) : null}
          </>
        )}
        footer={<Button onClick={closeQrCode}>Close</Button>}
      >
        {qrView && hasQrCode(qrView) ? (
          <div className={styles.qrBody}>
            {qrView.qrUrl && !qrImageError ? (
              <>
                {qrImageLoading ? (
                  <LoadingState label="Loading QR code..." minHeight={192} />
                ) : null}
                <img
                  src={qrView.qrUrl}
                  alt={qrView.title}
                  className={clsx(styles.qrImage, qrImageLoading && styles.qrHidden)}
                  onLoad={() => {
                    setQrImageLoading(false)
                    setQrImageError(false)
                  }}
                  onError={() => {
                    setQrImageLoading(false)
                    setQrImageError(true)
                  }}
                />
                {!qrImageLoading ? (
                  <p className={styles.qrCaption}>Scan this QR code to make a payment</p>
                ) : null}
              </>
            ) : (
              /* A stored QR the server can no longer serve (a legacy file: qrKey without qrUrl) or one that will not
                 load: a placeholder naming it, never a broken image (SYS-18), and how to replace it. */
              <div className={styles.qrProblem} role={qrImageError ? 'alert' : undefined}>
                <StoredImage src={null} alt={qrView.title} className={styles.qrMissing} />
                <p className={styles.qrProblemTitle}>This QR code cannot be shown</p>
                <p className={styles.qrProblemText}>Upload it again on the payment method&apos;s edit page.</p>
              </div>
            )}
          </div>
        ) : (
          <p className={styles.qrEmpty}>No QR code available</p>
        )}
      </Dialog>
    </Page>
  )
}
