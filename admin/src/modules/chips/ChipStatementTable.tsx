import { useState } from 'react'
import { useQuery } from '@apollo/client'
import clsx from 'clsx'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import {
  CHIP_STATEMENT_QUERY,
  type ChipAccountType,
  type ChipStatementData,
  type ChipStatementRow,
  type ChipStatementVariables,
} from '@/lib/graphql/chips'
import { chipCounterparty, chipErrorMessage, chipKindLabel, chipTone, signedChips } from './chipModel'
import { CHIP_READ_OPTIONS, useChipFormat } from './chipHooks'
import styles from './Chips.module.css'

export interface ChipStatementTableProps {
  accountType: ChipAccountType
  accountId: string
  /** The account's currency, for the figures. Defaults to the display currency. */
  currency?: string | null
  /** Bounds on the movement date, when the page offers a range. */
  from?: string | null
  to?: string | null
  /** Names the table. @default 'Chip statement' */
  label?: string
  /** @default 20 */
  pageSize?: number
}

const PAGE_SIZES = [20, 50, 100] as const

/**
 * One account's chip movements, newest first (spec §7 chipStatement): the date, the kind, the signed amount
 * (chips in green, out rose), the running balance, the other side and the remark. A credit reference change
 * moves no chips, so it shows the reference before and after instead of an amount.
 */
export function ChipStatementTable({
  accountType,
  accountId,
  currency,
  from = null,
  to = null,
  label = 'Chip statement',
  pageSize: initialPageSize = 20,
}: ChipStatementTableProps) {
  const format = useChipFormat(currency)
  const { formatDateTime } = useFormatDate()
  const { isMobile } = useBreakpoint()
  const [pageSize, setPageSize] = useState(initialPageSize)
  // The page belongs to one account and range; another starts again at the first page without an extra fetch.
  const scope = `${accountType}:${accountId}:${from ?? ''}:${to ?? ''}`
  const [paging, setPaging] = useState({ scope, page: 1 })
  const page = paging.scope === scope ? paging.page : 1

  const { data, previousData, loading, error, refetch } = useQuery<ChipStatementData, ChipStatementVariables>(CHIP_STATEMENT_QUERY, {
    ...CHIP_READ_OPTIONS,
    variables: { accountType, accountId, from, to, offset: (page - 1) * pageSize, limit: pageSize },
    skip: !accountId,
  })
  // While the next page loads, the last one stays on screen under the table's busy state.
  const statement = (data ?? previousData)?.agents?.chipStatement ?? null
  const rows = statement?.rows ?? []
  const state = error && !statement ? 'error' : loading ? 'loading' : 'ready'

  const columns: DataTableColumn<ChipStatementRow>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (row) => <span className={styles.num}>{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'kind',
      header: 'Kind',
      cell: (row) => {
        const before = row.creditReferenceBefore
        const after = row.creditReferenceAfter
        const referenceChange = row.kind === 'CREDIT_REFERENCE' && before != null && after != null
        return (
          <span className={styles.stack}>
            <span>{chipKindLabel(row.kind)}</span>
            {referenceChange ? <span className={clsx(styles.sub, styles.num)}>{`${format(before)} → ${format(after)}`}</span> : null}
          </span>
        )
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (row) => {
        if (row.kind === 'CREDIT_REFERENCE') return <span className={styles.dim}>—</span>
        const tone = chipTone(row.amount)
        return <span className={clsx(styles.num, tone && styles[tone])}>{signedChips(row.amount, format)}</span>
      },
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (row) => <span className={styles.num}>{format(row.balanceAfter)}</span>,
    },
    {
      key: 'counterparty',
      header: 'Counterparty',
      hidden: isMobile,
      cell: (row) => {
        const other = chipCounterparty(row)
        if (!other.name) return <span className={styles.dim}>—</span>
        return (
          <span className={styles.stack}>
            <span>{other.name}</span>
            {other.type ? <span className={styles.sub}>{other.type}</span> : null}
          </span>
        )
      },
    },
    {
      key: 'remark',
      header: 'Remark',
      hidden: isMobile,
      cell: (row) => (row.remark ? row.remark : <span className={styles.dim}>—</span>),
    },
  ]

  return (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      state={state}
      error={chipErrorMessage(error, 'The statement could not be loaded.')}
      onRetry={() => void refetch()}
      empty={<EmptyState title="No chip movements yet" description="Deposits, withdrawals and credit reference changes appear here." />}
      pagination={{
        current: page,
        pageSize,
        total: statement?.total ?? 0,
        loading: loading && Boolean(statement),
        itemName: 'movements',
        pageSizeOptions: PAGE_SIZES,
        onChange: (next) => setPaging({ scope, page: next }),
        onPageSizeChange: (size) => {
          setPageSize(size)
          setPaging({ scope, page: 1 })
        },
      }}
    />
  )
}
