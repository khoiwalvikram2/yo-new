import type { LiveScope, CasinoLiveDashboard } from './LiveAnalyticsService.js'
import { getRedisEmitter } from '@src/realtime/redisPubsub.js'

function scopeTenant(scope?: LiveScope): string {
  return scope?.tenant || 'default'
}

function scopeWhitelabel(scope?: LiveScope): string {
  return scope?.whitelabelId || 'default'
}

export function dashboardTopic(scope?: LiveScope): string {
  const windowMins = scope?.windowMins ?? 5
  return `casino.live.dashboard.${scopeTenant(scope)}.${scopeWhitelabel(scope)}.${windowMins}`
}

export function playerTopic(scope?: LiveScope): string {
  return `casino.live.player.${scopeTenant(scope)}.${scopeWhitelabel(scope)}`
}

export async function publishDashboard(pubsub: any, scope: LiveScope, dashboard: CasinoLiveDashboard) {
  await pubsub.publish({
    topic: dashboardTopic(scope),
    payload: { casinoLiveDashboard: dashboard },
  })
}

export interface CasinoBetEventPayload {
  id: string
  userId: string
  userName?: string | null
  gameId: string
  gameName?: string | null
  vendorName?: string | null
  status: string
  stake: number
  payout?: number | null
  at: string
  tenant?: string
  whitelabelId?: string
}

export async function publishPlayerEvent(pubsub: any, event: CasinoBetEventPayload) {
  const scope: LiveScope = {
    tenant: event.tenant || 'default',
    whitelabelId: event.whitelabelId || 'default',
  }
  const topic = playerTopic(scope)
  const payload = {
    casinoPlayerEvents: {
      id: event.id,
      userId: event.userId,
      userName: event.userName || null,
      gameId: event.gameId,
      gameName: event.gameName || null,
      vendorName: event.vendorName || null,
      status: event.status,
      stake: event.stake,
      payout: event.payout != null ? event.payout : null,
      at: event.at,
    }
  }
  
  // Use raw Redis emitter to ensure events reach subscriptions
  // Subscriptions use raw emitter, so publish must also use raw emitter
  const emitter = getRedisEmitter()
  emitter.emit({
    topic,
    payload,
  })
  
  // Also publish via GraphQL pubsub for compatibility (non-blocking)
  if (pubsub && typeof pubsub.publish === 'function') {
    try {
      const publishResult = pubsub.publish({
        topic,
        payload,
      })
      // Only call catch if it returns a Promise
      if (publishResult && typeof publishResult.catch === 'function') {
        publishResult.catch((err: Error) => {
        })
      }
    } catch (err) {
    }
  }
}

