import { getRedisEmitter } from '@src/realtime/redisPubsub.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { hasPermission } from '@/domains/common/auth.js'

function auditTopic(tenant: string = 'default'): string {
  return `audit.events.${tenant}`
}

export function publishAuditEvent(pubsub: any, event: any, tenant: string = 'default') {
  const topic = auditTopic(tenant)
  const payload = {
    auditEvents: {
      id: event.id,
      tenant: event.tenant || tenant,
      actorId: event.actorId,
      domain: event.domain,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      before: event.before,
      after: event.after,
      timestamp: event.timestamp || new Date().toISOString(),
    }
  }
  
  // Use raw Redis emitter
  const emitter = getRedisEmitter()
  try {
    emitter.emit({
      topic,
      payload,
    })
  } catch (err) {
  }
  
  // Also publish via GraphQL pubsub
  if (pubsub && typeof pubsub.publish === 'function') {
    try {
      const result = pubsub.publish({ topic, payload })
      if (result && typeof result.catch === 'function') {
        result.catch((err: Error) => {
        })
      }
    } catch (err) {
    }
  }
}

export function getEffectiveTenant(ctx: any): string {
  const directorTenant = getEffectiveTenantForDirector(ctx)
  return directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
}

function hasWhitelabelAdminRole(ctx: any): boolean {
  const roles = Array.isArray(ctx?.user?.roles) ? ctx.user.roles : []
  return roles.some(
    (r: string) =>
      r === 'Whitelabel Admin' ||
      r?.toLowerCase() === 'whitelabel_admin' ||
      (typeof r === 'string' && r.toLowerCase().includes('whitelabel'))
  )
}

function isWhitelabelTenantUser(ctx: any): boolean {
  const tenant = getEffectiveTenant(ctx)
  return Boolean(ctx?.user?.sub && tenant && tenant !== 'default')
}

/** Subscriptions over WS may have tenant but no user in context if connectionParams are not merged. Allow whitelabel tenant. */
function isWhitelabelTenantContext(ctx: any): boolean {
  const tenant = getEffectiveTenant(ctx)
  return Boolean(tenant && tenant !== 'default')
}

// Helper to check permissions (allows agents; allows Whitelabel Admin or any whitelabel-tenant user for view)
function checkAuditPermission(ctx: any): void {
  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) return
  if (hasWhitelabelAdminRole(ctx)) return
  if (isWhitelabelTenantUser(ctx)) return
  if (isWhitelabelTenantContext(ctx)) return
  if (!hasPermission(ctx?.permissions ?? [], 'audit.events', 'view')) {
    throw new Error('Forbidden: insufficient permissions for audit events')
  }
}

// Helper to check if event matches subscription filters
function matchesFilters(event: any, filters: any, agentId?: string): boolean {
  if (filters.domain) {
    const domains = Array.isArray(filters.domain) ? filters.domain : [filters.domain]
    if (!domains.includes(event.domain)) {
      return false
    }
  }
  
  if (filters.action) {
    const actions = Array.isArray(filters.action) ? filters.action : [filters.action]
    if (!actions.includes(event.action)) {
      return false
    }
  }
  
  if (filters.actorId && event.actorId !== filters.actorId) {
    return false
  }
  
  // Agent filtering is handled separately in the subscription setup
  // We don't need to check it here as the events are already filtered by agent's players
  
  return true
}

export const auditSubscriptionResolvers = {
  auditEvents: {
    subscribe: async function (this: any, _root: any, args: { filters?: any }, ctx: any) {
      const tenant = getEffectiveTenant(ctx)
      checkAuditPermission(ctx)
      
      const filters = args.filters || {}
      const topic = `audit.events.${tenant}`
      
      // Handle agent filtering if needed
      let agentPlayerIds: Set<number> | null = null
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        try {
          const { PlayerAuthService } = await import('../../../domains/players/services/PlayerAuthService.js')
          const playerAuthService = new PlayerAuthService()
          const playerIds = await playerAuthService.getAgentPlayerIds(ctx.user.agentId, tenant)
          agentPlayerIds = new Set(playerIds)
          
          if (agentPlayerIds.size === 0) {
            // Agent has no players, return empty iterator
            return {
              async *[Symbol.asyncIterator]() {
                // Empty iterator
              }
            }
          }
        } catch (err) {
          agentPlayerIds = null
        }
      }
      
      const hasCtxPubsub = !!ctx?.pubsub?.subscribe
      const hasThisPubsub = !!(this && (this as any).pubsub && (this as any).pubsub.asyncIterator)
      
      if (hasCtxPubsub || hasThisPubsub) {
        const iterator = hasCtxPubsub
          ? await ctx.pubsub.subscribe(topic)
          : (this as any).pubsub.asyncIterator(topic)
        
        // Wrap iterator to filter by subscription filters and agent's players
        return {
          async *[Symbol.asyncIterator]() {
            for await (const value of iterator) {
              const data = value?.payload?.auditEvents ?? value?.auditEvents ?? value
              
              // Filter by agent's players if needed
              if (agentPlayerIds !== null && data?.actorId) {
                const eventActorId = parseInt(data.actorId, 10)
                if (isNaN(eventActorId) || !agentPlayerIds.has(eventActorId)) {
                  // Event is not from agent's player, skip it
                  continue
                }
              }
              
              // Apply subscription filters
              if (!matchesFilters(data, filters, ctx?.user?.agentId)) {
                continue
              }
              
              yield { auditEvents: data }
            }
          }
        }
      }
      
      // Fallback to raw emitter
      const { getRedisEmitter } = await import('@src/realtime/redisPubsub.js')
      const emitter = getRedisEmitter()
      const queue: any[] = []
      let resolveFn: ((value: any) => void) | null = null
      let isActive = true
      
      const listener = (msg: any, done: () => void) => {
        if (!isActive) {
          done()
          return
        }
        
        const data = msg?.payload?.auditEvents ?? msg?.auditEvents ?? msg
        
        // Filter by agent's players if needed
        if (agentPlayerIds !== null && data?.actorId) {
          const eventActorId = parseInt(data.actorId, 10)
          if (isNaN(eventActorId) || !agentPlayerIds.has(eventActorId)) {
            // Event is not from agent's player, skip it
            done()
            return
          }
        }
        
        // Apply subscription filters
        if (!matchesFilters(data, filters, ctx?.user?.agentId)) {
          done()
          return
        }
        
        const payload = { auditEvents: data }
        
        if (resolveFn) {
          resolveFn({ value: payload, done: false })
          resolveFn = null
        } else {
          queue.push(payload)
        }
        done()
      }
      
      emitter.on(topic, listener)
      
      return {
        next: () => {
          if (!isActive) {
            return Promise.resolve({ value: undefined, done: true })
          }
          
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false })
          }
          
          return new Promise((resolve) => {
            resolveFn = resolve
          })
        },
        return: () => {
          isActive = false
          emitter.off(topic, listener)
          return Promise.resolve({ value: undefined, done: true })
        },
        throw: (err: Error) => {
          isActive = false
          emitter.off(topic, listener)
          return Promise.reject(err)
        },
        [Symbol.asyncIterator]() {
          return this
        },
      }
    },
    resolve: (payload: any) => payload.auditEvents,
  },
}
