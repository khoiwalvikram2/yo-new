import { useState, type ReactNode } from 'react';
import { useQuery } from '@apollo/client';
import { IconArrowsExchange, IconChartPie, IconHistory, IconRefresh } from '@tabler/icons-react';
import {
  MY_WHITELABEL_CREDIT_QUERY,
  MY_WHITELABEL_CREDIT_HISTORY_QUERY,
  MY_WHITELABEL_SETTLEMENTS_QUERY
} from '@/lib/graphql/whitelabel';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { useAuthStore } from '@/shared/core/authStore';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { Button } from '@/ui/components/Button';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { Tabs, type TabItem } from '@/ui/components/Tabs';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import { strokeFor } from '@/ui/components/icons';
import { CreditHistoryPanel } from './components/CreditHistoryPanel';
import { CreditOverviewPanel } from './components/CreditOverviewPanel';
import { CreditSettlementsPanel } from './components/CreditSettlementsPanel';
import {
  CREDIT_DEFAULT_PAGE_SIZE,
  CREDIT_TABS,
  isWhitelabelAdminRole,
  type CreditTab,
  type WhitelabelCreditTransaction,
  type WhitelabelSettlementSummary,
} from './creditManagementModel';
import styles from './CreditManagementPage.module.css';

const TABS_ID_PREFIX = 'credit-management';

/* The legacy segmented control's glyphs (chart-pie, history, exchange-alt), decorative beside the labels. */
const TAB_ICONS: Record<CreditTab, ReactNode> = {
  overview: <IconChartPie size={15} stroke={strokeFor(15)} />,
  history: <IconHistory size={15} stroke={strokeFor(15)} />,
  settlements: <IconArrowsExchange size={15} stroke={strokeFor(15)} />,
};

const TAB_ITEMS: readonly TabItem<CreditTab>[] = CREDIT_TABS.map((tab) => ({ ...tab, icon: TAB_ICONS[tab.value] }));

export default function CreditManagementPage() {
  const roles = useAuthStore(s => s.roles);
  const isWhitelabelAdmin = isWhitelabelAdminRole(roles);

  if (isWhitelabelAdmin) {
    return <CreditManagementPageContent />;
  }

  return (
    <RBACGuard required={[{ domain: 'credit.management', actions: ['view'] }]}>
      <CreditManagementPageContent />
    </RBACGuard>
  );
}

function CreditManagementPageContent() {
  const [activeTab, setActiveTab] = useState<CreditTab>('overview');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(CREDIT_DEFAULT_PAGE_SIZE);
  const [settlementsPage, setSettlementsPage] = useState(1);
  const [whitelabelSettlementsPage, setWhitelabelSettlementsPage] = useState(1);
  const [settlementsPageSize, setSettlementsPageSize] = useState(CREDIT_DEFAULT_PAGE_SIZE);
  const pageEyebrow = usePageEyebrow();

  const { data: creditData, loading: creditLoading, refetch: refetchCredit } = useQuery(MY_WHITELABEL_CREDIT_QUERY, {
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });

  const { data: historyData, loading: historyLoading, error: historyError } = useQuery(MY_WHITELABEL_CREDIT_HISTORY_QUERY, {
    variables: {
      limit: historyPageSize + 1,
      offset: (historyPage - 1) * historyPageSize,
    },
    skip: activeTab !== 'history',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });

  const { data: settlementsData, loading: settlementsLoading } = useQuery(MY_WHITELABEL_SETTLEMENTS_QUERY, {
    variables: {
      limit: settlementsPageSize,
      agentOffset: (settlementsPage - 1) * settlementsPageSize,
      whitelabelOffset: (whitelabelSettlementsPage - 1) * settlementsPageSize,
    },
    skip: activeTab !== 'settlements',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });

  const credit = creditData?.myWhitelabelCredit;
  const allTransactions: WhitelabelCreditTransaction[] = historyData?.myWhitelabelCreditHistory || [];
  const settlements: WhitelabelSettlementSummary | undefined = settlementsData?.myWhitelabelSettlements;

  const handleRefresh = () => {
    void refetchCredit();
  };

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Credit Management"
        sub="Manage your whitelabel credit and view history"
        actions={(
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        <div className={styles.tabs}>
          <Tabs
            value={activeTab}
            items={TAB_ITEMS}
            onChange={setActiveTab}
            label="Credit Management tabs selector"
            idPrefix={TABS_ID_PREFIX}
          />
        </div>

        <div
          className={styles.panel}
          role="tabpanel"
          id={tabPanelId(TABS_ID_PREFIX, activeTab)}
          aria-labelledby={tabId(TABS_ID_PREFIX, activeTab)}
        >
          {activeTab === 'overview' && <CreditOverviewPanel credit={credit} loading={creditLoading} />}
          {activeTab === 'history' && (
            <CreditHistoryPanel
              transactions={allTransactions}
              loading={historyLoading}
              error={Boolean(historyError)}
              page={historyPage}
              pageSize={historyPageSize}
              onPageChange={setHistoryPage}
              onPageSizeChange={(value) => {
                setHistoryPageSize(value);
                setHistoryPage(1);
              }}
            />
          )}
          {activeTab === 'settlements' && (
            <CreditSettlementsPanel
              settlements={settlements}
              loading={settlementsLoading}
              page={settlementsPage}
              whitelabelPage={whitelabelSettlementsPage}
              onWhitelabelPageChange={setWhitelabelSettlementsPage}
              pageSize={settlementsPageSize}
              onPageChange={setSettlementsPage}
              onPageSizeChange={(value) => {
                setSettlementsPageSize(value);
                setSettlementsPage(1);
                setWhitelabelSettlementsPage(1);
              }}
            />
          )}
        </div>
      </div>
    </Page>
  );
}
