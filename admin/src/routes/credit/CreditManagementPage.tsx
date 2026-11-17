import { useState, type ReactNode } from 'react';
import { IconHierarchy2, IconHistory, IconRefresh } from '@tabler/icons-react';
import { ChipDownlineTable, ChipPoolFigures, chipErrorMessage, useChipPool, useRefreshChips } from '@/modules/chips';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { useAuthStore } from '@/shared/core/authStore';
import { CHIPS_PAGE_PERMISSION, canOpenChipsPage } from '@/shared/core/chipsPageAccess';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Notice } from '@/ui/components/Notice';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { Tabs, type TabItem } from '@/ui/components/Tabs';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import { strokeFor } from '@/ui/components/icons';
import { PoolStatementPanel } from './components/PoolStatementPanel';
import { CHIPS_PAGE_TABS, type ChipsPageTab } from './creditManagementModel';
import styles from './CreditManagementPage.module.css';

const TABS_ID_PREFIX = 'chips-page';

/* Decorative glyphs beside the tab labels. */
const TAB_ICONS: Record<ChipsPageTab, ReactNode> = {
  downline: <IconHierarchy2 size={15} stroke={strokeFor(15)} />,
  statement: <IconHistory size={15} stroke={strokeFor(15)} />,
};

const TAB_ITEMS: readonly TabItem<ChipsPageTab>[] = CHIPS_PAGE_TABS.map((tab) => ({ ...tab, icon: TAB_ICONS[tab.value] }));

/**
 * /credit, the admin's Chips page (spec 2026-11-02 §8). The whitelabel's credit pool feeds the root accounts:
 * the root CREDIT agents and the WHITELABEL_CREDIT players. The admin deposits chips to them out of the pool
 * and withdraws chips back into it (D / W), and sets their credit references (CR). The pool's statement lists
 * every movement of its free chips.
 */
export default function CreditManagementPage() {
  const roles = useAuthStore(s => s.roles);
  const permissions = useAuthStore(s => s.permissions);

  // One rule for the page and its sidebar link (shared/core/chipsPageAccess): the whitelabel admin roles, or
  // credit.management:view. Anyone else gets the guard's own Access denied notice.
  if (canOpenChipsPage(roles, permissions)) {
    return <ChipsPageContent />;
  }

  return (
    <RBACGuard required={[CHIPS_PAGE_PERMISSION]}>
      <ChipsPageContent />
    </RBACGuard>
  );
}

function ChipsPageContent() {
  const [activeTab, setActiveTab] = useState<ChipsPageTab>('downline');
  // Bumped by Refresh and after a move, so the pool statement asks again (the chips reads refresh themselves).
  const [statementRevision, setStatementRevision] = useState(0);
  const pageEyebrow = usePageEyebrow();
  const { pool, loading: poolLoading, error: poolError, refetch: refetchPool } = useChipPool();
  const refreshChips = useRefreshChips();

  const handleRefresh = () => {
    void refreshChips();
    setStatementRevision((value) => value + 1);
  };

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Chips"
        sub="The whitelabel pool and the root accounts it feeds"
        actions={(
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        {poolError && !pool ? (
          <Notice tone="error" title="The pool could not be loaded" action={<Button size="sm" onClick={() => void refetchPool()}>Retry</Button>}>
            {chipErrorMessage(poolError)}
          </Notice>
        ) : (
          <ChipPoolFigures pool={pool} loading={poolLoading} label="Whitelabel pool" />
        )}

        <div className={styles.tabs}>
          <Tabs
            value={activeTab}
            items={TAB_ITEMS}
            onChange={setActiveTab}
            label="Chips page sections"
            idPrefix={TABS_ID_PREFIX}
          />
        </div>

        <div
          className={styles.panel}
          role="tabpanel"
          id={tabPanelId(TABS_ID_PREFIX, activeTab)}
          aria-labelledby={tabId(TABS_ID_PREFIX, activeTab)}
        >
          {activeTab === 'downline' && (
            <Card
              title="Root accounts"
              sub="Root credit agents and whitelabel credit players. D and W move chips between the pool and the account; CR sets its credit reference."
            >
              <ChipDownlineTable label="Root accounts" onChanged={() => setStatementRevision((value) => value + 1)} />
            </Card>
          )}
          {activeTab === 'statement' && <PoolStatementPanel currency={pool?.currency} refreshKey={statementRevision} />}
        </div>
      </div>
    </Page>
  );
}
