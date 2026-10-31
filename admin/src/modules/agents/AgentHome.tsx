import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { IconCoin, IconUsers, IconTrendingUp, IconPlus, IconBuildingBank, IconChartBar, IconRefresh } from '@tabler/icons-react'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { AGENT_DASHBOARD_STATS_QUERY } from '@/lib/graphql/agents'
import { useAgentKPIs } from '@/modules/reporting/hooks'
import { DashboardDateRangePicker, type AgentDashboardDateRangeApplyPayload } from '@/routes/overview/components/DateRangePicker'
import { getDateRangeISOForAgentDashboardPreset, type AgentDashboardDatePreset } from '@/shared/utils/agentDashboardDateRange'
import { istDayOf } from '@/ui/components/istDate'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { Tabs } from '@/ui/components/Tabs'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import CreditMeter from './components/CreditMeter'
import FinancialSummary from './components/FinancialSummary'
import PerformanceCharts from './components/PerformanceCharts'
import SubAgentPerformance from './components/SubAgentPerformance'
import AgentAlerts from './components/AgentAlerts'
import PlayerQuickView from './components/PlayerQuickView'
import ReportingQuickAccess from './components/ReportingQuickAccess'
import { rawAmount } from './agentHomeModel'
import styles from './AgentHome.module.css'

export default function AgentHome() {
  const navigate = useNavigate()
  const { formatAmount, convertFromWhitelabelCurrency, getWhitelabelBaseCurrencyCode } = useCurrency()
  const agent = useAuthStore(s => s.agent)
  const canCreateSubAgent = !agent || agent.schemeType === 'COMMISSION' || agent.levelIndex == null || (agent.levelIndex as number) < 4

  const initialToday = getDateRangeISOForAgentDashboardPreset('today')
  const [appliedPreset, setAppliedPreset] = useState<AgentDashboardDatePreset>('today')
  const [dateFromIso, setDateFromIso] = useState(initialToday.dateFrom)
  const [dateToIso, setDateToIso] = useState(initialToday.dateTo)
  const [activeTab, setActiveTab] = useState<'overview' | 'financial'>('overview')

  const periodFrom = istDayOf(dateFromIso)
  const periodTo = istDayOf(dateToIso)

  const handlePeriodApply = (p: AgentDashboardDateRangeApplyPayload) => {
    if (p.kind === 'preset') {
      const r = getDateRangeISOForAgentDashboardPreset(p.preset)
      setAppliedPreset(p.preset)
      setDateFromIso(r.dateFrom)
      setDateToIso(r.dateTo)
    } else {
      setAppliedPreset('custom')
      setDateFromIso(p.dateFrom)
      setDateToIso(p.dateTo)
    }
  }

  const handlePeriodReset = () => {
    const r = getDateRangeISOForAgentDashboardPreset('today')
    setAppliedPreset('today')
    setDateFromIso(r.dateFrom)
    setDateToIso(r.dateTo)
  }

  // Fetch agent Dashboard Stats (players, deposits, etc.) — date filter applies to deposits/withdrawals
  const { data: statsData, loading: statsLoading, error: statsError } = useQuery(AGENT_DASHBOARD_STATS_QUERY, {
    variables: {
      agentId: agent?.id,
      dateFrom: periodFrom || undefined,
      dateTo: periodTo || undefined,
    },
    skip: !agent?.id,
  })

  // Period-based GGR (same source as GGR Trends chart) for Total GGR card
  const { data: kpisData, loading: kpisLoading } = useAgentKPIs({
    dateFrom: periodFrom,
    dateTo: periodTo,
  })
  const periodGGR = kpisData?.agentKPIs?.totalGGR ?? 0

  if (!agent) return <Page maxWidth="wide" className={styles.page}><Notice tone="error" title="Not Authenticated">Please log in as an agent to access this dashboard.</Notice></Page>
  const stats = statsData?.agents?.agentDashboardStats
  const isCreditAgent = agent.schemeType === 'CREDIT'
  const isCommissionAgent = agent.schemeType === 'COMMISSION'
  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const metricRows = [
    { label: 'Total GGR', value: fmt(periodGGR), raw: periodGGR, note: 'Gross Gaming Revenue', icon: <IconCoin size={20} />, hue: 'grn' as const, to: '/reporting/agents/performance' },
    { label: 'Total Players', value: stats?.totalPlayers?.toLocaleString() || '0', raw: stats?.totalPlayers || 0, note: 'All registered', icon: <IconUsers size={20} />, hue: 'blu' as const, to: '/players' },
    { label: 'Active Players', value: stats?.activePlayers24h?.toLocaleString() || '0', raw: stats?.activePlayers24h || 0, note: 'Active in 24h', icon: <IconTrendingUp size={20} />, hue: 'grn' as const, to: '/reporting/players/activity' },
    { label: 'New Players', value: stats?.newPlayersToday?.toLocaleString() || '0', raw: stats?.newPlayersToday || 0, note: 'Today', icon: <IconPlus size={20} />, hue: 'vio' as const, to: '/reporting/players/activity' },
    { label: 'Total Deposits', value: fmt(stats?.totalDeposits ?? 0), raw: stats?.totalDeposits || 0, note: 'Incoming funds', icon: <IconCoin size={20} />, hue: 'blu' as const, to: '/reporting/agents/performance' },
    { label: 'Total Withdrawals', value: fmt(stats?.totalWithdrawals ?? 0), raw: stats?.totalWithdrawals || 0, note: 'Outgoing funds', icon: <IconCoin size={20} />, hue: 'red' as const, to: '/reporting/agents/performance' },
    { label: 'Pending Deposits', value: fmt(stats?.pendingDeposits ?? 0), raw: stats?.pendingDeposits || 0, note: 'Awaiting approval', icon: <IconBuildingBank size={20} />, hue: 'amb' as const, to: '/players' },
    { label: 'Pending Withdrawals', value: fmt(stats?.pendingWithdrawals ?? 0), raw: stats?.pendingWithdrawals || 0, note: 'Awaiting approval', icon: <IconBuildingBank size={20} />, hue: 'amb' as const, to: '/players' },
  ]
  const overview = <div className={styles.stack}>
    <div className={styles.kpis}>{metricRows.map(m => <Stat key={m.label} className={styles.stat} label={m.label} value={m.value} note={m.note} icon={m.icon} hue={m.hue} />)}</div>
    {isCreditAgent && <CreditMeter agentId={agent.id} />}
    {isCreditAgent && <AgentAlerts agentId={agent.id} />}
    <section className={styles.stack} aria-label="Performance Analytics">
      <h2>Performance Analytics</h2>
      <PerformanceCharts agentId={agent.id} periodFrom={periodFrom} periodTo={periodTo} />
    </section>
  </div>
  const financial = <div className={styles.stack}>
    <section className={styles.stack} aria-label="Financial Summary"><h2>Financial Summary</h2><FinancialSummary agentId={agent.id} periodFrom={periodFrom} periodTo={periodTo} schemeType={agent.schemeType as 'COMMISSION' | 'SHARING' | 'CREDIT'} /></section>
    <Button variant="primary" icon={<IconCoin size={16} />} onClick={() => navigate(isCommissionAgent ? '/commission/overview' : '/settlement/overview')}>View Detailed {isCommissionAgent ? 'Commission' : 'Settlement'} Report</Button>
  </div>
  // Preserved dormant tab definitions: the production page still exposes only Overview and Financial.
  // Keeping these business widgets and destinations does not grant or expose new actions.
  const _tabItems = [
    { key: 'overview', label: 'Overview', children: <div className={styles.stack}>
      {isCreditAgent && <CreditMeter agentId={agent.id} />}
      <div className={styles.kpis}>{metricRows.map((m, i) => <Card key={m.label}><div className={styles.stack}><Stat variant="bare" label={i === 3 ? 'New Players Today' : m.label} value={i === 0 || i >= 4 ? `${rawAmount(m.raw, '')} ${getWhitelabelBaseCurrencyCode()}` : m.raw} note={m.note} /><Button size="sm" onClick={() => navigate(m.to)}>View report</Button></div></Card>)}</div>
      {isCreditAgent && <AgentAlerts agentId={agent.id} />}
      <PerformanceCharts agentId={agent.id} periodFrom={periodFrom} periodTo={periodTo} />
    </div> },
    { key: 'financial', label: 'Financial', children: financial },
    { key: 'players', label: 'Players', children: <div className={styles.stack}><PlayerQuickView agentId={agent.id} /><div className={styles.actions}><Button variant="primary" onClick={() => navigate('/players')}>Manage All Players</Button><Button onClick={() => navigate('/players/create')}>Create New Player</Button></div></div> },
    { key: 'subagents', label: 'Sub-Agents', children: isCommissionAgent ? <Card title="Manage sub-agents and commission" sub="View hierarchy, create sub-agents, and pay commission from the Commission dashboard."><div className={styles.actions}><Button variant="primary" onClick={() => navigate('/agents')}>View Agents</Button><Button onClick={() => navigate('/commission/overview')}>Sub-Agent Commission</Button>{canCreateSubAgent && <Button onClick={() => navigate('/agent/create')}>Create Sub-Agent</Button>}</div></Card> : <div className={styles.stack}><SubAgentPerformance agentId={agent.id} periodFrom={periodFrom} periodTo={periodTo} /><Button variant="primary" onClick={() => navigate('/agents/hierarchy')}>Manage Hierarchy</Button></div> },
    { key: 'reports', label: 'Reports', children: <ReportingQuickAccess agentId={agent.id} /> },
  ]
  void _tabItems
  // Preserve the original real refresh: a page reload, not an unconnected simulated action.
  const handleRefresh = () => window.location.reload()
  return <Page maxWidth="wide" className={styles.page}>
    <PageHeader title="Agent Dashboard" eyebrow="Agent workspace" sub={`Welcome back, ${agent.username || 'Agent'}! Here's your performance overview.`} />
    <div className={styles.actions}><DashboardDateRangePicker mode="controlled" presetVariant="agent" appliedPreset={appliedPreset} dateFrom={dateFromIso} dateTo={dateToIso} onApply={handlePeriodApply} onReset={handlePeriodReset} /><Button size="sm" icon={<IconRefresh size={16} />} onClick={handleRefresh}>Refresh</Button></div>
    {statsError && <Notice tone="error" title="Error Loading Data">{statsError.message}</Notice>}
    <div className={styles.tabRail}><Tabs value={activeTab} onChange={setActiveTab} label="Agent Dashboard" idPrefix="agent-dashboard" items={[{ value: 'overview', label: 'Overview', icon: <IconChartBar size={16} /> }, { value: 'financial', label: 'Financial', icon: <IconCoin size={16} /> }]} /></div>
    <div role="tabpanel" id={`agent-dashboard-panel-${activeTab}`} aria-labelledby={`agent-dashboard-tab-${activeTab}`} aria-busy={statsLoading || kpisLoading}>{activeTab === 'overview' ? overview : financial}</div>
  </Page>
}
