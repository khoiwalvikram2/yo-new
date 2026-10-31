import { useMemo } from 'react'
import { IconAlertCircle, IconBuilding, IconInbox, IconUsers } from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Divider } from '@/ui/components/Divider'
import { EmptyState } from '@/ui/components/EmptyState'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Notice } from '@/ui/components/Notice'
import type { PaginationProps } from '@/ui/components/Pagination'
import { Skeleton } from '@/ui/components/Skeleton'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  CREDIT_PAGE_SIZE_OPTIONS,
  isToAgent,
  recordCountLabel,
  schemeTone,
  settlementAgentLabel,
  settlementDirectionLabel,
  whitelabelSettlementSign,
  type AgentSettlement,
  type WhitelabelCreditTransaction,
  type WhitelabelSettlementSummary,
} from '../creditManagementModel'
import styles from '../CreditManagementPage.module.css'

export interface CreditSettlementsPanelProps {
  settlements: WhitelabelSettlementSummary | null | undefined
  loading: boolean
  whitelabelPage?: number
  onWhitelabelPageChange?: (page: number) => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

/** The Settlements tab: the two settled totals and the agent and whitelabel settlement lists. */
export function CreditSettlementsPanel({
  settlements,
  loading,
  page,
  pageSize,
  whitelabelPage = page,
  onPageChange,
  onWhitelabelPageChange = onPageChange,
  onPageSizeChange,
}: CreditSettlementsPanelProps) {
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()

  // Each list is already paged by the server and owns an independent offset.
  const agentRows = settlements?.agentSettlements ?? []
  const whitelabelRows = settlements?.whitelabelSettlements ?? []

  const agentColumns = useMemo<DataTableColumn<AgentSettlement>[]>(() => [
    {
      key: 'createdAt',
      header: 'Date',
      cell: (settlement) => (
        <time className={styles.dateCell} dateTime={settlement.createdAt}>
          {formatDateTime(settlement.createdAt)}
        </time>
      ),
    },
    {
      key: 'agent',
      header: 'Agent',
      emphasis: 'key',
      cell: (settlement) => settlementAgentLabel(settlement),
    },
    {
      key: 'scheme',
      header: 'Scheme',
      cell: (settlement) => (settlement.agent?.schemeType ? (
        <StatusPill tone={schemeTone(settlement.agent.schemeType)}>{settlement.agent.schemeType}</StatusPill>
      ) : null),
    },
    {
      key: 'settlementType',
      header: 'Type',
      cell: (settlement) => <StatusPill tone="neutral">{settlement.settlementType}</StatusPill>,
    },
    {
      key: 'direction',
      header: 'Direction',
      cell: (settlement) => (
        <StatusPill tone={isToAgent(settlement.direction) ? 'ok' : 'neg'}>
          {settlementDirectionLabel(settlement.direction)}
        </StatusPill>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (settlement) => (
        <span className={clsx(styles.amount, isToAgent(settlement.direction) ? styles.positive : styles.negative)}>
          {isToAgent(settlement.direction) ? '+' : '-'}{formatAmount(settlement.amount)}
        </span>
      ),
    },
    {
      key: 'settledBy',
      header: 'Settled By',
      cell: (settlement) => settlement.settledBy || 'System',
    },
    {
      key: 'notes',
      header: 'Notes',
      emphasis: 'dim',
      cell: (settlement) => <span className={styles.wrapCell}>{settlement.notes || '—'}</span>,
    },
  ], [formatAmount, formatDateTime])

  const whitelabelColumns = useMemo<DataTableColumn<WhitelabelCreditTransaction>[]>(() => [
    {
      key: 'createdAt',
      header: 'Date',
      cell: (settlement) => (
        <time className={styles.dateCell} dateTime={settlement.createdAt}>
          {formatDateTime(settlement.createdAt)}
        </time>
      ),
    },
    {
      key: 'transactionType',
      header: 'Type',
      cell: (settlement) => <StatusPill tone="warn">{settlement.transactionType}</StatusPill>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (settlement) => (
        <span className={clsx(styles.amount, settlement.amount >= 0 ? styles.positive : styles.negative)}>
          {whitelabelSettlementSign(settlement.amount)}{formatAmount(settlement.amount)}
        </span>
      ),
    },
    {
      key: 'balanceBefore',
      header: 'Before',
      align: 'right',
      emphasis: 'dim',
      cell: (settlement) => formatAmount(settlement.balanceBefore),
    },
    {
      key: 'balanceAfter',
      header: 'After',
      align: 'right',
      emphasis: 'key',
      cell: (settlement) => formatAmount(settlement.balanceAfter),
    },
    {
      key: 'createdBy',
      header: 'By',
      cell: (settlement) => settlement.createdBy || 'System',
    },
    {
      key: 'reason',
      header: 'Reason',
      emphasis: 'dim',
      cell: (settlement) => <span className={styles.wrapCell}>{settlement.reason || '—'}</span>,
    },
  ], [formatAmount, formatDateTime])

  // Until the first answer the totals keep their height with placeholders and each list shows its own loading row.
  const pending = loading && !settlements

  if (!pending && !settlements) {
    return <Notice tone="error" icon={<IconAlertCircle size={18} stroke={strokeFor(18)} />} title="Unable to load settlement information" />
  }

  const agentCount = settlements?.agentCount ?? settlements?.agentSettlements.length ?? 0
  const whitelabelCount = settlements?.whitelabelCount ?? settlements?.whitelabelSettlements.length ?? 0

  /* Each source keeps its own page and full server count. */
  const pagination = (total: number, current = page, change = onPageChange): PaginationProps | false => (total > 0
    ? {
        current,
        pageSize,
        total,
        onChange: change,
        onPageSizeChange,
        itemName: 'records',
        pageSizeOptions: CREDIT_PAGE_SIZE_OPTIONS,
        variant: 'embedded',
      }
    : false)

  return (
    <>
      <Grid cols={{ base: 1, md: 2 }} gap={12} aria-label="Settlement totals" aria-busy={pending || undefined}>
        <Stat
          label="Agent Settlements"
          value={formatAmount(settlements?.totalAgentSettled ?? 0)}
          note={`${agentCount} transactions`}
          icon={<IconUsers size={18} stroke={strokeFor(18)} />}
          hue="blu"
          loading={pending}
        />
        <Stat
          label="Whitelabel Settlements"
          value={formatAmount(settlements?.totalWhitelabelSettled ?? 0)}
          note={`${whitelabelCount} transactions`}
          icon={<IconBuilding size={18} stroke={strokeFor(18)} />}
          hue="amb"
          loading={pending}
        />
      </Grid>

      <Card title="Agent Settlements" sub={pending ? <Skeleton width={64} height={10} /> : recordCountLabel(agentCount)} body="table">
        <DataTable
          label="Agent settlements"
          columns={agentColumns}
          rows={agentRows}
          rowKey={(settlement) => settlement.id}
          width="wide"
          state={pending ? 'loading' : 'ready'}
          empty={(
            <EmptyState title="No agent settlements" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />
          )}
          pagination={pagination(agentCount)}
        />
      </Card>

      <Divider />

      <Card title="Whitelabel Settlements" sub={pending ? <Skeleton width={64} height={10} /> : recordCountLabel(whitelabelCount)} body="table">
        <DataTable
          label="Whitelabel settlements"
          columns={whitelabelColumns}
          rows={whitelabelRows}
          rowKey={(settlement) => settlement.id}
          width="wide"
          state={pending ? 'loading' : 'ready'}
          empty={(
            <EmptyState title="No whitelabel settlements" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />
          )}
          pagination={pagination(whitelabelCount, whitelabelPage, onWhitelabelPageChange)}
        />
      </Card>
    </>
  )
}
