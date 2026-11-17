import { useMemo, useState, useEffect } from 'react'
import { gql, useQuery } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { Combobox } from '@/ui/components/Combobox'
import { DateTimeField } from '@/ui/components/DateTimeField'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { StatusPill } from '@/ui/components/StatusPill'
import { Pagination } from '@/ui/components/Pagination'
import { usePaymentWhitelabelScope } from '@/routes/payments/usePaymentWhitelabelScope'
import { SelectWhitelabelForBets } from '@/routes/bets/SelectWhitelabelForBets'
import { signedNet, type CasinoBet } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
const CASINO_BETS_QUERY = gql`
  query CasinoLiveBetsPage($filters: BetsPageFilters, $offset: Int, $limit: Int) {
    betsPage(domain: CASINO, filters: $filters, offset: $offset, limit: $limit) {
      total items { ... on CasinoBet { id userId userName gameId gameName providerId vendorId vendorName stake payout winAmount netAmount status currency createdAt settledAt transactionId } }
    }
    betsFilterOptions(domain: CASINO, filters: $filters) { vendorNames gameNames }
  }
`


interface BetListProps { windowMins?: number }
export function BetList({ windowMins = 10 }: BetListProps) {
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency()
  const { formatDateTime, formatTime, formatDate } = useFormatDate()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [vendorFilter, setVendorFilter] = useState<string | undefined>(undefined)
  const [gameFilter, setGameFilter] = useState<string | undefined>(undefined)
  const [stakeRange, setStakeRange] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[string, string] | null>(null)
  const [dateDraft, setDateDraft] = useState<[string, string]>(['', ''])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const defaultDateFrom = useMemo(() => nowIST().subtract(windowMins, 'minute').toISOString(), [windowMins])
  const queryVariables = useMemo(() => {
    const [min, max] = (stakeRange || '').replace('+','').split('-').map(Number)
    return { filters: {
      dateFrom: dateRange?.[0] ? dayjs.tz(dateRange[0], 'Asia/Kolkata').toISOString() : defaultDateFrom,
      dateTo: dateRange?.[1] ? dayjs.tz(dateRange[1], 'Asia/Kolkata').toISOString() : undefined,
      status: statusFilter ? [statusFilter] : undefined, search: searchQuery.trim() || undefined,
      vendorName: vendorFilter, gameName: gameFilter,
      stakeMin: stakeRange && Number.isFinite(min) ? min : undefined,
      stakeMax: stakeRange?.includes('-') && Number.isFinite(max) ? max : undefined,
    }, offset: (currentPage-1)*pageSize, limit: pageSize }
  }, [dateRange, defaultDateFrom, statusFilter, searchQuery, vendorFilter, gameFilter, stakeRange, currentPage, pageSize])
  // Bets belong to one whitelabel: with none selected (a Super Admin in core mode) nothing is queried or polled.
  const { selectionRequired } = usePaymentWhitelabelScope()
  const { data, loading, error, refetch } = useQuery<{ betsPage: {items: CasinoBet[]; total: number}; betsFilterOptions: {vendorNames: string[]; gameNames: string[]} }>(CASINO_BETS_QUERY, { variables: queryVariables, skip: selectionRequired, pollInterval: selectionRequired ? 0 : 5000, fetchPolicy: 'network-only', notifyOnNetworkStatusChange: true })
  const paginatedBets = data?.betsPage?.items ?? []
  const total = data?.betsPage?.total ?? 0
  const uniqueVendors = data?.betsFilterOptions?.vendorNames ?? []
  const uniqueGames = data?.betsFilterOptions?.gameNames ?? []
  useEffect(() => { setCurrentPage(1) }, [searchQuery, statusFilter, vendorFilter, gameFilter, stakeRange, dateRange])
  useEffect(() => { if (!loading && data) setCurrentPage(page => Math.min(page, Math.max(1, Math.ceil(total/pageSize)))) }, [loading, data, total, pageSize])
  const activeFiltersCount = [searchQuery, statusFilter, vendorFilter, gameFilter, stakeRange, dateRange].filter(Boolean).length
  const currencySymbol = getCurrencySymbol()
  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const columns: DataTableColumn<CasinoBet>[] = [
    { key: 'time', header: 'Time', cell: bet => <div className={styles.details} title={formatDateTime(bet.createdAt, 'yyyy-MM-dd HH:mm:ss')}><span>{formatTime(bet.createdAt, 'HH:mm:ss')}</span><span className={styles.muted}>{formatDate(bet.createdAt, 'MM/dd/yy')}</span></div> },
    { key: 'user', header: 'User', cell: bet => <div className={styles.details}><strong>{bet.userName || `User #${bet.userId}`}</strong><span className={styles.muted}>ID: {bet.userId}</span></div> },
    { key: 'game', header: 'Game', cell: bet => bet.gameName || `Game ${bet.gameId}` },
    { key: 'vendor', header: 'Vendor', cell: bet => bet.vendorName || '-' },
    { key: 'stake', header: 'Stake', align: 'right', cell: bet => fmt(bet.stake) },
    { key: 'payout', header: 'Payout', align: 'right', cell: bet => bet.payout ? fmt(bet.payout) : '-' },
    { key: 'net', header: 'Net', align: 'right', cell: bet => { const net = bet.netAmount ?? (bet.payout ? bet.payout - bet.stake : -bet.stake); return <strong className={net > 0 ? styles.positive : styles.negative}>{signedNet(net, fmt)}</strong> } },
    { key: 'status', header: 'Status', cell: bet => <StatusPill status={bet.status}>{bet.status.charAt(0).toUpperCase() + bet.status.slice(1)}</StatusPill> },
    { key: 'transaction', header: 'Transaction ID', cell: bet => bet.transactionId ? <span className={styles.mono} title={bet.transactionId}>{bet.transactionId.slice(0, 10)}...</span> : '-' },
  ]
  const clear = () => { setSearchQuery(''); setStatusFilter(undefined); setVendorFilter(undefined); setGameFilter(undefined); setStakeRange(undefined); setDateRange(null); setDateDraft(['', '']); setCurrentPage(1) }
  const editDate = (index: 0 | 1, value: string) => { const next: [string, string] = [...dateDraft]; next[index] = value; setDateDraft(next); setDateRange(next[0] && next[1] ? next : null) }
  if (selectionRequired) return <div className={styles.stack}><Card title="Bet List" sub="All casino bets & transactions"><SelectWhitelabelForBets /></Card></div>
  return <div className={styles.stack}>
    <Card title="Bet List" sub="All casino bets & transactions" tools={<Button size="sm" onClick={() => void refetch()}>Refresh</Button>}>
      <FilterBar label="Casino bet filters" activeCount={activeFiltersCount} onClearAll={clear} search={<SearchField label="Search casino bets" placeholder="Search user, game, transaction..." value={searchQuery} onChange={setSearchQuery} size="sm" />}>
        <Select label="Status" size="sm" value={statusFilter || ''} onChange={value => setStatusFilter(value || undefined)} options={[{ label: 'All statuses', value: '' }, ...['won', 'lost', 'pending', 'active', 'cancelled', 'void'].map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))]} />
        <Combobox label="Vendor" value={vendorFilter || null} onChange={value => setVendorFilter(value || undefined)} clearable options={uniqueVendors.map(value => ({ value, label: value }))} size="sm" />
        {/* The advanced fields are cells of this bar with no wrapper to name, so the toggle controls each one. */}
        <Button size="sm" aria-expanded={advancedFiltersOpen} aria-controls="casino-bets-game casino-bets-stake casino-bets-from casino-bets-to" onClick={() => setAdvancedFiltersOpen(value => !value)}>Advanced {[gameFilter, stakeRange, dateRange].filter(Boolean).length ? `(${[gameFilter, stakeRange, dateRange].filter(Boolean).length})` : ''}</Button>
        {advancedFiltersOpen && <>
          <Combobox id="casino-bets-game" label="Game" value={gameFilter || null} onChange={value => setGameFilter(value || undefined)} clearable options={uniqueGames.map(value => ({ value, label: value }))} size="sm" />
          <Select id="casino-bets-stake" label="Stake Range" size="sm" value={stakeRange || ''} onChange={value => setStakeRange(value || undefined)} options={[{ value: '', label: 'All stakes' }, { value: '0-10', label: `${currencySymbol}0 - ${currencySymbol}10` }, { value: '10-100', label: `${currencySymbol}10 - ${currencySymbol}100` }, { value: '100-1000', label: `${currencySymbol}100 - ${currencySymbol}1,000` }, { value: '1000-10000', label: `${currencySymbol}1,000 - ${currencySymbol}10,000` }, { value: '10000+', label: `${currencySymbol}10,000+` }]} />
          <DateTimeField id="casino-bets-from" label="Bet date From" size="sm" value={dateDraft[0]} onChange={value => editDate(0, value)} /><DateTimeField id="casino-bets-to" label="Bet date To" size="sm" value={dateDraft[1]} onChange={value => editDate(1, value)} />
        </>}
      </FilterBar>
    </Card>
    <Card title="Bets List" sub={`Showing ${paginatedBets.length} of ${total} bets`} body="table"><DataTable label="Live casino bets" columns={columns} rows={paginatedBets} rowKey={bet => bet.id} pagination={false} state={loading ? 'loading' : error ? 'error' : 'ready'} error={error?.message || 'Failed to load bets'} onRetry={() => void refetch()} empty={activeFiltersCount > 0 ? 'No bets match your filters' : 'No bets found'} />
      {total > 0 && <Pagination loading={loading} current={currentPage} pageSize={pageSize} total={total} onChange={setCurrentPage} onPageSizeChange={size => { setPageSize(size); setCurrentPage(1) }} itemName="bets" pageSizeOptions={[10, 20, 50, 100]} />}
    </Card>
  </div>
}
