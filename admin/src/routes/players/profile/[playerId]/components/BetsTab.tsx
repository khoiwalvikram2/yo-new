import { useState, useMemo, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useApolloClient, useQuery, gql } from '@apollo/client'
import { format } from 'date-fns'
import clsx from 'clsx'
import { toast } from '@/ui/components/toast'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { Notice } from '@/ui/components/Notice'
import { Popover } from '@/ui/components/Popover'
import { Select } from '@/ui/components/Select'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tabs } from '@/ui/components/Tabs'
import { TextField } from '@/ui/components/TextField'
import { Tooltip } from '@/ui/components/Tooltip'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, playerBetTotals, playerBetsCsv, resolveDateRange, type BetCampaign, type BetRow, type ProductTab } from './playerBetsModel'
import styles from './PlayerBets.module.css'
interface BetsTabProps { playerId: string; dateRange: string; dateFrom: string | null; dateTo: string | null }
const PLAYER_BETS_QUERY = gql`
  query PlayerBets($playerId: ID!, $filter: PlayerBetsFilter) {
    playerBets(playerId: $playerId, filter: $filter) {
      items {
        id
        product
        userId
        status
        stake
        liability
        return
        netAmount
        currency
        createdAt
        settledAt
        # Sports fields
        sportId
        sportName
        leagueId
        leagueName
        eventId
        eventName
        marketId
        marketName
        selectionId
        selectionName
        odds
        oddsSize
        side
        pl
        result
        eventResult
        ipAddress
        deviceInfo
        location
        country
        # Casino fields
        gameId
        gameName
        providerId
        providerName
        vendorName
        tableId
        winAmount
        sessionId
        gameRoundId
        transactionId
        # Matka fields
        matkaId
        matkaName
        matkaType
        bidType
        bidNumbers
        marketSession
        payoutMultiplier
        potentialWin
        actualWin
        payout
        # Wallet & campaign
        walletType
        campaign {
          id
          name
          type
          distributionType
          wageringReq
          validTo
          validFrom
          domain
          status
          startDate
          endDate
          amount
          percentage
          amountType
        }
      }
      total
      hasMore
    }
  }
`

function StatusBadge({ status }: { status: string }) {
  const value = status.toLowerCase()
  return <StatusPill tone={['won', 'win'].includes(value) ? 'ok' : value === 'lost' ? 'neg' : ['void', 'cancelled'].includes(value) ? 'muted' : 'info'}>{status}</StatusPill>
}
function SideBadge({ side }: { side?: string | null }) {
  return side ? <StatusPill tone={side.toLowerCase() === 'back' ? 'info' : 'warn'}>{side}</StatusPill> : <span className={styles.secondary}>—</span>
}
function DomainBadge({ product }: { product: string }) {
  return <StatusPill tone={product === 'sports' ? 'ok' : product === 'casino' ? 'warn' : 'info'}>{product === 'sports' ? 'Sports' : product === 'casino' ? 'Casino' : 'Matka'}</StatusPill>
}
function WalletBadge({ walletType }: { walletType?: string | null }) {
  const value = String(walletType || 'cash').toLowerCase().replace(/_/g, '')
  return <StatusPill tone={value === 'bonus' || value === 'referralbonus' ? 'warn' : 'muted'}>{value === 'bonus' ? 'Bonus' : value === 'referralbonus' ? 'Referral' : 'Cash'}</StatusPill>
}
function CampaignCell({ campaign }: { campaign?: BetCampaign | null }) {
  const { formatDate } = useFormatDate()
  if (!campaign) return <span className={styles.secondary}>—</span>
  const distribution: Record<string, string> = { instant_otp: 'Instant OTP', instant_cash: 'Instant Cash', roll_over: 'Roll Over' }
  const details: Array<{ term: string; value: string }> = []
  const add = (term: string, value: unknown) => { if (value !== null && value !== undefined && value !== '') details.push({ term, value: String(value) }) }
  add('Name', campaign.name); add('Type', campaign.type); add('Payout type', campaign.distributionType ? distribution[campaign.distributionType] ?? campaign.distributionType.replace(/_/g, ' ') : null)
  add('Domain', campaign.domain); add('Status', campaign.status)
  add('Wagering', campaign.wageringReq != null ? `${campaign.wageringReq}x` : null)
  add('Amount', campaign.amount); add('Percentage', campaign.percentage != null ? `${campaign.percentage}%` : null); add('Amount type', campaign.amountType)
  for (const [term, value] of [['Valid from', campaign.validFrom], ['Valid to', campaign.validTo], ['Start date', campaign.startDate], ['End date', campaign.endDate]]) {
    if (value) { try { add(term!, formatDate(value, 'dd MMM yyyy')) } catch { /* Invalid optional dates stay absent as before. */ } }
  }
  return <Popover label="Campaign details" placement="left-start" trigger={<Button size="sm" variant="link" aria-label={`Campaign details: ${campaign.name}`}>{campaign.name}</Button>}>
    <div className={styles.details}><strong>Campaign details</strong><DescriptionList items={details} /></div>
  </Popover>
}
function PLCell({ value, currency, formatAmount }: { value: number | null; currency: string; formatAmount: (value: number, currency?: string) => string }) {
  return value == null ? <span className={styles.secondary}>—</span> : <span className={clsx(styles.mono, styles.strong, value > 0 ? styles.pos : value < 0 ? styles.neg : styles.secondary)}>{value > 0 ? '+' : ''}{formatAmount(value, currency)}</span>
}
function AmountCell({ value, currency, formatAmount, bold }: { value: number | null | undefined; currency: string; formatAmount: (value: number, currency?: string) => string; bold?: boolean }) {
  return value == null ? <span className={styles.secondary}>—</span> : <span className={clsx(styles.mono, bold && styles.strong)}>{formatAmount(Number(value), currency)}</span>
}
function BetDetails({ row, casino }: { row: BetRow; casino?: boolean }) {
  const values = casino ? [['Session', row.sessionId], ['Round', row.gameRoundId], ['Txn', row.transactionId]] : [['IP', row.ipAddress], ['Location', row.location], ['Country', row.country], ['Device', row.deviceInfo]]
  const items = values.filter(([, value]) => Boolean(value)).map(([term, value]) => ({ term, value }))
  return items.length ? <Popover label="Bet Details" placement="left-start" trigger={<Button variant="link" size="sm" aria-label={`View details for bet ${row.id}`}>View</Button>}><div className={styles.details}><strong>Bet Details</strong><DescriptionList items={items} /></div></Popover> : <span className={styles.secondary}>—</span>
}
function SportsDetailsPopover({ row }: { row: BetRow }) { return <BetDetails row={row} /> }
function CasinoDetailsPopover({ row }: { row: BetRow }) { return <BetDetails row={row} casino /> }

type ColDef = {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  minW?: string
  render: (row: BetRow, fmt: (v: number, c?: string) => string) => ReactNode
}

const getCommonColsStart = (formatDate: (d: string, f?: string) => string, formatTime: (d: string, f?: string) => string): ColDef[] => [
  {
    key: 'time',
    header: 'Time',
    minW: '110px',
    render: (row) => (
      <div>
        <div className={styles.text}>{row.createdAt ? formatDate(row.createdAt, 'dd MMM yy') : '—'}</div>
        <div className={clsx(styles.text, styles.secondary)}>{row.createdAt ? formatTime(row.createdAt, 'HH:mm:ss') : '—'}</div>
      </div>
    ),
  },
  {
    key: 'wallet',
    header: 'Wallet',
    minW: '70px',
    render: (row) => <WalletBadge walletType={row.walletType} />,
  },
  {
    key: 'campaign',
    header: 'Campaign',
    minW: '110px',
    render: (row) => <CampaignCell campaign={row.campaign} />,
  },
]

const getSportsCols = (formatDate: (d: string, f?: string) => string, formatTime: (d: string, f?: string) => string): ColDef[] => [
  ...getCommonColsStart(formatDate, formatTime),
  {
    key: 'event',
    header: 'Event',
    minW: '200px',
    render: (row) => {
      const parts = [row.sportName, row.leagueName, row.eventName].filter(Boolean)
      if (parts.length === 0) return <span className={clsx(styles.text, styles.secondary)}>—</span>
      return (
        <Tooltip content={parts.join(' › ')} placement="top-start">
          <div className={clsx(styles.text, styles.truncate)}>
            <span className={clsx(styles.text, styles.secondary)}>{row.sportName ?? ''}</span>
            {row.leagueName && <span className={clsx(styles.text, styles.secondary)}> › </span>}
            <span className={clsx(styles.text, styles.secondary)}>{row.leagueName ?? ''}</span>
            {row.eventName && <span className={clsx(styles.text, styles.secondary)}> › </span>}
            <span className={clsx(styles.text, styles.strong)}>{row.eventName ?? ''}</span>
          </div>
        </Tooltip>
      )
    },
  },
  {
    key: 'market',
    header: 'Market',
    minW: '110px',
    render: (row) => (
      <span className={clsx(styles.text, styles.truncate)} title={row.marketName ?? ''}>
        {row.marketName || '—'}
      </span>
    ),
  },
  {
    key: 'selection',
    header: 'Selection',
    minW: '110px',
    render: (row) => (
      <span className={clsx(styles.text, styles.truncate)} title={row.selectionName ?? ''}>
        {row.selectionName || '—'}
      </span>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    minW: '60px',
    align: 'center',
    render: (row) => <SideBadge side={row.side} />,
  },
  {
    key: 'stake',
    header: 'Stake',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => <AmountCell value={row.stake} currency={row.currency} formatAmount={fmt} bold />,
  },
  {
    key: 'odds',
    header: 'Odds',
    align: 'right',
    minW: '70px',
    render: (row) => {
      if (row.odds == null) return <span className={clsx(styles.text, styles.secondary)}>—</span>
      if (row.oddsSize != null) {
        return <span className={styles.text}>{Number(row.oddsSize).toFixed(0)} / {Number(row.odds).toFixed(2)}</span>
      }
      return <span className={styles.text}>{Number(row.odds).toFixed(2)}</span>
    },
  },
  {
    key: 'liability',
    header: 'Liability',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => <AmountCell value={row.liability} currency={row.currency} formatAmount={fmt} />,
  },
  {
    key: 'pl',
    header: 'P/L',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => <PLCell value={row.pl ?? null} currency={row.currency} formatAmount={fmt} />,
  },
  {
    key: 'result',
    header: 'Result',
    minW: '100px',
    render: (row) => {
      const s = String(row.status).toLowerCase()
      const statusLabel = s === 'won' ? 'Won' : s === 'lost' ? 'Lost' : s === 'void' ? 'Void' : s === 'cancelled' ? 'Cancelled' : null
      const statusColor = s === 'won' ? styles.pos : s === 'lost' ? styles.neg : styles.secondary
      if (!statusLabel && !row.eventResult) return <span className={clsx(styles.text, styles.secondary)}>—</span>
      return (
        <div className={clsx(styles.text, styles.lines)}>
          {row.eventResult && <div className={clsx(styles.text, styles.strong, styles.truncate)} title={row.eventResult}>{row.eventResult}</div>}
          {statusLabel && <div className={clsx(styles.strong, statusColor)}>{statusLabel}</div>}
        </div>
      )
    },
  },
  {
    key: 'status',
    header: 'Status',
    minW: '90px',
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'details',
    header: 'Details',
    minW: '60px',
    align: 'center',
    render: (row) => <SportsDetailsPopover row={row} />,
  },
]

const getCasinoCols = (formatDate: (d: string, f?: string) => string, formatTime: (d: string, f?: string) => string): ColDef[] => [
  ...getCommonColsStart(formatDate, formatTime),
  {
    key: 'game',
    header: 'Game',
    minW: '140px',
    render: (row) => (
      <span className={clsx(styles.text, styles.strong, styles.truncate)} title={row.gameName ?? ''}>
        {row.gameName || '—'}
      </span>
    ),
  },
  {
    key: 'vendor',
    header: 'Vendor',
    minW: '100px',
    render: (row) => (
      <span className={clsx(styles.text, styles.truncate)} title={row.vendorName ?? row.providerName ?? ''}>
        {row.vendorName || row.providerName || '—'}
      </span>
    ),
  },
  {
    key: 'table',
    header: 'Table',
    minW: '80px',
    render: (row) => (
      <span className={clsx(styles.text, styles.mono)}>{row.tableId || '—'}</span>
    ),
  },
  {
    key: 'stake',
    header: 'Stake',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => <AmountCell value={row.stake} currency={row.currency} formatAmount={fmt} bold />,
  },
  {
    key: 'payout',
    header: 'Payout',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => <AmountCell value={row.payout} currency={row.currency} formatAmount={fmt} />,
  },
  {
    key: 'winAmount',
    header: 'Win Amt',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => <AmountCell value={row.winAmount} currency={row.currency} formatAmount={fmt} />,
  },
  {
    key: 'pl',
    header: 'P/L',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => <PLCell value={row.netAmount ?? null} currency={row.currency} formatAmount={fmt} />,
  },
  {
    key: 'result',
    header: 'Result',
    minW: '70px',
    render: (row) => {
      const s = String(row.status).toLowerCase()
      if (s === 'won') return <span className={clsx(styles.text, styles.strong, styles.pos)}>Won</span>
      if (s === 'lost') return <span className={clsx(styles.text, styles.strong, styles.neg)}>Lost</span>
      return <span className={clsx(styles.text, styles.secondary)}>—</span>
    },
  },
  {
    key: 'status',
    header: 'Status',
    minW: '90px',
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'details',
    header: 'Details',
    minW: '60px',
    align: 'center',
    render: (row) => <CasinoDetailsPopover row={row} />,
  },
]

const getMatkaCols = (formatDate: (d: string, f?: string) => string, formatTime: (d: string, f?: string) => string): ColDef[] => [
  ...getCommonColsStart(formatDate, formatTime),
  {
    key: 'matka',
    header: 'Matka',
    minW: '140px',
    render: (row) => (
      <div className={styles.text}>
        <span className={clsx(styles.text, styles.strong)}>{row.matkaName || row.marketName || '—'}</span>
        {row.matkaType && (
          <StatusPill tone="info">
            {row.matkaType}
          </StatusPill>
        )}
      </div>
    ),
  },
  {
    key: 'session',
    header: 'Session',
    minW: '80px',
    render: (row) => (
      <span className={styles.text}>
        {row.marketSession || '—'}
      </span>
    ),
  },
  {
    key: 'bidType',
    header: 'Bid Type',
    minW: '80px',
    render: (row) => (
      <StatusPill tone="info">
        {row.bidType || '—'}
      </StatusPill>
    ),
  },
  {
    key: 'numbers',
    header: 'Numbers',
    minW: '90px',
    render: (row) => (
      <span className={clsx(styles.text, styles.strong, styles.mono)}>{row.bidNumbers || '—'}</span>
    ),
  },
  {
    key: 'stake',
    header: 'Stake',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => <AmountCell value={row.stake} currency={row.currency} formatAmount={fmt} bold />,
  },
  {
    key: 'multiplier',
    header: 'Multiplier',
    align: 'right',
    minW: '80px',
    render: (row) => (
      <span className={styles.text}>
        {row.payoutMultiplier != null ? `${Number(row.payoutMultiplier).toFixed(1)}x` : '—'}
      </span>
    ),
  },
  {
    key: 'potentialWin',
    header: 'Potential Win',
    align: 'right',
    minW: '100px',
    render: (row, fmt) => <AmountCell value={row.potentialWin} currency={row.currency} formatAmount={fmt} />,
  },
  {
    key: 'pl',
    header: 'P/L',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => {
      const s = String(row.status).toLowerCase()
      if (s === 'void' || s === 'cancelled') return <PLCell value={0} currency={row.currency} formatAmount={fmt} />
      if (row.actualWin != null) {
        const pl = Number(row.actualWin) - Number(row.stake)
        return <PLCell value={pl} currency={row.currency} formatAmount={fmt} />
      }
      return <span className={clsx(styles.text, styles.secondary)}>—</span>
    },
  },
  {
    key: 'result',
    header: 'Result',
    minW: '70px',
    render: (row) => {
      if (row.result) return <span className={clsx(styles.text, styles.strong, styles.mono)}>{row.result}</span>
      const s = String(row.status).toLowerCase()
      if (s === 'won') return <span className={clsx(styles.text, styles.strong, styles.pos)}>Won</span>
      if (s === 'lost') return <span className={clsx(styles.text, styles.strong, styles.neg)}>Lost</span>
      if (s === 'void' || s === 'cancelled') return <span className={clsx(styles.text, styles.secondary, styles.strong)}>{s === 'void' ? 'Void' : 'Cancelled'}</span>
      return <span className={clsx(styles.text, styles.secondary)}>—</span>
    },
  },
  {
    key: 'status',
    header: 'Status',
    minW: '90px',
    render: (row) => <StatusBadge status={row.status} />,
  },
]

// Preserve the existing column-builder export for consumers.
// eslint-disable-next-line react-refresh/only-export-components
export const getAllCols = (formatDate: (d: string, f?: string) => string, formatTime: (d: string, f?: string) => string): ColDef[] => [
  {
    key: 'time',
    header: 'Time',
    minW: '110px',
    render: (row) => (
      <div>
        <div className={styles.text}>{row.createdAt ? formatDate(row.createdAt, 'dd MMM yy') : '—'}</div>
        <div className={clsx(styles.text, styles.secondary)}>{row.createdAt ? formatTime(row.createdAt, 'HH:mm:ss') : '—'}</div>
      </div>
    ),
  },
  {
    key: 'domain',
    header: 'Domain',
    minW: '85px',
    render: (row) => <DomainBadge product={row.product} />,
  },
  {
    key: 'wallet',
    header: 'Wallet',
    minW: '70px',
    render: (row) => <WalletBadge walletType={row.walletType} />,
  },
  {
    key: 'campaign',
    header: 'Campaign',
    minW: '110px',
    render: (row) => <CampaignCell campaign={row.campaign} />,
  },
  {
    key: 'event_game',
    header: 'Event / Game',
    minW: '180px',
    render: (row) => {
      if (row.product === 'sports') {
        const parts = [row.sportName, row.leagueName, row.eventName].filter(Boolean)
        return (
          <Tooltip content={parts.join(' › ')} placement="top-start">
            <div className={clsx(styles.text, styles.truncate)}>
              <span className={clsx(styles.text, styles.secondary)}>{row.sportName ?? ''}</span>
              {row.leagueName && <span className={clsx(styles.text, styles.secondary)}> › </span>}
              <span className={clsx(styles.text, styles.strong)}>{row.eventName ?? row.leagueName ?? ''}</span>
            </div>
          </Tooltip>
        )
      }
      if (row.product === 'casino') {
        return <span className={clsx(styles.text, styles.strong, styles.truncate)}>{row.gameName || '—'}</span>
      }
      return (
        <div className={styles.text}>
          <span className={clsx(styles.text, styles.strong)}>{row.matkaName || row.marketName || '—'}</span>
          {row.matkaType && (
            <StatusPill tone="info">{row.matkaType}</StatusPill>
          )}
        </div>
      )
    },
  },
  {
    key: 'market_vendor',
    header: 'Market / Vendor',
    minW: '120px',
    render: (row) => {
      if (row.product === 'sports') {
        return <span className={clsx(styles.text, styles.truncate)}>{row.marketName || '—'}</span>
      }
      if (row.product === 'casino') {
        return <span className={clsx(styles.text, styles.truncate)}>{row.vendorName || row.providerName || '—'}</span>
      }
      return <span className={styles.text}>{row.bidType || '—'}</span>
    },
  },
  {
    key: 'type_side',
    header: 'Type',
    minW: '60px',
    align: 'center',
    render: (row) => {
      if (row.product === 'sports') return <SideBadge side={row.side} />
      if (row.product === 'matka') {
        return <span className={clsx(styles.text, styles.mono)}>{row.bidNumbers || '—'}</span>
      }
      return <span className={clsx(styles.text, styles.secondary)}>—</span>
    },
  },
  {
    key: 'stake',
    header: 'Stake',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => <AmountCell value={row.stake} currency={row.currency} formatAmount={fmt} bold />,
  },
  {
    key: 'odds_mult',
    header: 'Odds',
    align: 'right',
    minW: '70px',
    render: (row) => {
      if (row.product === 'sports') {
        if (row.odds == null) return <span className={clsx(styles.text, styles.secondary)}>—</span>
        if (row.oddsSize != null) return <span className={styles.text}>{Number(row.oddsSize).toFixed(0)}/{Number(row.odds).toFixed(2)}</span>
        return <span className={styles.text}>{Number(row.odds).toFixed(2)}</span>
      }
      if (row.product === 'matka') {
        return <span className={styles.text}>{row.payoutMultiplier != null ? `${Number(row.payoutMultiplier).toFixed(1)}x` : '—'}</span>
      }
      return <span className={clsx(styles.text, styles.secondary)}>—</span>
    },
  },
  {
    key: 'liability_payout',
    header: 'Liability',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => {
      if (row.product === 'sports') return <AmountCell value={row.liability} currency={row.currency} formatAmount={fmt} />
      if (row.product === 'casino') return <AmountCell value={row.payout} currency={row.currency} formatAmount={fmt} />
      return <AmountCell value={row.potentialWin} currency={row.currency} formatAmount={fmt} />
    },
  },
  {
    key: 'pl',
    header: 'P/L',
    align: 'right',
    minW: '90px',
    render: (row, fmt) => {
      if (row.product === 'sports') {
        return <PLCell value={row.pl ?? null} currency={row.currency} formatAmount={fmt} />
      }
      if (row.product === 'casino') {
        return <PLCell value={row.netAmount ?? null} currency={row.currency} formatAmount={fmt} />
      }
      const s = String(row.status).toLowerCase()
      if (s === 'void' || s === 'cancelled') return <PLCell value={0} currency={row.currency} formatAmount={fmt} />
      if (row.actualWin != null) return <PLCell value={Number(row.actualWin) - Number(row.stake)} currency={row.currency} formatAmount={fmt} />
      return <span className={clsx(styles.text, styles.secondary)}>—</span>
    },
  },
  {
    key: 'result',
    header: 'Result',
    minW: '100px',
    render: (row) => {
      const s = String(row.status).toLowerCase()
      if (row.product === 'sports') {
        const statusLabel = s === 'won' ? 'Won' : s === 'lost' ? 'Lost' : s === 'void' ? 'Void' : s === 'cancelled' ? 'Cancelled' : null
        const statusColor = s === 'won' ? styles.pos : s === 'lost' ? styles.neg : styles.secondary
        if (!statusLabel && !row.eventResult) return <span className={clsx(styles.text, styles.secondary)}>—</span>
        return (
          <div className={clsx(styles.text, styles.lines)}>
            {row.eventResult && <div className={clsx(styles.text, styles.strong, styles.truncate)} title={row.eventResult}>{row.eventResult}</div>}
            {statusLabel && <div className={clsx(styles.strong, statusColor)}>{statusLabel}</div>}
          </div>
        )
      }
      if (row.product === 'casino') {
        if (s === 'won') return <span className={clsx(styles.text, styles.strong, styles.pos)}>Won</span>
        if (s === 'lost') return <span className={clsx(styles.text, styles.strong, styles.neg)}>Lost</span>
        return <span className={clsx(styles.text, styles.secondary)}>—</span>
      }
      if (row.result) return <span className={clsx(styles.text, styles.mono)}>{row.result}</span>
      if (s === 'won') return <span className={clsx(styles.text, styles.strong, styles.pos)}>Won</span>
      if (s === 'lost') return <span className={clsx(styles.text, styles.strong, styles.neg)}>Lost</span>
      if (s === 'void' || s === 'cancelled') return <span className={clsx(styles.text, styles.secondary, styles.strong)}>{s === 'void' ? 'Void' : 'Cancelled'}</span>
      return <span className={clsx(styles.text, styles.secondary)}>—</span>
    },
  },
  {
    key: 'status',
    header: 'Status',
    minW: '90px',
    render: (row) => <StatusBadge status={row.status} />,
  },
]
export function BetsTab({ playerId, dateRange, dateFrom, dateTo }: BetsTabProps) {
  const { formatAmount } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [walletTypeFilter, setWalletTypeFilter] = useState<string>('')
  const [searchText, setSearchText] = useState<string>('')
  const [networkErrorSkip, setNetworkErrorSkip] = useState(false)
  const [lastNetworkError, setLastNetworkError] = useState<string | null>(null)
  const handledNetworkFailure = useRef<Error | null>(null)
  const [activeProductTab, setActiveProductTab] = useState<ProductTab>('sports')
  // Per-tab pagination state: { sports: [page, pageSize], casino: [...], matka: [...] }
  const [tabPages, setTabPages] = useState<Record<ProductTab, { page: number; pageSize: number }>>({
    sports: { page: 1, pageSize: DEFAULT_PAGE_SIZE },
    casino: { page: 1, pageSize: DEFAULT_PAGE_SIZE },
    matka:  { page: 1, pageSize: DEFAULT_PAGE_SIZE },
  })
  // Stable totals per tab — not clobbered while a new page is loading
  const [tabTotals, setTabTotals] = useState<Record<ProductTab, number>>({ sports: 0, casino: 0, matka: 0 })

  const resolvedDates = useMemo(() => resolveDateRange(dateRange, dateFrom, dateTo), [dateRange, dateFrom, dateTo])

  // Reset pages + network error when filters change
  const filterKey = `${playerId}-${statusFilter}-${walletTypeFilter}-${searchText}-${resolvedDates.from || ''}-${resolvedDates.to || ''}`
  const prevFilterKey = useRef(filterKey)
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey
      setNetworkErrorSkip(false)
      setLastNetworkError(null)
      setTabPages({
        sports: { page: 1, pageSize: DEFAULT_PAGE_SIZE },
        casino: { page: 1, pageSize: DEFAULT_PAGE_SIZE },
        matka:  { page: 1, pageSize: DEFAULT_PAGE_SIZE },
      })
      setTabTotals({ sports: 0, casino: 0, matka: 0 })
    }
  }, [filterKey])

    const { page: currentPage, pageSize } = tabPages[activeProductTab]
  const offset = (currentPage - 1) * pageSize

  const { data, loading, error, refetch } = useQuery<{ playerBets: { items: BetRow[]; total: number; hasMore: boolean } }>(PLAYER_BETS_QUERY, {
    variables: {
      playerId,
      filter: {
        product: activeProductTab,
        status: statusFilter || null,
        walletType: walletTypeFilter || null,
        search: searchText.trim() || null,
        dateFrom: resolvedDates.from || null,
        dateTo: resolvedDates.to || null,
        limit: pageSize,
        offset,
      },
    },
    skip: networkErrorSkip,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  })
  useEffect(() => {
    if (error?.networkError && handledNetworkFailure.current !== error.networkError) {
      handledNetworkFailure.current = error.networkError
      setLastNetworkError(error.message); setNetworkErrorSkip(true)
    }
  }, [error])

  // Commit stable total once data has loaded (not mid-flight)
  useEffect(() => {
    if (!loading && data?.playerBets != null) {
      const newTotal = data.playerBets.total ?? 0
      setTabTotals((prev) => ({ ...prev, [activeProductTab]: newTotal }))
      setTabPages(prev => {
        const tab = prev[activeProductTab]
        const page = Math.min(tab.page, Math.max(1, Math.ceil(newTotal / tab.pageSize)))
        return page === tab.page ? prev : { ...prev, [activeProductTab]: { ...tab, page } }
      })
    }
  }, [loading, data, activeProductTab])

  const handleRefresh = useCallback(() => {
    setLastNetworkError(null)
    if (networkErrorSkip) {
      setNetworkErrorSkip(false)
    } else {
      void refetch().catch(() => undefined)
    }
  }, [networkErrorSkip, refetch])

  const setTabPage = useCallback((tab: ProductTab, page: number) => {
    setTabPages((prev) => ({ ...prev, [tab]: { ...prev[tab], page } }))
  }, [])
  const setTabPageSize = useCallback((tab: ProductTab, size: number) => {
    setTabPages((prev) => ({ ...prev, [tab]: { page: 1, pageSize: size } }))
  }, [])

  const bets: BetRow[] = data?.playerBets?.items || []
  const displayTotal = tabTotals[activeProductTab]

  // Search and every other filter are applied before the database counts and pages the results.
  const filteredBets = bets
  const { totalStake, totalPL, currency: defaultCurrency } = playerBetTotals(filteredBets)

  const formatBetAmount = (amount: number, currency?: string) => formatAmount(amount, currency)

  const activeFilterCount =
    (searchText ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (walletTypeFilter ? 1 : 0)

  const handleClearAll = useCallback(() => {
    setSearchText('')
    setStatusFilter('')
    setWalletTypeFilter('')
  }, [])

  const client = useApolloClient()
  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    setExporting(true)
    try {
    const all: BetRow[] = []
    for (let offset = 0; ; offset += 500) {
      const result = await client.query({ query: PLAYER_BETS_QUERY, variables: { playerId, filter: {
        product: activeProductTab, status: statusFilter || null, walletType: walletTypeFilter || null,
        search: searchText.trim() || null, dateFrom: resolvedDates.from || null, dateTo: resolvedDates.to || null,
        limit: 500, offset,
      } }, fetchPolicy: 'network-only' })
      const batch: BetRow[] = result.data?.playerBets?.items ?? []
      all.push(...batch)
      if (!batch.length || all.length >= (result.data?.playerBets?.total ?? 0)) break
    }
    const csv = playerBetsCsv(all)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bets-${playerId}-${format(new Date(), 'yyyyMMdd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    } catch (error) {
      toast({ title: 'Export failed', message: error instanceof Error ? error.message : 'Unable to export bets.', tone: 'error' })
    } finally { setExporting(false) }
  }


  const handleRetry = () => { setLastNetworkError(null); if (networkErrorSkip) setNetworkErrorSkip(false); else void refetch().catch(() => undefined) }
  const columns = activeProductTab === 'sports' ? getSportsCols(formatDate, formatTime) : activeProductTab === 'casino' ? getCasinoCols(formatDate, formatTime) : getMatkaCols(formatDate, formatTime)
  const tableColumns: DataTableColumn<BetRow>[] = columns.map(column => ({ key: column.key, header: column.header, align: column.align, minWidth: Number.parseInt(column.minW ?? '') || undefined, cell: row => column.render(row, formatBetAmount) }))
  const errorState = Boolean(error || networkErrorSkip)
  return <div className={styles.stack}>
    {!errorState && <div className={styles.metrics}>
      <Stat label="Total Bets" value={(tabTotals.sports + tabTotals.casino + tabTotals.matka).toLocaleString()} note={`Current-page stake: ${formatBetAmount(totalStake, defaultCurrency)}`} tooltip="Product totals populate when their tabs load; monetary totals are the currently filtered page." hue="blu" />
      <Stat label="Sports" value={tabTotals.sports.toLocaleString()} note="Exchange bets" hue="grn" />
      <Stat label="Casino" value={tabTotals.casino.toLocaleString()} note="Live & Slots" hue="amb" />
      <Stat label="Matka" value={tabTotals.matka.toLocaleString()} note="Worli / Starline" hue="vio" />
      <Stat label="Profit / Loss" value={(totalPL >= 0 ? '+' : '-') + formatBetAmount(Math.abs(totalPL), defaultCurrency)} note={`Current page · ${totalPL >= 0 ? 'Player winning' : 'House winning'}`} hue={totalPL >= 0 ? 'red' : 'grn'} />
    </div>}
    <FilterBar label="Bet filters" activeCount={activeFilterCount} onClearAll={handleClearAll} search={<TextField label="Search bets" hideLabel size="sm" placeholder="Search event, game, market or selection…" value={searchText} onChange={setSearchText} clearable />}>
      <Select label="Status" size="sm" value={statusFilter} onChange={setStatusFilter} options={[{value:'',label:'All Status'},...['pending','active','matched','won','lost','settled','void','cancelled'].map(value=>({value,label:value.charAt(0).toUpperCase()+value.slice(1)}))]} />
      <Select label="Wallet" size="sm" value={walletTypeFilter} onChange={setWalletTypeFilter} options={[{value:'',label:'All Wallet'},{value:'cash',label:'Cash'},{value:'bonus',label:'Bonus'},{value:'referralBonus',label:'Referral Bonus'}]} />
    </FilterBar>
    <Card title="Player bets" body="table" tools={<><Tabs label="Bet product tabs" idPrefix="player-profile-bets" value={activeProductTab} onChange={setActiveProductTab}
      items={(['sports','casino','matka'] as const).map(value=>({value,label:`${value.charAt(0).toUpperCase()+value.slice(1)} (${tabTotals[value] > 99999 ? '99999+' : tabTotals[value]})`}))} />
      <Button size="sm" loading={loading} onClick={handleRefresh}>Refresh bets</Button><Button size="sm" loading={exporting} onClick={() => void handleExport()}>Export</Button></>}>
      {errorState ? <Notice tone="error" title="Error loading bets" action={<Button onClick={handleRetry}>Retry</Button>}>{error?.message ?? lastNetworkError ?? 'A network error stopped automatic requests. Retry to reconnect.'}</Notice>
        : <div role="tabpanel" id={`player-profile-bets-panel-${activeProductTab}`} aria-labelledby={`player-profile-bets-tab-${activeProductTab}`}>
          <DataTable label={`${activeProductTab.charAt(0).toUpperCase()+activeProductTab.slice(1)} player bets`} columns={tableColumns} rows={filteredBets} rowKey={row=>row.id} width="wide" state={loading ? 'loading' : 'ready'}
            empty={<EmptyState title="No bets found" />} pagination={{ current: currentPage, pageSize, total: displayTotal, onChange: page=>setTabPage(activeProductTab,page), onPageSizeChange: size=>setTabPageSize(activeProductTab,size), itemName:'bets', pageSizeOptions:PAGE_SIZE_OPTIONS }} />
        </div>}
    </Card>
  </div>
}
