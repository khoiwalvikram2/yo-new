import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { useQuery } from '@apollo/client'
import {
  IconCalendarCheck,
  IconCalendarEvent,
  IconCreditCard,
  IconDownload,
  IconGauge,
  IconReceipt,
  IconScale,
  IconTrendingDown,
  IconTrophy,
  IconWallet,
  type TablerIcon,
} from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { PLAYER_CREDIT_STATEMENT_QUERY } from '@/lib/graphql/players'
import { ReportingPeriodFilter } from '@/modules/reporting/ui/ReportingPeriodFilter'
import { formatReportingDay, reportingPeriodLabel, reportingPresetPeriod, type ReportingPeriod } from '@/modules/reporting/reportingDateFilter'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { Notice } from '@/ui/components/Notice'
import { Stat, type StatHue } from '@/ui/components/Stat'
import { StatusPill, type StatusPillTone } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  CREDIT_STATEMENT_DEFAULT_PAGE_SIZE,
  CREDIT_STATEMENT_PAGE_SIZES,
  balanceMeaning,
  creditStatementCsv,
  creditStatementTypeLabel,
  domainLabel,
  rowAmountMeaning,
  type CreditStatementData,
  type CreditStatementRowData,
  type SignedAmount,
} from './creditStatementModel'
import styles from '../PlayerProfile.module.css'

const TYPE_TONES: Record<string, StatusPillTone> = {
  BET_SETTLED: 'neutral',
  SETTLEMENT: 'info',
  LIMIT_CHANGE: 'muted',
  CREDIT_USED_CHANGE: 'muted',
  ALLOCATION: 'muted',
}
const HUES: StatHue[] = ['ind', 'blu', 'vio', 'grn', 'amb']

interface StatTile {
  label: string
  value: ReactNode
  note: string
  glyph: TablerIcon
}

/**
 * Credit Statement tab (spec 2026-10-22 §1): a credit player's settled bets, settlements and credit
 * changes for a period, with the settlement balance after every money row. Read-only. Amounts use the
 * player's P&L sign (positive = player won), and every signed figure says its direction in words.
 */
export function CreditStatementTab({ playerId }: { playerId: string }) {
  const { formatAmount } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const [defaultPeriod] = useState<ReportingPeriod>(() => reportingPresetPeriod('custom'))
  const [period, setPeriod] = useState<ReportingPeriod>(defaultPeriod)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(CREDIT_STATEMENT_DEFAULT_PAGE_SIZE)
  const { data, loading, error, refetch } = useQuery<{ playerCreditStatement?: CreditStatementData | null }>(PLAYER_CREDIT_STATEMENT_QUERY, {
    variables: { playerId, dateFrom: period.dateFrom, dateTo: period.dateTo, limit: pageSize, offset: (page - 1) * pageSize },
    skip: !playerId,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })
  const statement = data?.playerCreditStatement ?? null
  const pending = loading && !statement
  const rows = statement?.rows ?? []
  const summary = statement?.summary
  const totals = statement?.totals
  const periodLabel = reportingPeriodLabel(period)
  const isDefaultPeriod = period.preset === defaultPeriod.preset && period.dateFrom === defaultPeriod.dateFrom && period.dateTo === defaultPeriod.dateTo

  const signedText = (meaning: SignedAmount) => `${meaning.sign}${formatAmount(meaning.magnitude)}`
  const signed = (meaning: SignedAmount): ReactNode => (
    <span className={clsx(styles.moneyValue, meaning.tone === 'positive' && styles.positive, meaning.tone === 'negative' && styles.negative)}>
      {signedText(meaning)} <span className={styles.subtle}>{meaning.word}</span>
    </span>
  )
  const plain = (value: number | undefined) => (value === undefined ? '—' : formatAmount(value))
  const domainNote = summary
    ? [
        `Sports ${signedText(balanceMeaning(summary.settlementBalanceSports))}`,
        `Casino ${signedText(balanceMeaning(summary.settlementBalanceCasino))}`,
        `Matka ${signedText(balanceMeaning(summary.settlementBalanceMatka))}`,
      ].join(' · ')
    : 'Sports · Casino · Matka'
  const net = totals ? rowAmountMeaning({ type: 'BET_SETTLED', amount: totals.netResult }) : null
  const tiles: StatTile[] = [
    { label: 'Credit limit', value: plain(summary?.creditLimit), note: 'Current limit', glyph: IconCreditCard },
    { label: 'Credit used', value: plain(summary?.creditUsed), note: 'Open exposure', glyph: IconGauge },
    { label: 'Credit available', value: plain(summary?.creditAvailable), note: 'Limit − used + balance', glyph: IconWallet },
    { label: 'Settlement balance', value: summary ? signed(balanceMeaning(summary.settlementBalance)) : '—', note: domainNote, glyph: IconScale },
    { label: 'Opening balance', value: statement ? signed(balanceMeaning(statement.openingBalance)) : '—', note: `Start of ${formatReportingDay(period.dateFrom)}`, glyph: IconCalendarEvent },
    { label: 'Closing balance', value: statement ? signed(balanceMeaning(statement.closingBalance)) : '—', note: `End of ${formatReportingDay(period.dateTo)}`, glyph: IconCalendarCheck },
    { label: 'Total won', value: plain(totals?.totalWon), note: `${totals?.betCount ?? 0} settled bets`, glyph: IconTrophy },
    { label: 'Total lost', value: plain(totals?.totalLost), note: net ? `Net ${signedText(net)} · ${net.word}` : 'Net result', glyph: IconTrendingDown },
    { label: 'Settlements', value: totals ? signed(rowAmountMeaning({ type: 'SETTLEMENT', amount: totals.settlementsTotal })) : '—', note: `${totals?.settlementCount ?? 0} in this period`, glyph: IconReceipt },
  ]

  const detailLine = (row: CreditStatementRowData): string => {
    const parts = [row.details ?? '']
    if (row.valueBefore !== null && row.valueBefore !== undefined && row.valueAfter !== null && row.valueAfter !== undefined) {
      if (row.type === 'LIMIT_CHANGE') parts.push(`Limit ${formatAmount(row.valueBefore)} → ${formatAmount(row.valueAfter)}`)
      if (row.type === 'CREDIT_USED_CHANGE') parts.push(`Available ${formatAmount(row.valueBefore)} → ${formatAmount(row.valueAfter)}`)
    }
    return parts.filter(Boolean).join(' · ')
  }

  const columns: DataTableColumn<CreditStatementRowData>[] = [
    { key: 'date', header: 'Date', minWidth: 150, cell: (row) => <span>{formatDate(row.occurredAt, 'dd MMM yyyy')}<span className={styles.subtle}> · {formatTime(row.occurredAt, 'HH:mm:ss')}</span></span> },
    { key: 'type', header: 'Type', minWidth: 140, cell: (row) => <StatusPill tone={TYPE_TONES[row.type] ?? 'neutral'}>{creditStatementTypeLabel(row.type)}</StatusPill> },
    { key: 'domain', header: 'Domain', minWidth: 90, cell: (row) => domainLabel(row.domain) || '—' },
    {
      key: 'details', header: 'Details', minWidth: 240, cell: (row) => {
        const line = detailLine(row)
        if (!row.reference && !line) return '—'
        return <div>{row.reference ? <div>{row.reference}</div> : null}{line ? <div className={styles.subtle}>{line}</div> : null}</div>
      },
    },
    { key: 'amount', header: 'Amount', align: 'right', minWidth: 180, cell: (row) => signed(rowAmountMeaning(row)) },
    {
      key: 'balanceAfter', header: 'Balance after', align: 'right', minWidth: 200,
      cell: (row) => (row.balanceAfter === null || row.balanceAfter === undefined ? <span className={styles.subtle}>No change</span> : signed(balanceMeaning(row.balanceAfter))),
    },
  ]

  const download = () => {
    const blob = new Blob([creditStatementCsv(rows)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `credit-statement-${playerId}-${period.dateFrom}-to-${period.dateTo}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const totalRows = statement?.totalRows ?? 0
  return <div className={styles.stack}>
    <FilterBar label="Statement filters" activeCount={isDefaultPeriod ? 0 : 1} onClearAll={() => { setPeriod(defaultPeriod); setPage(1) }}>
      <ReportingPeriodFilter dateFrom={period.dateFrom} dateTo={period.dateTo} preset={period.preset} onChange={(dateFrom, dateTo, preset) => { setPeriod({ dateFrom, dateTo, preset }); setPage(1) }} />
    </FilterBar>
    {error ? <Notice title="Failed to load the credit statement" tone="error" action={<Button size="sm" onClick={() => void refetch()}>Retry</Button>}>{error.message}</Notice> : null}
    <div className={styles.kpiGrid} aria-busy={pending || undefined}>
      {tiles.map((tile, index) => <Stat className={styles.kpiStat} key={tile.label} label={tile.label} value={tile.value} note={tile.note} icon={<tile.glyph size={18} stroke={strokeFor(18)} />} hue={HUES[index % HUES.length]} loading={pending} />)}
    </div>
    <Card title="Credit statement" sub={`${totalRows} ${totalRows === 1 ? 'row' : 'rows'} · ${periodLabel} · the CSV holds the rows on this page`} body="table" tools={<Button size="sm" icon={<IconDownload size={16} />} onClick={download} disabled={rows.length === 0}>Download CSV</Button>}>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        label="Credit statement rows"
        width="wide"
        state={pending ? 'loading' : error && !statement ? 'error' : 'ready'}
        error={error?.message}
        onRetry={() => void refetch()}
        empty={<EmptyState title="No statement rows in this period" description="Settled bets, settlements and credit changes appear here." />}
        pagination={{ current: page, pageSize, total: totalRows, onChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1) }, pageSizeOptions: CREDIT_STATEMENT_PAGE_SIZES, itemName: 'rows' }}
      />
    </Card>
  </div>
}
