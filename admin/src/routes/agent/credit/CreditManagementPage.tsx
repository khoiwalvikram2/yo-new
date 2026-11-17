import { useState, type ReactNode } from 'react'
import { IconArrowLeft, IconCircleX, IconHistory, IconSitemap } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { ChipDownlineTable, ChipFigures, ChipStatementTable, chipErrorMessage, useMyChipAccount } from '@/modules/chips'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { AGENT_CHIPS_TABS, agentChipsAccess, type AgentChipsTab } from './agentCreditManagementModel'
import styles from './CreditManagementPage.module.css'

const TAB_ID_PREFIX = 'agent-chips'

const TAB_ICONS: Record<AgentChipsTab, ReactNode> = {
  downline: <IconSitemap size={15} stroke={strokeFor(15)} />,
  statement: <IconHistory size={15} stroke={strokeFor(15)} />,
}

const TAB_ITEMS: readonly TabItem<AgentChipsTab>[] = AGENT_CHIPS_TABS.map((tab) => ({
  ...tab,
  icon: TAB_ICONS[tab.value],
}))

/**
 * /agent/credit: a CREDIT agent's Chips page (spec 2026-11-02 §8). Its five figures from myChipAccount, its
 * direct downline (sub-agents and its own players) with D / W / CR, and its chip statement. A move made
 * here refetches the figures on screen, the topbar wallet included.
 */
export default function AgentCreditManagementPage() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const agent = useAuthStore((state) => state.agent)
  const access = agentChipsAccess(agent)
  const [activeTab, setActiveTab] = useState<AgentChipsTab>('downline')
  const { account, loading, error, refetch } = useMyChipAccount({ skip: access !== 'allowed' })

  const header = (
    <PageHeader
      eyebrow={pageEyebrow}
      title="Chips"
      sub="Your balance, your downline and every chip movement"
      actions={access === 'allowed' ? (
        <Button icon={<IconArrowLeft size={16} stroke={strokeFor(16)} />} onClick={() => navigate(-1)}>
          Back
        </Button>
      ) : undefined}
    />
  )

  if (access === 'unauthenticated' || !agent) {
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

  const figures = error && !account ? (
    <Notice
      className={styles.notice}
      tone="error"
      title="Your chips could not be loaded"
      action={<Button size="sm" onClick={() => void refetch().catch(() => { /* the notice stays with the read's error */ })}>Try again</Button>}
    >
      {chipErrorMessage(error, 'Try again in a moment.')}
    </Notice>
  ) : !loading && !account ? (
    <Notice className={styles.notice} tone="warn" title="No chips account">
      Chips appear here once your upline deposits to this account.
    </Notice>
  ) : (
    <ChipFigures account={account} loading={loading} label="My chips" self />
  )

  return (
    <Page maxWidth="wide">
      {header}
      <div className={styles.content}>
        {figures}

        <div className={styles.tabs}>
          <Tabs
            value={activeTab}
            items={TAB_ITEMS}
            onChange={setActiveTab}
            label="Chips page sections"
            idPrefix={TAB_ID_PREFIX}
          />
        </div>

        <div
          className={styles.panel}
          role="tabpanel"
          id={tabPanelId(TAB_ID_PREFIX, activeTab)}
          aria-labelledby={tabId(TAB_ID_PREFIX, activeTab)}
        >
          {activeTab === 'downline' ? (
            <Card title="My downline" sub="Your sub-agents and players. Deposit, withdraw or set a credit reference; an agent opens its own downline.">
              <ChipDownlineTable label="My downline" />
            </Card>
          ) : (
            <Card title="Chip statement" sub="Every deposit, withdrawal and credit reference change on your account" body="table">
              <ChipStatementTable accountType="AGENT" accountId={agent.id} currency={account?.currency} label="My chip statement" />
            </Card>
          )}
        </div>
      </div>
    </Page>
  )
}
