import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { IconCash, IconUsers, IconCreditCard, IconTrendingUp, IconCalendar, IconChartPie, IconChartBar, IconChartLine } from '@tabler/icons-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, LineChart, Line, Legend, CartesianGrid } from 'recharts';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { Card } from '@/ui/components/Card';
import { Stat } from '@/ui/components/Stat';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { Notice } from '@/ui/components/Notice';
import { agentDirectionLabel, hasPendingAmount, settlementDirectionOf, sharingDashboardSplit, type SettlementScheme, type SettlementDashboard, type SettlementSummary } from '../settlementModel';
import styles from '../SettlementCenter.module.css';

interface SettlementDashboardTabProps { isAgent: boolean; agentSchemeType?: SettlementScheme; dashboard?: SettlementDashboard | null; activityPeriodLabel?: string; settlement?: SettlementSummary | null; loading?: boolean; error?: Error | null }
const PENDING_HUES = ['chartBlue', 'chartViolet', 'chartPositive', 'chartWarning'] as const;
export function SettlementDashboardTab({ isAgent, agentSchemeType, dashboard, activityPeriodLabel, settlement, loading, error }: SettlementDashboardTabProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDateTime } = useFormatDate();
  const navigate = useNavigate();
  const formatCurrency = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  // Until the first answer the stat cards hold their own height with placeholders.
  const loadingFigures = Boolean(loading) && !(isAgent ? settlement : dashboard);
  if (error && !loadingFigures) return <Notice title="Error loading settlement dashboard" tone="error">{error.message}</Notice>;
  if (isAgent) {
    if (agentSchemeType === 'COMMISSION') return <Card title="Dashboard"><div className={styles.stack}><p className={styles.note}>Commission agents manage earnings and payouts in the Commission section.</p><Button variant="primary" onClick={() => navigate('/commission/overview')}>Go to Commission</Button></div></Card>;
    const pending = convertFromWhitelabelCurrency(settlement?.settlementDue ?? 0);
    const isPositive = pending >= 0;
    // settlementDue positive = TO_AGENT (you receive from your upline), negative = FROM_AGENT (you pay): its size plus who pays.
    const pendingLabel = hasPendingAmount(settlement?.settlementDue) ? agentDirectionLabel(settlementDirectionOf(settlement?.settlementDirection, settlement?.settlementDue)) : 'Settled';
    return <div className={styles.stack}><div className={clsx(styles.metrics, styles.agentMetrics)} aria-busy={loadingFigures || undefined}>
      <Stat label="My Pending" value={formatCurrency(Math.abs(settlement?.settlementDue ?? 0))} note={`${pendingLabel} · since last settlement`} icon={<IconCash size={18} />} hue="ind" loading={loadingFigures} />
      <Stat label="Last Settlement" value={settlement?.lastSettlementDate ? formatDateTime(settlement.lastSettlementDate, 'MMM d, yyyy · hh:mm a') : 'Never'} icon={<IconCalendar size={18} />} hue="blu" loading={loadingFigures} />
      <Stat label="Share %" value={settlement?.sharePercentage != null ? `${settlement.sharePercentage.toFixed(1)}%` : '—'} icon={<IconTrendingUp size={18} />} hue="amb" loading={loadingFigures} />
      <Stat label="Net P&L" value={formatCurrency(settlement?.netPL ?? 0)} icon={<IconCash size={18} />} hue={isPositive ? 'grn' : 'red'} loading={loadingFigures} />
    </div><Card><div className={styles.row}><span className={styles.note}>View pending settlements or settlement history for details.</span><div className={styles.tools}><Button variant="link" onClick={() => navigate('/settlement?tab=pending')}>pending settlements</Button><Button variant="link" onClick={() => navigate('/settlement?tab=history')}>settlement history</Button></div></div></Card>
      {!settlement && !loadingFigures && <EmptyState title="No settlement summary available" />}
    </div>;
  }
  if (!dashboard && !loadingFigures) return <Card><EmptyState title="No settlement data available" /></Card>;
  const filteredActivity = Boolean(activityPeriodLabel);
  const totalSettled = Number(filteredActivity ? dashboard?.totalPaidToAgentsInPeriod ?? 0 : dashboard?.totalSettledThisMonth ?? 0);
  // Pending Sharing is NET (to pay − to collect) and can be negative, so the parts are shown on their own.
  const sharing = sharingDashboardSplit(dashboard);
  const sharingNote = `${Math.abs(sharing.net) < 0.005 ? 'Net settled' : sharing.net > 0 ? 'Net to pay' : 'Net to collect'} · To pay ${formatCurrency(sharing.toAgents)} · To collect ${formatCurrency(sharing.fromAgents)}`;
  // Each part is a size, so a negative net no longer drops Sharing out of the chart.
  const pieData = [
    { name: 'Sharing to pay', value: sharing.toAgents },
    { name: 'Sharing to collect', value: sharing.fromAgents },
    { name: 'Credit', value: Math.abs(Number(dashboard?.pendingCreditSettlements ?? 0) || 0) },
    { name: 'Commission', value: Math.abs(Number(dashboard?.pendingCommissionPayouts ?? 0) || 0) },
  ].filter(row => row.value > 0);
  const pieTotal = pieData.reduce((sum, row) => sum + row.value, 0);
  // Inputs are already in display currency; axes/tooltips below must not convert them twice.
  const domainChartData = dashboard?.domainBreakdown?.map(row => ({ name: row.domain.charAt(0).toUpperCase() + row.domain.slice(1), balance: convertFromWhitelabelCurrency(Number(row.settlementBalance ?? 0)) })) ?? [];
  const monthlyTrendData = dashboard?.monthlyTrend?.map(row => ({ month: row.month, settled: convertFromWhitelabelCurrency(Number(row.totalSettled ?? 0)), commission: convertFromWhitelabelCurrency(Number(row.commissionPaid ?? 0)) })) ?? [];
  const legend = <ul className={styles.legend}><li><span className={clsx(styles.marker, styles.chartBlue)} />Settled</li><li><span className={clsx(styles.marker, styles.chartPositive)} />Commission</li></ul>;
  const tooltip = (formatValue: (value: number) => string) => ({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ name?: string | number; value?: unknown }>; label?: unknown }) => active && payload?.length ? <div className={styles.chartTip}>{label != null && <strong>{String(label)}</strong>}{payload.map((row, index) => <span key={index}>{row.name}: {formatValue(Number(row.value))}</span>)}</div> : null;
  return <div className={styles.stack}>
    <div className={styles.metrics} aria-busy={loadingFigures || undefined}>
      <Stat label="Pending Sharing" value={formatCurrency(Math.abs(sharing.net))} note={sharingNote} icon={<IconUsers size={18} />} hue="blu" loading={loadingFigures} />
      <Stat label="Pending Credit" value={formatCurrency(Number(dashboard?.pendingCreditSettlements ?? 0))} icon={<IconCreditCard size={18} />} hue="vio" loading={loadingFigures} />
      <Stat label="Pending Commission" note="All unpaid weeks" value={formatCurrency(Number(dashboard?.pendingCommissionPayouts ?? 0))} icon={<IconCash size={18} />} hue="grn" loading={loadingFigures} />
      <Stat label={filteredActivity ? "Paid to Agents" : "Total Settled (This Month)"} value={formatCurrency(totalSettled)} note={filteredActivity ? activityPeriodLabel : "Paid and collected"} icon={<IconTrendingUp size={18} />} hue="ind" loading={loadingFigures} />
      <Stat label={filteredActivity ? "Collected from Agents" : "Total Settled (Last 30 Days)"} value={formatCurrency(Number(filteredActivity ? dashboard?.totalCollectedFromAgentsInPeriod ?? 0 : dashboard?.totalSettledLast30Days ?? 0))} note={filteredActivity ? activityPeriodLabel : "Paid and collected"} icon={<IconCalendar size={18} />} hue="blu" loading={loadingFigures} />
      <Stat label={filteredActivity ? "Commission Paid" : "Commission Paid (MTD)"} note={filteredActivity ? activityPeriodLabel : undefined} value={formatCurrency(Number(filteredActivity ? dashboard?.totalCommissionPaidInPeriod ?? 0 : dashboard?.totalCommissionPaidThisMonth ?? 0))} icon={<IconCash size={18} />} hue="amb" loading={loadingFigures} />
    </div>
    <div className={styles.split}>
      {pieData.length > 0 && <Card title={<span className={styles.inline}><IconChartPie size={18} aria-hidden="true" />Pending by type</span>}><div className={styles.chart}><ResponsiveContainer width="100%" height={256}><PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name">{pieData.map((_, index) => <Cell key={index} className={styles[PENDING_HUES[index % PENDING_HUES.length]]} />)}</Pie><Tooltip content={tooltip(formatCurrency)} /></PieChart></ResponsiveContainer><ul className={styles.legend}>{pieData.map((row, index) => <li key={row.name}><span className={clsx(styles.marker, styles[PENDING_HUES[index % PENDING_HUES.length]])} />{row.name} {((row.value / pieTotal) * 100).toFixed(0)}%</li>)}</ul></div></Card>}
      {domainChartData.length > 0 && <Card title={<span className={styles.inline}><IconChartBar size={18} aria-hidden="true" />Credit balance by domain</span>}><div className={styles.chart}>{domainChartData.every(row => row.balance === 0) ? <EmptyState title="No pending credit balance" /> : <ResponsiveContainer width="100%" height={256}><BarChart data={domainChartData} layout="vertical" margin={{ left: 50, right: 20 }}><XAxis type="number" tickFormatter={value => formatAmount(Number(value))} /><YAxis type="category" dataKey="name" width={70} /><Tooltip content={tooltip(formatAmount)} /><Bar dataKey="balance" name="Balance" radius={[0, 4, 4, 0]} className={styles.chartIndigo} /></BarChart></ResponsiveContainer>}</div></Card>}
    </div>
    {monthlyTrendData.length > 0 && <Card title={<span className={styles.inline}><IconChartLine size={18} aria-hidden="true" />Settled & Commission over time{filteredActivity ? ` · ${activityPeriodLabel}` : ''}</span>}><div className={styles.chart}><ResponsiveContainer width="100%" height={256}><LineChart data={monthlyTrendData} margin={{ left: 10, right: 10 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tickFormatter={value => formatAmount(Number(value))} tick={{ fontSize: 11 }} /><Tooltip content={tooltip(formatAmount)} /><Legend content={legend} /><Line type="monotone" dataKey="settled" name="Settled" className={styles.chartBlue} strokeWidth={2} dot={{ r: 3, className: styles.chartBlue }} /><Line type="monotone" dataKey="commission" name="Commission" className={styles.chartPositive} strokeWidth={2} dot={{ r: 3, className: styles.chartPositive }} /></LineChart></ResponsiveContainer></div></Card>}
  </div>;
}
