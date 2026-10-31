import type { SportsLiveDashboard, SportsLiveHistory, SportsBreakdownRow } from '../../sportsLiveModel';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Notice } from '@/ui/components/Notice';
import { StatusPill } from '@/ui/components/StatusPill';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { useLiveTable } from '../../sportsLiveModel';
import styles from '../../SportsLive.module.css';
import React, { useMemo, useState } from "react";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { TimeSeriesChart } from "../../components/charts/TimeSeriesChart";
import { DistributionChart } from "../../components/charts/DistributionChart";
import { BarChartComponent } from "../../components/charts/BarChartComponent";

interface AnalyticsTabProps {
  dashboard: SportsLiveDashboard | null;
  didAnimate: boolean;
  dataHistory?: SportsLiveHistory[];
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({
  dashboard,
  didAnimate,
  dataHistory = [],
}) => {
  void didAnimate;
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const [viewMode, setViewMode] = useState<"table" | "chart">("chart");

  // Prepare chart data
  const sportChartData = useMemo(() => {
    return (dashboard?.breakdown?.bySport || []).slice(0, 10).map((sport) => ({
      name: sport.sportName || "Unknown",
      value: sport.totalStake || 0,
      bets: sport.bets || 0,
      exposure: sport.netExposure || 0,
    }));
  }, [dashboard]);

  const leagueChartData = useMemo(() => {
    return (dashboard?.breakdown?.byLeague || []).slice(0, 10).map((league) => ({
      name: league.leagueName || "Unknown",
      value: league.netExposure || 0,
      stake: league.totalStake || 0,
    }));
  }, [dashboard]);

  const betSideChartData = useMemo(() => {
    return (dashboard?.breakdown?.byBetSide || []).map((side) => ({
      name: side.side?.toUpperCase() || "UNKNOWN",
      value: side.totalStake || 0,
      bets: side.bets || 0,
    }));
  }, [dashboard]);

  const marketTypeChartData = useMemo(() => {
    return (dashboard?.breakdown?.byMarketType || []).map((mt) => ({
      name: mt.marketType?.toUpperCase() || "UNKNOWN",
      value: mt.totalStake || 0,
      exposure: mt.netExposure || 0,
    }));
  }, [dashboard]);

  // Time series data from history
  const timeSeriesData = useMemo(() => {
    if (!dataHistory || dataHistory.length === 0) return [];
    return dataHistory.slice(-30).map((point, index: number) => ({
      time: index,
      timestamp: point.timestamp || point.at || Date.now(),
      stake: point.totalStake || 0,
      liability: point.totalLiability || 0,
      exposure: point.netExposure || 0,
    }));
  }, [dataHistory]);

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  const financialColumns: DataTableColumn<SportsBreakdownRow>[] = [
    { key: 'bets', header: 'Bets', align: 'right', sort: (a, b) => a.bets - b.bets, cell: row => row.bets },
    { key: 'totalStake', header: 'Total Stake', align: 'right', sort: (a, b) => a.totalStake - b.totalStake, cell: row => money(row.totalStake || 0) },
    { key: 'totalLiability', header: 'Total Liability', align: 'right', sort: (a, b) => a.totalLiability - b.totalLiability, cell: row => money(row.totalLiability || 0) },
    { key: 'netExposure', header: 'Net Exposure', align: 'right', sort: (a, b) => a.netExposure - b.netExposure, cell: row => <span className={(row.netExposure || 0) >= 0 ? styles.positive : styles.negative}>{money(row.netExposure || 0)}</span> },
  ];
  const sportTableColumns: DataTableColumn<SportsBreakdownRow>[] = [{ key: 'sportName', header: 'Sport', cell: row => row.sportName || 'Unknown' }, ...financialColumns];
  const leagueTableColumns: DataTableColumn<SportsBreakdownRow>[] = [{ key: 'leagueName', header: 'League', cell: row => row.leagueName || 'Unknown' }, ...financialColumns.filter(column => column.key !== 'totalLiability')];
  const marketTableColumns: DataTableColumn<SportsBreakdownRow>[] = [{ key: 'marketType', header: 'Market Type', cell: row => <StatusPill tone={row.marketType === 'exchange' ? 'info' : row.marketType === 'bookmaker' ? 'ok' : 'warn'}>{row.marketType?.toUpperCase() || 'UNKNOWN'}</StatusPill> }, ...financialColumns];
  const sportTable = useLiveTable(dashboard?.breakdown?.bySport || [], sportTableColumns, 10);
  const leagueTable = useLiveTable(dashboard?.breakdown?.byLeague || [], leagueTableColumns, 10);
  const marketTable = useLiveTable(dashboard?.breakdown?.byMarketType || [], marketTableColumns, 10);
  const toggle = <Button size="sm" onClick={() => setViewMode(viewMode === 'chart' ? 'table' : 'chart')}>{viewMode === 'chart' ? 'Table view' : 'Chart view'}</Button>;
  return <div className={styles.stack}>
    {timeSeriesData.length > 0 && <Card title="Trends Over Time" tools={toggle}>{viewMode === 'chart' ? <TimeSeriesChart data={timeSeriesData} dataKeys={[{ key: 'stake', name: 'Total Stake', color: 'var(--blu-ink)' }, { key: 'liability', name: 'Total Liability', color: 'var(--red-ink)' }, { key: 'exposure', name: 'Net Exposure', color: 'var(--grn-ink)' }]} height={300} type="area" formatValue={money} xAxisKey="time" /> : <Notice tone="info">Timeline table view is not available.</Notice>}</Card>}
    <Card title="Sports Analytics" tools={toggle}>{viewMode === 'chart' && sportChartData.length > 0 ? <DistributionChart data={sportChartData} height={280} type="pie" formatValue={money} /> : <DataTable columns={sportTableColumns} {...sportTable} rowKey={(row) => String(row.sportId)} label="Sports Analytics" />}</Card>
    <Card title="League Analytics" tools={toggle}>{viewMode === 'chart' && leagueChartData.length > 0 ? <BarChartComponent data={leagueChartData} dataKeys={[{ key: 'value', name: 'Net Exposure', color: 'var(--grn-ink)' }]} xAxisKey="name" height={280} orientation="horizontal" formatValue={money} /> : <DataTable columns={leagueTableColumns} {...leagueTable} rowKey={(row) => String(row.leagueId)} label="League Analytics" />}</Card>
    <Card title="Market Type Analytics" tools={toggle}>{viewMode === 'chart' && marketTypeChartData.length > 0 ? <BarChartComponent data={marketTypeChartData} dataKeys={[{ key: 'value', name: 'Total Stake', color: 'var(--blu-ink)' }]} xAxisKey="name" height={300} formatValue={money} /> : <DataTable columns={marketTableColumns} {...marketTable} rowKey={(row) => String(row.marketType)} label="Market Type Analytics" />}</Card>
    <div className={styles.split}>
      <Card title="Top Events by Stake"><div className={styles.list}>{dashboard?.breakdown?.byEvent?.slice(0, 10).map((event) => <div key={event.eventId} className={styles.item}><span>{event.eventName || 'Unknown'}</span><strong>{money(event.totalStake || 0)}</strong></div>)}</div></Card>
      <Card title="Bet Side Distribution" tools={toggle}>{viewMode === 'chart' && betSideChartData.length > 0 ? <DistributionChart data={betSideChartData} height={280} type="donut" formatValue={money} colors={['var(--blu-ink)', 'var(--red-ink)']} /> : <div className={styles.list}>{dashboard?.breakdown?.byBetSide?.map((side) => <div key={side.side} className={styles.item}><StatusPill tone={side.side === 'back' ? 'info' : 'neg'}>{side.side?.toUpperCase()}</StatusPill><span>{side.bets || 0} bets</span><strong>{money(side.totalStake || 0)}</strong></div>)}</div>}</Card>
    </div>
  </div>;
};

