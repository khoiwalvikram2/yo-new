import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { IconHistory, IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { SETTLEMENT_DETAILS_QUERY } from '@/lib/graphql/settlements';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { FilterBar } from '@/ui/components/FilterBar';
import { StatusPill } from '@/ui/components/StatusPill';
import { LoadingState } from '@/ui/components/LoadingState';
import { SearchField } from '@/ui/components/SearchField';
import { DateField } from '@/ui/components/DateField';
import { Select } from '@/ui/components/Select';
import { SegmentedControl } from '@/ui/components/SegmentedControl';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { useSettlementTable, type SettlementScheme, type SettlementHistoryRow, type SettlementDetails } from '../settlementModel';
import styles from '../SettlementCenter.module.css';
interface SettlementHistorySectionProps { isAgent: boolean; agentSchemeType?: SettlementScheme; settlements?: SettlementHistoryRow[]; downlineSettlements?: SettlementHistoryRow[] }
export function SettlementHistorySection({ isAgent, agentSchemeType, settlements = [], downlineSettlements }: SettlementHistorySectionProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency(); const { formatDate, formatDateTime } = useFormatDate(); const navigate = useNavigate(); const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  const [searchQuery, setSearchQuery] = useState(''); const [dateRange, setDateRange] = useState<[string, string]>(['', '']); const [typeFilter, setTypeFilter] = useState('');
  const [expandedUpline, setExpandedUpline] = useState(new Set<string>()); const [expandedDownline, setExpandedDownline] = useState(new Set<string>()); const [expandedSingle, setExpandedSingle] = useState(new Set<string>());
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null); const [historySegment, setHistorySegment] = useState<'upline' | 'downline'>('upline'); const [detailsById, setDetailsById] = useState<Record<string, SettlementDetails>>({});
  const { data: settlementDetailsData, loading: detailsLoading } = useQuery<{ settlementDetails: SettlementDetails | null }>(SETTLEMENT_DETAILS_QUERY, { variables: { settlementId: selectedSettlementId || '' }, skip: !selectedSettlementId, fetchPolicy: 'network-only' });
  useEffect(() => { const details = settlementDetailsData?.settlementDetails; if (details?.id && details.id === selectedSettlementId) setDetailsById(previous => previous[details.id] === details ? previous : { ...previous, [details.id]: details }); }, [settlementDetailsData?.settlementDetails, selectedSettlementId]);
  const filterList = useCallback((list: readonly SettlementHistoryRow[]) => {
    let filtered = [...list];
    if (searchQuery) { const query = searchQuery.toLowerCase(); filtered = filtered.filter(row => row.agentId?.toLowerCase().includes(query) || row.id?.toLowerCase().includes(query) || row.agent?.username?.toLowerCase().includes(query)); }
    if (dateRange[0] && dateRange[1]) filtered = filtered.filter(row => { const date = dayjs(row.periodFrom); return date.isAfter(dayjs(dateRange[0]).subtract(1, 'day')) && date.isBefore(dayjs(dateRange[1]).add(1, 'day')); });
    if (!isAgent && typeFilter) filtered = filtered.filter(row => typeFilter === 'COMMISSION' ? row.status === 'COMMISSION' : row.status !== 'COMMISSION');
    return filtered;
  }, [searchQuery, dateRange, typeFilter, isAgent]);
  const filteredSettlements = useMemo(() => filterList(settlements), [settlements, filterList]);
  const filteredDownline = useMemo(() => downlineSettlements ? filterList(downlineSettlements) : [], [downlineSettlements, filterList]);
  const baseColumns: DataTableColumn<SettlementHistoryRow>[] = [
    ...(!isAgent ? [
      { key: 'agent', header: 'Agent', cell: (row: SettlementHistoryRow) => <div className={styles.stack}><strong>{row.agent?.username || 'N/A'}</strong><StatusPill tone={row.agent?.schemeType === 'SHARING' ? 'info' : row.agent?.schemeType === 'CREDIT' ? 'warn' : 'ok'}>{row.agent?.schemeType || 'N/A'}</StatusPill></div> },
      { key: 'type', header: 'Type', width: 120, cell: (row: SettlementHistoryRow) => <StatusPill tone={row.status === 'COMMISSION' ? 'ok' : 'info'}>{row.status === 'COMMISSION' ? 'Commission' : 'P&L'}</StatusPill> },
    ] : []),
    { key: 'period', header: 'Period', cell: row => { const from = formatDate(row.periodFrom, 'MMM d, yyyy'); const to = formatDate(row.periodTo, 'MMM d, yyyy'); return from === to ? from : `${from} - ${to}`; }, sort: (a, b) => dayjs(a.periodFrom).unix() - dayjs(b.periodFrom).unix() },
    { key: 'totalAmount', header: 'Amount', cell: row => { const amount = convertFromWhitelabelCurrency(row.totalAmount ?? 0); const direction = row.direction || (amount >= 0 ? 'TO_AGENT' : 'FROM_AGENT'); return <div className={styles.stack}><strong className={amount >= 0 ? styles.positive : styles.negative}>{formatAmount(amount)}</strong><span className={styles.muted}>{row.status === 'COMMISSION' ? 'Commission Payout' : direction === 'FROM_AGENT' ? 'Collect FROM Agent' : 'Pay TO Agent'}</span></div>; }, sort: (a, b) => a.totalAmount - b.totalAmount },
    { key: 'createdAt', header: 'Created At', cell: row => formatDateTime(row.createdAt, 'MMM d, yyyy HH:mm'), sort: (a, b) => dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix() },
    { key: 'postedAt', header: 'Posted At', cell: row => row.postedAt ? formatDateTime(row.postedAt, 'MMM d, yyyy HH:mm') : '-' },
  ];
  const downlineColumns: DataTableColumn<SettlementHistoryRow>[] = [{ key: 'subAgent', header: 'Sub-Agent', cell: row => <div className={styles.stack}><strong>{row.agent?.username || 'N/A'}</strong><StatusPill tone={row.agent?.schemeType === 'SHARING' ? 'info' : row.agent?.schemeType === 'CREDIT' ? 'ok' : 'warn'}>{row.agent?.schemeType || 'N/A'}</StatusPill></div> }, ...baseColumns];
  const uplineTable = useSettlementTable(filteredSettlements, baseColumns, 10); const downlineTable = useSettlementTable(filteredDownline, downlineColumns, 10);
  const activeFilters = [searchQuery, dateRange[0] && dateRange[1], !isAgent && typeFilter].filter(Boolean).length; const showUplineDownline = isAgent && downlineSettlements != null;
  const toggle = (previous: Set<string>, key: string) => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; };
  const toggleDetailed = (key: string, keys: Set<string>, setKeys: (next: Set<string>) => void) => { const opening = !keys.has(key); setKeys(toggle(keys, key)); if (opening) setSelectedSettlementId(key); else if (selectedSettlementId === key) setSelectedSettlementId(null); };
  const notesOnly = (row: SettlementHistoryRow) => row.notes ? <div className={styles.stack}><strong>Notes:</strong><p className={styles.note}>{row.notes}</p></div> : <span className={styles.muted}>No notes for this settlement.</span>;
  const fullDetails = (row: SettlementHistoryRow) => {
    const details = detailsById[row.id] || (settlementDetailsData?.settlementDetails?.id === row.id ? settlementDetailsData.settlementDetails : undefined); const loading = detailsLoading && selectedSettlementId === row.id;
    if (loading) return <LoadingState label="Loading details..." />;
    return <div className={styles.stack}>
      {row.notes && <div><strong>Notes:</strong><p className={styles.note}>{row.notes}</p></div>}
      {details && <><div className={styles.split}><div><strong>Direct Players</strong><div className={styles.muted}>Count: {details.directPlayersCount || 0}</div><strong>Contribution: {money(details.directPlayersContribution || 0)}</strong></div><div><strong>Sub-Agents</strong><div className={styles.muted}>Count: {details.subAgentsCount || 0}</div><strong>Contribution: {money(details.subAgentsContribution || 0)}</strong></div></div>
        {!!details.domainBreakdown?.length && <section><h3>Domain Breakdown:</h3>{details.domainBreakdown.map(domain => <div className={styles.item} key={domain.domain}><span>{domain.domain}</span><div><strong>{money(domain.amount)}</strong><div className={styles.muted}>{(domain.percentage ?? 0).toFixed(1)}% | Cut: {money(domain.cutAmount ?? 0)}</div></div></div>)}</section>}
        {!!details.playerContributions?.length && <details className={styles.details}><summary className={styles.summary}>Player Contributions ({details.playerContributions.length})</summary>{details.playerContributions.map(player => <div key={player.playerId} className={styles.item}><div><strong>{player.playerName || player.playerUsername || `Player ${player.playerId}`}</strong><div className={styles.muted}>{player.isDirectPlayer ? 'Direct Player' : `Sub-Agent: ${player.subAgentName || 'N/A'}`}</div></div><div><strong>{money(player.pl)}</strong><div className={styles.muted}>Share: {money(player.share)} ({(player.contributionPercentage ?? 0).toFixed(2)}%)</div></div></div>)}</details>}
        {!!details.subAgentContributions?.length && <details className={styles.details}><summary className={styles.summary}>Agent Contributions ({details.subAgentContributions.length})</summary><div className={styles.stack}>{details.subAgentContributions.map(sub => <section key={sub.subAgentId} className={styles.details}><div className={styles.row}><strong>{sub.subAgentName || sub.subAgentUsername || `Sub-Agent ${sub.subAgentId}`}</strong><div><strong>{money(sub.totalPL)}</strong><div className={styles.muted}>Share: {money(sub.totalShare)} | Players: {sub.playerCount}</div></div></div>{!!sub.players?.length && <details className={styles.details}><summary className={styles.summary}>Players ({sub.players.length})</summary>{sub.players.map(player => <div className={styles.item} key={player.playerId}><span>{player.playerName || player.playerUsername || `Player ${player.playerId}`}</span><strong>{money(player.pl)}</strong></div>)}</details>}</section>)}</div></details>}
      </>}
      {!details && !loading && row.notes == null && <span className={styles.muted}>No additional details available.</span>}
    </div>;
  };
  if (isAgent && agentSchemeType === 'COMMISSION') return <Card title="Settlement History"><div className={styles.stack}><p className={styles.note}>Settlement history here is for P&L settlements. Commission history is in the Commission section.</p><Button variant="primary" onClick={() => navigate('/commission/history')}>Go to Commission history</Button></div></Card>;
  return <div className={styles.stack}><FilterBar label="Settlement history filters" activeCount={activeFilters} onClearAll={() => { setSearchQuery(''); setDateRange(['', '']); setTypeFilter(''); }} search={<SearchField label={isAgent ? 'Search by settlement ID' : 'Search by agent or ID'} placeholder={isAgent ? 'Search by settlement ID...' : 'Search by agent or ID...'} value={searchQuery} onChange={setSearchQuery} size="sm" />}>
    <DateField label="Start Date" value={dateRange[0]} max={dateRange[1] || undefined} onChange={value => setDateRange([value, dateRange[1]])} size="sm" /><DateField label="End Date" value={dateRange[1]} min={dateRange[0] || undefined} onChange={value => setDateRange([dateRange[0], value])} size="sm" />
    {!isAgent && <Select label="Settlement Type" value={typeFilter} onChange={setTypeFilter} options={[{ value: '', label: 'All types' }, { value: 'P_L', label: 'P&L' }, { value: 'COMMISSION', label: 'Commission' }]} size="sm" />}
  </FilterBar><Card title={<span className={styles.inline}><IconHistory size={18} aria-hidden="true" />Settlement History</span>} body="table" tools={showUplineDownline && <SegmentedControl label="History segment" value={historySegment} onChange={setHistorySegment} options={[{ value: 'upline', label: 'Upline', icon: <IconArrowUp size={16} /> }, { value: 'downline', label: 'Downline', icon: <IconArrowDown size={16} /> }]} />}>
    {showUplineDownline && historySegment === 'downline' ? <DataTable label="Downline settlement history" columns={downlineColumns} {...downlineTable} rowKey={row => row.id} empty="No downline settlement history" expandable={{ expanded: expandedDownline, onToggle: key => toggleDetailed(key, expandedDownline, setExpandedDownline), render: fullDetails }} /> : <DataTable label={showUplineDownline ? 'Upline settlement history' : 'Settlement History'} columns={baseColumns} {...uplineTable} rowKey={row => row.id} empty={showUplineDownline ? 'No upline settlement history' : 'No settlement history'} expandable={{ expanded: showUplineDownline ? expandedUpline : expandedSingle, onToggle: key => { if (showUplineDownline) setExpandedUpline(previous => toggle(previous, key)); else if (isAgent) setExpandedSingle(previous => toggle(previous, key)); else toggleDetailed(key, expandedSingle, setExpandedSingle); }, render: showUplineDownline || isAgent ? notesOnly : fullDetails }} />}
  </Card></div>;
}
