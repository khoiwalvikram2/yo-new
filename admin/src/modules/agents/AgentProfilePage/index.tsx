import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, gql } from '@apollo/client'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useChipAccount } from '@/modules/chips'
import { Page } from '@/ui/components/Page'
import { Button } from '@/ui/components/Button'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { AgentSummaryHeader } from './components/AgentSummaryHeader'
import type { ProfileStatsPeriod } from './components/AgentKpiGrid'
import { OverviewTab } from './components/OverviewTab'
import { ChipsTab } from './components/ChipsTab'
import { SharingTab } from './components/SharingTab'
import { CommissionTab } from './components/CommissionTab'
import { SettlementTab } from './components/SettlementTab'
import { PlayersTab } from './components/PlayersTab'
import { SubAgentsTab } from './components/SubAgentsTab'
import { AgentSecurityAuditTab } from './components/AgentSecurityAuditTab'
import { ReferralLinkTab } from './components/ReferralLinkTab'
import { profileStatsRange, type AgentRestriction, type ProfileAgent, type ProfileStats } from './components/agentProfileModel'
import styles from './AgentProfilePage.module.css'

const SUB_AGENTS_COUNT_QUERY = gql`
  query SubAgentsCount($rootId: ID!) { agents { agentTree(rootId: $rootId) { id } } }
`

/** COMMISSION and SHARING profiles list their sub-agents in a tab; a CREDIT agent's downline is in its Chips tab. */
const listsSubAgents = (scheme?: string) => scheme === 'COMMISSION' || scheme === 'SHARING'

// The ancestor whose status restricts the agent (a suspension cascades down the subtree, so its own status may
// still read Active). Asked apart from the profile, so the profile never fails on it.
const AGENT_RESTRICTION_QUERY = gql`
  query AgentRestriction($id: ID!) {
    agents {
      agentProfile(id: $id) {
        id
        blockedByAncestor {
          id
          username
          status
        }
      }
    }
  }
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

  const { data: restrictionData, loading: restrictionLoading, refetch: refetchRestriction } = useQuery<{ agents: { agentProfile: { id: string; blockedByAncestor?: AgentRestriction | null } | null } }>(AGENT_RESTRICTION_QUERY, {
    variables: { id },
    errorPolicy: 'all',
    skip: !id,
    fetchPolicy: 'cache-and-network',
  })
  const restriction = restrictionData?.agents?.agentProfile?.blockedByAncestor ?? null

  const agent = data?.agents?.agentProfile
  // Keep the visible filter controls and previous metrics stable while a new period loads.
  const agentStats = (statsData || previousStatsData)?.agents?.agentDashboardStats

  const { data: subAgentsCountData } = useQuery<{ agents: { agentTree: { id: string }[] } }>(SUB_AGENTS_COUNT_QUERY, {
    variables: { rootId: id },
    skip: !id || !agent || !listsSubAgents(agent.schemeType),
    fetchPolicy: 'cache-and-network',
  })
  const subAgentsCount = subAgentsCountData?.agents?.agentTree?.length ?? 0

  // A CREDIT agent's chips (spec 2026-11-02 §2): read once here for the head's strip, the Overview card and
  // the Chips tab. A move made on the page refetches it (the chips module refreshes its reads on screen).
  const isCreditAgent = agent?.schemeType === 'CREDIT'
  const chips = useChipAccount('AGENT', id, { skip: !isCreditAgent })
  const chipAccount = isCreditAgent ? chips.account : null

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

  const reload = () => { void refetchProfile(); void refetchStats(); void refetchRestriction() }
  const back = <Button onClick={() => navigate('/agents')}>Back to Agents</Button>
  if (!id) return <Page><Notice tone="error" title="Invalid Agent">No agent ID provided{back}</Notice></Page>
  // The restriction's first answer is waited for too, so its notice does not push the page down when it arrives.
  if (loading || (restrictionLoading && !restrictionData)) return (<Page><LoadingState label="Loading agent profile" /></Page>)
  if (error || !agentWithStats) return (<Page><Notice tone="error" title="Error loading agent profile" action={<div className={styles.actions}>{back}<Button onClick={reload}>Retry</Button></div>}>{error?.message || 'Agent not found'}</Notice></Page>)
  // In the order of the 2026-10-28 redesign: the money tabs of the agent's scheme, its network, then its records.
  // A CREDIT agent settles by moving chips (D / W of its Ref P/L, spec 2026-11-02 decision 8), so it has no
  // Settlement tab; its Chips tab carries the figures, the moves, its downline and its statement.
  const scheme = agentWithStats.schemeType
  const tabs: TabItem<string>[] = [
    { value: 'overview', label: 'Overview' },
    ...(scheme === 'COMMISSION' ? [{ value: 'commission', label: 'Commission' }] : []),
    ...(scheme === 'SHARING' ? [{ value: 'settlement', label: 'Settlement' }] : []),
    ...(scheme === 'CREDIT' ? [{ value: 'chips', label: 'Chips' }] : scheme === 'SHARING' ? [{ value: 'sharing', label: 'Sharing' }] : []),
    { value: 'players', label: 'Players', count: typeof agentStats?.totalPlayers === 'number' ? agentStats.totalPlayers : undefined },
    ...(listsSubAgents(scheme) && subAgentsCount > 0 ? [{ value: 'sub-agents', label: 'Sub-Agents', count: subAgentsCount }] : []),
    ...(scheme === 'COMMISSION' ? [{ value: 'referral-link', label: 'Referral Link' }] : []),
    { value: 'activity-log', label: 'Activity Log' },
  ]
  // Hairlines between the mockup's groups: the overview, the money and network tabs, then the records.
  const firstRecord = tabs.findIndex(tab => tab.value === 'referral-link' || tab.value === 'activity-log')
  const tabItems = tabs.map((tab, index) => index === 1 || index === firstRecord ? { ...tab, divider: true } : tab)
  const selectedTab = tabs.some(tab => tab.value === activeTab) ? activeTab : 'overview'
  return (<Page maxWidth="wide"><div className={styles.stack}>
    <AgentSummaryHeader agent={agentWithStats} stats={agentStats} chipAccount={chipAccount} chipLoading={chips.loading} restriction={restriction} onRefetch={reload} onTabChange={setActiveTab} />
    {/* The head's strip reads the stats too, so their failure shows above every tab. */}
    {statsError && <Notice title="Agent stats unavailable" tone="error" action={<Button onClick={() => void refetchStats()}>Retry stats</Button>}>{statsError.message}</Notice>}
    <div className={styles.tabs}><Tabs value={selectedTab} items={tabItems} label="Agent profile tabs" idPrefix="agent-profile" onChange={setActiveTab} variant="line" /></div>
    <div className={styles.panel} role="tabpanel" id={tabPanelId('agent-profile', selectedTab)} aria-labelledby={tabId('agent-profile', selectedTab)}>
      {selectedTab === 'overview' && <OverviewTab agent={agentWithStats} stats={agentStats} statsLoading={statsLoading} statsFailed={Boolean(statsError)} period={statsPeriod} onPresetChange={choosePreset} onCustomRange={chooseCustom} onRetryStats={() => void refetchStats()} onTabChange={setActiveTab} hasSubAgents={subAgentsCount > 0} chipAccount={chipAccount} chipLoading={chips.loading} />}
      {selectedTab === 'settlement' && <SettlementTab agentId={agentWithStats.id} agent={agentWithStats} />}
      {selectedTab === 'chips' && <ChipsTab agentId={agentWithStats.id} account={chipAccount} loading={chips.loading} error={chips.error} onRetry={() => void chips.refetch()} onChanged={() => void refetchStats()} />}
      {selectedTab === 'sharing' && <SharingTab agentId={agentWithStats.id} agent={agentWithStats} />}
      {selectedTab === 'commission' && <CommissionTab agentId={agentWithStats.id} agent={agentWithStats} />}
      {selectedTab === 'referral-link' && <ReferralLinkTab agentId={agentWithStats.id} agentUsername={agentWithStats.username || ''} />}
      {selectedTab === 'activity-log' && <AgentSecurityAuditTab agentId={String(agentWithStats.id)} />}
      {selectedTab === 'players' && <PlayersTab agentId={agentWithStats.id} />}
      {selectedTab === 'sub-agents' && <SubAgentsTab agentId={agentWithStats.id} schemeType={scheme} />}
    </div>
  </div></Page>)
}

