import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useApolloClient } from '@apollo/client'
import { IconDownload, IconEye, IconInbox } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { ADMIN_WITHDRAWAL_REQUESTS } from '@/lib/graphql/withdrawals'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { CopyButton } from '@/ui/components/CopyButton'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { StatusPill } from '@/ui/components/StatusPill'
import { toast } from '@/ui/components/toast'
import {
  DELETED_ACCOUNT_HINT,
  DELETED_ACCOUNT_LABEL,
  withdrawalStatusLabel,
  type WithdrawalRequest,
  type WithdrawalRequestsFilter,
} from '../withdrawalRequestsModel'
import { exportWithdrawalsToExcel } from '../utils/exportWithdrawals'
import styles from '../WithdrawalRequests.module.css'

// The export utility reads the row type from here, as it always has.
export type { WithdrawalRequest } from '../withdrawalRequestsModel'

/** Filter fields for adminWithdrawalRequests (excluding offset/limit). */
export type WithdrawalRequestsExportFilter = WithdrawalRequestsFilter

type WithdrawalRequestsTableProps = {
  requests: WithdrawalRequest[]
  fetching: boolean
  total?: number
  /** Same filters as the list query; export loads all matching rows (paged), not only the current page. */
  exportFilter: WithdrawalRequestsExportFilter
  onView: (request: WithdrawalRequest) => void
  footer?: ReactNode
}

function CopyableAccountValue({ value, label }: { value?: string; label: string }) {
  return (
    <>
      <code className={styles.code}>{value || '—'}</code>
      {value ? (
        <CopyButton
          size="sm"
          value={value}
          label={`Copy ${label}`}
          copiedLabel={`${label} copied`}
          errorLabel="Failed to copy"
        />
      ) : null}
    </>
  )
}

/** The legacy three-line account summary: holder, number, then IFSC for a bank or the method otherwise.
 *  An account the player has since deleted is still shown, with a Deleted pill beside its holder. */
function AccountCell({ account }: { account: WithdrawalRequest['account'] }) {
  if (!account) return <>—</>

  return (
    <dl className={styles.accountList}>
      <div className={styles.accountRow}>
        <dt className={styles.accountTerm}>Name</dt>
        <dd className={styles.accountValue}>
          <span className={styles.accountName} title={account.accountHolderName || '—'}>
            {account.accountHolderName || '—'}
          </span>
          {account.deletedAt ? (
            <StatusPill tone="neg" title={DELETED_ACCOUNT_HINT}>{DELETED_ACCOUNT_LABEL}</StatusPill>
          ) : null}
        </dd>
      </div>
      <div className={styles.accountRow}>
        <dt className={styles.accountTerm}>Acc No.</dt>
        <dd className={styles.accountValue}>
          <CopyableAccountValue value={account.accountNumber} label="Account Number" />
        </dd>
      </div>
      {account.method === 'BANK' ? (
        <div className={styles.accountRow}>
          <dt className={styles.accountTerm}>IFSC</dt>
          <dd className={styles.accountValue}>
            <CopyableAccountValue value={account.ifscCode} label="IFSC" />
          </dd>
        </div>
      ) : (
        <div className={styles.accountRow}>
          <dt className={styles.accountTerm}>Method</dt>
          <dd className={styles.accountValue}>{account.method}</dd>
        </div>
      )}
    </dl>
  )
}

const EXPORT_CHUNK = 500

export function WithdrawalRequestsTable({
  requests,
  fetching,
  total = 0,
  exportFilter,
  onView,
  footer,
}: WithdrawalRequestsTableProps) {
  const client = useApolloClient()
  const { formatAmount } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    if (total <= 0) {
      toast({
        title: 'No Data',
        message: 'There are no withdrawal requests to export for the current filters.',
        tone: 'warn',
      })
      return
    }

    setExporting(true)
    try {
      const allRows: WithdrawalRequest[] = []
      let offset = 0
      let serverTotal = total

      while (true) {
        const { data, error } = await client.query<{
          adminWithdrawalRequests: { items: WithdrawalRequest[]; total: number }
        }>({
          query: ADMIN_WITHDRAWAL_REQUESTS,
          variables: {
            input: {
              ...exportFilter,
              offset,
              limit: EXPORT_CHUNK,
            },
          },
          fetchPolicy: 'network-only',
        })
        if (error) throw error

        const batch = data?.adminWithdrawalRequests?.items ?? []
        serverTotal = data?.adminWithdrawalRequests?.total ?? serverTotal
        if (!batch.length) break
        allRows.push(...batch)
        if (allRows.length >= serverTotal || batch.length < EXPORT_CHUNK) break
        offset += batch.length
      }

      if (!allRows.length) {
        toast({
          title: 'No Data',
          message: 'There are no withdrawal requests to export.',
          tone: 'warn',
        })
        return
      }

      await exportWithdrawalsToExcel(allRows, allRows.length)
      toast({
        title: 'Export Complete',
        message: `${allRows.length.toLocaleString()} withdrawal request${allRows.length === 1 ? '' : 's'} exported to Excel.`,
        tone: 'ok',
      })
    } catch (err: unknown) {
      const messageText = err instanceof Error ? err.message : 'Something went wrong during export.'
      toast({ title: 'Export Failed', message: messageText, tone: 'error' })
    } finally {
      setExporting(false)
    }
  }

  const columns = useMemo<DataTableColumn<WithdrawalRequest>[]>(
    () => [
      {
        key: 'id',
        header: 'ID',
        cell: (request) => `#${request.id}`,
        emphasis: 'id',
      },
      {
        key: 'user',
        header: 'User',
        cell: (request) => {
          const contact = request.user?.phone || request.user?.email || ''
          return (
            <div className={styles.stack}>
              {request.user?.id ? (
                <Link className={styles.playerLink} to={`/players/profile/${request.user.id}`}>
                  {request.user.name || 'N/A'}
                </Link>
              ) : (
                <span>{request.user?.name || 'N/A'}</span>
              )}
              {contact ? <span className={styles.secondary}>{contact}</span> : null}
            </div>
          )
        },
      },
      {
        key: 'amount',
        header: 'Amount',
        cell: (request) => formatAmount(request.amount, request.currency),
        align: 'right',
        emphasis: 'key',
      },
      {
        key: 'account',
        header: 'Account',
        cell: (request) => <AccountCell account={request.account} />,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (request) => (
          <StatusPill status={request.status}>{withdrawalStatusLabel(request.status)}</StatusPill>
        ),
      },
      {
        key: 'createdAt',
        header: 'Created',
        cell: (request) => (
          <div className={styles.stack}>
            <span>{formatDate(request.createdAt, 'dd MMM yyyy')}</span>
            <span className={styles.secondary}>{formatTime(request.createdAt, 'HH:mm')}</span>
          </div>
        ),
      },
    ],
    [formatAmount, formatDate, formatTime],
  )

  const requestCount = total ?? requests.length

  return (
    <Card
      title="Withdrawal Requests"
      sub={`${requestCount.toLocaleString()} ${requestCount === 1 ? 'request' : 'requests'}`}
      body="table"
      tools={
        <Button
          variant="primary"
          size="sm"
          icon={<IconDownload size={15} stroke={strokeFor(15)} />}
          loading={exporting}
          onClick={handleExport}
          disabled={total <= 0 || fetching}
        >
          Export Excel
        </Button>
      }
    >
      <DataTable
        columns={columns}
        rows={requests}
        rowKey={(request) => request.id}
        label="Withdrawal requests"
        state={fetching ? 'loading' : 'ready'}
        width="wide"
        empty={
          <EmptyState
            title="No withdrawal requests found"
            icon={<IconInbox size={20} stroke={strokeFor(20)} />}
          />
        }
        rowActions={(request) => ({
          primary: (
            <IconButton
              size="sm"
              label={`View details for withdrawal ${request.id}`}
              icon={<IconEye size={15} stroke={strokeFor(15)} />}
              onClick={() => onView(request)}
            />
          ),
        })}
      />
      {footer}
    </Card>
  )
}
