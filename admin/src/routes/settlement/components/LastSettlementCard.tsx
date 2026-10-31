import { IconCalendar } from '@tabler/icons-react';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { Card } from '@/ui/components/Card';
import { Stat } from '@/ui/components/Stat';
import { StatusPill } from '@/ui/components/StatusPill';
import type { SettlementSummary } from '../settlementModel';
import styles from '../SettlementCenter.module.css';

export function LastSettlementCard({ settlement }: { settlement?: SettlementSummary | null }) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDateTime } = useFormatDate();
  if (!settlement?.lastSettlementDate) return <Card title={<span className={styles.inline}><IconCalendar size={18} aria-hidden="true" />Last Settlement</span>}><span className={styles.muted}>Never</span></Card>;
  const lastSettlementAmount = convertFromWhitelabelCurrency(settlement.lastSettlementAmount || 0);
  return <Card title={<span className={styles.inline}><IconCalendar size={18} aria-hidden="true" />Last Settlement</span>} tools={<div className={styles.tools}><strong>{formatAmount(lastSettlementAmount)}</strong><StatusPill tone="ok">POSTED</StatusPill></div>}>
    <div className={styles.stack}><span className={styles.muted}>{formatDateTime(settlement.lastSettlementDate, 'MMM dd, yyyy · hh:mm a')}</span>
      <div className={styles.split}><Stat variant="bare" label="Direct Players" value={`${settlement.directPlayersCount || 0} players`} note={`Contribution: ${formatAmount(convertFromWhitelabelCurrency(settlement.directPlayersContribution || 0))}`} />
        <Stat variant="bare" label="Sub-Agents" value={`${settlement.subAgentsCount || 0} sub-agents`} note={`Contribution: ${formatAmount(convertFromWhitelabelCurrency(settlement.subAgentsContribution || 0))}`} />
      </div>
    </div>
  </Card>;
}
