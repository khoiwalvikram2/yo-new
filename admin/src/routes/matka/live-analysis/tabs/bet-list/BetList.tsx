import type { MatkaBet } from '../../liveUiModel'
import { toast } from '@/ui/components/toast'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { FilterBar } from '@/ui/components/FilterBar'
import { TextField } from '@/ui/components/TextField'
import { Select } from '@/ui/components/Select'
import { Combobox } from '@/ui/components/Combobox'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../../MatkaLiveUi.module.css'
import { useQuery, useApolloClient } from '@apollo/client'
import { useMemo, useState, useEffect } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { gql } from '@apollo/client'
import dayjs from 'dayjs'
import { useMatkaLiveStore } from '@/state/matkaLiveStore'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

const MATKA_BETS_QUERY = gql`
  query MatkaLiveBetsPage($filters: BetsPageFilters, $offset: Int, $limit: Int) {
    betsPage(domain: MATKA, filters: $filters, offset: $offset, limit: $limit) {
      total items { ... on MatkaBet { id userId userName matkaId matkaName matkaType marketName marketSession bidType betNumbers betAmount potentialWin actualWin payoutMultiplier status currency createdAt } }
    }
    betsFilterOptions(domain: MATKA, filters: $filters) { matkaNames marketNames bidTypes }
  }
`


export const BetList: React.FC = () => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatTime } = useFormatDate()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [matkaFilter, setMatkaFilter] = useState<string | undefined>(undefined)
  const [marketFilter, setMarketFilter] = useState<string | undefined>(undefined)
  const [bidTypeFilter, setBidTypeFilter] = useState<string | undefined>(undefined)
  const [betAmountRange, setBetAmountRange] = useState<string | undefined>(undefined)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const savedViews = useMatkaLiveStore(s => s.savedViews)
  const saveView = useMatkaLiveStore(s => s.saveView)
  const deleteView = useMatkaLiveStore(s => s.deleteView)
  const [selectedView, setSelectedView] = useState<string | undefined>(undefined)
  const permissions = useAuthStore(s => s.permissions)
  const canViewFinance = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const fmt = (v: number) => (canViewFinance ? formatAmount(convertFromWhitelabelCurrency(v)) : '••••')

  const client = useApolloClient()
  const queryVariables = useMemo(() => {
    const [min, max] = (betAmountRange || '').replace('+','').split('-').map(Number)
    return { filters: { status: [statusFilter || 'pending'], search: searchQuery.trim() || undefined,
      matkaName: matkaFilter, marketName: marketFilter, bidType: bidTypeFilter,
      stakeMin: betAmountRange && Number.isFinite(min) ? min : undefined,
      stakeMax: betAmountRange?.includes('-') && Number.isFinite(max) ? max : undefined,
    }, offset: (currentPage-1)*pageSize, limit: pageSize }
  }, [statusFilter, searchQuery, matkaFilter, marketFilter, bidTypeFilter, betAmountRange, currentPage, pageSize])
  const { data, loading, error, refetch } = useQuery<{ betsPage: {items: MatkaBet[]; total: number}; betsFilterOptions: {matkaNames: string[]; marketNames: string[]; bidTypes: string[]} }>(MATKA_BETS_QUERY, { variables: queryVariables, pollInterval: 5000, fetchPolicy: 'network-only', notifyOnNetworkStatusChange: true })
  const paginatedBets = data?.betsPage?.items ?? []
  const total = data?.betsPage?.total ?? 0
  const uniqueMatkas = data?.betsFilterOptions?.matkaNames ?? []
  const uniqueMarkets = data?.betsFilterOptions?.marketNames ?? []
  const uniqueBidTypes = data?.betsFilterOptions?.bidTypes ?? []
  useEffect(() => { if (!loading && data) setCurrentPage(page => Math.min(page, Math.max(1, Math.ceil(total/pageSize)))) }, [loading, data, total, pageSize])
  const [exporting, setExporting] = useState(false)
  const handleExportCsv = async () => {
    setExporting(true)
    try {
    const all: MatkaBet[] = []
    for (let offset = 0; ; offset += 500) {
      const result = await client.query({ query: MATKA_BETS_QUERY, variables: {...queryVariables,offset,limit:500}, fetchPolicy: 'network-only' })
      const page = result.data?.betsPage
      const batch: MatkaBet[] = page?.items ?? []; all.push(...batch)
      if (!batch.length || all.length >= (page?.total ?? 0)) break
    }
    const rows = all.map((b: MatkaBet) => ({
      time: b.createdAt,
      userId: b.userId,
      userName: b.userName || '',
      matkaId: b.matkaId,
      matkaName: b.matkaName || '',
      matkaType: b.matkaType,
      marketName: b.marketName,
      marketSession: b.marketSession || '',
      bidType: b.bidType,
      betNumbers: b.betNumbers,
      betAmount: b.betAmount,
      potentialWin: b.potentialWin || '',
      payoutMultiplier: b.payoutMultiplier,
      status: b.status,
    }))
    const header = Object.keys(rows[0] || {}).join(',')
    const csv = [header, ...rows.map((r) => Object.values(r).map((v: unknown) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `matka-bets-${dayjs().format('YYYYMMDD-HHmmss')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    } catch (error) {
      toast({ title: 'Export failed', message: error instanceof Error ? error.message : 'Unable to export Matka bets.', tone: 'error' })
    } finally { setExporting(false) }
  }

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, matkaFilter, marketFilter, bidTypeFilter, betAmountRange])

  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (statusFilter) count++
    if (matkaFilter) count++
    if (marketFilter) count++
    if (bidTypeFilter) count++
    if (betAmountRange) count++
    return count
  }, [statusFilter, matkaFilter, marketFilter, bidTypeFilter, betAmountRange])

  const tableStatus = statusFilter || ''
  const setTableStatus = (value: string) => setStatusFilter(value || undefined)
  const columns: DataTableColumn<MatkaBet>[] = [
    { key: 'time', header: 'Time', minWidth: 120, sort: (a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf(), cell: row => row.createdAt ? formatTime(row.createdAt, 'HH:mm:ss') : '—' },
    { key: 'user', header: 'User', minWidth: 170, cell: row => <div className={styles.stack}><strong>{row.userName || `User #${row.userId}`}</strong><span className={styles.muted}>ID: {row.userId}</span></div> },
    { key: 'matka', header: 'Matka', minWidth: 190, cell: row => <div className={styles.stack}><strong>{row.matkaName || `Matka #${row.matkaId}`}</strong><StatusPill tone="info">{row.matkaType}</StatusPill></div> },
    { key: 'market', header: 'Market', minWidth: 150, cell: row => <div className={styles.stack}><span>{row.marketName}</span>{row.marketSession && <span className={styles.muted}>{row.marketSession}</span>}</div> },
    { key: 'bid', header: 'Bid Type', minWidth: 110, cell: row => <StatusPill>{row.bidType}</StatusPill> },
    { key: 'numbers', header: 'Bet Numbers', minWidth: 130, cell: row => row.betNumbers },
    { key: 'amount', header: 'Bet Amount', minWidth: 140, align: 'right', sort: (a, b) => a.betAmount - b.betAmount, cell: row => fmt(row.betAmount) },
    { key: 'potential', header: 'Potential Win', minWidth: 140, align: 'right', sort: (a, b) => (a.potentialWin || 0) - (b.potentialWin || 0), cell: row => row.potentialWin ? <span className={styles.positive}>{fmt(row.potentialWin)}</span> : '-' },
    { key: 'multiplier', header: 'Multiplier', minWidth: 110, cell: row => <StatusPill tone="info">{row.payoutMultiplier}x</StatusPill> },
    { key: 'status', header: 'Status', minWidth: 125, cell: row => <StatusPill status={row.status}>{row.status.charAt(0).toUpperCase() + row.status.slice(1)}</StatusPill> },
  ]
  const loadView = (id: string) => {
    setSelectedView(id || undefined)
    const view = savedViews.find(view => view.id === id)
    if (view) { const filters = view.filters || {}; setStatusFilter(filters.statusFilter); setMatkaFilter(filters.matkaFilter); setMarketFilter(filters.marketFilter); setBidTypeFilter(filters.bidTypeFilter); setBetAmountRange(filters.betAmountRange); setSearchQuery(filters.searchQuery || '') }
  }
  // A loaded saved view stays selected, as it does when its filters are edited by hand.
  const clearFilters = () => { setSearchQuery(''); setStatusFilter(undefined); setMatkaFilter(undefined); setMarketFilter(undefined); setBidTypeFilter(undefined); setBetAmountRange(undefined); setTableStatus('') }
  const saveCurrentView = () => { const id = `betlist-${Date.now()}`; const name = `Bet List View ${savedViews.filter(view => view.view === 'betList').length + 1}`; saveView({ id, name, createdAt: new Date().toISOString(), view: 'betList', filters: { statusFilter, matkaFilter, marketFilter, bidTypeFilter, betAmountRange, searchQuery } }); setSelectedView(id) }
  return <div className={styles.stack}><Card title="Live Bet List" sub="Search and page the complete matching Matka bet history" tools={<div className={styles.inline}><Button size="sm" onClick={saveCurrentView}>Save View</Button>{selectedView && <Button size="sm" variant="danger" onClick={() => { deleteView(selectedView); setSelectedView(undefined) }}>Delete View</Button>}<Button size="sm" onClick={() => void refetch()}>Refresh</Button><Button size="sm" loading={exporting} onClick={() => void handleExportCsv()}>Export CSV</Button></div>}>
    <div className={styles.stack}>
      <FilterBar label="Matka bet filters" activeCount={activeFiltersCount} onClearAll={clearFilters} search={<TextField label="Search Matka bets" hideLabel size="sm" value={searchQuery} onChange={setSearchQuery} clearable placeholder="Search by user, matka, bet numbers, or market..." />}>
        <Select label="Saved views" size="sm" value={selectedView || ''} onChange={loadView} options={[{ label: 'Select saved view', value: '' }, ...savedViews.filter(view => view.view === 'betList').map(view => ({ label: view.name, value: view.id }))]} />
        <Select label="Status" size="sm" value={statusFilter || ''} onChange={value => setStatusFilter(value || undefined)} options={[{ label: 'Default: pending', value: '' }, ...['pending', 'active', 'won', 'lost', 'cancelled', 'void'].map(value => ({ label: value.charAt(0).toUpperCase() + value.slice(1), value }))]} />
        <Combobox label="Matka" size="sm" value={matkaFilter || null} onChange={value => setMatkaFilter(value || undefined)} clearable options={uniqueMatkas.map(value => ({ label: value, value }))} />
        <Select label="Market" size="sm" value={marketFilter || ''} onChange={value => setMarketFilter(value || undefined)} options={[{ label: 'All markets', value: '' }, ...uniqueMarkets.map(value => ({ label: value, value }))]} />
        <Select label="Bid Type" size="sm" value={bidTypeFilter || ''} onChange={value => setBidTypeFilter(value || undefined)} options={[{ label: 'All bid types', value: '' }, ...uniqueBidTypes.map(value => ({ label: value, value }))]} />
        {/* The advanced fields are cells of this bar with no wrapper to name, so the toggle controls each one. */}
        <Button size="sm" aria-expanded={advancedFiltersOpen} aria-controls="matka-bet-amount matka-bet-table-status" onClick={() => setAdvancedFiltersOpen(!advancedFiltersOpen)} variant={advancedFiltersOpen ? 'primary' : 'secondary'}>Advanced{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}</Button>
        {advancedFiltersOpen && <>
          <TextField id="matka-bet-amount" label="Bet Amount Range" size="sm" value={betAmountRange || ''} onChange={value => setBetAmountRange(value || undefined)} placeholder="e.g., 100-500 or 1000+" />
          {/* The help line sits below the bar (a cell is one row high); it still describes this select. */}
          <Select id="matka-bet-table-status" label="Table status" size="sm" value={tableStatus} onChange={setTableStatus} options={[{ label: 'Default: pending', value: '' }, ...['pending', 'active', 'won', 'lost', 'cancelled'].map(value => ({ label: value.charAt(0).toUpperCase() + value.slice(1), value }))]} aria-describedby="matka-bet-table-status-help" />
        </>}
      </FilterBar>
      {advancedFiltersOpen && <p id="matka-bet-table-status-help" className={styles.muted}>Status applies to the complete list and CSV export.</p>}
      <p className={styles.muted}>Showing {paginatedBets.length} of {total} bets</p>
      <DataTable columns={columns} rows={paginatedBets} rowKey={row => row.id} label="Live Matka bets" width="wide" state={loading ? 'loading' : error ? 'error' : 'ready'} error={error?.message} onRetry={() => void refetch()} empty={<EmptyState title={'No bets match your filters'} />} pagination={{ current: currentPage, pageSize, total, pageSizeOptions: [10, 20, 50, 100], onChange: setCurrentPage, onPageSizeChange: size => { setCurrentPage(1); setPageSize(size) } }} />
    </div>
  </Card></div>
}

