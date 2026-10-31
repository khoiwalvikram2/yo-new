import { useCallback, useMemo, useState } from 'react'
import { gql, useQuery } from '@apollo/client'
import {
  IconChartBar,
  IconCoinRupee,
  IconEdit,
  IconLock,
  IconPlus,
  IconSitemap,
  IconUsers,
  IconUserCheck,
} from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import HierarchyTree from '@/modules/agents/components/HierarchyTree'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { nowIST, todayISTString } from '@/shared/utils/date'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { Drawer } from '@/ui/components/Drawer'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import {
  agentDisplayName,
  canCreateHierarchyAgent,
  hierarchyStatusCount,
  type HierarchyAgentNode,
} from './hierarchyModel'
import styles from './HierarchyPage.module.css'

export const AGENT_DETAILS_QUERY = gql`
  query AgentDetails($agentId: ID!, $periodFrom: String!, $periodTo: String!) {
    agents {
      agentProfile(id: $agentId) {
        id
        username
        schemeType
        allowedDomains
        status
        phone
        creditLimit
        creditUsed
        creditAvailable
        parentAgentId
        levelIndex
      }
      agentKPIs(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
        totalGGR
        sportsGGR
        casinoGGR
        matkaGGR
      }
    }
  }
`

export const AGENT_TREE_QUERY = gql`
  query AgentTree($rootId: ID!) {
    agents {
      agentTree(rootId: $rootId) {
        id
        username
        schemeType
        status
        levelIndex
        creditLimit
        creditUsed
        creditAvailable
        parentAgentId
      }
    }
  }
`

interface AgentDetails {
  id: string
  username?: string | null
  schemeType: string
  allowedDomains?: string[] | null
  status: string
  phone?: string | null
  creditLimit?: number | null
  creditUsed?: number | null
  creditAvailable?: number | null
  parentAgentId?: string | null
  levelIndex?: number | null
}

interface AgentKPIs {
  totalGGR?: number | null
  sportsGGR?: number | null
  casinoGGR?: number | null
  matkaGGR?: number | null
}

interface AgentDetailsData {
  agents?: {
    agentProfile?: AgentDetails | null
    agentKPIs?: AgentKPIs | null
  } | null
}

interface AgentTreeData {
  agents?: { agentTree?: HierarchyAgentNode[] | null } | null
}

export default function HierarchyPage() {
  return (
    <RBACGuard required={[{ domain: 'agents.hierarchy', actions: ['view'] }]} bypassForAgents>
      <HierarchyPageContent />
    </RBACGuard>
  )
}

export function HierarchyPageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const agent = useAuthStore((state) => state.agent)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const rootAgentId = agent?.id || ''
  const periodFrom = useMemo(() => nowIST().subtract(30, 'days').format('YYYY-MM-DD'), [])
  const periodTo = useMemo(() => todayISTString(), [])

  const {
    data: treeData,
    loading: treeLoading,
    error: treeError,
    refetch: refetchTree,
    networkStatus,
  } = useQuery<AgentTreeData>(AGENT_TREE_QUERY, {
    variables: { rootId: rootAgentId },
    skip: !rootAgentId,
    errorPolicy: 'all',
    notifyOnNetworkStatusChange: true,
  })

  const {
    data: detailsData,
    loading: detailsLoading,
    error: detailsError,
  } = useQuery<AgentDetailsData>(AGENT_DETAILS_QUERY, {
    variables: { agentId: selectedAgentId, periodFrom, periodTo },
    skip: !selectedAgentId,
    errorPolicy: 'all',
  })

  const hierarchyAgents = treeData?.agents?.agentTree ?? []
  const selectedAgent = detailsData?.agents?.agentProfile
  const selectedAgentKPIs = detailsData?.agents?.agentKPIs
  const activeAgents = hierarchyStatusCount(hierarchyAgents, 'ACTIVE')
  const creditAgents = hierarchyAgents.filter((item) => item.schemeType === 'CREDIT').length
  const treePending = treeLoading && !treeData
  const amount = useCallback(
    (value?: number | null) => formatAmount(convertFromWhitelabelCurrency(Number(value || 0))),
    [convertFromWhitelabelCurrency, formatAmount],
  )

  const selectAgent = (agentId: string) => {
    setSelectedAgentId(agentId)
    setDrawerOpen(true)
  }

  const handleAction = (
    action: 'edit' | 'credit' | 'suspend' | 'activate',
    agentId: string,
  ) => {
    if (action === 'edit') {
      navigate(`/agents/${agentId}/edit`)
      return
    }
    if (action === 'credit') {
      navigate(`/agents/${agentId}`)
      return
    }
    selectAgent(agentId)
  }

  if (!agent) {
    return (
      <Page maxWidth="wide" className={styles.content}>
        <PageHeader
          eyebrow={pageEyebrow}
          title="Agent Hierarchy"
          sub="Manage sub-agents and inspect the complete reporting structure"
        />
        <Notice
          tone="error"
          icon={<IconLock size={18} stroke={strokeFor(18)} />}
          title="Agent sign-in required"
        >
          Sign in with an agent account to view its hierarchy.
        </Notice>
      </Page>
    )
  }

  return (
    <Page maxWidth="wide" className={styles.content}>
      <PageHeader
        eyebrow={pageEyebrow}
        title="Agent Hierarchy"
        sub="Manage sub-agents and inspect the complete reporting structure"
        actions={canCreateHierarchyAgent(agent) ? (
          <Button
            variant="primary"
            size="sm"
            icon={<IconPlus size={15} stroke={strokeFor(15)} />}
            onClick={() => navigate('/agent/create')}
          >
            Create sub-agent
          </Button>
        ) : undefined}
      />

      <div className={styles.stats} aria-label="Hierarchy summary" aria-busy={treePending || undefined}>
        <Stat
          label="Total sub-agents"
          value={hierarchyAgents.length}
          icon={<IconSitemap size={18} stroke={strokeFor(18)} />}
          hue="blu"
          loading={treePending}
          note="Across the visible hierarchy"
        />
        <Stat
          label="Active agents"
          value={activeAgents}
          icon={<IconUserCheck size={18} stroke={strokeFor(18)} />}
          hue="grn"
          loading={treePending}
          note={`${hierarchyAgents.length - activeAgents} inactive or restricted`}
        />
        <Stat
          label="Credit accounts"
          value={creditAgents}
          icon={<IconCoinRupee size={18} stroke={strokeFor(18)} />}
          hue="amb"
          loading={treePending}
          note={`${hierarchyAgents.length - creditAgents} sharing accounts`}
        />
      </div>

      <HierarchyTree
        agents={hierarchyAgents}
        loading={treeLoading}
        refreshing={networkStatus === 4}
        error={treeError}
        selectedAgentId={selectedAgentId}
        onRefresh={() => void refetchTree()}
        onSelectAgent={selectAgent}
        onAction={handleAction}
      />

      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={selectedAgent ? agentDisplayName(selectedAgent) : 'Agent details'}
        sub="Account, credit and last-30-day performance"
        size="md"
        footer={selectedAgent ? (
          <div className={styles.drawerFooter}>
            <Button
              icon={<IconChartBar size={15} stroke={strokeFor(15)} />}
              onClick={() => navigate('/reporting/agents/performance')}
            >
              Performance report
            </Button>
            <Button
              variant="primary"
              icon={<IconEdit size={15} stroke={strokeFor(15)} />}
              onClick={() => navigate(`/agents/${selectedAgent.id}/edit`)}
            >
              Edit agent
            </Button>
          </div>
        ) : undefined}
      >
        {detailsLoading ? (
          <LoadingState label="Loading agent details" minHeight={192} />
        ) : detailsError ? (
          <Notice tone="error" title="Could not load agent details">
            {detailsError.message || 'Close the drawer and try again.'}
          </Notice>
        ) : selectedAgent ? (
          <div className={styles.drawerContent}>
            <div className={styles.drawerIdentity}>
              <span className={styles.drawerAvatar} aria-hidden="true">
                {agentDisplayName(selectedAgent).slice(0, 2).toUpperCase()}
              </span>
              <div className={styles.drawerName}>
                <strong>{agentDisplayName(selectedAgent)}</strong>
                <span>{selectedAgent.phone || 'No phone number'}</span>
              </div>
              <div className={styles.drawerPills}>
                <StatusPill tone={selectedAgent.schemeType === 'CREDIT' ? 'info' : 'neutral'}>
                  {selectedAgent.schemeType}
                </StatusPill>
                <StatusPill status={selectedAgent.status}>{selectedAgent.status}</StatusPill>
              </div>
            </div>

            <DescriptionList.Section title="Account information">
              <DescriptionList
                items={[
                  { term: 'Agent ID', value: <code className={styles.code}>{selectedAgent.id}</code> },
                  { term: 'Level', value: selectedAgent.levelIndex ?? 'Not assigned' },
                  { term: 'Parent agent', value: selectedAgent.parentAgentId || 'Root account' },
                  {
                    term: 'Domains',
                    value: selectedAgent.allowedDomains?.length ? (
                      <span className={styles.domains}>
                        {selectedAgent.allowedDomains.map((domain) => <span key={domain}>{domain}</span>)}
                      </span>
                    ) : 'No domains assigned',
                  },
                ]}
              />
            </DescriptionList.Section>

            {selectedAgent.schemeType === 'CREDIT' ? (
              <Card title="Credit position" headingLevel={3} className={styles.drawerCard}>
                <DescriptionList
                  items={[
                    { term: 'Credit limit', value: amount(selectedAgent.creditLimit) },
                    { term: 'Credit used', value: amount(selectedAgent.creditUsed) },
                    { term: 'Available', value: <strong className={styles.positive}>{amount(selectedAgent.creditAvailable)}</strong> },
                  ]}
                />
                <Button
                  size="sm"
                  icon={<IconCoinRupee size={15} stroke={strokeFor(15)} />}
                  onClick={() => navigate(`/agents/${selectedAgent.id}`)}
                >
                  Adjust credit
                </Button>
              </Card>
            ) : null}

            {selectedAgentKPIs ? (
              <Card title="Performance · last 30 days" headingLevel={3} className={styles.drawerCard}>
                <div className={styles.kpiGrid}>
                  <span><small>Total GGR</small><strong>{amount(selectedAgentKPIs.totalGGR)}</strong></span>
                  <span><small>Sports GGR</small><strong>{amount(selectedAgentKPIs.sportsGGR)}</strong></span>
                  <span><small>Casino GGR</small><strong>{amount(selectedAgentKPIs.casinoGGR)}</strong></span>
                  <span><small>Matka GGR</small><strong>{amount(selectedAgentKPIs.matkaGGR)}</strong></span>
                </div>
              </Card>
            ) : null}

            <Notice tone="info" title="Status controls">
              Suspend and activate controls remain unavailable here until the existing status mutation is wired. Use the full agent profile for supported account actions.
            </Notice>
            <Button
              block
              icon={<IconUsers size={15} stroke={strokeFor(15)} />}
              onClick={() => navigate(`/agents/${selectedAgent.id}`)}
            >
              Open full agent profile
            </Button>
          </div>
        ) : (
          <LoadingState label="Preparing agent details" minHeight={192} />
        )}
      </Drawer>
    </Page>
  )
}
