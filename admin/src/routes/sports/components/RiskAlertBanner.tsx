import { useState } from 'react'
import { IconBell, IconX } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { Notice } from '@/ui/components/Notice'
import type { RiskAlert } from './types/riskAlerts'
import styles from './EventHead.module.css'

interface RiskAlertBannerProps { alerts: RiskAlert[]; onDismiss?: () => void; onViewAll?: () => void }
export function RiskAlertBanner({ alerts, onDismiss, onViewAll }: RiskAlertBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  if (!Array.isArray(alerts) || dismissed || !alerts.length) return null
  const high = alerts.filter(alert => alert.riskLevel === 'HIGH').length
  const medium = alerts.filter(alert => alert.riskLevel === 'MEDIUM').length
  const message = high && medium ? `${high} HIGH risk and ${medium} MEDIUM risk alerts active`
    : high ? `${high} HIGH risk alert${high > 1 ? 's' : ''} active`
    : medium ? `${medium} MEDIUM risk alert${medium > 1 ? 's' : ''} active`
    : `${alerts.length} risk alert${alerts.length > 1 ? 's' : ''} active`
  return <Notice className={styles.alert} tone={high ? 'error' : medium ? 'warn' : 'info'} title={message} icon={<IconBell size={16} />} action={<div className={styles.alertActions}>
    {onViewAll && <Button size="sm" variant="link" onClick={onViewAll}>View All</Button>}
    <IconButton size="sm" label="Dismiss risk alerts banner" icon={<IconX size={16} />} onClick={() => { setDismissed(true); onDismiss?.() }} />
  </div>} />
}

