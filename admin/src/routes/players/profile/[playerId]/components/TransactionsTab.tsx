import { useState, useMemo, useEffect } from 'react'
import { useQuery, useApolloClient, gql } from '@apollo/client'
import { IconDownload, IconSearch } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { startOfDay, endOfDay, addDays, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { StatusPill } from '@/ui/components/StatusPill'
import { Select } from '@/ui/components/Select'
import { TextField } from '@/ui/components/TextField'
import { FilterBar } from '@/ui/components/FilterBar'
import { EmptyState } from '@/ui/components/EmptyState'
import { toast } from '@/ui/components/toast'
import styles from '../PlayerProfile.module.css'

interface ProfileTransactionMetadata { adjustmentId?: string; remark?: string }
interface ProfileTransaction { id: string; type: string; method?: string | null; amount?: number; fees?: number; netAmount?: number; status: string; reference?: string | null; provider?: string | null; currency: string; createdAt: string; metadata?: ProfileTransactionMetadata | string | null; reason?: string; balanceBefore?: number; balanceAfter?: number; transactionType?: string; isCreditTransaction?: boolean }

const PLAYER_TRANSACTIONS_QUERY = gql`
  query PlayerTransactions($playerId: ID!, $filter: PlayerTransactionsFilter) {
    playerTransactions(playerId: $playerId, filter: $filter) {
      items {
        id
        type
        method
        amount
        fees
        netAmount
        status
        reference
        provider
        currency
        createdAt
        metadata
        balanceBefore
        balanceAfter
      }
      total
      hasMore
    }
  }
`

interface TransactionsTabProps {
  playerId: string
  dateRange: string
  dateFrom: string | null
  dateTo: string | null
}

function resolveDateRange(dateRange: string, dateFrom: string | null, dateTo: string | null): { from: string | null; to: string | null } {
  if (dateFrom && dateTo) return { from: dateFrom, to: dateTo }
  if (!dateRange || dateRange === 'all_time') return { from: null, to: null }
  const now = new Date()
  const tz = DEFAULT_ADMIN_TZ
  if (dateRange === 'today') {
    return { from: startOfDay(now, tz).toISOString(), to: endOfDay(now, tz).toISOString() }
  }
  if (dateRange === 'yesterday') {
    const yesterdayStart = addDays(startOfDay(now, tz), -1)
    return { from: yesterdayStart.toISOString(), to: endOfDay(yesterdayStart, tz).toISOString() }
  }
  const ranges: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }
  const days = ranges[dateRange]
  if (!days) return { from: null, to: null }
  return {
    from: addDays(startOfDay(now, tz), -days).toISOString(),
    to: endOfDay(now, tz).toISOString(),
  }
}

export function TransactionsTab({
  playerId,
  dateRange,
  dateFrom,
  dateTo,
}: TransactionsTabProps) {
  const { formatAmount } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [query, setQuery] = useState<string>('')
  const [page, setPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(50)
  const [exporting, setExporting] = useState(false)
  const client = useApolloClient()

  const resolvedDates = useMemo(() => resolveDateRange(dateRange, dateFrom, dateTo), [dateRange, dateFrom, dateTo])

  const { data, loading, error, refetch } = useQuery<{ playerTransactions?: { items?: ProfileTransaction[]; total: number; hasMore: boolean } }>(PLAYER_TRANSACTIONS_QUERY, {
    variables: {
      playerId,
      filter: {
        search: query.trim() || undefined,
        type: typeFilter || undefined,
        status: statusFilter || undefined,
        dateFrom: resolvedDates.from || undefined,
        dateTo: resolvedDates.to || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
    },
    errorPolicy: 'all',
  })

  const transactions = data?.playerTransactions?.items ?? []
  const displayTotal = data?.playerTransactions?.total ?? 0
  useEffect(() => { setPage(1) }, [playerId, resolvedDates.from, resolvedDates.to, query, typeFilter, statusFilter])
  useEffect(() => {
    if (!loading && data?.playerTransactions) setPage(current => Math.min(current, Math.max(1, Math.ceil(displayTotal / pageSize))))
  }, [loading, data, displayTotal, pageSize])
  const handleExport = async () => {
    setExporting(true)
    try {
    const all: ProfileTransaction[] = []
    for (let offset = 0; ; offset += 500) {
      const result = await client.query({ query: PLAYER_TRANSACTIONS_QUERY, variables: { playerId, filter: { type: typeFilter || undefined, status: statusFilter || undefined,
        search: query.trim() || undefined, dateFrom: resolvedDates.from || undefined, dateTo: resolvedDates.to || undefined, limit: 500, offset } }, fetchPolicy: 'network-only' })
      const batch = result.data?.playerTransactions?.items ?? []
      all.push(...batch)
      if (!batch.length || all.length >= (result.data?.playerTransactions?.total ?? 0)) break
    }
    const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"','""')}"`
    const header = ['Type','Method','Amount','Fees','Net Amount','Status','Reference','Currency','Created']
    const csv = [header.map(cell).join(','), ...all.map(row => [row.type,row.method,row.amount,row.fees,row.netAmount,row.status,row.reference,row.currency,row.createdAt].map(cell).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `transactions-${playerId}.csv`; anchor.click(); URL.revokeObjectURL(url)
    } catch (error) {
      toast({ title: 'Export failed', message: error instanceof Error ? error.message : 'Unable to export transactions.', tone: 'error' })
    } finally { setExporting(false) }
  }

  const handleClearAll = () => {
    setTypeFilter('')
    setStatusFilter('')
    setQuery('')
    setPage(1)
    refetch({
      playerId,
      filter: {
        type: undefined,
        status: undefined,
        dateFrom: resolvedDates.from || undefined,
        dateTo: resolvedDates.to || undefined,
        limit: pageSize,
        offset: 0,
      },
    })
  }

  // Count active filters
  const activeFiltersCount = [
    query,
    typeFilter,
    statusFilter,
  ].filter(Boolean).length

  const typeLabel = (row: ProfileTransaction) => {
    let display = row.isCreditTransaction ? row.transactionType?.replace(/_/g, ' ').toLowerCase() || row.type : row.type
    if (row.type === 'transfer' && row.metadata) {
      try { const metadata: ProfileTransactionMetadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; if (metadata?.remark) display = metadata.remark } catch { display = row.type }
    }
    return display === 'manual_deposit' ? 'Manual Deposit' : display === 'manual_withdrawal' ? 'Manual Withdrawal' : display
  }
  const columns: DataTableColumn<ProfileTransaction>[] = [
    { key: 'type', header: 'Type', minWidth: 170, cell: (row) => <StatusPill tone="neutral">{typeLabel(row)}</StatusPill> },
    { key: 'method', header: 'Method', minWidth: 150, cell: (row) => row.method || '—' },
    { key: 'amount', header: 'Amount', align: 'right', minWidth: 150, cell: (row) => formatAmount(row.amount || 0, row.currency) },
    { key: 'netAmount', header: 'Net Amount', align: 'right', minWidth: 150, cell: (row) => formatAmount(row.netAmount || 0, row.currency) },
    { key: 'status', header: 'Status', minWidth: 110, cell: (row) => <StatusPill status={row.status}>{row.status === 'completed' ? 'Completed' : row.status === 'pending' ? 'Pending' : row.status === 'failed' ? 'Failed' : row.status}</StatusPill> },
    { key: 'reference', header: 'Reference', minWidth: 170, emphasis: 'id', cell: (row) => row.reference || '—' },
    { key: 'createdAt', header: 'Created', minWidth: 150, cell: (row) => <span>{formatDate(row.createdAt, 'dd MMM yyyy')}<span className={styles.subtle}> · {formatTime(row.createdAt, 'HH:mm')}</span></span> },
  ]
  return <div className={styles.stack}>
    <FilterBar label="Transaction filters" activeCount={activeFiltersCount} onClearAll={handleClearAll} search={<TextField label="Search transactions" hideLabel placeholder="Transaction ID, Reference..." prefix={<IconSearch size={16} />} value={query} onChange={setQuery} clearable />}>
      <Select label="Type" value={typeFilter} onChange={(next) => { setTypeFilter(next); setPage(1) }} options={[
        { value: '', label: 'All Types' }, { value: 'all_deposit', label: 'All Deposits' }, { value: 'all_withdrawal', label: 'All Withdrawals' },
        { value: 'deposit', label: 'Deposit' }, { value: 'manual_deposit', label: 'Manual Deposit' }, { value: 'withdrawal', label: 'Withdrawal' },
        { value: 'manual_withdrawal', label: 'Manual Withdrawal' }, { value: 'transfer', label: 'Transfer' }, { value: 'adjustment', label: 'Adjustment' },
      ]} />
      <Select label="Status" value={statusFilter} onChange={(next) => { setStatusFilter(next); setPage(1) }} options={[{ value: '', label: 'All Status' }, { value: 'completed', label: 'Completed' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' }]} />
    </FilterBar>
    <Card title="Transactions" sub={`${displayTotal} ${displayTotal === 1 ? 'transaction' : 'transactions'}`} body="table" tools={<Button size="sm" loading={exporting} icon={<IconDownload size={16} />} onClick={() => void handleExport()}>Export</Button>}>
      <DataTable columns={columns} rows={error ? [] : transactions} rowKey={(row) => row.id} label="Player transactions" width="wide" state={loading ? 'loading' : error ? 'error' : 'ready'} error="Error loading transactions" onRetry={() => void refetch()} empty={<EmptyState title="No transactions found" />} pagination={displayTotal ? { current: page, pageSize, total: displayTotal, onChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1) }, pageSizeOptions: [10, 20, 50, 100], itemName: 'transactions' } : false} />
    </Card>
  </div>
}

