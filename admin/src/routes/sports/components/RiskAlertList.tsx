import { IconUser, IconUsers } from '@tabler/icons-react'
import { Drawer } from '@/ui/components/Drawer'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import type { RiskAlert } from './types/riskAlerts'
import styles from './EventDetailUi.module.css'

interface RiskAlertListProps { open: boolean; onClose: () => void; alerts: RiskAlert[] }
export function RiskAlertList({ open, onClose, alerts }: RiskAlertListProps) {
  const { formatAmount } = useCurrency()
  const { formatTime } = useFormatDate()
  if (!Array.isArray(alerts)) return null
  return <Drawer open={open} onOpenChange={next => { if (!next) onClose() }} title="Risk Alerts" size="md">
    {!alerts.length ? <EmptyState title="No active risk alerts" /> : <ul className={styles.list}>{alerts.map(alert => <li key={alert.id} className={styles.listItem}>
      <div className={styles.between}><div className={styles.row}>{alert.entityType === 'player' ? <IconUser size={16} aria-hidden="true" /> : <IconUsers size={16} aria-hidden="true" />}<strong>{alert.entityName}</strong><StatusPill tone={alert.riskLevel === 'HIGH' ? 'neg' : alert.riskLevel === 'MEDIUM' || alert.riskLevel === 'LOW' ? 'warn' : alert.riskLevel === 'MINIMAL' ? 'ok' : 'neutral'}>{alert.riskLevel}</StatusPill></div>
        <span className={styles.muted}>{alert.timestamp ? formatTime(String(alert.timestamp), 'HH:mm:ss') : '—'}</span></div>
      <DescriptionList items={[{ term: 'Liability', value: formatAmount(alert.metrics.liability) }, { term: 'Exposure', value: formatAmount(alert.metrics.exposure) }, { term: 'Bet Count', value: alert.metrics.betCount }, { term: 'Avg Odds', value: (alert.metrics.odds || 0).toFixed(2) }]} />
    </li>)}</ul>}
  </Drawer>
}

