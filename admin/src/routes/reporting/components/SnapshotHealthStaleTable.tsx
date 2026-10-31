import { useState } from 'react'
import { IconBolt, IconCircleCheck } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { confirm } from '@/ui/components/confirm'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { strokeFor } from '@/ui/components/icons'
import {
  TABLE_PAGE_SIZE,
  TABLE_PAGE_SIZE_OPTIONS,
  fixActionLabel,
  formatSnapshotInstant,
  pageRows,
  regenerateAllTitle,
  snapshotRowKey,
  staleSummary,
  type StaleSnapshotRow,
} from '../snapshotHealthModel'
import styles from '../SnapshotHealthPage.module.css'

export type { StaleSnapshotRow } from '../snapshotHealthModel'

export function SnapshotHealthStaleTable({
  rows,
  loading,
  error,
  onRetry,
  canTrigger,
  mutating,
  onRegenerate,
  onRegenerateAll,
}: {
  rows: StaleSnapshotRow[]
  loading: boolean
  /** The stale-days query's failure message; rows it still returned stay on screen. */
  error?: string | null
  onRetry?: () => void
  canTrigger: boolean
  mutating: boolean
  onRegenerate: (row: StaleSnapshotRow) => Promise<void>
  onRegenerateAll: () => Promise<void>
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(TABLE_PAGE_SIZE)

  // The legacy Popconfirm copy, now the modal confirmation (D5).
  const regenerateDay = (row: StaleSnapshotRow) => {
    void confirm({
      title: 'Regenerate sports snapshot for this day?',
      description:
        'Deletes sports + global rows for this reporting day and rebuilds the full global snapshot (may take a few seconds).',
      confirmLabel: 'Regenerate',
      cancelLabel: 'Cancel',
      onConfirm: () => onRegenerate(row),
    })
  }

  const regenerateAll = () => {
    void confirm({
      title: regenerateAllTitle(rows.length),
      description: 'Runs sequentially. Each day deletes sports + global snapshot rows and rebuilds.',
      confirmLabel: 'Fix all',
      cancelLabel: 'Cancel',
      onConfirm: () => onRegenerateAll(),
    })
  }

  const columns: DataTableColumn<StaleSnapshotRow>[] = [
    {
      key: 'tenant',
      header: 'Tenant',
      emphasis: 'key',
      cell: (row) => <span className={styles.truncate} title={row.tenant}>{row.tenant}</span>,
    },
    {
      key: 'whitelabelId',
      header: 'Whitelabel',
      cell: (row) => <span className={styles.truncate} title={row.whitelabelId}>{row.whitelabelId}</span>,
    },
    { key: 'currency', header: 'Currency', width: 96, cell: (row) => row.currency },
    { key: 'reportingDay', header: 'Reporting day', width: 120, cell: (row) => row.reportingDay },
    {
      key: 'timezone',
      header: 'TZ',
      cell: (row) => <span className={styles.truncate} title={row.timezone}>{row.timezone}</span>,
    },
    { key: 'staleBetCount', header: 'Stale bets', align: 'right', width: 100, cell: (row) => row.staleBetCount },
    {
      key: 'snapshotCreatedAt',
      header: 'Snapshot created',
      cell: (row) => <span className={styles.mono}>{formatSnapshotInstant(row.snapshotCreatedAt)}</span>,
    },
    {
      key: 'latestSettledAt',
      header: 'Latest settled',
      cell: (row) => <span className={styles.mono}>{formatSnapshotInstant(row.latestSettledAt)}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      sticky: 'end',
      cell: (row) => (
        <Button
          size="xs"
          icon={<IconBolt size={14} stroke={strokeFor(14)} />}
          disabled={!canTrigger || mutating}
          aria-label={fixActionLabel(row)}
          onClick={() => regenerateDay(row)}
        >
          Fix
        </Button>
      ),
    },
  ]

  return (
    <Card
      title="Stale sports snapshots"
      sub="Days where the sports aggregate snapshot was written before at least one bet on that reporting day was settled (e.g. bet created yesterday, result declared today). Today is excluded; data uses each tenant timezone."
      tools={rows.length > 0 && canTrigger ? (
        <Button
          variant="primary"
          size="sm"
          icon={<IconBolt size={15} stroke={strokeFor(15)} />}
          loading={mutating}
          onClick={regenerateAll}
        >
          Fix all
        </Button>
      ) : undefined}
      body="table"
    >
      <DataTable
        label="Stale sports snapshots"
        rows={pageRows(rows, page, pageSize)}
        rowKey={snapshotRowKey}
        columns={columns}
        width="wide"
        state={loading ? 'loading' : error ? 'error' : 'ready'}
        error={error ?? undefined}
        onRetry={onRetry}
        empty={(
          <EmptyState
            inset="none"
            tone="ok"
            icon={<IconCircleCheck size={20} stroke={strokeFor(20)} />}
            title="No stale sports snapshots in the selected lookback window"
          />
        )}
        pagination={rows.length > 0
          ? {
              current: page,
              pageSize,
              total: rows.length,
              onChange: setPage,
              onPageSizeChange: setPageSize,
              itemName: 'stale days',
              pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
              formatSummary: ({ total }) => staleSummary(total),
              variant: 'embedded',
            }
          : false}
      />
    </Card>
  )
}
