import { useState, type ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import {
  IconArrowLeft,
  IconArrowsExchange,
  IconChartPie,
  IconCircleX,
  IconHistory,
} from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import {
  MY_AGENT_CREDIT_HISTORY_QUERY,
  MY_AGENT_CREDIT_QUERY,
  MY_AGENT_SETTLEMENTS_QUERY,
} from '@/lib/graphql/agentCredit'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import {
  AGENT_CREDIT_PAGE_SIZE,
  AGENT_CREDIT_TABS,
  agentCreditAccess,
  type AgentCredit,
  type AgentCreditTab,
  type AgentCreditTransaction,
  type AgentSettlementSummary,
} from './agentCreditManagementModel'
import { AgentCreditHistoryPanel } from './components/AgentCreditHistoryPanel'
import { AgentCreditOverviewPanel } from './components/AgentCreditOverviewPanel'
import { AgentCreditSettlementsPanel } from './components/AgentCreditSettlementsPanel'
import styles from './CreditManagementPage.module.css'

const TAB_ID_PREFIX = 'agent-credit'

const TAB_ICONS: Record<AgentCreditTab, ReactNode> = {
  overview: <IconChartPie size={15} stroke={strokeFor(15)} />,
  history: <IconHistory size={15} stroke={strokeFor(15)} />,
  settlements: <IconArrowsExchange size={15} stroke={strokeFor(15)} />,
}

const TAB_ITEMS: readonly TabItem<AgentCreditTab>[] = AGENT_CREDIT_TABS.map((tab) => ({
  ...tab,
  icon: TAB_ICONS[tab.value],
}))

interface CreditQueryData {
  myAgentCredit?: AgentCredit | null
}

interface HistoryQueryData {
  myAgentCreditHistory?: AgentCreditTransaction[] | null
}

interface SettlementsQueryData {
  myAgentSettlements?: AgentSettlementSummary | null
}

export default function AgentCreditManagementPage() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const agent = useAuthStore((state) => state.agent)
  const access = agentCreditAccess(agent)
  const [activeTab, setActiveTab] = useState<AgentCreditTab>('overview')
  const [historyPage, setHistoryPage] = useState(1)
  const [settlementsPage, setSettlementsPage] = useState(1)

  const { data: creditData, loading: creditLoading } = useQuery<CreditQueryData>(MY_AGENT_CREDIT_QUERY, {
    fetchPolicy: 'cache-and-network',
  })
  const { data: historyData, loading: historyLoading } = useQuery<HistoryQueryData>(MY_AGENT_CREDIT_HISTORY_QUERY, {
    variables: {
      limit: AGENT_CREDIT_PAGE_SIZE,
      offset: (historyPage - 1) * AGENT_CREDIT_PAGE_SIZE,
    },
    skip: activeTab !== 'history',
    fetchPolicy: 'cache-and-network',
  })
  const { data: settlementsData, loading: settlementsLoading } = useQuery<SettlementsQueryData>(MY_AGENT_SETTLEMENTS_QUERY, {
    variables: {
      limit: AGENT_CREDIT_PAGE_SIZE,
      offset: (settlementsPage - 1) * AGENT_CREDIT_PAGE_SIZE,
    },
    skip: activeTab !== 'settlements',
    fetchPolicy: 'cache-and-network',
  })

  const header = (
    <PageHeader
      eyebrow={pageEyebrow}
      title="Credit Management"
      sub="Manage your agent credit and view history"
      actions={access === 'allowed' ? (
        <Button icon={<IconArrowLeft size={16} stroke={strokeFor(16)} />} onClick={() => navigate(-1)}>
          Back
        </Button>
      ) : undefined}
    />
  )

  if (access === 'unauthenticated') {
    return (
      <Page>
        {header}
        <Notice className={styles.notice} tone="error" icon={<IconCircleX size={18} stroke={strokeFor(18)} />} title="Not Authenticated">
          Please log in as an agent to view this page.
        </Notice>
      </Page>
    )
  }

  if (access === 'denied') {
    return (
      <Page>
        {header}
        <Notice
          className={styles.notice}
          tone="error"
          icon={<IconCircleX size={18} stroke={strokeFor(18)} />}
          title="Access Denied"
          action={<Button variant="primary" onClick={() => navigate('/agent')}>Go to Overview</Button>}
        >
          This page is only available for CREDIT scheme agents. Sharing and Commission agents have different management pages.
        </Notice>
      </Page>
    )
  }

  const transactions = historyData?.myAgentCreditHistory || []

  return (
    <Page maxWidth="wide">
      {header}
      <div className={styles.content}>
        <div className={styles.tabs}>
          <Tabs
            value={activeTab}
            items={TAB_ITEMS}
            onChange={setActiveTab}
            label="Agent credit management tabs"
            idPrefix={TAB_ID_PREFIX}
          />
        </div>

        <div
          className={styles.panel}
          role="tabpanel"
          id={tabPanelId(TAB_ID_PREFIX, activeTab)}
          aria-labelledby={tabId(TAB_ID_PREFIX, activeTab)}
        >
          {activeTab === 'overview' ? (
            <AgentCreditOverviewPanel credit={creditData?.myAgentCredit} loading={creditLoading} />
          ) : null}
          {activeTab === 'history' ? (
            <AgentCreditHistoryPanel
              transactions={transactions}
              loading={historyLoading}
              page={historyPage}
              pageSize={AGENT_CREDIT_PAGE_SIZE}
              onPageChange={setHistoryPage}
            />
          ) : null}
          {activeTab === 'settlements' ? (
            <AgentCreditSettlementsPanel
              settlements={settlementsData?.myAgentSettlements}
              loading={settlementsLoading}
              page={settlementsPage}
              pageSize={AGENT_CREDIT_PAGE_SIZE}
              onPageChange={setSettlementsPage}
            />
          ) : null}
        </div>
      </div>
    </Page>
  )
}
