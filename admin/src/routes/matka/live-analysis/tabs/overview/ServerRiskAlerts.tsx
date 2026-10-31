import { isOpenMatkaRiskAlert, type MatkaRiskAlert } from '../../liveUiModel'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../../MatkaLiveUi.module.css'
import { useMemo } from 'react'
import { useSubscription } from '@apollo/client'
import { SUB_MATKA_RISK_ALERTS } from '@/lib/graphql/matkaLive'
import { useCurrentWhitelabel } from '@/shared/core/useWhitelabels'
import { useFormatDate } from '@/shared/core/useFormatDate'

export const ServerRiskAlerts: React.FC = () => {
  const { whitelabel } = useCurrentWhitelabel()
  const { formatTime } = useFormatDate()
  // Use whitelabel ID for both tenant and whitelabelId to ensure consistent filtering
  const scope = useMemo(() => ({ tenant: whitelabel?.id || 'default', whitelabelId: whitelabel?.id || 'default' }), [whitelabel?.id])
  const { data, loading } = useSubscription<{ matkaRiskAlerts: { at?: string; items: MatkaRiskAlert[] } }>(SUB_MATKA_RISK_ALERTS, { variables: { scope }, shouldResubscribe: true })
  const alerts = (data?.matkaRiskAlerts?.items || []).filter(isOpenMatkaRiskAlert)

  return <Card title="Server Risk Alerts" sub="Backend-evaluated alerts" tools={<span className={styles.muted}>{data?.matkaRiskAlerts?.at ? formatTime(data.matkaRiskAlerts.at, 'HH:mm:ss') : ''}</span>}>
    {loading ? <LoadingState label="Loading risk alerts" /> : !alerts.length ? <EmptyState title="No alerts" /> : <ul className={styles.list}>{alerts.map((alert: MatkaRiskAlert) => <li key={alert.id} className={styles.item}>
      <div className={styles.row}><h3 className={styles.heading}>{alert.title}</h3><StatusPill tone={alert.severity === 'critical' ? 'neg' : alert.severity === 'warning' ? 'warn' : 'info'}>{alert.severity.toUpperCase()}</StatusPill></div>
      <p className={styles.text}>{alert.description}</p><span className={styles.muted}>{alert.entity}</span>
    </li>)}</ul>}
  </Card>
}

