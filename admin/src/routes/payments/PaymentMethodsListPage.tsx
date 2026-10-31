import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { Link, useNavigate } from 'react-router-dom'
import {
  IconAlertCircle,
  IconBuildingBank,
  IconChartLine,
  IconCheck,
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
import { Grid } from '@/ui/components/LayoutPrimitives'
import { LoadingState } from '@/ui/components/LoadingState'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { Spinner } from '@/ui/components/Spinner'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { Tooltip } from '@/ui/components/Tooltip'
import {
  DELETE_CONFIRM_DESCRIPTION,
  PAGE_SIZE_OPTIONS,
  accountCountLabel,
  addMethodLabel,
  addMethodPath,
  bankDetailLines,
  buildDeleteBankInput,
  buildDeleteUpiInput,
  buildToggleBankInput,
  buildToggleUpiInput,
  deleteConfirmTitle,
  editMethodPath,
  hasQrCode,
  maxLimitLabel,
  methodName,
  minLimitLabel,
  pageSlice,
  paymentMethodStats,
  priorityStarCount,
  qrUrlExcerpt,
  statusSwitchLabel,
  tabEmptyTitle,
  tabItemName,
  tabTitle,
  upiTitle,
  type BankDetail,
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
        <div className={styles.qrRow}>
          {hasQrCode(upi) ? (
            <button
              type="button"
              className={styles.qrButton}
              aria-haspopup="dialog"
              aria-label={`QR Code Uploaded, view the QR code for ${methodName(title, 'upi')}`}
              onClick={() => onViewQr(upi)}
            >
              <IconCheck size={11} stroke={strokeFor(11)} aria-hidden="true" />
              QR Code Uploaded
            </button>
          ) : (
            <StatusPill tone="neutral">No QR Code</StatusPill>
          )}
        </div>
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
  onEdit,
  onDelete,
}: {
  name: string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <span className={styles.rowActions}>
      <Tooltip content="Edit Account">
        <IconButton
          size="sm"
          label={`Edit ${name}`}
          icon={<IconPencil size={15} stroke={strokeFor(15)} />}
          onClick={onEdit}
        />
      </Tooltip>
      <Tooltip content="Delete Account">
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

function PaymentMethodsStats({ banks, upis }: { banks: BankDetail[]; upis: UpiDetail[] }) {
  const stats = paymentMethodStats(banks, upis)
  return (
    <Grid cols={{ base: 1, md: 2, xl: 4 }} gap={12} role="group" aria-label="Payment method statistics">
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
        label="Total Methods"
        value={stats.total}
        note={`Banks: ${stats.banks.total} · UPI: ${stats.upis.total}`}
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
    </Grid>
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
  const [selectedUpi, setSelectedUpi] = useState<UpiDetail | null>(null)
  const [qrImageLoading, setQrImageLoading] = useState(true)
  const [qrImageError, setQrImageError] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const { formatAmount } = useCurrency()

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

  // The whole method set is written back on every change; the list refetches whether or not it worked.
  const saveMethods = async (input: PaymentMethodsUpsertInput) => {
    try {
      await upsertMethods({ variables: { input } })
      await refetch()
    } catch {
      await refetch()
    }
  }

  const handleToggle = async (type: PaymentMethodType, id: string, enabled: boolean) => {
    setTogglingId(id)
    const input = type === 'bank'
      ? buildToggleBankInput(methods, id, enabled)
      : buildToggleUpiInput(methods, id, enabled)
    try {
      await saveMethods(input)
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
      onConfirm: () =>
        saveMethods(type === 'bank' ? buildDeleteBankInput(methods, id) : buildDeleteUpiInput(methods, id)),
    })
  }

  const openQrCode = (upi: UpiDetail) => {
    setSelectedUpi(upi)
    setQrImageLoading(true)
    setQrImageError(false)
    setQrModalVisible(true)
  }

  const closeQrCode = () => {
    setQrModalVisible(false)
    setSelectedUpi(null)
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
    { key: 'details', header: 'UPI Details', cell: (upi) => <UpiDetailsCell upi={upi} onViewQr={openQrCode} /> },
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
  ]

  const tabTotal = activeTab === 'banks' ? banks.length : upis.length
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
        sub="Manage bank accounts and UPI IDs organized by amount tiers"
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
        <PaymentMethodsStats banks={banks} upis={upis} />

        <div
          className={styles.panel}
          role="tabpanel"
          id={tabPanelId(TABS_ID, activeTab)}
          aria-labelledby={tabId(TABS_ID, activeTab)}
        >
          <Card title={tabTitle(activeTab)} sub={accountCountLabel(tabTotal)} body="table">
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
            ) : (
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
            UPI QR Code
            {selectedUpi ? (
              <>
                {' '}
                <span className={styles.qrTitleName}>({upiTitle(selectedUpi)})</span>
              </>
            ) : null}
          </>
        )}
        footer={<Button onClick={closeQrCode}>Close</Button>}
      >
        {selectedUpi && hasQrCode(selectedUpi) ? (
          <div className={styles.qrBody}>
            {selectedUpi.qrUrl ? (
              <>
                {qrImageLoading && !qrImageError ? (
                  <LoadingState label="Loading QR code..." minHeight={192} />
                ) : null}
                {qrImageError ? (
                  <div className={styles.qrProblem} role="alert">
                    <span className={clsx(styles.qrProblemIcon, styles.qrProblemError)} aria-hidden="true">
                      <IconAlertCircle size={32} stroke={strokeFor(32)} />
                    </span>
                    <p className={styles.qrProblemTitle}>Failed to load QR code image</p>
                    <p className={styles.qrProblemText}>The image URL may have expired. Please refresh the page.</p>
                    <p className={styles.qrProblemCode}>
                      <code>URL: {qrUrlExcerpt(selectedUpi.qrUrl)}</code>
                    </p>
                  </div>
                ) : null}
                <img
                  src={selectedUpi.qrUrl}
                  alt="UPI QR Code"
                  className={clsx(styles.qrImage, (qrImageLoading || qrImageError) && styles.qrHidden)}
                  onLoad={() => {
                    setQrImageLoading(false)
                    setQrImageError(false)
                  }}
                  onError={() => {
                    setQrImageLoading(false)
                    setQrImageError(true)
                  }}
                />
                {!qrImageLoading && !qrImageError ? (
                  <>
                    <p className={styles.qrCaption}>Scan this QR code to make a payment</p>
                    <p className={styles.qrStore}>Stored in Amazon S3</p>
                  </>
                ) : null}
              </>
            ) : selectedUpi.qrKey ? (
              <div className={styles.qrProblem}>
                <span className={styles.qrProblemIcon} aria-hidden="true">
                  <IconQrcode size={32} stroke={strokeFor(32)} />
                </span>
                <p className={styles.qrProblemTitle}>QR Code Available</p>
                <p className={styles.qrProblemText}>Presigned URL not available. Please refresh the page.</p>
                <p className={styles.qrProblemCode}>
                  <code>Key: {selectedUpi.qrKey}</code>
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.qrEmpty}>No QR code available</p>
        )}
      </Dialog>
    </Page>
  )
}
