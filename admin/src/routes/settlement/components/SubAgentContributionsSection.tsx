import { useMemo, useState } from 'react';
import { IconUsers, IconDownload } from '@tabler/icons-react';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useNavigate } from 'react-router-dom';
import { useTableExport } from '@/shared/hooks/useTableExport';
import type { TableExportColumn } from '@/shared/utils/tableExport';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable';
import { useSettlementTable, settlementDirectionOf, settlerDirectionLabel, type SettlementScheme, type SettlementSummary, type PendingSettlement, type AgentContribution } from '../settlementModel';
import styles from '../SettlementCenter.module.css';
interface SubAgentContributionsSectionProps { isAgent: boolean; agentSchemeType?: SettlementScheme; settlement?: SettlementSummary | null; pendingSettlements?: PendingSettlement[] }
export function SubAgentContributionsSection({ isAgent, agentSchemeType, settlement, pendingSettlements }: SubAgentContributionsSectionProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency(); const navigate = useNavigate(); const money = (amount: number) => formatAmount(convertFromWhitelabelCurrency(amount));
  // P/L = the players' P/L (negative = players lost); share = the agent's share (positive = the agent earns); cut = the platform's part.
  const shareTone = (value: number | null | undefined) => Number(value) > 0 ? styles.positive : Number(value) < 0 ? styles.negative : undefined;
  const subAgentsList = useMemo(() => settlement && Array.isArray(settlement.subAgents) ? settlement.subAgents : [], [settlement]);
  const pendingList = useMemo(() => pendingSettlements ?? [], [pendingSettlements]);
  const [subSort, setSubSort] = useState<DataTableSort | null>(null); const [subExpanded, setSubExpanded] = useState(new Set<string>()); const [pendingExpanded, setPendingExpanded] = useState(new Set<string>());
  const toggle = (value: Set<string>, key: string) => { const next = new Set(value); if (next.has(key)) next.delete(key); else next.add(key); return next; };
  const subAgentExportColumns: TableExportColumn<AgentContribution>[] = useMemo(() => [
    { header: 'Sub-Agent', key: 'subAgentName', width: 22, getter: row => row.subAgentName || row.subAgentUsername || `Sub-Agent ${row.subAgentId}` },
    { header: 'Player Count', key: 'playerCount', width: 12, getter: row => row.playerCount != null ? Number(row.playerCount) : null },
    { header: "Players' P/L", key: 'totalPL', width: 14, getter: row => row.totalPL != null ? Number(row.totalPL) : null },
    { header: 'Agent Share', key: 'totalShare', width: 14, getter: row => row.totalShare != null ? Number(row.totalShare) : null },
    { header: 'Contribution %', key: 'contributionPercentage', width: 14, getter: row => row.contributionPercentage != null ? Number(row.contributionPercentage) : null },
  ], []);
  const pendingExportColumns: TableExportColumn<PendingSettlement>[] = useMemo(() => [
    { header: 'Agent', key: 'agent', width: 18, getter: row => row.agent?.username || row.agentId || 'N/A' },
    { header: 'Scheme Type', key: 'schemeType', width: 12, getter: row => row.schemeType ?? '' },
    { header: 'Pending Amount', key: 'pendingAmount', width: 14, getter: row => row.pendingAmount != null ? Math.abs(Number(row.pendingAmount)) : null },
    { header: 'Direction', key: 'settlementDirection', width: 16, getter: row => settlerDirectionLabel(settlementDirectionOf(row.settlementDirection, row.pendingAmount)) },
    { header: 'Direct Players', key: 'directPlayersCount', width: 12, getter: row => row.directPlayersCount != null ? Number(row.directPlayersCount) : null },
    { header: 'Sub-Agents', key: 'subAgentsCount', width: 12, getter: row => row.subAgentsCount != null ? Number(row.subAgentsCount) : null },
    { header: 'Direct Contribution', key: 'directPlayersContribution', width: 16, getter: row => row.directPlayersContribution != null ? Number(row.directPlayersContribution) : null },
    { header: 'Sub-Agents Contribution', key: 'subAgentsContribution', width: 18, getter: row => row.subAgentsContribution != null ? Number(row.subAgentsContribution) : null },
  ], []);
  const { exporting: exportingSubAgents, handleExport: exportSubAgents } = useTableExport({ data: subAgentsList, columns: subAgentExportColumns, filename: 'Agent-Contributions-SubAgents', sheetName: 'Sub-Agents', title: `Agent Contributions (Sub-Agents) — ${subAgentsList.length} row(s)` });
  const { exporting: exportingPending, handleExport: exportPending } = useTableExport({ data: pendingList, columns: pendingExportColumns, filename: 'Agent-Contributions-Pending', sheetName: 'Pending Agents', title: `Agent Contributions (Pending) — ${pendingList.length} row(s)` });
  const subColumns: DataTableColumn<AgentContribution>[] = [
    { key: 'subAgent', header: 'Sub-Agent', cell: row => <div className={styles.stack}><strong>{row.subAgentName || row.subAgentUsername || `Sub-Agent ${row.subAgentId}`}</strong><span className={styles.muted}>Players: {row.playerCount}</span></div> },
    { key: 'totalPL', header: "Players' P/L", cell: row => money(row.totalPL), sort: (a, b) => Math.abs(b.totalPL) - Math.abs(a.totalPL) },
    { key: 'totalShare', header: 'Agent Share', cell: row => <strong className={shareTone(row.totalShare)}>{money(row.totalShare)}</strong> },
    { key: 'contributionPercentage', header: 'Contribution %', cell: row => `${(row.contributionPercentage ?? 0).toFixed(2)}%`, sort: (a, b) => (b.contributionPercentage ?? 0) - (a.contributionPercentage ?? 0) },
  ];
  const pendingColumns: DataTableColumn<PendingSettlement>[] = [
    { key: 'agent', header: 'Agent', cell: row => <div className={styles.stack}><strong>{row.agent?.username || row.agentId || 'N/A'}</strong><span className={styles.muted}>{row.schemeType}</span></div> },
    // Pending is signed for SHARING (positive = pay the agent) and absolute for CREDIT: its size plus who pays.
    { key: 'pendingAmount', header: 'Pending Amount', cell: row => <div className={styles.stack}><span>{money(Math.abs(Number(row.pendingAmount) || 0))}</span><span className={styles.muted}>{settlerDirectionLabel(settlementDirectionOf(row.settlementDirection, row.pendingAmount))}</span></div>, sort: (a, b) => Math.abs(b.pendingAmount ?? 0) - Math.abs(a.pendingAmount ?? 0) },
    { key: 'directPlayersCount', header: 'Direct Players', cell: row => row.directPlayersCount ?? 0 },
    { key: 'subAgentsCount', header: 'Sub-Agents', cell: row => row.subAgentsCount ?? 0 },
    { key: 'directPlayersContribution', header: 'Direct Contribution', cell: row => money(row.directPlayersContribution ?? 0) },
    { key: 'subAgentsContribution', header: 'Sub-Agents Contribution', cell: row => money(row.subAgentsContribution ?? 0) },
  ];
  const pendingTable = useSettlementTable(pendingList, pendingColumns, 10);
  const subDetails = (row: AgentContribution) => <div className={styles.stack}>
    {!!row.domainBreakdown?.length && <section><h3>Domain Breakdown:</h3>{row.domainBreakdown.map(domain => <div key={domain.domain} className={styles.item}><span>{domain.domain}</span><div><strong>{money(domain.pl)}</strong> <span className={styles.muted}>players' P/L</span><div className={styles.muted}>Agent share: <span className={shareTone(domain.share)}>{money(domain.share)}</span> | Platform cut: {money(domain.cutAmount)}</div></div></div>)}</section>}
    {!!row.players?.length && <section><h3>Players ({row.players.length}):</h3>{row.players.map(player => <div key={player.playerId} className={styles.item}><div>{player.playerName || player.playerUsername || `Player ${player.playerId}`}<div className={styles.muted}>Contribution: {(player.contributionPercentage ?? 0).toFixed(2)}%</div></div><div><strong>{money(player.pl ?? 0)}</strong> <span className={styles.muted}>P/L</span><div className={styles.muted}>Agent share: <span className={shareTone(player.share)}>{money(player.share ?? 0)}</span></div></div></div>)}</section>}
  </div>;
  if (settlement && Array.isArray(settlement.subAgents)) return <Card title={<span className={styles.inline}><IconUsers size={18} aria-hidden="true" />Agent Contributions</span>} body="table" tools={subAgentsList.length > 0 && <Button size="sm" icon={<IconDownload size={16} />} loading={exportingSubAgents} onClick={() => void exportSubAgents()}>Export</Button>}><DataTable label="Agent Contributions" rows={subAgentsList} columns={subColumns} rowKey={row => row.subAgentId} pagination={false} sort={subSort} onSortChange={setSubSort} empty="No agent contributions" expandable={{ expanded: subExpanded, onToggle: key => setSubExpanded(previous => toggle(previous, key)), render: subDetails }} /></Card>;
  if (isAgent && !settlement) {
    if (agentSchemeType === 'COMMISSION') return <Card title="Agent Contributions"><div className={styles.stack}><p className={styles.note}>Contributions are shown for P&L settlement agents. Commission agents can see related data in the Commission section.</p><Button variant="primary" onClick={() => navigate('/commission/overview')}>Go to Commission</Button></div></Card>;
    return <Card title={<span className={styles.inline}><IconUsers size={18} aria-hidden="true" />Agent Contributions</span>}><EmptyState title="No contribution data available for this period" /></Card>;
  }
  if (!isAgent && pendingSettlements?.length) return <Card title={<span className={styles.inline}><IconUsers size={18} aria-hidden="true" />Agent Contributions</span>} sub="Direct agents under you (aggregated P&L from their players and sub-agents)" body="table" tools={<Button size="sm" icon={<IconDownload size={16} />} loading={exportingPending} onClick={() => void exportPending()} disabled={!pendingSettlements.length}>Export</Button>}><DataTable label="Pending Agent Contributions" columns={pendingColumns} {...pendingTable} rowKey={row => row.agentId} expandable={{ expanded: pendingExpanded, onToggle: key => setPendingExpanded(previous => toggle(previous, key)), render: row => !row.settlementBreakdownByDomain?.length && !row.subAgents?.length ? <span className={styles.muted}>No domain breakdown or nested sub-agents</span> : <div className={styles.stack}>
    {!!row.settlementBreakdownByDomain?.length && <section><h3>Domain-wise</h3>{row.settlementBreakdownByDomain.map(domain => <div key={domain.domain} className={styles.item}><strong>{domain.domain}:</strong><span>{money(domain.amount ?? 0)} players' P/L {domain.agentShare != null && <span className={styles.muted}>Agent share: <span className={shareTone(domain.agentShare)}>{money(domain.agentShare)}</span> · Platform cut: {money(domain.cutAmount ?? 0)}</span>}</span></div>)}</section>}
    {!!row.subAgents?.length && <section><h3>Nested sub-agents</h3>{row.subAgents.map(sub => <div key={sub.subAgentId} className={styles.item}><div><strong>{sub.subAgentName || sub.subAgentUsername || `Sub-Agent ${sub.subAgentId}`}</strong><div className={styles.muted}>Players: {sub.playerCount ?? 0}</div></div><div><strong>{money(sub.totalPL ?? 0)} players' P/L</strong><div className={styles.muted}>Agent share: <span className={shareTone(sub.totalShare)}>{money(sub.totalShare ?? 0)}</span></div></div></div>)}</section>}
  </div> }} /></Card>;
  return <Card title={<span className={styles.inline}><IconUsers size={18} aria-hidden="true" />Agent Contributions</span>}><EmptyState title="No direct agents with pending contributions" /></Card>;
}
