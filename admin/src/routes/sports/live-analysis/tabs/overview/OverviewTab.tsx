import type { SportsLiveDashboard, SportsLiveHistory, SportsLiveRiskAlerts } from '../../sportsLiveModel';
import { Card } from '@/ui/components/Card';
import { Stat } from '@/ui/components/Stat';
import styles from '../../SportsLive.module.css';
import React, { useMemo } from "react";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { SportsRiskAlertsCard } from "../../components/SportsRiskAlertsCard";
import { TimeSeriesChart } from "../../components/charts/TimeSeriesChart";
import { GaugeChart } from "../../components/charts/GaugeChart";
import { SparklineChart } from "../../components/charts/SparklineChart";

interface OverviewTabProps {
  dashboard: SportsLiveDashboard | null;
  dataHistory: SportsLiveHistory[];
  didAnimate: boolean;
  riskAlerts?: SportsLiveRiskAlerts;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  dashboard,
  dataHistory,
  didAnimate,
  riskAlerts,
}) => {
  void didAnimate;
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();

  // Prepare time series data
  const timeSeriesData = useMemo(() => {
    if (!dataHistory || dataHistory.length === 0) return [];
    return dataHistory.slice(-30).map((point, index: number) => ({
      time: index,
      timestamp: point.timestamp || point.at || Date.now(),
      stake: point.totalStake || 0,
      liability: point.totalLiability || 0,
    }));
  }, [dataHistory]);

  // Calculate exposure ratio for gauge
  const exposureRatio = useMemo(() => {
    const totalStake = dashboard?.kpis?.totalStake || 0;
    const netExposure = Math.abs(dashboard?.kpis?.netExposure || 0);
    return totalStake > 0 ? (netExposure / totalStake) * 100 : 0;
  }, [dashboard]);

  // Prepare sparkline data
  const stakeSparkline = useMemo(() => {
    if (!dataHistory || dataHistory.length === 0) return [];
    return dataHistory.slice(-20).map((point, index: number) => ({
      time: index,
      value: point.totalStake || 0,
    }));
  }, [dataHistory]);


  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  return <div className={styles.stack}>
    {timeSeriesData.length > 0 && <Card title="Financial Trends Over Time"><TimeSeriesChart data={timeSeriesData} dataKeys={[{ key: "stake", name: "Total Stake", color: "var(--blu-ink)" }, { key: "liability", name: "Total Liability", color: "var(--red-ink)" }]} height={300} type="area" formatValue={money} xAxisKey="time" /></Card>}
    <div className={styles.metrics}>
      <Stat label="Total Stake" value={money(dashboard?.kpis?.totalStake || 0)} hue="blu" note={stakeSparkline.length > 0 ? <SparklineChart data={stakeSparkline} color="var(--blu-ink)" /> : undefined} />
      <Stat label="Total Liability" value={money(dashboard?.kpis?.totalLiability || 0)} hue="red" />
      <Stat label="Active Markets" value={dashboard?.kpis?.activeMarkets || 0} hue="grn" />
      <Stat label="Active Players" value={dashboard?.kpis?.activePlayers || 0} hue="blu" />
      <Stat label="Bets per Minute" value={dashboard?.kpis?.betsPerMin?.toFixed(1) || "0.0"} hue="amb" />
    </div>
    <div className={styles.split}>
      <Card title="Exposure Ratio"><GaugeChart value={exposureRatio} max={100} height={250} label="Exposure %" formatValue={(value) => `${value.toFixed(1)}%`} /></Card>
      <Card title="Market Summary"><dl className={styles.list}>{[["Active Markets", dashboard?.kpis?.activeMarkets || 0], ["Active Players", dashboard?.kpis?.activePlayers || 0], ["Bets per Minute", dashboard?.kpis?.betsPerMin?.toFixed(1) || "0.0"], ["Avg Odds", dashboard?.kpis?.avgOdds?.toFixed(2) || "0.00"]].map(([label, value]) => <div className={styles.item} key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></Card>
    </div>
    <SportsRiskAlertsCard data={riskAlerts} />
    {dashboard?.breakdown && <div className={styles.triple}>
      <Card title="Top Sports"><div className={styles.list}>{dashboard.breakdown.bySport?.slice(0, 5).map((sport) => <div key={sport.sportId} className={styles.item}><span>{sport.sportName || 'Unknown'}</span><strong>{sport.bets || 0} bets</strong></div>)}</div></Card>
      <Card title="Top Leagues"><div className={styles.list}>{dashboard.breakdown.byLeague?.slice(0, 5).map((league) => <div key={league.leagueId} className={styles.item}><span>{league.leagueName || 'Unknown'}</span><strong>{league.bets || 0} bets</strong></div>)}</div></Card>
      <Card title="Bet Sides"><div className={styles.list}>{dashboard.breakdown.byBetSide?.map((side) => <div key={side.side} className={styles.item}><span>{side.side}</span><strong>{side.bets || 0} bets</strong></div>)}</div></Card>
    </div>}
  </div>;
};

