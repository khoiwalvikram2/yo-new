import { Fragment, useCallback, useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@apollo/client'
import {
  IconBallFootball,
  IconChartLine,
  IconDice,
  IconDownload,
  IconInbox,
  IconInfoCircle,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { GMAG_ROUND_DETAIL } from '@/lib/graphql/casino'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { Popover } from '@/ui/components/Popover'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import {
  betColumnSet,
  betCountLabel,
  betDomainLabel,
  betLiability,
  betOutcome,
  betPL,
  betRowKey,
  betStake,
  betStatusLabel,
  betStatusTone,
  betWalletLabel,
  campaignDetailLines,
  canOpenRoundDetail,
  casinoDetailLines,
  isBackSide,
  isBonusWalletLabel,
  matkaMultiplierLabel,
  matkaPL,
  outcomeTone,
  plTone,
  formatPL,
  roundDetailErrorMessage,
  roundDetailVariables,
  sportsDetailLines,
  sportsEventPath,
  sportsOddsLabel,
  type BetCampaign,
  type BetColumnSet,
  type BetDetailLine,
  type BetFigureTone,
  type BetItem,
  type CasinoBetItem,
  type MatkaBetItem,
  type SportsBetItem,
} from '../betListModel'
import styles from '../BetListPage.module.css'

// antd's notification stayed 4.5 seconds; the kit toast keeps that timing.
const NOTIFICATION_DURATION_MS = 4500

type FormatAmount = (value: number, currency?: string) => string

const PL_CLASS: Record<BetFigureTone, string> = {
  pos: styles.pos,
  neg: styles.neg,
  zero: styles.zero,
}

const OUTCOME_CLASS = {
  pos: clsx(styles.outcome, styles.pos),
  neg: clsx(styles.outcome, styles.neg),
  dim: styles.outcomeDim,
} as const

/** The legacy empty cell: a dim dash. */
function Dash() {
  return <span className={styles.dimText}>—</span>
}

function StatusBadge({ status }: { status: string }) {
  return <StatusPill tone={betStatusTone(status)}>{betStatusLabel(status)}</StatusPill>
}

function SideBadge({ side }: { side?: string | null }) {
  if (!side) return <Dash />
  return (
    <span className={clsx(styles.tag, styles.upper, isBackSide(side) ? styles.hueBlu : styles.hueAmb)}>
      {side}
    </span>
  )
}

function DomainBadge({ typename }: { typename: string }) {
  const label = betDomainLabel(typename)
  if (label === 'Sports') {
    return (
      <span className={clsx(styles.tag, styles.hueGrn)}>
        <IconBallFootball size={12} stroke={strokeFor(12)} aria-hidden="true" />
        Sports
      </span>
    )
  }
  if (label === 'Casino') {
    return (
      <span className={clsx(styles.tag, styles.hueAmb)}>
        <IconDice size={12} stroke={strokeFor(12)} aria-hidden="true" />
        Casino
      </span>
    )
  }
  return (
    <span className={clsx(styles.tag, styles.hueVio)}>
      <IconChartLine size={12} stroke={strokeFor(12)} aria-hidden="true" />
      Matka
    </span>
  )
}

function WalletBadge({ walletType }: { walletType?: string | null }) {
  const label = betWalletLabel(walletType)
  return <span className={clsx(styles.tag, isBonusWalletLabel(label) && styles.hueAmb)}>{label}</span>
}

/** A popover heading and its term/value rows. */
function DetailList({ titleId, title, lines }: { titleId: string; title: string; lines: readonly BetDetailLine[] }) {
  return (
    <div className={styles.popBody}>
      <h3 id={titleId} className={styles.popTitle}>{title}</h3>
      <dl className={styles.detailList}>
        {lines.map(({ label, value }) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}

/** The campaign's name opens its details (the legacy hover tooltip, now a click or Enter away). */
function CampaignCell({ campaign }: { campaign?: BetCampaign | null }) {
  const { formatDate } = useFormatDate()
  const titleId = useId()
  if (!campaign) return <Dash />
  const lines = campaignDetailLines(campaign, (value) => formatDate(value, 'dd MMM yyyy'))
  return (
    <Popover
      labelledBy={titleId}
      placement="left"
      trigger={(
        <Button
          variant="link"
          size="xs"
          className={styles.campaignTrigger}
          title={campaign.name}
          icon={<IconInfoCircle size={13} stroke={strokeFor(13)} />}
        >
          {campaign.name}
        </Button>
      )}
    >
      <DetailList titleId={titleId} title="Campaign details" lines={lines} />
    </Popover>
  )
}

/** "View" opens the bet's device or round identifiers; a bet with none shows a dash. */
function BetDetailsPopover({ lines }: { lines: readonly BetDetailLine[] }) {
  const titleId = useId()
  if (lines.length === 0) return <Dash />
  return (
    <Popover
      labelledBy={titleId}
      placement="left"
      trigger={(
        <Button variant="link" size="xs" icon={<IconInfoCircle size={13} stroke={strokeFor(13)} />}>
          View
        </Button>
      )}
    >
      <DetailList titleId={titleId} title="Bet Details" lines={lines} />
    </Popover>
  )
}

function PLCell({ value, currency, formatAmount }: { value: number | null; currency: string; formatAmount: FormatAmount }) {
  if (value == null) return <Dash />
  return <span className={PL_CLASS[plTone(value)]}>{formatPL(value, currency, formatAmount)}</span>
}

function AmountCell({
  value,
  currency,
  formatAmount,
  bold,
}: {
  value: number | null | undefined
  currency: string
  formatAmount: FormatAmount
  bold?: boolean
}) {
  if (value == null) return <Dash />
  return (
    <span className={clsx(styles.amount, bold && styles.amountStrong)}>
      {formatAmount(Number(value), currency)}
    </span>
  )
}

/** A long value cut at the legacy measure; the native title carries the whole of it. */
function TruncatedText({ value, className }: { value?: string | null; className: string }) {
  return (
    <span className={clsx(styles.truncate, className)} title={value ?? undefined}>
      {value || '—'}
    </span>
  )
}

type RoundDetailContext = {
  onRoundDetail: (row: CasinoBetItem) => void
  loadingRoundId: string | null
}

function CasinoDetailsCell({ row, roundDetail }: { row: CasinoBetItem; roundDetail: RoundDetailContext }) {
  const loading = roundDetail.loadingRoundId === row.gameRoundId
  return (
    <span className={styles.detailsCell}>
      <BetDetailsPopover lines={casinoDetailLines(row)} />
      {canOpenRoundDetail(row) ? (
        <Tooltip content="Open GM-Ag round wagering details">
          <Button
            variant="link"
            size="xs"
            loading={loading}
            // While any round is opening the others wait, as before; aria-disabled keeps the tooltip reachable.
            aria-disabled={Boolean(roundDetail.loadingRoundId)}
            onClick={() => roundDetail.onRoundDetail(row)}
          >
            Round Detail
          </Button>
        </Tooltip>
      ) : null}
    </span>
  )
}

function PlayerCell({ row }: { row: BetItem }) {
  const label = row.userName ?? row.userId ?? '—'
  const title = row.userName ?? row.userId ?? undefined
  if (row.userId) {
    return (
      <Link
        to={`/players/profile/${row.userId}`}
        className={clsx(styles.playerLink, styles.truncate, styles.nameCell)}
        title={title}
      >
        {label}
      </Link>
    )
  }
  return (
    <span className={clsx(styles.keyText, styles.truncate, styles.nameCell)} title={title}>
      {label}
    </span>
  )
}

/** Sport › League › Event, the event in the key ink. */
function SportsEventPath({ row }: { row: SportsBetItem }) {
  const path = sportsEventPath(row)
  if (!path) return <Dash />
  return (
    <span className={clsx(styles.truncate, styles.wideCell)} title={path}>
      <span className={styles.path}>{row.sportName ?? ''}</span>
      {row.leagueName && <span className={styles.path}> › </span>}
      <span className={styles.path}>{row.leagueName ?? ''}</span>
      {row.eventName && <span className={styles.path}> › </span>}
      <span className={styles.keyText}>{row.eventName ?? ''}</span>
    </span>
  )
}

/** The mixed list's shorter form: the sport, then the event (or the league when there is no event). */
function SportsEventShort({ row }: { row: SportsBetItem }) {
  return (
    <span className={clsx(styles.truncate, styles.allEventCell)} title={sportsEventPath(row) || undefined}>
      <span className={styles.path}>{row.sportName ?? ''}</span>
      {row.leagueName && <span className={styles.path}> › </span>}
      <span className={styles.keyText}>{row.eventName ?? row.leagueName ?? ''}</span>
    </span>
  )
}

function MatkaMarketCell({ row }: { row: MatkaBetItem }) {
  return (
    <span>
      <span className={styles.keyText}>{row.marketName || '—'}</span>
      {row.matkaType ? (
        <span className={clsx(styles.tag, styles.tagSmall, styles.hueVio, styles.capitalize)}>{row.matkaType}</span>
      ) : null}
    </span>
  )
}

function OutcomeText({ status, includeVoid }: { status: string; includeVoid?: boolean }) {
  const outcome = betOutcome(status, includeVoid)
  if (!outcome) return <Dash />
  return <span className={OUTCOME_CLASS[outcomeTone(outcome)]}>{outcome}</span>
}

function SportsResultCell({ row }: { row: SportsBetItem }) {
  const outcome = betOutcome(row.status)
  if (!outcome && !row.eventResult) return <Dash />
  return (
    <span className={styles.stack}>
      {row.eventResult ? (
        <span className={clsx(styles.keyText, styles.truncate, styles.resultCell)} title={row.eventResult}>
          {row.eventResult}
        </span>
      ) : null}
      {outcome ? <span className={OUTCOME_CLASS[outcomeTone(outcome)]}>{outcome}</span> : null}
    </span>
  )
}

function MatkaResultCell({ row, bold }: { row: MatkaBetItem; bold?: boolean }) {
  if (row.result) return <span className={clsx(styles.mono, bold && styles.semibold)}>{row.result}</span>
  return <OutcomeText status={row.status} />
}

/* ---------- columns ---------- */

/* The columns follow the rows on the page (betColumnSet): a single domain gets its own set, a mix or an
   empty page the shared one. Every set has a Details column — after Status for sports and casino, before
   it for matka and the mixed list, where matka rows show a dash — as the legacy table assembled them. */

interface ColumnContext {
  formatAmount: FormatAmount
  formatDate: (date: string, pattern?: string) => string
  formatTime: (date: string, pattern?: string) => string
  roundDetail: RoundDetailContext
}

type BetColumn = DataTableColumn<BetItem>

const asSports = (render: (row: SportsBetItem) => ReactNode) => (row: BetItem) => render(row as SportsBetItem)
const asCasino = (render: (row: CasinoBetItem) => ReactNode) => (row: BetItem) => render(row as CasinoBetItem)
const asMatka = (render: (row: MatkaBetItem) => ReactNode) => (row: BetItem) => render(row as MatkaBetItem)

const STATUS_COLUMN: BetColumn = {
  key: 'status',
  header: 'Status',
  minWidth: 90,
  cell: (row) => <StatusBadge status={row.status} />,
}

function commonColumns(ctx: ColumnContext): BetColumn[] {
  return [
    {
      key: 'time',
      header: 'Time',
      minWidth: 110,
      cell: (row) => (
        <span className={styles.stack}>
          <span>{ctx.formatDate(row.createdAt, 'dd MMM yy')}</span>
          <span className={styles.secondary}>{ctx.formatTime(row.createdAt, 'HH:mm:ss')}</span>
        </span>
      ),
    },
    { key: 'domain', header: 'Domain', minWidth: 85, cell: (row) => <DomainBadge typename={row.__typename} /> },
    { key: 'name', header: 'Name', minWidth: 110, cell: (row) => <PlayerCell row={row} /> },
    { key: 'phone', header: 'Phone', minWidth: 110, cell: (row) => row.userPhone || '—' },
    { key: 'wallet', header: 'Wallet', minWidth: 70, cell: (row) => <WalletBadge walletType={row.walletType} /> },
    { key: 'campaign', header: 'Campaign', minWidth: 110, cell: (row) => <CampaignCell campaign={row.campaign} /> },
  ]
}

function sportsColumns(ctx: ColumnContext): BetColumn[] {
  return [
    ...commonColumns(ctx),
    { key: 'event', header: 'Event', minWidth: 200, cell: asSports((row) => <SportsEventPath row={row} />) },
    {
      key: 'market',
      header: 'Market',
      minWidth: 110,
      cell: asSports((row) => <TruncatedText value={row.marketName} className={styles.narrowCell} />),
    },
    {
      key: 'selection',
      header: 'Selection',
      minWidth: 110,
      cell: asSports((row) => <TruncatedText value={row.selectionName} className={styles.narrowCell} />),
    },
    { key: 'type', header: 'Type', minWidth: 60, align: 'center', cell: asSports((row) => <SideBadge side={row.side} />) },
    {
      key: 'stake',
      header: 'Stake',
      align: 'right',
      minWidth: 90,
      cell: asSports((row) => (
        <AmountCell value={row.stake} currency={row.currency} formatAmount={ctx.formatAmount} bold />
      )),
    },
    {
      key: 'odds',
      header: 'Odds',
      align: 'right',
      minWidth: 70,
      cell: asSports((row) => sportsOddsLabel(row, true) ?? <Dash />),
    },
    {
      key: 'liability',
      header: 'Liability',
      align: 'right',
      minWidth: 90,
      cell: asSports((row) => (
        <AmountCell value={row.liability} currency={row.currency} formatAmount={ctx.formatAmount} />
      )),
    },
    {
      key: 'pl',
      header: 'P/L',
      align: 'right',
      minWidth: 90,
      cell: asSports((row) => <PLCell value={row.pl ?? null} currency={row.currency} formatAmount={ctx.formatAmount} />),
    },
    { key: 'result', header: 'Result', minWidth: 100, cell: asSports((row) => <SportsResultCell row={row} />) },
    STATUS_COLUMN,
    {
      key: 'details',
      header: 'Details',
      minWidth: 60,
      align: 'center',
      cell: asSports((row) => <BetDetailsPopover lines={sportsDetailLines(row)} />),
    },
  ]
}

function casinoColumns(ctx: ColumnContext): BetColumn[] {
  return [
    ...commonColumns(ctx),
    {
      key: 'game',
      header: 'Game',
      minWidth: 140,
      cell: asCasino((row) => <TruncatedText value={row.gameName} className={clsx(styles.mediumCell, styles.keyText)} />),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      minWidth: 100,
      cell: asCasino((row) => <TruncatedText value={row.vendorName} className={styles.narrowCell} />),
    },
    { key: 'table', header: 'Table', minWidth: 80, cell: asCasino((row) => <span className={styles.mono}>{row.tableId || '—'}</span>) },
    {
      key: 'stake',
      header: 'Stake',
      align: 'right',
      minWidth: 90,
      cell: asCasino((row) => (
        <AmountCell value={row.stake} currency={row.currency} formatAmount={ctx.formatAmount} bold />
      )),
    },
    {
      key: 'payout',
      header: 'Payout',
      align: 'right',
      minWidth: 90,
      cell: asCasino((row) => <AmountCell value={row.payout} currency={row.currency} formatAmount={ctx.formatAmount} />),
    },
    {
      key: 'winAmount',
      header: 'Win Amt',
      align: 'right',
      minWidth: 90,
      cell: asCasino((row) => <AmountCell value={row.winAmount} currency={row.currency} formatAmount={ctx.formatAmount} />),
    },
    {
      key: 'pl',
      header: 'P/L',
      align: 'right',
      minWidth: 90,
      cell: asCasino((row) => (
        <PLCell value={row.netAmount ?? null} currency={row.currency} formatAmount={ctx.formatAmount} />
      )),
    },
    { key: 'result', header: 'Result', minWidth: 70, cell: (row) => <OutcomeText status={row.status} includeVoid={false} /> },
    STATUS_COLUMN,
    {
      key: 'details',
      header: 'Details',
      minWidth: 100,
      align: 'center',
      cell: asCasino((row) => <CasinoDetailsCell row={row} roundDetail={ctx.roundDetail} />),
    },
  ]
}

function matkaColumns(ctx: ColumnContext): BetColumn[] {
  return [
    ...commonColumns(ctx),
    { key: 'matka', header: 'Matka', minWidth: 140, cell: asMatka((row) => <MatkaMarketCell row={row} />) },
    {
      key: 'session',
      header: 'Session',
      minWidth: 80,
      cell: asMatka((row) => <span className={styles.upper}>{row.marketSession || '—'}</span>),
    },
    {
      key: 'bidType',
      header: 'Bid Type',
      minWidth: 80,
      cell: asMatka((row) => (
        <span className={clsx(styles.tag, styles.hueInd, styles.upper)}>{row.bidType || '—'}</span>
      )),
    },
    {
      key: 'numbers',
      header: 'Numbers',
      minWidth: 90,
      cell: asMatka((row) => <span className={clsx(styles.mono, styles.strong)}>{row.betNumbers || '—'}</span>),
    },
    {
      key: 'stake',
      header: 'Stake',
      align: 'right',
      minWidth: 90,
      cell: asMatka((row) => (
        <AmountCell value={row.betAmount} currency={row.currency} formatAmount={ctx.formatAmount} bold />
      )),
    },
    {
      key: 'multiplier',
      header: 'Multiplier',
      align: 'right',
      minWidth: 80,
      cell: asMatka((row) => matkaMultiplierLabel(row) ?? '—'),
    },
    {
      key: 'potentialWin',
      header: 'Potential Win',
      align: 'right',
      minWidth: 100,
      cell: asMatka((row) => (
        <AmountCell value={row.potentialWin} currency={row.currency} formatAmount={ctx.formatAmount} />
      )),
    },
    {
      key: 'pl',
      header: 'P/L',
      align: 'right',
      minWidth: 90,
      cell: asMatka((row) => <PLCell value={matkaPL(row)} currency={row.currency} formatAmount={ctx.formatAmount} />),
    },
    { key: 'result', header: 'Result', minWidth: 70, cell: asMatka((row) => <MatkaResultCell row={row} bold />) },
    { key: 'details', header: 'Details', minWidth: 100, align: 'center', cell: () => <Dash /> },
    STATUS_COLUMN,
  ]
}

function allColumns(ctx: ColumnContext): BetColumn[] {
  return [
    ...commonColumns(ctx),
    {
      key: 'event_game',
      header: 'Event / Game',
      minWidth: 180,
      cell: (row) => {
        if (row.__typename === 'SportsBet') return <SportsEventShort row={row} />
        if (row.__typename === 'CasinoBet') {
          return <TruncatedText value={row.gameName} className={clsx(styles.allEventCell, styles.keyText)} />
        }
        return <MatkaMarketCell row={row} />
      },
    },
    {
      key: 'market_vendor',
      header: 'Market / Vendor',
      minWidth: 120,
      cell: (row) => {
        if (row.__typename === 'SportsBet') return <TruncatedText value={row.marketName} className={styles.narrowCell} />
        if (row.__typename === 'CasinoBet') return <TruncatedText value={row.vendorName} className={styles.narrowCell} />
        return <span className={styles.upper}>{row.bidType || '—'}</span>
      },
    },
    {
      key: 'type_side',
      header: 'Type',
      minWidth: 60,
      align: 'center',
      cell: (row) => {
        if (row.__typename === 'SportsBet') return <SideBadge side={row.side} />
        if (row.__typename === 'MatkaBet') return <span className={styles.mono}>{row.betNumbers || '—'}</span>
        return <Dash />
      },
    },
    {
      key: 'stake',
      header: 'Stake',
      align: 'right',
      minWidth: 90,
      cell: (row) => <AmountCell value={betStake(row)} currency={row.currency} formatAmount={ctx.formatAmount} bold />,
    },
    {
      key: 'odds_mult',
      header: 'Odds',
      align: 'right',
      minWidth: 70,
      cell: (row) => {
        if (row.__typename === 'SportsBet') return sportsOddsLabel(row, false) ?? <Dash />
        if (row.__typename === 'MatkaBet') return matkaMultiplierLabel(row) ?? '—'
        return <Dash />
      },
    },
    {
      key: 'liability_payout',
      header: 'Liability',
      align: 'right',
      minWidth: 90,
      cell: (row) => <AmountCell value={betLiability(row)} currency={row.currency} formatAmount={ctx.formatAmount} />,
    },
    {
      key: 'pl',
      header: 'P/L',
      align: 'right',
      minWidth: 90,
      cell: (row) => <PLCell value={betPL(row)} currency={row.currency} formatAmount={ctx.formatAmount} />,
    },
    {
      key: 'result',
      header: 'Result',
      minWidth: 100,
      cell: (row) => {
        if (row.__typename === 'SportsBet') return <SportsResultCell row={row} />
        if (row.__typename === 'CasinoBet') return <OutcomeText status={row.status} includeVoid={false} />
        return <MatkaResultCell row={row} />
      },
    },
    {
      key: 'details',
      header: 'Details',
      minWidth: 100,
      align: 'center',
      cell: (row) => {
        if (row.__typename === 'SportsBet') return <BetDetailsPopover lines={sportsDetailLines(row)} />
        if (row.__typename === 'CasinoBet') return <CasinoDetailsCell row={row} roundDetail={ctx.roundDetail} />
        return <Dash />
      },
    },
    STATUS_COLUMN,
  ]
}

function betColumns(set: BetColumnSet, ctx: ColumnContext): BetColumn[] {
  if (set === 'SPORTS') return sportsColumns(ctx)
  if (set === 'CASINO') return casinoColumns(ctx)
  if (set === 'MATKA') return matkaColumns(ctx)
  return allColumns(ctx)
}

/* ---------- the table card ---------- */

type BetListTableProps = {
  items: BetItem[]
  total: number
  loading: boolean
  /** The list query's error message: the table says so and offers a retry (the page raises the toast). */
  error?: string | null
  onRetry?: () => void
  /** Export all rows matching current list filters (not only the current page). */
  onExportAll: () => Promise<void>
  exportLoading?: boolean
  footer?: ReactNode
}

export function BetListTable({
  items,
  total,
  loading,
  error,
  onRetry,
  onExportAll,
  exportLoading = false,
  footer,
}: BetListTableProps) {
  const { formatAmount } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const [loadingRoundId, setLoadingRoundId] = useState<string | null>(null)
  const [gmagRoundDetail] = useMutation(GMAG_ROUND_DETAIL)

  const handleRoundDetail = useCallback(
    async (row: CasinoBetItem) => {
      const roundId = row.gameRoundId
      if (!roundId || !canOpenRoundDetail(row)) {
        return
      }
      const variables = roundDetailVariables(row)
      setLoadingRoundId(roundId)
      try {
        const res = await gmagRoundDetail({ variables })
        if (res.errors?.length) {
          const msg = roundDetailErrorMessage(res.errors)
          toast({ title: 'Round Detail', message: msg, tone: 'error', duration: NOTIFICATION_DURATION_MS })
          return
        }
        const url = res.data?.gmagRoundDetail?.url
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer')
        } else {
          toast({ title: 'Round Detail', message: 'No URL returned.', tone: 'error', duration: NOTIFICATION_DURATION_MS })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load round detail'
        toast({ title: 'Round Detail', message, tone: 'error', duration: NOTIFICATION_DURATION_MS })
      } finally {
        setLoadingRoundId(null)
      }
    },
    [gmagRoundDetail]
  )

  const columnSet = betColumnSet(items)
  const columns = useMemo(
    () => betColumns(columnSet, {
      formatAmount,
      formatDate,
      formatTime,
      roundDetail: { onRoundDetail: handleRoundDetail, loadingRoundId },
    }),
    [columnSet, formatAmount, formatDate, formatTime, handleRoundDetail, loadingRoundId],
  )

  return (
    <Card
      title="Bet List"
      sub={betCountLabel(total)}
      body="table"
      tools={(
        <Button
          variant="primary"
          size="sm"
          icon={<IconDownload size={15} stroke={strokeFor(15)} />}
          loading={exportLoading}
          onClick={() => void onExportAll()}
          disabled={total === 0 || loading}
        >
          Export Excel
        </Button>
      )}
    >
      <DataTable
        columns={columns}
        rows={items}
        rowKey={betRowKey}
        label="Bets"
        state={error && !loading ? 'error' : loading ? 'loading' : 'ready'}
        error={error ?? undefined}
        onRetry={onRetry}
        width="wide"
        empty={(
          <EmptyState
            title="No bets found"
            icon={<IconInbox size={20} stroke={strokeFor(20)} />}
          />
        )}
      />
      {footer}
    </Card>
  )
}
