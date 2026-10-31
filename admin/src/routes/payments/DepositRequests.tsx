import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMutation, useQuery, useSubscription } from '@apollo/client'
import { Link } from 'react-router-dom'
import {
  IconCheck,
  IconCurrencyRupee,
  IconInfoCircle,
  IconMessage,
  IconNote,
  IconPencil,
  IconPhoto,
  IconReceipt,
  IconRefresh,
  IconSettings,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import {
  ADMIN_DEPOSIT_REQUESTS,
  APPROVE_DEPOSIT_REQUEST,
  DEPOSIT_REQUEST_UPDATED_SUBSCRIPTION,
  REJECT_DEPOSIT_REQUEST,
} from '@/lib/graphql/deposits'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useSearch } from '@/shared/hooks/useSearch'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { confirm } from '@/ui/components/confirm'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { Drawer } from '@/ui/components/Drawer'
import { ImagePreview } from '@/ui/components/ImagePreview'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { StatusPill } from '@/ui/components/StatusPill'
import { Textarea } from '@/ui/components/Textarea'
import { toast } from '@/ui/components/toast'
import { strokeFor } from '@/ui/components/icons'
import { DepositRequestsFiltersBar } from './components/DepositRequestsFiltersBar'
import { DepositRequestsStatsCards } from './components/DepositRequestsStatsCards'
import { DepositRequestsTable } from './components/DepositRequestsTable'
import {
  buildDepositRequestFilter,
  depositStatusLabel,
  getDepositRangeForPreset,
  hasValidDepositProof,
  type DepositDateRange,
  type DepositRequest as DepositRequestRecord,
} from './depositRequestsModel'
import styles from './DepositRequests.module.css'

export type { DepositRequest } from './depositRequestsModel'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const DEPOSIT_ACCESS_REQUIREMENT = [
  { domain: 'payments.deposits', actions: ['view', 'approve', 'reject'] },
]

function DrawerSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className={styles.drawerSection} aria-labelledby={`deposit-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <header className={styles.sectionHeader}>
        <span className={styles.sectionIcon} aria-hidden="true">{icon}</span>
        <h3 id={`deposit-${title.toLowerCase().replace(/\s+/g, '-')}`} className={styles.sectionTitle}>
          {title}
        </h3>
      </header>
      {children}
    </section>
  )
}

export default function DepositRequestsPage() {
  return (
    <RBACGuard required={DEPOSIT_ACCESS_REQUIREMENT}>
      <DepositRequestsContent />
    </RBACGuard>
  )
}

function DepositRequestsContent() {
  const [selectedRequest, setSelectedRequest] = useState<DepositRequestRecord | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [status, setStatus] = useState('PENDING')
  const [method, setMethod] = useState('')
  const { query, setQuery, debouncedQuery } = useSearch({ minLength: 2 })
  const [dateRange, setDateRange] = useState<DepositDateRange>(
    () => getDepositRangeForPreset('today') ?? {},
  )
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [rejectNote, setRejectNote] = useState('')
  const [approveNote, setApproveNote] = useState('')
  const approveNoteRef = useRef<HTMLTextAreaElement>(null)
  const drawerTriggerRef = useRef<HTMLElement | null>(null)
  const pageEyebrow = usePageEyebrow()
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()

  const handleDateRangeChange = (range: DepositDateRange | null) => {
    if (range?.from && range.to) setDateRange({ from: range.from, to: range.to })
    else setDateRange({})
  }

  const queryVariables = useMemo(
    () => buildDepositRequestFilter(status, method, debouncedQuery, dateRange),
    [dateRange, debouncedQuery, method, status],
  )

  const [statsRevision, setStatsRevision] = useState(0)
  const { data, loading, refetch: refetchList } = useQuery(ADMIN_DEPOSIT_REQUESTS, {
    variables: {
      input: {
        ...queryVariables,
        offset: (currentPage - 1) * pageSize,
        limit: pageSize,
      },
    },
    errorPolicy: 'all',
    pollInterval: 15000,
    fetchPolicy: 'cache-and-network',
  })
  const refetch = useCallback(() => {
    setStatsRevision(value => value + 1)
    return refetchList()
  }, [refetchList])


  useSubscription(DEPOSIT_REQUEST_UPDATED_SUBSCRIPTION, {
    variables: { tenant: undefined },
    onData: useCallback((payload: { data?: { data?: { depositRequestUpdated?: unknown } } }) => {
      if (payload?.data?.data?.depositRequestUpdated) refetch().catch(() => {})
    }, [refetch]),
    onError: () => {},
  })

  useEffect(() => {
    setCurrentPage(1)
  }, [dateRange.from, dateRange.to, debouncedQuery, method, status])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setSelectedRequest(null)
    setRejectNote('')
    setApproveNote('')
  }, [])

  const [approveRequest, { loading: approving }] = useMutation(APPROVE_DEPOSIT_REQUEST, {
    context: { skipNotification: true },
    onCompleted: (result) => {
      if (!result?.approveDepositRequest?.success) return
      toast({
        message: result.approveDepositRequest.message || 'Deposit approved successfully',
        tone: 'ok',
      })
      void refetch()
      setDrawerOpen(false)
      setSelectedRequest(null)
      setApproveNote('')
    },
    onError: (error) => {
      toast({ message: error.message || 'Failed to approve deposit request', tone: 'error' })
    },
  })

  const [rejectRequest, { loading: rejecting }] = useMutation(REJECT_DEPOSIT_REQUEST, {
    context: { skipNotification: true },
    onCompleted: (result) => {
      if (!result?.rejectDepositRequest?.success) return
      toast({
        message: result.rejectDepositRequest.message || 'Deposit rejected successfully',
        tone: 'ok',
      })
      void refetch()
      setDrawerOpen(false)
      setSelectedRequest(null)
      setRejectNote('')
    },
    onError: (error) => {
      toast({ message: error.message || 'Failed to reject deposit request', tone: 'error' })
    },
  })

  const handleView = (request: DepositRequestRecord) => {
    if (typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement) {
      drawerTriggerRef.current = document.activeElement
    }
    setSelectedRequest(request)
    setDrawerOpen(true)
  }

  const handleApprove = async () => {
    if (!selectedRequest) return
    const note = approveNote.trim()
    if (!note) {
      toast({ message: 'Please provide a remark before approving', tone: 'error' })
      return
    }

    await confirm({
      title: 'Approve Deposit Request',
      description: "This will credit the player's wallet. Are you sure?",
      confirmLabel: 'Yes, Approve',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        const result = await approveRequest({ variables: { input: { id: selectedRequest.id, note } } })
        if (!result.data?.approveDepositRequest?.success) {
          throw new Error(
            result.data?.approveDepositRequest?.message || 'Failed to approve deposit request',
          )
        }
      },
    })
  }

  const handleReject = async () => {
    if (!selectedRequest) return
    await confirm({
      title: 'Reject Deposit Request',
      description: 'Are you sure you want to reject this deposit?',
      confirmLabel: 'Yes, Reject',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        const result = await rejectRequest({
          variables: {
            input: {
              id: selectedRequest.id,
              note: rejectNote.trim() || null,
            },
          },
        })
        if (!result.data?.rejectDepositRequest?.success) {
          throw new Error(
            result.data?.rejectDepositRequest?.message || 'Failed to reject deposit request',
          )
        }
      },
    })
  }

  const requests: DepositRequestRecord[] = data?.adminDepositRequests?.items ?? []
  const total = data?.adminDepositRequests?.total ?? 0
  const isPending = selectedRequest?.status === 'PENDING'

  const transactionItems = selectedRequest
    ? [
        { key: 'request-id', term: 'Request ID', value: <code className={styles.code}>{selectedRequest.id}</code> },
        ...(selectedRequest.utr
          ? [{ key: 'utr', term: 'UTR Number', value: <code className={styles.code}>{selectedRequest.utr}</code> }]
          : []),
        ...(selectedRequest.referenceId
          ? [{ key: 'reference-id', term: 'Reference ID', value: <code className={styles.code}>{selectedRequest.referenceId}</code> }]
          : []),
        {
          key: 'status',
          term: 'Status',
          value: (
            <StatusPill status={selectedRequest.status}>
              {depositStatusLabel(selectedRequest.status)}
            </StatusPill>
          ),
        },
        {
          key: 'created-at',
          term: 'Created At',
          value: (
            <time dateTime={selectedRequest.createdAt}>
              {formatDateTime(selectedRequest.createdAt, 'dd MMM yyyy, HH:mm:ss')}
            </time>
          ),
        },
        ...(selectedRequest.reviewedAt
          ? [{
              key: 'reviewed-at',
              term: 'Reviewed At',
              value: (
                <time dateTime={selectedRequest.reviewedAt}>
                  {formatDateTime(selectedRequest.reviewedAt, 'dd MMM yyyy, HH:mm:ss')}
                </time>
              ),
            }]
          : []),
        ...(selectedRequest.walletTxnId
          ? [{ key: 'wallet-txn-id', term: 'Wallet Txn ID', value: <code className={styles.code}>{selectedRequest.walletTxnId}</code> }]
          : []),
      ]
    : []

  return (
    <Page maxWidth="wide">
        <PageHeader
          eyebrow={pageEyebrow}
          title="Deposit Requests"
          sub="Review and approve/reject deposit requests from players"
          actions={(
            <>
              <Button
                icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
                onClick={() => void refetch()}
              >
                Refresh
              </Button>
              <Link
                to="/payments/methods"
                className={buttonClassName({ variant: 'secondary' })}
              >
                <IconSettings size={16} stroke={strokeFor(16)} aria-hidden="true" />
                <span>Payment Methods</span>
              </Link>
            </>
          )}
        />

        <div className={styles.content}>
          <DepositRequestsStatsCards revision={statsRevision} />

          <DepositRequestsFiltersBar
            status={status}
            method={method}
            query={query}
            dateRange={dateRange}
            onChangeStatus={setStatus}
            onChangeMethod={setMethod}
            onChangeQuery={setQuery}
            onChangeDateRange={handleDateRangeChange}
            onClearAll={() => {
              setStatus('PENDING')
              setMethod('')
              setQuery('')
              setDateRange(getDepositRangeForPreset('today') ?? {})
              setCurrentPage(1)
              void refetch()
            }}
          />

          <DepositRequestsTable
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
          title={`Deposit Request${selectedRequest?.id ? ` - #${selectedRequest.id}` : ''}`}
          sub="Review the payment evidence and request details before taking action."
          size="md"
          open={drawerOpen}
          onOpenChange={(open) => {
            if (!open) closeDrawer()
          }}
          initialFocus={isPending ? approveNoteRef : undefined}
          themeFrom={drawerTriggerRef}
          restoreFocusTo={drawerTriggerRef}
          footer={selectedRequest ? (
            <div className={styles.drawerFooter}>
              <p className={styles.footerHint}>
                <IconInfoCircle size={15} stroke={strokeFor(15)} aria-hidden="true" />
                {isPending
                  ? (!approveNote.trim() ? 'Enter remark to approve' : 'Review and process this request')
                  : `This request has been ${selectedRequest.status.toLowerCase()}`}
              </p>
              <div className={styles.footerActions}>
                {isPending ? (
                  <>
                    <Button size="sm" onClick={closeDrawer}>Cancel</Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<IconX size={15} stroke={strokeFor(15)} />}
                      loading={rejecting}
                      disabled={approving}
                      onClick={() => void handleReject()}
                    >
                      Reject
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<IconCheck size={15} stroke={strokeFor(15)} />}
                      disabled={!approveNote.trim() || rejecting}
                      loading={approving}
                      onClick={() => void handleApprove()}
                    >
                      Approve Deposit
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

              <section className={styles.amountSummary} aria-label="Deposit summary">
                <span className={styles.heroIcon} aria-hidden="true">
                  <IconCurrencyRupee size={20} stroke={strokeFor(20)} />
                </span>
                <div className={styles.summaryCopy}>
                  <span>Deposit Amount</span>
                  <strong className={styles.amount}>
                    {formatAmount(selectedRequest.amount, selectedRequest.currency)}
                  </strong>
                </div>
                <div className={styles.method}>
                  <span>Method</span>
                  <StatusPill tone={selectedRequest.method === 'UPI' ? 'info' : 'neutral'}>
                    {selectedRequest.method.replace('_', ' ')}
                  </StatusPill>
                </div>
              </section>

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

              {hasValidDepositProof(selectedRequest) ? (
                <DrawerSection
                  icon={<IconPhoto size={17} stroke={strokeFor(17)} />}
                  title="Payment Proof"
                >
                  <ImagePreview
                    src={selectedRequest.proofUrl as string}
                    alt="Payment proof"
                    dialogTitle="Payment proof"
                    openLabel="View payment proof"
                    className={styles.proof}
                  />
                </DrawerSection>
              ) : null}

              {isPending ? (
                <div className={styles.remarkGrid}>
                  <DrawerSection
                    icon={<IconPencil size={17} stroke={strokeFor(17)} />}
                    title="Approval Remark"
                  >
                    <Textarea
                      ref={approveNoteRef}
                      label="Remark"
                      help="Required for approval"
                      required
                      rows={2}
                      placeholder="Enter remark (required for approval)..."
                      value={approveNote}
                      onChange={setApproveNote}
                    />
                  </DrawerSection>

                  <DrawerSection
                    icon={<IconMessage size={17} stroke={strokeFor(17)} />}
                    title="Rejection Note"
                  >
                    <Textarea
                      label="Rejection note"
                      help="Optional - Add a note if rejecting"
                      rows={2}
                      placeholder="Enter reason for rejection (optional)..."
                      value={rejectNote}
                      onChange={setRejectNote}
                    />
                  </DrawerSection>
                </div>
              ) : null}
            </div>
          ) : null}
        </Drawer>
    </Page>
  )
}
