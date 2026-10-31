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
import {
  IconBan,
  IconBuildingBank,
  IconCheck,
  IconInfoCircle,
  IconNote,
  IconRefresh,
  IconShieldCheck,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { ADMIN_PAYOUT_ACCOUNTS, APPROVE_PAYOUT_ACCOUNT, REJECT_PAYOUT_ACCOUNT } from '@/lib/graphql/payoutAccounts'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useSearch } from '@/shared/hooks/useSearch'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { confirm } from '@/ui/components/confirm'
import { CopyButton } from '@/ui/components/CopyButton'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { Drawer } from '@/ui/components/Drawer'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { StatusPill } from '@/ui/components/StatusPill'
import { Textarea } from '@/ui/components/Textarea'
import { toast } from '@/ui/components/toast'
import { strokeFor } from '@/ui/components/icons'
import { PayoutAccountsStatsCards } from './components/PayoutAccountsStatsCards'
import { PayoutAccountsFiltersBar } from './components/PayoutAccountsFiltersBar'
import { PayoutAccountsTable, type PayoutAccountItem } from './components/PayoutAccountsTable'
import {
  buildApprovePayoutAccountInput,
  buildPayoutAccountFilter,
  buildRejectPayoutAccountInput,
  isPendingPayoutAccount,
  normalizePayoutDateRange,
  payoutAccountDetailLines,
  payoutDrawerContact,
  payoutMethodLabel,
  payoutMethodTone,
  payoutStatusLabel,
  type PayoutDateRange,
} from './payoutAccountApprovalsModel'
import styles from './PayoutAccountApprovals.module.css'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
// Payout accounts are reviewed under the withdrawals permission, as before.
const PAYOUT_ACCESS_REQUIREMENT = [
  { domain: 'payments.withdrawals', actions: ['view', 'approve', 'reject'] },
]
const DATE_TIME_FORMAT = 'dd MMM yyyy, HH:mm:ss'

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
function CopyableValue({ label, value, mono }: { label: string; value: string; mono: boolean }) {
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

export default function PayoutAccountApprovalsPage() {
  return (
    <RBACGuard required={PAYOUT_ACCESS_REQUIREMENT}>
      <PayoutAccountApprovalsContent />
    </RBACGuard>
  )
}

function PayoutAccountApprovalsContent() {
  const { formatDateTime } = useFormatDate()
  const [selectedAccount, setSelectedAccount] = useState<PayoutAccountItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [status, setStatus] = useState('')
  const { query, setQuery, debouncedQuery } = useSearch({ minLength: 2 })
  const [dateRange, setDateRange] = useState<PayoutDateRange>({})
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [rejectReason, setRejectReason] = useState('')
  const drawerTriggerRef = useRef<HTMLElement | null>(null)
  const pageEyebrow = usePageEyebrow()

  const handleDateRangeChange = (dates: PayoutDateRange | null) => {
    setDateRange(normalizePayoutDateRange(dates))
  }

  const queryVariables = useMemo(
    () => buildPayoutAccountFilter(status, debouncedQuery, dateRange),
    [dateRange, debouncedQuery, status],
  )

  const [statsRevision, setStatsRevision] = useState(0)
  const { data, loading, refetch: refetchList } = useQuery(ADMIN_PAYOUT_ACCOUNTS, {
    variables: {
      input: {
        ...queryVariables,
        offset: (currentPage - 1) * pageSize,
        limit: pageSize,
      },
    },
    errorPolicy: 'all',
    fetchPolicy: 'network-only',
  })
  const refetch = useCallback(() => {
    setStatsRevision(value => value + 1)
    return refetchList()
  }, [refetchList])


  useEffect(() => {
    setCurrentPage(1)
  }, [status, debouncedQuery, dateRange.from, dateRange.to])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setSelectedAccount(null)
    setRejectReason('')
  }, [])

  const [approveMutation, { loading: approving }] = useMutation(APPROVE_PAYOUT_ACCOUNT, {
    context: { skipNotification: true },
    onCompleted: (res) => {
      if (!res?.approvePayoutAccount?.success) return
      toast({ message: res.approvePayoutAccount.message || 'Account approved', tone: 'ok' })
      void refetch()
      closeDrawer()
    },
    onError: (error) => {
      toast({ message: error.message || 'Failed to approve', tone: 'error' })
    },
  })

  const [rejectMutation, { loading: rejecting }] = useMutation(REJECT_PAYOUT_ACCOUNT, {
    context: { skipNotification: true },
    onCompleted: (res) => {
      if (!res?.rejectPayoutAccount?.success) return
      toast({ message: res.rejectPayoutAccount.message || 'Account rejected', tone: 'ok' })
      void refetch()
      closeDrawer()
    },
    onError: (error) => {
      toast({ message: error.message || 'Failed to reject', tone: 'error' })
    },
  })

  const items: PayoutAccountItem[] = data?.adminPayoutAccounts?.items ?? []
  const total = data?.adminPayoutAccounts?.total ?? 0

  const handleView = (item: PayoutAccountItem) => {
    if (typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement) {
      drawerTriggerRef.current = document.activeElement
    }
    setSelectedAccount(item)
    setDrawerOpen(true)
    setRejectReason('')
  }

  // The legacy Popconfirm copy, now a modal confirmation (D5). A failed or false-success mutation keeps
  // the confirmation open with its error so it can be retried.
  const handleApprove = async () => {
    if (!selectedAccount) return
    const input = buildApprovePayoutAccountInput(selectedAccount.id)
    await confirm({
      title: 'Approve Account',
      description: 'Allow this user to use this account for withdrawals?',
      confirmLabel: 'Yes, Approve',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        const result = await approveMutation({ variables: { input } })
        if (!result.data?.approvePayoutAccount?.success) {
          throw new Error(result.data?.approvePayoutAccount?.message || 'Failed to approve')
        }
      },
    })
  }

  const handleReject = async () => {
    if (!selectedAccount) return
    const input = buildRejectPayoutAccountInput(selectedAccount.id, rejectReason)
    await confirm({
      title: 'Reject Account',
      description: 'Are you sure you want to reject this account?',
      confirmLabel: 'Yes, Reject',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        const result = await rejectMutation({ variables: { input } })
        if (!result.data?.rejectPayoutAccount?.success) {
          throw new Error(result.data?.rejectPayoutAccount?.message || 'Failed to reject')
        }
      },
    })
  }

  const isPending = isPendingPayoutAccount(selectedAccount?.approvalStatus)

  const accountItems: DescriptionListItem[] = selectedAccount
    ? [
        {
          key: 'method',
          term: 'Method',
          value: (
            <StatusPill tone={payoutMethodTone(selectedAccount.method)}>
              {payoutMethodLabel(selectedAccount.method)}
            </StatusPill>
          ),
        },
        ...payoutAccountDetailLines(selectedAccount).map((line) => ({
          key: line.key,
          term: line.label,
          value: <CopyableValue label={line.label} value={line.value} mono={line.mono} />,
        })),
      ]
    : []

  const statusItems: DescriptionListItem[] = selectedAccount
    ? [
        {
          key: 'status',
          term: 'Status',
          value: (
            <StatusPill status={selectedAccount.approvalStatus}>
              {payoutStatusLabel(selectedAccount.approvalStatus)}
            </StatusPill>
          ),
        },
        {
          key: 'created-at',
          term: 'Created At',
          value: selectedAccount.createdAt ? (
            <time dateTime={selectedAccount.createdAt}>
              {formatDateTime(selectedAccount.createdAt, DATE_TIME_FORMAT)}
            </time>
          ) : '—',
        },
        ...(selectedAccount.approvedAt
          ? [{
              key: 'reviewed-at',
              term: 'Reviewed At',
              value: (
                <time dateTime={selectedAccount.approvedAt}>
                  {formatDateTime(selectedAccount.approvedAt, DATE_TIME_FORMAT)}
                </time>
              ),
            }]
          : []),
        ...(selectedAccount.approvedBy
          ? [{
              key: 'reviewer-id',
              term: 'Reviewer ID',
              value: <code className={styles.code}>{selectedAccount.approvedBy}</code>,
            }]
          : []),
      ]
    : []

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Payout Account Approvals"
        sub="Approve or reject user withdrawal accounts. Only approved accounts can be used for withdrawals."
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
        <PayoutAccountsStatsCards revision={statsRevision} />

        <PayoutAccountsFiltersBar
          status={status}
          query={query}
          dateRange={dateRange}
          onChangeStatus={setStatus}
          onChangeQuery={setQuery}
          onChangeDateRange={handleDateRangeChange}
          onClearAll={() => {
            setStatus('')
            setQuery('')
            setDateRange({})
            setCurrentPage(1)
            void refetch()
          }}
        />

        <PayoutAccountsTable
          items={items}
          fetching={loading}
          total={total}
          onView={handleView}
          footer={(
            <Pagination loading={loading}
              current={currentPage}
              pageSize={pageSize}
              total={total}
              onChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              itemName="accounts"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              variant="embedded"
            />
          )}
        />
      </div>

      <Drawer
        title={`Payout Account${selectedAccount?.id ? ` - #${selectedAccount.id}` : ''}`}
        size="md"
        open={drawerOpen}
        onOpenChange={(open) => {
          if (!open) closeDrawer()
        }}
        themeFrom={drawerTriggerRef}
        restoreFocusTo={drawerTriggerRef}
        footer={selectedAccount ? (
          <div className={styles.drawerFooter}>
            <p className={styles.footerHint}>
              <IconInfoCircle size={15} stroke={strokeFor(15)} aria-hidden="true" />
              {isPending
                ? 'Review this account'
                : `This account has been ${selectedAccount.approvalStatus.toLowerCase()}`}
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
                    onClick={() => void handleReject()}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<IconCheck size={15} stroke={strokeFor(15)} />}
                    loading={approving}
                    onClick={() => void handleApprove()}
                  >
                    Approve
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={closeDrawer}>Close</Button>
              )}
            </div>
          </div>
        ) : undefined}
      >
        {selectedAccount ? (
          <div className={styles.drawerContent}>
            <section className={styles.userSummary} aria-label="Player">
              <span className={styles.heroIcon} aria-hidden="true">
                <IconUser size={20} stroke={strokeFor(20)} />
              </span>
              <div className={styles.summaryCopy}>
                <strong>{selectedAccount.user?.name || 'N/A'}</strong>
                <span className={styles.contact}>{payoutDrawerContact(selectedAccount.user)}</span>
              </div>
              {selectedAccount.user?.id ? (
                <Link className={styles.profileLink} to={`/players/profile/${selectedAccount.user.id}`}>
                  View Profile
                </Link>
              ) : null}
            </section>

            <DrawerSection
              icon={<IconBuildingBank size={17} stroke={strokeFor(17)} />}
              title="Account Details"
            >
              <DescriptionList items={accountItems} />
            </DrawerSection>

            <DrawerSection
              icon={<IconShieldCheck size={17} stroke={strokeFor(17)} />}
              title="Approval Status"
            >
              <DescriptionList items={statusItems} />
            </DrawerSection>

            {selectedAccount.rejectionReason ? (
              <aside className={styles.rejection} aria-label="Rejection reason">
                <IconBan size={17} stroke={strokeFor(17)} aria-hidden="true" />
                <div>
                  <strong>Rejection Reason</strong>
                  <p>{selectedAccount.rejectionReason}</p>
                </div>
              </aside>
            ) : null}

            {isPending ? (
              <DrawerSection
                icon={<IconNote size={17} stroke={strokeFor(17)} />}
                title="Rejection Reason"
                sub="Optional note if rejecting this account"
              >
                <Textarea
                  label="Rejection reason"
                  hideLabel
                  rows={2}
                  placeholder="Enter reason for rejection (optional, shown to user)..."
                  value={rejectReason}
                  onChange={setRejectReason}
                />
              </DrawerSection>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </Page>
  )
}
