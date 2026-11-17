import { useCallback, useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useLazyQuery, useApolloClient } from '@apollo/client'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { IconPlus, IconDownload, IconArrowUp, IconArrowDown, IconMinus, IconDots } from '@tabler/icons-react'
import { AGENTS_PAGE_QUERY, AGENTS_STATS_QUERY, AGENTS_FOR_SELECTOR_QUERY, UPDATE_AGENT_STATUS_MUTATION } from '@/lib/graphql/agents'
import { SETTLE_AGENT_MUTATION, PENDING_SETTLEMENTS_QUERY } from '@/lib/graphql/settlements'
import { exportAgentsToExcel, loadAgentsForExport } from './utils/exportAgents'
import { tallyIsOn } from './agentEditorModel'
import { SettlementModal } from '../settlements/components/SettlementModal'
import { CommissionCyclePayDialog } from '../commission/components/CommissionCyclePayDialog'
import { hasPendingAmount, settlementDirectionOf, settlerDirectionLabel, sharingSettlePeriod, type PendingSettlement } from '../settlement/settlementModel'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useAuthStore } from '@/shared/core/authStore'
import { useSearch } from '@/shared/hooks/useSearch'
import { useSearchParamUpdates } from '@/shared/hooks/useSearchParamUpdates'
import dayjs from 'dayjs'
import { notify } from '@/shared/services/notification'
import { StatsCards } from './components/StatsCards'
import { useAgentSchemeCounts } from './components/agentOverview'
import { FiltersBar } from './components/FiltersBar'
import { AGENTS_CHIPS_QUERY, chipsById, type AgentsChipsData } from './components/agentChips'
import {
  CHIP_READ_OPTIONS,
  ChipActions,
  ChipTransferModal,
  CreditReferenceModal,
  chipTone,
  isDirectParent,
  refPnlNote,
  roundChips,
  signedChips,
  useChipActor,
  type ChipAccount,
} from '@/modules/chips'
import { Page } from '@/ui/components/Page'
import { AccountListHeader, AccountListGroups, AccountListPanel } from '@/modules/account-lists/AccountList'
import { Avatar } from '@/ui/components/Avatar'
import listStyles from '@/modules/account-lists/AccountList.module.css'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Pagination } from '@/ui/components/Pagination'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/ui/components/Menu'
import { CopyButton } from '@/ui/components/CopyButton'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { toast } from '@/ui/components/toast'
import { AgentTreeView } from './components/AgentTreeView'
import { agentLevelNames, agentPrimaryAction, agentRowMoneyActions, type AgentsPageData, type AgentListRow, type AgentListStats, type AgentSettlementSelection } from './components/agentsSearchModel'
import styles from './SearchPage.module.css'

const AGENT_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const
type ChipDialog = { kind: 'deposit' | 'withdraw' | 'creditReference'; account: ChipAccount }

export default function AgentsSearchPage() {
  return <RBACGuard required={[{ domain: 'agents.list', actions: ['view'] }]} bypassForAgents><AgentsSearchContent /></RBACGuard>
}
function AgentsSearchContent() {
  const { formatAmount } = useCurrency();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Auth state for role-based behavior
  const agent = useAuthStore((s) => s.agent);
  const roles = useAuthStore((s) => s.roles) ?? [];
  const isAgentLoggedIn = !!agent;
  const isWhitelabelAdmin = roles.some(
    (r: string) =>
      r === 'Whitelabel Admin' ||
      (r && (r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel'))),
  );
  const agentSchemeType = agent?.schemeType;
  const canCreateSubAgent = !agent || agent.schemeType === 'COMMISSION' || agent.levelIndex == null || agent.levelIndex < 4;

  const AGENTS_SCHEME_TYPE_KEY = 'agents-list-scheme-type';

  // Get initial schemeType: URL > persisted type > default. So selected type (e.g. Commission) stays when reopening list.
  const getInitialSchemeType = (): string => {
    if (isAgentLoggedIn && agentSchemeType) {
      return agentSchemeType; // Agents only see their own scheme type
    }
    const fromUrl = searchParams.get('type');
    if (fromUrl && ['SHARING', 'CREDIT', 'COMMISSION'].includes(fromUrl)) return fromUrl;
    if (typeof window !== 'undefined') {
      const stored = window.sessionStorage.getItem(AGENTS_SCHEME_TYPE_KEY);
      if (stored && ['SHARING', 'CREDIT', 'COMMISSION'].includes(stored)) return stored;
    }
    return 'COMMISSION';
  };

  const initialSchemeType = getInitialSchemeType();

  // A link may carry the search (?search=, the global search's "See all Agents").
  const { query, setQuery, debouncedQuery } = useSearch({ minLength: 2, initialQuery: searchParams.get('search') ?? '' });
  useSearchParamUpdates(setQuery);
  const [mainLoaded, setMainLoaded] = useState(false);
  const [secondaryReady, setSecondaryReady] = useState(false);

  useEffect(() => {
    if (!mainLoaded) return;
    const t = setTimeout(() => setSecondaryReady(true), 300);
    return () => clearTimeout(t);
  }, [mainLoaded]);

  const [schemeType, setSchemeType] = useState(initialSchemeType);
  const [status, setStatus] = useState("");

  // A later link to this list can name a scheme (?type=, the global search's "See all Agents" names its matches'
  // scheme, B005). The page is still mounted, so the initial scheme above never runs again; follow the link as a
  // scheme tab would. The page's own writes of ?type= carry the scheme it already shows.
  const followSchemeLink = useCallback((value: string) => {
    if (!isAgentLoggedIn && ['SHARING', 'CREDIT', 'COMMISSION'].includes(value)) setSchemeType(value);
  }, [isAgentLoggedIn]);
  useSearchParamUpdates(followSchemeLink, 'type');

  // Sync schemeType with agent's scheme type when agent is logged in
  useEffect(() => {
    if (isAgentLoggedIn && agentSchemeType) {
      setSchemeType(agentSchemeType);
    }
  }, [isAgentLoggedIn, agentSchemeType]);

  // When opening agents list with no type in URL but we have a persisted type (or default COMMISSION), sync URL so it always reflects selection.
  // The rest of the query string stays: a "See all" link's ?search= is the term the box opened with, so a refresh or Back restores it.
  useEffect(() => {
    if (isAgentLoggedIn) return;
    if (!searchParams.get('type')) {
      setSearchParams((params) => {
        const next = new URLSearchParams(params);
        next.set('type', initialSchemeType);
        return next;
      }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update URL and persist selected type so agents list always opens with this type (only for admin)
  const handleSchemeTypeChange = (value: string) => {
    if (!isAgentLoggedIn) {
      setSchemeType(value);
      setSearchParams({ type: value });
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(AGENTS_SCHEME_TYPE_KEY, value);
      }
    }
  };

  // Show selector only for admin (not for agents)
  const showSchemeSelector = !isAgentLoggedIn;
  const schemeCounts = useAgentSchemeCounts(!showSchemeSelector || !mainLoaded);

  // For agents: don't set selectedParentAgentId in filter (keep undefined)
  // But we'll use logged-in agent's ID in the query to fetch sub-agents
  // For admins: start with undefined to show all agents
  const [selectedParentAgentId, setSelectedParentAgentId] = useState<string | undefined>(undefined);

  // Don't initialize breadcrumb with logged-in agent - only show when navigating to sub-agents
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: string; username: string; levelIndex: number | null }>>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // A CREDIT agent's Deposit / Withdraw / Credit reference opened from its row menu (the row's D / W / CR
  // buttons open their own dialogs). chipsVersion tells the stats cards that chips moved.
  const [chipDialog, setChipDialog] = useState<ChipDialog | null>(null);
  const [chipsVersion, setChipsVersion] = useState(0);
  const chipActor = useChipActor();
  const [settlementModalVisible, setSettlementModalVisible] = useState(false);
  const [selectedAgentForSettlement, setSelectedAgentForSettlement] = useState<AgentSettlementSelection | null>(null);
  const [settleLoadingId, setSettleLoadingId] = useState<string | null>(null);
  // Pay opens a picker of the agent's closed, unpaid IST weeks (CommissionCyclePayDialog), never a free-form amount.
  const [payTarget, setPayTarget] = useState<{ agentId: string; username: string | null } | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('table');
  const [exportingAgents, setExportingAgents] = useState(false);
  const apolloClient = useApolloClient();


  const searchTerm = debouncedQuery && debouncedQuery.trim().length >= 2 ? debouncedQuery.trim() : undefined;
  const queryVariables = useMemo(
    () => ({
      query: searchTerm,
      schemeType: schemeType || undefined,
      status: status || undefined,
      // For agents: use logged-in agent's ID to fetch sub-agents (even if filter is not selected)
      // For admins: when no parent selected, show only direct (root) agents; when parent selected, show its children
      parentAgentId: isAgentLoggedIn && agent?.id
        ? (selectedParentAgentId || agent.id) // Use filter selection or logged-in agent's ID
        : selectedParentAgentId || undefined, // For admins, use filter selection
      // Admin only: when no parent is selected and nothing is searched, list the root agents. A search
      // looks through every level, so a sub-agent can be found by name.
      directOnly: !isAgentLoggedIn && !selectedParentAgentId && !searchTerm ? true : undefined,
    }),
    [searchTerm, schemeType, status, selectedParentAgentId, isAgentLoggedIn, agent?.id]
  );

  const {
    data,
    loading: fetching,
    refetch,
    error: agentsError,
  } = useQuery<AgentsPageData>(AGENTS_PAGE_QUERY, {
    variables: {
      ...queryVariables,
      offset: (currentPage - 1) * pageSize,
      limit: pageSize,
    },
    errorPolicy: "all",
    fetchPolicy: "network-only",
    onCompleted: () => setMainLoaded(true),
    onError: () => setMainLoaded(true),
  });

  // Reset to first page when filters change (useQuery refetches automatically when variables change)
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedQuery, schemeType, status, selectedParentAgentId]);

  // Reset parent agent selection and breadcrumb when scheme type changes (only for admins)
  // For agents, keep filter empty but query will still use their ID
  useEffect(() => {
    if (!isAgentLoggedIn) {
      setSelectedParentAgentId(undefined);
      setBreadcrumb([]);
    } else {
      setBreadcrumb([]);
    }
  }, [schemeType, isAgentLoggedIn]);

  // Handle breadcrumb segment click - navigate back
  const handleBreadcrumbClick = (index: number) => {
    const newBreadcrumb = breadcrumb.slice(0, index + 1);
    setBreadcrumb(newBreadcrumb);
    if (newBreadcrumb.length === 0) {
      setSelectedParentAgentId(undefined);
    } else {
      setSelectedParentAgentId(newBreadcrumb[newBreadcrumb.length - 1].id);
    }
    setCurrentPage(1);
  };

  const agentItems = useMemo(() => data?.agents?.agentsPage?.items ?? [], [data]);
  const totalAgents = data?.agents?.agentsPage?.total ?? 0;

  const { data: statsData } = useQuery<AgentsPageData>(AGENTS_STATS_QUERY, {
    variables: {
      ...queryVariables,
      offset: (currentPage - 1) * pageSize,
      limit: pageSize,
    },
    skip: !mainLoaded || agentItems.length === 0,
    fetchPolicy: "network-only",
  });

  const statsMap = useMemo(() => {
    const map = new Map<string, AgentListStats>();
    const withStats = statsData?.agents?.agentsPage?.itemsWithStats ?? [];
    for (const s of withStats) {
      if (s?.agent?.id && s?.stats) map.set(s.agent.id, s.stats);
    }
    return map;
  }, [statsData]);

  // CREDIT agents' chips for the same page, read beside the list (not after it): they are the scheme's main figures.
  const creditList = schemeType === 'CREDIT';
  const {
    data: chipsData,
    loading: chipsLoading,
    error: chipsError,
    refetch: refetchChips,
  } = useQuery<AgentsChipsData>(AGENTS_CHIPS_QUERY, {
    ...CHIP_READ_OPTIONS,
    variables: {
      ...queryVariables,
      offset: (currentPage - 1) * pageSize,
      limit: pageSize,
    },
    skip: !creditList,
  });
  const chipsMap = useMemo(() => chipsById(chipsData?.agents?.agentsPage?.items), [chipsData]);
  const chipsFailed = creditList && !chipsLoading && !chipsData && !!chipsError;

  const agents = useMemo(
    () => agentItems.map((item: AgentListRow) => ({ ...item, stats: statsMap.get(item.id) || null, chips: chipsMap.get(item.id) ?? null })),
    [agentItems, statsMap, chipsMap]
  );

  // After a deposit, withdrawal or credit reference change: this page's chips, and the stats cards' totals.
  const chipsChanged = () => {
    setChipsVersion(version => version + 1);
    void refetchChips().catch(() => { /* the chips cells show the read's own failure */ });
  };
  // D / W / CR on a row belong to its direct parent only (spec decision 3): an agent's own sub-agents, an
  // admin's root agents. The server checks it again.
  const chipsOwnedBy = (row: AgentListRow): ChipAccount | null =>
    row.chips && chipActor.canManage && isDirectParent(row.chips, chipActor.agentId) ? row.chips : null;

  // Fetch agents for selector dropdown (filtered by current scheme type)
  // For agents: fetch their own profile and sub-agents
  // For admins: fetch all agents
  const { data: agentsForSelectorData } = useQuery<AgentsPageData>(AGENTS_FOR_SELECTOR_QUERY, {
    variables: {
      schemeType: schemeType || undefined,
      parentAgentId: isAgentLoggedIn && agent?.id ? agent.id : undefined,
    },
    errorPolicy: 'all',
    skip: !secondaryReady,
  });

  let agentsForSelector = agentsForSelectorData?.agents?.agentsPage?.items ?? [];

  // For agents: remove logged-in agent from selector list (they shouldn't filter by themselves)
  // Only show their sub-agents in the filter
  if (isAgentLoggedIn && agent?.id) {
    agentsForSelector = agentsForSelector.filter((a: AgentListRow) => a.id !== agent.id);
  }

  // Ensure all agents have username (fallback to id if missing)
  agentsForSelector = agentsForSelector.map((a: AgentListRow) => ({
    ...a,
    username: a.username || a.id,
  }));

  const [updateAgentStatus, { loading: updatingStatus }] = useMutation(UPDATE_AGENT_STATUS_MUTATION);
  const [settleAgent] = useMutation(SETTLE_AGENT_MUTATION, {
    onCompleted: (data) => {
      if (data.settleAgent.success) {
        notify.success(data.settleAgent.message, 'Settlement Successful');
        setSettlementModalVisible(false);
        setSelectedAgentForSettlement(null);
        refetch();
      } else {
        notify.error(data.settleAgent.message, 'Settlement Failed');
      }
    },
    onError: (error) => {
      notify.error(error.message, 'Settlement Error');
    },
  });
  // The pending row of the agent being settled: its exact window (periodTo), direction and breakdown.
  const [fetchPendingSettlements] = useLazyQuery<{ pendingSettlements?: PendingSettlement[] }>(PENDING_SETTLEMENTS_QUERY, { fetchPolicy: 'network-only' });

  // Handle status change
  const handleStatusChange = async (agentId: string, newStatus: string, currentStatus: string) => {
    if (newStatus === currentStatus) return;

    try {
      const result = await updateAgentStatus({
        variables: {
          agentId,
          status: newStatus,
        },
        refetchQueries: [
          {
            query: AGENTS_PAGE_QUERY,
            variables: {
              ...queryVariables,
              offset: (currentPage - 1) * pageSize,
              limit: pageSize,
            },
          },
        ],
      });

      if (result.data?.agents?.updateAgentStatus) {
        notify.success(
          `Agent status updated to ${newStatus}`,
          'Status Updated'
        );
        // A CREDIT agent's chips carry its status: D is paused while it is not ACTIVE.
        if (schemeType === 'CREDIT') void refetchChips().catch(() => { /* the chips cells show the read's own failure */ });
      }
    } catch (error: unknown) {
      notify.error(
        (error instanceof Error ? error.message : '') || 'Failed to update agent status',
        'Update Failed'
      );
    }
  };

  const formatCurrency = (value: number | null | undefined) => value == null ? '—' : formatAmount(Number(value))
  const formatDate = (value: string | null | undefined) => value ? dayjs(value).format('MMM DD') : '—'
  const getTimeAgo = (value: string | null | undefined) => {
    if (!value) return 'Never'
    const days = dayjs().diff(dayjs(value), 'day')
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? `${days}d ago` : days < 30 ? `${Math.floor(days / 7)}w ago` : formatDate(value)
  }
  // Settle from the agent's pending row (fetched on open): the amount, direction and breakdown the modal shows and
  // the window (periodTo) the settle posts are the same. The list figure is the fallback when the row is missing.
  const openSettlement = async (row: AgentListRow) => {
    // Only SHARING agents settle from the list (agentRowMoneyActions); a CREDIT agent's settle is a chip D/W.
    const base: AgentSettlementSelection = { agentId: row.id, agent: { id: row.id, username: row.username, schemeType: row.schemeType }, schemeType: row.schemeType, pendingAmount: row.stats?.pendingSettlement || 0, settlementType: 'P_L' }
    setSettleLoadingId(row.id)
    let selection = base
    try {
      const { data } = await fetchPendingSettlements({ variables: { schemeType: row.schemeType } })
      const fresh = data?.pendingSettlements?.find(item => item.agentId === row.id)
      if (fresh) selection = { ...base, pendingAmount: Number(fresh.pendingAmount) || 0, settlementDirection: fresh.settlementDirection ?? null, periodTo: fresh.periodTo ?? null, settlementBreakdownByDomain: fresh.settlementBreakdownByDomain }
    } catch { /* keep the list figure */ }
    finally { setSettleLoadingId(null) }
    setSelectedAgentForSettlement(selection); setSettlementModalVisible(true)
  }
  const openCommission = (row: AgentListRow) => { setPayTarget({ agentId: row.id, username: row.username ?? null }) }
  const handleExportAgents = async () => {
    if (!agents.length) { toast({ tone: 'warn', title: 'No Data', message: 'There are no agents to export.' }); return }
    setExportingAgents(true)
    // Every agent the filters match, not only the page on screen: the sheet's title states the filter's total.
    try { const all = await loadAgentsForExport(apolloClient, queryVariables, { total: totalAgents, withChips: creditList }); await exportAgentsToExcel(all, totalAgents); toast({ tone: 'ok', title: 'Export Complete', message: `${all.length.toLocaleString()} ${all.length === 1 ? 'agent' : 'agents'} exported to Excel.` }) }
    catch (error) { toast({ tone: 'error', title: 'Export Failed', message: error instanceof Error ? error.message : 'Something went wrong during export.' }) }
    finally { setExportingAgents(false) }
  }
  const trend = (direction: string | null | undefined, value: number | null | undefined) => !direction || !value ? null : <span className={direction === 'up' ? styles.positive : direction === 'down' ? styles.negative : styles.muted} aria-label={`Trend ${direction}`}>{direction === 'up' ? <IconArrowUp size={12} /> : direction === 'down' ? <IconArrowDown size={12} /> : <IconMinus size={12} />}</span>

  // Row anatomy: one figure per column, a quiet second line for its context. Domains are plain words, never icons.
  const domainName = (domain: string) => domain.charAt(0).toUpperCase() + domain.slice(1)
  const levelName = (row: AgentListRow) => row.levelIndex ? agentLevelNames[row.levelIndex] || `Level ${row.levelIndex}` : 'Agent'
  const statusLabel = (value: string) => value === 'SUSPENDED' ? 'Suspended' : value === 'ACTIVE' ? 'Active' : 'Inactive'
  const lastLoginLabel = (row: AgentListRow) => {
    if (!row.stats?.lastLogin) return 'Never logged in'
    const ago = getTimeAgo(row.stats.lastLogin)
    return `Last login ${ago === 'Today' || ago === 'Yesterday' ? ago.toLowerCase() : ago}`
  }
  const lastBetLabel = (row: AgentListRow) => row.stats?.daysSinceLastBet == null ? 'No bets' : row.stats.daysSinceLastBet === 0 ? 'Bet today' : `Last bet ${row.stats.daysSinceLastBet}d ago`
  const identity = (row: AgentListRow) => <div className={styles.agent}>
    <Avatar name={row.username} hue="auto" className={styles.agentAvatar} />
    <div className={styles.agentText}>
      <div className={styles.agentName}>
        <Link to={`/agents/${row.id}`} className={styles.profileLink}>{row.username || '—'}</Link>
        {row.username && <CopyButton value={row.username} label="Copy username" />}
        {tallyIsOn(row.tallyEnabled, row.tallyDomains) && <StatusPill tone="ok">Tally</StatusPill>}
      </div>
      <div className={styles.agentSub}>
        <span>{levelName(row)}</span>
        {row.parentAgent?.username && <span>under <Link to={`/agents/${row.parentAgent.id}`} className={styles.subLink}>{row.parentAgent.username}</Link></span>}
        {row.phone && <span className={styles.phone}>{row.phone}<CopyButton value={row.phone} label="Copy phone" /></span>}
      </div>
    </div>
  </div>
  const playersCell = (row: AgentListRow) => <div className={styles.stack}>
    <strong className={styles.figure}>{row.stats?.activePlayers ?? '—'}</strong>
    {row.stats && <>
      <span className={styles.sub} title={row.stats.lastLogin ? `Last login ${new Date(row.stats.lastLogin).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : undefined}>{lastLoginLabel(row)}</span>
      <span className={styles.sub}>{lastBetLabel(row)}</span>
    </>}
  </div>
  const rates = (items: Array<{ domain: string; value: string }>) => <div className={styles.rates}>
    {items.map(item => <span key={item.domain}><span className={styles.rateDomain}>{domainName(item.domain)}</span> <strong>{item.value}</strong></span>)}
  </div>
  const sharing = (row: AgentListRow) => row.sharingRates?.length
    ? rates(row.sharingRates.map(rate => ({ domain: rate.domain, value: typeof rate.rate === 'number' ? `${rate.rate.toFixed(2)}%` : '—' })))
    : <span className={styles.subStrong}>No rates set</span>
  const flows = (row: AgentListRow) => <div className={styles.stack}>
    <span className={styles.figureLine}><span className={styles.label}>Deposits</span> <strong>{formatCurrency(row.stats?.totalDeposits)}</strong></span>
    <span className={styles.figureLine}><span className={styles.label}>Withdrawals</span> <strong>{formatCurrency(row.stats?.totalWithdrawals)}</strong></span>
  </div>
  // A CREDIT agent's chips (spec 2026-11-02 §2): its own balance over what its downline holds, and its Ref P/L
  // (balance + downline − credit reference) in colour: green when the upline owes it, rose when it owes.
  const chipFormat = (currency?: string | null) => (value: number) => formatAmount(roundChips(value), currency || undefined)
  const chipsUnknown = <span className={styles.subStrong}>{chipsFailed ? 'Not available' : '—'}</span>
  const chipsCell = (row: AgentListRow) => {
    const chips = row.chips
    if (!chips) return chipsUnknown
    const fmt = chipFormat(chips.currency)
    return <div className={styles.stack}>
      <strong className={styles.figure}>{fmt(chips.balance)}</strong>
      <span className={styles.sub}><span>Downline <span>{fmt(chips.downlineBalance)}</span></span></span>
    </div>
  }
  const refPnlCell = (row: AgentListRow) => {
    const chips = row.chips
    if (!chips) return chipsUnknown
    const fmt = chipFormat(chips.currency)
    const tone = chipTone(chips.refPnl)
    return <div className={styles.stack}>
      <strong className={tone === 'gain' ? styles.gain : tone === 'loss' ? styles.loss : styles.figure}>{signedChips(chips.refPnl, fmt)}</strong>
      <span className={styles.sub}><span>{refPnlNote(chips.refPnl)}</span><span>Credit ref <span>{fmt(chips.creditReference)}</span></span></span>
    </div>
  }
  const performance = (row: AgentListRow) => {
    const stats = row.stats
    if (!stats) return <span className={styles.subStrong}>—</span>
    const pl = stats.profitLoss
    if (!pl && !stats.ggr && !stats.totalExposure && !stats.betCount) return <span className={styles.subStrong}>No bets yet</span>
    return <div className={styles.stack}>
      <span className={styles.figureLine}><span className={styles.label}>P/L</span> <strong className={pl == null || pl === 0 ? undefined : pl > 0 ? styles.positive : styles.negative}>{formatCurrency(pl)}</strong>{trend(stats.plTrend, pl)}</span>
      <span className={styles.sub}><span>GGR <span>{formatCurrency(stats.ggr)}</span></span><span>Exposure <span>{formatCurrency(stats.totalExposure)}</span></span></span>
      {stats.betCount != null && <span className={styles.sub}>{stats.betCount} open bet{stats.betCount === 1 ? '' : 's'}</span>}
    </div>
  }
  // SHARING pending is signed (positive = pay the agent, negative = collect from it): its size plus who pays. CREDIT's
  // list figure is the absolute balance with no direction, so only the amount is shown.
  const pendingFact = (row: AgentListRow) => {
    const pending = row.stats?.pendingSettlement
    if (pending == null) return formatCurrency(pending)
    const label = row.schemeType === 'SHARING' && hasPendingAmount(pending) ? settlerDirectionLabel(settlementDirectionOf(null, pending)) : null
    return label ? <><span>{formatCurrency(Math.abs(pending))}</span> <span className={styles.muted}>{label}</span></> : formatCurrency(Math.abs(pending))
  }
  const pendingCell = (row: AgentListRow) => {
    const stats = row.stats
    if (!stats) return <span className={styles.subStrong}>—</span>
    const pending = stats.pendingSettlement
    const due = hasPendingAmount(pending)
    const direction = row.schemeType === 'SHARING' && due ? settlerDirectionLabel(settlementDirectionOf(null, pending)) : null
    return <div className={styles.stack}>
      {due ? <span className={styles.figureLine}><strong>{formatCurrency(Math.abs(Number(pending)))}</strong>{direction && <span className={styles.direction}>{direction}</span>}</span>
        : <span className={styles.subStrong}>Nothing pending</span>}
      <span className={styles.sub}>
        {stats.totalSettled ? <span>Settled <span>{formatCurrency(stats.totalSettled)}</span></span> : null}
        <span>{stats.lastSettlementDate ? `Last ${formatDate(stats.lastSettlementDate)}` : 'Never settled'}</span>
      </span>
    </div>
  }
  const commission = (row: AgentListRow) => <div className={styles.stack}>
    {(row.allowedDomains || []).length
      ? rates((row.allowedDomains || []).map(domain => { const rate = row.commissionRates?.find(item => item.domain === domain); return { domain, value: rate ? `${rate.rate.toFixed(1)}%` : '—' } }))
      : <span className={styles.subStrong}>No domains</span>}
    <span className={styles.figureLine}><span className={styles.label}>Earned</span> <strong>{formatCurrency(row.stats?.commissionEarned)}</strong>{trend(row.stats?.commissionTrend, row.stats?.commissionEarned)}</span>
  </div>
  const turnoverCell = (row: AgentListRow) => <strong className={styles.figure}>{formatCurrency(row.stats?.turnover)}</strong>
  const statusCell = (row: AgentListRow) => <div className={styles.stack}>
    <StatusPill status={row.status}>{statusLabel(row.status)}</StatusPill>
    <span className={styles.sub}>{row.createdAt ? `Joined ${dayjs(row.createdAt).format('MMM DD, YYYY')}` : 'Join date unknown'}</span>
  </div>

  // Settle / Pay follow the hierarchy rules in agentRowMoneyActions (agents: direct children only).
  const moneyActions = (row: AgentListRow) => agentRowMoneyActions(row, { agentId: agent?.id, isWhitelabelAdmin })
  // One action in front (what the row needs now), the rest in its ⋯ menu.
  const rowActions = (row: AgentListRow) => {
    const money = moneyActions(row)
    const due = hasPendingAmount(row.stats?.pendingSettlement)
    const earned = (row.stats?.commissionEarned ?? 0) > 0
    const name = row.username || row.id
    const chips = chipsOwnedBy(row)
    const primary = agentPrimaryAction(row, { ...money, hasPending: due, chips: !!chips })
    return <div className={styles.rowActions}>
      {primary === 'settle' ? <Button size="sm" loading={settleLoadingId === row.id} onClick={() => void openSettlement(row)}>Settle Now</Button>
        : primary === 'pay' ? <Button size="sm" onClick={() => openCommission(row)}>Pay Commission</Button>
        : primary === 'reactivate' ? <Button size="sm" loading={updatingStatus} onClick={() => void handleStatusChange(row.id, 'ACTIVE', row.status)}>Reactivate</Button>
        : primary === 'chips' && chips ? <ChipActions account={chips} onDone={chipsChanged} />
        : <Link to={`/agents/${row.id}`} className={buttonClassName({ size: 'sm' })} aria-label={`View profile ${name}`}>View</Link>}
      <Menu trigger={<IconButton size="sm" label={`More actions for ${name}`} icon={<IconDots size={16} />} />}>
        <MenuItem onSelect={() => navigate(`/agents/${row.id}`)}>View Profile</MenuItem>
        {/* Admins edit any agent; an agent edits its sub-agents (the rows here), never itself. */}
        {row.id !== agent?.id && <RBACGuard required={[{ domain: 'agents.profile', actions: ['update'] }]} bypassForAgents fallback={null}>
          <MenuItem onSelect={() => navigate(`/agents/${row.id}/edit`)}>Edit Agent</MenuItem>
        </RBACGuard>}
        {chips && <>
          <MenuItem onSelect={() => setChipDialog({ kind: 'deposit', account: chips })}>Deposit chips</MenuItem>
          <MenuItem onSelect={() => setChipDialog({ kind: 'withdraw', account: chips })}>Withdraw chips</MenuItem>
          <MenuItem onSelect={() => setChipDialog({ kind: 'creditReference', account: chips })}>Set credit reference</MenuItem>
        </>}
        {money.settle && <MenuItem disabled={!due} onSelect={() => void openSettlement(row)}>{due ? 'Settle Now' : 'Settle Now (nothing pending)'}</MenuItem>}
        {money.pay && <MenuItem disabled={!earned} onSelect={() => openCommission(row)}>{earned ? 'Pay Commission' : 'Pay Commission (nothing earned)'}</MenuItem>}
        <MenuSeparator />
        <MenuLabel>Status</MenuLabel>
        {AGENT_STATUSES.map(value => <MenuItem key={value} type="radio" checked={row.status === value} tone={value === 'SUSPENDED' ? 'danger' : 'default'}
          onSelect={() => void handleStatusChange(row.id, value, row.status)}>{statusLabel(value)}</MenuItem>)}
      </Menu>
    </div>
  }
  const columns: DataTableColumn<AgentListRow>[] = [
    { key: 'details', header: 'Agent', cell: identity, minWidth: 240 },
    { key: 'players', header: 'Players', cell: playersCell, minWidth: 150 },
    ...(schemeType === 'SHARING' ? [{ key: 'sharing', header: 'Sharing', cell: sharing, minWidth: 130 }, { key: 'dw', header: 'Deposits / Withdrawals', cell: flows, minWidth: 180 }] : []),
    ...(schemeType === 'CREDIT' ? [{ key: 'chips', header: 'Chips', cell: chipsCell, minWidth: 160 }, { key: 'refPnl', header: 'Ref P/L', cell: refPnlCell, minWidth: 170 }] : []),
    ...(['SHARING', 'CREDIT'].includes(schemeType) ? [{ key: 'performance', header: 'Performance', cell: performance, minWidth: 200 }] : []),
    ...(schemeType === 'SHARING' ? [{ key: 'settlement', header: 'Pending settlement', cell: pendingCell, minWidth: 170 }] : []),
    ...(schemeType === 'COMMISSION' ? [{ key: 'commission', header: 'Commission', cell: commission, minWidth: 220 }, { key: 'turnover', header: 'Turnover', cell: turnoverCell, minWidth: 140 }] : []),
    { key: 'status', header: 'Status', cell: statusCell, minWidth: 140 },
    { key: 'actions', header: 'Actions', cell: row => rowActions(row), minWidth: 170, sticky: 'end' },
  ]
  const schemeOption = (label: string, value: string) => ({ value, label: <>{label}{schemeCounts && <>{' '}<span className={styles.groupCount}>{schemeCounts[value] ?? 0}</span></>}</> })
  return <Page maxWidth="none" className={listStyles.page}>
    <AccountListHeader title={isAgentLoggedIn ? 'Sub Agents' : 'Agents'} description={isAgentLoggedIn ? 'Manage your network, review activity and track earnings.' : 'Manage your agent network, commissions and account activity.'} actions={<>
      {canCreateSubAgent && <Link to={isAgentLoggedIn ? '/agent/create' : '/agents/create'} className={buttonClassName({ variant: 'primary' })}><IconPlus size={16} aria-hidden />Add Agent</Link>}
    </>} />
    <StatsCards schemeType={schemeType} defer={!mainLoaded} ownNetwork={isAgentLoggedIn} chipsVersion={chipsVersion} />
    <section className={listStyles.controls} aria-label="Agent directory controls">
      {showSchemeSelector && <AccountListGroups label="Agent scheme" value={schemeType} onChange={handleSchemeTypeChange} options={[schemeOption('Commission Agents', 'COMMISSION'), schemeOption('Sharing Agents', 'SHARING'), schemeOption('Credit Agents', 'CREDIT')]} />}
    <FiltersBar query={query} status={status} onChangeQuery={setQuery} onChangeStatus={setStatus} onClearAll={() => { setQuery(''); setStatus(''); setSelectedParentAgentId(undefined); setBreadcrumb([]); setCurrentPage(1); void refetch() }} schemeType={schemeType} selectedParentAgentId={selectedParentAgentId} onChangeParentAgent={setSelectedParentAgentId} agentsForSelector={agentsForSelector} loggedInAgentId={isAgentLoggedIn ? agent?.id : undefined} />
    </section>
    <AccountListPanel title={isAgentLoggedIn ? 'All Agents' : 'Agents List'} sub={`${totalAgents} ${queryVariables.directOnly ? 'top-level ' : ''}${totalAgents === 1 ? 'agent' : 'agents'}`} body="table" tools={<div className={styles.actions}><Button size="sm" icon={<IconDownload size={16} />} loading={exportingAgents} disabled={!agents.length || fetching} onClick={() => void handleExportAgents()}>Export Excel</Button><Tabs value={viewMode} items={[{ label: 'Table', value: 'table' }, { label: 'Tree', value: 'tree' }]} onChange={setViewMode} label="Agent view" idPrefix="agents-view" size="sm" /></div>}>
      {breadcrumb.length > 0 && <nav className={styles.breadcrumb} aria-label="Agent hierarchy"><Button variant="link" onClick={() => { setBreadcrumb([]); setSelectedParentAgentId(undefined); setCurrentPage(1) }}>All Agents</Button>{breadcrumb.map((item, index) => <Button key={item.id} variant="link" onClick={() => handleBreadcrumbClick(index)}>{item.username} {item.levelIndex ? agentLevelNames[item.levelIndex] || `Level ${item.levelIndex}` : ''}</Button>)}</nav>}
      {agentsError && <Notice tone="error" title="Unable to load agents">{agentsError.message}<Button onClick={() => void refetch()}>Retry</Button></Notice>}
      <div role="tabpanel" id={tabPanelId('agents-view', viewMode)} aria-labelledby={tabId('agents-view', viewMode)}>{viewMode === 'table' ? <><DataTable label="Agents list" columns={columns} rows={agents} rowKey={row => row.id} state={fetching ? 'loading' : 'ready'} pagination={false} empty="No agents found" width="wide" /><Pagination loading={fetching} current={currentPage} pageSize={pageSize} total={totalAgents} onChange={setCurrentPage} onPageSizeChange={size => { setPageSize(size); setCurrentPage(1) }} itemName="agents" pageSizeOptions={[10, 20, 50, 100]} /></> : <>
        {fetching ? <LoadingState label="Loading agent tree" /> : agents.length ? <AgentTreeView
          key={JSON.stringify([queryVariables, currentPage, pageSize])}
          roots={agents} schemeType={schemeType} status={status}
          formatAmount={formatCurrency} pending={pendingFact} lastLogin={getTimeAgo}
          onChipsChanged={chipsChanged}
        /> : <EmptyState title="No agents found" />}
        <Pagination loading={fetching} current={currentPage} pageSize={pageSize} total={totalAgents} onChange={setCurrentPage} onPageSizeChange={size => { setPageSize(size); setCurrentPage(1) }} itemName="agents" pageSizeOptions={[10, 20, 50, 100]} />
      </>}</div>
    </AccountListPanel>
    {chipDialog && <ChipTransferModal open={chipDialog.kind !== 'creditReference'} onOpenChange={open => { if (!open) setChipDialog(null) }} account={chipDialog.account} direction={chipDialog.kind === 'withdraw' ? 'withdraw' : 'deposit'} onDone={chipsChanged} />}
    {chipDialog && <CreditReferenceModal open={chipDialog.kind === 'creditReference'} onOpenChange={open => { if (!open) setChipDialog(null) }} account={chipDialog.account} onDone={chipsChanged} />}
    {selectedAgentForSettlement && <SettlementModal visible={settlementModalVisible} agent={selectedAgentForSettlement} onCancel={() => { setSettlementModalVisible(false); setSelectedAgentForSettlement(null) }} onSubmit={async (values: { amount?: number; direction?: string; notes?: string }) => {
      const notes = String(values.notes ?? '').trim()
      if (notes.length < 3) { notify.error('Notes must be at least 3 characters', 'Validation'); return }
      // SHARING settles exactly the window the pending row covers (its periodTo), so the posted amount is the shown one.
      await settleAgent({ variables: { input: { agentId: selectedAgentForSettlement.agentId, settlementType: selectedAgentForSettlement.settlementType, amount: values.amount, direction: values.direction, notes, ...sharingSettlePeriod(selectedAgentForSettlement) } } })
    }} formatCurrency={formatCurrency} />}
    <CommissionCyclePayDialog open={payTarget != null} agentId={payTarget?.agentId} username={payTarget?.username ?? null} onClose={() => setPayTarget(null)} onPaid={() => { void refetch() }} />
  </Page>
}
