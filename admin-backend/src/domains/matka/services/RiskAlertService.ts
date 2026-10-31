import { computeDashboard, LiveScope } from './LiveAnalyticsService.js'

export interface MatkaRiskAlert {
  id: string
  type: 'rtp' | 'volume' | 'behavior' | 'concentration' | 'exposure'
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string
  entity: string
  value: number
  threshold: number
  at: string
}

export interface MatkaRiskAlerts {
  at: string
  items: MatkaRiskAlert[]
}

export async function computeRiskAlerts(scope: LiveScope, previous?: { kpis?: any }): Promise<MatkaRiskAlerts> {
  const dash = await computeDashboard(scope)
  const alerts: MatkaRiskAlert[] = []
  const at = new Date().toISOString()

  // This dashboard contains pending/active bets only. Their final returns are
  // unknown, so payout/stake is not realised RTP and must never trigger an RTP
  // threshold alert. Settled performance belongs to the Matka report.

  // Concentration risk
  const totalWagered = dash.breakdown.byMatka.reduce((s, m) => s + m.wagered, 0)
  if (totalWagered > 0 && dash.breakdown.byMatka.length > 0) {
    const top = dash.breakdown.byMatka[0]
    const share = (top.wagered / totalWagered) * 100
    if (share > 60) {
      alerts.push({
        id: `concentration-matka-${top.matkaId}`,
        type: 'concentration',
        severity: 'warning',
        title: 'High Matka Concentration',
        description: `${top.matkaName || top.matkaId} at ${share.toFixed(1)}% of total wagered`,
        entity: top.matkaName || top.matkaId,
        value: share,
        threshold: 60,
        at,
      })
    }
  }

  // Volume spikes (compare with previous kpis if available)
  if (previous?.kpis && previous.kpis.betsPerMin > 0) {
    const change = ((dash.kpis.betsPerMin - previous.kpis.betsPerMin) / previous.kpis.betsPerMin) * 100
    if (change > 200) {
      alerts.push({
        id: 'volume-spike-bets',
        type: 'volume',
        severity: 'warning',
        title: 'Bet Volume Spike',
        description: `Bets/min changed ${previous.kpis.betsPerMin.toFixed(1)} → ${dash.kpis.betsPerMin.toFixed(1)} (${change.toFixed(1)}%)`,
        entity: 'Overall',
        value: change,
        threshold: 200,
        at,
      })
    }
  }

  return {
    at,
    items: alerts,
  }
}

