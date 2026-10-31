import { useMemo, useState } from 'react'
import { IconDownload, IconEye, IconInbox } from '@tabler/icons-react'
import { useApolloClient } from '@apollo/client'
import { Link } from 'react-router-dom'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { ADMIN_DEPOSIT_REQUESTS } from '@/lib/graphql/deposits'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { ImagePreview } from '@/ui/components/ImagePreview'
import { StatusPill } from '@/ui/components/StatusPill'
import { toast } from '@/ui/components/toast'
import type { DepositRequest } from '../DepositRequests'
import { depositStatusLabel, hasValidDepositProof } from '../depositRequestsModel'
import { exportDepositsToExcel } from '../utils/exportDeposits'
import styles from '../DepositRequests.module.css'

/** Filter fields for adminDepositRequests (excluding offset/limit). */
export type DepositRequestsExportFilter = {
  status?: string
  method?: string
  query?: string
  fromDate?: string
  toDate?: string
}

type DepositRequestsTableProps = {
  requests: DepositRequest[]
  fetching: boolean
  total?: number
  /** Same filters as the list query; export loads all matching rows (paged), not only the current page. */
  exportFilter: DepositRequestsExportFilter
  onView: (request: DepositRequest) => void
  footer?: React.ReactNode
}

const EXPORT_CHUNK = 500

export function DepositRequestsTable({
  requests,
  fetching,
  total = 0,
  exportFilter,
  onView,
  footer,
}: DepositRequestsTableProps) {
  const client = useApolloClient()
  const { formatAmount } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    if (total <= 0) {
      toast({
        title: 'No Data',
        message: 'There are no deposit requests to export for the current filters.',
        tone: 'warn',
      })
      return
    }

    setExporting(true)
    try {
      const allRows: DepositRequest[] = []
      let offset = 0
      let serverTotal = total

      while (true) {
        const { data, error } = await client.query<{
          adminDepositRequests: { items: DepositRequest[]; total: number }
        }>({
          query: ADMIN_DEPOSIT_REQUESTS,
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

        const batch = data?.adminDepositRequests?.items ?? []
        serverTotal = data?.adminDepositRequests?.total ?? serverTotal
        if (!batch.length) break
        allRows.push(...batch)
        if (allRows.length >= serverTotal || batch.length < EXPORT_CHUNK) break
        offset += batch.length
      }

      if (!allRows.length) {
        toast({
          title: 'No Data',
          message: 'There are no deposit requests to export.',
          tone: 'warn',
        })
        return
      }

      await exportDepositsToExcel(allRows, allRows.length)
      toast({
        title: 'Export Complete',
        message: `${allRows.length.toLocaleString()} deposit request${allRows.length === 1 ? '' : 's'} exported to Excel.`,
        tone: 'ok',
      })
    } catch (err: unknown) {
      const messageText = err instanceof Error ? err.message : 'Something went wrong during export.'
      toast({ title: 'Export Failed', message: messageText, tone: 'error' })
    } finally {
      setExporting(false)
    }
  }

  const columns = useMemo<DataTableColumn<DepositRequest>[]>(
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
        cell: (request) => (
          <div>
            {request.user?.id ? (
              <Link className={styles.playerLink} to={`/players/profile/${request.user.id}`}>
                {request.user.name || 'N/A'}
              </Link>
            ) : (
              <div>{request.user?.name || 'N/A'}</div>
            )}
            <div>{request.user?.phone || request.user?.email || ''}</div>
          </div>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        cell: (request) => formatAmount(request.amount, request.currency),
        align: 'right',
        emphasis: 'key',
      },
      {
        key: 'method',
        header: 'Method',
        cell: (request) => (
          <StatusPill tone="info">{request.method.replace(/_/g, ' ')}</StatusPill>
        ),
      },
      {
        key: 'utr',
        header: 'UTR',
        cell: (request) => request.utr || '—',
        emphasis: 'id',
      },
      {
        key: 'referenceId',
        header: 'Reference ID',
        cell: (request) => request.referenceId || '—',
        emphasis: 'id',
      },
      {
        key: 'proof',
        header: 'Proof',
        cell: (request) =>
          hasValidDepositProof(request) ? (
            <ImagePreview
              src={request.proofUrl!}
              alt="Payment proof"
              dialogTitle="Payment proof"
              openLabel="View payment proof"
            />
          ) : (
            '—'
          ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (request) => (
          <StatusPill status={request.status}>{depositStatusLabel(request.status)}</StatusPill>
        ),
      },
      {
        key: 'createdAt',
        header: 'Created',
        cell: (request) => (
          <div>
            <div>{formatDate(request.createdAt, 'dd MMM yyyy')}</div>
            <div>{formatTime(request.createdAt, 'HH:mm')}</div>
          </div>
        ),
      },
    ],
    [formatAmount, formatDate, formatTime],
  )

  const requestCount = total ?? requests.length

  return (
    <Card
      title="Deposit Requests"
      sub={`${requestCount.toLocaleString()} ${requestCount === 1 ? 'request' : 'requests'}`}
      body="table"
      tools={
        <Button
          variant="primary"
          size="sm"
          icon={<IconDownload size={15} stroke={1.75} />}
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
        label="Deposit requests"
        state={fetching ? 'loading' : 'ready'}
        width="wide"
        empty={
          <EmptyState
            title="No deposit requests found"
            icon={<IconInbox size={20} stroke={1.45} />}
          />
        }
        rowActions={(request) => ({
          primary: (
            <IconButton
              size="sm"
              label={`View details for deposit ${request.id}`}
              icon={<IconEye size={15} stroke={1.75} />}
              onClick={() => onView(request)}
            />
          ),
        })}
      />
      {footer}
    </Card>
  )
}
