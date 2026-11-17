import { useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconClock,
  IconCoin,
  IconFilter,
  IconInbox,
  IconMoon,
  IconRefresh,
  IconSun,
} from '@tabler/icons-react'
import dayjs from 'dayjs'
import { isToday as isTodayIST } from '@/shared/utils/date'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useRollbackMatkaResult } from '../../../../modules/matka/results'
import { useMatkas } from '../../../../modules/matka'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { CopyButton } from '@/ui/components/CopyButton'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { RollbackModal } from './RollbackModal'
import {
  buildRollbackInput,
  isRecentDeclaration,
  matkaNameFor,
  matkaOptionsFrom,
  matkaResultStatus,
  matkaResultTypeLabel,
  pendingBetsCountLabel,
  pendingBetsSettlementHint,
  pendingBetsWaitingHint,
  resultCountLabel,
  rollbackActionLabel,
} from '../matkaResultsModel'
import type { MatkaResultFilters, MatkaResult } from '../../../../modules/matka/results'
import styles from '../MatkaResultsPage.module.css'

dayjs.extend(relativeTime)

interface ResultsTableProps {
  results: MatkaResult[]
  fetching: boolean
  filters: MatkaResultFilters
  onFiltersChange: (filters: MatkaResultFilters) => void
  onRefetch: () => void
  footer?: ReactNode
  /** The list failed and left nothing to show: the table says so, with Retry (onRefetch). */
  error?: string
}

/** A pending-bets count whose hint the legacy tooltip carried; the hint is now in the text itself. */
function PendingFlag({ count, hint }: { count: number; hint: string }) {
  return (
    <span className={styles.betFlag} title={hint}>
      <IconAlertTriangle size={12} stroke={strokeFor(12)} aria-hidden="true" />
      <span aria-hidden="true">{count}</span>
      <span className={styles.srOnly}>{hint}</span>
    </span>
  )
}

export function ResultsTable({ results, fetching, onRefetch, footer, error }: ResultsTableProps) {
  const { formatDate, formatTime } = useFormatDate()
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false)
  const [selectedResult, setSelectedResult] = useState<MatkaResult | null>(null)
  const [rollbackResult, { loading: rollingBack }] = useRollbackMatkaResult()
  const { data: matkasData } = useMatkas({ page: 1, limit: 1000 })
  const rollbackTriggerRef = useRef<HTMLElement | null>(null)

  const matkas = useMemo(() => matkaOptionsFrom(matkasData?.matkas?.items), [matkasData])

  const handleRollback = (result: MatkaResult) => {
    if (typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement) {
      rollbackTriggerRef.current = document.activeElement
    }
    setSelectedResult(result)
    setRollbackModalOpen(true)
  }

  const handleRollbackConfirm = async (reason: string, tag?: string) => {
    if (!selectedResult) return

    try {
      const result = await rollbackResult({
        variables: {
          input: buildRollbackInput(selectedResult.id, reason, tag),
        },
        context: { uiToast: 'notification' },
      })

      if (result.data?.rollbackMatkaResult?.success) {
        setRollbackModalOpen(false)
        setSelectedResult(null)
        onRefetch()
      }
    } catch {
      // Error notifications are shown by the Apollo notification link, as before; the dialog stays open.
    }
  }

  // Built on every render, as the legacy rows were, so "declared within the last hour" stays current.
  const columns = buildColumns(Date.now())

  function buildColumns(now: number): DataTableColumn<MatkaResult>[] {
    return [
      {
        key: 'market',
        header: 'Market',
        cell: (result) => {
          const matkaName = matkaNameFor(result, matkas)
          const isToday = isTodayIST(result.date)
          const pendingBets = result.pendingBetsCount || 0
          const hasBets = pendingBets > 0
          const open = result.type === 'open'
          return (
            <div className={styles.marketCell}>
              <span className={clsx(styles.typeTile, open ? styles.typeTileOpen : styles.typeTileClose)} aria-hidden="true">
                {open ? <IconSun size={14} stroke={strokeFor(14)} /> : <IconMoon size={14} stroke={strokeFor(14)} />}
              </span>
              <div className={styles.marketText}>
                <div className={styles.marketLine}>
                  <span className={styles.marketName} title={matkaName}>{matkaName}</span>
                  {hasBets ? <PendingFlag count={pendingBets} hint={pendingBetsWaitingHint(pendingBets)} /> : null}
                  <span className={styles.copySlot}>
                    <CopyButton
                      size="sm"
                      value={result.matkaId}
                      label="Copy Matka ID"
                      copiedLabel="Matka ID copied to clipboard"
                      errorLabel="Failed to copy to clipboard"
                    />
                  </span>
                </div>
                <div className={styles.marketMeta}>
                  <span>{isToday ? 'Today' : result.date ? formatDate(result.date, 'MMM d') : '—'}</span>
                  {isToday ? <span className={styles.todayTag}>Today</span> : null}
                  {hasBets ? (
                    <span className={styles.betsTag}>
                      <IconCoin size={11} stroke={strokeFor(11)} aria-hidden="true" />
                      {pendingBetsCountLabel(pendingBets)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          )
        },
      },
      {
        key: 'date',
        header: 'Date',
        cell: (result) => (
          <span className={styles.dateChip}>
            <span className={styles.dateValue}>{result.date}</span>
            <span className={styles.dateDay}>{result.date ? formatDate(result.date, 'EEE') : '—'}</span>
          </span>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        cell: (result) => (
          <span className={clsx(styles.typeTag, result.type === 'open' ? styles.typeTagOpen : styles.typeTagClose)}>
            <span className={styles.typeDot} aria-hidden="true" />
            {matkaResultTypeLabel(result.type)}
          </span>
        ),
      },
      {
        key: 'result',
        header: 'Result',
        cell: (result) => {
          const pendingBets = result.pendingBetsCount || 0
          return (
            <div className={styles.resultCell}>
              <span className={clsx(styles.resultValue, result.type === 'open' && styles.resultOpen)}>
                {result.result}
              </span>
              {result.rolledBackAt ? <span className={styles.rbTag} title="Rolled Back">RB</span> : null}
              {pendingBets > 0 && !result.rolledBackAt ? (
                <PendingFlag count={pendingBets} hint={pendingBetsSettlementHint(pendingBets)} />
              ) : null}
            </div>
          )
        },
      },
      {
        key: 'status',
        header: 'Status',
        cell: (result) => {
          const status = matkaResultStatus(result)
          return <StatusPill tone={status.tone}>{status.label}</StatusPill>
        },
      },
      {
        key: 'declaredBy',
        header: 'Declared By',
        cell: (result) => (
          <div className={styles.stack}>
            <span className={styles.primaryLine}>{result.declaredByName || result.declaredBy}</span>
            <span className={styles.secondary}>
              <IconClock size={11} stroke={strokeFor(11)} aria-hidden="true" />
              {dayjs(result.declaredAt).fromNow()}
            </span>
          </div>
        ),
      },
      {
        key: 'declaredAt',
        header: 'Declared At',
        cell: (result) => (
          <div className={styles.stack}>
            <span className={styles.primaryLine}>
              {result.declaredAt ? formatDate(result.declaredAt, 'MMM d, yyyy') : '—'}
            </span>
            <span className={styles.secondary}>
              {result.declaredAt ? formatTime(result.declaredAt, 'h:mm a') : '—'}
              {isRecentDeclaration(result.declaredAt, now) && !result.rolledBackAt ? (
                <span className={styles.recentDot} role="img" aria-label="Declared within the last hour" />
              ) : null}
            </span>
          </div>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        sticky: 'end',
        cell: (result) =>
          !result.rolledBackAt ? (
            <Tooltip content="Rollback Result">
              <IconButton
                size="sm"
                className={styles.rollbackButton}
                label={rollbackActionLabel(result, matkaNameFor(result, matkas))}
                icon={<IconArrowBackUp size={15} stroke={strokeFor(15)} />}
                onClick={() => handleRollback(result)}
              />
            </Tooltip>
          ) : null,
      },
    ]
  }

  return (
    <Card
      title="Results"
      sub={resultCountLabel(fetching, results.length)}
      body="table"
      tools={(
        <Tooltip content="Refresh">
          <IconButton
            variant="bordered"
            label="Refresh"
            icon={fetching ? <Spinner size="sm" decorative /> : <IconRefresh size={16} stroke={strokeFor(16)} />}
            aria-disabled={fetching || undefined}
            aria-busy={fetching || undefined}
            onClick={() => onRefetch()}
          />
        </Tooltip>
      )}
    >
      <DataTable
        columns={columns}
        rows={results}
        rowKey={(result) => result.id}
        label="Matka results"
        state={fetching ? 'loading' : error ? 'error' : 'ready'}
        error={error}
        // Called bare: a click event passed to Apollo's refetch would be merged into the variables.
        onRetry={() => onRefetch()}
        width="wide"
        empty={(
          <EmptyState
            title="No results found"
            description="Adjust your filters to see results"
            icon={<IconInbox size={20} stroke={strokeFor(20)} />}
            action={(
              <Button
                variant="primary"
                size="sm"
                icon={<IconFilter size={15} stroke={strokeFor(15)} />}
                // The legacy button only raised this notice (notify.info: title Info, 4.5 s).
                onClick={() => toast({ title: 'Info', message: 'Adjust filters', tone: 'info', duration: 4500 })}
              >
                Adjust Filters
              </Button>
            )}
          />
        )}
      />
      {footer}

      <RollbackModal
        open={rollbackModalOpen}
        onClose={() => {
          setRollbackModalOpen(false)
          setSelectedResult(null)
        }}
        onConfirm={handleRollbackConfirm}
        result={selectedResult}
        marketName={selectedResult ? matkaNameFor(selectedResult, matkas) : undefined}
        busy={rollingBack}
        restoreFocusTo={rollbackTriggerRef}
      />
    </Card>
  )
}
