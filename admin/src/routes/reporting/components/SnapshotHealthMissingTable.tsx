import { useState, type FormEvent } from 'react'
import { IconBolt, IconCircleCheck } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { confirm } from '@/ui/components/confirm'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DateField } from '@/ui/components/DateField'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form, FormField } from '@/ui/components/Form'
import { strokeFor } from '@/ui/components/icons'
import {
  BACKFILL_RANGE_REQUIRED,
  TABLE_PAGE_SIZE,
  TABLE_PAGE_SIZE_OPTIONS,
  backfillRefusalMessage,
  backfillTargetText,
  fixActionLabel,
  gapsSummary,
  pageRows,
  resolveBackfillRange,
  snapshotRowKey,
  type BackfillRangeDraft,
  type MissingRow,
} from '../snapshotHealthModel'
import styles from '../SnapshotHealthPage.module.css'

export type { MissingRow } from '../snapshotHealthModel'

const EMPTY_RANGE: BackfillRangeDraft = { from: '', to: '' }

export function SnapshotHealthMissingTable({
  rows,
  loading,
  error,
  onRetry,
  canTrigger,
  mutating,
  onEnqueueDay,
  onEnqueueRange,
}: {
  rows: MissingRow[]
  loading: boolean
  /** The gaps query's failure message, when it failed. */
  error?: string | null
  onRetry?: () => void
  canTrigger: boolean
  mutating: boolean
  onEnqueueDay: (row: MissingRow) => Promise<void>
  onEnqueueRange: (p: {
    tenant: string
    whitelabelId: string
    currency: string
    dateFrom: string
    dateTo: string
  }) => Promise<void>
}) {
  const [range, setRange] = useState<BackfillRangeDraft>(EMPTY_RANGE)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(TABLE_PAGE_SIZE)

  const resetRange = () => {
    setRange(EMPTY_RANGE)
    setRangeError(null)
  }

  // A shown "Pick a range" clears as soon as both days are there, as antd re-validated on change.
  const changeRange = (next: BackfillRangeDraft) => {
    setRange(next)
    if (rangeError) setRangeError(resolveBackfillRange(next) ? null : BACKFILL_RANGE_REQUIRED)
  }

  const first = rows[0]

  const submitRange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!first || mutating) return
    const resolved = resolveBackfillRange(range)
    if (!resolved) {
      setRangeError(BACKFILL_RANGE_REQUIRED)
      return
    }
    setRangeError(null)
    try {
      await onEnqueueRange({
        tenant: first.tenant,
        whitelabelId: first.whitelabelId,
        currency: first.currency,
        dateFrom: resolved.dateFrom,
        dateTo: resolved.dateTo,
      })
      resetRange()
    } catch (refusal) {
      // The error link raises no toast for a mutation, so the server's reason (e.g. "Range too large
      // (max 31 days)") is the field's error; the range stays for a retry (F-REP-11: nothing was shown).
      setRangeError(backfillRefusalMessage(refusal))
    }
  }

  // The legacy Popconfirm copy, now the modal confirmation (D5).
  const fixDay = (row: MissingRow) => {
    void confirm({
      title: 'Generate snapshot for this reporting day?',
      description: 'Runs immediately. May take a few seconds.',
      confirmLabel: 'Fix',
      cancelLabel: 'Cancel',
      onConfirm: () => onEnqueueDay(row),
    })
  }

  const columns: DataTableColumn<MissingRow>[] = [
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
          onClick={() => fixDay(row)}
        >
          Fix
        </Button>
      ),
    },
  ]

  return (
    <Card
      title="Missing snapshot days"
      sub="Days in each tenant timezone with no global rollup row (same definition as the health backfill job)."
      body="table"
    >
      {first && canTrigger ? (
        <div className={styles.backfill}>
          <Form aria-label="Backfill range" onSubmit={(event) => void submitRange(event)}>
            <FormField
              label="Date range"
              required
              help={backfillTargetText(first)}
              error={rangeError ?? undefined}
            >
              <div className={styles.rangeRow}>
                <div className={styles.rangeInputs}>
                  <DateField
                    label="Start date"
                    hideLabel
                    size="sm"
                    value={range.from}
                    onChange={(from) => changeRange({ ...range, from })}
                  />
                  <DateField
                    label="End date"
                    hideLabel
                    size="sm"
                    value={range.to}
                    onChange={(to) => changeRange({ ...range, to })}
                  />
                </div>
                <div className={styles.backfillActions}>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={mutating}
                    icon={<IconBolt size={15} stroke={strokeFor(15)} />}
                  >
                    Backfill range
                  </Button>
                  <Button size="sm" onClick={resetRange}>Reset</Button>
                </div>
              </div>
            </FormField>
          </Form>
        </div>
      ) : null}
      <DataTable
        label="Missing snapshot days"
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
            title="No gaps in the selected lookback window"
          />
        )}
        pagination={rows.length > 0
          ? {
              current: page,
              pageSize,
              total: rows.length,
              onChange: setPage,
              onPageSizeChange: setPageSize,
              itemName: 'gaps',
              pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
              formatSummary: ({ total }) => gapsSummary(total),
              variant: 'embedded',
            }
          : false}
      />
    </Card>
  )
}
