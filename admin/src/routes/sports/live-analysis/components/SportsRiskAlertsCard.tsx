import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { Card } from '@/ui/components/Card';
import { Notice } from '@/ui/components/Notice';
import { DescriptionList } from '@/ui/components/DescriptionList';
import { EmptyState } from '@/ui/components/EmptyState';
import styles from '../SportsLive.module.css';
type SportsRiskAlertsCardProps = {
  data?: {
    at?: string
    items?: Array<{
      id: string
      entityName?: string | null
      entityType?: string
      severity?: 'critical' | 'warning' | 'info'
      description?: string
      value?: number
      threshold?: number
      metric?: string
      at?: string
    }>
  }
}


export function SportsRiskAlertsCard({ data }: SportsRiskAlertsCardProps) {
  const { formatAmount } = useCurrency();
  const { formatTime } = useFormatDate();
  const alerts = data?.items ?? [];
  const timestamp = data?.at ? formatTime(data.at, 'HH:mm:ss') : '';
  return <Card title="Server Risk Alerts" sub={timestamp ? `Updated ${timestamp}` : undefined}>{!alerts.length ? <EmptyState title="No active alerts" /> : <div className={styles.stack}>{alerts.map(alert => <article key={alert.id} className={styles.list}><Notice title={alert.entityName || alert.entityType || 'Entity'} tone={alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warn' : 'info'}>{alert.description}</Notice><span className={styles.muted}>{alert.severity || 'info'}</span><DescriptionList items={[{ term: 'Value', value: formatAmount(alert.value ?? 0) }, { term: 'Threshold', value: formatAmount(alert.threshold ?? 0) }]} /></article>)}</div>}</Card>;
}

