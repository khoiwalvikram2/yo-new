import { useNavigate } from 'react-router-dom';
import { IconChartBar, IconInfoCircle } from '@tabler/icons-react';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { IconButton } from '@/ui/components/IconButton';
import { EmptyState } from '@/ui/components/EmptyState';
import { Tooltip } from '@/ui/components/Tooltip';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { agentSettlementDomains, aggregateSettlementDomains, type SettlementScheme, type SettlementSummary, type PendingSettlement, type SettlementDomainRow } from '../settlementModel';
import styles from '../SettlementCenter.module.css';
interface DomainBreakdownSectionProps { isAgent: boolean; agentSchemeType?: SettlementScheme; settlement?: SettlementSummary | null; pendingSettlements?: PendingSettlement[] }
export function DomainBreakdownSection({ isAgent, agentSchemeType, settlement, pendingSettlements }: DomainBreakdownSectionProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const navigate = useNavigate();
  const money = (amount: number) => formatAmount(convertFromWhitelabelCurrency(amount));
  if (isAgent && agentSchemeType === 'COMMISSION') return <Card title="Domain Breakdown"><div className={styles.stack}><p className={styles.note}>Domain breakdown is available for P&L settlement agents. Commission agents can see breakdown in the Commission section.</p><Button variant="primary" onClick={() => navigate('/commission/overview')}>Go to Commission</Button></div></Card>;
  if (isAgent && settlement) {
    const rows = agentSettlementDomains(settlement);
    if (!rows.length) return <Card title={<span className={styles.inline}><IconChartBar size={18} aria-hidden="true" />Domain Breakdown</span>}><EmptyState title="No domain data available" /></Card>;
    const totalPL = rows.reduce((sum, row) => sum + Math.abs(row.pl), 0);
    // Players' P/L (negative = players lost), your share (positive = you earn) and the platform's cut (|P/L| − |share|).
    const shareTone = (value: number) => value > 0 ? styles.positive : value < 0 ? styles.negative : undefined;
    const shareTotal = rows.reduce((sum, row) => sum + row.share, 0);
    const columns: DataTableColumn<SettlementDomainRow>[] = [
      { key: 'domain', header: 'Domain', cell: row => row.domain, footer: 'Total' },
      { key: 'pl', header: "Players' P/L", cell: row => money(row.pl), footer: money(rows.reduce((sum, row) => sum + row.pl, 0)) },
      { key: 'shareRate', header: 'Share Rate', cell: row => `${(row.shareRate ?? 0).toFixed(2)}%`, footer: '-' },
      { key: 'share', header: 'Agent Share', cell: row => <strong className={shareTone(row.share)}>{money(row.share)}</strong>, footer: <span className={shareTone(shareTotal)}>{money(shareTotal)}</span> },
      { key: 'cutPercentage', header: 'Cut Rate', cell: row => `${(row.cutPercentage ?? 0).toFixed(2)}%`, footer: '-' },
      { key: 'cutAmount', header: 'Platform Cut', cell: row => money(row.cutAmount), footer: money(rows.reduce((sum, row) => sum + row.cutAmount, 0)) },
      { key: 'contribution', header: 'Contribution %', cell: row => `${(totalPL > 0 ? Math.abs(row.pl) / totalPL * 100 : 0).toFixed(1)}%`, footer: '100%' },
    ];
    return <Card title={<span className={styles.inline}><IconChartBar size={18} aria-hidden="true" />Domain Breakdown</span>} body="table"><DataTable label="Domain Breakdown" rows={rows} columns={columns} rowKey={row => row.key} pagination={false} empty="No domain data available" /></Card>;
  }
  if (!isAgent && pendingSettlements) {
    const rows = aggregateSettlementDomains(pendingSettlements); const totalAbsPL = rows.reduce((sum, row) => sum + Math.abs(row.pl), 0);
    const help = <span><strong>Platform Cut</strong> is the part of the players' P/L the platform keeps after the agent's share.<br /><br />For each agent: Cut = |Players' P/L| − |Agent share|. This column sums that cut across all agents with pending settlements for the domain.</span>;
    const columns: DataTableColumn<(typeof rows)[number]>[] = [
      { key: 'domain', header: 'Domain', cell: row => row.domain },
      { key: 'pl', header: "Players' P/L", cell: row => money(row.pl) },
      { key: 'share', header: 'Agent Share', cell: row => <strong className={row.share > 0 ? styles.positive : row.share < 0 ? styles.negative : undefined}>{money(row.share)}</strong> },
      { key: 'cutAmount', header: <span className={styles.row}>Platform Cut<Tooltip content={help}><IconButton label="About Platform Cut" size="sm" icon={<IconInfoCircle size={16} />} /></Tooltip></span>, cell: row => money(row.cutAmount) },
      { key: 'count', header: 'Agent Count', cell: row => row.count },
      { key: 'contribution', header: 'Contribution %', cell: row => `${(totalAbsPL > 0 ? Math.abs(row.pl ?? 0) / totalAbsPL * 100 : 0).toFixed(1)}%` },
    ];
    return <Card title={<span className={styles.inline}><IconChartBar size={18} aria-hidden="true" />Domain Breakdown (Aggregate)</span>} sub="Per-domain totals from pending settlements. Players' P/L: negative = players lost. Agent Share: positive = the agents earn. Platform Cut: what the platform keeps (|P/L| − |agent share|), summed across agents." body="table"><DataTable label="Domain Breakdown (Aggregate)" rows={rows} columns={columns} rowKey={row => row.key} pagination={false} empty="No domain data available" /></Card>;
  }
  return <Card title="Domain Breakdown"><EmptyState title="No domain breakdown data available" /></Card>;
}
