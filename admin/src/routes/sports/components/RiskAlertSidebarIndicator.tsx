import { IconAlertCircle } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import type { RiskAlert } from './types/riskAlerts'

interface RiskAlertSidebarIndicatorProps { alerts: RiskAlert[]; onClick?: () => void }
export function RiskAlertSidebarIndicator({ alerts, onClick }: RiskAlertSidebarIndicatorProps) {
  if (!Array.isArray(alerts) || !alerts.length) return null
  const high = alerts.filter(alert => alert.riskLevel === 'HIGH').length
  const medium = alerts.filter(alert => alert.riskLevel === 'MEDIUM').length
  const description = high && medium ? `${high} HIGH risk, ${medium} MEDIUM risk alerts`
    : high ? `${high} HIGH risk alert${high > 1 ? 's' : ''}`
    : medium ? `${medium} MEDIUM risk alert${medium > 1 ? 's' : ''}`
    : `${alerts.length} risk alert${alerts.length > 1 ? 's' : ''}`
  return <Tooltip content={description}><Button size="xs" variant="ghost" onClick={onClick} aria-label={description} icon={<IconAlertCircle size={16} />}>
    <StatusPill tone={high ? 'neg' : medium ? 'warn' : 'info'}>{alerts.length > 99 ? '99+' : alerts.length}</StatusPill>
  </Button></Tooltip>
}

