import type { SportsLiveDashboard, SportsLiveKpis } from '../../sportsLiveModel';
import { Card } from '@/ui/components/Card';
import { Stat } from '@/ui/components/Stat';
import { Notice } from '@/ui/components/Notice';
import styles from '../../SportsLive.module.css';
import React from "react";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { DistributionChart } from "../../components/charts/DistributionChart";
import { GaugeChart } from "../../components/charts/GaugeChart";

interface PerformanceTabProps {
  dashboard: SportsLiveDashboard | null;
  headerHeight: number;
  didAnimate: boolean;
}

export const PerformanceTab: React.FC<PerformanceTabProps> = ({
  dashboard,
  headerHeight,
  didAnimate,
}) => {
  void didAnimate;
  void headerHeight;
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();

  const kpis: Partial<SportsLiveKpis> = dashboard?.kpis || {};
  const netExposure = kpis.netExposure || 0;
  const totalLiability = kpis.totalLiability || 0;
  const totalStake = kpis.totalStake || 0;
  const avgOdds = kpis.avgOdds || 0;

  // Risk indicators
  const exposureRatio = totalStake > 0 ? (netExposure / totalStake) * 100 : 0;
  const liabilityRatio = totalStake > 0 ? (totalLiability / totalStake) * 100 : 0;

  const getRiskLevel = () => {
    if (Math.abs(netExposure) > totalStake * 0.5) return "high";
    if (Math.abs(netExposure) > totalStake * 0.25) return "medium";
    return "low";
  };

  const riskLevel = getRiskLevel();

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  const backBets = kpis.backBets || 0;
  const layBets = kpis.layBets || 0;
  const totalBets = backBets + layBets;
  return <div className={styles.stack}>
    <Notice tone={riskLevel === 'high' ? 'error' : riskLevel === 'medium' ? 'warn' : 'ok'}
      title={riskLevel === 'high' ? 'High Risk Exposure Detected' : riskLevel === 'medium' ? 'Moderate Risk Exposure' : 'Low Risk Exposure'}>
      {riskLevel === 'high' ? `Net exposure (${money(netExposure)}) exceeds 50% of total stake. Consider taking action to balance exposure.` : riskLevel === 'medium' ? `Net exposure (${money(netExposure)}) is between 25-50% of total stake. Monitor closely.` : 'Current exposure levels are within acceptable range.'}
    </Notice>
    <Card title="Key Performance Metrics"><div className={styles.metrics}>
      <Stat variant="bare" label="Exposure Ratio" value={`${exposureRatio.toFixed(2)}%`} hue={Math.abs(exposureRatio) > 50 ? 'red' : Math.abs(exposureRatio) > 25 ? 'amb' : 'grn'} />
      <Stat variant="bare" label="Liability Ratio" value={`${liabilityRatio.toFixed(2)}%`} hue={liabilityRatio > 100 ? 'red' : 'blu'} />
      <Stat variant="bare" label="Average Odds" value={avgOdds.toFixed(2)} hue="ind" />
      <Stat variant="bare" label="Bets per Minute" value={kpis.betsPerMin?.toFixed(1) || '0.0'} hue="vio" />
    </div></Card>
    <Card title="Back vs Lay Distribution">{totalBets > 0 ? <div className={styles.split}>
      <DistributionChart data={[{ name: 'Back', value: backBets }, { name: 'Lay', value: layBets }]} height={250} type="donut" colors={['var(--blu-ink)', 'var(--red-ink)']} />
      <div className={styles.metrics}><Stat variant="bare" label="Back Bets" value={backBets} hue="blu" /><Stat variant="bare" label="Lay Bets" value={layBets} hue="red" /></div>
    </div> : <p className={styles.muted}>No bet data available</p>}</Card>
    <Card title="Market Activity"><div className={styles.metrics}>
      <Stat variant="bare" label="Active Markets" value={kpis.activeMarkets || 0} hue="grn" />
      <Stat variant="bare" label="Active Players" value={kpis.activePlayers || 0} hue="blu" />
      <Stat variant="bare" label="Avg Bets per Market" value={(kpis.activeMarkets || 0) > 0 ? (totalBets / (kpis.activeMarkets || 1)).toFixed(1) : 0} note="bets" />
      <Stat variant="bare" label="Avg Bets per Player" value={(kpis.activePlayers || 0) > 0 ? (totalBets / (kpis.activePlayers || 1)).toFixed(1) : 0} note="bets" />
    </div></Card>
    <Card title="Exposure Analysis"><div className={styles.metrics}>
      <Stat variant="bare" label="Gross Exposure" value={money(kpis.grossExposure || 0)} hue={(kpis.grossExposure || 0) > 0 ? 'red' : 'blu'} />
      <Stat variant="bare" label="Net Exposure" value={money(netExposure)} hue={netExposure >= 0 ? 'grn' : 'red'} />
      <Stat variant="bare" label="Total Liability" value={money(totalLiability)} hue="red" />
    </div><GaugeChart value={exposureRatio} max={100} height={250} label="Exposure Ratio" formatValue={(value) => `${value.toFixed(1)}%`} /></Card>
  </div>;
};

