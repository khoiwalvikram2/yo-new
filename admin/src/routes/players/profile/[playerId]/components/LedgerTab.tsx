import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, gql } from '@apollo/client'
import { IconTrophy, IconWallet, IconBuildingBank, IconGift, IconBolt, IconArrowBackUp, IconArrowsExchange, IconUsers, IconDownload, IconLink, IconInfoCircle } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { ROUTES } from '@/shared/core/constants'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { StatusPill } from '@/ui/components/StatusPill'
import { CopyButton } from '@/ui/components/CopyButton'
import { IconButton } from '@/ui/components/IconButton'
import { Popover } from '@/ui/components/Popover'
import { Select } from '@/ui/components/Select'
import { DateField } from '@/ui/components/DateField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { FilterBar } from '@/ui/components/FilterBar'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import styles from '../PlayerProfile.module.css'

/** Row shape for Reference cell (referenceType, referenceId, meta from wallet_ledger) */
interface LedgerReferenceRow {
  referenceType?: string | null
  referenceId?: string | null
  meta?: Record<string, unknown> | null
}

/** Ledger item shape from playerWalletLedger query (for export/table) */
interface WalletLedgerItem {
  id: string
  walletType?: string
  createdAt?: string | null
  category?: string | null
  description?: string | null
  amount?: string | number
  direction?: string
  balanceBefore?: string | number | null
  balanceAfter?: string | number | null
  referenceType?: string | null
  referenceId?: string | null
  meta?: Record<string, unknown> | null
}


const PLAYER_WALLET_LEDGER_QUERY = gql`
  query PlayerWalletLedger($playerId: ID!, $filter: WalletLedgerFilter!) {
    playerWalletLedger(playerId: $playerId, filter: $filter) {
      items {
        id
        walletType
        category
        direction
        amount
        balanceBefore
        balanceAfter
        description
        referenceType
        referenceId
        meta
        createdAt
      }
      total
      hasMore
    }
  }
`

type CategoryFilterOverride = { category?: string; categories?: string[]; direction?: string; includeAdjustmentDirection?: string }
const CATEGORY_FILTER_MAP: Record<string, CategoryFilterOverride> = {
  deposit_group: { categories: ['deposit', 'deposit_pending'], includeAdjustmentDirection: 'credit' },
  withdrawal_group: { categories: ['withdrawal', 'withdrawal_pending', 'withdrawal_completed', 'withdrawal_refund'], includeAdjustmentDirection: 'debit' },
  manual_deposit: { category: 'admin_adjustment', direction: 'credit' },
  manual_withdrawal: { category: 'admin_adjustment', direction: 'debit' },
}

const MAIN_TAB_OPTIONS = [
  { label: 'Cash', value: 'cash' },
  { label: 'Bonus', value: 'bonus' },
  { label: 'Referral', value: 'referral' },
] as const

const REFERRAL_SUB_OPTIONS = [
  { label: 'Referral Balance', value: 'referralBalance' },
  { label: 'Referral Bonus', value: 'referralBonus' },
] as const

const CATEGORY_SELECT_OPTIONS = [
  {
    label: 'Groups',
    options: [
      { label: 'All Deposits', value: 'deposit_group' },
      { label: 'All Withdrawals', value: 'withdrawal_group' },
    ],
  },
  {
    label: 'Deposit',
    options: [
      { label: 'Deposit', value: 'deposit' },
      { label: 'Deposit Pending', value: 'deposit_pending' },
      { label: 'Manual Deposit', value: 'manual_deposit' },
      { label: 'Crypto Deposit Bonus', value: 'crypto_deposit_bonus' },
    ],
  },
  {
    label: 'Withdrawal',
    options: [
      { label: 'Withdrawal', value: 'withdrawal' },
      { label: 'Withdrawal Pending', value: 'withdrawal_pending' },
      { label: 'Withdrawal Completed', value: 'withdrawal_completed' },
      { label: 'Withdrawal Refund', value: 'withdrawal_refund' },
      { label: 'Manual Withdrawal', value: 'manual_withdrawal' },
    ],
  },
  {
    label: 'Casino',
    options: [
      { label: 'Casino Bet', value: 'casino_bet' },
      { label: 'Casino Win', value: 'casino_win' },
      { label: 'Casino Rollback', value: 'casino_rollback' },
    ],
  },
  {
    label: 'Sports',
    options: [
      { label: 'Sports Bet', value: 'sports_bet' },
      { label: 'Sports Settle', value: 'sports_settle' },
      { label: 'Exposure Release', value: 'sports_exposure_release' },
      { label: 'Sports Rollback', value: 'sports_rollback' },
    ],
  },
  {
    label: 'Bonus',
    options: [
      { label: 'Bonus Activation', value: 'bonus_activation' },
      { label: 'Bonus Transfer', value: 'bonus_transfer' },
      { label: 'Bonus Forfeit', value: 'bonus_forfeit' },
      { label: 'Bonus Consolidated', value: 'bonus_consolidated' },
    ],
  },
  {
    label: 'Referral',
    options: [
      { label: 'Referral Earning', value: 'referral_earning' },
      { label: 'Referral Transfer', value: 'referral_transfer' },
    ],
  },
  {
    label: 'Other',
    options: [
      { label: 'Admin Adjustment', value: 'admin_adjustment' },
    ],
  },
]

const CATEGORY_LABEL_MAP: Record<string, string> = Object.fromEntries(
  CATEGORY_SELECT_OPTIONS.flatMap((group) => group.options.map((o) => [o.value, o.label]))
)


type RefTypeConfigItem = {
  label: string
  icon: ReactNode
  idPrefix: string
  tooltipTitle?: string
  /** Returns admin path for this reference (list or detail). No link if undefined. */
  linkPath?: (referenceId: string) => string
}

const REF_TYPE_CONFIG: Record<string, RefTypeConfigItem> = {
  sports_market: { label: 'Market', icon: <IconTrophy size={14} />, idPrefix: '', tooltipTitle: 'Sports market' },
  deposit_request: { label: 'Deposit', icon: <IconWallet size={14} />, idPrefix: '#', tooltipTitle: 'Deposit request', linkPath: () => ROUTES.PAYMENTS_DEPOSITS },
  withdrawal_request: { label: 'Withdrawal', icon: <IconBuildingBank size={14} />, idPrefix: '#', tooltipTitle: 'Withdrawal request', linkPath: () => ROUTES.PAYMENTS_WITHDRAWALS },
  bonus_award: { label: 'Bonus', icon: <IconGift size={14} />, idPrefix: '#', tooltipTitle: 'Bonus award', linkPath: (id) => (id ? ROUTES.BONUSES_VIEW.replace(':id', id) : ROUTES.BONUSES_LIST) },
  casino_bet: { label: 'Casino Bet', icon: <IconBolt size={14} />, idPrefix: '', tooltipTitle: 'Casino bet' },
  casino_win: { label: 'Casino Win', icon: <IconTrophy size={14} />, idPrefix: '', tooltipTitle: 'Casino win' },
  casino_rollback: { label: 'Rollback', icon: <IconArrowBackUp size={14} />, idPrefix: '', tooltipTitle: 'Casino rollback' },
  bonus_to_cash: { label: 'Bonus Transfer', icon: <IconArrowsExchange size={14} />, idPrefix: '', tooltipTitle: 'Bonus to cash' },
  referral_settlement: { label: 'Referral', icon: <IconUsers size={14} />, idPrefix: '#', tooltipTitle: 'Referral settlement' },
  referral_transfer: { label: 'Referral Transfer', icon: <IconArrowsExchange size={14} />, idPrefix: '', tooltipTitle: 'Referral transfer' },
}


/** Type-aware meta lines for Reference cell secondary display (order matters per type) */
function getMetaDetails(row: LedgerReferenceRow & { referenceType?: string | null }): string[] {
  const meta = row.meta as Record<string, unknown> | undefined
  const refType = row.referenceType as string | undefined
  if (!meta || typeof meta !== 'object') return []

  const details: string[] = []

  switch (refType) {
    case 'withdrawal_request':
    case 'deposit_request':
      if (meta.status) details.push(`Status: ${String(meta.status)}`)
      if (meta.amount != null) details.push(`Amount: ${meta.amount}`)
      if (meta.currency) details.push(`Currency: ${meta.currency}`)
      break
    case 'bonus_award':
      if (meta.campaignId != null) details.push(`Campaign #${meta.campaignId}`)
      if (meta.releaseType) details.push(`Release: ${String(meta.releaseType).replace(/_/g, ' ')}`)
      break
    case 'casino_bet':
    case 'casino_win':
    case 'casino_rollback':
    case 'bonus_to_cash':
      if (meta.roundId) details.push(`Round: ${meta.roundId}`)
      if (meta.transactionId) details.push(`Transaction: ${meta.transactionId}`)
      if (meta.bonusAwardId != null) details.push(`Award #${meta.bonusAwardId}`)
      break
    case 'sports_market':
      if (meta.marketId) details.push(`Market: ${meta.marketId}`)
      if (meta.eventId) details.push(`Event: ${meta.eventId}`)
      if (meta.resultId) details.push(`Result: ${meta.resultId}`)
      break
    case 'admin_adjustment':
      if (meta.reason) details.push(`Reason: ${meta.reason}`)
      if (meta.note) details.push(String(meta.note))
      break
    case 'referral_settlement':
    case 'referral_transfer':
      if (meta.settlementId != null) details.push(`Settlement #${meta.settlementId}`)
      if (meta.refereeId != null) details.push(`Referee: ${meta.refereeId}`)
      break
    default:
      if (meta.roundId) details.push(`Round: ${meta.roundId}`)
      if (meta.marketId && refType !== 'sports_market') details.push(`Market: ${meta.marketId}`)
      if (meta.resultId) details.push(`Result: ${meta.resultId}`)
      if (meta.campaignId != null) details.push(`Campaign #${meta.campaignId}`)
      if (meta.bonusAwardId != null) details.push(`Award #${meta.bonusAwardId}`)
      if (meta.releaseType) details.push(`Release: ${String(meta.releaseType).replace(/_/g, ' ')}`)
      if (meta.method) details.push(`Via: ${meta.method}`)
      if (meta.oldExposure != null && meta.newExposure != null) details.push(`Exp: ${meta.oldExposure} → ${meta.newExposure}`)
  }

  return details
}

/** Build type-aware tooltip content (full IDs + meta summary) */
function getReferenceTooltipContent(row: LedgerReferenceRow & { referenceType?: string | null }): ReactNode {
  const meta = row.meta as Record<string, unknown> | undefined
  const refType = row.referenceType
  const refId = row.referenceId
  const lines: string[] = []

  if (refId) lines.push(`Reference: ${refId}`)
  if (meta && typeof meta === 'object') {
    if (meta.roundId) lines.push(`Round: ${meta.roundId}`)
    if (meta.transactionId) lines.push(`Transaction: ${meta.transactionId}`)
    if (meta.resultId) lines.push(`Result: ${meta.resultId}`)
    if (meta.bonusAwardId != null) lines.push(`Award #${meta.bonusAwardId}`)
    if (meta.campaignId != null) lines.push(`Campaign #${meta.campaignId}`)
    if (meta.marketId) lines.push(`Market: ${meta.marketId}`)
    if (meta.eventId) lines.push(`Event: ${meta.eventId}`)
    if (refType === 'withdrawal_request' || refType === 'deposit_request') {
      if (meta.status) lines.push(`Status: ${meta.status}`)
      if (meta.amount != null) lines.push(`Amount: ${meta.amount}`)
    }
    if (meta.releaseType) lines.push(`Release: ${String(meta.releaseType).replace(/_/g, ' ')}`)
  }

  if (lines.length === 0) return null
  return (
    <div className={styles.metadata}>
      {lines.map((line, i) => (
        <div key={i} className={styles.text} title={line}>{line}</div>
      ))}
    </div>
  )
}

function truncateId(id: string, maxLen = 16): string {
  if (!id || id.length <= maxLen) return id
  return id.slice(0, 7) + '…' + id.slice(-5)
}


function ReferenceCell({ row }: { row: LedgerReferenceRow }) {
  const refType = row.referenceType
  const refId = row.referenceId ?? ''
  const meta = row.meta
  if (!refType && !refId) return '—'
  const config = REF_TYPE_CONFIG[refType || ''] || { label: (refType ?? '').replace(/_/g, ' ') || 'Ref', icon: <IconLink size={14} />, idPrefix: '', tooltipTitle: 'Reference' }
  const details = getMetaDetails(row)
  const linkPath = config.linkPath && refId ? config.linkPath(refId) : undefined
  const tooltipContent = getReferenceTooltipContent(row)
  return <div className={styles.reference}>
    <span className={styles.row}><StatusPill tone="neutral">{config.label}</StatusPill>{tooltipContent ? <Popover label={config.tooltipTitle || config.label} trigger={<IconButton label={`Reference details ${refId || refType}`} size="sm" icon={<IconInfoCircle size={14} />} />}>{tooltipContent}</Popover> : null}</span>
    {refId ? <span className={styles.row}>{linkPath ? <Link to={linkPath} className={styles.link} onClick={(event) => event.stopPropagation()}>{config.idPrefix}{truncateId(refId)}</Link> : <span>{config.idPrefix}{truncateId(refId)}</span>}<CopyButton value={refId} label="Copy ID" copiedLabel="Copied" /></span> : null}
    {details.length ? <span className={styles.subtle}>{details.slice(0, 2).join(' · ')}{details.length > 2 ? ` · +${details.length - 2} more` : ''}</span> : null}
    {!refId && (meta?.roundId != null || meta?.transactionId != null) ? <CopyButton value={String(meta.roundId ?? meta.transactionId)} label={meta.roundId ? 'Copy round ID' : 'Copy transaction ID'} copiedLabel="Copied" /> : null}
  </div>
}
interface LedgerTabProps {
  playerId: string
}

export function LedgerTab({ playerId }: LedgerTabProps) {
  return (
    <RBACGuard required={[{ domain: 'players.ledger', actions: ['view'] }]}>
      <LedgerTabContent playerId={playerId} />
    </RBACGuard>
  )
}

function LedgerTabContent({ playerId }: LedgerTabProps) {
  const { formatAmount } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const [mainTab, setMainTab] = useState<string>('cash')
  const [referralSubTab, setReferralSubTab] = useState<string>('referralBalance')
  const [category, setCategory] = useState<string | undefined>(undefined)
  const [dateFrom, setDateFrom] = useState<string | undefined>(undefined)
  const [dateTo, setDateTo] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const walletType = mainTab === 'referral' ? referralSubTab : mainTab

  const filterOverride = category ? CATEGORY_FILTER_MAP[category] : undefined

  const { data, loading, error, refetch } = useQuery<{ playerWalletLedger?: { items?: WalletLedgerItem[]; total: number; hasMore: boolean } }>(PLAYER_WALLET_LEDGER_QUERY, {
    variables: {
      playerId,
      filter: {
        walletType,
        category: filterOverride ? (filterOverride.category ?? undefined) : (category || undefined),
        categories: filterOverride?.categories ?? undefined,
        direction: filterOverride?.direction ?? undefined,
        includeAdjustmentDirection: filterOverride?.includeAdjustmentDirection ?? undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
    },
    skip: !playerId,
    errorPolicy: 'all',
  })

  const result = data?.playerWalletLedger
  const items = result?.items ?? []
  const total = result?.total ?? 0

  type LedgerExportRow = {
    date: string
    category: string
    description: string
    credit: string | number
    debit: string | number
    balanceBefore: string
    balanceAfter: string
    reference: string
  }
  const resolveCategory = (cat: string, dir?: string) =>
    cat === 'admin_adjustment' ? (dir === 'credit' ? 'manual_deposit' : 'manual_withdrawal') : cat

  const handleExport = () => {
    const rows: LedgerExportRow[] = items.map((row: WalletLedgerItem) => ({
      date: row.createdAt ?? '',
      category: CATEGORY_LABEL_MAP[resolveCategory(row.category ?? '', row.direction)] ?? (row.category ?? ''),
      description: row.description ?? '',
      credit: row.amount === 0 || row.amount === '0' ? 0 : row.direction === 'credit' ? row.amount ?? '' : '',
      debit: row.amount === 0 || row.amount === '0' ? 0 : row.direction === 'debit' ? row.amount ?? '' : '',
      balanceBefore: String(row.balanceBefore ?? ''),
      balanceAfter: String(row.balanceAfter ?? ''),
      reference: [row.referenceType, row.referenceId].filter(Boolean).join(' ') || '',
    }))
    const header = ['Date', 'Category', 'Description', 'Balance Before', 'Credit', 'Debit', 'Balance After', 'Reference']
    const csv = [
      header.join(','),
      ...rows.map((r: LedgerExportRow) =>
        [r.date, r.category, `"${(r.description || '').replace(/"/g, '""')}"`, r.balanceBefore, r.credit, r.debit, r.balanceAfter, `"${(r.reference || '').replace(/"/g, '""')}"`].join(',')
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ledger-${walletType}-${playerId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }


  const activeFiltersCount = [category, dateFrom].filter(Boolean).length
  const handleClearFilters = () => { setCategory(undefined); setDateFrom(undefined); setDateTo(undefined); setPage(1) }
  const columns: DataTableColumn<WalletLedgerItem>[] = [
    { key: 'createdAt', header: 'Date / Time', minWidth: 160, cell: (row) => row.createdAt ? <span>{formatDate(row.createdAt, 'dd MMM yyyy')}<span className={styles.subtle}> · {formatTime(row.createdAt)}</span></span> : '—' },
    { key: 'category', header: 'Category', minWidth: 150, cell: (row) => row.category ? <StatusPill tone="neutral">{CATEGORY_LABEL_MAP[resolveCategory(row.category, row.direction)] ?? resolveCategory(row.category, row.direction).replace(/_/g, ' ')}</StatusPill> : '—' },
    { key: 'description', header: 'Description', minWidth: 180, cell: (row) => row.description || '—' },
    { key: 'balanceBefore', header: 'Balance Before', align: 'right', minWidth: 140, cell: (row) => row.balanceBefore != null ? formatAmount(Number(row.balanceBefore)) : '—' },
    { key: 'credit', header: 'Credit', align: 'right', minWidth: 120, cell: (row) => row.amount === 0 || row.amount === '0' ? formatAmount(0) : row.direction === 'credit' && row.amount != null ? <span className={styles.positive}>{formatAmount(Number(row.amount))}</span> : '—' },
    { key: 'debit', header: 'Debit', align: 'right', minWidth: 120, cell: (row) => row.amount === 0 || row.amount === '0' ? formatAmount(0) : row.direction === 'debit' && row.amount != null ? <span className={styles.negative}>{formatAmount(Number(row.amount))}</span> : '—' },
    { key: 'balanceAfter', header: 'Balance After', align: 'right', minWidth: 140, cell: (row) => row.balanceAfter != null ? formatAmount(Number(row.balanceAfter)) : '—' },
    { key: 'reference', header: 'Reference', minWidth: 230, cell: (row) => <ReferenceCell row={row} /> },
  ]
  const walletLabel = mainTab === 'referral' ? referralSubTab === 'referralBalance' ? 'Referral Balance' : 'Referral Bonus' : mainTab.charAt(0).toUpperCase() + mainTab.slice(1)
  return <div className={styles.stack}>
    <div className={styles.row}><SegmentedControl label="Ledger wallet" value={mainTab} options={MAIN_TAB_OPTIONS} onChange={(next) => { setMainTab(next); setPage(1) }} />
      {mainTab === 'referral' ? <SegmentedControl label="Referral wallet" value={referralSubTab} options={REFERRAL_SUB_OPTIONS} size="sm" onChange={(next) => { setReferralSubTab(next); setPage(1) }} /> : null}
    </div>
    <FilterBar label="Ledger filters" activeCount={activeFiltersCount} onClearAll={handleClearFilters}>
      <Select label="Category" value={category || ''} options={[{ label: 'All categories', value: '' }, ...CATEGORY_SELECT_OPTIONS.flatMap((group) => group.options)]} onChange={(next) => { setCategory(next || undefined); setPage(1) }} />
      <DateField label="Start date" value={dateFrom || ''} max={dateTo} onChange={(next) => { setDateFrom(next || undefined); setPage(1) }} />
      <DateField label="End date" value={dateTo || ''} min={dateFrom} onChange={(next) => { setDateTo(next || undefined); setPage(1) }} />
    </FilterBar>
    {error ? <Notice title="Failed to load ledger" tone="error">{error.message || 'Please try again or check your connection.'}</Notice> : null}
    <Card title={`Ledger — ${walletLabel}`} sub={`${total} ${total === 1 ? 'entry' : 'entries'}`} body="table" tools={<Button size="sm" icon={<IconDownload size={16} />} onClick={handleExport}>Export</Button>}>
      <DataTable columns={columns} rows={items} rowKey={(row) => row.id} label="Player wallet ledger" width="wide" state={loading ? 'loading' : error ? 'error' : 'ready'} error={error?.message} onRetry={() => void refetch()} empty={<EmptyState title="No ledger entries for this wallet" />} pagination={{ current: page, pageSize, total, onChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1) }, pageSizeOptions: [20, 50, 100], itemName: 'entries' }} />
    </Card>
  </div>
}
