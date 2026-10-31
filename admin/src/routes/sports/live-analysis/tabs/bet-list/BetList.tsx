import type { SportsAggregateBet } from '../../sportsLiveModel';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { FilterBar } from '@/ui/components/FilterBar';
import { SearchField } from '@/ui/components/SearchField';
import { Select } from '@/ui/components/Select';
import { StatusPill } from '@/ui/components/StatusPill';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { useLiveTable } from '../../sportsLiveModel';
import React, { useState, useMemo } from "react";
import { useQuery } from "@apollo/client";
import { gql } from "@apollo/client";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { useFormatDate } from "@/shared/core/useFormatDate";

const SPORTS_BETS_QUERY = gql`
  query SportsBets($query: SportsBetsQuery) {
    sportsBets(query: $query) {
      id
      userId
      sportId
      leagueId
      eventId
      marketId
      side
      price
      stake
      liability
      status
      currency
      createdAt
    }
  }
`;

export const BetList: React.FC = () => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDateTime } = useFormatDate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [sideFilter, setSideFilter] = useState<string | undefined>(undefined);

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  // This ensures proper filtering based on selected whitelabel in admin panel top bar
  const { data, loading, refetch } = useQuery<{ sportsBets: SportsAggregateBet[] }>(SPORTS_BETS_QUERY, {
    variables: {
      query: {
        // Only show open bets (matched/unmatched) - server-side filter
        statuses: ['matched', 'unmatched'],
        side: sideFilter || undefined,
        limit: 1000,
      },
    },
    pollInterval: 5000,
    // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    fetchPolicy: "network-only",
  });

  const filteredBets = useMemo(() => {
    if (!data?.sportsBets) return [];
    let bets = data.sportsBets;
    
    // Filter for open bets only (matched or unmatched) - this is the default for live analysis
    bets = bets.filter((bet) => 
      bet.status === 'matched' || bet.status === 'unmatched'
    );
    
    // Apply status filter if provided
    if (statusFilter) {
      bets = bets.filter((bet) => bet.status === statusFilter);
    }
    
    if (searchQuery) {
      bets = bets.filter((bet) =>
        String(bet.userId).includes(searchQuery) ||
        String(bet.id).includes(searchQuery)
      );
    }
    
    return bets;
  }, [data, searchQuery, statusFilter]);

  const tableColumns: DataTableColumn<SportsAggregateBet>[] = [
    { key: 'userId', header: 'User ID', width: 100, cell: row => row.userId },
    { key: 'side', header: 'Side', width: 80, cell: row => <StatusPill tone={row.side === 'back' ? 'info' : 'neg'}>{row.side?.toUpperCase()}</StatusPill> },
    { key: 'price', header: 'Price', width: 100, cell: row => row.price?.toFixed(2) },
    { key: 'stake', header: 'Stake', width: 120, cell: row => formatAmount(convertFromWhitelabelCurrency(row.stake || 0)) },
    { key: 'liability', header: 'Liability', width: 120, cell: row => formatAmount(convertFromWhitelabelCurrency(row.liability || 0)) },
    { key: 'status', header: 'Status', width: 100, cell: row => <StatusPill tone={row.status === 'matched' ? 'ok' : row.status === 'unmatched' ? 'warn' : 'neutral'}>{row.status?.toUpperCase()}</StatusPill> },
    { key: 'createdAt', header: 'Time', width: 150, cell: row => row.createdAt ? formatDateTime(row.createdAt) : '-' },
  ];
  const table = useLiveTable(filteredBets, tableColumns, 20);
  return <Card title="Bet List" sub="Up to 1,000 loaded open bets. Auto-refreshes every five seconds." body="table" tools={<Button size="sm" onClick={() => { void refetch(); }} loading={loading}>Refresh bets</Button>}>
    <DataTable columns={tableColumns} {...table} rowKey={(row) => String(row.id)} label="Bet List" state={loading ? 'loading' : 'ready'} toolbar={<FilterBar label="Bet filters" activeCount={[searchQuery, statusFilter, sideFilter].filter(Boolean).length} onClearAll={() => { setSearchQuery(""); setStatusFilter(undefined); setSideFilter(undefined); }} search={<SearchField label="Search by User ID or Bet ID" placeholder="Search by User ID or Bet ID" value={searchQuery} onChange={setSearchQuery} size="sm" />}>
      <Select label="Filter by Status" value={statusFilter || ''} onChange={(value) => setStatusFilter(value || undefined)} options={[{ label: 'All open statuses', value: '' }, { label: 'Matched', value: 'matched' }, { label: 'Unmatched', value: 'unmatched' }]} size="sm" />
      <Select label="Filter by Side" value={sideFilter || ''} onChange={(value) => setSideFilter(value || undefined)} options={[{ label: 'All sides', value: '' }, { label: 'Back', value: 'back' }, { label: 'Lay', value: 'lay' }]} size="sm" />
    </FilterBar>} />
  </Card>;
};

