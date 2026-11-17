import { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
/* The mockup's .card-head is a title over an optional sub (M:857-866) with no icon slot, so
   the per-section glyphs SectionHeader used to carry have no home here. The icons that remain
   are the ones the mockup does specify: a .stile in a snapshot row and a .ftile in a feed row. */
import {
  IconRefresh,
  IconCalendar,
  IconChartPie,
  IconTrophy,
  IconClock,
  IconUsers,
  IconUserCheck,
  IconUserPlus,
  IconChartLine,
  IconCurrencyDollar,
  IconAlertTriangle,
  IconBell,
  IconInfoCircle,
  IconAlertCircle,
  IconShieldLock,
} from '@tabler/icons-react';
import { Spinner } from '@/ui/components/Spinner';
import { LoadingState } from '@/ui/components/LoadingState';
import { Notice } from '@/ui/components/Notice';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { PageHeader } from '@/ui/components/PageHeader';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { ListRow } from '@/ui/components/ListRow';
import { SegmentedControl } from '@/ui/components/SegmentedControl';
import { Tabs } from '@/ui/components/Tabs';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import { KPICards } from './components/KPICards';
import { PeriodPanel } from './components/PeriodPanel';
import { OperationsSections } from './components/OperationsSections';
import { BigBetsCard, TopRiskEventsCard } from './components/InsightCards';
import { BonusAnalysisSection, CasinoProvidersCard } from './components/FinancialInsights';
import { PlayersTab } from './components/PlayersTab';
import { FinancialTab } from './components/FinancialTab';
import { AgentsTab } from './components/AgentsTab';
import { TimeTab } from './components/TimeTab';
import { DrillButton, DrilldownProvider } from './components/DrilldownDialog';
import { RealtimeSnapshotCard } from './components/RealtimeSnapshotCard';
import { ExposureByMarketCard } from './components/ExposureByMarketCard';
import { RevenueBars } from './components/RevenueBars';
import { ReportsBanner } from './components/ReportsBanner';
/* The Export Center's own whitelabel-context rule, from its small module rather than from
   ExportsPage, which is a large lazy chunk. */
import { useCanAccessExportCenterContext } from '../reporting/exportCenterAccess';
/* Only the trigger: the three Financial charts render their own ChartDialog, so that it redraws
   the data they have already fetched rather than mounting a second polling query in here. */
import { lazyWithRetry } from '@/shared/utils/lazyWithRetry';
import dash from './dashboard.module.css';
import styles from './OverviewPage.module.css';

const FinancialSummaryTable = lazyWithRetry(() => import('./components/FinancialSummaryTable').then(m => ({ default: m.FinancialSummaryTable })));
const TopPlayersTable = lazyWithRetry(() => import('./components/TopPlayersTable').then(m => ({ default: m.TopPlayersTable })));


function ChartFallback({ height }: { height?: number }) {
  if (height !== undefined) return <LoadingState height={height} label="Loading chart" />;
  return (
    <div className={styles.chartFallback}>
      <Spinner size="md" label="Loading chart" />
    </div>
  );
}
import { useQuery, useApolloClient } from '@apollo/client';
import { DASHBOARD_KPIS_QUERY } from './graphql';
import { useDashboardStore, type DateRangePreset } from '@/state/dashboardStore';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useUIStore } from '@/shared/core/uiStore';
import { useAuthStore } from '@/shared/core/authStore';
import { useWhitelabels } from '@/shared/core/useWhitelabels';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping';
import { Popover } from '@/ui/components/Popover';

/** Tab keys for dashboard segments */
const TAB_KEYS = ['overview', 'players', 'financial', 'agents', 'time'] as const;
type TabKey = (typeof TAB_KEYS)[number];

/* The ids that tie a tab to the panel it controls. The strip derives its own half from the
   same prefix, so the two halves cannot drift apart. */
const TABS_ID_PREFIX = 'ov-dash';
const tabButtonId = (tab: TabKey) => tabId(TABS_ID_PREFIX, tab);
const panelId = (tab: TabKey) => tabPanelId(TABS_ID_PREFIX, tab);

/** Returns true if user can see the given dashboard tab (RBAC masking). */
function canViewDashboardTab(
  permissions: { domain: string; actions: string[] }[],
  tab: TabKey
): boolean {
  if (tab === 'overview') return true; // Page guard already ensured overview.dashboard:view
  if (tab === 'players')
    return (
      hasPermissionWithNested(permissions, 'players.list', 'view') ||
      hasPermissionWithNested(permissions, 'users', 'read')
    );
  if (tab === 'financial')
    return (
      hasPermissionWithNested(permissions, 'reporting', 'read') ||
      hasPermissionWithNested(permissions, 'finance', 'read')
    );
  if (tab === 'agents')
    return (
      hasPermissionWithNested(permissions, 'agents.list', 'view') ||
      hasPermissionWithNested(permissions, 'agents', 'view') ||
      hasPermissionWithNested(permissions, 'agents', 'read')
    );
  if (tab === 'time')
    return (
      hasPermissionWithNested(permissions, 'reporting', 'read') ||
      hasPermissionWithNested(permissions, 'finance', 'read')
    );
  return false;
}

/* The five tabs, same order and same copy. The Font Awesome glyphs are gone and with them the
   four hardcoded hex values they were tinted with: a .seg button's glyph takes the button's own
   colour, so it moves through --ink-2 / --ink / --acc-on with the label as the mockup intends,
   and nothing on this row paints a colour of its own any more. */
const TAB_OPTIONS_BASE: { value: TabKey; label: string; icon: ReactNode }[] = [
  { value: 'overview', label: 'Overview', icon: <IconChartPie size={15} stroke={1.75} /> },
  { value: 'players', label: 'Players', icon: <IconUsers size={15} stroke={1.75} /> },
  { value: 'financial', label: 'Financial', icon: <IconChartLine size={15} stroke={1.75} /> },
  { value: 'agents', label: 'Agents', icon: <IconTrophy size={15} stroke={1.75} /> },
  { value: 'time', label: 'Time', icon: <IconClock size={15} stroke={1.75} /> },
];

/* The four the mockup's header .seg names (M:1742-1745), on the labels the shared picker
   already uses for them. The other three presets it offers — This Month, Last Month and a
   custom range — stay reachable through the pill, so nothing is lost by naming four here. */
const PERIOD_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: '7D' },
  { value: 'last30days', label: '30D' },
];

const EMPTY_PERMISSIONS: { domain: string; actions: string[] }[] = [];



export default function OverviewPage() {
  return (
    <RBACGuard
      required={[{ domain: 'overview.dashboard', actions: ['view'] }]}
      fallback={
        <div className={clsx(dash.page, styles.pageRoot)}>
          <Notice
            tone="warn"
            icon={<IconShieldLock size={18} stroke={1.75} />}
            title="Access denied"
          >
            You do not have permission to view the dashboard. Required: overview.dashboard (view).
          </Notice>
        </div>
      }
    >
      <DashboardDrilldowns>
        <OverviewPageContent />
      </DashboardDrilldowns>
    </RBACGuard>
  );
}

/* Every figure that stands for a list opens it in a modal (the owner's ask, 2026-10-29). Not for an
   agent's session: the drill-down query is admin-only, so an agent's figures stay plain. */
function DashboardDrilldowns({ children }: { children: ReactNode }) {
  const isAgent = Boolean(useAuthStore(s => s.agent));
  return <DrilldownProvider enabled={!isAgent}>{children}</DrilldownProvider>;
}

function OverviewPageContent() {
  const permissions = useAuthStore(s => s.permissions) ?? EMPTY_PERMISSIONS;
  /* The shell names the section the page opens in (the dashboard keeps "Analytics" inside the merged
     Trading panel); the page's own word stands in outside the shell. */
  const pageEyebrow = usePageEyebrow() ?? 'Analytics';
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const { filters, getDateRangeForQuery, setDateRangePreset, refreshRelativeRange } = useDashboardStore();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDate } = useFormatDate();
  const dateRange = getDateRangeForQuery();

  /* A relative preset names a window on the IST clock, so the page keeps it on the clock: once
     on mount (in-app navigation keeps the store, and its dates, from an earlier visit), every
     minute, and on returning to the tab. Without it a board left on "Today" past midnight kept
     querying yesterday while the topbar clock showed the new day. Same-day calls are no-ops that
     keep the store's identity, so nothing re-renders or refetches. The reload path is covered
     by the store's persist merge. */
  useEffect(() => {
    refreshRelativeRange();
    const timer = window.setInterval(refreshRelativeRange, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshRelativeRange();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshRelativeRange]);

  /* The pill states the range that is actually applied (M:1739), on the same "dd MMM yyyy" the
     app formats every other date with. The seg reads the same applied preset, so a period set
     to This Month, Last Month or a custom range simply leaves all four segments unpressed —
     the control never claims a period that is not the one in force. The store resolves every
     range it holds to both dates, so the pill always has a range to state. */
  const { preset: appliedPreset, dateFrom: appliedFrom, dateTo: appliedTo } = filters.dateRange;
  const rangeText = `${formatDate(appliedFrom)} – ${formatDate(appliedTo)}`;

  const directorMode = useUIStore(s => s.directorMode);
  const selectedWhitelabelId = useUIStore(s => s.selectedWhitelabelId);
  const roles = useAuthStore(s => s.roles) || [];
  const { whitelabels } = useWhitelabels();

  /* Each of the two links the Overview tab adds is shown only where its destination opens. The
     exposure card (and its "View all") needs the Exposure Report's own gate. The reports band
     needs the Export Center's two: its permission, and the whitelabel-context rule its guard runs,
     so a Super Admin in core mode is not sent to a 403. The router mounts this page for admins
     only (adminRoute), so `permissions` is the list both pages' RBACGuards read. */
  const canViewExposure = hasPermissionWithNested(permissions, 'reporting.exposure', 'view');
  const exportCenterInContext = useCanAccessExportCenterContext();
  const canOpenExportCenter =
    exportCenterInContext && hasPermissionWithNested(permissions, 'reporting.exports', 'view');

  const visibleTabs = useMemo(
    () => TAB_KEYS.filter(tab => canViewDashboardTab(permissions, tab)),
    [permissions]
  );
  const visibleTabOptions = useMemo(
    () => TAB_OPTIONS_BASE.filter(opt => visibleTabs.includes(opt.value)).map(opt => ({ ...opt })),
    [visibleTabs]
  );

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [visibleTabs, activeTab]);
  const isSuperAdmin = roles.some(r => {
    const roleLower = r?.toLowerCase() || '';
    return (
      r === 'Super Admin' ||
      roleLower === 'super_admin' ||
      (roleLower.includes('super') && roleLower.includes('admin'))
    );
  });
  const isDirector = roles.some(r => {
    const roleLower = r?.toLowerCase() || '';
    return (
      r === 'Director Admin' ||
      r === 'Director' ||
      roleLower === 'director_admin' ||
      roleLower === 'director admin' ||
      roleLower.includes('director')
    );
  });

  const apolloClient = useApolloClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, error, loading } = useQuery(DASHBOARD_KPIS_QUERY, {
    variables: { dateRange },
    pollInterval: 60000,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  });

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await apolloClient.refetchQueries({ include: 'active' });
    } finally {
      setRefreshing(false);
    }
  }, [apolloClient]);

  const kpis = data?.overviewKPIs;

  const renderDataUnavailable = (message: string) => (
    <Notice tone="info" icon={<IconInfoCircle size={18} stroke={1.75} />}>
      {message}
    </Notice>
  );

  const overviewTabContent = (
    <div
      className={styles.stack}
      role="tabpanel"
      id={panelId('overview')}
      aria-labelledby={tabButtonId('overview')}
    >
      {/* KPI Cards: straight under the tabs, as the kit's dashboard sets its .stats row; the heading
          that floated above them is the section's name for assistive tech only. */}
      <section aria-label="Financial performance">
        <KPICards />
      </section>

      {kpis ? (
        /* The mockup's dashboard body (M:1753-1842): a two-column grid, then the reports band
           under it. The wide analytical cards sit in the left .gcol (2.2fr) and the compact rail
           in the right one (1fr), both stacking on the tab's 20px. .grid collapses to one column
           at 1279px (dashboard.module.css:461), where everything stacks in DOM order: Revenue,
           the operations sections and insight cards, then the rail's cards, then the band.

           The rail, top to bottom:
           - Real-time snapshot (M:1810-1817): what is happening now, on its own 10 s poll of
             Query.realtimeSnapshot. Players who placed a bet in the trailing window the server
             reports (there is no presence data), bets open now across sports, casino and matka,
             and deposit and withdrawal requests settled in the last hour. It shows when its
             reading was taken and wears the Live badge only while its latest poll succeeded.
           - Exposure by market (M:1819-1826): the open book now, one row per sport plus one for
             matka, on its own 15 s poll of Query.exposureByMarket. For any period ending today
             its rows add up to the Exposure figure in the next card; casino is in neither.
             Shown only with reporting.exposure:view.
           - Risk & Liquidity and Player Overview: this page's own period KPIs, on the snapshot's
             .snap row idiom.
           The two polling cards take no date range, so the period presets above do not move
           them.

           The band (M:1829-1842) sits inside this kpis-gated branch, next to the grid, so it
           cannot render above the grid and then jump down when the KPIs land. It is shown only
           when the Export Center it opens would let this user in. */
        <>
          <div className={dash.grid}>
            <div className={dash.gcol}>
              {/* The kit's Revenue panel (2026-10-29): gross revenue by day, week or month, its latest bar red.
                  Its own query and window, like the rail's cards. */}
              <RevenueBars />

              {/* The owner's operations sections (2026-10-29), in place of Advanced Analytics: money in and
                  out (or chips, for a credit whitelabel), pending actions, player activity, registrations,
                  balances and agents. Its own query; the period totals come from these KPIs. */}
              <OperationsSections kpis={kpis} />

              {/* The period's biggest bets and winners (Query.dashboardInsights). The credit scheme is on chips
                  since 2026-11-02, so there is no "near credit limit" card any more. */}
              <BigBetsCard />
            </div>

            <div className={dash.gcol}>
              {/* Beside the Revenue panel, as the kit pairs them (2026-10-29). Its own query and poll; hidden,
                  not replaced by a placeholder, for a user who cannot open the Exposure Report. */}
              {canViewExposure ? <ExposureByMarketCard /> : null}
              {/* The same open book by event and draw, largest first; the same permission. */}
              {canViewExposure ? <TopRiskEventsCard /> : null}
              {/* Then the live snapshot (M:1810). It runs its own query and poll. */}
              <RealtimeSnapshotCard />
              <Card title="Risk & Liquidity" body="flush">
                <ul className={styles.rowListInset}>
                  <ListRow
                    variant="stat"
                    accent="green"
                    icon={<IconCurrencyDollar size={16} stroke={1.75} />}
                    label="Liquidity"
                    sub="Available"
                    value={formatAmount(convertFromWhitelabelCurrency(Number(kpis.liquidity ?? 0)))}
                  />
                  <ListRow
                    variant="stat"
                    accent="amber"
                    icon={<IconChartLine size={16} stroke={1.75} />}
                    label="Exposure"
                    sub="Total risk"
                    value={<DrillButton drill={{ kind: 'bets', arg: 'exposure', title: 'Open bets (exposure)' }}>{formatAmount(convertFromWhitelabelCurrency(Number(kpis.exposure ?? 0)))}</DrillButton>}
                  />
                  <ListRow
                    variant="stat"
                    accent="rose"
                    icon={<IconAlertTriangle size={16} stroke={1.75} />}
                    label="Unmatched"
                    sub="Orders"
                    value={<DrillButton drill={{ kind: 'bets', arg: 'unmatched', title: 'Unmatched bets' }}>{(kpis.unmatchedOrders ?? 0).toLocaleString()}</DrillButton>}
                  />
                  <ListRow
                    variant="stat"
                    accent="violet"
                    icon={<IconBell size={16} stroke={1.75} />}
                    label="Alerts"
                    sub="Active"
                    value={String(kpis.alerts?.length ?? 0)}
                  />
                </ul>
              </Card>
              <Card title="Player Overview" body="flush">
                <ul className={styles.rowListInset}>
                  <ListRow
                    variant="stat"
                    accent="blue"
                    icon={<IconUsers size={16} stroke={1.75} />}
                    label="Total Players"
                    value={<DrillButton drill={{ kind: 'players', title: 'All players' }}>{(kpis.totalPlayers ?? 0).toLocaleString()}</DrillButton>}
                  />
                  <ListRow
                    variant="stat"
                    accent="green"
                    icon={<IconUserCheck size={16} stroke={1.75} />}
                    label="Active Players"
                    value={(kpis.activePlayers ?? 0).toLocaleString()}
                  />
                  <ListRow
                    variant="stat"
                    accent="violet"
                    icon={<IconUserPlus size={16} stroke={1.75} />}
                    label="New Players"
                    value={<DrillButton drill={{ kind: 'players', arg: 'registered:period', title: 'New players' }}>{(kpis.newPlayers ?? 0).toLocaleString()}</DrillButton>}
                  />
                </ul>
              </Card>
            </div>
          </div>
          {/* A direct child of the tab's .stack, so its 20px gap is the mockup's margin-top. */}
          {canOpenExportCenter ? <ReportsBanner /> : null}
        </>
      ) : !loading && !error ? (
        renderDataUnavailable('Advanced analytics unavailable for this range.')
      ) : null}
    </div>
  );

  /* The Players, Financial, Agents and Time tabs were rebuilt on real data (the owner's redesign,
     2026-10-29); each tab component explains its cards. The Players tab ends with the balance table,
     moved here from Financial: it ranks players, not money. */
  const playersTabContent = (
    <div
      className={styles.stack}
      role="tabpanel"
      id={panelId('players')}
      aria-labelledby={tabButtonId('players')}
    >
      <PlayersTab />
      <Card title="Top Players by Balance" body="table">
        <Suspense fallback={<ChartFallback />}>
          <TopPlayersTable />
        </Suspense>
      </Card>
    </div>
  );

  const financialTabContent = (
    <div
      className={styles.stack}
      role="tabpanel"
      id={panelId('financial')}
      aria-labelledby={tabButtonId('financial')}
    >
      <FinancialTab kpis={kpis} />
      {/* Shared Table/DataTable own the horizontal gutter and overflow cue; Card's table body
          supplies only the closing inset, so no nested card or duplicate padding is introduced. */}
      <Card title="Financial Summary" body="table">
        <Suspense fallback={<ChartFallback />}>
          <FinancialSummaryTable />
        </Suspense>
      </Card>
      {/* Casino P&L per provider, and the bonus spend against GGR (from the period's KPIs). */}
      <CasinoProvidersCard />
      <BonusAnalysisSection ggr={kpis?.ggr} />
    </div>
  );

  const agentsTabContent = (
    <div
      className={styles.stack}
      role="tabpanel"
      id={panelId('agents')}
      aria-labelledby={tabButtonId('agents')}
    >
      <AgentsTab />
    </div>
  );

  const timeTabContent = (
    <div
      className={styles.stack}
      role="tabpanel"
      id={panelId('time')}
      aria-labelledby={tabButtonId('time')}
    >
      <TimeTab />
    </div>
  );

  const pageTitle = isSuperAdmin && directorMode === 'core'
    ? 'Core Data Management'
    : isSuperAdmin && directorMode === 'whitelabel' && selectedWhitelabelId
      ? `Whitelabel — ${whitelabels.find(w => w.id === selectedWhitelabelId)?.name || 'Selected'}`
      : isDirector && directorMode === 'core'
        ? 'Core Data Management'
        : isDirector && directorMode === 'whitelabel' && selectedWhitelabelId
          ? `Whitelabel — ${whitelabels.find(w => w.id === selectedWhitelabelId)?.name || 'Selected'}`
          : 'Executive Dashboard';

  const refreshBusy = refreshing || loading;

  return (
    <div className={clsx(dash.page, styles.pageRoot)}>
      {/* The kit's page head (.ph): the charcoal bar every admin page opens with. Its actions are the
          applied range on a button that opens every preset and a custom range (PeriodPanel wires it
          to the store), the four-preset shortcut, and Refresh. All of them write the same store, so
          the three controls can never disagree about the period in force; the seg reads the applied
          preset, so This Month, Last Month or a custom range leaves all four segments unpressed. */}
      <PageHeader
        eyebrow={pageEyebrow}
        title={pageTitle}
        sub="Real-time analytics & operational insights"
        actions={
          <div className={styles.headActions}>
            <Popover
              label="Period"
              trigger={
                <Button
                  className={styles.rangeButton}
                  icon={<IconCalendar size={16} stroke={1.75} />}
                  aria-label={`Period: ${rangeText}`}
                >
                  <span className={styles.rangeText}>{rangeText}</span>
                </Button>
              }
            >
              {({ close }) => (
                <div className={styles.periodPopoverBody}>
                  <PeriodPanel onDone={close} />
                </div>
              )}
            </Popover>
            {/* On a phone the period control takes the row and divides it between its four
                segments (the kit's stretch="phone"). */}
            <SegmentedControl
              className={styles.periodSeg}
              value={appliedPreset}
              options={PERIOD_OPTIONS}
              onChange={setDateRangePreset}
              label="Period"
              stretch="phone"
            />
            <Button
              onClick={handleRefreshAll}
              loading={refreshBusy}
              icon={<IconRefresh size={16} stroke={1.75} />}
            >
              <span className={styles.refreshLabel}>Refresh</span>
            </Button>
          </div>
        }
      />

      {/* Core Mode Info */}
      {(isSuperAdmin || isDirector) && directorMode === 'core' && (
        <Notice
          icon={<IconInfoCircle size={18} stroke={1.75} />}
          className={styles.noticeBlock}
        >
          <strong>Platform-wide view</strong> — Aggregated across all whitelabels. Switch to Whitelabel mode for tenant-specific metrics.
        </Notice>
      )}

      {error && !data && (
        <Notice
          tone="error"
          icon={<IconAlertCircle size={18} stroke={1.75} />}
          title="Failed to Load"
          className={styles.noticeBlock}
          live="polite"
        >
          {error.message}
        </Notice>
      )}

      {/* Pill Tabs */}
      {visibleTabOptions.length > 0 && (
        <div className={styles.tabs}>
          <Tabs
            size="sm"
            value={activeTab}
            items={visibleTabOptions}
            onChange={setActiveTab}
            label="Dashboard tabs"
            idPrefix={TABS_ID_PREFIX}
          />
        </div>
      )}

      {/* Tab Content */}
      {visibleTabs.includes('overview') && activeTab === 'overview' && overviewTabContent}
      {visibleTabs.includes('players') && activeTab === 'players' && playersTabContent}
      {visibleTabs.includes('financial') && activeTab === 'financial' && financialTabContent}
      {visibleTabs.includes('agents') && activeTab === 'agents' && agentsTabContent}
      {visibleTabs.includes('time') && activeTab === 'time' && timeTabContent}
    </div>
  );
}
