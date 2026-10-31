import type { LiveScope, MatkaLiveDashboard } from './LiveAnalyticsService.js'
import { getRedisEmitter } from '@src/realtime/redisPubsub.js'

function scopeTenant(scope?: LiveScope): string {
  return scope?.tenant || 'default'
}

function scopeWhitelabel(scope?: LiveScope): string {
  return scope?.whitelabelId || 'default'
}

export function dashboardTopic(scope?: LiveScope): string {
  // For open bets, we don't use windowMins in topic
  return `matka.live.dashboard.${scopeTenant(scope)}.${scopeWhitelabel(scope)}.open`
}

export function playerTopic(scope?: LiveScope): string {
  return `matka.live.player.${scopeTenant(scope)}.${scopeWhitelabel(scope)}`
}

export function exposureTopic(scope?: LiveScope): string {
  return `matka.live.exposure.${scopeTenant(scope)}.${scopeWhitelabel(scope)}.open`
}

export async function publishDashboard(pubsub: any, scope: LiveScope, dashboard: MatkaLiveDashboard) {
  const topic = dashboardTopic(scope)
  const payload = { matkaLiveDashboard: dashboard }

  // Raw emitter (used by fallback iterators)
  const emitter = getRedisEmitter()
  try {
    emitter.emit({
      topic,
      payload,
    })
  } catch {}

  // GraphQL pubsub (if available)
  if (pubsub && typeof pubsub.publish === 'function') {
    try {
      const result = pubsub.publish({ topic, payload })
      if (result && typeof result.catch === 'function') {
        result.catch(() => {})
      }
    } catch {}
  }
}

export async function publishExposureBook(pubsub: any, scope: LiveScope, exposureBook: any) {
  const topic = exposureTopic(scope)
  const payload = { matkaExposureBook: exposureBook }
  const emitter = getRedisEmitter()
  try {
    emitter.emit({
      topic,
      payload,
    })
  } catch {}

  if (pubsub && typeof pubsub.publish === 'function') {
    try {
      const result = pubsub.publish({ topic, payload })
      if (result && typeof result.catch === 'function') {
        result.catch(() => {})
      }
    } catch {}
  }
}

export interface MatkaBetEventPayload {
  id: string
  tenant?: string
  whitelabelId?: string
  userId: string | number
  userName?: string | null
  matkaId: string
  matkaName?: string | null
  matkaType: string
  marketName: string
  bidType: string
  betAmount: number
  potentialWin?: number | null
  status: string
  at: string
}

export async function publishPlayerEvent(pubsub: any, event: MatkaBetEventPayload) {
  const scope: LiveScope = {
    tenant: event.tenant || 'default',
    whitelabelId: event.whitelabelId || 'default',
  }
  const topic = playerTopic(scope)
  const payload = {
    matkaPlayerEvents: {
      id: event.id,
      userId: String(event.userId),
      userName: event.userName ?? null,
      matkaId: event.matkaId,
      matkaName: event.matkaName ?? null,
      matkaType: event.matkaType,
      marketName: event.marketName,
      bidType: event.bidType,
      betAmount: event.betAmount,
      potentialWin: event.potentialWin != null ? event.potentialWin : null,
      status: event.status,
      at: event.at,
    },
  }

  // Raw emitter
  const emitter = getRedisEmitter()
  try {
    emitter.emit({
      topic,
      payload,
    })
  } catch {}

  // GraphQL pubsub
  if (pubsub && typeof pubsub.publish === 'function') {
    try {
      const result = pubsub.publish({ topic, payload })
      if (result && typeof result.catch === 'function') {
        result.catch(() => {})
      }
    } catch {}
  }
}

