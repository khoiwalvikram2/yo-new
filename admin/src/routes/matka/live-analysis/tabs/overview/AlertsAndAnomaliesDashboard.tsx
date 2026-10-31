import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { useEffect, useMemo, useRef } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { notify } from '@/shared/services/notification'

interface AlertItem {
  id: string
  type: 'rtp' | 'volume' | 'behavior'
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string
  entity: string
  value: number
  threshold: number
  timestamp: string
}

interface AlertsAndAnomaliesDashboardProps {
  kpis?: {
    rtp: number
    betsPerMin: number
    wagered: number
    activePlayers: number
  }
  breakdown?: {
    byMatka?: Array<{
      matkaId: string
      matkaName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byMarket?: Array<{
      marketName: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
  dataHistory?: Array<{
    rtp: number
    betsPerMin: number
    wagered: number
    activePlayers: number
    timestamp?: number
  }>
}

export const AlertsAndAnomaliesDashboard: React.FC<AlertsAndAnomaliesDashboardProps> = ({
  kpis,
  breakdown,
  dataHistory = [],
}) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  // The live feed contains open bets; realised RTP is unavailable until settlement.
  // Detect Volume Spikes
  const volumeAlerts = useMemo(() => {
    if (!kpis || dataHistory.length < 2) return []
    const alerts: AlertItem[] = []

    const current = dataHistory[dataHistory.length - 1]
    const previous = dataHistory[dataHistory.length - 2]

    // Check bet volume spike
    if (previous.betsPerMin > 0) {
      const volumeChange = ((current.betsPerMin - previous.betsPerMin) / previous.betsPerMin) * 100
      if (volumeChange > 200) {
        alerts.push({
          id: 'volume-spike-bets',
          type: 'volume',
          severity: 'warning',
          title: 'Bet Volume Spike Detected',
          description: `Bet volume increased by ${volumeChange.toFixed(1)}% (${previous.betsPerMin.toFixed(1)} → ${current.betsPerMin.toFixed(1)} bets/min)`,
          entity: 'Overall',
          value: volumeChange,
          threshold: 200,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // Check wagered spike
    if (previous.wagered > 0) {
      const wageredChange = ((current.wagered - previous.wagered) / previous.wagered) * 100
      if (wageredChange > 250) {
        alerts.push({
          id: 'volume-spike-wagered',
          type: 'volume',
          severity: 'critical',
          title: 'Wagered Volume Spike',
          description: `Wagered amount increased by ${wageredChange.toFixed(1)}%`,
          entity: 'Overall',
          value: wageredChange,
          threshold: 250,
          timestamp: new Date().toISOString(),
        })
      }
    }

    return alerts
  }, [kpis, dataHistory])

  // Detect Player Behavior Anomalies
  const behaviorAlerts = useMemo(() => {
    if (!kpis || !breakdown?.byMatka) return []
    const alerts: AlertItem[] = []

    // Check for matka concentration
    const totalWagered = breakdown.byMatka.reduce((sum, matka) => sum + matka.wagered, 0)
    if (totalWagered > 0) {
      const topMatka = breakdown.byMatka[0]
      const topMatkaShare = (topMatka.wagered / totalWagered) * 100
      if (topMatkaShare > 60) {
        alerts.push({
          id: 'behavior-matka-concentration',
          type: 'behavior',
          severity: 'warning',
          title: 'High Matka Concentration',
          description: `Top matka "${topMatka.matkaName || topMatka.matkaId}" accounts for ${topMatkaShare.toFixed(1)}% of total wagered`,
          entity: topMatka.matkaName || topMatka.matkaId,
          value: topMatkaShare,
          threshold: 60,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // Check for unusual player activity
    if (kpis.activePlayers > 0) {
      const avgWageredPerPlayer = kpis.wagered / kpis.activePlayers
      if (avgWageredPerPlayer > 10000) {
        alerts.push({
          id: 'behavior-high-avg-wagered',
          type: 'behavior',
          severity: 'info',
          title: 'High Average Wagered Per Player',
          description: `Average wagered per player is ${formatAmount(convertFromWhitelabelCurrency(avgWageredPerPlayer))}`,
          entity: 'Overall',
          value: avgWageredPerPlayer,
          threshold: 10000,
          timestamp: new Date().toISOString(),
        })
      }
    }

    return alerts
  }, [kpis, breakdown, formatAmount, convertFromWhitelabelCurrency])

  const allAlerts = useMemo(() => {
    return [...volumeAlerts, ...behaviorAlerts].sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 }
      return severityOrder[a.severity] - severityOrder[b.severity]
    })
  }, [volumeAlerts, behaviorAlerts])

  // Notify critical alerts once
  const seenRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    allAlerts.forEach(a => {
      if (a.severity === 'critical' && !seenRef.current.has(a.id)) {
        seenRef.current.add(a.id)
        notify.error(a.description, a.title)
      }
    })
  }, [allAlerts])

  const alertCounts = useMemo(() => {
    return {
      critical: allAlerts.filter((a) => a.severity === 'critical').length,
      warning: allAlerts.filter((a) => a.severity === 'warning').length,
      info: allAlerts.filter((a) => a.severity === 'info').length,
      total: allAlerts.length,
    }
  }, [allAlerts])

  return <Card title="Alerts & Anomalies" sub="Real-time monitoring" tools={<div className={styles.inline}>{alertCounts.critical > 0 && <StatusPill tone="neg">{alertCounts.critical} Critical</StatusPill>}{alertCounts.warning > 0 && <StatusPill tone="warn">{alertCounts.warning} Warning</StatusPill>}{alertCounts.info > 0 && <StatusPill tone="info">{alertCounts.info} Info</StatusPill>}</div>}>
    <Notice title="RTP unavailable for open bets" tone="info">RTP uses final payouts from settled bets. Open entries have no final result yet; use the Matka report for settled performance.</Notice>
    {!allAlerts.length ? <Notice title={kpis ? kpis.wagered > 0 ? 'No open-bet risk alerts' : 'No open Matka bets' : 'Waiting for Matka data'} tone="info">{kpis?.wagered ? 'No volume or concentration alerts detected.' : 'Risk monitoring starts when entries are accepted.'}</Notice> : <div className={styles.stack}>
      <div className={styles.grid3}><Stat variant="bare" label="Critical" value={alertCounts.critical} hue="red" /><Stat variant="bare" label="Warnings" value={alertCounts.warning} hue="amb" /><Stat variant="bare" label="Info" value={alertCounts.info} hue="blu" /></div>
      <ul className={styles.list}>{allAlerts.map(alert => <li key={alert.id} className={styles.item}><div className={styles.row}><h3 className={styles.heading}>{alert.title}</h3><StatusPill tone={alert.severity === 'critical' ? 'neg' : alert.severity === 'warning' ? 'warn' : 'info'}>{alert.severity.toUpperCase()}</StatusPill></div><p className={styles.text}>{alert.description}</p><DescriptionList items={[{ term: 'Entity', value: alert.entity }, { term: 'Value', value: alert.type === 'rtp' ? `${alert.value.toFixed(2)}%` : `${alert.value.toFixed(0)}%` }, { term: 'Threshold', value: `${alert.threshold}%` }]} /></li>)}</ul>
    </div>}
  </Card>
}

