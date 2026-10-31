import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, gql } from '@apollo/client'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { Page } from '@/ui/components/Page'
import { Button } from '@/ui/components/Button'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { AgentSummaryHeader } from './components/AgentSummaryHeader'
import type { ProfileStatsPeriod } from './components/AgentKpiGrid'
import { OverviewTab } from './components/OverviewTab'
import { CreditTab } from './components/CreditTab'
import { SharingTab } from './components/SharingTab'
import { CommissionTab } from './components/CommissionTab'
import { SettlementTab } from './components/SettlementTab'
import { PlayersTab } from './components/PlayersTab'
import { SubAgentsTab } from './components/SubAgentsTab'
import { AgentSecurityAuditTab } from './components/AgentSecurityAuditTab'
import { ReferralLinkTab } from './components/ReferralLinkTab'
import { profileStatsRange, type ProfileAgent, type ProfileStats } from './components/agentProfileModel'
import styles from './AgentProfilePage.module.css'

const SUB_AGENTS_COUNT_QUERY = gql`
  query SubAgentsCount($rootId: ID!) { agents { agentTree(rootId: $rootId) { id } } }
`

const AGENT_PROFILE_QUERY = gql`
  query AgentProfile($id: ID!) {
    agents {
      agentProfile(id: $id) {
        id
        tenantId
        username
        phone
        schemeType
        allowedDomains
        status
        parentAgentId
        levelIndex
        tallyEnabled
        tallyDomains
        commissionRates {
          domain
          rate
        }
        sharingRates {
          domain
          rate
        }
        creditLimit
        creditUsed
        creditAvailable
        creditAlertThreshold
        createdAt
      }
    }
  }
`

const AGENT_STATS_QUERY = gql`
  query AgentDashboardStats($id: ID!, $dateFrom: String, $dateTo: String) {
    agents {
      agentDashboardStats(agentId: $id, dateFrom: $dateFrom, dateTo: $dateTo) {
        totalPlayers
        activePlayers24h
        newPlayersToday
        pendingDeposits
        pendingDepositsAmount
        pendingWithdrawals
        pendingWithdrawalsAmount
        totalDeposits
        totalWithdrawals
        directDeposits
        directWithdrawals
        manualDeposits
        manualWithdrawals
        ggr
        profitLoss
        ggrByWalletType {
          cash
          bonus
          referralBonus
        }
        plByWalletType {
          cash
          bonus
          referralBonus
        }
        directPlayerCount
        subAgentPlayerCount
        totalSubAgents
        totalDownlineBalance
        totalDownlineExposure
        sportsGgr
        sportsPl
        casinoGgr
        casinoPl
        matkaGgr
        matkaPl
      }
    }
  }
`

export default function AgentProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  return <RBACGuard required={[{ domain: 'agents.profile', actions: ['view'] }]} bypassForAgents fallback={<Page><Notice tone="warn" title="Access Denied">You don't have permission to view agent profiles. Please contact your administrator.<Button onClick={() => navigate('/agents')}>Back to Agents</Button></Notice></Page>}>
    <AgentProfileContent key={id} />
  </RBACGuard>
}

function AgentProfileContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // ?tab= opens a tab directly (the Pay dialog's "Review adjustments" link sends ?tab=commission); a tab the
  // agent does not have falls back to Overview through selectedTab below.
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'overview')

  // The Overview's stats period. It lives here, not in the Overview, so it survives a trip to another tab.
  const [statsPeriod, setStatsPeriod] = useState<ProfileStatsPeriod>(() => ({ preset: 'today', ...profileStatsRange('today') }))
  const statsDateFrom = statsPeriod.from
  const statsDateTo = statsPeriod.to

  const { data, loading, error, refetch: refetchProfile } = useQuery<{ agents: { agentProfile: ProfileAgent | null } }>(AGENT_PROFILE_QUERY, {
    variables: { id },
    errorPolicy: 'all',
    skip: !id,
  })

  const { data: statsData, previousData: previousStatsData, loading: statsLoading, error: statsError, refetch: refetchStats } = useQuery<{ agents: { agentDashboardStats: ProfileStats | null } }>(AGENT_STATS_QUERY, {
    variables: { id, dateFrom: statsDateFrom, dateTo: statsDateTo },
    errorPolicy: 'all',
    skip: !id,
    fetchPolicy: 'cache-and-network',
  })

  const agent = data?.agents?.agentProfile
  // Keep the visible filter controls and previous metrics stable while a new period loads.
  const agentStats = (statsData || previousStatsData)?.agents?.agentDashboardStats

  const { data: subAgentsCountData } = useQuery<{ agents: { agentTree: { id: string }[] } }>(SUB_AGENTS_COUNT_QUERY, {
    variables: { rootId: id },
    skip: !id || !agent || agent.schemeType !== 'COMMISSION',
    fetchPolicy: 'cache-and-network',
  })
  const subAgentsCount = subAgentsCountData?.agents?.agentTree?.length ?? 0

  const choosePreset = (preset: string) => {
    if (preset === 'custom') {
      // A custom range starts as the last 30 days and is then edited date by date.
      const { from, to } = profileStatsRange('30d')
      setStatsPeriod({ preset: 'custom', from, to })
    } else setStatsPeriod({ preset, ...profileStatsRange(preset) })
  }
  const chooseCustom = (from: string | null, to: string | null) => {
    setStatsPeriod(from && to ? { preset: 'custom', from, to } : { preset: 'all_time', from: null, to: null })
  }

  const agentWithStats = agent ? { ...agent, stats: agentStats } : null

  const reload = () => { void refetchProfile(); void refetchStats() }
  const back = <Button onClick={() => navigate('/agents')}>Back to Agents</Button>
  if (!id) return <Page><Notice tone="error" title="Invalid Agent">No agent ID provided{back}</Notice></Page>
  if (loading) return (<Page><LoadingState label="Loading agent profile" /></Page>)
  if (error || !agentWithStats) return (<Page><Notice tone="error" title="Error loading agent profile" action={<div className={styles.actions}>{back}<Button onClick={reload}>Retry</Button></div>}>{error?.message || 'Agent not found'}</Notice></Page>)
  // In the order of the 2026-10-28 redesign: the money tabs of the agent's scheme, its network, then its records.
  const scheme = agentWithStats.schemeType
  const tabs: TabItem<string>[] = [
    { value: 'overview', label: 'Overview' },
    ...(scheme === 'COMMISSION' ? [{ value: 'commission', label: 'Commission' }] : []),
    ...(['SHARING', 'CREDIT'].includes(scheme) ? [{ value: 'settlement', label: 'Settlement' }] : []),
    ...(scheme === 'CREDIT' ? [{ value: 'credit', label: 'Credit' }] : scheme === 'SHARING' ? [{ value: 'sharing', label: 'Sharing' }] : []),
    { value: 'players', label: 'Players', count: typeof agentStats?.totalPlayers === 'number' ? agentStats.totalPlayers : undefined },
    ...(scheme === 'COMMISSION' && subAgentsCount > 0 ? [{ value: 'sub-agents', label: 'Sub-Agents', count: subAgentsCount }] : []),
    ...(scheme === 'COMMISSION' ? [{ value: 'referral-link', label: 'Referral Link' }] : []),
    { value: 'activity-log', label: 'Activity Log' },
  ]
  // Hairlines between the mockup's groups: the overview, the money and network tabs, then the records.
  const firstRecord = tabs.findIndex(tab => tab.value === 'referral-link' || tab.value === 'activity-log')
  const tabItems = tabs.map((tab, index) => index === 1 || index === firstRecord ? { ...tab, divider: true } : tab)
  const selectedTab = tabs.some(tab => tab.value === activeTab) ? activeTab : 'overview'
  return (<Page maxWidth="wide"><div className={styles.stack}>
    <AgentSummaryHeader agent={agentWithStats} stats={agentStats} onRefetch={reload} onTabChange={setActiveTab} />
    {/* The head's strip reads the stats too, so their failure shows above every tab. */}
    {statsError && <Notice title="Agent stats unavailable" tone="error" action={<Button onClick={() => void refetchStats()}>Retry stats</Button>}>{statsError.message}</Notice>}
    <div className={styles.tabs}><Tabs value={selectedTab} items={tabItems} label="Agent profile tabs" idPrefix="agent-profile" onChange={setActiveTab} variant="line" /></div>
    <div className={styles.panel} role="tabpanel" id={tabPanelId('agent-profile', selectedTab)} aria-labelledby={tabId('agent-profile', selectedTab)}>
      {selectedTab === 'overview' && <OverviewTab agent={agentWithStats} stats={agentStats} statsLoading={statsLoading} statsFailed={Boolean(statsError)} period={statsPeriod} onPresetChange={choosePreset} onCustomRange={chooseCustom} onRetryStats={() => void refetchStats()} onTabChange={setActiveTab} hasSubAgents={subAgentsCount > 0} />}
      {selectedTab === 'settlement' && <SettlementTab agentId={agentWithStats.id} agent={agentWithStats} />}
      {selectedTab === 'credit' && <CreditTab agentId={agentWithStats.id} agent={agentWithStats} />}
      {selectedTab === 'sharing' && <SharingTab agentId={agentWithStats.id} agent={agentWithStats} />}
      {selectedTab === 'commission' && <CommissionTab agentId={agentWithStats.id} agent={agentWithStats} />}
      {selectedTab === 'referral-link' && <ReferralLinkTab agentId={agentWithStats.id} agentUsername={agentWithStats.username || ''} />}
      {selectedTab === 'activity-log' && <AgentSecurityAuditTab agentId={String(agentWithStats.id)} />}
      {selectedTab === 'players' && <PlayersTab agentId={agentWithStats.id} />}
      {selectedTab === 'sub-agents' && <SubAgentsTab agentId={agentWithStats.id} />}
    </div>
  </div></Page>)
}

