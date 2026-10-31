import { useMemo } from 'react'
import { IconArrowsExchange, IconInbox, IconReceipt } from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Divider } from '@/ui/components/Divider'
import { EmptyState } from '@/ui/components/EmptyState'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Notice } from '@/ui/components/Notice'
import { Skeleton } from '@/ui/components/Skeleton'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  isSettlementToAgent,
  pageSummary,
  settlementDirectionLabel,
  transactionAmountTone,
  type AgentCreditTransaction,
  type AgentSettlement,
  type AgentSettlementSummary,
} from '../agentCreditManagementModel'
import styles from '../CreditManagementPage.module.css'
import { ServerPageControls } from './AgentCreditHistoryPanel'

export function AgentCreditSettlementsPanel({ settlements, loading, page, pageSize, onPageChange }: {
  settlements?: AgentSettlementSummary | null
  loading: boolean
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()

  const settlementColumns = useMemo<DataTableColumn<AgentSettlement>[]>(() => [
    { key: 'createdAt', header: 'Date', cell: (row) => <time className={styles.dateCell} dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time> },
    { key: 'settlementType', header: 'Type', cell: (row) => <StatusPill tone="neutral">{row.settlementType}</StatusPill> },
    { key: 'direction', header: 'Direction', cell: (row) => <StatusPill tone={isSettlementToAgent(row.direction) ? 'ok' : 'neg'}>{settlementDirectionLabel(row.direction)}</StatusPill> },
    {
      key: 'amount', header: 'Amount', align: 'right', cell: (row) => {
        const positive = isSettlementToAgent(row.direction)
        return <span className={clsx(styles.amount, positive ? styles.positive : styles.negative)}>{positive ? '+' : '-'}{formatAmount(row.amount)}</span>
      },
    },
    { key: 'settledBy', header: 'By', cell: (row) => row.settledBy || 'System' },
    { key: 'notes', header: 'Notes', emphasis: 'dim', cell: (row) => <span className={styles.wrapCell}>{row.notes || '—'}</span> },
  ], [formatAmount, formatDateTime])

  const transactionColumns = useMemo<DataTableColumn<AgentCreditTransaction>[]>(() => [
    { key: 'createdAt', header: 'Date', cell: (row) => <time className={styles.dateCell} dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time> },
    { key: 'transactionType', header: 'Type', cell: (row) => <StatusPill tone="warn">{row.transactionType}</StatusPill> },
    {
      key: 'amount', header: 'Amount', align: 'right', cell: (row) => {
        const positive = transactionAmountTone(row.amount) === 'positive'
        return <span className={clsx(styles.amount, positive ? styles.positive : styles.negative)}>{positive ? '+' : ''}{formatAmount(row.amount)}</span>
      },
    },
    { key: 'balanceBefore', header: 'Before', align: 'right', emphasis: 'dim', cell: (row) => formatAmount(row.balanceBefore) },
    { key: 'balanceAfter', header: 'After', align: 'right', emphasis: 'key', cell: (row) => formatAmount(row.balanceAfter) },
    { key: 'createdBy', header: 'By', cell: (row) => row.createdBy || 'System' },
    { key: 'reason', header: 'Reason', emphasis: 'dim', cell: (row) => <span className={styles.wrapCell}>{row.reason || '—'}</span> },
  ], [formatAmount, formatDateTime])

  // Until the first answer the totals keep their height with placeholders and each list shows its own loading row.
  const pending = loading && !settlements
  if (!pending && !settlements) return <Notice tone="error" title="Unable to load settlement information" />

  const settlementCount = settlements?.agentSettlements.length ?? 0
  const transactionCount = settlements?.creditTransactions.length ?? 0
  const rowsOnPage = Math.max(settlementCount, transactionCount)

  return (
    <>
      <Grid cols={{ base: 1, md: 2 }} gap={12} aria-label="Agent settlement totals" aria-busy={pending || undefined}>
        <Stat label="Agent Settlements" value={formatAmount(settlements?.totalAgentSettled ?? 0)} note={`${settlementCount} transactions`} icon={<IconArrowsExchange size={18} stroke={strokeFor(18)} />} hue="blu" loading={pending} />
        <Stat label="Credit Transactions" value={formatAmount(settlements?.totalCreditTransactions ?? 0)} note={`${transactionCount} transactions`} icon={<IconReceipt size={18} stroke={strokeFor(18)} />} hue="amb" loading={pending} />
      </Grid>

      <Card title="Agent Settlements" sub={pending ? <Skeleton width={64} height={10} /> : pageSummary(page, pageSize, settlementCount)} body="table">
        <DataTable label="Agent settlements" columns={settlementColumns} rows={settlements?.agentSettlements ?? []} rowKey={(row) => row.id} width="wide" state={pending ? 'loading' : 'ready'} empty={<EmptyState title="No agent settlements" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />} />
      </Card>
      <Divider />
      <Card title="Credit Transactions" sub={pending ? <Skeleton width={64} height={10} /> : pageSummary(page, pageSize, transactionCount)} body="table">
        <DataTable label="Settlement credit transactions" columns={transactionColumns} rows={settlements?.creditTransactions ?? []} rowKey={(row) => row.id} width="wide" state={pending ? 'loading' : 'ready'} empty={<EmptyState title="No credit transactions" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />} />
        {pending ? null : <ServerPageControls page={page} pageSize={pageSize} rowCount={rowsOnPage} onPageChange={onPageChange} label="Settlement history pagination" />}
      </Card>
    </>
  )
}
