import { useMemo, useState, useEffect, useRef } from "react";
import { useSubscription } from "@apollo/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingState } from '@/ui/components/LoadingState';
import { Card } from '@/ui/components/Card';
import { Notice } from '@/ui/components/Notice';
import { Button } from '@/ui/components/Button';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import styles from '@/routes/live-analysis/LiveWorkspace.module.css';
import { EmptyState } from '@/ui/components/EmptyState';
import {
  SUB_SPORTS_LIVE_DASHBOARD,
  SUB_SPORTS_PLAYER_EVENTS,
  SUB_SPORTS_RISK_ALERTS,
} from "@/lib/graphql/sportsLive";
import { useCurrentWhitelabel } from "@/shared/core/useWhitelabels";
import { HeaderControls } from "./components/HeaderControls";
import { HeaderStatsSection } from "./components/HeaderStatsSection";
import { NavigationSidebar } from "./components/NavigationSidebar";
import { CompactHeader } from "./components/CompactHeader";
import { EventBetsSidebar } from "../components/EventBetsSidebar";
import { OverviewTab } from "./tabs/overview/OverviewTab";
import { AnalyticsTab } from "./tabs/analytics/AnalyticsTab";
import { PerformanceTab } from "./tabs/performance/PerformanceTab";
import { ExposureTab } from "./tabs/exposure/ExposureTab";
import { BetListTab } from "./tabs/bet-list/BetListTab";
import { ComparisonTab } from "./tabs/comparison/ComparisonTab";
import { PlayersTab } from "./tabs/players/PlayersTab";
import { MarketsTab } from "./tabs/markets/MarketsTab";
import { RunningEventsTab } from "./tabs/running-events/RunningEventsTab";
import { RBACGuard } from "@/shared/core/RBACGuard";
import type { SportsLiveDashboard, SportsLiveHistory, SportsLiveRiskAlerts } from './sportsLiveModel';

export default function LiveAnalysisPage() {
  return (
    <RBACGuard required={[{ domain: 'sports.live-analysis', actions: ['view'] }]}>
      <SportsLiveAnalysisPageContent />
    </RBACGuard>
  );
}

function SportsLiveAnalysisPageContent() {
  const { whitelabel } = useCurrentWhitelabel();

  const [activeTab, setActiveTab] = useState("running-events");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [compactMode, setCompactMode] = useState(false);
  const [dataHistory, setDataHistory] = useState<SportsLiveHistory[]>([]);
  const [stableDashboard, setStableDashboard] = useState<SportsLiveDashboard | null>(null);
  const [stableRiskAlerts, setStableRiskAlerts] = useState<SportsLiveRiskAlerts | undefined>();
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
    }),
    [whitelabel?.id]
  );
  const scopeKey = JSON.stringify(scope);
  const [snapshotScope, setSnapshotScope] = useState(scopeKey);

  const { data: dashData, loading: dashLoading, error: dashError, variables: dashboardVariables, restart: restartDashboard } = useSubscription<{ sportsLiveDashboard: SportsLiveDashboard }, { scope: typeof scope }>(
    SUB_SPORTS_LIVE_DASHBOARD,
    {
      variables: { scope },
      shouldResubscribe: true,
      skip: !autoRefresh,
    }
  );

  const { restart: restartEvents } = useSubscription(SUB_SPORTS_PLAYER_EVENTS, {
    variables: { scope },
    shouldResubscribe: true,
    skip: !autoRefresh,
  });

  const { data: riskData, variables: riskVariables, restart: restartRiskAlerts } = useSubscription<{ sportsRiskAlerts: SportsLiveRiskAlerts }, { scope: typeof scope }>(SUB_SPORTS_RISK_ALERTS, {
    variables: { scope },
    shouldResubscribe: true,
    skip: !autoRefresh,
  });

  const lastSnapshotRef = useRef<{
    timestamp: string;
    dataHash: string;
  } | null>(null);

  useEffect(() => {
    setStableDashboard(null); setStableRiskAlerts(undefined); setHasDashData(false); setDataHistory([]); setDidAnimate(false); setIsUpdating(false); setSnapshotScope(scopeKey);
    lastAppliedAtRef.current = 0; lastSnapshotRef.current = null;
  }, [scopeKey]);
  useEffect(() => {
    if (!autoRefresh || (riskVariables?.scope && JSON.stringify(riskVariables.scope) !== scopeKey)) return;
    if (riskData?.sportsRiskAlerts) setStableRiskAlerts(riskData.sportsRiskAlerts);
  }, [autoRefresh, riskData?.sportsRiskAlerts, riskVariables?.scope, scopeKey]);

  useEffect(() => {
    if (!autoRefresh || (dashboardVariables?.scope && JSON.stringify(dashboardVariables.scope) !== scopeKey)) return;
    const next = dashData?.sportsLiveDashboard;
    if (!next || !isGoodSportsSnapshot(next)) return;

    const snapshotTimestamp = next.kpis.at;
    const dataHash = JSON.stringify({
      totalStake: next.kpis.totalStake,
      totalLiability: next.kpis.totalLiability,
      netExposure: next.kpis.netExposure,
      activePlayers: next.kpis.activePlayers,
      activeMarkets: next.kpis.activeMarkets,
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
    
    if (now - lastAppliedAtRef.current < minGap) {
      return;
    }
    
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
    if (hasDashData && !didAnimate) {
      setDidAnimate(true);
    }
  }, [hasDashData, didAnimate]);

  const dashboard = snapshotScope === scopeKey ? stableDashboard : null;

  useEffect(() => {
    if (dashboard?.kpis) {
      setDataHistory((prev) => {
        const newHistory = [
          ...prev,
          { ...dashboard.kpis, timestamp: Date.now() },
        ];
        return newHistory.slice(-60);
      });
    }
  }, [dashboard]);

  const handleRefresh = () => {
    // Apollo cannot restart a skipped subscription: resume first to create fresh streams.
    if (!autoRefresh) { setAutoRefresh(true); return; }
    restartDashboard(); restartEvents(); restartRiskAlerts();
  };

  const trends = useMemo(() => {
    if (dataHistory.length < 2) return null;
    const current = dataHistory[dataHistory.length - 1];
    const previous = dataHistory[dataHistory.length - 2];
    return {
      stakeTrend:
        ((current.totalStake - previous.totalStake) / Math.abs(previous.totalStake || 1)) * 100,
      exposureTrend:
        ((current.netExposure - previous.netExposure) / Math.abs(previous.netExposure || 1)) * 100,
      playersTrend:
        ((current.activePlayers - previous.activePlayers) / Math.abs(previous.activePlayers || 1)) * 100,
    };
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
      const legacyDocument = document as Document & { webkitFullscreenElement?: Element; mozFullScreenElement?: Element; msFullscreenElement?: Element };
      const fullscreenElement =
        document.fullscreenElement ||
        legacyDocument.webkitFullscreenElement ||
        legacyDocument.mozFullScreenElement ||
        legacyDocument.msFullscreenElement;

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

  const independentTab = ['running-events', 'players', 'markets', 'bet-list'].includes(activeTab);
  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <OverviewTab
            dashboard={dashboard}
            dataHistory={dataHistory}
            didAnimate={didAnimate}
            riskAlerts={snapshotScope === scopeKey ? stableRiskAlerts : undefined}
          />
        );
      case "analytics":
        return (
          <AnalyticsTab
            dashboard={dashboard}
            didAnimate={didAnimate}
            dataHistory={dataHistory}
          />
        );
      case "performance":
        return (
          <PerformanceTab
            dashboard={dashboard}
            headerHeight={headerHeight}
            didAnimate={didAnimate}
          />
        );
      case "exposure":
        return (
          <ExposureTab
            dashboard={dashboard}
            didAnimate={didAnimate}
            dataHistory={dataHistory}
          />
        );
      case "bet-list":
        return (
          <BetListTab didAnimate={didAnimate} />
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
          <PlayersTab dashboard={dashboard} didAnimate={didAnimate} />
        );
      case "markets":
        return (
          <MarketsTab dashboard={dashboard} didAnimate={didAnimate} />
        );
      case "running-events":
        return (
          <RunningEventsTab didAnimate={didAnimate} />
        );
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
        {!autoRefresh && <div className={styles.headerControls}><Notice title="Sports live streams paused" tone="info" action={<Button size="sm" onClick={() => setAutoRefresh(true)}>Resume streams</Button>}>The last dashboard snapshot stays visible. Individual tab queries and the bets sidebar keep their existing requests and polling; this is not a global pause.</Notice></div>}
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
                id={tabPanelId('sports-live', activeTab)} aria-labelledby={tabId('sports-live', activeTab)}>
                <ErrorBoundary>
                {independentTab ? <>
                  {dashError && !dashboard && <Notice title="Live Sports data unavailable" tone="error" action={<Button size="sm" onClick={handleRefresh}>Retry</Button>}>{dashError.message}</Notice>}
                  {!autoRefresh && !dashboard && <Notice title="Live Sports dashboard paused" tone="info">Resume streams to load statistics.</Notice>}
                  {renderTabContent()}
                </> : dashError && !dashboard ? <Notice title="Live Sports data unavailable" tone="error" action={<Button size="sm" onClick={handleRefresh}>Retry</Button>}>{dashError.message}</Notice> : !autoRefresh && !dashboard ? <Notice title="Live Sports dashboard paused" tone="info">Resume streams to load this scope.</Notice> : dashLoading && !dashboard ? (
                    <LoadingState
                      label="Loading live intelligence data..."
                    />
                  ) : !dashboard && !dashLoading ? (
                    <EmptyState title="No dashboard data available. Please check your connection." />
                ) : (
                  renderTabContent()
                )}
                </ErrorBoundary>
              </div>
            </Card>
          </div>

          <EventBetsSidebar
            key={scopeKey}
            eventId={null}
            isCollapsed={isLiveActivityCollapsed}
            setIsCollapsed={setIsLiveActivityCollapsed}
            showSportsHierarchy={true}
          />
        </div>
      </div>
    </div>
  );
}

function isGoodSportsSnapshot(snap: SportsLiveDashboard) {
  if (!snap || !snap.kpis) return false;
  const k = snap.kpis;
  return [k.betsPerMin, k.totalStake, k.totalLiability, k.netExposure, k.grossExposure, k.activePlayers, k.activeMarkets].every(n => typeof n === 'number' && Number.isFinite(n));
}

