import { useEffect, useState } from "react";
import { Wallet, Trophy, Dice1, Dices, Search, X, Calendar } from "lucide-react";
import Pagination from "@/components/Pagination";
// formatAmount used in subcomponents; not needed here
import { useSearchParams } from "react-router-dom";
import StakePageHeader from "@/components/StakePageHeader";
import { SegmentedTabs } from "@/components/bonus/SegmentedTabs";
import WalletTable from "@/components/statements/WalletTable";
import SportsTable from "@/components/statements/SportsTable";
import CasinoTable from "@/components/statements/CasinoTable";
import MatkaTable from "@/components/statements/MatkaTable";
import DetailsModal from "@/components/statements/DetailsModal";
import CustomDatePicker from "@/components/statements/CustomDatePicker";
import type { Bet, WalletTxn, MatkaStatement, TabKey } from "@/components/statements/types";
import { getStatementPage, type StatementTransaction } from '@/lib/api/user'
import { useAuth } from '@/lib/auth'
import { useTranslation } from "react-i18next";
import { usePageSEO } from '@/hooks/usePageSEO'
import '@/styles/account/statements.css'
import { 
  getStartOfDayKolkata, 
  getEndOfDayKolkata, 
  getTodayKolkata, 
  getYesterdayKolkata,
  addDaysKolkata
} from '@/lib/dateUtils'

/** Map API row to sports statement status: prefer backend result & DB lifecycle over P/L alone. */
function mapSportsStatementResult(r: Pick<StatementTransaction, 'status' | 'result' | 'pl'>): Bet["result"] {
  const lifecycle = String(r?.status ?? '').trim().toLowerCase()
  if (lifecycle === 'void') return 'Void'
  if (lifecycle === 'cancelled') return 'Cancelled'
  const apiResult = String(r?.result ?? "")
    .trim()
    .toLowerCase()
  if (apiResult === "void") return "Void"
  if (apiResult === "won") return "Win"
  if (apiResult === "lost") return "Lose"
  if (['pending','active','open'].includes(lifecycle)) return 'Pending'
  if (lifecycle === 'matched') return 'Matched'
  if (lifecycle === 'unmatched') return 'Unmatched'

  const pl = Number(r?.pl ?? 0)
  if (Number.isFinite(pl)) {
    if (pl > 0) return "Win"
    if (pl < 0) return "Lose"
  }

  const st = String(r?.status ?? "")
    .trim()
    .toLowerCase()
  if (st === "matched") return "Matched"
  if (st === "unmatched") return "Unmatched"
  if (st === "settled") return "Settled"
  if (st === "cancelled") return "Cancelled"
  if (st === "won") return "Win"
  if (st === "lost") return "Lose"
  if (st === "void") return "Void"

  return "Pending"
}

// StatusBadge moved to components/statements/StatusBadge


// DateCell moved to components/statements/DateCell

export default function StatementsPage() {
  usePageSEO({ 
    title: 'Statements', 
    description: 'View your transaction history and account statements' 
  })
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab') || 'wallet'
  const initialTab: TabKey = ['wallet','sports','casino','matka'].includes(requestedTab) ? requestedTab as TabKey : 'wallet'
  const [active, setActive] = useState<TabKey>(initialTab);
  const [pageWallet, setPageWallet] = useState(Number(params.get("pw") || 1));
  const [pageSports, setPageSports] = useState(Number(params.get("ps") || 1));
  const [pageCasino, setPageCasino] = useState(Number(params.get("pc") || 1));
  const [pageMatka, setPageMatka] = useState(Number(params.get("pm") || 1));
  const pageSize = 10;
  const { isAuthenticated, user } = useAuth();
  const userId = user?.id;
  const [reload, setReload] = useState(0)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loaded, setLoaded] = useState<{ key: string; rows: StatementTransaction[]; total: number; error: string | null }>({ key: '', rows: [], total: 0, error: null })
  const [walletTypes, setWalletTypes] = useState<{ scope: string; values: string[] }>({ scope: '', values: [] })
  const { t } = useTranslation()
  
  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<string>('today')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [showCustomDate, setShowCustomDate] = useState(false)
  const [walletTypeFilter, setWalletTypeFilter] = useState<string>('all')
  const [walletStatusFilter, setWalletStatusFilter] = useState<'all' | WalletTxn['status']>('all')
  const [sportsStatusFilter, setSportsStatusFilter] = useState<string>('all')
  const [sportsTypeFilter, setSportsTypeFilter] = useState<string>('all')
  const [casinoStatusFilter, setCasinoStatusFilter] = useState<string>('all')
  const [matkaStatusFilter, setMatkaStatusFilter] = useState<string>('all')
  const [matkaSessionFilter, setMatkaSessionFilter] = useState<string>('all')
  
  // Calculate date range based on filter (using Asia/Kolkata timezone)
  const getDateRange = () => {
    let startDate: Date
    let endDate: Date
    
    if (dateFilter === 'today') {
      const todayStr = getTodayKolkata()
      startDate = getStartOfDayKolkata(todayStr)
      endDate = getEndOfDayKolkata(todayStr)
    } else if (dateFilter === 'yesterday') {
      const yesterdayStr = getYesterdayKolkata()
      startDate = getStartOfDayKolkata(yesterdayStr)
      endDate = getEndOfDayKolkata(yesterdayStr)
    } else if (dateFilter === '7days') {
      const todayStr = getTodayKolkata()
      const sevenDaysAgoStr = addDaysKolkata(todayStr, -7)
      startDate = getStartOfDayKolkata(sevenDaysAgoStr)
      endDate = getEndOfDayKolkata(todayStr)
    } else if (dateFilter === 'month') {
      const todayStr = getTodayKolkata()
      const [year, month] = todayStr.split('-').map(Number)
      const firstDayStr = `${year}-${String(month).padStart(2, '0')}-01`
      startDate = getStartOfDayKolkata(firstDayStr)
      endDate = getEndOfDayKolkata(todayStr)
    } else if (dateFilter === 'custom') {
      if (customStartDate && customEndDate) {
        // Use the selected dates in Kolkata timezone
        startDate = getStartOfDayKolkata(customStartDate)
        endDate = getEndOfDayKolkata(customEndDate)
      } else {
        // Fallback to today if custom dates not set
        const todayStr = getTodayKolkata()
        startDate = getStartOfDayKolkata(todayStr)
        endDate = getEndOfDayKolkata(todayStr)
      }
    } else {
      // Default to today
      const todayStr = getTodayKolkata()
      startDate = getStartOfDayKolkata(todayStr)
      endDate = getEndOfDayKolkata(todayStr)
    }
    
    return {
      start: startDate.toISOString(),
      end: endDate.toISOString()
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const range = getDateRange()
  const page = active === 'wallet' ? pageWallet : active === 'sports' ? pageSports : active === 'casino' ? pageCasino : pageMatka
  const status = active === 'wallet' ? walletStatusFilter : active === 'sports' ? sportsStatusFilter : active === 'casino' ? casinoStatusFilter : matkaStatusFilter
  const type = active === 'wallet' ? walletTypeFilter : active === 'sports' ? sportsTypeFilter : active === 'matka' ? matkaSessionFilter : 'all'
  const dateScope = JSON.stringify([userId, range.start, range.end])
  const input = { domain: active.toUpperCase() as 'WALLET' | 'SPORTS' | 'CASINO' | 'MATKA', startDate: range.start, endDate: range.end, page, pageSize, search: debouncedSearch, status, type }
  const readKey = JSON.stringify([isAuthenticated, userId, input, reload])
  const current = loaded.key === readKey
  const loading = isAuthenticated && (!current || searchQuery.trim() !== debouncedSearch)
  const error = current ? loaded.error : null
  const total = current ? loaded.total : 0
  const walletTypeOptions = walletTypes.scope === dateScope ? walletTypes.values : []

  useEffect(() => {
    let cancelled = false
    if (!isAuthenticated || !userId || loaded.key === readKey) return
    const load = async () => {
      try {
        const result = await getStatementPage(input)
        if (cancelled) return
        if (result.meta.code !== 200) throw new Error(result.meta.message || 'Failed to load statements')
        const returnedPage = result.meta.page || 1
        const canonicalKey = JSON.stringify([isAuthenticated, userId, { ...input, page: returnedPage }, reload])
        if (returnedPage !== page) {
          if (active === 'wallet') setPageWallet(returnedPage)
          else if (active === 'sports') setPageSports(returnedPage)
          else if (active === 'casino') setPageCasino(returnedPage)
          else setPageMatka(returnedPage)
        }
        if (active === 'wallet') setWalletTypes({ scope: dateScope, values: result.walletTypes })
        setLoaded({ key: canonicalKey, rows: result.data, total: result.meta.total, error: null })
      } catch (failure) {
        if (!cancelled) setLoaded({ key: readKey, rows: [], total: 0, error: failure instanceof Error ? failure.message : 'Failed to load statements' })
      }
    }
    void load()
    return () => { cancelled = true }
    // readKey contains the authenticated owner, complete filter input and retry revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, loaded.key])

  // Sync URL params
  useEffect(() => {
    const next = new URLSearchParams(params);
    next.set("tab", active);
    next.set("pw", String(pageWallet));
    next.set("ps", String(pageSports));
    next.set("pc", String(pageCasino));
    next.set("pm", String(pageMatka));
    if (params.toString() !== next.toString()) setParams(next, { replace: true });
  }, [active, pageWallet, pageSports, pageCasino, pageMatka, params, setParams]);

  const rows = current && !loading ? loaded.rows : []
  const walletFiltered: WalletTxn[] = active !== 'wallet' ? [] : rows.map(row => {
    const raw = String(row.status ?? '').trim().toLowerCase()
    const successful = ['approved', 'success', 'successful', 'settled', 'completed', 'done', '1', 'approved_by_admin']
    const failed = ['failed', 'rejected', 'declined', 'cancelled', 'canceled', 'error', '2', '3']
    const status: WalletTxn['status'] = successful.includes(raw) ? 'Success' : failed.includes(raw) ? 'Failed' : 'Pending'
    return { id: row.id, dateISO: row.createdAt, type: row.transactionType || (row.amount < 0 ? 'Withdrawal' : 'Deposit'), amount: Math.abs(Number(row.amount) || 0), status,
      direction: Number(row.amount) < 0 ? 'debit' : Number(row.amount) > 0 ? 'credit' : 'neutral',
      description: row.description, bonusCampaignName: row.bonusCampaignName, bonusCampaignType: row.bonusCampaignType }
  })
  const mapBet = (row: StatementTransaction): Bet => {
    const common = { id: row.id, dateISO: row.createdAt, stake: Math.abs(Number(row.stake || row.amount || 0)), payout: Number(row.pl || 0), walletType: row.walletType || 'cash' }
    if (row.type === 'sports') return { ...common, result: mapSportsStatementResult(row),
      title: `${row.sportName || 'Sport'} > ${row.leagueName || 'League'} > ${row.eventId?.name || 'Event'}`,
      market: row.marketId?.marketName || 'Market', odds: row.price ?? undefined, side: row.side, oddsSize: row.oddsSize,
      marketType: row.marketId?.marketType, selection: row.selectionName, liability: row.liability, eventResult: row.eventResult }
    return { ...common, result: mapSportsStatementResult(row), title: row.description || 'Casino', market: row.provider || 'Game' }
  }
  const sportsFiltered = active === 'sports' ? rows.map(mapBet) : []
  const casinoFiltered = active === 'casino' ? rows.map(mapBet) : []
  const matkaFiltered: MatkaStatement[] = active !== 'matka' ? [] : rows.map(row => ({ id: row.id, dateISO: row.createdAt, market: row.marketId?.marketName || row.description || 'Matka', runDate: row.runDate || '', session: row.session || '', bidType: row.bidType || '', selection: row.selectionName || '', stake: Number(row.stake ?? row.amount), multiplier: Number(row.payoutMultiplier || 0), payout: row.payout ?? null, pl: row.pl ?? null, result: mapSportsStatementResult(row), eventResult: row.eventResult || null, walletType: row.walletType || 'cash', currency: row.currency || 'INR', settledAt: row.settledAt || null }))
  const pagedWallet = walletFiltered
  const pagedSports = sportsFiltered
  const pagedCasino = casinoFiltered

  // Reset page when filters change
  useEffect(() => { setPageWallet(1) }, [searchQuery, walletTypeFilter, walletStatusFilter, dateFilter, customStartDate, customEndDate])
  useEffect(() => { setPageSports(1) }, [searchQuery, sportsStatusFilter, sportsTypeFilter, dateFilter, customStartDate, customEndDate])
  useEffect(() => { setPageCasino(1) }, [searchQuery, casinoStatusFilter, dateFilter, customStartDate, customEndDate])
  useEffect(() => { setPageMatka(1) }, [searchQuery, matkaStatusFilter, matkaSessionFilter, dateFilter, customStartDate, customEndDate])

  // Row details modal
  const [details, setDetails] = useState<null | { type: TabKey; row: Bet | WalletTxn | MatkaStatement; scope: string }>(
    null
  );

  // Export helpers can be implemented later when needed

  return (
    <div className="nova-stmt space-y-4 pb-6">
      <StakePageHeader title={t('statements.title')} />
      {/* Tab Navigation - scrollable on mobile, no text wrap */}
      <div className="w-full">
        <SegmentedTabs
          theme="slate"
          fullWidth
          tabs={[
            {
              key: "wallet",
              label: t('statements.tabs.wallet'),
              icon: <Wallet className="h-4 w-4" />,
            },
            {
              key: "sports",
              label: t('statements.tabs.sports'),
              icon: <Trophy className="h-4 w-4" />,
            },
            {
              key: "casino",
              label: t('statements.tabs.casino'),
              icon: <Dice1 className="h-4 w-4" />,
            },
            { key: 'matka', label: 'Matka', icon: <Dices className="h-4 w-4" /> },
          ]}
          value={active}
          onChange={(k: string) => setActive(k as TabKey)}
        />
      </div>
      {/* Search and Filter Section - responsive stack on mobile */}
      <div className="nova-stmt-filters">
        <div className="nova-stmt-filter-row">
          {/* Search Bar - full width on mobile */}
          <div className="nova-stmt-search">
            <div className="nova-stmt-search-icon">
              <Search className="h-4 w-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ID, amount, event, market..."
              className="nova-stmt-input"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="nova-stmt-search-clear"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          
          {/* Date Filter + Custom range row */}
          <div className="nova-stmt-date-group">
            <div className="nova-stmt-date-select">
              <div className="nova-stmt-select-icon">
                <Calendar className="h-4 w-4" />
              </div>
              <select
                value={dateFilter}
                onChange={(e) => {
                  setDateFilter(e.target.value)
                  setShowCustomDate(e.target.value === 'custom')
                  if (e.target.value !== 'custom') {
                    setCustomStartDate('')
                    setCustomEndDate('')
                  }
                }}
                className="nova-stmt-select has-icon"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7days">Last 7 Days</option>
                <option value="month">Current Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            
            {/* Custom Date Range - stack on mobile */}
            {showCustomDate && (
              <div className="nova-stmt-range">
                <CustomDatePicker
                  value={customStartDate}
                  onChange={setCustomStartDate}
                  max={customEndDate || new Date().toISOString().split('T')[0]}
                  placeholder="Start date"
                />
                <div className="nova-stmt-range-arrow">
                  →
                </div>
                <CustomDatePicker
                  value={customEndDate}
                  onChange={setCustomEndDate}
                  min={customStartDate}
                  max={new Date().toISOString().split('T')[0]}
                  placeholder="End date"
                />
                {(customStartDate || customEndDate) && (
                  <button
                    onClick={() => {
                      setCustomStartDate('')
                      setCustomEndDate('')
                    }}
                    className="nova-stmt-range-clear"
                    aria-label="Clear dates"
                    title="Clear dates"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
          
          {/* Tab-specific Filters - full width on mobile */}
          {active === "wallet" && (
            <>
              <select
                value={walletTypeFilter}
                onChange={(e) => setWalletTypeFilter(e.target.value)}
                className="nova-stmt-select"
              >
                <option value="all">All Types</option>
                {walletTypeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select
                value={walletStatusFilter}
                onChange={(e) => setWalletStatusFilter(e.target.value as 'all' | WalletTxn['status'])}
                className="nova-stmt-select"
              >
                <option value="all">All Status</option>
                <option value="Success">Success</option>
                <option value="Pending">Pending</option>
                <option value="Failed">Failed</option>
              </select>
            </>
          )}
          
          {active === "sports" && (
            <>
              <select
                value={sportsStatusFilter}
                onChange={(e) => setSportsStatusFilter(e.target.value)}
                className="nova-stmt-select"
              >
                <option value="all">All Status</option>
                <option value="Win">Win</option>
                <option value="Lose">Lose</option>
                <option value="Pending">Pending</option>
                <option value="Void">Void</option>
                <option value="Matched">Matched</option>
                <option value="Unmatched">Unmatched</option>
                <option value="Settled">Settled</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              <select
                value={sportsTypeFilter}
                onChange={(e) => setSportsTypeFilter(e.target.value)}
                className="nova-stmt-select"
              >
                <option value="all">All Types</option>
                <option value="back">Back</option>
                <option value="lay">Lay</option>
              </select>
            </>
          )}
          
          {active === "casino" && (
            <select
              value={casinoStatusFilter}
              onChange={(e) => setCasinoStatusFilter(e.target.value)}
              className="nova-stmt-select"
            >
              <option value="all">All Status</option>
              <option value="Win">Win</option>
              <option value="Lose">Lose</option>
              <option value="Pending">Pending</option>
              <option value="Void">Void</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          )}

          {active === 'matka' && <>
            <select className="nova-stmt-select" aria-label="Matka status" value={matkaStatusFilter} onChange={event => setMatkaStatusFilter(event.target.value)}>
              <option value="all">All Status</option><option value="Win">Win</option><option value="Lose">Lose</option><option value="Pending">Pending</option><option value="Void">Void</option><option value="Cancelled">Cancelled</option>
            </select>
            <select className="nova-stmt-select" aria-label="Matka session" value={matkaSessionFilter} onChange={event => setMatkaSessionFilter(event.target.value)}>
              <option value="all">All Sessions</option><option value="open">Open</option><option value="close">Close</option>
            </select>
          </>}
          
          {/* Results count */}
          {(searchQuery || dateFilter !== 'today' || 
            (active === "wallet" && (walletTypeFilter !== 'all' || walletStatusFilter !== 'all')) || 
            (active === "sports" && (sportsStatusFilter !== 'all' || sportsTypeFilter !== 'all')) ||
            (active === "casino" && casinoStatusFilter !== 'all') || (active === 'matka' && (matkaStatusFilter !== 'all' || matkaSessionFilter !== 'all'))) && (
            <div className="nova-stmt-count">
              {active === "wallet" && `${total} result${total !== 1 ? 's' : ''}`}
              {active === "sports" && `${total} result${total !== 1 ? 's' : ''}`}
              {active === "casino" && `${total} result${total !== 1 ? 's' : ''}`}
              {active === "matka" && `${total} result${total !== 1 ? 's' : ''}`}
            </div>
          )}
        </div>
      </div>
      
      <div className="nova-stmt-results">
        {loading && (
          <div className="nova-stmt-loading">{t('common.loading')}</div>
        )}
        {error && (
          <div className="nova-stmt-error" role="alert">{error} <button type="button" onClick={() => setReload(value => value + 1)}>Try again</button></div>
        )}
        {/* Wallet */}
        {active === "wallet" && (
          <div className="nova-stmt-section">
            <h4 className="nova-stmt-section-head">Wallet Transactions</h4>
            <div className="nova-stmt-section-table">
              <WalletTable theme="slate" rows={pagedWallet} onRowClick={(row) => setDetails({ type: 'wallet', row, scope: readKey })} />
            </div>
            {!loading && !error && walletFiltered.length === 0 && (
              <div className="nova-stmt-empty">
                <div className="nova-stmt-empty-icon"><Wallet /></div>
                <p className="nova-stmt-empty-title">
                  No transactions found
                </p>
                <p className="nova-stmt-empty-text">
                  Your transaction history will appear here
                </p>
              </div>
            )}
            <div className="nova-stmt-pager">
              <Pagination
                page={pageWallet}
                pageSize={pageSize}
                total={total}
                onPageChange={setPageWallet}
              />
            </div>
          </div>
        )}

        {/* Sports */}
        {active === "sports" && (
          <div className="nova-stmt-section">
            <h4 className="nova-stmt-section-head">Sports Bets</h4>
            <div className="nova-stmt-section-table">
              <SportsTable rows={pagedSports} onRowClick={(row) => setDetails({ type: 'sports', row, scope: readKey })} />
            </div>
            {!loading && !error && sportsFiltered.length === 0 && (
              <div className="nova-stmt-empty">
                <div className="nova-stmt-empty-icon"><Trophy /></div>
                <p className="nova-stmt-empty-title">
                  No bets found
                </p>
                <p className="nova-stmt-empty-text">
                  Your sports betting history will appear here
                </p>
              </div>
            )}
            <div className="nova-stmt-pager">
              <Pagination
                page={pageSports}
                pageSize={pageSize}
                total={total}
                onPageChange={setPageSports}
              />
            </div>
          </div>
        )}

        {/* Casino */}
        {active === "casino" && (
          <div className="nova-stmt-section">
            <h4 className="nova-stmt-section-head">Casino Bets</h4>
            <div className="nova-stmt-section-table">
              <CasinoTable rows={pagedCasino} onRowClick={(row) => setDetails({ type: 'casino', row, scope: readKey })} />
            </div>
            {!loading && !error && casinoFiltered.length === 0 && (
              <div className="nova-stmt-empty">
                <div className="nova-stmt-empty-icon"><Dice1 /></div>
                <p className="nova-stmt-empty-title">
                  No bets found
                </p>
                <p className="nova-stmt-empty-text">
                  Your casino gaming history will appear here
                </p>
              </div>
            )}
            <div className="nova-stmt-pager">
              <Pagination
                page={pageCasino}
                pageSize={pageSize}
                total={total}
                onPageChange={setPageCasino}
              />
            </div>
          </div>
        )}
        {active === 'matka' && <div className="nova-stmt-section">
          <h4 className="nova-stmt-section-head">Matka Bets</h4>
          <div className="nova-stmt-section-table"><MatkaTable rows={matkaFiltered} onRowClick={row => setDetails({ type: 'matka', row, scope: readKey })} /></div>
          {!loading && !error && matkaFiltered.length === 0 && <div className="nova-stmt-empty"><div className="nova-stmt-empty-icon"><Dices /></div><p className="nova-stmt-empty-title">No Matka bets found</p><p className="nova-stmt-empty-text">Your market, selection, payout and result history will appear here</p></div>}
          <div className="nova-stmt-pager"><Pagination page={pageMatka} pageSize={pageSize} total={total} onPageChange={setPageMatka} /></div>
        </div>}
      </div>

      {/* Details Modal */}
      <DetailsModal details={details?.scope === readKey ? details : null} onClose={() => setDetails(null)} />
    </div>
  );
}
