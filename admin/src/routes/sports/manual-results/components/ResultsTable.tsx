import { useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconArrowsExchange,
  IconBook,
  IconClock,
  IconFilter,
  IconInbox,
  IconRefresh,
  IconRestore,
  IconSparkles,
} from '@tabler/icons-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { isToday as isTodayIST } from '@/shared/utils/date'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useRollbackSportsResult } from '../../../../modules/sports/results'
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
import type { SportsResult } from '../../../../modules/sports/results'
import {
  COPY_RESULT_ID,
  ROLLBACK_COMPLETE,
  ROLLBACK_ERROR_TITLE,
  ROLLBACK_FAILED_TITLE,
  buildRollbackInput,
  declaredByLabel,
  isRecentDeclaration,
  marketCellLabel,
  marketTypeLabel,
  resultCountLabel,
  resultDisplay,
  resultStatus,
  resultTintKind,
  rollbackActionLabel,
  rollbackDetailLines,
  rollbackErrorMessage,
  rollbackFailureMessage,
  scopeLine,
  typeBadgeKind,
  type ResultTone,
} from '../manualResultsModel'
import styles from '../ManualResultsPage.module.css'

dayjs.extend(relativeTime)

interface ResultsTableProps {
  results: SportsResult[]
  fetching: boolean
  onRefetch: () => void
  footer?: ReactNode
  error?: string
}

const TYPE_ICON = {
  exchange: IconArrowsExchange,
  bookmaker: IconBook,
  fancy: IconSparkles,
} as const

const TYPE_TILE = {
  exchange: styles.typeTileExchange,
  bookmaker: styles.typeTileBookmaker,
  fancy: styles.typeTileFancy,
} as const

const TYPE_TAG = {
  exchange: styles.typeExchange,
  bookmaker: styles.typeBookmaker,
  fancy: styles.typeFancy,
} as const

const RESULT_TINT = {
  exchange: styles.resultExchange,
  bookmaker: styles.resultBookmaker,
  fancy: styles.resultFancy,
} as const

const STATUS_TONE: Record<ResultTone, 'ok' | 'neg'> = { ok: 'ok', neg: 'neg' }

export function ResultsTable({ results, fetching, onRefetch, footer, error }: ResultsTableProps) {
  const { formatDate, formatTime, formatDateTime } = useFormatDate()
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [selectedResult, setSelectedResult] = useState<SportsResult | null>(null)
  const [rollbackResult, { loading: rollingBack }] = useRollbackSportsResult()
  const rollbackTriggerRef = useRef<HTMLElement | null>(null)

  const openRollback = (result: SportsResult) => {
    if (typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement) {
      rollbackTriggerRef.current = document.activeElement
    }
    setSelectedResult(result)
    setRollbackOpen(true)
  }

  const confirmRollback = async (reason: string, tag?: string) => {
    if (!selectedResult) return
    try {
      const response = await rollbackResult({
        variables: { input: buildRollbackInput(selectedResult.id, reason, tag) },
        context: { uiToast: 'notification' },
      })
      if (response.data?.rollbackSportsResult?.success) {
        setRollbackOpen(false)
        setSelectedResult(null)
        onRefetch()
        toast({ title: ROLLBACK_COMPLETE.title, message: ROLLBACK_COMPLETE.message, tone: 'ok' })
      } else {
        toast({
          title: ROLLBACK_FAILED_TITLE,
          message: rollbackFailureMessage(response.data?.rollbackSportsResult?.message),
          tone: 'error',
        })
      }
    } catch (caught: unknown) {
      toast({ title: ROLLBACK_ERROR_TITLE, message: rollbackErrorMessage(caught), tone: 'error' })
    }
  }

  const now = Date.now()
  const columns: DataTableColumn<SportsResult>[] = [
    {
      key: 'scope',
      header: 'Sport/League/Event',
      cell: (result) => {
        const kind = resultTintKind(result.marketType)
        const TypeIcon = TYPE_ICON[kind]
        const scope = scopeLine(result)
        return (
          <div className={styles.scopeCell}>
            <span className={clsx(styles.typeTile, TYPE_TILE[kind])} aria-hidden="true">
              <TypeIcon size={14} stroke={strokeFor(14)} />
            </span>
            <div className={styles.scopeText}>
              <div className={styles.rowInline}>
                <span className={styles.scopeLine} title={scope}>{scope}</span>
                <span className={styles.copySlot}>
                  <CopyButton
                    size="sm"
                    value={result.id}
                    label={COPY_RESULT_ID.label}
                    copiedLabel={COPY_RESULT_ID.copiedLabel}
                    errorLabel={COPY_RESULT_ID.errorLabel}
                  />
                </span>
              </div>
              {isTodayIST(new Date(result.declaredAt)) ? <span className={clsx(styles.flag, styles.todayTag)}>Today</span> : null}
            </div>
          </div>
        )
      },
    },
    {
      key: 'market',
      header: 'Market',
      cell: (result) => <span className={styles.marketName}>{marketCellLabel(result)}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      cell: (result) => {
        const kind = typeBadgeKind(result.marketType)
        return (
          <div className={styles.rowInline}>
            <span className={clsx(styles.typeTag, TYPE_TAG[kind])}>{marketTypeLabel(result.marketType)}</span>
            {result.isGlobal ? <span className={clsx(styles.flag, styles.globalTag)}>Global</span> : null}
          </div>
        )
      },
    },
    {
      key: 'result',
      header: 'Result',
      cell: (result) => {
        const kind = resultTintKind(result.marketType)
        return (
          <div className={styles.resultCell}>
            <span className={clsx(styles.resultValue, RESULT_TINT[kind])}>{resultDisplay(result)}</span>
            {result.rolledBackAt ? <span className={styles.rbTag} title="Rolled Back">RB</span> : null}
          </div>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (result) => {
        const status = resultStatus(result)
        return <StatusPill tone={STATUS_TONE[status.tone]}>{status.label}</StatusPill>
      },
    },
    {
      key: 'declaredBy',
      header: 'Declared By',
      cell: (result) => (
        <div className={styles.stack}>
          <span className={styles.primaryLine}>{declaredByLabel(result)}</span>
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
      key: 'rollbackInfo',
      header: 'Rollback Info',
      cell: (result) => {
        if (!result.rolledBackAt) return '—'
        const detailLines = rollbackDetailLines(
          result,
          formatDateTime(result.rolledBackAt, 'MMM d, yyyy h:mm a'),
        )
        return (
          <Tooltip
            content={(
              <span className={styles.tooltipDetails}>
                {detailLines.map((line) => (
                  <span className={styles.tooltipLine} key={line.key}>
                    <strong>{line.label}</strong><span>{line.value}</span>
                  </span>
                ))}
              </span>
            )}
          >
            <span className={styles.stack} tabIndex={0}>
              <span className={styles.rollbackInfo}>{dayjs(result.rolledBackAt).fromNow()}</span>
              {result.rollbackTag ? <span className={styles.rollbackTag}>{result.rollbackTag}</span> : null}
            </span>
          </Tooltip>
        )
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sticky: 'end',
      cell: (result) => !result.rolledBackAt ? (
        <Tooltip content="Rollback Result">
          <IconButton
            size="sm"
            className={styles.rollbackButton}
            label={rollbackActionLabel(result)}
            icon={<IconRestore size={15} stroke={strokeFor(15)} />}
            onClick={() => openRollback(result)}
          />
        </Tooltip>
      ) : null,
    },
  ]

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
        label="Sports results"
        state={fetching ? 'loading' : error ? 'error' : 'ready'}
        error={error}
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
        open={rollbackOpen}
        onClose={() => {
          setRollbackOpen(false)
          setSelectedResult(null)
        }}
        onConfirm={confirmRollback}
        result={selectedResult}
        busy={rollingBack}
        restoreFocusTo={rollbackTriggerRef}
      />
    </Card>
  )
}
