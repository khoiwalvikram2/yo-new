import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useApolloClient, useQuery } from '@apollo/client';
import { IconRefresh, IconChartPie, IconClock, IconHistory, IconChartBar, IconUsers } from '@tabler/icons-react';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { LoadingState } from '@/ui/components/LoadingState';
import { Notice } from '@/ui/components/Notice';
import { DateRangeField } from '@/ui/components/DateRangeField';
import { useAppConfig } from '@/shared/core/AppConfigProvider';
import { SETTLEMENT_DATE_PRESETS, settlementDashboardPeriod, settlementPeriodLabel, type SettlementPeriodSelection } from './settlementDashboardPeriod';
import { Select } from '@/ui/components/Select';
import { Tabs, type TabItem } from '@/ui/components/Tabs';
import { SegmentedControl } from '@/ui/components/SegmentedControl';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import type { SettlementSummary, PendingSettlement, SettlementDashboard, SettlementHistoryRow } from './settlementModel';
import styles from './SettlementCenter.module.css';
import { useAuthStore } from '@/shared/core/authStore';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ENHANCED_PENDING_SETTLEMENTS_QUERY,
  SETTLEMENT_DASHBOARD_QUERY,
  SUB_AGENTS_PENDING_SETTLEMENTS_QUERY,
  ALL_SETTLEMENT_HISTORY_QUERY,
} from '@/lib/graphql/settlements';
import { SETTLEMENT_SUMMARY_QUERY, AGENT_SETTLEMENTS_QUERY, DOWNLINE_SETTLEMENT_HISTORY_QUERY } from '@/lib/graphql/agents';
import { LastSettlementCard } from './components/LastSettlementCard';
import dayjs from 'dayjs';
import { RBACGuard } from '@/shared/core/RBACGuard';

// Lazy-load heavy tab components so initial bundle is smaller and page becomes interactive sooner
const loadPendingSettlements = () => import('./components/PendingSettlementsSection').then(m => ({ default: m.PendingSettlementsSection }));
const loadPendingCommission = () => import('./components/PendingCommissionSection').then(m => ({ default: m.PendingCommissionSection }));
const PendingSettlementsSection = lazy(loadPendingSettlements);
const PendingCommissionSection = lazy(loadPendingCommission);
const SettlementHistorySection = lazy(() => import('./components/SettlementHistorySection').then(m => ({ default: m.SettlementHistorySection })));
const SettlementDashboardTab = lazy(() => import('./components/SettlementDashboardTab').then(m => ({ default: m.SettlementDashboardTab })));
const DomainBreakdownSection = lazy(() => import('./components/DomainBreakdownSection').then(m => ({ default: m.DomainBreakdownSection })));
const PlayerContributionsSection = lazy(() => import('./components/PlayerContributionsSection').then(m => ({ default: m.PlayerContributionsSection })));
const SubAgentContributionsSection = lazy(() => import('./components/SubAgentContributionsSection').then(m => ({ default: m.SubAgentContributionsSection })));

const VALID_TABS = ['dashboard', 'pending', 'history', 'breakdown', 'contributions'] as const;
type TabKey = (typeof VALID_TABS)[number];

function SettlementTabSkeleton() { return <LoadingState label="Loading settlement data..." />; }

function isValidTab(tab: string | null): tab is TabKey {
  return tab !== null && (VALID_TABS as readonly string[]).includes(tab);
}

/** A pending row's scheme, upper-cased: the row's own, else its agent's. */
function pendingScheme(row: PendingSettlement): string {
  return (row.schemeType || row.agent?.schemeType || '').toUpperCase();
}

export default function UnifiedSettlementPage() {
  return (
    <RBACGuard required={[{ domain: 'settlements.center', actions: ['view'] }]} bypassForAgents>
      <UnifiedSettlementPageContent />
    </RBACGuard>
  );
}

function UnifiedSettlementPageContent() {
  const client = useApolloClient();
  const [refreshing, setRefreshing] = useState(false);
  const { timeZone } = useAppConfig();
  const [dashboardPeriod, setDashboardPeriod] = useState<SettlementPeriodSelection>({ preset: 'thisMonth' });
  const [dashboardAsOf, setDashboardAsOf] = useState(() => new Date());
  const dashboardRange = useMemo(() => settlementDashboardPeriod(dashboardPeriod, timeZone, dashboardAsOf), [dashboardPeriod, timeZone, dashboardAsOf]);
  const dashboardRangeLabel = settlementPeriodLabel(dashboardRange.fromDate, dashboardRange.toDate, timeZone);
  const agent = useAuthStore(s => s.agent);
  const roles = useAuthStore(s => s.roles) ?? [];
  const isAgent = !!agent;
  const isCommissionAgent = agent?.schemeType === 'COMMISSION';
  // CREDIT left the settlement centre on 2026-11-02 (spec §6): a CREDIT account's chips move only by Deposit /
  // Withdraw from its direct parent, and what it owes or is owed is its Ref P/L, on its Chips page. Only a
  // SHARING agent has P/L settlements with its upline and its sub-agents.
  const isCreditAgent = agent?.schemeType === 'CREDIT';
  const isSharingAgent = agent?.schemeType === 'SHARING';
  const agentSchemeType = agent?.schemeType as 'SHARING' | 'CREDIT' | 'COMMISSION' | undefined;
  const isWhitelabelAdmin = !isAgent && roles.some((r: string) =>
    r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
  );
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tabFromUrl = searchParams.get('tab');
  const resolvedTab = isValidTab(tabFromUrl) ? tabFromUrl : 'dashboard';
  const [activeTab, setActiveTab] = useState(resolvedTab);
  // Admin: which agent's contributions to show on Contributions tab (agentId from pending list)
  const [selectedAgentIdForContributions, setSelectedAgentIdForContributions] = useState<string | null>(null);
  // Admin: Pending Settlements sub-tab (Sharing | Commission); CREDIT has no settlements any more.
  const [pendingSubTab, setPendingSubTab] = useState<'sharing' | 'commission'>('sharing');

  // Redirect COMMISSION agents to Commission section — they manage earnings there, not P&L settlements
  useEffect(() => {
    if (isAgent && isCommissionAgent) {
      navigate('/commission/overview', { replace: true });
    }
  }, [isAgent, isCommissionAgent, navigate]);

  // Redirect CREDIT agents to their Chips page: their D / W, downline and Ref P/L live there, not here.
  useEffect(() => {
    if (isAgent && isCreditAgent) {
      navigate('/agent/credit', { replace: true });
    }
  }, [isAgent, isCreditAgent, navigate]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    setActiveTab(isValidTab(tab) ? tab : 'dashboard');
  }, [searchParams]);

  // Warm the two Pending chunks while the dashboard is visible; this makes no data request.
  useEffect(() => {
    if (activeTab === 'dashboard' && !isCommissionAgent && !isCreditAgent) {
      void loadPendingSettlements().catch(() => undefined);
      void loadPendingCommission().catch(() => undefined);
    }
  }, [activeTab, isCommissionAgent, isCreditAgent]);

  // Whitelabel admins: redirect away from Domain Breakdown and Contributions (tabs are hidden)
  useEffect(() => {
    if (isWhitelabelAdmin && (activeTab === 'breakdown' || activeTab === 'contributions')) {
      setActiveTab('dashboard');
      navigate('/settlement?tab=dashboard', { replace: true });
    }
  }, [isWhitelabelAdmin, activeTab, navigate]);

  // For agents: get their own settlement summary
  const periodFrom = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const periodTo = dayjs().format('YYYY-MM-DD');

  const { data: summaryData, loading: summaryLoading } = useQuery<{ agents: { settlementSummary: SettlementSummary | null } }>(SETTLEMENT_SUMMARY_QUERY, {
    variables: {
      agentId: agent?.id,
      periodFrom,
      periodTo,
    },
    skip: !isAgent || !agent?.id || !isSharingAgent,
    fetchPolicy: 'cache-and-network',
  });

  // Defer queries by active tab so initial load only fetches data for the visible tab (faster first paint)

  // For admins: get enhanced pending settlements (needed for pending, breakdown, contributions)
  const needPendingForTab = !isAgent && ((activeTab === 'pending' && pendingSubTab !== 'commission') || activeTab === 'breakdown' || activeTab === 'contributions');
  const { data: pendingData, loading: pendingLoading, error: pendingError, refetch: refetchPendingSettlements } = useQuery<{ enhancedPendingSettlements: PendingSettlement[] }>(ENHANCED_PENDING_SETTLEMENTS_QUERY, {
    variables: { schemeType: activeTab === 'pending' ? pendingSubTab.toUpperCase() : undefined },
    skip: isAgent || !needPendingForTab,
    fetchPolicy: 'cache-and-network',
  });

  // For parent agents: get sub-agents' pending settlements (needed only for pending tab)
  const needSubAgentsPending = isAgent && isSharingAgent && activeTab === 'pending';
  const { data: subAgentsPendingData, loading: subAgentsPendingLoading, error: subAgentsPendingError } = useQuery<{ subAgentsPendingSettlements: PendingSettlement[] }>(SUB_AGENTS_PENDING_SETTLEMENTS_QUERY, {
    skip: !needSubAgentsPending,
    fetchPolicy: 'cache-and-network',
  });
  const subAgentsPending = subAgentsPendingData?.subAgentsPendingSettlements ?? [];

  // For admins: get settlement dashboard (needed only for dashboard tab)
  const needDashboard = !isAgent && activeTab === 'dashboard';
  const {
    data: dashboardData,
    loading: dashboardLoading,
    error: dashboardError,
  } = useQuery<{ settlementDashboard: SettlementDashboard | null }>(SETTLEMENT_DASHBOARD_QUERY, {
    variables: dashboardRange,
    notifyOnNetworkStatusChange: true,
    skip: isAgent || !needDashboard,
    fetchPolicy: 'cache-and-network',
  });

  // Get settlement history for agents (their own settlements - upline); needed only for history tab
  const needAgentHistory = isAgent && agent?.id && isSharingAgent && activeTab === 'history';
  const { data: historyData, loading: historyLoading } = useQuery<{ agents: { agentSettlements: SettlementHistoryRow[] } }>(AGENT_SETTLEMENTS_QUERY, {
    variables: {
      agentId: agent?.id || '',
      periodFrom: dayjs().subtract(365, 'day').format('YYYY-MM-DD'),
      periodTo: dayjs().format('YYYY-MM-DD'),
    },
    skip: !needAgentHistory,
    fetchPolicy: 'cache-and-network',
  });

  // Get downline settlement history for agents; needed only for history tab
  const periodFrom365 = dayjs().subtract(365, 'day').format('YYYY-MM-DD');
  const periodTo365 = dayjs().format('YYYY-MM-DD');
  const { data: downlineHistoryData, loading: downlineHistoryLoading } = useQuery<{ agents: { downlineSettlementHistory: SettlementHistoryRow[] } }>(DOWNLINE_SETTLEMENT_HISTORY_QUERY, {
    variables: { periodFrom: periodFrom365, periodTo: periodTo365 },
    skip: !isAgent || !agent?.id || !isSharingAgent || activeTab !== 'history',
    fetchPolicy: 'cache-and-network',
  });

  // Get settlement history for admins; needed only for history tab. Every row of the 365-day window: the table
  // pages, searches and filters them here, so a cap (it was the newest 100) hid older payouts from all three. The
  // server builds every row of the window either way; a limit only trimmed the answer.
  const needAdminHistory = !isAgent && activeTab === 'history';
  const { data: adminHistoryData, loading: adminHistoryLoading } = useQuery<{ allSettlementHistory: SettlementHistoryRow[] }>(ALL_SETTLEMENT_HISTORY_QUERY, {
    variables: {
      fromDate: dayjs().subtract(365, 'day').format('YYYY-MM-DD'),
      toDate: dayjs().format('YYYY-MM-DD'),
    },
    skip: !needAdminHistory,
    fetchPolicy: 'cache-and-network',
  });

  const settlement = summaryData?.agents?.settlementSummary;
  // A CREDIT row is never listed (pending, breakdown or contributions), even from a server that still sends one:
  // a CREDIT agent is not settled by settleAgent any more, it moves chips.
  const allPendingSettlements = useMemo(() => (pendingData?.enhancedPendingSettlements || []).filter(row => pendingScheme(row) !== 'CREDIT'), [pendingData]);
  // Admin: filter by selected sub-tab (Sharing / Commission)
  const pendingSettlements =
    !isAgent && pendingSubTab
      ? allPendingSettlements.filter(s => {
          const scheme = pendingScheme(s);
          if (pendingSubTab === 'sharing') return scheme === 'SHARING';
          if (pendingSubTab === 'commission') return scheme === 'COMMISSION';
          return true;
        })
      : allPendingSettlements;
  const agentSettlements = historyData?.agents?.agentSettlements || [];
  const downlineSettlements = downlineHistoryData?.agents?.downlineSettlementHistory || [];
  const adminSettlements = adminHistoryData?.allSettlementHistory || [];

  // Per-tab loading (no full-page block — shell shows immediately)
  const activeTabLoading =
    activeTab === 'dashboard' ? (isAgent ? summaryLoading : dashboardLoading)
    : activeTab === 'pending' ? (isAgent ? subAgentsPendingLoading : pendingLoading)
    : activeTab === 'history' ? (isAgent ? (historyLoading || downlineHistoryLoading) : adminHistoryLoading)
    : activeTab === 'breakdown' || activeTab === 'contributions' ? pendingLoading
    : false;

  const handleRefresh = async () => {
    setRefreshing(true);
    setDashboardAsOf(new Date());
    try {
      const names = new Set(['SettlementDashboard', 'EnhancedPendingSettlements', 'SubAgentsPendingSettlements',
        'AllSettlementHistory', 'SettlementSummary', 'AgentSettlements', 'DownlineSettlementHistory',
        'WhitelabelCommissionSummaries', 'CurrentCommissionCycle']);
      await client.refetchQueries({ include: 'active', onQueryUpdated: query =>
        names.has(query.queryName ?? '') ? query.refetch() : false });
    } finally { setRefreshing(false); }
  };
  const pendingTabError = isAgent ? subAgentsPendingError : pendingError;

  if (isAgent && isCommissionAgent) return <Page maxWidth="wide" className={styles.page}><LoadingState label="Redirecting to Commission…" /></Page>;
  if (isAgent && isCreditAgent) return <Page maxWidth="wide" className={styles.page}><LoadingState label="Redirecting to Chips…" /></Page>;
  const tabOptions: TabItem<TabKey>[] = [
    { value: 'dashboard', label: 'Dashboard', icon: <IconChartPie size={16} /> },
    { value: 'pending', label: 'Pending', icon: <IconClock size={16} /> },
    { value: 'history', label: 'History', icon: <IconHistory size={16} /> },
    ...(isWhitelabelAdmin ? [] : [
      { value: 'breakdown' as const, label: 'Breakdown', icon: <IconChartBar size={16} /> },
      { value: 'contributions' as const, label: 'Contributions', icon: <IconUsers size={16} /> },
    ]),
  ];
  const selectedContribution = isAgent ? settlement : selectedAgentIdForContributions ? allPendingSettlements.find(row => row.agentId === selectedAgentIdForContributions) : undefined;
  return <Page maxWidth="wide" className={styles.page}>
    <PageHeader title={isAgent ? 'Settlement Center' : 'Settlement Management'}
      sub={isAgent ? 'View and manage your profit & loss settlements' : 'Manage agent settlements and commission payouts'}
      actions={<div className={styles.tools}><Button icon={<IconRefresh size={17} />} loading={refreshing} onClick={() => { void handleRefresh().catch(() => undefined); }}>Refresh</Button>
        {isAgent && settlement && settlement.settlementDue !== 0 && <Button onClick={() => { setActiveTab('pending'); navigate('/settlement?tab=pending', { replace: true }); }}>Request Settlement</Button>}
      </div>} />
    {isAgent && settlement && <LastSettlementCard settlement={settlement} />}
    <div className={styles.periodScroll}><Tabs value={activeTab} items={tabOptions} label="Settlement tabs" idPrefix="settlement-center"
      onChange={next => { setActiveTab(next); navigate(`/settlement?tab=${next}`, { replace: true }); }} /></div>
    <div className={styles.tabPanel} role="tabpanel" tabIndex={0} id={tabPanelId('settlement-center', activeTab)} aria-labelledby={tabId('settlement-center', activeTab)}>
      {activeTab === 'dashboard' && !isAgent && <div className={styles.dashboardFilters}>
        <div><p className={styles.sectionTitle}>Settlement activity · {dashboardRangeLabel}</p><p className={styles.note}>Pending balances are live. The date filter applies to completed settlements and commission payments. Dates use {timeZone}.</p></div>
        <DateRangeField label="Activity period" presets={SETTLEMENT_DATE_PRESETS} appliedPreset={dashboardPeriod.preset}
          appliedFrom={dashboardRange.fromDate} appliedTo={dashboardRange.toDate}
          onReset={() => { setDashboardAsOf(new Date()); setDashboardPeriod({ preset: 'thisMonth' }); }}
          onApply={payload => {
            setDashboardAsOf(new Date());
            if (payload.kind === 'custom') setDashboardPeriod({ preset: 'custom', from: payload.from, to: payload.to });
            else if (SETTLEMENT_DATE_PRESETS.some(preset => preset.value === payload.preset && preset.value !== 'custom')) setDashboardPeriod({ preset: payload.preset as Exclude<SettlementPeriodSelection['preset'], 'custom'> });
          }} />
      </div>}
      {/* the dashboard tab draws its own placeholder figures, so only the list tabs swap for the skeleton */}
      {activeTab === 'pending' ? <div className={styles.stack}>
            {!isAgent && <SegmentedControl value={pendingSubTab} onChange={setPendingSubTab} label="Pending settlements sub-tabs" options={[{ value: 'sharing', label: 'Sharing' }, { value: 'commission', label: 'Commission' }]} />}
            <Suspense fallback={<SettlementTabSkeleton />}>{pendingSubTab === 'commission' ? <PendingCommissionSection /> : pendingTabError ? <Notice tone="error" title="Failed to load pending settlements" action={<Button size="sm" onClick={() => { void handleRefresh().catch(() => undefined); }}>Retry</Button>}>{pendingTabError.message}</Notice> : ((!isAgent && pendingLoading && !pendingData) || (isAgent && subAgentsPendingLoading && !subAgentsPendingData)) ? <SettlementTabSkeleton /> : <PendingSettlementsSection isAgent={isAgent} agentSchemeType={agentSchemeType} settlement={settlement} pendingSettlements={pendingSettlements} refetchPendingSettlements={refetchPendingSettlements} subAgentsPending={subAgentsPending} subAgentsPendingLoading={subAgentsPendingLoading} />}</Suspense>
          </div>
        : activeTabLoading && activeTab !== 'dashboard' ? <SettlementTabSkeleton /> : <Suspense fallback={<SettlementTabSkeleton />}>
        {activeTab === 'dashboard' ? <SettlementDashboardTab isAgent={isAgent} agentSchemeType={agentSchemeType} dashboard={dashboardData?.settlementDashboard ?? null} activityPeriodLabel={dashboardRangeLabel} settlement={settlement} loading={isAgent ? summaryLoading : dashboardLoading} error={dashboardError ?? undefined} />
          : activeTab === 'history' ? <SettlementHistorySection isAgent={isAgent} agentSchemeType={agentSchemeType} settlements={isAgent ? agentSettlements : adminSettlements} downlineSettlements={isAgent ? downlineSettlements : undefined} />
          : activeTab === 'breakdown' ? <DomainBreakdownSection isAgent={isAgent} agentSchemeType={agentSchemeType} settlement={settlement} pendingSettlements={allPendingSettlements} />
          : activeTab === 'contributions' ? <div className={styles.stack}>
            {!isAgent && allPendingSettlements.length > 0 && <Card><div className={styles.filters}>
              <Select label="View contributions for:" layout="stacked" className={styles.agentSelect} value={selectedAgentIdForContributions || ''} onChange={id => setSelectedAgentIdForContributions(id || null)}
                options={[{ value: '', label: 'Select an agent' }, ...allPendingSettlements.map(row => ({ value: row.agentId, label: row.agent?.username || row.agentId || 'Unknown' }))]} />
              <span className={styles.muted}>Choose an agent to view their direct players and sub-agent contributions below.</span>
            </div></Card>}
            <PlayerContributionsSection isAgent={isAgent} agentSchemeType={agentSchemeType} settlement={selectedContribution} pendingSettlements={allPendingSettlements} />
            <SubAgentContributionsSection isAgent={isAgent} agentSchemeType={agentSchemeType} settlement={selectedContribution} pendingSettlements={allPendingSettlements} />
          </div> : null}
      </Suspense>}
    </div>
  </Page>;
}
