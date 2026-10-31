import type { MatkaKpis, MatkaDashboard, MatkaPlayerEvent } from './liveUiModel'
import { isGoodMatkaSnapshot } from './liveUiModel'
import { useMemo, useState, useEffect, useRef } from "react";
import { LoadingState } from '@/ui/components/LoadingState';
import { EmptyState } from '@/ui/components/EmptyState';
import { Card } from '@/ui/components/Card';
import { Notice } from '@/ui/components/Notice';
import { Button } from '@/ui/components/Button';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import styles from '@/routes/live-analysis/LiveWorkspace.module.css';
import { useSubscription } from "@apollo/client";
import {
  SUB_MATKA_LIVE_DASHBOARD,
  SUB_MATKA_PLAYER_EVENTS,
} from "@/lib/graphql/matkaLive";
import { useCurrentWhitelabel } from "@/shared/core/useWhitelabels";
import { useAuthStore } from "@/shared/core/authStore";
import { HeaderControls } from "./components/HeaderControls";
import { HeaderStatsSection } from "./components/HeaderStatsSection";
import { NavigationSidebar } from "./components/NavigationSidebar";
import { CompactHeader } from "./components/CompactHeader";
import { LiveActivitySection } from "./components/LiveActivitySection";
import { OverviewTab } from "./tabs/overview/OverviewTab";
import { AnalyticsTab } from "./tabs/analytics/AnalyticsTab";
import { PerformanceTab } from "./tabs/performance/PerformanceTab";
import { HeatmapTab } from "./tabs/heatmap/HeatmapTab";
import { BetListTab } from "./tabs/bet-list/BetListTab";
import { ComparisonTab } from "./tabs/comparison/ComparisonTab";
import { PlayersTab } from "./tabs/players/PlayersTab";
import { TestingTab } from "./tabs/testing/TestingTab";
import { RBACGuard } from "@/shared/core/RBACGuard";

type MatkaLiveKpiSnapshot = MatkaKpis
type MatkaLiveDashboardSnapshot = MatkaDashboard

/** Document with vendor-prefixed fullscreen APIs */
type DocumentWithFullscreen = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
};

export default function LiveAnalysisPage() {
  return (
    <RBACGuard required={[{ domain: 'matka.live-analysis', actions: ['view'] }]} bypassForAgents>
      <MatkaLiveAnalysisPageContent />
    </RBACGuard>
  );
}

function MatkaLiveAnalysisPageContent() {
  const { whitelabel } = useCurrentWhitelabel();
  const agent = useAuthStore(s => s.agent);

  const [activeTab, setActiveTab] = useState("overview");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // No windowMins needed for open bets - we filter by status, not date

  const [compactMode, setCompactMode] = useState(false);
  const [dataHistory, setDataHistory] = useState<MatkaLiveKpiSnapshot[]>([]);
  const [stableDashboard, setStableDashboard] = useState<MatkaLiveDashboardSnapshot | null>(null);
  const [hasDashData, setHasDashData] = useState(false);
  const [didAnimate, setDidAnimate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const lastAppliedAtRef = useRef<number>(0);
  const [cubeRotation, setCubeRotation] = useState(0);
  const [isLiveActivityCollapsed, setIsLiveActivityCollapsed] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(140);
  const headerRef = useRef<HTMLDivElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);

  // Use whitelabel ID for both tenant and whitelabelId to ensure consistent filtering
  // based on the selected whitelabel in admin panel top bar
  const scope = useMemo(
    () => ({
      tenant: whitelabel?.id || "default",
      whitelabelId: whitelabel?.id || "default",
      agentId: agent?.id || undefined,
      // No windowMins needed - backend filters by status (pending/active) for open bets
    }),
    [whitelabel?.id, agent?.id]
  );

  const scopeKey = JSON.stringify(scope)
  const [snapshotScope, setSnapshotScope] = useState(scopeKey)
  const { data: dashData, loading: dashLoading, error: dashError, variables: dashboardVariables, restart: restartDashboard } = useSubscription<{ matkaLiveDashboard: MatkaDashboard | null }, { scope: typeof scope }>(
    SUB_MATKA_LIVE_DASHBOARD,
    { variables: { scope }, shouldResubscribe: true, skip: !autoRefresh }
  );
  const { data: eventData, error: eventError, variables: eventVariables, restart: restartEvents } = useSubscription<{ matkaPlayerEvents: MatkaPlayerEvent }, { scope: typeof scope }>(
    SUB_MATKA_PLAYER_EVENTS,
    { variables: { scope }, shouldResubscribe: true, skip: !autoRefresh }
  );
  
  // Timeout for loading state
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  useEffect(() => {
    if (dashLoading && !hasDashData) {
      const timer = setTimeout(() => {
        setLoadingTimeout(true);
      }, 10000); // 10 seconds timeout
      return () => clearTimeout(timer);
    } else {
      setLoadingTimeout(false);
    }
  }, [dashLoading, hasDashData]);
  
  useEffect(() => {
    if (eventError) {
      // Error surfaced by UI / subscription; no-op here
    }
    if (dashError) {
      // Error surfaced by UI / subscription; no-op here
    }
  }, [eventError, dashError]);

  const lastSnapshotRef = useRef<{ timestamp: string; dataHash: string } | null>(null);
  const lastKpiHashRef = useRef<string>('')
  useEffect(() => {
    setStableDashboard(null); setHasDashData(false); setDataHistory([]); setDidAnimate(false); setIsUpdating(false); setSnapshotScope(scopeKey)
    lastAppliedAtRef.current = 0; lastSnapshotRef.current = null; lastKpiHashRef.current = ''
  }, [scopeKey])
  useEffect(() => {
    if (!autoRefresh || (dashboardVariables?.scope && JSON.stringify(dashboardVariables.scope) !== scopeKey)) return
    const next = dashData?.matkaLiveDashboard;
    if (!isGoodMatkaSnapshot(next)) return;
    const snapshotTimestamp = next.kpis.at;
    const dataHash = JSON.stringify({
      wagered: next.kpis.wagered,
      payouts: next.kpis.payouts,
      ggr: next.kpis.ggr,
      activePlayers: next.kpis.activePlayers,
      betsCount: next.breakdown?.byMarket?.length || 0,
    });
    if (lastSnapshotRef.current && hasDashData) {
      if (
        lastSnapshotRef.current.timestamp === snapshotTimestamp &&
        lastSnapshotRef.current.dataHash === dataHash
      ) {
        return;
      }
    }
    if (!hasDashData) {
      setStableDashboard(next);
      setSnapshotScope(scopeKey);
      setHasDashData(true);
      lastSnapshotRef.current = { timestamp: snapshotTimestamp, dataHash };
      lastAppliedAtRef.current = Date.now();
      return;
    }
    const now = Date.now();
    const minGap = 1000;
    if (now - lastAppliedAtRef.current < minGap) return;
    lastAppliedAtRef.current = now;
    lastSnapshotRef.current = { timestamp: snapshotTimestamp, dataHash };
    setIsUpdating(true);
    setCubeRotation((prev) => prev + 90);
    setStableDashboard(next);
    setSnapshotScope(scopeKey);
    if (!hasDashData) setHasDashData(true);
    setTimeout(() => setIsUpdating(false), 150);
  }, [dashData, hasDashData, autoRefresh, dashboardVariables?.scope, scopeKey]);

  useEffect(() => {
    if (hasDashData && !didAnimate) setDidAnimate(true);
  }, [hasDashData, didAnimate]);

  const dashboard = snapshotScope === scopeKey ? stableDashboard : null;
  const playerEvent = useMemo(() => {
    if (!autoRefresh || (eventVariables?.scope && JSON.stringify(eventVariables.scope) !== scopeKey)) return undefined;
    return eventData?.matkaPlayerEvents;
  }, [autoRefresh, eventData?.matkaPlayerEvents, eventVariables?.scope, scopeKey]);

  useEffect(() => {
    const kpis = dashboard?.kpis
    if (kpis) {
      const kpiHash = JSON.stringify({
        wagered: kpis.wagered,
        payouts: kpis.payouts,
        activePlayers: kpis.activePlayers,
        betsPerMin: kpis.betsPerMin,
      });
      if (kpiHash !== lastKpiHashRef.current) {
        lastKpiHashRef.current = kpiHash;
        setDataHistory((prev) => {
          const newHistory = [...prev, { ...kpis, timestamp: Date.now() }];
          return newHistory.slice(-60);
        });
      }
    }
  }, [dashboard]);

  const handleRefresh = () => {
    if (!autoRefresh) { setAutoRefresh(true); return }
    restartDashboard(); restartEvents()
  }

  const trends = useMemo(() => {
    if (dataHistory.length < 2) return null;
    const current = dataHistory[dataHistory.length - 1];
    const previous = dataHistory[dataHistory.length - 2];
    const cW = current.wagered ?? 0;
    const pW = previous.wagered ?? 0;
    const cB = current.betsPerMin ?? 0;
    const pB = previous.betsPerMin ?? 0;
    const cA = current.activePlayers ?? 0;
    const pA = previous.activePlayers ?? 0;
    const wageredTrend = pW !== 0 ? ((cW - pW) / Math.abs(pW)) * 100 : cW > 0 ? 100 : 0;
    const betsTrend = pB !== 0 ? ((cB - pB) / Math.abs(pB)) * 100 : cB > 0 ? 100 : 0;
    const playersTrend = pA !== 0 ? ((cA - pA) / Math.abs(pA)) * 100 : cA > 0 ? 100 : 0;
    return { wageredTrend, betsTrend, playersTrend };
  }, [dataHistory]);

  useEffect(() => {
    const measureHeader = () => {
      if (headerRef.current) {
        const height = headerRef.current.offsetHeight;
        setHeaderHeight(height + 8);
      }
    };
    measureHeader();
    window.addEventListener("resize", measureHeader);
    if (hasDashData) {
      setTimeout(measureHeader, 100);
    }
    return () => {
      window.removeEventListener("resize", measureHeader);
    };
  }, [hasDashData, dashboard]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as DocumentWithFullscreen;
      const fullscreenElement =
        document.fullscreenElement ??
        doc.webkitFullscreenElement ??
        doc.mozFullScreenElement ??
        doc.msFullscreenElement;
      const isFullscreen = fullscreenElement === pageContainerRef.current;
      setCompactMode(isFullscreen);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
  }, []);

  const independentTab = ['players', 'bet-list', 'testing'].includes(activeTab);
  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <OverviewTab
            dashboard={dashboard}
            dataHistory={dataHistory}
            didAnimate={didAnimate}
          />
        );
      case "analytics":
        return <AnalyticsTab dashboard={dashboard} didAnimate={didAnimate} />;
      case "performance":
        return (
          <PerformanceTab dashboard={dashboard} headerHeight={headerHeight} didAnimate={didAnimate} />
        );
      case "heatmap":
        return <HeatmapTab dashboard={dashboard} didAnimate={didAnimate} />;
      case "bet-list":
        return <BetListTab didAnimate={didAnimate} />;
      case "comparison":
        return <ComparisonTab dashboard={dashboard} dataHistory={dataHistory} didAnimate={didAnimate} />;
      case "players":
        return <PlayersTab didAnimate={didAnimate} />;
      case "testing":
        return <TestingTab didAnimate={didAnimate} />;
      default:
        return null;
    }
  };

  return (
    <div ref={pageContainerRef} className={styles.workspace}>
      <div ref={headerRef} className={styles.header}>
        <HeaderControls
          autoRefresh={autoRefresh}
          setAutoRefresh={setAutoRefresh}
          handleRefresh={handleRefresh}
          compactMode={compactMode}
          setCompactMode={setCompactMode}
          pageContainerRef={pageContainerRef}
        />
        {((hasDashData && dashboard?.kpis) || (dashLoading && !dashboard)) && (
          <HeaderStatsSection
            dashboard={dashboard}
            trends={trends}
            loading={dashLoading && !dashboard}
          />
        )}
        {!autoRefresh && <Notice title="Dashboard and activity streams paused" tone="info" action={<Button size="sm" onClick={() => setAutoRefresh(true)}>Resume streams</Button>}>The last dashboard snapshot stays visible. Individual tab queries and risk-alert subscriptions keep their existing polling; this is not a global pause.</Notice>}
      </div>
      <div className={styles.body}>
          <NavigationSidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            hasDashData={hasDashData && snapshotScope === scopeKey}
            isUpdating={isUpdating}
            cubeRotation={cubeRotation}
          />
        <div className={styles.contentRow}>
          <div className={styles.main}>
            <Card body="flush" className={styles.view}>
              <CompactHeader activeTab={activeTab} />
              <div key={scopeKey} className={styles.panel} role="tabpanel" tabIndex={0}
                id={tabPanelId('matka-live', activeTab)} aria-labelledby={tabId('matka-live', activeTab)}>
                {independentTab ? <>
                  {dashError && !dashboard && <Notice title="Live Matka data unavailable" tone="error" action={<Button size="sm" onClick={handleRefresh}>Retry</Button>}>{dashError.message}</Notice>}
                  {renderTabContent()}
                </> : dashError && !dashboard ? <Notice title="Live Matka data unavailable" tone="error" action={<Button size="sm" onClick={handleRefresh}>Retry</Button>}>{dashError.message}</Notice> : !autoRefresh && !dashboard ? <Notice title="Live dashboard paused" tone="info">Resume streams to load this scope.</Notice> : dashLoading && !dashboard ? (
                  <div className={styles.feedback}>
                    <LoadingState label={loadingTimeout
                        ? "Taking longer than expected... Please check backend logs or try refreshing."
                        : "Loading live Matka intelligence..."
                      } />
                    {dashError && (
                      <Notice tone="error">Error: {dashError.message || 'Subscription error'}</Notice>
                    )}
                  </div>
                ) : !dashboard ? <EmptyState title="Waiting for live Matka statistics" /> : (
                  renderTabContent()
                )}
              </div>
            </Card>
          </div>
          <LiveActivitySection
            key={scopeKey}
            isLiveActivityCollapsed={isLiveActivityCollapsed}
            setIsLiveActivityCollapsed={setIsLiveActivityCollapsed}
            playerEvent={playerEvent}
          />
        </div>
      </div>
    </div>
  );
}

