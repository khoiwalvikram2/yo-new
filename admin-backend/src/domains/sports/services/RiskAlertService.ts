import { computeDashboard, type SportsLiveScope } from './LiveAnalyticsService.js'
import { getAppConfigDb } from '@src/repos/app-config/appConfigRepo.js'
import { getSportAlertConfigs, getLeagueAlertConfigs, getEventAlertConfigs, type AlertConfig } from '@src/repos/sports/riskAlertsRepo.js'

export type SportsRiskSeverity = 'critical' | 'warning' | 'info'
export type SportsRiskEntityType = 'overall' | 'sport' | 'league' | 'event'

export interface SportsRiskAlert {
  id: string
  entityType: SportsRiskEntityType
  entityId: string
  entityName?: string | null
  severity: SportsRiskSeverity
  metric: string
  value: number
  threshold: number
  description: string
  channel: 'email'
  at: string
}

export interface SportsRiskAlerts {
  at: string
  items: SportsRiskAlert[]
}

const rateLimiter = new Map<string, number>()

export async function computeSportsRiskAlerts(scope: SportsLiveScope): Promise<SportsRiskAlerts> {
  const dashboard = await computeDashboard(scope)
  const at = new Date().toISOString()
  const tenant = scope.tenant || 'default'
  const whitelabelId = scope.whitelabelId || 'default'

  const [appConfig, sportIds, leagueIds, eventIds] = [
    await getAppConfigDb(whitelabelId),
    (dashboard.breakdown?.bySport || []).map((s) => String(s.sportId)).filter(Boolean),
    (dashboard.breakdown?.byLeague || []).map((s) => String(s.leagueId)).filter(Boolean),
    (dashboard.breakdown?.byEvent || []).map((s) => String(s.eventId)).filter(Boolean),
  ]

  const [sportConfigs, leagueConfigs, eventConfigs] = await Promise.all([
    getSportAlertConfigs(whitelabelId, sportIds),
    getLeagueAlertConfigs(whitelabelId, leagueIds),
    getEventAlertConfigs(whitelabelId, eventIds),
  ])

  const alerts: SportsRiskAlert[] = []
  const globalExposureCap = toNumber(appConfig.overallExposureCap)

  const pushAlert = (params: {
    entityType: SportsRiskEntityType
    entityId: string
    entityName?: string | null
    value: number
    threshold: number
    description: string
    severity: SportsRiskSeverity
    alertRateLimit?: number | null
  }) => {
    // Scoped per whitelabel and per agent view: the limiter is process-wide, so
    // an unscoped key let one whitelabel's (or one agent's) alert suppress the
    // same entity's alert for everyone else.
    const key = `${tenant}:${whitelabelId}:${scope.agentId ?? '*'}:${params.entityType}:${params.entityId}:${params.severity}`
    if (isRateLimited(key, params.alertRateLimit)) {
      return
    }
    alerts.push({
      id: `${params.entityType}-${params.entityId}-net-exposure`,
      entityType: params.entityType,
      entityId: params.entityId,
      entityName: params.entityName ?? null,
      severity: params.severity,
      metric: 'netExposure',
      value: params.value,
      threshold: params.threshold,
      description: params.description,
      channel: 'email',
      at,
    })
  }

  // Overall exposure cap
  if (globalExposureCap) {
    const netExposureValue = Math.abs(Number(dashboard.kpis?.netExposure ?? 0))
    if (netExposureValue > globalExposureCap) {
      const severity = computeSeverity(netExposureValue, globalExposureCap)
      pushAlert({
        entityType: 'overall',
        entityId: `${tenant}:${whitelabelId}`,
        entityName: tenant || 'Overall', // Use tenant ID instead of appName
        value: netExposureValue,
        threshold: globalExposureCap,
        description: `Overall net exposure ${formatCurrency(netExposureValue)} exceeded cap ${formatCurrency(globalExposureCap)}.`,
        severity,
        alertRateLimit: 2,
      })
    }
  }

  for (const sport of dashboard.breakdown?.bySport || []) {
    evaluateEntity({
      statsValue: Math.abs(Number(sport.netExposure ?? 0)),
      entityName: sport.sportName || null,
      entityId: String(sport.sportId),
      config: sportConfigs[String(sport.sportId)],
      fallbackThreshold: globalExposureCap,
      pushAlert,
      entityType: 'sport',
    })
  }

  for (const league of dashboard.breakdown?.byLeague || []) {
    evaluateEntity({
      statsValue: Math.abs(Number(league.netExposure ?? 0)),
      entityName: league.leagueName || null,
      entityId: String(league.leagueId),
      config: leagueConfigs[String(league.leagueId)],
      fallbackThreshold: globalExposureCap,
      pushAlert,
      entityType: 'league',
    })
  }

  for (const event of dashboard.breakdown?.byEvent || []) {
    evaluateEntity({
      statsValue: Math.abs(Number(event.netExposure ?? 0)),
      entityName: event.eventName || null,
      entityId: String(event.eventId),
      config: eventConfigs[String(event.eventId)],
      fallbackThreshold: globalExposureCap,
      pushAlert,
      entityType: 'event',
    })
  }

  return { at, items: alerts }
}

function evaluateEntity(params: {
  statsValue: number
  entityName?: string | null
  entityId: string
  config?: AlertConfig
  fallbackThreshold: number | null
  pushAlert: (opts: {
    entityType: SportsRiskEntityType
    entityId: string
    entityName?: string | null
    value: number
    threshold: number
    description: string
    severity: SportsRiskSeverity
    alertRateLimit?: number | null
  }) => void
  entityType: SportsRiskEntityType
}) {
  const { config, statsValue } = params
  if (!config || config.alertOnBreach === false) return

  const threshold = selectThreshold(config, params.fallbackThreshold)
  if (!threshold) return

  if (statsValue <= threshold) return
  const severity = computeSeverity(statsValue, threshold)
  const channel = (config.alertChannel || 'email').toLowerCase()
  if (channel !== 'email') return

  params.pushAlert({
    entityType: params.entityType,
    entityId: params.entityId,
    entityName: params.entityName ?? null,
    value: statsValue,
    threshold,
    description: `Net exposure ${formatCurrency(statsValue)} breached limit ${formatCurrency(threshold)}.`,
    severity,
    alertRateLimit: config.alertRateLimit,
  })
}

function selectThreshold(config: AlertConfig, fallback: number | null): number | null {
  const candidates = [
    config.exchangeExposureCap,
    config.bookmakerExposureCap,
    config.fancyExposureCap,
  ].filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[]
  if (candidates.length) return candidates[0]
  if (config.riskThreshold != null && Number.isFinite(config.riskThreshold)) {
    return config.riskThreshold
  }
  return fallback ?? null
}

function computeSeverity(value: number, threshold: number): SportsRiskSeverity {
  const ratio = threshold <= 0 ? 0 : value / threshold
  if (ratio >= 1.25) return 'critical'
  if (ratio >= 1) return 'warning'
  return 'info'
}

function isRateLimited(key: string, rateLimit?: number | null): boolean {
  const now = Date.now()
  const intervalMs = getIntervalMs(rateLimit)
  const last = rateLimiter.get(key)
  if (last && now - last < intervalMs) {
    return true
  }
  rateLimiter.set(key, now)
  return false
}

function getIntervalMs(rateLimit?: number | null): number {
  if (!rateLimit || rateLimit <= 0) {
    return 60_000 // default 1 min between alerts
  }
  const perMinute = Math.max(rateLimit, 1)
  return Math.max(60_000 / perMinute, 5_000)
}

function toNumber(value: unknown): number | null {
  if (value == null) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

