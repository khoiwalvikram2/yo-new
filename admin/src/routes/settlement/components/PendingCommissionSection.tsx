import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useQuery } from '@apollo/client';
import { IconCash, IconCalendar, IconDownload } from '@tabler/icons-react';
import { useTableExport } from '@/shared/hooks/useTableExport';
import type { TableExportColumn } from '@/shared/utils/tableExport';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { WHITELABEL_COMMISSION_SUMMARIES_QUERY, CURRENT_COMMISSION_CYCLE_QUERY } from '@/lib/graphql/settlements';
import { COMMISSION_SUMMARY_QUERY } from '@/lib/graphql/agents';
import { CommissionViewBetsModal, type CommissionViewBetsParams } from '@/routes/commission/components/CommissionViewBetsModal';
import { CommissionCyclePayDialog } from '@/routes/commission/components/CommissionCyclePayDialog';
import { commissionCycleWeeks } from '@/routes/commission/commissionOverviewModel';
import dayjs from 'dayjs';
import { nowIST } from '@/shared/utils/date';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { LoadingState } from '@/ui/components/LoadingState';
import { Skeleton } from '@/ui/components/Skeleton';
import { EmptyState } from '@/ui/components/EmptyState';
import { StatusPill } from '@/ui/components/StatusPill';
import { DescriptionList } from '@/ui/components/DescriptionList';
import { SegmentedControl } from '@/ui/components/SegmentedControl';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { useSettlementTable, type CommissionSummary } from '../settlementModel';
import styles from '../SettlementCenter.module.css';

type PeriodTab = 'currentWeek' | 'lastWeek' | 'allTime';
type PayTarget = { agentId: string; username: string | null };
type CurrentCycle = { from?: string | null; to?: string | null; fromDate?: string | null; toDate?: string | null; previousFromDate?: string | null; previousToDate?: string | null };
const domains = ['sports', 'casino', 'matka'] as const;
const domainName = (domain: string) => domain.charAt(0).toUpperCase() + domain.slice(1);

export function PendingCommissionSection() {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const [periodTab, setPeriodTab] = useState<PeriodTab>('currentWeek');
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [viewBetsOpen, setViewBetsOpen] = useState(false);
  const [viewBetsParams, setViewBetsParams] = useState<CommissionViewBetsParams | null>(null);
  const formatCurrency = (amount: number) => formatAmount(convertFromWhitelabelCurrency(amount));
  const { data: cycleData } = useQuery<{ currentCommissionCycle?: CurrentCycle }>(CURRENT_COMMISSION_CYCLE_QUERY, { fetchPolicy: 'cache-and-network' });
  // The open and the last closed IST weeks come from the backend; the browser does no week maths.
  const { currentFrom, currentTo, lastFrom: lastWeekFrom, lastTo: lastWeekTo } = commissionCycleWeeks(cycleData?.currentCommissionCycle);
  const allTimeTo = nowIST().add(1, 'day').format('YYYY-MM-DD');
  const periodDates = useMemo(() => {
    if (periodTab === 'currentWeek') return { from: currentFrom, to: currentTo };
    if (periodTab === 'lastWeek') return { from: lastWeekFrom, to: lastWeekTo };
    return { from: '2000-01-01', to: allTimeTo };
  }, [periodTab, currentFrom, currentTo, lastWeekFrom, lastWeekTo, allTimeTo]);
  const { data: summariesData, loading: summariesLoading, error: summariesError } = useQuery<{ whitelabelCommissionSummaries?: CommissionSummary[] }>(WHITELABEL_COMMISSION_SUMMARIES_QUERY, {
    variables: { periodFrom: periodDates.from, periodTo: periodDates.to }, skip: !periodDates.from || !periodDates.to, fetchPolicy: 'cache-and-network',
  });
  const summaries = summariesData?.whitelabelCommissionSummaries ?? [];
  const initialSummariesLoading = !periodDates.from || !periodDates.to || (summariesLoading && !summariesData);
  const fmtRange = (from: string, to: string) => `${dayjs(from).format('DD MMM')} – ${dayjs(to).subtract(1, 'day').format('DD MMM')}`;
  const currentWeekLabel = currentFrom && currentTo ? fmtRange(currentFrom, currentTo) : null;
  const lastWeekLabel = lastWeekFrom && lastWeekTo ? fmtRange(lastWeekFrom, lastWeekTo) : null;
  const cycleLabel = periodTab === 'allTime' ? 'All time' : periodTab === 'currentWeek' && currentWeekLabel ? currentWeekLabel : periodTab === 'lastWeek' && lastWeekLabel ? lastWeekLabel : periodDates.from && periodDates.to ? fmtRange(periodDates.from, periodDates.to) : 'Loading commission cycle?';
  // Pay opens a picker of the agent's closed, unpaid weeks: the current week and all-time are never paid.
  const handlePayClick = (record: CommissionSummary) => { setPayTarget({ agentId: record.agentId, username: record.username }); };
  const commissionExportColumns: TableExportColumn<CommissionSummary>[] = useMemo(() => [
    { header: 'Agent', key: 'username', width: 18, getter: row => row.username ?? row.agentId ?? '—' },
    { header: 'Pending', key: 'pendingCommission', width: 14, getter: row => row.pendingCommission != null ? Number(row.pendingCommission) : null },
    { header: 'Total Paid', key: 'totalPaid', width: 14, getter: row => row.totalPaid != null ? Number(row.totalPaid) : null },
    { header: 'Last Paid', key: 'lastPaidAt', width: 14, getter: row => row.lastPaidAt ?? '' },
  ], []);
  const { exporting, handleExport } = useTableExport({ data: summaries, columns: commissionExportColumns, filename: 'Pending-Commission-Agents', sheetName: 'Commission Agents', title: `Commission Agents — ${summaries.length} agent(s)` });
  const columns: DataTableColumn<CommissionSummary>[] = [
    { key: 'agent', header: 'Agent', cell: row => <div className={styles.cellStack}><Link to={`/agents/${row.agentId}`} className={clsx(styles.emphasis, styles.profileLink)}>{row.username || row.agentId || '—'}</Link><StatusPill tone="ok">COMMISSION</StatusPill></div> },
    { key: 'cycle', header: 'Cycle', cell: () => <span className={styles.inline}><IconCalendar size={14} aria-hidden="true" />{cycleLabel}</span> },
    { key: 'pendingCommission', header: 'Pending', cell: row => <strong className={Number(row.pendingCommission ?? 0) > 0 ? styles.positive : styles.muted}>{formatCurrency(Number(row.pendingCommission ?? 0))}</strong> },
    { key: 'totalPaid', header: 'Total Paid', cell: row => formatCurrency(Number(row.totalPaid ?? 0)) },
    { key: 'lastPaidAt', header: 'Last Paid', cell: row => row.lastPaidAt ? dayjs(row.lastPaidAt).format('DD MMM YYYY') : '—' },
    { key: 'actions', header: 'Actions', cell: row => <Button variant="primary" size="sm" icon={<IconCash size={15} />} onClick={() => handlePayClick(row)} disabled={!(row.pendingCommission > 0.01)}>Pay Commission</Button> },
  ];
  const table = useSettlementTable(summaries, columns, 10);
  const toggle = (key: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <div className={styles.stack}>
    <div className={styles.periodScroll}><SegmentedControl label="Period tabs" value={periodTab} onChange={value => setPeriodTab(value || 'currentWeek')} options={[
      { value: 'currentWeek', label: `Current Week${currentWeekLabel ? ` (${currentWeekLabel})` : ''}`, icon: <IconCalendar size={15} /> },
      { value: 'lastWeek', label: `Last Week${lastWeekLabel ? ` (${lastWeekLabel})` : ''}`, icon: <IconCalendar size={15} /> },
      { value: 'allTime', label: 'All time', icon: <IconCalendar size={15} /> },
    ]} /></div>
    <Card title="Commission Agents" sub={cycleLabel} body={initialSummariesLoading || summariesError || summaries.length === 0 ? 'padded' : 'table'} tools={<div className={styles.tools}>{summaries.length > 0 && <StatusPill>{summaries.length} agent{summaries.length !== 1 ? 's' : ''}</StatusPill>}<Button size="sm" icon={<IconDownload size={16} />} loading={exporting} onClick={() => void handleExport()} disabled={!summaries.length || summariesLoading}>Export</Button></div>}>
      {initialSummariesLoading ? <LoadingState label="Loading commission summaries…" /> : summariesError ? <EmptyState title={summariesError.message || 'Failed to load commission summaries'} /> : summaries.length === 0 ? <EmptyState title="No commission agents with pending amount for this period" /> : <DataTable label="Commission Agents" columns={columns} {...table} rowKey={row => row.agentId} expandable={{ expanded, onToggle: toggle, render: row => periodDates.from && periodDates.to ? <ExpandedDetail agentId={row.agentId} periodFrom={periodDates.from} periodTo={periodDates.to} formatCurrency={formatCurrency} /> : null }} />}
    </Card>
    <CommissionCyclePayDialog open={payTarget != null} agentId={payTarget?.agentId} username={payTarget?.username ?? null} onClose={() => setPayTarget(null)}
      refetchQueries={[{ query: WHITELABEL_COMMISSION_SUMMARIES_QUERY, variables: { periodFrom: periodDates.from, periodTo: periodDates.to } }]}
      onViewBets={cycle => { if (payTarget) { setViewBetsParams({ agentId: payTarget.agentId, username: payTarget.username, cycleFrom: cycle.periodFrom, cycleTo: cycle.periodTo, activeCycleKey: cycle.from }); setViewBetsOpen(true); } }} />
    <CommissionViewBetsModal open={viewBetsOpen} onClose={() => { setViewBetsOpen(false); setViewBetsParams(null); }} params={viewBetsParams} />
  </div>;
}
function DomainSummary({ summary, formatCurrency, showMissingRate = false, pending = false }: { summary?: CommissionSummary; formatCurrency: (amount: number) => string; showMissingRate?: boolean; pending?: boolean }) {
  const figure = (value: string) => pending ? <Skeleton width={64} height={10} /> : value;
  return <div className={styles.triple}>{domains.map(domain => { const rate = summary?.[`${domain}CommissionRate`]; return <section className={styles.details} key={domain} aria-label={`${domainName(domain)} commission`}><h3 className={styles.sectionTitle}>{domainName(domain)}</h3><DescriptionList labelWidth={96} items={[
    { term: 'GGR', value: figure(formatCurrency(Number(summary?.[`${domain}GGR`] ?? 0))) },
    { term: 'Commission', value: figure(formatCurrency(Number(summary?.[`${domain}Commission`] ?? 0))) },
    ...(rate != null || showMissingRate || pending ? [{ term: 'Rate', value: figure(`${(Number(rate ?? 0) * 100).toFixed(2)}%`), note: true }] : []),
  ]} /></section>; })}</div>;
}
function ExpandedDetail({ agentId, periodFrom, periodTo, formatCurrency }: { agentId: string; periodFrom: string; periodTo: string; formatCurrency: (amount: number) => string }) {
  const { data, loading } = useQuery<{ agents?: { commissionSummary?: CommissionSummary } }>(COMMISSION_SUMMARY_QUERY, { variables: { agentId, periodFrom, periodTo }, skip: !agentId || !periodFrom || !periodTo, fetchPolicy: 'cache-and-network' });
  const summary = data?.agents?.commissionSummary;
  // Until the first answer the breakdown keeps its rows, with placeholders for the figures.
  if (loading && !summary) return <div className={styles.stack} aria-busy="true"><div className={styles.row}><span>Effective total: <Skeleton width={72} height={10} /></span></div><DomainSummary formatCurrency={formatCurrency} pending /></div>;
  if (!summary) return <span className={styles.muted}>No summary for this period.</span>;
  return <div className={styles.stack}><div className={styles.row}><span>Effective total: <strong className={styles.positive}>{formatCurrency(summary.effectiveCalculatedTotal ?? 0)}</strong></span>{summary.tallyApplied?.enabled && <StatusPill tone="info">Tally: {summary.tallyApplied.domains?.join(', ') ?? 'on'}</StatusPill>}</div><DomainSummary summary={summary} formatCurrency={formatCurrency} /></div>;
}
