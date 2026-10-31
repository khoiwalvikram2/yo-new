import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  IconArrowsExchange,
  IconBan,
  IconBuildingBank,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconCurrencyRupee,
  IconHourglassHigh,
  IconHistory,
  IconInbox,
  IconInfoCircle,
  IconNote,
  IconReceipt,
  IconRefresh,
  IconUser,
} from '@tabler/icons-react'
import { ADMIN_WITHDRAWAL_REQUESTS, SET_WITHDRAWAL_STATUS } from '@/lib/graphql/withdrawals'
import { ADMIN_WITHDRAWAL_HISTORY } from '@/lib/graphql/withdrawalHistory'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useSearch } from '@/shared/hooks/useSearch'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { confirm } from '@/ui/components/confirm'
import { CopyButton } from '@/ui/components/CopyButton'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { Dialog } from '@/ui/components/Dialog'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { StatusPill } from '@/ui/components/StatusPill'
import { Textarea } from '@/ui/components/Textarea'
import { toast } from '@/ui/components/toast'
import { strokeFor } from '@/ui/components/icons'
import { WithdrawalRequestsFiltersBar } from './components/WithdrawalRequestsFiltersBar'
import { WithdrawalRequestsStatsCards } from './components/WithdrawalRequestsStatsCards'
import { WithdrawalRequestsTable } from './components/WithdrawalRequestsTable'
import {
  buildSetWithdrawalStatusInput,
  buildWithdrawalRequestFilter,
  canUpdateWithdrawalStatus,
  getWithdrawalRangeForPreset,
  WITHDRAWAL_UPDATE_STATUSES,
  withdrawalAccountNumberLabel,
  withdrawalStatusLabel,
  type WithdrawalDateRange,
  type WithdrawalHistoryEntry,
  type WithdrawalRequest,
  type WithdrawalUpdateStatus,
} from './withdrawalRequestsModel'
import styles from './WithdrawalRequests.module.css'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const WITHDRAWAL_ACCESS_REQUIREMENT = [
  { domain: 'payments.withdrawals', actions: ['view', 'approve', 'reject'] },
]
const DATE_TIME_FORMAT = 'dd MMM yyyy, HH:mm:ss'
/** Each status the request can move to: its glyph, what it means for the payout, and its status tone. */
const STATUS_CHOICES: Readonly<Record<WithdrawalUpdateStatus, { icon: ReactNode; meaning: string; tone: 'info' | 'ok' | 'neg' | 'muted' }>> = {
  PROCESSING: { icon: <IconHourglassHigh size={18} stroke={strokeFor(18)} />, meaning: 'Payout in progress', tone: 'info' },
  COMPLETED: { icon: <IconCircleCheck size={18} stroke={strokeFor(18)} />, meaning: 'Paid to the account', tone: 'ok' },
  FAILED: { icon: <IconCircleX size={18} stroke={strokeFor(18)} />, meaning: 'Payout failed', tone: 'neg' },
  CANCELLED: { icon: <IconBan size={18} stroke={strokeFor(18)} />, meaning: 'Request called off', tone: 'muted' },
}

/** The new-status choice: four tiles in a 2 × 2 grid (kit choice cards), each a pressed-state button with
 *  its glyph, name and meaning; the chosen one takes its status tone and a check, the request's present
 *  status is marked Current. */
function StatusChoice({ value, current, onChange }: { value: string; current: string; onChange: (status: string) => void }) {
  return (
    <div className={styles.statusChoices} role="group" aria-label="New status">
      {WITHDRAWAL_UPDATE_STATUSES.map((status) => {
        const choice = STATUS_CHOICES[status]
        const label = withdrawalStatusLabel(status)
        // The visible name leads the accessible one; spelled out, so the parts never run together.
        const name = `${label} — ${choice.meaning.toLowerCase()}${current === status ? ' (current)' : ''}`
        return (
          <button key={status} type="button" aria-pressed={value === status} aria-label={name}
            className={clsx(styles.choice, styles[`tone-${choice.tone}`])} onClick={() => onChange(status)}>
            <span className={styles.choiceIcon} aria-hidden="true">{choice.icon}</span>
            <span className={styles.choiceText}>
              <b>{label}</b>
              <small>{choice.meaning}</small>
            </span>
            {current === status && <span className={styles.choiceCurrent}>Current</span>}
            <span className={styles.choiceCheck} aria-hidden="true"><IconCheck size={12} stroke={3} /></span>
          </button>
        )
      })}
    </div>
  )
}

type HistoryRow = WithdrawalHistoryEntry & { rowKey: string }

function DrawerSection({
  icon,
  title,
  sub,
  children,
}: {
  icon: ReactNode
  title: string
  sub?: string
  children: ReactNode
}) {
  const titleId = useId()
  const subId = useId()
  return (
    <section
      className={styles.drawerSection}
      aria-labelledby={titleId}
      aria-describedby={sub ? subId : undefined}
    >
      <header className={styles.sectionHeader}>
        <span className={styles.sectionIcon} aria-hidden="true">{icon}</span>
        <div className={styles.sectionHeading}>
          <h3 id={titleId} className={styles.sectionTitle}>{title}</h3>
          {sub ? <p id={subId} className={styles.sectionSub}>{sub}</p> : null}
        </div>
      </header>
      {children}
    </section>
  )
}

/** A drawer value with its copy action; feedback names the field, as the legacy notification did. */
function CopyableValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className={styles.copyValue}>
      {mono ? <code className={styles.code}>{value}</code> : <span>{value}</span>}
      <CopyButton
        size="sm"
        value={value}
        label={`Copy ${label}`}
        copiedLabel={`${label} copied`}
        errorLabel="Failed to copy"
      />
    </span>
  )
}

/** A copyable row is left out entirely when the value is missing or empty. */
function copyableItem(
  key: string,
  label: string,
  value: string | null | undefined,
  mono?: boolean,
): DescriptionListItem[] {
  if (value == null || value === '') return []
  return [{ key, term: label, value: <CopyableValue label={label} value={value} mono={mono} /> }]
}

export default function WithdrawalRequestsPage() {
  return (
    <RBACGuard required={WITHDRAWAL_ACCESS_REQUIREMENT}>
      <WithdrawalRequestsContent />
    </RBACGuard>
  )
}

function WithdrawalRequestsContent() {
  const [selectedRequest, setSelectedRequest] = useState<WithdrawalRequest | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [status, setStatus] = useState('PENDING')
  const { query, setQuery, debouncedQuery } = useSearch({ minLength: 2 })
  const [dateRange, setDateRange] = useState<WithdrawalDateRange>(
    () => getWithdrawalRangeForPreset('today') ?? {},
  )
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [note, setNote] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')
  const [historyModal, setHistoryModal] = useState<{ id: string } | null>(null)
  const drawerTriggerRef = useRef<HTMLElement | null>(null)
  const pageEyebrow = usePageEyebrow()
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()

  const handleDateRangeChange = (range: WithdrawalDateRange | null) => {
    if (range?.from && range.to) setDateRange({ from: range.from, to: range.to })
    else setDateRange({})
  }

  const queryVariables = useMemo(
    () => buildWithdrawalRequestFilter(status, debouncedQuery, dateRange),
    [dateRange, debouncedQuery, status],
  )

  const [statsRevision, setStatsRevision] = useState(0)
  const { data, loading, refetch: refetchList } = useQuery(ADMIN_WITHDRAWAL_REQUESTS, {
    variables: {
      input: {
        ...queryVariables,
        offset: (currentPage - 1) * pageSize,
        limit: pageSize,
      },
    },
    errorPolicy: 'all',
    pollInterval: 15000, // Poll every 15s (cache-friendly; manual refetch on mutations)
    fetchPolicy: 'cache-and-network',
  })
  const refetch = useCallback(() => {
    setStatsRevision(value => value + 1)
    return refetchList()
  }, [refetchList])


  const { data: historyData, loading: historyLoading } = useQuery(ADMIN_WITHDRAWAL_HISTORY, {
    variables: { id: historyModal?.id ?? '' },
    skip: !historyModal,
    fetchPolicy: 'network-only',
  })

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [dateRange.from, dateRange.to, debouncedQuery, status])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setSelectedRequest(null)
    setNote('')
    setSelectedStatus('')
  }, [])

  const [setStatusMutation, { loading: settingStatus }] = useMutation(SET_WITHDRAWAL_STATUS, {
    context: { skipNotification: true },
    onCompleted: (result) => {
      if (!result?.setWithdrawalStatus?.success) return
      toast({
        message: result.setWithdrawalStatus.message || 'Status updated successfully',
        tone: 'ok',
      })
      void refetch()
      closeDrawer()
    },
    onError: (error) => {
      toast({ message: error.message || 'Failed to update withdrawal status', tone: 'error' })
    },
  })

  const handleView = (request: WithdrawalRequest) => {
    if (typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement) {
      drawerTriggerRef.current = document.activeElement
    }
    setSelectedRequest(request)
    setDrawerOpen(true)
    setNote('')
    setSelectedStatus('')
  }

  const handleStatusUpdate = async () => {
    if (!selectedRequest || !selectedStatus) {
      toast({ message: 'Please select a status', tone: 'error' })
      return
    }
    const input = buildSetWithdrawalStatusInput(selectedRequest.id, selectedStatus, note)

    await confirm({
      title: 'Update Withdrawal Status',
      description: `Are you sure you want to update this request to ${withdrawalStatusLabel(selectedStatus)}?`,
      confirmLabel: 'Yes, Update',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        const result = await setStatusMutation({ variables: { input } })
        if (!result.data?.setWithdrawalStatus?.success) {
          throw new Error(
            result.data?.setWithdrawalStatus?.message || 'Failed to update withdrawal status',
          )
        }
      },
    })
  }

  const requests: WithdrawalRequest[] = data?.adminWithdrawalRequests?.items ?? []
  const total = data?.adminWithdrawalRequests?.total ?? 0
  const canUpdateStatus = canUpdateWithdrawalStatus(selectedRequest?.status)

  const historyRows = useMemo<HistoryRow[]>(
    () => ((historyData?.adminWithdrawalHistory ?? []) as WithdrawalHistoryEntry[]).map(
      (entry, index) => ({ ...entry, rowKey: String(index) }),
    ),
    [historyData],
  )

  const historyColumns = useMemo<DataTableColumn<HistoryRow>[]>(
    () => [
      {
        key: 'status',
        header: 'Status',
        cell: (entry) => (
          <StatusPill status={entry.status}>{withdrawalStatusLabel(entry.status)}</StatusPill>
        ),
      },
      {
        key: 'reviewerId',
        header: 'Reviewer',
        cell: (entry) => entry.reviewerId || '—',
        emphasis: 'id',
      },
      {
        key: 'reviewedAt',
        header: 'Reviewed At',
        cell: (entry) => (entry.reviewedAt ? formatDateTime(entry.reviewedAt, DATE_TIME_FORMAT) : '—'),
      },
      {
        key: 'note',
        header: 'Note',
        cell: (entry) => <span className={styles.wrapCell}>{entry.note || '—'}</span>,
      },
    ],
    [formatDateTime],
  )

  const account = selectedRequest?.account ?? null
  const accountItems: DescriptionListItem[] = account
    ? [
        {
          key: 'method',
          term: 'Method',
          value: (
            <StatusPill tone={account.method === 'BANK' ? 'neutral' : 'info'}>
              {account.method || '—'}
            </StatusPill>
          ),
        },
        ...copyableItem('holder', 'Account Holder Name', account.accountHolderName),
        ...copyableItem('number', withdrawalAccountNumberLabel(account.method), account.accountNumber, true),
        ...copyableItem('ifsc', 'IFSC', account.ifscCode, true),
        ...copyableItem('bank', 'Bank Name', account.bankName),
      ]
    : []

  const transactionItems: DescriptionListItem[] = selectedRequest
    ? [
        { key: 'request-id', term: 'Request ID', value: <code className={styles.code}>{selectedRequest.id}</code> },
        {
          key: 'created-at',
          term: 'Created At',
          value: (
            <time dateTime={selectedRequest.createdAt}>
              {formatDateTime(selectedRequest.createdAt, DATE_TIME_FORMAT)}
            </time>
          ),
        },
        ...(selectedRequest.reviewedAt
          ? [{
              key: 'reviewed-at',
              term: 'Reviewed At',
              value: (
                <time dateTime={selectedRequest.reviewedAt}>
                  {formatDateTime(selectedRequest.reviewedAt, DATE_TIME_FORMAT)}
                </time>
              ),
            }]
          : []),
        ...(selectedRequest.reviewerId
          ? [{
              key: 'reviewer-id',
              term: 'Reviewer ID',
              value: <code className={styles.code}>{selectedRequest.reviewerId}</code>,
            }]
          : []),
      ]
    : []

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Withdrawal Requests"
        sub="Review and approve/reject withdrawal requests from players"
        actions={(
          <Button
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            onClick={() => void refetch()}
          >
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        <WithdrawalRequestsStatsCards revision={statsRevision} />

        <WithdrawalRequestsFiltersBar
          status={status}
          query={query}
          dateRange={dateRange}
          onChangeStatus={setStatus}
          onChangeQuery={setQuery}
          onChangeDateRange={handleDateRangeChange}
          onClearAll={() => {
            setStatus('PENDING')
            setQuery('')
            setDateRange(getWithdrawalRangeForPreset('today') ?? {})
            setCurrentPage(1)
            void refetch()
          }}
        />

        <WithdrawalRequestsTable
          requests={requests}
          fetching={loading}
          total={total}
          exportFilter={queryVariables}
          onView={handleView}
          footer={(
            <Pagination loading={loading}
              current={currentPage}
              pageSize={pageSize}
              total={total}
              onChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              itemName="requests"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              variant="embedded"
            />
          )}
        />
      </div>

      <Drawer
        title={`Withdrawal Request${selectedRequest?.id ? ` - #${selectedRequest.id}` : ''}`}
        size="md"
        open={drawerOpen}
        onOpenChange={(open) => {
          if (!open) closeDrawer()
        }}
        themeFrom={drawerTriggerRef}
        restoreFocusTo={drawerTriggerRef}
        footer={selectedRequest ? (
          <div className={styles.drawerFooter}>
            <p className={styles.footerHint}>
              <IconInfoCircle size={15} stroke={strokeFor(15)} aria-hidden="true" />
              {canUpdateStatus
                ? (!selectedStatus ? 'Select status to update' : `Update to ${withdrawalStatusLabel(selectedStatus)}`)
                : `This request has been ${selectedRequest.status.toLowerCase()}`}
            </p>
            <div className={styles.footerActions}>
              {canUpdateStatus ? (
                <>
                  <Button size="sm" onClick={closeDrawer}>Cancel</Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<IconCheck size={15} stroke={strokeFor(15)} />}
                    disabled={!selectedStatus}
                    loading={settingStatus}
                    onClick={() => void handleStatusUpdate()}
                  >
                    Update Status
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={closeDrawer}>Close</Button>
              )}
            </div>
          </div>
        ) : undefined}
      >
        {selectedRequest ? (
          <div className={styles.drawerContent}>
            <section className={styles.userSummary} aria-label="Player">
              <span className={styles.heroIcon} aria-hidden="true">
                <IconUser size={20} stroke={strokeFor(20)} />
              </span>
              <div className={styles.summaryCopy}>
                <strong>{selectedRequest.user?.name || 'N/A'}</strong>
                <span>{selectedRequest.user?.email || selectedRequest.user?.phone || 'No contact info'}</span>
              </div>
              {selectedRequest.user?.id ? (
                <Link className={styles.profileLink} to={`/players/profile/${selectedRequest.user.id}`}>
                  View Profile
                </Link>
              ) : null}
            </section>

            <section className={styles.amountSummary} aria-label="Withdrawal summary">
              <span className={styles.heroIcon} aria-hidden="true">
                <IconCurrencyRupee size={20} stroke={strokeFor(20)} />
              </span>
              <div className={styles.summaryCopy}>
                <span>Withdrawal Amount</span>
                <strong className={styles.amount}>
                  {formatAmount(selectedRequest.amount, selectedRequest.currency)}
                </strong>
              </div>
              <div className={styles.statusBlock}>
                <span className={styles.statusLabel}>Status</span>
                <StatusPill status={selectedRequest.status}>
                  {withdrawalStatusLabel(selectedRequest.status)}
                </StatusPill>
              </div>
            </section>

            {account ? (
              <DrawerSection
                icon={<IconBuildingBank size={17} stroke={strokeFor(17)} />}
                title="Account Details"
              >
                <DescriptionList items={accountItems} />
              </DrawerSection>
            ) : null}

            <DrawerSection
              icon={<IconReceipt size={17} stroke={strokeFor(17)} />}
              title="Transaction Details"
            >
              <DescriptionList items={transactionItems} />
            </DrawerSection>

            {selectedRequest.note ? (
              <aside className={styles.note} aria-label="Request note">
                <IconNote size={17} stroke={strokeFor(17)} aria-hidden="true" />
                <div>
                  <strong>Note</strong>
                  <p>{selectedRequest.note}</p>
                </div>
              </aside>
            ) : null}

            {canUpdateStatus ? (
              <DrawerSection
                icon={<IconArrowsExchange size={17} stroke={strokeFor(17)} />}
                title="Update Status"
                sub="Select new status for this request"
              >
                <div className={styles.statusPanel}>
                  <StatusChoice value={selectedStatus} current={selectedRequest.status} onChange={setSelectedStatus} />
                  <Textarea
                    label="Note"
                    rows={2}
                    placeholder="Enter note (optional)..."
                    value={note}
                    onChange={setNote}
                  />
                </div>
              </DrawerSection>
            ) : null}

            <Button
              block
              icon={<IconHistory size={16} stroke={strokeFor(16)} />}
              onClick={() => setHistoryModal({ id: selectedRequest.id })}
            >
              View History
            </Button>
          </div>
        ) : null}
      </Drawer>

      <Dialog
        open={Boolean(historyModal)}
        onOpenChange={(open) => {
          if (!open) setHistoryModal(null)
        }}
        title="Withdrawal History"
        size="lg"
      >
        <div className={styles.historyTable}>
          <DataTable
            columns={historyColumns}
            rows={historyRows}
            rowKey={(entry) => entry.rowKey}
            label="Withdrawal history"
            state={historyLoading ? 'loading' : 'ready'}
            empty={(
              <EmptyState
                title="No data"
                icon={<IconInbox size={20} stroke={strokeFor(20)} />}
              />
            )}
          />
        </div>
      </Dialog>
    </Page>
  )
}
