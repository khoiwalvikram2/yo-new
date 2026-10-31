import type { SportsLiveScope, SportsLiveDashboard } from './LiveAnalyticsService.js'
import { getRedisEmitter } from '@src/realtime/redisPubsub.js'

function scopeTenant(scope?: SportsLiveScope): string {
  return scope?.tenant || 'default'
}

function scopeWhitelabel(scope?: SportsLiveScope): string {
  return scope?.whitelabelId || 'default'
}

export function dashboardTopic(scope?: SportsLiveScope): string {
  return `sports.live.dashboard.${scopeTenant(scope)}.${scopeWhitelabel(scope)}`
}

export function playerTopic(scope?: SportsLiveScope): string {
  return `sports.live.player.${scopeTenant(scope)}.${scopeWhitelabel(scope)}`
}

export async function publishDashboard(pubsub: any, scope: SportsLiveScope, dashboard: SportsLiveDashboard) {
  await pubsub.publish({
    topic: dashboardTopic(scope),
    payload: { sportsLiveDashboard: dashboard },
  })
}

export interface SportsBetEventPayload {
  id: string
  userId: string
  userName?: string | null
  eventId: string
  eventName?: string | null
  marketId: string
  marketName?: string | null
  stake: number
  side: 'back' | 'lay'
  price: number
  status: string
  at: string
  tenant?: string
  whitelabelId?: string
  result?: string | null
  settledAt?: string | null
}

export async function publishPlayerEvent(pubsub: any, event: SportsBetEventPayload) {
  const scope: SportsLiveScope = {
    tenant: event.tenant || 'default',
    whitelabelId: event.whitelabelId || 'default',
  }
  const topic = playerTopic(scope)
  const payload = {
    sportsPlayerEvents: {
      id: event.id,
      userId: event.userId,
      userName: event.userName || null,
      eventId: event.eventId,
      eventName: event.eventName || null,
      marketId: event.marketId,
      marketName: event.marketName || null,
      stake: event.stake,
      side: event.side,
      price: event.price,
      status: event.status,
      at: event.at,
      result: event.result ?? null,
      settledAt: event.settledAt ?? null,
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
    pubsub.publish({
      topic,
      payload,
    }).catch((err: Error) => {
    })
  }
}

