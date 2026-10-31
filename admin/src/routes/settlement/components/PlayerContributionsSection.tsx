import { useState, useMemo } from 'react';
import { IconUser, IconDownload } from '@tabler/icons-react';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useNavigate } from 'react-router-dom';
import { useTableExport } from '@/shared/hooks/useTableExport';
import type { TableExportColumn } from '@/shared/utils/tableExport';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { SearchField } from '@/ui/components/SearchField';
import { StatusPill } from '@/ui/components/StatusPill';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { useSettlementTable, type SettlementScheme, type SettlementSummary, type PendingSettlement, type PlayerContribution } from '../settlementModel';
import styles from '../SettlementCenter.module.css';
interface PlayerContributionsSectionProps { isAgent: boolean; agentSchemeType?: SettlementScheme; settlement?: SettlementSummary | null; pendingSettlements?: PendingSettlement[] }
export function PlayerContributionsSection({ isAgent, agentSchemeType, settlement }: PlayerContributionsSectionProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency(); const navigate = useNavigate(); const [searchQuery, setSearchQuery] = useState('');
  const playersFiltered = useMemo(() => {
    if (!settlement || !Array.isArray(settlement.topPlayers)) return [];
    let list = settlement.topPlayers.filter(player => player.isDirectPlayer === true);
    if (searchQuery) { const query = searchQuery.toLowerCase(); list = list.filter(player => player.playerName?.toLowerCase().includes(query) || player.playerUsername?.toLowerCase().includes(query) || player.playerId?.toString().includes(query)); }
    return list;
  }, [settlement, searchQuery]);
  const playerExportColumns: TableExportColumn<PlayerContribution>[] = useMemo(() => [
    { header: 'Player', key: 'playerName', width: 22, getter: row => row.playerName || row.playerUsername || `Player ${row.playerId}` },
    { header: 'Player P/L', key: 'pl', width: 14, getter: row => row.pl != null ? Number(row.pl) : null },
    { header: 'Agent Share', key: 'share', width: 14, getter: row => row.share != null ? Number(row.share) : null },
    { header: 'Contribution %', key: 'contributionPercentage', width: 14, getter: row => row.contributionPercentage != null ? Number(row.contributionPercentage) : null },
  ], []);
  const { exporting, handleExport } = useTableExport({ data: playersFiltered, columns: playerExportColumns, filename: 'Player-Contributions', sheetName: 'Player Contributions', title: `Player Contributions — ${playersFiltered.length} player(s)` });
  const money = (amount: number) => formatAmount(convertFromWhitelabelCurrency(amount));
  // pl = the player's P/L (negative = the player lost); share = the agent's share (positive = the agent earns).
  const shareTone = (value: number) => value > 0 ? styles.positive : value < 0 ? styles.negative : undefined;
  const columns: DataTableColumn<PlayerContribution>[] = [
    { key: 'player', header: 'Player', cell: row => <div className={styles.stack}><strong>{row.playerName || row.playerUsername || `Player ${row.playerId}`}</strong><StatusPill tone={row.isDirectPlayer ? 'info' : 'warn'}>{row.isDirectPlayer ? 'Direct Player' : `Sub-Agent: ${row.subAgentName || 'N/A'}`}</StatusPill></div> },
    { key: 'pl', header: 'Player P/L', cell: row => money(row.pl), sort: (a, b) => Math.abs(b.pl) - Math.abs(a.pl) },
    { key: 'share', header: 'Agent Share', cell: row => <strong className={shareTone(Number(row.share) || 0)}>{money(row.share)}</strong> },
    { key: 'contributionPercentage', header: 'Contribution %', cell: row => `${(row.contributionPercentage ?? 0).toFixed(2)}%`, sort: (a, b) => Number(b.contributionPercentage) - Number(a.contributionPercentage) },
    { key: 'domainBreakdown', header: 'Domain Breakdown', cell: row => <div className={styles.stack}>{(row.domainBreakdown || []).map(domain => <span key={domain.domain}>{domain.domain}: <strong>{money(domain.pl)}</strong> P/L (Agent share: <span className={shareTone(Number(domain.share) || 0)}>{money(domain.share)}</span>)</span>)}</div> },
  ];
  const table = useSettlementTable(playersFiltered, columns, 10);
  if (settlement && Array.isArray(settlement.topPlayers)) return <Card title={<span className={styles.inline}><IconUser size={18} aria-hidden="true" />Player Contributions</span>} sub="Direct players only. Player P/L: negative = the player lost. Agent Share: positive = the agent earns." body="table" tools={<div className={styles.tools}><SearchField label="Search players" placeholder="Search players..." value={searchQuery} onChange={setSearchQuery} size="sm" /><Button size="sm" icon={<IconDownload size={16} />} loading={exporting} onClick={() => void handleExport()} disabled={!playersFiltered.length}>Export</Button></div>}><DataTable label="Player Contributions" columns={columns} {...table} rowKey={row => row.playerId} empty="No direct player contributions" /></Card>;
  if (isAgent && !settlement) {
    if (agentSchemeType === 'COMMISSION') return <Card title="Player Contributions"><div className={styles.stack}><p className={styles.note}>Contributions are shown for P&L settlement agents. Commission agents can see related data in the Commission section.</p><Button variant="primary" onClick={() => navigate('/commission/overview')}>Go to Commission</Button></div></Card>;
    return <Card title={<span className={styles.inline}><IconUser size={18} aria-hidden="true" />Player Contributions</span>}><EmptyState title="No contribution data available for this period" /></Card>;
  }
  return <Card title={<span className={styles.inline}><IconUser size={18} aria-hidden="true" />Player Contributions</span>}><EmptyState title="Select an agent from the dropdown above to view player contributions" /></Card>;
}
