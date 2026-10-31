import { useMemo, useState, useEffect, useRef } from "react";
import { LoadingState } from '@/ui/components/LoadingState';
import { Card } from '@/ui/components/Card';
import { Notice } from '@/ui/components/Notice';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import styles from '@/routes/live-analysis/LiveWorkspace.module.css';
import { useSubscription } from "@apollo/client";
import {
  SUB_CASINO_LIVE_DASHBOARD,
  SUB_CASINO_PLAYER_EVENTS,
} from "@/lib/graphql/casinoLive";
import { useCurrentWhitelabel } from "@/shared/core/useWhitelabels";
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
import { isGoodCasinoSnapshot, type CasinoDashboard, type CasinoKpis, type CasinoPlayerEvent } from './casinoLiveModel';

export default function LiveAnalysisPage() {
  return (
    <RBACGuard required={[{ domain: 'casino.live-analysis', actions: ['view'] }]} bypassForAgents>
      <CasinoLiveAnalysisPageContent />
    </RBACGuard>
  );
}

function CasinoLiveAnalysisPageContent() {
  const { whitelabel } = useCurrentWhitelabel();

  const [activeTab, setActiveTab] = useState("overview");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Initialize windowMins from localStorage or default to 10
  const [windowMins, setWindowMins] = useState(() => {
    const saved = localStorage.getItem("liveCasinoAnalysis_windowMins");
    if (saved) {
      const parsed = parseInt(saved, 10);
      const validOptions = [10, 15, 30, 60, 120, 180, 360];
      if (validOptions.includes(parsed)) {
        return parsed;
      }
    }
    return 10;
  });

  // Save windowMins to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("liveCasinoAnalysis_windowMins", windowMins.toString());
  }, [windowMins]);

  const [compactMode, setCompactMode] = useState(false);
  const [dataHistory, setDataHistory] = useState<Array<CasinoKpis & { timestamp: number }>>([]);
  const [stableDashboard, setStableDashboard] = useState<CasinoDashboard | null>(null);
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
      windowMins,
    }),
    [windowMins, whitelabel?.id]
  );

  const scopeKey = JSON.stringify(scope);
  const [snapshotScope, setSnapshotScope] = useState(scopeKey);
  const { data: dashData, loading: dashLoading, error: dashError, variables: dashboardVariables, restart: restartDashboard } = useSubscription<{ casinoLiveDashboard: CasinoDashboard | null }, { scope: typeof scope }>(
    SUB_CASINO_LIVE_DASHBOARD,
    {
      variables: { scope },
      // Force re-subscription when scope changes
      shouldResubscribe: true,
      skip: !autoRefresh,
    }
  );

  const { data: eventData, variables: eventVariables, restart: restartEvents } = useSubscription<{ casinoPlayerEvents: CasinoPlayerEvent }, { scope: typeof scope }>(SUB_CASINO_PLAYER_EVENTS, {
    variables: { scope },
    shouldResubscribe: true,
    skip: !autoRefresh,
  });

  // Track last snapshot to prevent duplicate updates
  const lastSnapshotRef = useRef<{
    timestamp: string;
    dataHash: string;
  } | null>(null);

  useEffect(() => {
    setStableDashboard(null); setHasDashData(false); setDataHistory([]); setDidAnimate(false); setIsUpdating(false); setSnapshotScope(scopeKey);
    lastAppliedAtRef.current = 0; lastSnapshotRef.current = null; lastKpiHashRef.current = '';
  }, [scopeKey]);

  useEffect(() => {
    if (!autoRefresh || (dashboardVariables?.scope && JSON.stringify(dashboardVariables.scope) !== scopeKey)) return;
    const next = dashData?.casinoLiveDashboard;
    if (!next || !isGoodCasinoSnapshot(next)) return;

    // Create a simple hash of key data to detect if snapshot actually changed
    const snapshotTimestamp = next.kpis.at;
    const dataHash = JSON.stringify({
      wagered: next.kpis.wagered,
      payouts: next.kpis.payouts,
      ggr: next.kpis.ggr,
      activePlayers: next.kpis.activePlayers,
      betsCount: next.breakdown?.byGame?.length || 0,
    });
    
    // Skip if this is the exact same snapshot (same timestamp AND same data)
    if (lastSnapshotRef.current && hasDashData) {
      if (
        lastSnapshotRef.current.timestamp === snapshotTimestamp &&
        lastSnapshotRef.current.dataHash === dataHash
      ) {
        return; // Exact duplicate, skip
      }
    }

    // First load - set immediately
    if (!hasDashData) {
      setStableDashboard(next);
      setSnapshotScope(scopeKey);
      setHasDashData(true);
      lastSnapshotRef.current = { timestamp: snapshotTimestamp, dataHash };
      lastAppliedAtRef.current = Date.now();
      return;
    }

    // For subsequent updates: ensure minimum gap between updates
    const now = Date.now();
    const minGap = 1000; // 1 second minimum between updates
    
    if (now - lastAppliedAtRef.current < minGap) {
      return; // Too soon, skip this update
    }
    
    lastAppliedAtRef.current = now;
    lastSnapshotRef.current = { timestamp: snapshotTimestamp, dataHash };
    
    setIsUpdating(true);
    setCubeRotation((prev) => prev + 90);
    
    // Update with latest snapshot
    setStableDashboard(next);
    setSnapshotScope(scopeKey);
    if (!hasDashData) setHasDashData(true);
    setTimeout(() => setIsUpdating(false), 150);
  }, [dashData, hasDashData, autoRefresh, dashboardVariables?.scope, scopeKey]);

  useEffect(() => {
    if (hasDashData && !didAnimate) {
      setDidAnimate(true);
    }
  }, [hasDashData, didAnimate]);

  const dashboard = snapshotScope === scopeKey ? stableDashboard : null;
  
  // Extract playerEvent - memoized for stable reference
  const playerEvent = useMemo(() => {
    if (!autoRefresh || (eventVariables?.scope && JSON.stringify(eventVariables.scope) !== scopeKey)) return undefined;
    return eventData?.casinoPlayerEvents;
  }, [autoRefresh, eventData?.casinoPlayerEvents, eventVariables?.scope, scopeKey]);

  // Optimize data history tracking - only update if KPIs actually changed
  const lastKpiHashRef = useRef<string>('');
  useEffect(() => {
    if (dashboard?.kpis) {
      const kpiHash = JSON.stringify({
        wagered: dashboard.kpis.wagered,
        payouts: dashboard.kpis.payouts,
        ggr: dashboard.kpis.ggr,
        activePlayers: dashboard.kpis.activePlayers,
        betsPerMin: dashboard.kpis.betsPerMin,
      });
      
      // Only add to history if data actually changed
      if (kpiHash !== lastKpiHashRef.current) {
        lastKpiHashRef.current = kpiHash;
        setDataHistory((prev) => {
          const newHistory = [
            ...prev,
            { ...dashboard.kpis, timestamp: Date.now() },
          ];
          return newHistory.slice(-60);
        });
      }
    }
  }, [dashboard]);

  const handleRefresh = () => {
    // Apollo forbids restart while skipped. Resume first; this creates fresh streams.
    if (!autoRefresh) { setAutoRefresh(true); return; }
    restartDashboard();
    restartEvents();
  };

  // Memoize trends calculation - only recompute when dataHistory changes
  const trends = useMemo(() => {
    if (dataHistory.length < 2) return null;
    const current = dataHistory[dataHistory.length - 1];
    const previous = dataHistory[dataHistory.length - 2];
    
    // Avoid division by zero and handle edge cases
    const ggrTrend = previous.ggr !== 0 
      ? ((current.ggr - previous.ggr) / Math.abs(previous.ggr)) * 100 
      : (current.ggr > 0 ? 100 : 0);
    const betsTrend = previous.betsPerMin !== 0
      ? ((current.betsPerMin - previous.betsPerMin) / Math.abs(previous.betsPerMin)) * 100
      : (current.betsPerMin > 0 ? 100 : 0);
    const playersTrend = previous.activePlayers !== 0
      ? ((current.activePlayers - previous.activePlayers) / Math.abs(previous.activePlayers)) * 100
      : (current.activePlayers > 0 ? 100 : 0);
    
    return { ggrTrend, betsTrend, playersTrend };
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
      const fullscreenDocument = document as Document & { webkitFullscreenElement?: Element; mozFullScreenElement?: Element; msFullscreenElement?: Element };
      const fullscreenElement =
        document.fullscreenElement ||
        fullscreenDocument.webkitFullscreenElement ||
        fullscreenDocument.mozFullScreenElement ||
        fullscreenDocument.msFullscreenElement;

      const isFullscreen = fullscreenElement === pageContainerRef.current;
      setCompactMode(isFullscreen);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange
      );
      document.removeEventListener(
        "mozfullscreenchange",
        handleFullscreenChange
      );
      document.removeEventListener(
        "MSFullscreenChange",
        handleFullscreenChange
      );
    };
  }, []);

  const independentTab = ['bet-list', 'players', 'testing'].includes(activeTab);
  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <OverviewTab
            dashboard={dashboard}
            dataHistory={dataHistory}
            windowMins={windowMins}
            didAnimate={didAnimate}
          />
        );
      case "analytics":
        return (
          <AnalyticsTab
            dashboard={dashboard}
            windowMins={windowMins}
            didAnimate={didAnimate}
          />
        );
      case "performance":
        return (
          <PerformanceTab
            dashboard={dashboard}
            windowMins={windowMins}
            headerHeight={headerHeight}
            didAnimate={didAnimate}
          />
        );
      case "heatmap":
        return (
          <HeatmapTab
            dashboard={dashboard}
            windowMins={windowMins}
            didAnimate={didAnimate}
          />
        );
      case "bet-list":
        return (
          <BetListTab windowMins={windowMins} didAnimate={didAnimate} />
        );
      case "comparison":
        return (
          <ComparisonTab
            dashboard={dashboard}
            dataHistory={dataHistory}
            didAnimate={didAnimate}
          />
        );
      case "players":
        return (
          <PlayersTab windowMins={windowMins} didAnimate={didAnimate} />
        );
      case "testing":
        return <TestingTab didAnimate={didAnimate} />;
      default:
        return null;
    }
  };

  return (
    <div ref={pageContainerRef} className={styles.workspace}>
      <div
        ref={headerRef}
        className={styles.header}
      >
        <HeaderControls
          windowMins={windowMins}
          setWindowMins={setWindowMins}
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
            windowMins={windowMins}
            trends={trends}
            loading={dashLoading && !dashboard}
          />
        )}
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
              <CompactHeader activeTab={activeTab} windowMins={windowMins} />

              <div key={scopeKey} className={styles.panel} role="tabpanel" tabIndex={0}
                id={tabPanelId('casino-live', activeTab)} aria-labelledby={tabId('casino-live', activeTab)}>
                {independentTab ? <>
                  {dashError && !dashboard && <Notice tone="error" title="Live Casino statistics unavailable" action={<Button size="sm" onClick={handleRefresh}>Retry</Button>}>{dashError.message}</Notice>}
                  {renderTabContent()}
                </> : dashError && !dashboard ? <Notice tone="error" title="Live Casino statistics unavailable" action={<Button size="sm" onClick={handleRefresh}>Retry</Button>}>{dashError.message}</Notice> : !autoRefresh && !dashboard ? <Notice title="Live Casino dashboard paused" tone="info">Resume streams to load statistics for this scope.</Notice> : dashLoading && !dashboard ? (
                  <LoadingState label="Loading live intelligence data..." />
                ) : !dashboard ? <EmptyState title="Waiting for live Casino statistics" /> : (
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
            windowMins={windowMins}
          />
        </div>
      </div>
    </div>
  );
}

