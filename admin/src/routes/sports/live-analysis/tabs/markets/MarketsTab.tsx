import type { SportsLiveDashboard, SportsAggregateBet, SportsMarketSummary } from '../../sportsLiveModel';
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
      marketId
      eventId
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

interface MarketsTabProps {
  dashboard: SportsLiveDashboard | null;
  didAnimate: boolean;
}

export const MarketsTab: React.FC<MarketsTabProps> = ({
  dashboard,
  didAnimate,
}) => {
  void didAnimate;
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

  // Aggregate market data from bets
  const marketStats = useMemo(() => {
    if (!data?.sportsBets) return [];

    const bets = data.sportsBets.filter(
      (bet) => bet.status === "matched" || bet.status === "unmatched"
    );

    const marketMap = new Map<string, SportsMarketSummary>();
    bets.forEach((bet) => {
      const marketId = bet.marketId;
      if (!marketMap.has(marketId)) {
        marketMap.set(marketId, {
          marketId,
          eventId: bet.eventId,
          bets: 0,
          totalStake: 0,
          totalLiability: 0,
          backBets: 0,
          layBets: 0,
          avgOdds: 0,
          lastBetAt: bet.createdAt,
        });
      }

      const market = marketMap.get(marketId)!;
      market.bets += 1;
      // Total wagered for sports = liability
      market.totalStake += Number(bet.liability ?? bet.stake ?? 0);
      market.totalLiability += Number(bet.liability || 0);
      if (bet.side === "back") {
        market.backBets += 1;
      } else {
        market.layBets += 1;
      }
      market.avgOdds += Number(bet.price || 0);
      if (new Date(bet.createdAt) > new Date(market.lastBetAt)) {
        market.lastBetAt = bet.createdAt;
      }
    });

    // Calculate average odds
    Array.from(marketMap.values()).forEach((market) => {
      market.avgOdds = market.bets > 0 ? market.avgOdds / market.bets : 0;
    });

    return Array.from(marketMap.values()).sort(
      (a, b) => b.totalStake - a.totalStake
    );
  }, [data]);

  // Get event names from dashboard breakdown
  const eventMap = useMemo(() => {
    const map = new Map<string, string>();
    dashboard?.breakdown?.byEvent?.forEach((event) => {
      if (event.eventId) map.set(event.eventId, event.eventName || "Unknown");
    });
    return map;
  }, [dashboard]);

  const topMarkets = marketStats.slice(0, 10);
  const totalMarkets = marketStats.length;
  const totalMarketStake = marketStats.reduce(
    (sum, m) => sum + m.totalStake,
    0
  );
  const totalMarketLiability = marketStats.reduce(
    (sum, m) => sum + m.totalLiability,
    0
  );

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value || 0));
  const tableColumns: DataTableColumn<SportsMarketSummary>[] = [
    { key: 'marketId', header: 'Market ID', width: 200, cell: row => <span className={styles.mono}>{row.marketId}</span> },
    { key: 'eventId', header: 'Event', cell: row => eventMap.get(row.eventId) || row.eventId },
    { key: 'backBets', header: 'Back', align: 'right', cell: row => <StatusPill tone="info">{row.backBets}</StatusPill> },
    { key: 'layBets', header: 'Lay', align: 'right', cell: row => <StatusPill tone="neg">{row.layBets}</StatusPill> },
    { key: 'totalStake', header: 'Total Stake', align: 'right', sort: (a, b) => a.totalStake - b.totalStake, cell: row => money(row.totalStake) },
    { key: 'totalLiability', header: 'Total Liability', align: 'right', sort: (a, b) => a.totalLiability - b.totalLiability, cell: row => money(row.totalLiability) },
    { key: 'avgOdds', header: 'Avg Odds', align: 'right', sort: (a, b) => a.avgOdds - b.avgOdds, cell: row => row.avgOdds.toFixed(2) },
    { key: 'lastBetAt', header: 'Last Bet', cell: row => row.lastBetAt ? formatDateTime(row.lastBetAt) : '-' },
  ];
  const topTable = useLiveTable(topMarkets, tableColumns, 20);
  const allTable = useLiveTable(marketStats, tableColumns, 20);
  return <div className={styles.stack}>
    <div className={styles.metrics}>
      <Stat label="Active Markets" value={totalMarkets} hue="grn" />
      <Stat label="Total Market Stake" value={formatAmount(convertFromWhitelabelCurrency(totalMarketStake))} hue="blu" />
      <Stat label="Total Market Liability" value={formatAmount(convertFromWhitelabelCurrency(totalMarketLiability))} hue="red" />
    </div>
    <Card title="Top Markets by Stake" body="table"><DataTable columns={tableColumns} {...topTable} rowKey={(row) => String(row.marketId)} label="Top Markets by Stake" state={loading ? 'loading' : 'ready'} /></Card>
    <Card title="All Running Markets" sub="Calculated from up to 10,000 loaded bets. Only matched and unmatched bets are included." body="table"><DataTable columns={tableColumns} {...allTable} rowKey={(row) => String(row.marketId)} label="All Running Markets" state={loading ? 'loading' : 'ready'} /></Card>
  </div>;
};

