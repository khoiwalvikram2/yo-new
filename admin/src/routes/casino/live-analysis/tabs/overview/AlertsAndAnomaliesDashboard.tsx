import { useMemo } from 'react'
import { CASINO_RTP_BAND, casinoRtpStanding } from '@/routes/live-analysis/liveWorkspaceStatsModel'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Notice } from '@/ui/components/Notice'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../CasinoLive.module.css'
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
    byGame?: Array<{
      gameId: string
      gameName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byVendor?: Array<{
      vendorId: string
      vendorName?: string | null
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
    timestamp: number
  }>
  windowMins?: number
}

export function AlertsAndAnomaliesDashboard({
  kpis,
  breakdown,
  dataHistory = [],
  windowMins = 10,
}: AlertsAndAnomaliesDashboardProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  // Detect RTP Alerts
  const rtpAlerts = useMemo(() => {
    if (!kpis || !breakdown?.byGame) return []
    const alerts: AlertItem[] = []

    // Check overall RTP, on the band the RTP card uses. A window with (almost) no bets is not judged: with none at
    // all RTP is 0%, which raised a critical alert while the card beside it said the same 0% was fine.
    const standing = casinoRtpStanding(kpis.rtp, kpis.wagered)
    if (standing === 'low') {
      alerts.push({
        id: 'rtp-overall-low',
        type: 'rtp',
        severity: 'critical',
        title: 'Overall RTP Below Threshold',
        description: `Overall RTP is ${kpis.rtp.toFixed(2)}%, which is below the acceptable threshold of ${CASINO_RTP_BAND.low}%`,
        entity: 'Overall',
        value: kpis.rtp,
        threshold: CASINO_RTP_BAND.low,
        timestamp: new Date().toISOString(),
      })
    } else if (standing === 'high') {
      alerts.push({
        id: 'rtp-overall-high',
        type: 'rtp',
        severity: 'warning',
        title: 'Overall RTP Above Expected',
        description: `Overall RTP is ${kpis.rtp.toFixed(2)}%, which is significantly above expected range`,
        entity: 'Overall',
        value: kpis.rtp,
        threshold: CASINO_RTP_BAND.high,
        timestamp: new Date().toISOString(),
      })
    }

    // Check individual games
    breakdown.byGame.forEach((game) => {
      const gameRtp = game.wagered > 0 ? (game.payouts / game.wagered) * 100 : 0
      if (game.wagered > 100 && gameRtp < 85) {
        alerts.push({
          id: `rtp-game-${game.gameId}`,
          type: 'rtp',
          severity: 'critical',
          title: `Game RTP Alert: ${game.gameName || game.gameId}`,
          description: `Game RTP is ${gameRtp.toFixed(2)}% with ${game.bets} bets`,
          entity: game.gameName || game.gameId,
          value: gameRtp,
          threshold: 85,
          timestamp: new Date().toISOString(),
        })
      } else if (game.wagered > 100 && gameRtp > 115) {
        alerts.push({
          id: `rtp-game-high-${game.gameId}`,
          type: 'rtp',
          severity: 'warning',
          title: `High RTP Alert: ${game.gameName || game.gameId}`,
          description: `Game RTP is ${gameRtp.toFixed(2)}% with ${game.bets} bets`,
          entity: game.gameName || game.gameId,
          value: gameRtp,
          threshold: 115,
          timestamp: new Date().toISOString(),
        })
      }
    })

    return alerts
  }, [kpis, breakdown])

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
    if (!kpis || !breakdown?.byGame) return []
    const alerts: AlertItem[] = []

    // Check for single player dominance (if we had player-level data)
    // For now, check game concentration
    const totalWagered = breakdown.byGame.reduce((sum, game) => sum + game.wagered, 0)
    if (totalWagered > 0) {
      const topGame = breakdown.byGame[0]
      const topGameShare = (topGame.wagered / totalWagered) * 100
      if (topGameShare > 60) {
        alerts.push({
          id: 'behavior-game-concentration',
          type: 'behavior',
          severity: 'warning',
          title: 'High Game Concentration',
          description: `Top game "${topGame.gameName || topGame.gameId}" accounts for ${topGameShare.toFixed(1)}% of total wagered`,
          entity: topGame.gameName || topGame.gameId,
          value: topGameShare,
          threshold: 60,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // Check for unusual player activity (if active players is very low but wagered is high)
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
    return [...rtpAlerts, ...volumeAlerts, ...behaviorAlerts].sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 }
      return severityOrder[a.severity] - severityOrder[b.severity]
    })
  }, [rtpAlerts, volumeAlerts, behaviorAlerts])

  const alertCounts = useMemo(() => {
    return {
      critical: allAlerts.filter((a) => a.severity === 'critical').length,
      warning: allAlerts.filter((a) => a.severity === 'warning').length,
      info: allAlerts.filter((a) => a.severity === 'info').length,
      total: allAlerts.length,
    }
  }, [allAlerts])

  return <Card title="Alerts & Anomalies" tools={alertCounts.total > 0 && <div className={styles.actions}>{alertCounts.critical > 0 && <StatusPill tone="neg">{alertCounts.critical} Critical</StatusPill>}{alertCounts.warning > 0 && <StatusPill tone="warn">{alertCounts.warning} Warning</StatusPill>}{alertCounts.info > 0 && <StatusPill tone="info">{alertCounts.info} Info</StatusPill>}</div>}>
    {!allAlerts.length ? (kpis && !(kpis.wagered > 0)
      ? <Notice tone="info" title="No activity">{`No casino bets in the last ${windowMins} minutes, so there is nothing to check.`}</Notice>
      : <Notice tone="ok" title="All systems normal">No alerts detected</Notice>) : <div className={styles.stack}><div className={styles.grid3}><Stat variant="bare" label="Critical" value={alertCounts.critical} hue="red" size="compact" /><Stat variant="bare" label="Warnings" value={alertCounts.warning} hue="amb" size="compact" /><Stat variant="bare" label="Info" value={alertCounts.info} hue="blu" size="compact" /></div>
      {allAlerts.map(alert => <div key={alert.id} className={styles.details}><Notice title={alert.title} tone={alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warn' : 'info'} action={<StatusPill tone={alert.severity === 'critical' ? 'neg' : alert.severity === 'warning' ? 'warn' : 'info'}>{alert.severity.toUpperCase()}</StatusPill>}>{alert.description}</Notice>
        <DescriptionList items={[{ term: 'Entity', value: alert.entity }, { term: 'Value', value: alert.type === 'rtp' ? `${alert.value.toFixed(2)}%` : `${alert.value.toFixed(0)}%` }, { term: 'Threshold', value: `${alert.threshold}%` }]} /></div>)}
    </div>}
  </Card>
}

