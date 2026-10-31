import { useMemo, useState } from 'react'
import { IconBolt, IconCalendarX, IconClock, IconEye, IconTrophy } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { Meter } from '@/ui/components/Meter'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import {
  DEFAULT_MARKET_PAGE_SIZE,
  MARKET_PAGE_SIZES,
  clampPage,
  exposureHealth,
  groupMarketRows,
  marketRowFigures,
  pageRows,
  sessionTone,
  volumeLabel,
  type MarketRow,
  type MarketRowFigures,
  type WorliInstance,
} from '../runningMarketsModel'
import styles from '../RunningMarketsPage.module.css'

interface MarketTableRow {
  row: MarketRow
  figures: MarketRowFigures
}

export interface RunningMarketsTableProps {
  items: WorliInstance[]
  loading?: boolean
  /** Why the markets could not be loaded; the table shows it with Retry. */
  error?: string | null
  onRetry?: () => void
  onView: (id: string) => void
}

/* The table view: one row per market and day with its OPEN and CLOSE sessions merged, paged on the client
   (25 a page, 10/25/50/100), as before. Columns, cell copy and the exposure bands are the legacy ones. */
export function RunningMarketsTable({ items, loading, error, onRetry, onView }: RunningMarketsTableProps) {
  const { formatDate, formatTime } = useFormatDate()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_MARKET_PAGE_SIZE)
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  // Group by marketId + runDate and merge OPEN/CLOSE into single row
  const groupedRows = useMemo(() => groupMarketRows(items), [items])
  const total = groupedRows.length
  // A page left past the end by a shorter result shows the last page.
  const current = clampPage(page, total, pageSize)
  const rows = useMemo<MarketTableRow[]>(
    () => pageRows(groupedRows, current, pageSize).map((row) => ({ row, figures: marketRowFigures(row) })),
    [groupedRows, current, pageSize],
  )

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const view = (figures: MarketRowFigures) => {
    if (figures.viewId) onView(figures.viewId)
  }

  const columns: DataTableColumn<MarketTableRow>[] = [
    {
      key: 'market',
      header: 'Market Details',
      cell: ({ row, figures }) => {
        const name = row.marketName || row.marketId
        return (
          <div className={styles.marketCell}>
            <span className={styles.marketTile} aria-hidden="true">
              <IconTrophy size={18} stroke={strokeFor(18)} />
            </span>
            <div className={styles.marketBody}>
              <div className={styles.marketLine}>
                {figures.isLive ? <span className={styles.liveDot} role="img" aria-label="Live" /> : null}
                <button type="button" className={styles.marketName} title={name} onClick={() => view(figures)}>
                  {name}
                </button>
              </div>
              <div className={styles.tagRow}>
                <StatusPill tone="info">WORLI</StatusPill>
                {figures.isPaused ? <StatusPill tone="neg">PAUSED</StatusPill> : null}
              </div>
            </div>
          </div>
        )
      },
    },
    {
      key: 'date',
      header: 'Date',
      cell: ({ row }) => (
        <span className={styles.dateCell}>{row.runDate ? formatDate(row.runDate, 'dd MMM yyyy') : '—'}</span>
      ),
    },
    {
      key: 'times',
      header: 'Session Times',
      align: 'center',
      cell: ({ row }) => (
        <div className={styles.sessionTimes}>
          <span className={styles.sessionOpen}>
            <IconClock size={12} stroke={strokeFor(12)} aria-hidden="true" />
            <span className={styles.sessionSide}>Open</span>
            <span className={styles.sessionTime}>
              {row.open?.scheduledOpenAt ? formatTime(row.open.scheduledOpenAt, 'HH:mm') : '--'}
            </span>
          </span>
          <span className={styles.sessionClose}>
            <IconClock size={12} stroke={strokeFor(12)} aria-hidden="true" />
            <span className={styles.sessionSide}>Close</span>
            <span className={styles.sessionTime}>
              {row.close?.scheduledOpenAt ? formatTime(row.close.scheduledOpenAt, 'HH:mm') : '--'}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'bets',
      header: 'Bets (Open / Close)',
      align: 'center',
      cell: ({ figures }) => (
        <div className={styles.betSplit}>
          <div className={styles.betSide}>
            <span className={styles.betCaption}>Open</span>
            <span className={styles.betCount}>{figures.openBets}</span>
            <span className={styles.betStake}>{money(figures.openStake)}</span>
          </div>
          <span className={styles.betDivider} aria-hidden="true" />
          <div className={styles.betSide}>
            <span className={styles.betCaption}>Close</span>
            <span className={styles.betCount}>{figures.closeBets}</span>
            <span className={styles.betStake}>{money(figures.closeStake)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'stakes',
      header: 'Total Stakes',
      align: 'right',
      cell: ({ figures }) => (
        <div className={styles.figureStack}>
          <span className={styles.figureMain}>{money(figures.totalStake)}</span>
          <span className={styles.figureSub}>{figures.totalBets} bets total</span>
          <span className={styles.figureNote}>{volumeLabel(figures.totalStake)}</span>
        </div>
      ),
    },
    {
      key: 'exposure',
      header: 'Exposure Risk',
      align: 'right',
      cell: ({ figures }) => {
        const health = exposureHealth(figures.totalExposure)
        return (
          <Tooltip
            content={(
              <span className={styles.tooltipLines}>
                <strong>Exposure Health: {health.text}</strong>
                <span>Total: {money(figures.totalExposure)}</span>
                <span>Open: {money(figures.openExposure)}</span>
                <span>Close: {money(figures.closeExposure)}</span>
              </span>
            )}
          >
            {/* Focusable so the breakdown is reachable from the keyboard, as the kit Stat's tooltip is. */}
            <span className={styles.exposureCell} tabIndex={0}>
              <span className={styles.figureMain}>{money(figures.totalExposure)}</span>
              <Meter className={styles.exposureMeter} value={health.percent} tone={health.tone} />
            </span>
          </Tooltip>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: ({ figures }) => (
        <div className={styles.statusStack}>
          <StatusPill
            tone={sessionTone(figures.openStatus)}
            icon={figures.openStatus === 'OPEN' ? <IconBolt size={12} stroke={strokeFor(12)} /> : undefined}
          >
            {`O: ${figures.openStatus}`}
          </StatusPill>
          <StatusPill
            tone={sessionTone(figures.closeStatus)}
            icon={figures.closeStatus === 'OPEN' ? <IconBolt size={12} stroke={strokeFor(12)} /> : undefined}
          >
            {`C: ${figures.closeStatus}`}
          </StatusPill>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sticky: 'end',
      cell: ({ figures }) => (
        <Tooltip content="View Details">
          <IconButton
            variant="bordered"
            label="View Details"
            icon={<IconEye size={16} stroke={strokeFor(16)} />}
            disabled={!figures.viewId}
            onClick={() => view(figures)}
          />
        </Tooltip>
      ),
    },
  ]

  return (
    <DataTable
      label="Worli markets"
      columns={columns}
      rows={rows}
      rowKey={({ row }) => row.key}
      state={error ? 'error' : loading ? 'loading' : 'ready'}
      error={error ?? undefined}
      onRetry={onRetry}
      empty={(
        <EmptyState inset="none" title="No markets found" icon={<IconCalendarX size={20} stroke={strokeFor(20)} />} />
      )}
      pagination={total > 0
        ? {
            current,
            pageSize,
            total,
            onChange: setPage,
            onPageSizeChange: (next) => {
              setPageSize(next)
              setPage(1)
            },
            itemName: 'markets',
            pageSizeOptions: MARKET_PAGE_SIZES,
            variant: 'embedded',
          }
        : false}
    />
  )
}

