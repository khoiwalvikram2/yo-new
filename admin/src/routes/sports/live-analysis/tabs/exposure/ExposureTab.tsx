import type { SportsLiveDashboard, SportsLiveHistory } from '../../sportsLiveModel';
import { Card } from '@/ui/components/Card';
import styles from '../../SportsLive.module.css';
import React, { useMemo } from "react";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { BarChartComponent } from "../../components/charts/BarChartComponent";
import { TimeSeriesChart } from "../../components/charts/TimeSeriesChart";

interface ExposureTabProps {
  dashboard: SportsLiveDashboard | null;
  didAnimate: boolean;
  dataHistory?: SportsLiveHistory[];
}

export const ExposureTab: React.FC<ExposureTabProps> = ({
  dashboard,
  didAnimate,
  dataHistory,
}) => {
  void didAnimate;
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();

  // Prepare chart data for sports
  const sportExposureData = useMemo(() => {
    return (dashboard?.breakdown?.bySport || [])
      .slice(0, 10)
      .map((sport) => ({
        name: sport.sportName || "Unknown",
        exposure: sport.netExposure || 0,
        positive: (sport.netExposure || 0) >= 0 ? sport.netExposure || 0 : 0,
        negative: (sport.netExposure || 0) < 0 ? Math.abs(sport.netExposure || 0) : 0,
      }));
  }, [dashboard]);

  // Prepare chart data for leagues
  const leagueExposureData = useMemo(() => {
    return (dashboard?.breakdown?.byLeague || [])
      .slice(0, 10)
      .map((league) => ({
        name: league.leagueName || "Unknown",
        exposure: league.netExposure || 0,
      }));
  }, [dashboard]);

  // Time series data for exposure trends
  const exposureTimeSeries = useMemo(() => {
    if (!dataHistory || dataHistory.length === 0) return [];
    return dataHistory.slice(-30).map((point, index: number) => ({
      time: index,
      exposure: point.netExposure || 0,
    }));
  }, [dataHistory]);

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  return <div className={styles.stack}>
    {exposureTimeSeries.length > 0 && <Card title="Exposure Trend Over Time"><TimeSeriesChart data={exposureTimeSeries} dataKeys={[{ key: 'exposure', name: 'Net Exposure', color: 'var(--grn-ink)' }]} height={300} type="line" formatValue={money} xAxisKey="time" /></Card>}
    <div className={styles.split}>
      <Card title="Net Exposure by Sport">{sportExposureData.length > 0 ? <BarChartComponent data={sportExposureData} dataKeys={[{ key: 'positive', name: 'Positive', color: 'var(--grn-ink)' }, { key: 'negative', name: 'Negative', color: 'var(--red-ink)' }]} xAxisKey="name" height={320} orientation="horizontal" formatValue={money} /> : <div className={styles.list}>{dashboard?.breakdown?.bySport?.slice(0, 10).map((sport) => <div key={sport.sportId} className={styles.item}><span>{sport.sportName || 'Unknown'}</span><strong className={(sport.netExposure || 0) >= 0 ? styles.positive : styles.negative}>{money(sport.netExposure || 0)}</strong></div>)}</div>}</Card>
      <Card title="Net Exposure by League">{leagueExposureData.length > 0 ? <BarChartComponent data={leagueExposureData} dataKeys={[{ key: 'exposure', name: 'Net Exposure', color: 'var(--blu-ink)' }]} xAxisKey="name" height={320} orientation="horizontal" formatValue={money} /> : <div className={styles.list}>{dashboard?.breakdown?.byLeague?.slice(0, 10).map((league) => <div key={league.leagueId} className={styles.item}><span>{league.leagueName || 'Unknown'}</span><strong className={(league.netExposure || 0) >= 0 ? styles.positive : styles.negative}>{money(league.netExposure || 0)}</strong></div>)}</div>}</Card>
    </div>
  </div>;
};

