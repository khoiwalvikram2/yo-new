import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@apollo/client'
import { Link } from 'react-router-dom'
import { IconInbox } from '@tabler/icons-react'
import clsx from 'clsx'
import { MY_WHITELABEL_CREDIT_HISTORY_QUERY } from '@/lib/graphql/whitelabel'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { chipErrorMessage, chipTone, signedChips, useChipFormat } from '@/modules/chips'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { Select } from '@/ui/components/Select'
import { strokeFor } from '@/ui/components/icons'
import {
  POOL_STATEMENT_DEFAULT_PAGE_SIZE,
  POOL_STATEMENT_PAGE_SIZE_OPTIONS,
  poolMovementLabel,
  poolSignedAmount,
  poolStatementHasNextPage,
  poolStatementPlayerLink,
  poolStatementRange,
  poolStatementSub,
  type WhitelabelCreditTransaction,
} from '../creditManagementModel'
import styles from '../CreditManagementPage.module.css'

const PAGE_SIZE_SELECT_OPTIONS = POOL_STATEMENT_PAGE_SIZE_OPTIONS.map((size) => ({
  value: String(size),
  label: String(size),
}))

interface PagerProps {
  page: number
  pageSize: number
  rowCount: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

/* The pool's ledger answers one page and no total, so the pager says what is on screen and whether the
   lookahead row found more: "Showing a–b (more available)", Previous / Page N / Next. */
function Pager({ page, pageSize, rowCount, onPageChange, onPageSizeChange }: PagerProps) {
  const { range, more } = poolStatementRange(page, pageSize, rowCount)
  return (
    <nav className={styles.pager} aria-label="Pool statement pages">
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
          <Button size="sm" disabled={!poolStatementHasNextPage(rowCount, pageSize)} onClick={() => onPageChange(page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </nav>
  )
}

export interface PoolStatementPanelProps {
  /** The pool's currency, for the figures. */
  currency?: string | null
  /** Bumped by the page's Refresh: the statement asks again. */
  refreshKey?: number
}

/**
 * The whitelabel pool's statement: every movement of its free chips, newest first. Chips deposited to a root
 * account leave the pool, chips withdrawn from one come back, and the super admin's top-ups and corrections
 * are here too. The running figure is the pool's available chips after each movement.
 */
export function PoolStatementPanel({ currency, refreshKey = 0 }: PoolStatementPanelProps) {
  const format = useChipFormat(currency)
  const { formatDateTime } = useFormatDate()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(POOL_STATEMENT_DEFAULT_PAGE_SIZE)

  const { data, loading, error, refetch } = useQuery<{ myWhitelabelCreditHistory?: WhitelabelCreditTransaction[] | null }>(
    MY_WHITELABEL_CREDIT_HISTORY_QUERY,
    {
      variables: { limit: pageSize + 1, offset: (page - 1) * pageSize },
      // The pool changes with every root deposit or withdrawal; a cached page would be out of date.
      fetchPolicy: 'network-only',
      errorPolicy: 'all',
    },
  )
  // Only a later bump asks again: the first render's key is already answered by the mount's own request.
  const answeredKey = useRef(refreshKey)
  useEffect(() => {
    if (answeredKey.current === refreshKey) return
    answeredKey.current = refreshKey
    void refetch()
  }, [refreshKey, refetch])

  const transactions = useMemo(() => data?.myWhitelabelCreditHistory ?? [], [data])
  const rowCount = transactions.length
  // A page that came back empty (the rows moved on) goes back to the first page.
  useEffect(() => {
    if (!loading && !error && rowCount === 0 && page > 1) setPage(1)
  }, [loading, error, rowCount, page])
  const waiting = loading && rowCount === 0

  const columns = useMemo<DataTableColumn<WhitelabelCreditTransaction>[]>(() => [
    {
      key: 'createdAt',
      header: 'Date',
      cell: (row) => (
        <time className={styles.dateCell} dateTime={row.createdAt}>
          {formatDateTime(row.createdAt)}
        </time>
      ),
    },
    {
      key: 'movement',
      header: 'Movement',
      cell: (row) => poolMovementLabel(row.transactionType),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (row) => {
        const signed = poolSignedAmount(row)
        const tone = chipTone(signed)
        return <span className={clsx(styles.amount, tone && styles[tone])}>{signedChips(signed, format)}</span>
      },
    },
    {
      key: 'available',
      header: 'Pool available',
      align: 'right',
      cell: (row) => (
        <span className={styles.stackEnd}>
          <span className={styles.amount}>{format(row.balanceAfter)}</span>
          <span className={styles.sub}>{`from ${format(row.balanceBefore)}`}</span>
        </span>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      cell: (row) => {
        const player = poolStatementPlayerLink(row)
        return (
          <span className={styles.stack}>
            <span className={styles.wrapCell}>{row.reason || '—'}</span>
            {player ? <Link className={styles.playerLink} to={player.to}>{player.label}</Link> : null}
          </span>
        )
      },
    },
    {
      key: 'createdBy',
      header: 'By',
      emphasis: 'dim',
      cell: (row) => row.createdBy || 'System',
    },
  ], [format, formatDateTime])

  return (
    <Card
      title="Pool statement"
      sub={waiting || (error && rowCount === 0) ? 'Chips in and out of the whitelabel pool' : poolStatementSub(page, pageSize, rowCount)}
      body="table"
    >
      <DataTable
        label="Pool statement"
        columns={columns}
        rows={transactions.slice(0, pageSize)}
        rowKey={(row) => row.id}
        width="wide"
        state={error && rowCount === 0 ? 'error' : loading ? 'loading' : 'ready'}
        error={chipErrorMessage(error, 'The pool statement could not be loaded.')}
        onRetry={() => void refetch()}
        empty={(
          <EmptyState
            title="No pool movements yet"
            description="Deposits to and withdrawals from root accounts appear here."
            icon={<IconInbox size={20} stroke={strokeFor(20)} />}
          />
        )}
      />
      {rowCount > 0 || (page > 1 && !waiting) ? (
        <Pager
          page={page}
          pageSize={pageSize}
          rowCount={rowCount}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
        />
      ) : null}
    </Card>
  )
}
