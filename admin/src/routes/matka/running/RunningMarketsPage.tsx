import { useRef, useState } from 'react'
import { gql, useQuery } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { IconRefresh } from '@tabler/icons-react'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { DateField } from '@/ui/components/DateField'
import { Stat } from '@/ui/components/Stat'
import { Switch } from '@/ui/components/Switch'
import { Notice } from '@/ui/components/Notice'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { DeclareResultDrawer } from '../results/components/DeclareResultDrawer'
import styles from './RunningMarketsPage.module.css'

export const RUNNING_MARKETS = gql`query MatkaRunningMarkets($filters: MatkaRunningFilter) {
  matkaRunningMarkets(filters: $filters) { total openBetCount pendingResultCount items {
    id matkaId marketName code matkaType date session timezone resultAt betCount playerCount currency totalStake potentialPayout
    resultValue openResultValue resultStatus declareSession canDeclare
  } }
}`
export const RUNNING_BETS = gql`query MatkaRunningBets($filters: MatkaRunningFilter!) {
  matkaRunningBets(filters: $filters) { total items { id userId playerName bidType selection amount payoutMultiplier potentialPayout currency status walletType createdAt } }
}`
export interface RunningMarket {
  id: string; matkaId: string; marketName: string; code?: string; matkaType: string; date: string; session: 'open'|'close'|null
  timezone: string; resultAt: string|null; betCount: number; playerCount: number; currency: string|null; totalStake: number|null
  potentialPayout: number|null; resultValue: string|null; openResultValue: string|null; resultStatus: string; declareSession: 'open'|'close'|null; canDeclare: boolean
}
interface RunningBet { id: string; userId: string; playerName: string|null; bidType: string; selection: string; amount: number; payoutMultiplier: number; potentialPayout: number; currency: string; status: string; walletType: string; createdAt: string }
interface Filters { search?: string; date?: string; matkaType?: string; session?: string; page: number; limit: number }
const kinds = [{ value: '', label: 'All Matka types' }, { value: 'worli', label: 'Worli' }, { value: 'starline', label: 'Starline' }, { value: 'jackpot', label: 'Jackpot' }, { value: 'sattaMatka', label: 'Satta Matka' }]
const sessionName = (session: string|null) => session === 'open' ? 'Open' : session === 'close' ? 'Close' : 'Unknown session'
const kindName = (kind: string) => kinds.find(item => item.value === kind)?.label || kind
const statusText: Record<string, string> = { RESULT_PENDING: 'Result pending', OPEN_RESULT_REQUIRED: 'Open result required', SETTLEMENT_PENDING: 'Settlement pending', REVIEW_REQUIRED: 'Session needs review' }
function localTime(value: string, timezone: string) { return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) }

export default function RunningMarketsPage() {
  const scope = useUIStore(state => `${state.directorMode}:${state.selectedWhitelabelId || state.tenant}`)
  const owner = useAuthStore(state => state.user?.id || 'anonymous')
  return <RBACGuard required={[{ domain: 'matka.results', actions: ['view'] }]}><RunningMarketsContent key={`${owner}:${scope}`} /></RBACGuard>
}
function RunningMarketsContent() {
  const navigate = useNavigate(), { formatAmount } = useCurrency()
  const permissions = useAuthStore(state => state.permissions)
  const canDeclare = hasPermissionWithNested(permissions, 'matka.results', 'create')
  const [filters, setFilters] = useState<Filters>({ page: 1, limit: 20 }), [search, setSearch] = useState(''), [autoRefresh, setAutoRefresh] = useState(true)
  const [selected, setSelected] = useState<RunningMarket|null>(null), [betPage, setBetPage] = useState(1), [betLimit, setBetLimit] = useState(20), [declaration, setDeclaration] = useState<RunningMarket|null>(null), [notice, setNotice] = useState('')
  const betsRef = useRef<HTMLDivElement>(null)
  const { data, loading, error, refetch } = useQuery<{ matkaRunningMarkets: { items: RunningMarket[]; total: number; openBetCount: number; pendingResultCount: number } }>(RUNNING_MARKETS, { variables: { filters }, fetchPolicy: 'no-cache', pollInterval: autoRefresh ? 5000 : 0, notifyOnNetworkStatusChange: true })
  const { data: betData, loading: betsLoading, error: betsError, refetch: refetchBets } = useQuery<{ matkaRunningBets: { items: RunningBet[]; total: number } }>(RUNNING_BETS, { variables: { filters: { matkaId: selected?.matkaId, date: selected?.date, session: selected?.session || undefined, page: betPage, limit: betLimit } }, skip: !selected, fetchPolicy: 'no-cache', pollInterval: autoRefresh && selected ? 5000 : 0, notifyOnNetworkStatusChange: true })
  const page = data?.matkaRunningMarkets, rows = page?.items || []
  function changeFilters(next: Partial<Filters>) { setFilters(current => ({ ...current, ...next, page: 1 })); setSelected(null) }
  const money = (value: number|null, currency: string|null) => value == null || !currency ? 'Mixed currencies' : formatAmount(value, currency)
  const columns: DataTableColumn<RunningMarket>[] = [
    { key: 'market', header: 'Market / trading date', emphasis: 'key', minWidth: 190, cell: row => <div className={styles.cell}><strong>{row.marketName}</strong><span>{row.date} · {kindName(row.matkaType)}</span></div> },
    { key: 'session', header: 'Result session', minWidth: 170, cell: row => <div className={styles.cell}><strong>{sessionName(row.session)}</strong><span>{row.resultAt ? localTime(row.resultAt, row.timezone) : 'Time unavailable'}</span><small>{row.timezone}</small></div> },
    { key: 'bets', header: 'Open bets', align: 'right', cell: row => <div className={styles.cell}><strong>{row.betCount}</strong><span>{row.playerCount} players</span></div> },
    { key: 'stake', header: 'Open stake', align: 'right', cell: row => money(row.totalStake, row.currency) },
    { key: 'payout', header: 'Potential payout', align: 'right', cell: row => money(row.potentialPayout, row.currency) },
    { key: 'status', header: 'Result status', minWidth: 185, cell: row => <div className={styles.cell}><StatusPill tone={row.resultStatus === 'REVIEW_REQUIRED' || row.resultStatus === 'SETTLEMENT_PENDING' ? 'neg' : 'warn'}>{statusText[row.resultStatus] || row.resultStatus}</StatusPill>{row.resultValue ? <span>Recorded: {row.resultValue}</span> : row.resultAt && new Date(row.resultAt).getTime() <= Date.now() ? <span>Result time passed</span> : <span>Waiting for result</span>}</div> },
    { key: 'actions', header: 'Actions', minWidth: 170, cell: row => <div className={styles.actions}>
      <Button size="sm" onClick={() => { setSelected(row); setBetPage(1); setBetLimit(20); setTimeout(() => betsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }}>View bets</Button>
      {canDeclare && row.canDeclare && row.declareSession && <Button size="sm" variant="primary" onClick={() => setDeclaration(row)}>{row.resultStatus === 'OPEN_RESULT_REQUIRED' ? 'Declare Open first' : `Declare ${sessionName(row.declareSession)}`}</Button>}
    </div> },
  ]
  const betColumns: DataTableColumn<RunningBet>[] = [
    { key: 'player', header: 'Player', minWidth: 150, cell: row => <div className={styles.cell}><strong>{row.playerName || row.userId}</strong><small>ID {row.userId}</small></div> },
    { key: 'selection', header: 'Bet / number', minWidth: 150, cell: row => <div className={styles.cell}><strong>{row.selection}</strong><span>{row.bidType}</span></div> },
    { key: 'amount', header: 'Stake', align: 'right', cell: row => formatAmount(row.amount, row.currency) },
    { key: 'payout', header: 'Potential payout', align: 'right', cell: row => formatAmount(row.potentialPayout, row.currency) },
    { key: 'wallet', header: 'Wallet / status', cell: row => <div className={styles.cell}><span>{row.walletType}</span><StatusPill tone="warn">{row.status}</StatusPill></div> },
    { key: 'created', header: 'Placed at', minWidth: 160, cell: row => localTime(row.createdAt, selected?.timezone || 'Asia/Kolkata') },
  ]
  return <Page maxWidth="wide"><PageHeader title="Matka Running Markets" sub="Open bets and pending results across all trading dates" actions={<div className={styles.actions}><Button onClick={() => navigate('/matka/results')}>Results history</Button><Button icon={<IconRefresh size={16} />} onClick={() => { void refetch(); if (selected) void refetchBets() }}>Refresh</Button></div>} />
    <div className={styles.content}>
      <div className={styles.stats}><Stat label="Pending market sessions" value={page?.total ?? '—'} /><Stat label="Open bets" value={page?.openBetCount ?? '—'} /><Stat label="Awaiting results" value={page?.pendingResultCount ?? '—'} /></div>
      <Notice tone="info">This list includes pending and active bets, including previous dates. A market can stop accepting bets while its result is still pending. Jodi and Sangam wait for the Close result; Worli needs its Open result first.</Notice>
      {notice && <Notice tone="ok" live="polite">{notice}</Notice>}
      <FilterBar activeCount={[filters.search, filters.date, filters.matkaType, filters.session].filter(Boolean).length} onClearAll={() => { setSearch(''); setFilters({ page: 1, limit: filters.limit }); setSelected(null) }} search={<SearchField label="Search running Matka markets" placeholder="Search market name or code" value={search} onChange={setSearch} onSubmit={value => changeFilters({ search: value.trim() || undefined })} />}>
        <DateField label="Trading date" value={filters.date || ''} onChange={date => changeFilters({ date: date || undefined })} />
        <Select label="Matka type" value={filters.matkaType || ''} onChange={value => changeFilters({ matkaType: value || undefined })} options={kinds} />
        <Select label="Result session" value={filters.session || ''} onChange={value => changeFilters({ session: value || undefined })} options={[{ value: '', label: 'All sessions' }, { value: 'open', label: 'Open' }, { value: 'close', label: 'Close' }]} />
      </FilterBar>
      <div className={styles.toolbar}><span>All unresolved trading dates are included unless filtered.</span><Switch label="Auto refresh" checked={autoRefresh} onChange={setAutoRefresh} /></div>
      {error && rows.length > 0 && <Notice tone="error">Refresh failed: {error.message}. Showing the last loaded snapshot.</Notice>}
      <Card title="Markets awaiting settlement" body="table"><DataTable label="Matka running markets" columns={columns} rows={rows} rowKey={row => row.id} width="wide" state={error && !rows.length ? 'error' : loading && !data ? 'loading' : 'ready'} error={error?.message} onRetry={() => void refetch()} empty={<EmptyState title="No open Matka bets" description="No pending or active bets match this scope. Once a player places a bet, its market and trading date appear here." />} pagination={{ current: filters.page, pageSize: filters.limit, total: page?.total || 0, onChange: value => setFilters(current => ({ ...current, page: value })), onPageSizeChange: value => setFilters(current => ({ ...current, page: 1, limit: value })), pageSizeOptions: [10, 20, 50, 100], itemName: 'sessions' }} /></Card>
      {selected && <div ref={betsRef} className={styles.detail}><Card title={`${selected.marketName} · ${selected.date} · ${sessionName(selected.session)} bets`} tools={<Button size="sm" onClick={() => setSelected(null)}>Close bets</Button>} body="table"><DataTable label="Open Matka bets" columns={betColumns} rows={betData?.matkaRunningBets.items || []} rowKey={row => row.id} width="wide" state={betsError ? 'error' : betsLoading && !betData ? 'loading' : 'ready'} error={betsError?.message} onRetry={() => void refetchBets()} empty={<EmptyState title="No open bets remain" description="The bets may have settled while this view was open. Refresh the market list." />} pagination={{ current: betPage, pageSize: betLimit, total: betData?.matkaRunningBets.total || 0, onChange: setBetPage, onPageSizeChange: value => { setBetPage(1); setBetLimit(value) }, pageSizeOptions: [10, 20, 50, 100], itemName: 'bets' }} /></Card></div>}
    </div>
    {declaration && declaration.declareSession && <DeclareResultDrawer key={`${declaration.id}:${declaration.declareSession}`} open onClose={() => setDeclaration(null)} initialSelection={{ matkaId: declaration.matkaId, marketName: declaration.marketName, matkaType: declaration.matkaType, date: declaration.date, type: declaration.declareSession }} onSuccess={() => { setNotice(`${declaration.marketName}: ${sessionName(declaration.declareSession)} result saved. Matching bets were settled.`); void refetch(); if (selected) void refetchBets() }} />}
  </Page>
}
