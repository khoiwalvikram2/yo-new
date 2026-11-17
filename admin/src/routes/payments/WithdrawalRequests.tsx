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
import { Link, useSearchParams } from 'react-router-dom'
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
  IconSend,
  IconUser,
} from '@tabler/icons-react'
import {
  ADMIN_WITHDRAWAL_REQUESTS,
  REFRESH_WELIVEPAY_PAYOUT,
  REJECT_WELIVEPAY_PAYOUT,
  SEND_WELIVEPAY_PAYOUT,
  SET_WITHDRAWAL_STATUS,
  WITHDRAWAL_GATEWAY_CONFIG,
} from '@/lib/graphql/withdrawals'
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
import { Notice } from '@/ui/components/Notice'
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
  buildRejectPayoutVariables,
  buildSetWithdrawalStatusInput,
  buildWithdrawalRequestFilter,
  canSetWithdrawalStatusByHand,
  DELETED_ACCOUNT_HINT,
  DELETED_ACCOUNT_LABEL,
  errorMessageOr,
  gatewayPayoutActions,
  getWithdrawalRangeForPreset,
  payoutResultToast,
  payoutStatusLabel,
  payoutStatusTone,
  rejectReasonError,
  REJECT_REASON_MAX,
  withdrawalAfterPayout,
  withdrawalFooterHint,
  WITHDRAWAL_UPDATE_STATUSES,
  withdrawalAccountNumberLabel,
  withdrawalStatusLabel,
  type GatewayPayout,
  type WithdrawalDateRange,
  type WithdrawalGatewayConfig,
  type WithdrawalHistoryEntry,
  type WithdrawalRequest,
  type WithdrawalUpdateStatus,
} from './withdrawalRequestsModel'
import { scopeAcceptsTenant } from './paymentWhitelabelScope'
import { usePaymentWhitelabelScope } from './usePaymentWhitelabelScope'
import styles from './WithdrawalRequests.module.css'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const WITHDRAWAL_ACCESS_REQUIREMENT = [
  { domain: 'payments.withdrawals', actions: ['view', 'approve', 'reject'] },
]
/** Sending a payout is an approval; rejecting one is a rejection (the server checks the same actions). */
const PAYOUT_APPROVE_REQUIREMENT = [{ domain: 'payments.withdrawals', actions: ['approve'] }]
const PAYOUT_REJECT_REQUIREMENT = [{ domain: 'payments.withdrawals', actions: ['reject'] }]
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
    // No onError here: with one, Apollo resolves a refused call with no data, and the confirmation could only say
    // "Failed to update withdrawal status". handleStatusUpdate catches the refusal and shows its reason (FIN-05).
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

  /* ---- WeLivePay IMPS payouts ---- */
  const scope = usePaymentWhitelabelScope()
  const { data: gatewayData } = useQuery(WITHDRAWAL_GATEWAY_CONFIG, {
    skip: scope.selectionRequired,
    fetchPolicy: 'cache-and-network',
  })
  const gatewayConfig = (gatewayData?.withdrawalGatewayConfig ?? null) as WithdrawalGatewayConfig | null
  // An answer cached from another whitelabel never offers payouts on this one.
  const gatewayReady = Boolean(gatewayConfig) && scopeAcceptsTenant(scope, gatewayConfig?.tenant)
  const [sendPayout, { loading: sendingPayout }] = useMutation(SEND_WELIVEPAY_PAYOUT, { context: { skipNotification: true } })
  const [refreshPayout, { loading: refreshingPayout }] = useMutation(REFRESH_WELIVEPAY_PAYOUT, { context: { skipNotification: true } })
  const [rejectPayout, { loading: rejectingPayout }] = useMutation(REJECT_WELIVEPAY_PAYOUT, { context: { skipNotification: true } })
  const gatewayBusy = sendingPayout || refreshingPayout || rejectingPayout
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectError, setRejectError] = useState<string | null>(null)

  // A switch of payment whitelabel closes the open request: its payout belongs to the previous site.
  useEffect(() => {
    closeDrawer()
    setRejectOpen(false)
  }, [scope.key, closeDrawer])

  /* ---- Task links ---- */
  // A withdrawal task links to ?withdrawalId=…: that request opens whatever its status or age (the list
  // keeps its own filters). Closing it drops the link, so a refresh does not open it again.
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedId = searchParams.get('withdrawalId')?.trim() || null
  const { data: linkedData, loading: linkedLoading } = useQuery(ADMIN_WITHDRAWAL_REQUESTS, {
    variables: { input: { id: linkedId, offset: 0, limit: 1 } },
    skip: !linkedId,
    fetchPolicy: 'network-only',
  })
  const [linkedOpen, setLinkedOpen] = useState(false)
  const handledLinkRef = useRef<string | null>(null)
  const dropLink = useCallback(() => {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('withdrawalId')
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    if (!linkedId) {
      handledLinkRef.current = null
      return
    }
    if (linkedLoading || !linkedData || handledLinkRef.current === linkedId) return
    handledLinkRef.current = linkedId
    const linked = (linkedData.adminWithdrawalRequests?.items ?? [])[0] as WithdrawalRequest | undefined
    if (!linked) {
      toast({ message: `Withdrawal request #${linkedId} was not found`, tone: 'error' })
      dropLink()
      return
    }
    drawerTriggerRef.current = null
    setSelectedRequest(linked)
    setDrawerOpen(true)
    setLinkedOpen(true)
    setNote('')
    setSelectedStatus('')
  }, [dropLink, linkedData, linkedId, linkedLoading])

  useEffect(() => {
    if (drawerOpen || !linkedOpen) return
    setLinkedOpen(false)
    dropLink()
  }, [drawerOpen, dropLink, linkedOpen])

  /** Shows the payout's new state: the refreshed list row when it is still listed, else the settled copy. */
  const applyPayoutResult = async (request: WithdrawalRequest, payout: GatewayPayout, options: { rejectedByAdmin?: boolean } = {}) => {
    const refreshed = await refetch().catch(() => null)
    const items: WithdrawalRequest[] = refreshed?.data?.adminWithdrawalRequests?.items ?? []
    setSelectedRequest(items.find((item) => item.id === request.id) ?? withdrawalAfterPayout(request, payout, options))
    setSelectedStatus('')
  }

  const handlePayout = async (kind: 'send' | 'refresh') => {
    const request = selectedRequest
    if (!request || gatewayBusy || !scope.isCurrent()) return
    const run = async () => {
      try {
        const result = kind === 'send'
          ? await sendPayout({ variables: { id: request.id } })
          : await refreshPayout({ variables: { id: request.id } })
        const payout = (kind === 'send' ? result.data?.sendWelivepayPayout : result.data?.refreshWelivepayPayout) as GatewayPayout | undefined
        if (!payout) throw new Error('WeLivePay did not return the payout')
        toast(payoutResultToast(payout))
        await applyPayoutResult(request, payout)
      } catch (error) {
        toast({ message: errorMessageOr(error, kind === 'send' ? 'Failed to send the payout' : 'Failed to refresh the payout'), tone: 'error' })
      }
    }
    if (kind === 'refresh') { await run(); return }
    await confirm({
      title: request.gatewayPayout ? 'Retry the same payout?' : 'Pay via WeLivePay?',
      description: 'Sends the withdrawal amount to the approved bank account by IMPS. Retrying keeps the same reference, so the player is never paid twice.',
      confirmLabel: request.gatewayPayout ? 'Retry payout' : 'Send payout',
      cancelLabel: 'Cancel',
      onConfirm: run,
    })
  }

  const openReject = () => {
    setRejectNote('')
    setRejectError(null)
    setRejectOpen(true)
  }

  const handleRejectPayout = async () => {
    const request = selectedRequest
    if (!request || gatewayBusy || !scope.isCurrent()) return
    const problem = rejectReasonError(rejectNote)
    if (problem) { setRejectError(problem); return }
    try {
      const result = await rejectPayout({ variables: buildRejectPayoutVariables(request.id, rejectNote) })
      const payout = result.data?.rejectWelivepayPayout as GatewayPayout | undefined
      if (!payout) throw new Error('WeLivePay did not return the payout')
      setRejectOpen(false)
      toast({ message: 'Payout rejected. The amount was refunded to the player wallet.', tone: 'ok' })
      await applyPayoutResult(request, payout, { rejectedByAdmin: true })
    } catch (error) {
      setRejectError(errorMessageOr(error, 'Failed to reject the payout'))
    }
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
        // A refusal the server throws (a payout account that is not approved, a request WeLivePay manages) is
        // toasted and stays in this confirmation with its reason, so the reviewer sees why and can cancel or retry.
        const result = await setStatusMutation({ variables: { input } }).catch((error: unknown) => {
          const reason = errorMessageOr(error, 'Failed to update withdrawal status')
          toast({ message: reason, tone: 'error' })
          throw new Error(reason)
        })
        const reply = result.data?.setWithdrawalStatus
        if (!reply?.success) {
          // Another reviewer settled it while this drawer was open: the server changed nothing and
          // answers the request as it stands, so the drawer shows that instead of the stale choice.
          if (reply?.request && reply.request.status !== selectedRequest.status) {
            setSelectedRequest({ ...selectedRequest, ...reply.request })
            setSelectedStatus('')
            void refetch()
          }
          throw new Error(reply?.message || 'Failed to update withdrawal status')
        }
      },
    })
  }

  const requests: WithdrawalRequest[] = data?.adminWithdrawalRequests?.items ?? []
  const total = data?.adminWithdrawalRequests?.total ?? 0
  // A request sent to WeLivePay settles only through the gateway; the server refuses manual changes.
  const canUpdateStatus = canSetWithdrawalStatusByHand(selectedRequest)
  const payoutActions = selectedRequest
    ? gatewayPayoutActions(selectedRequest, { payoutEnabled: Boolean(gatewayConfig?.payoutEnabled), ready: gatewayReady, readOnly: scope.readOnly })
    : null
  const gatewayPayout = selectedRequest?.gatewayPayout ?? null
  const payoutItems: DescriptionListItem[] = gatewayPayout
    ? [
        ...copyableItem('payout-ref', 'Payout Reference', gatewayPayout.orderId, true),
        {
          key: 'payout-status',
          term: 'Gateway Status',
          value: <StatusPill tone={payoutStatusTone(gatewayPayout.status)}>{payoutStatusLabel(gatewayPayout.status)}</StatusPill>,
        },
        ...copyableItem('payout-utr', 'UTR', gatewayPayout.utr, true),
        ...(gatewayPayout.failureReason
          ? [{ key: 'payout-reason', term: 'Gateway Note', value: <span className={styles.wrapCell}>{gatewayPayout.failureReason}</span> }]
          : []),
      ]
    : []

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
            <>
              <StatusPill tone={account.method === 'BANK' ? 'neutral' : 'info'}>
                {account.method || '—'}
              </StatusPill>
              {account.deletedAt ? (
                <StatusPill tone="neg" title={DELETED_ACCOUNT_HINT} className={styles.deletedPill}>
                  {DELETED_ACCOUNT_LABEL}
                </StatusPill>
              ) : null}
            </>
          ),
        },
        ...copyableItem('holder', 'Account Holder Name', account.accountHolderName),
        ...copyableItem('number', withdrawalAccountNumberLabel(account.method), account.accountNumber, true),
        ...copyableItem('ifsc', 'IFSC', account.ifscCode, true),
        ...copyableItem('bank', 'Bank Name', account.bankName),
        ...(account.deletedAt
          ? [{
              key: 'deleted-at',
              term: 'Deleted At',
              value: (
                <time dateTime={account.deletedAt}>
                  {formatDateTime(account.deletedAt, DATE_TIME_FORMAT)}
                </time>
              ),
            }]
          : []),
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
              {withdrawalFooterHint(selectedRequest, selectedStatus)}
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

            {payoutActions?.show ? (
              <DrawerSection
                icon={<IconSend size={17} stroke={strokeFor(17)} />}
                title="WeLivePay Payout"
                sub={gatewayPayout ? 'IMPS payout to the approved bank account' : 'Send this withdrawal to the bank account by IMPS'}
              >
                <div className={styles.payoutPanel}>
                  {gatewayPayout ? <DescriptionList items={payoutItems} /> : null}
                  {payoutActions.managed ? (
                    <Notice tone="info" title="Managed by WeLivePay">
                      This withdrawal settles when the gateway confirms the payout. Refresh to read its status; manual status changes are off.
                    </Notice>
                  ) : null}
                  {!gatewayReady && gatewayPayout ? (
                    <p className={styles.sectionSub}>Select this request's whitelabel to send, refresh or reject its payout.</p>
                  ) : null}
                  <div className={styles.payoutActions}>
                    {payoutActions.pay ? (
                      <RBACGuard required={PAYOUT_APPROVE_REQUIREMENT} fallback={null}>
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<IconSend size={15} stroke={strokeFor(15)} />}
                          loading={sendingPayout}
                          disabled={gatewayBusy}
                          onClick={() => void handlePayout('send')}
                        >
                          {payoutActions.payLabel}
                        </Button>
                      </RBACGuard>
                    ) : null}
                    {payoutActions.refresh ? (
                      <Button
                        size="sm"
                        icon={<IconRefresh size={15} stroke={strokeFor(15)} />}
                        loading={refreshingPayout}
                        disabled={gatewayBusy}
                        onClick={() => void handlePayout('refresh')}
                      >
                        Refresh gateway status
                      </Button>
                    ) : null}
                    {payoutActions.reject ? (
                      <RBACGuard required={PAYOUT_REJECT_REQUIREMENT} fallback={null}>
                        <Button size="sm" variant="danger" disabled={gatewayBusy} onClick={openReject}>
                          Reject payout
                        </Button>
                      </RBACGuard>
                    ) : null}
                  </div>
                </div>
              </DrawerSection>
            ) : null}

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

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          if (!open && !rejectingPayout) setRejectOpen(false)
        }}
        title={`Reject payout${selectedRequest ? ` - #${selectedRequest.id}` : ''}`}
        size="sm"
        footer={(
          <div className={styles.footerActions}>
            <Button size="sm" disabled={rejectingPayout} onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button size="sm" variant="danger" loading={rejectingPayout} onClick={() => void handleRejectPayout()}>
              Reject and refund
            </Button>
          </div>
        )}
      >
        <div className={styles.payoutPanel}>
          <p className={styles.sectionSub}>
            WeLivePay has not taken this payout. Rejecting closes its reference and refunds the amount to the player wallet once.
          </p>
          <Textarea
            label="Reason"
            rows={3}
            placeholder={`Why is this payout rejected? (max ${REJECT_REASON_MAX} characters)`}
            value={rejectNote}
            onChange={(value) => { setRejectNote(value); setRejectError(null) }}
            error={rejectError ?? undefined}
          />
        </div>
      </Dialog>
    </Page>
  )
}
