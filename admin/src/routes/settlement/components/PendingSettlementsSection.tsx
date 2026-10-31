import { useState, useEffect, useMemo } from 'react';
import { IconUsers, IconCash, IconDownload, IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { useMutation } from '@apollo/client';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { useNavigate } from 'react-router-dom';
import { SettlementModal } from '../../settlements/components/SettlementModal';
import { SETTLE_AGENT_MUTATION } from '@/lib/graphql/settlements';
import { notify } from '@/shared/services/notification';
import { useTableExport } from '@/shared/hooks/useTableExport';
import type { TableExportColumn } from '@/shared/utils/tableExport';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Stat } from '@/ui/components/Stat';
import { StatusPill } from '@/ui/components/StatusPill';
import { EmptyState } from '@/ui/components/EmptyState';
import { LoadingState } from '@/ui/components/LoadingState';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { useSettlementTable, settlementDirectionOf, settlerDirectionLabel, agentDirectionLabel, sharingSettlePeriod, type SettlementScheme, type SettlementSummary, type PendingSettlement } from '../settlementModel';
import styles from '../SettlementCenter.module.css';
interface PendingSettlementsSectionProps { isAgent: boolean; agentSchemeType?: SettlementScheme; settlement?: SettlementSummary | null; pendingSettlements?: PendingSettlement[]; refetchPendingSettlements?: () => Promise<unknown>; subAgentsPending?: PendingSettlement[]; subAgentsPendingLoading?: boolean }
export function PendingSettlementsSection({ isAgent, agentSchemeType, settlement, pendingSettlements, refetchPendingSettlements, subAgentsPending = [], subAgentsPendingLoading = false }: PendingSettlementsSectionProps) {
  const { formatDateTime } = useFormatDate(); const { formatAmount, convertFromWhitelabelCurrency } = useCurrency(); const navigate = useNavigate();
  const [settlementModalVisible, setSettlementModalVisible] = useState(false); const [selectedAgent, setSelectedAgent] = useState<PendingSettlement | null>(null); const [expanded, setExpanded] = useState(new Set<string>());
  useEffect(() => { if (!isAgent && selectedAgent?.agentId && pendingSettlements?.length) { const fresh = pendingSettlements.find(row => row.agentId === selectedAgent.agentId); if (fresh) setSelectedAgent(fresh); } }, [isAgent, selectedAgent?.agentId, pendingSettlements]);
  const pendingList = useMemo(() => pendingSettlements ?? [], [pendingSettlements]); const subAgentsList = useMemo(() => subAgentsPending ?? [], [subAgentsPending]);
  const pendingExportCols: TableExportColumn<PendingSettlement>[] = useMemo(() => [
    { header: 'Agent', key: 'agent', width: 18, getter: row => row.agent?.username || row.agentId || 'N/A' },
    { header: 'Scheme Type', key: 'schemeType', width: 12, getter: row => row.agent?.schemeType ?? '' },
    { header: 'Pending Amount', key: 'pendingAmount', width: 14, getter: row => row.pendingAmount != null ? Math.abs(Number(row.pendingAmount)) : null },
    { header: 'Direction', key: 'settlementDirection', width: 16, getter: row => settlerDirectionLabel(settlementDirectionOf(row.settlementDirection, row.pendingAmount)) },
    { header: 'Direct Players', key: 'directPlayersCount', width: 12, getter: row => row.directPlayersCount != null ? Number(row.directPlayersCount) : null },
    { header: 'Sub-Agents', key: 'subAgentsCount', width: 12, getter: row => row.subAgentsCount != null ? Number(row.subAgentsCount) : null },
    { header: 'Last Settlement', key: 'lastSettlementDate', width: 18, getter: row => row.lastSettlementDate ?? '' },
  ], []);
  const subAgentsExportCols: TableExportColumn<PendingSettlement>[] = useMemo(() => [
    { header: 'Agent', key: 'agent', width: 18, getter: row => row.agent?.username || 'N/A' },
    { header: 'Settled This Period', key: 'settledThisPeriod', width: 14, getter: row => row.settledThisPeriod != null ? Math.abs(Number(row.settledThisPeriod)) : null },
    { header: 'Pending Amount', key: 'pendingAmount', width: 14, getter: row => row.pendingAmount != null ? Math.abs(Number(row.pendingAmount)) : null },
    { header: 'Direction', key: 'settlementDirection', width: 16, getter: row => settlerDirectionLabel(settlementDirectionOf(row.settlementDirection, row.pendingAmount)) },
    { header: 'Type', key: 'settlementType', width: 12, getter: row => row.settlementType ?? '' },
    { header: 'Total Settled', key: 'totalSettledToAgent', width: 14, getter: row => row.totalSettledToAgent != null ? Number(row.totalSettledToAgent) : null },
    { header: 'Last Settlement', key: 'lastSettlementDate', width: 18, getter: row => row.lastSettlementDate ?? '' },
  ], []);
  const { exporting: exportingPending, handleExport: exportPending } = useTableExport({ data: pendingList, columns: pendingExportCols, filename: 'Pending-Settlements', sheetName: 'Pending Settlements', title: `Pending Settlements — ${pendingList.length} row(s)` });
  const { exporting: exportingSubAgents, handleExport: exportSubAgents } = useTableExport({ data: subAgentsList, columns: subAgentsExportCols, filename: 'SubAgents-Pending-Settlements', sheetName: 'Sub-Agents Pending', title: `Sub-Agents Pending — ${subAgentsList.length} row(s)` });
  const [settleAgent] = useMutation<{ settleAgent: { success: boolean; message?: string | null } }>(SETTLE_AGENT_MUTATION, {
    onCompleted: data => { if (data.settleAgent.success) { notify.success(data.settleAgent.message || 'Settlement completed successfully', 'Settlement Successful'); setSettlementModalVisible(false); setSelectedAgent(null); window.location.reload(); } else notify.error(data.settleAgent.message || 'Settlement failed', 'Settlement Failed'); },
    onError: error => notify.error(error.message || 'An error occurred while processing the settlement', 'Settlement Error'),
  });
  const handleSettle = (agent: PendingSettlement) => { setSelectedAgent(agent); setSettlementModalVisible(true); };
  const handleSettlementSubmit = async (values: { amount?: number | string | null; direction?: string; notes?: unknown }) => {
    if (!selectedAgent?.agentId || !selectedAgent?.settlementType) return;
    const amount = values.amount != null && values.amount !== '' ? Number(values.amount) : Math.abs(Number(selectedAgent.pendingAmount) || 0);
    const notes = (values.notes != null ? String(values.notes) : '').trim();
    if (amount <= 0) { notify.error('Settlement amount must be greater than 0', 'Validation'); return; }
    if (!notes || notes.length < 3) { notify.error('Notes must be at least 3 characters', 'Validation'); return; }
    // SHARING settles exactly the window the row shows (its periodTo), so the posted amount is the shown one.
    const input = { agentId: selectedAgent.agentId, settlementType: selectedAgent.settlementType, amount, direction: values.direction ?? 'TO_AGENT', notes, ...sharingSettlePeriod(selectedAgent) };
    await settleAgent({ variables: { input } });
  };
  const money = (amount: number) => formatAmount(convertFromWhitelabelCurrency(amount));
  const columns: DataTableColumn<PendingSettlement>[] = [
    { key: 'agent', header: 'Agent', cell: row => <div className={styles.stack}><strong>{row.agent?.username || 'N/A'}</strong><StatusPill tone={row.agent?.schemeType === 'SHARING' ? 'info' : row.agent?.schemeType === 'CREDIT' ? 'ok' : 'warn'}>{row.agent?.schemeType}</StatusPill></div> },
    // settledThisPeriod is signed like the pending amount; the amount settled is its size.
    { key: 'settledThisPeriod', header: 'Settled this period', cell: row => row.settledThisPeriod != null && Number(row.settledThisPeriod) !== 0 ? money(Math.abs(Number(row.settledThisPeriod))) : '—' },
    // Who pays, from the settler's side: TO_AGENT = you pay the agent, FROM_AGENT = you collect from it (in words, not colour alone).
    { key: 'pendingAmount', header: 'Remaining (Pending)', cell: row => { const direction = settlementDirectionOf(row.settlementDirection, row.pendingAmount); const amount = Math.abs(convertFromWhitelabelCurrency(Number(row.pendingAmount) || 0)); const totalShare = row.totalShareForPeriod != null ? Number(row.totalShareForPeriod) : null; return <div className={styles.stack}><strong className={direction === 'TO_AGENT' ? styles.negative : direction === 'FROM_AGENT' ? styles.positive : undefined}>{direction === 'TO_AGENT' ? <IconArrowUp size={14} aria-hidden="true" /> : direction === 'FROM_AGENT' ? <IconArrowDown size={14} aria-hidden="true" /> : null}{formatAmount(amount)}</strong><span className={styles.muted}>{settlerDirectionLabel(direction)}</span>{totalShare != null && Math.abs(totalShare) > 0.01 && <span className={styles.muted}>Total for period: {money(Math.abs(totalShare))}</span>}</div>; } },
    { key: 'settlementType', header: 'Type', cell: row => <StatusPill>{row.settlementType}</StatusPill> },
    { key: 'totalSettledToAgent', header: 'Total Settled (All Time)', cell: row => row.totalSettledToAgent != null ? money(Number(row.totalSettledToAgent)) : '—' },
    { key: 'lastSettlementDate', header: 'Last Settlement', cell: row => row.lastSettlementDate ? formatDateTime(row.lastSettlementDate, 'MMM d, yyyy h:mm a') : 'Never' },
    { key: 'actions', header: 'Actions', cell: row => <Button variant="primary" size="sm" onClick={() => handleSettle(row)}>Settle</Button> },
  ];
  const pendingTable = useSettlementTable(pendingList, columns, 10); const subTable = useSettlementTable(subAgentsList, columns, 10);
  const renderBreakdown = (row: SettlementSummary, compact = false) => <div className={styles.stack}>
    {!!row.settlementBreakdownByDomain?.length && <><section><h3>Rate by domain</h3><div className={styles.row}>{row.settlementBreakdownByDomain.map(domain => <span key={domain.domain}>{domain.domain}: <strong>{typeof domain.shareRate === 'number' ? domain.shareRate.toFixed(1) : domain.shareRate ?? '–'}%</strong></span>)}</div></section>
      {/* amount = the players' P/L (negative = players lost), agentShare positive = the agent earns, cutAmount = the platform's part (|GGR| − |share|). */}
      <section><h3>Domain breakdown (players' P/L, agent share, platform cut)</h3>{row.settlementBreakdownByDomain.map(domain => { const share = domain.agentShare != null ? Number(domain.agentShare) || 0 : null; return <div key={domain.domain} className={styles.item}><strong>{domain.domain}</strong><div>{!compact && <span className={styles.muted}>Rate: {typeof domain.shareRate === 'number' ? domain.shareRate.toFixed(1) : domain.shareRate ?? '–'}% · {domain.percentage?.toFixed(1) ?? '–'}% of total</span>}<div className={styles.strong}>{money(domain.amount ?? 0)} players' P/L</div><span className={styles.muted}>{compact ? 'Your share' : 'Agent share'}: {share == null ? '–' : <><strong className={share > 0 ? styles.positive : share < 0 ? styles.negative : undefined}>{money(share)}</strong> ({share > 0 ? (compact ? 'you earn' : 'agent earns') : share < 0 ? (compact ? 'you pay' : 'agent pays') : 'nothing due'})</>} · Platform cut: {money(domain.cutAmount ?? 0)} ({domain.cutPercentage?.toFixed(1) ?? '–'}%)</span></div></div>; })}</section></>}
    {!compact && <><div className={styles.split}><Stat variant="bare" label="Direct Players" value={`Count: ${row.directPlayersCount || 0}`} note={`Contribution: ${money(row.directPlayersContribution || 0)}`} /><Stat variant="bare" label="Sub-Agents" value={`Count: ${row.subAgentsCount || 0}`} note={`Contribution: ${money(row.subAgentsContribution || 0)}`} /></div>
      {!!row.topPlayers?.length && <section><h3>Top Contributing Players:</h3>{row.topPlayers.slice(0, 5).map(player => <div key={player.playerId} className={styles.item}><span>{player.playerName || player.playerUsername || `Player ${player.playerId}`}</span><strong>{money(player.pl)} ({(player.contributionPercentage ?? 0).toFixed(2)}%)</strong></div>)}</section>}</>}
  </div>;
  const toggle = (key: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const modal = <SettlementModal visible={settlementModalVisible} agent={selectedAgent} onCancel={() => { setSettlementModalVisible(false); setSelectedAgent(null); }} onSubmit={handleSettlementSubmit} formatCurrency={money} onRefresh={!isAgent && refetchPendingSettlements ? async () => { await refetchPendingSettlements(); } : undefined} />;
  const isAgentView = isAgent && agentSchemeType !== 'COMMISSION' && (settlement || subAgentsPending.length > 0);
  if (isAgentView) return <div className={styles.stack}>
    {/* The agent's own view: settlementDue positive = TO_AGENT (you receive from your upline), negative = FROM_AGENT (you pay); the backend's direction wins. */}
    {settlement && (() => { const pendingAmount = convertFromWhitelabelCurrency(settlement.settlementDue || 0); const direction = settlementDirectionOf(settlement.settlementDirection, settlement.settlementDue); return <Card title={<span className={styles.inline}><IconCash size={18} aria-hidden="true" />Pending Settlement</span>} sub="Since Last Settlement" tools={<StatusPill tone={direction === 'FROM_AGENT' ? 'neg' : direction === 'TO_AGENT' ? 'ok' : 'neutral'}>{agentDirectionLabel(direction)}</StatusPill>}><div className={styles.stack}><strong className={direction === 'FROM_AGENT' ? styles.negative : direction === 'TO_AGENT' ? styles.positive : undefined}>{formatAmount(Math.abs(pendingAmount))}</strong><span className={styles.muted}>Share: {settlement.sharePercentage?.toFixed(2)}% | Direct Players: {settlement.directPlayersCount || 0} | Sub-Agents: {settlement.subAgentsCount || 0}</span>{!!settlement.settlementBreakdownByDomain?.length && <details className={styles.details}><summary className={styles.summary}>Rate by domain & domain breakdown</summary>{renderBreakdown(settlement, true)}</details>}</div></Card>; })()}
    {subAgentsPending.length > 0 && <Card title={<span className={styles.inline}><IconUsers size={18} aria-hidden="true" />Sub-Agents Pending</span>} body="table" tools={<Button size="sm" icon={<IconDownload size={16} />} loading={exportingSubAgents} onClick={() => void exportSubAgents()} disabled={!subAgentsPending.length}>Export</Button>}><DataTable label="Sub-Agents Pending" columns={columns} {...subTable} rowKey={row => row.agentId} expandable={{ expanded, onToggle: toggle, render: row => renderBreakdown(row) }} empty="No sub-agents with pending settlements" /></Card>}{modal}
  </div>;
  if (!isAgent && pendingSettlements) return <div className={styles.stack}><Card title={<span className={styles.inline}><IconUsers size={18} aria-hidden="true" />Pending Settlements</span>} body="table" tools={<Button size="sm" icon={<IconDownload size={16} />} loading={exportingPending} onClick={() => void exportPending()} disabled={!pendingSettlements.length}>Export</Button>}><DataTable label="Pending Settlements" columns={columns} {...pendingTable} rowKey={row => row.agentId} expandable={{ expanded, onToggle: toggle, render: row => renderBreakdown(row) }} empty="No pending settlements" /></Card>{modal}</div>;
  if (isAgent && agentSchemeType === 'COMMISSION') return <Card title="Pending Settlements"><div className={styles.stack}><p className={styles.note}>Commission payouts are managed in the Commission section.</p><Button variant="primary" onClick={() => navigate('/commission/overview')}>Go to Commission</Button></div></Card>;
  if (isAgent && !settlement && subAgentsPending.length === 0 && subAgentsPendingLoading) return <Card><LoadingState label="Loading sub-agents…" /></Card>;
  return <Card title={<span className={styles.inline}><IconUsers size={18} aria-hidden="true" />Pending Settlements</span>}><EmptyState title="No pending settlements" /></Card>;
}
