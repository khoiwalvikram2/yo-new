import type { SportsLiveDashboard, SportsLiveHistory, SportsBreakdownRow } from '../../sportsLiveModel';
import { Card } from '@/ui/components/Card';
import { StatusPill } from '@/ui/components/StatusPill';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { useLiveTable } from '../../sportsLiveModel';
import styles from '../../SportsLive.module.css';
import React, { useMemo } from "react";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { BarChartComponent } from "../../components/charts/BarChartComponent";

interface ComparisonTabProps {
  dashboard: SportsLiveDashboard | null;
  dataHistory: SportsLiveHistory[];
  didAnimate: boolean;
}

export const ComparisonTab: React.FC<ComparisonTabProps> = ({
  dashboard,
  dataHistory,
  didAnimate,
}) => {
  void dataHistory;
  void didAnimate;
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();

  // Sport comparison
  const sportComparison = useMemo(() => {
    const sports = dashboard?.breakdown?.bySport || [];
    return sports.map((sport) => ({
      ...sport,
      avgStakePerBet:
        sport.bets > 0 ? sport.totalStake / sport.bets : 0,
      avgLiabilityPerBet:
        sport.bets > 0 ? sport.totalLiability / sport.bets : 0,
    }));
  }, [dashboard]);

  // League comparison
  const leagueComparison = useMemo(() => {
    const leagues = dashboard?.breakdown?.byLeague || [];
    return leagues.map((league) => ({
      ...league,
      avgStakePerBet:
        league.bets > 0 ? league.totalStake / league.bets : 0,
      avgLiabilityPerBet:
        league.bets > 0 ? league.totalLiability / league.bets : 0,
    }));
  }, [dashboard]);

  // Market type comparison
  const marketTypeComparison = useMemo(() => {
    const marketTypes = dashboard?.breakdown?.byMarketType || [];
    return marketTypes.map((mt) => ({
      ...mt,
      avgStakePerBet: mt.bets > 0 ? mt.totalStake / mt.bets : 0,
      avgLiabilityPerBet: mt.bets > 0 ? mt.totalLiability / mt.bets : 0,
    }));
  }, [dashboard]);

  // Prepare chart data
  const sportChartData = useMemo(() => {
    return sportComparison.slice(0, 10).map((sport) => ({
      name: sport.sportName || "Unknown",
      stake: sport.totalStake || 0,
      liability: sport.totalLiability || 0,
      exposure: sport.netExposure || 0,
      avgStake: sport.avgStakePerBet || 0,
    }));
  }, [sportComparison]);

  const leagueChartData = useMemo(() => {
    return leagueComparison.slice(0, 10).map((league) => ({
      name: league.leagueName || "Unknown",
      stake: league.totalStake || 0,
      exposure: league.netExposure || 0,
      avgStake: league.avgStakePerBet || 0,
    }));
  }, [leagueComparison]);

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  type ComparisonRow = SportsBreakdownRow & { avgStakePerBet: number; avgLiabilityPerBet: number };
  const financialColumns: DataTableColumn<ComparisonRow>[] = [
    { key: 'bets', header: 'Bets', align: 'right', sort: (a, b) => a.bets - b.bets, cell: row => row.bets },
    { key: 'totalStake', header: 'Total Stake', align: 'right', sort: (a, b) => a.totalStake - b.totalStake, cell: row => money(row.totalStake || 0) },
    { key: 'avgStakePerBet', header: 'Avg Stake/Bet', align: 'right', sort: (a, b) => a.avgStakePerBet - b.avgStakePerBet, cell: row => money(row.avgStakePerBet || 0) },
    { key: 'totalLiability', header: 'Total Liability', align: 'right', sort: (a, b) => a.totalLiability - b.totalLiability, cell: row => money(row.totalLiability || 0) },
    { key: 'netExposure', header: 'Net Exposure', align: 'right', sort: (a, b) => a.netExposure - b.netExposure, cell: row => <span className={(row.netExposure || 0) >= 0 ? styles.positive : styles.negative}>{money(row.netExposure || 0)}</span> },
  ];
  const sportTableColumns: DataTableColumn<ComparisonRow>[] = [{ key: 'sportName', header: 'Sport', width: 150, cell: row => row.sportName }, ...financialColumns];
  const leagueTableColumns: DataTableColumn<ComparisonRow>[] = [{ key: 'leagueName', header: 'League', width: 200, cell: row => row.leagueName }, ...financialColumns.filter(column => column.key !== 'totalLiability')];
  const marketTableColumns: DataTableColumn<ComparisonRow>[] = [{ key: 'marketType', header: 'Market Type', cell: row => <StatusPill tone={row.marketType === 'exchange' ? 'info' : row.marketType === 'bookmaker' ? 'ok' : 'warn'}>{row.marketType?.toUpperCase() || 'UNKNOWN'}</StatusPill> }, ...financialColumns];
  const sportTable = useLiveTable(sportComparison, sportTableColumns, 10);
  const leagueTable = useLiveTable(leagueComparison, leagueTableColumns, 10);
  const marketTable = useLiveTable(marketTypeComparison, marketTableColumns, 10);
  return <div className={styles.stack}>
    <Card title="Sport Comparison"><div className={styles.stack}><BarChartComponent data={sportChartData} dataKeys={[{ key: 'stake', name: 'Total Stake', color: 'var(--blu-ink)' }, { key: 'liability', name: 'Total Liability', color: 'var(--red-ink)' }]} xAxisKey="name" height={300} formatValue={money} /><DataTable columns={sportTableColumns} {...sportTable} rowKey={(row) => String(row.sportId)} label="Sport Comparison" /></div></Card>
    <Card title="League Comparison"><div className={styles.stack}><BarChartComponent data={leagueChartData} dataKeys={[{ key: 'stake', name: 'Total Stake', color: 'var(--blu-ink)' }, { key: 'exposure', name: 'Net Exposure', color: 'var(--grn-ink)' }]} xAxisKey="name" height={300} formatValue={money} /><DataTable columns={leagueTableColumns} {...leagueTable} rowKey={(row) => String(row.leagueId)} label="League Comparison" /></div></Card>
    <Card title="Market Type Comparison" body="table"><DataTable columns={marketTableColumns} {...marketTable} rowKey={(row) => String(row.marketType)} label="Market Type Comparison" /></Card>
  </div>;
};

