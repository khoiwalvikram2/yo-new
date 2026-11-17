import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { getWhitelabelId } from '@/lib/whitelabel'
import { getThemeMode } from '@/lib/theme'
import { getCurrencyFromStorage } from '@/lib/currency'
import { usePageSEO } from '@/hooks/usePageSEO'
import StakePageHeader from '@/components/StakePageHeader'
import { getMatkaChart, getMatkaMarket, getMatkaMarkets, getMatkaWallet, getMyMatkaBets, MatkaRequestError, placeMatkaEntries, type MatkaKind, type MatkaPlacementInput, type MatkaWallet } from '@/lib/api/matka'
import { asKitEntry, asKitMarket, matkaChartRange, matkaFavoritesKey, orderMarketsForBoard, readMatkaFavorites } from '@/features/matka/model'
import { FilterSelect } from '@/features/matka/FilterSelect'
import { Badge, Button, EmptyState, Field, Icon, Modal } from '@/features/matka/kit/components.jsx'
import { MarketBoard } from '@/features/matka/kit/MarketBoard.jsx'
import MarketDetails, { EntryTable } from '@/features/matka/kit/MarketDetails.jsx'
import MarketCharts from '@/features/matka/kit/MarketCharts.jsx'
import { displayDate, money } from '@/features/matka/kit/data.js'
import '@/features/matka/kit/ui-kit.css'
import '@/features/matka/kit/compact.css'
import '@/features/matka/kit/home.css'
import '@/features/matka/kit/market-motion.css'
import '@/features/matka/kit/market-workspace.css'
import '@/features/matka/matka.css'
import '@/features/matka/matka-page-refresh.css'
import '@/features/matka/kit/market-board-refresh.css'
import '@/features/matka/kit/market-detail-refresh.css'
import '@/features/matka/kit/entry-refresh.css'

type DraftEntry = { gameId: string; session: string; number: string; amount: number }
// Owner 2026-11-01: the player Matka page offers Worli markets only (no Starline, Jackpot or Satta Matka, no "All types").
const kinds: Array<{ value: MatkaKind; label: string }> = [{ value: 'WORLI', label: 'Worli' }]
const views = [{ value: 'All', label: 'All markets' }, { value: 'Open', label: 'Open markets' }, { value: 'Favorites', label: 'Favorites' }]
const layouts = [{ value: 'grid', label: 'Grid view' }, { value: 'table', label: 'Table view' }]
function readPending(key: string): MatkaPlacementInput | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) || 'null')
    return raw && typeof raw.marketId === 'string' && typeof raw.requestKey === 'string' && Array.isArray(raw.entries) && raw.entries.length <= 500 ? raw : null
  } catch { return null }
}

export default function MatkaPage() {
  const { user, isAuthenticated, isHydrating, openAuthModal, refreshUser } = useAuth()
  const location = useLocation(), navigate = useNavigate(), queryClient = useQueryClient()
  const tenant = getWhitelabelId(), owner = `${tenant}:${isAuthenticated ? user?.id || 'pending' : 'anonymous'}`
  const currentOwner = useRef(owner); currentOwner.current = owner
  const parts = location.pathname.split('/').filter(Boolean).slice(1)
  const marketCode = parts[0] === 'markets' ? parts[1] || '' : ''
  const selectedGame = parts[2] === 'games' ? parts[3] : undefined
  const chartType = parts[2] === 'charts' && ['panel', 'jodi'].includes(parts[3]) ? parts[3] : undefined
  const section = marketCode ? 'market' : parts[0] === 'results' ? 'results' : parts[0] === 'my-bets' ? 'entries' : 'markets'
  const isDirectory = section === 'markets' || section === 'results'
  const routeValid = !parts.length || parts.length === 1 && ['results', 'my-bets'].includes(parts[0]) || parts[0] === 'markets' && !!marketCode && (parts.length === 2 || parts.length === 4 && (parts[2] === 'games' || parts[2] === 'charts' && !!chartType))
  const [theme, setTheme] = useState(getThemeMode), [helpOpen, setHelpOpen] = useState(false)
  const [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState('')
  const [kind, setKind] = useState<MatkaKind>('WORLI'), [view, setView] = useState('All'), [layout, setLayout] = useState('grid')
  const [walletChoice, setWalletChoice] = useState<MatkaWallet>('CASH')
  const pendingKey = `gw:matka:pending:${owner}`, favoritesKey = matkaFavoritesKey(tenant, isAuthenticated, user?.id)
  const [pendingRead, setPendingRead] = useState<{ key: string; input: MatkaPlacementInput | null }>(() => ({ key: pendingKey, input: readPending(pendingKey) }))
  const pending = pendingRead.key === pendingKey ? pendingRead.input : readPending(pendingKey)
  const [favoriteRead, setFavoriteRead] = useState<{ key: string; ids: string[] }>(() => ({ key: favoritesKey, ids: readMatkaFavorites(favoritesKey) }))
  const favorites = favoriteRead.key === favoritesKey ? favoriteRead.ids : readMatkaFavorites(favoritesKey)
  const [placing, setPlacing] = useState(false), [placementError, setPlacementError] = useState('')
  const entryScope = `${owner}:${marketCode}`, [entryState, setEntryState] = useState({ scope: '', page: 1, filter: 'all', from: '', to: '' })
  const entry = entryState.scope === entryScope ? entryState : { scope: entryScope, page: 1, filter: 'all', from: '', to: '' }
  const setEntry = (next: Partial<typeof entry>) => setEntryState({ ...entry, ...next, scope: entryScope })
  usePageSEO({ title: 'Matka', description: 'Matka markets, game entries and published results' })
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250); return () => clearTimeout(timer) }, [search])
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getThemeMode()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); return () => observer.disconnect()
  }, [])
  useEffect(() => { setPlacing(false); setPlacementError('') }, [owner])
  const listKind = kind, listSearch = section === 'market' ? '' : debouncedSearch
  const catalogue = useInfiniteQuery({ queryKey: ['matka', 'markets', owner, listKind, listSearch], initialPageParam: 1,
    queryFn: ({ pageParam }) => getMatkaMarkets({ kind: listKind || undefined, search: listSearch || undefined, page: pageParam, limit: 100 }),
    getNextPageParam: last => last.meta.hasMore ? (last.meta.page || 1) + 1 : undefined,
    staleTime: 3000, refetchInterval: 5000, retry: 1,
  })
  const detail = useQuery({ queryKey: ['matka', 'market', owner, marketCode], queryFn: () => getMatkaMarket(marketCode), enabled: !!marketCode, staleTime: 1000, refetchInterval: 5000, retry: 1 })
  const wallet = useQuery({ queryKey: ['matka', 'wallet', owner], queryFn: getMatkaWallet, enabled: isAuthenticated && !isHydrating, staleTime: 1000, refetchInterval: 5000, retry: 1 })
  const rawMarket = detail.data?.data, range = rawMarket ? matkaChartRange(rawMarket.runDate) : null
  const chart = useQuery({ queryKey: ['matka', 'chart', owner, rawMarket?.id, range?.from, range?.to], queryFn: () => getMatkaChart({ marketId: rawMarket!.id, ...range! }), enabled: !!rawMarket, staleTime: 3000, refetchInterval: 5000, retry: 1 })
  const history = useQuery({ queryKey: ['matka', 'bets', owner, rawMarket?.id || '', entry.page, entry.filter, entry.from, entry.to],
    queryFn: () => getMyMatkaBets({ marketId: rawMarket?.id, page: entry.page, limit: 20, status: entry.filter === 'today' ? undefined : entry.filter,
      from: entry.filter === 'today' ? rawMarket?.runDate : entry.from || undefined, to: entry.filter === 'today' ? rawMarket?.runDate : entry.to || undefined }),
    enabled: isAuthenticated && !isHydrating && (section === 'entries' || !!rawMarket), staleTime: 1000, refetchInterval: 5000, retry: 1,
  })
  const allMarkets = catalogue.data?.pages.flatMap(page => page.data) || []
  const marketOptions = allMarkets.map(market => ({ id: market.id, code: market.code, name: market.name }))
  if (rawMarket && !marketOptions.some(market => market.id === rawMarket.id)) marketOptions.unshift({ id: rawMarket.id, code: rawMarket.code, name: rawMarket.name })
  const selectedWallet = wallet.data?.data.find(item => item.walletType === walletChoice) || wallet.data?.data[0]
  const balance = selectedWallet?.balance || 0
  const storePending = (input: MatkaPlacementInput | null) => {
    try { if (input) sessionStorage.setItem(pendingKey, JSON.stringify(input)); else sessionStorage.removeItem(pendingKey) } catch { /* In-memory idempotency still works when storage is disabled. */ }
    setPendingRead({ key: pendingKey, input })
  }
  const toggleFavorite = (id: string) => {
    const ids = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id]
    try { localStorage.setItem(favoritesKey, JSON.stringify(ids)) } catch { /* Favorites remain available for this session. */ }
    setFavoriteRead({ key: favoritesKey, ids })
  }
  const goMarket = (market?: { id: string; code?: string }) => { if (market) navigate(`/matka/markets/${encodeURIComponent(market.code || market.id)}`) }
  const goChart = (market: { id: string; code?: string }, type: string) => navigate(`/matka/markets/${encodeURIComponent(market.code || market.id)}/charts/${type}`)
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['matka'] }) }
  async function sendPlacement(input: MatkaPlacementInput) {
    const requestOwner = owner
    if (placing || !isAuthenticated || isHydrating) return false
    storePending(input); setPlacing(true); setPlacementError('')
    try {
      const response = await placeMatkaEntries(input)
      if (currentOwner.current !== requestOwner) return false
      if (!response.data) throw new Error('Entry confirmation is unavailable. Retry the same request.')
      storePending(null); notify.success(response.data.replayed ? 'Your entries were already accepted. No additional stake was taken.' : `${response.data.bets.length} ${response.data.bets.length === 1 ? 'entry' : 'entries'} accepted. Total ${money(response.data.totalStake, true)}.`)
      refresh(); void refreshUser().catch(() => {}); return true
    } catch (error) {
      if (currentOwner.current === requestOwner) {
        if (error instanceof MatkaRequestError) storePending(null)
        setPlacementError(error instanceof Error ? error.message : 'Could not confirm entries. Retry the pending request.')
      }
      throw error
    } finally { if (currentOwner.current === requestOwner) setPlacing(false) }
  }
  const confirmEntries = async (_market: unknown, draft: DraftEntry[]) => {
    if (!isAuthenticated) { openAuthModal('login'); return false }
    if (!rawMarket || !selectedWallet) throw new Error('Your wallet is still loading. Try again shortly.')
    return sendPlacement(pending || { marketId: rawMarket.id, runDate: rawMarket.runDate, requestKey: crypto.randomUUID(), accountId: String(user?.id), quoteVersion: rawMarket.quoteVersion,
      walletType: selectedWallet.walletType, entries: draft.map(item => ({ bidType: item.gameId, selection: item.number, amount: item.amount, session: item.session === 'Close' ? 'CLOSE' : 'OPEN' })) })
  }
  const market = rawMarket ? { ...asKitMarket(rawMarket, chart.data?.data || [], marketOptions), currency: selectedWallet?.currency || getCurrencyFromStorage(),
    canBet: isAuthenticated && !!wallet.data?.canBet, accountMessage: !isAuthenticated ? 'Please sign in to place entries.' : wallet.error?.message || (wallet.isLoading ? 'Your wallet is loading. Please wait.' : wallet.data?.message || 'Matka betting is unavailable for this account.'), onLogin: () => { if (!isAuthenticated) openAuthModal('login') },
    walletLabel: selectedWallet?.label || 'Main wallet', frozen: placing || !!pending,
    // the wallet choice lives in the entry slip on the market page (its top navigation strip was removed)
    wallets: isAuthenticated ? wallet.data?.data || [] : [], walletType: selectedWallet?.walletType || walletChoice, onWallet: (value: string) => setWalletChoice(value as MatkaWallet), entryTotal: history.data?.meta.total || 0, entryPage: entry.page,
    entriesLoading: history.isLoading, entriesError: history.error?.message, onEntriesRetry: () => { void history.refetch() },
    entryFilter: entry.filter === 'today' ? 'Today' : entry.filter === 'open' ? 'Pending' : 'All entries',
    onEntryFilter: (value: string) => setEntry({ filter: value === 'Today' ? 'today' : value === 'Pending' ? 'open' : 'all', page: 1 }),
    onEntryPage: (page: number) => setEntry({ page }),
  } : null
  const entries = (history.data?.data || []).map(row => asKitEntry(row, rawMarket?.timezone || 'Asia/Kolkata'))
  // Favourites first, then by game time (owner 2026-11-02; orderMarketsForBoard).
  const shownMarkets = orderMarketsForBoard(allMarkets.filter(item => view === 'All' || view === 'Open' && item.status === 'Open' || view === 'Favorites' && favorites.includes(item.id)), favorites)
  const currentGame = market?.games.find(game => game.id === selectedGame)
  const detailError = detail.error?.message, totalEntries = history.data?.meta.total || 0
  const entryPager = <div className="gw-matka-pager"><span>{totalEntries} entries · Page {entry.page}</span><div><Button variant="secondary" disabled={entry.page <= 1 || history.isFetching} onClick={() => setEntry({ page: entry.page - 1 })}>Previous</Button><Button variant="secondary" disabled={!history.data?.meta.hasMore || history.isFetching} onClick={() => setEntry({ page: entry.page + 1 })}>Next</Button></div></div>

  return <div className="m99-kit gw-matka gw-matka-refresh" data-theme={theme}>
    <StakePageHeader title={section === 'market' && market ? market.name : 'Matka'} onHelpClick={() => setHelpOpen(true)} />
    {!isDirectory && section !== 'market' && <><nav className="gw-matka-nav" aria-label="Matka navigation"><Link to="/matka"><Icon name="grid" size={16} />Markets</Link><Link to="/matka/results"><Icon name="chart" size={16} />Results</Link><Link to="/matka/my-bets" aria-current={section === 'entries' ? 'page' : undefined}><Icon name="layers" size={16} />My entries</Link>
      <div>{isAuthenticated ? <><label>Wallet<select aria-label="Matka wallet" value={selectedWallet?.walletType || walletChoice} disabled={placing || !!pending} onChange={event => setWalletChoice(event.target.value as MatkaWallet)}>{(wallet.data?.data || [{ walletType: 'CASH', label: 'Main wallet', balance: 0, currency: getCurrencyFromStorage() }]).map(item => <option key={item.walletType} value={item.walletType}>{item.label}</option>)}</select></label><strong>{money(balance, true)}</strong></> : <Button onClick={() => openAuthModal('login')}>Sign in</Button>}</div>
    </nav></>}
    {placementError && <p role="alert" className="gw-matka-notice is-error">{placementError}</p>}
    {pending && <section className="gw-matka-notice" aria-label="Pending entry confirmation"><div><strong>Your last entry request is awaiting confirmation.</strong><p>{pending.entries.length} entries · {money(pending.entries.reduce((sum, item) => sum + item.amount, 0), true)}. Retry this request to check its outcome before placing another.</p></div><Button disabled={placing || !isAuthenticated} onClick={() => { void sendPlacement(pending).catch(() => {}) }}>{placing ? 'Checking…' : 'Retry pending request'}</Button></section>}
    {!routeValid ? <EmptyState title="Matka page not found" description="Choose a market to continue." action={<Button onClick={() => navigate('/matka')}>View markets</Button>} />
      : section === 'market' ? detail.isLoading ? <div role="status" className="gw-matka-loading">Loading market…</div> : detailError || !market ? <EmptyState title={detailError || 'Market unavailable'} description="Return to the directory or try again." action={<Button onClick={() => { void detail.refetch() }}>Try again</Button>} />
        : selectedGame && !currentGame ? <EmptyState title="This game is unavailable for this market" description="Choose one of the listed games." action={<Button onClick={() => goMarket(market)}>All game types</Button>} />
          : chartType ? chart.isLoading ? <div role="status" className="gw-matka-loading">Loading published results…</div> : chart.error ? <EmptyState title="Could not load results" description={chart.error.message} action={<Button onClick={() => { void chart.refetch() }}>Try again</Button>} /> : <MarketCharts key={`${market.id}:${chartType}`} market={market} type={chartType} onChart={goChart} />
            : <MarketDetails key={`${owner}:${market.id}`} market={market} selectedGameId={selectedGame} onSelectGame={(id: string | null) => navigate(id ? `/matka/markets/${market.code}/games/${id}` : `/matka/markets/${market.code}`)} balance={balance} favorite={favorites.includes(market.id)} onFavorite={toggleFavorite} onMarket={goMarket} onChart={goChart} onBack={() => navigate('/matka')} entries={entries} onConfirm={confirmEntries} />
      : section === 'entries' ? <section className="m99-panel"><div className="m99-compact-panel-title"><h2>My Matka entries</h2><Badge>{totalEntries}</Badge></div>{!isAuthenticated ? <EmptyState title="Sign in to view your entries" description="Your entries and settled results are available in your account." action={<Button onClick={() => openAuthModal('login')}>Sign in</Button>} /> : <>
        <div className="gw-matka-toolbar"><label>Status<select aria-label="Entry status" value={entry.filter} onChange={event => setEntry({ filter: event.target.value, page: 1 })}><option value="all">All entries</option><option value="open">Pending</option><option value="won">Won</option><option value="lost">Lost</option><option value="void">Void</option></select></label><Field label="From" type="date" value={entry.from} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEntry({ from: event.target.value, page: 1 })} /><Field label="To" type="date" value={entry.to} min={entry.from || undefined} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEntry({ to: event.target.value, page: 1 })} /></div>
        {history.isLoading ? <p role="status" className="gw-matka-loading">Loading entries…</p> : history.error ? <EmptyState title="Could not load entries" description={history.error.message} action={<Button onClick={() => { void history.refetch() }}>Try again</Button>} /> : <EntryTable entries={entries} showMarket />}{entryPager}</>}
      </section> : <section className="gw-matka-directory" aria-label={section === 'results' ? 'Published results directory' : 'Matka market directory'}>
        <h2 className="m99-sr-only">{section === 'results' ? 'Matka results' : 'Matka markets'}</h2>
        <section className="gw-matka-filterbar" aria-label="Market discovery controls">
          <div className="gw-matka-filter-search"><Icon name="search" size={16} /><input aria-label="Search Matka markets" placeholder="Search market name…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear market search" onClick={() => setSearch('')}><Icon name="close" size={15} /></button>}</div>
          <FilterSelect className="gw-matka-filter-type" label="Matka market type" value={kind} options={kinds} onChange={value => setKind(value as MatkaKind)} />
          <FilterSelect label="Filter Matka markets" value={view} options={views} onChange={setView} />
          <FilterSelect label="Market layout" value={layout} options={layouts} onChange={setLayout} />
        </section>
        {catalogue.isLoading ? <div role="status" className="gw-matka-loading">Loading markets…</div> : catalogue.error ? <EmptyState title="Could not load markets" description={catalogue.error.message} action={<Button onClick={() => { void catalogue.refetch() }}>Try again</Button>} /> : shownMarkets.length ? <MarketBoard items={shownMarkets.map(item => asKitMarket(item))} favorites={favorites} onFavorite={toggleFavorite} onMarket={goMarket} onChart={goChart} mode={layout} /> : <EmptyState title={view === 'Favorites' ? 'No favorite markets yet' : 'No markets available'} description={search ? 'Try another market name or clear your filters.' : view === 'Favorites' ? 'Star a market to add it here.' : 'Available markets will appear here.'} />}
        {catalogue.hasNextPage && <div className="gw-matka-directory-more"><span>{allMarkets.length} of {catalogue.data?.pages[0]?.meta.total ?? allMarkets.length} markets loaded</span><Button variant="secondary" disabled={catalogue.isFetchingNextPage} onClick={() => { void catalogue.fetchNextPage() }}>{catalogue.isFetchingNextPage ? 'Loading markets…' : 'Load more markets'}<Icon name="arrow" size={15} /></Button></div>}
      </section>}
    {market?.message && <p className="gw-matka-notice">{market.message}</p>}
    <p className="gw-matka-footnote">Entries close at the listed cutoff times. For Worli, Jodi and Sangam entries lock at the Open cutoff and settle with the Close result.</p>
    <span className="m99-sr-only">{rawMarket ? displayDate(rawMarket.runDate) : ''}</span>
    {helpOpen && <Modal title="How Matka works" subtitle="Cutoffs, results and settlement" onClose={() => setHelpOpen(false)}>
      <ul className="gw-matka-help">
        <li>Each market's open and close times follow that market's own timezone, shown on its card.</li>
        <li>Entries for a session close at its listed cutoff time.</li>
        <li>Worli, Jodi and Sangam entries lock at the Open cutoff and settle with the Close result.</li>
        <li>Published results are under Results; your entries and their outcomes are under My entries.</li>
      </ul>
    </Modal>}
  </div>
}
