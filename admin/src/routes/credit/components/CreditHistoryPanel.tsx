import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { IconInbox } from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  CREDIT_PAGE_SIZE_OPTIONS,
  historyCardSub,
  historyHasNextPage,
  historyPlayerLink,
  historyRange,
  historyTypeLabel,
  historyTypeTone,
  isPositiveHistoryAmount,
  type WhitelabelCreditTransaction,
} from '../creditManagementModel'
import styles from '../CreditManagementPage.module.css'

const PAGE_SIZE_SELECT_OPTIONS = CREDIT_PAGE_SIZE_OPTIONS.map((size) => ({
  value: String(size),
  label: String(size),
}))

interface HistoryPagerProps {
  page: number
  pageSize: number
  rowCount: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

/* The server returns one page and no total, so this pager can only say what is on screen and whether a
   full page suggests more: the legacy "Showing a–b (more available)", Previous / Page N / Next. */
function HistoryPager({ page, pageSize, rowCount, onPageChange, onPageSizeChange }: HistoryPagerProps) {
  const { range, more } = historyRange(page, pageSize, rowCount)
  return (
    <nav className={styles.pager} aria-label="Pagination">
      <p className={styles.pagerSummary}>
        {rowCount > 0 ? (
          <>
            Showing <strong>{range}</strong>
            {more && ' (more available)'}
          </>
        ) : null}
      </p>
      <div className={styles.pagerControls}>
        <Select
          label="Rows per page:"
          size="sm"
          value={String(pageSize)}
          options={PAGE_SIZE_SELECT_OPTIONS}
          onChange={(value) => onPageSizeChange(Number(value))}
        />
        <span className={styles.pagerDivider} aria-hidden="true" />
        <div className={styles.pagerNav}>
          <Button size="sm" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
            Previous
          </Button>
          <span className={styles.pagerPage}>Page {page}</span>
          <Button
            size="sm"
            disabled={!historyHasNextPage(rowCount, pageSize)}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </nav>
  )
}

export interface CreditHistoryPanelProps {
  transactions: readonly WhitelabelCreditTransaction[]
  loading: boolean
  error: boolean
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

/** The Adjustments tab: one server page of the whitelabel's credit ledger. */
export function CreditHistoryPanel({
  transactions,
  loading,
  error,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: CreditHistoryPanelProps) {
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const rowCount = transactions.length
  useEffect(() => {
    if (!loading && !error && !rowCount && page > 1) onPageChange(1)
  }, [loading, error, rowCount, page, onPageChange])
  const waiting = loading && rowCount === 0

  const columns = useMemo<DataTableColumn<WhitelabelCreditTransaction>[]>(() => [
    {
      key: 'createdAt',
      header: 'Date',
      cell: (transaction) => (
        <time className={styles.dateCell} dateTime={transaction.createdAt}>
          {formatDateTime(transaction.createdAt)}
        </time>
      ),
    },
    {
      key: 'transactionType',
      header: 'Type',
      cell: (transaction) => (
        <StatusPill tone={historyTypeTone(transaction.transactionType)}>
          {historyTypeLabel(transaction.transactionType)}
        </StatusPill>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (transaction) => {
        const positive = isPositiveHistoryAmount(transaction)
        return (
          <span className={clsx(styles.amount, positive ? styles.positive : styles.negative)}>
            {positive ? '+' : '-'}{formatAmount(Math.abs(transaction.amount))}
          </span>
        )
      },
    },
    {
      key: 'balanceBefore',
      header: 'Before',
      align: 'right',
      emphasis: 'dim',
      cell: (transaction) => formatAmount(transaction.balanceBefore),
    },
    {
      key: 'balanceAfter',
      header: 'After',
      align: 'right',
      emphasis: 'key',
      cell: (transaction) => formatAmount(transaction.balanceAfter),
    },
    {
      key: 'player',
      header: 'Phone',
      cell: (transaction) => {
        const link = historyPlayerLink(transaction)
        return link ? (
          <Link className={styles.playerLink} to={link.to}>{link.label}</Link>
        ) : (
          '—'
        )
      },
    },
    {
      key: 'createdBy',
      header: 'By',
      cell: (transaction) => transaction.createdBy || 'System',
    },
    {
      key: 'reason',
      header: 'Reason',
      emphasis: 'dim',
      cell: (transaction) => <span className={styles.wrapCell}>{transaction.reason || '—'}</span>,
    },
  ], [formatAmount, formatDateTime])

  return (
    <Card
      title="Credit Adjustment History"
      sub={waiting || error ? undefined : historyCardSub(page, pageSize, rowCount)}
      body="table"
    >
      <DataTable
        label="Credit adjustment history"
        columns={columns}
        rows={transactions.slice(0, pageSize)}
        rowKey={(transaction) => transaction.id}
        width="wide"
        state={error && rowCount === 0 ? 'error' : loading ? 'loading' : 'ready'}
        error="Unable to load credit history"
        empty={(
          <EmptyState
            title="No transaction history"
            icon={<IconInbox size={20} stroke={strokeFor(20)} />}
          />
        )}
      />
      {rowCount > 0 || (page > 1 && !waiting) ? (
        <HistoryPager
          page={page}
          pageSize={pageSize}
          rowCount={rowCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </Card>
  )
}
