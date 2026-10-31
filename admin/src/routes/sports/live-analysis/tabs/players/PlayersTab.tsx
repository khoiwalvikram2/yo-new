import type { SportsLiveDashboard, SportsAggregateBet, SportsPlayerSummary } from '../../sportsLiveModel';
import { Card } from '@/ui/components/Card';
import { Stat } from '@/ui/components/Stat';
import { StatusPill } from '@/ui/components/StatusPill';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { useLiveTable } from '../../sportsLiveModel';
import styles from '../../SportsLive.module.css';
import React, { useMemo } from "react";
import { useQuery } from "@apollo/client";
import { gql } from "@apollo/client";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { useFormatDate } from "@/shared/core/useFormatDate";

const SPORTS_BETS_QUERY = gql`
  query SportsBets($query: SportsBetsQuery) {
    sportsBets(query: $query) {
      id
      userId
      stake
      liability
      side
      price
      status
      currency
      createdAt
    }
  }
`;

interface PlayersTabProps {
  dashboard: SportsLiveDashboard | null;
  didAnimate: boolean;
}

export const PlayersTab: React.FC<PlayersTabProps> = ({
  dashboard,
  didAnimate,
}) => {
  void didAnimate;
  void dashboard;
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDateTime } = useFormatDate();

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  // This ensures proper filtering based on selected whitelabel in admin panel top bar
  const { data, loading } = useQuery<{ sportsBets: SportsAggregateBet[] }>(SPORTS_BETS_QUERY, {
    variables: {
      query: {
        statuses: ['matched', 'unmatched'],
        limit: 10000,
      },
    },
    pollInterval: 5000,
    // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    fetchPolicy: "network-only",
  });

  // Aggregate player data from bets
  const playerStats = useMemo(() => {
    if (!data?.sportsBets) return [];

    const bets = data.sportsBets.filter(
      (bet) => bet.status === "matched" || bet.status === "unmatched"
    );

    const playerMap = new Map<number, SportsPlayerSummary>();
    bets.forEach((bet) => {
      const userId = bet.userId;
      if (!playerMap.has(userId)) {
        playerMap.set(userId, {
          userId,
          bets: 0,
          totalStake: 0,
          totalLiability: 0,
          backBets: 0,
          layBets: 0,
          avgOdds: 0,
          lastBetAt: bet.createdAt,
        });
      }

      const player = playerMap.get(userId)!;
      player.bets += 1;
      // Total wagered for sports = liability
      player.totalStake += Number(bet.liability ?? bet.stake ?? 0);
      player.totalLiability += Number(bet.liability || 0);
      if (bet.side === "back") {
        player.backBets += 1;
      } else {
        player.layBets += 1;
      }
      player.avgOdds += Number(bet.price || 0);
      if (new Date(bet.createdAt) > new Date(player.lastBetAt)) {
        player.lastBetAt = bet.createdAt;
      }
    });

    // Calculate average odds
    Array.from(playerMap.values()).forEach((player) => {
      player.avgOdds = player.bets > 0 ? player.avgOdds / player.bets : 0;
    });

    return Array.from(playerMap.values()).sort(
      (a, b) => b.totalStake - a.totalStake
    );
  }, [data]);

  const topPlayers = playerStats.slice(0, 10);
  const totalPlayers = playerStats.length;
  const totalPlayerStake = playerStats.reduce(
    (sum, p) => sum + p.totalStake,
    0
  );
  const totalPlayerLiability = playerStats.reduce(
    (sum, p) => sum + p.totalLiability,
    0
  );

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value || 0));
  const tableColumns: DataTableColumn<SportsPlayerSummary>[] = [
    { key: 'userId', header: 'User ID', sort: (a, b) => a.userId - b.userId, cell: row => row.userId },
    { key: 'bets', header: 'Total Bets', align: 'right', sort: (a, b) => a.bets - b.bets, cell: row => row.bets },
    { key: 'backBets', header: 'Back', align: 'right', cell: row => <StatusPill tone="info">{row.backBets}</StatusPill> },
    { key: 'layBets', header: 'Lay', align: 'right', cell: row => <StatusPill tone="neg">{row.layBets}</StatusPill> },
    { key: 'totalStake', header: 'Total Stake', align: 'right', sort: (a, b) => a.totalStake - b.totalStake, cell: row => money(row.totalStake) },
    { key: 'totalLiability', header: 'Total Liability', align: 'right', sort: (a, b) => a.totalLiability - b.totalLiability, cell: row => money(row.totalLiability) },
    { key: 'avgOdds', header: 'Avg Odds', align: 'right', sort: (a, b) => a.avgOdds - b.avgOdds, cell: row => row.avgOdds.toFixed(2) },
    { key: 'lastBetAt', header: 'Last Bet', cell: row => row.lastBetAt ? formatDateTime(row.lastBetAt) : '-' },
  ];
  const topTable = useLiveTable(topPlayers, tableColumns, 20);
  const allTable = useLiveTable(playerStats, tableColumns, 20);
  return <div className={styles.stack}>
    <div className={styles.metrics}>
      <Stat label="Active Players" value={totalPlayers} hue="grn" />
      <Stat label="Total Player Stake" value={formatAmount(convertFromWhitelabelCurrency(totalPlayerStake))} hue="blu" />
      <Stat label="Total Player Liability" value={formatAmount(convertFromWhitelabelCurrency(totalPlayerLiability))} hue="red" />
    </div>
    <Card title="Top Players by Stake" body="table"><DataTable columns={tableColumns} {...topTable} rowKey={(row) => String(row.userId)} label="Top Players by Stake" state={loading ? 'loading' : 'ready'} /></Card>
    <Card title="All Active Players" sub="Calculated from up to 10,000 loaded bets. Only matched and unmatched bets are included." body="table"><DataTable columns={tableColumns} {...allTable} rowKey={(row) => String(row.userId)} label="All Active Players" state={loading ? 'loading' : 'ready'} /></Card>
  </div>;
};

