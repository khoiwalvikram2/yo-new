import { useMemo } from 'react'
import { IconInbox } from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  canLoadNextPage,
  pageRange,
  pageSummary,
  transactionAmountTone,
  transactionTypeTone,
  type AgentCreditTransaction,
} from '../agentCreditManagementModel'
import styles from '../CreditManagementPage.module.css'

export function ServerPageControls({ page, pageSize, rowCount, onPageChange, label }: {
  page: number
  pageSize: number
  rowCount: number
  onPageChange: (page: number) => void
  label: string
}) {
  if (rowCount === 0 && page === 1) return null
  return (
    <nav className={styles.pager} aria-label={label}>
      <p className={styles.pagerSummary}>Showing <strong>{pageRange(page, pageSize, rowCount)}</strong></p>
      <div className={styles.pagerNav}>
        <button type="button" className={styles.pagerButton} disabled={page === 1} onClick={() => onPageChange(page - 1)}>Previous</button>
        <span className={styles.pagerPage}>Page {page}</span>
        <button type="button" className={styles.pagerButton} disabled={!canLoadNextPage(rowCount, pageSize)} onClick={() => onPageChange(page + 1)}>Next</button>
      </div>
    </nav>
  )
}

export function AgentCreditHistoryPanel({ transactions, loading, page, pageSize, onPageChange }: {
  transactions: readonly AgentCreditTransaction[]
  loading: boolean
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const columns = useMemo<DataTableColumn<AgentCreditTransaction>[]>(() => [
    {
      key: 'createdAt',
      header: 'Date',
      cell: (row) => <time className={styles.dateCell} dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time>,
    },
    { key: 'transactionType', header: 'Type', cell: (row) => <StatusPill tone={transactionTypeTone()}>{row.transactionType}</StatusPill> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (row) => {
        const positive = transactionAmountTone(row.amount) === 'positive'
        return <span className={clsx(styles.amount, positive ? styles.positive : styles.negative)}>{positive ? '+' : ''}{formatAmount(row.amount)}</span>
      },
    },
    { key: 'balanceBefore', header: 'Before', align: 'right', emphasis: 'dim', cell: (row) => formatAmount(row.balanceBefore) },
    { key: 'balanceAfter', header: 'After', align: 'right', emphasis: 'key', cell: (row) => formatAmount(row.balanceAfter) },
    { key: 'createdBy', header: 'By', cell: (row) => row.createdBy || 'System' },
    { key: 'reason', header: 'Reason', emphasis: 'dim', cell: (row) => <span className={styles.wrapCell}>{row.reason || '—'}</span> },
  ], [formatAmount, formatDateTime])

  return (
    <Card title="Credit Adjustment History" sub={loading ? undefined : pageSummary(page, pageSize, transactions.length)} body="table">
      <DataTable
        label="Agent credit adjustment history"
        columns={columns}
        rows={transactions}
        rowKey={(row) => row.id}
        width="wide"
        state={loading ? 'loading' : 'ready'}
        empty={<EmptyState title="No transaction history" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />}
      />
      {!loading ? <ServerPageControls page={page} pageSize={pageSize} rowCount={transactions.length} onPageChange={onPageChange} label="Adjustment history pagination" /> : null}
    </Card>
  )
}
