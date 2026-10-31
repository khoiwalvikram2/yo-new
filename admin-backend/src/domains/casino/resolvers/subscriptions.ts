import { listJackpots, incrementPot as incrementJackpotPot } from '@/stores/index.js'
import { computeDashboard, type LiveScope } from '../services/LiveAnalyticsService.js'
import { dashboardTopic, playerTopic } from '../services/CasinoBetEvents.js'
import { getRedisEmitter } from '@src/realtime/redisPubsub.js'
import { createSnapshotStream } from '@src/realtime/snapshotStream.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { resolveSubscriptionTenant } from '@src/domains/common/subscriptionScope.js'
import { subscriptionAgentId, createRecomputeIterator, createFilteredIterator, agentPlayerMatcher } from '@src/realtime/agentScopedLive.js'

export const casinoSubscriptionResolvers = {
  jackpotPot: {
    subscribe: async function (this: any) {
      const topic = 'JACKPOT'
      const iterator = this.pubsub.asyncIterator(topic)
      let isActive = true
      
      // Safe publish helper
      const safePublish = (updated: any) => {
        if (!isActive) return
        try {
          this.pubsub.publish({ topic, payload: { jackpotPot: updated } }).catch((err: Error) => {
            // Ignore EOF errors (stream already closed)
            if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
              return
            }
          })
        } catch (err: any) {
          // Ignore EOF errors (stream already closed)
          if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
            return
          }
        }
      }
      
      const interval = setInterval(() => {
        if (!isActive) {
          clearInterval(interval)
          return
        }
        for (const jp of listJackpots()) {
          incrementJackpotPot(jp.id, Math.round(Math.random() * 200))
          const updated = listJackpots().find(j => j.id === jp.id)
          if (updated) safePublish(updated)
        }
      }, 3000)
      
      // Override return to clean up interval and mark as inactive
      const originalReturn = iterator.return
      // @ts-ignore
      iterator.return = async () => {
        isActive = false
        clearInterval(interval)
        if (originalReturn) {
          try {
            return await originalReturn.call(iterator)
          } catch (err: any) {
            // Ignore errors during cleanup
            if (!err?.message?.includes('EOF') && !err?.message?.includes('stream.push')) {
            }
          }
        }
        return { value: undefined, done: true }
      }
      return iterator
    },
    resolve: (payload: any) => payload.jackpotPot,
  },
  casinoLiveDashboard: {
    subscribe: async function (this: any, _root: any, args: { scope?: LiveScope }, ctx: any) {
      // Auth and agent scope are decided here: mercurius skips the context
      // function for WebSockets, so this resolver checks its own caller.
      const agentId = subscriptionAgentId(ctx) ?? undefined

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const scope: LiveScope = {
        tenant: resolveSubscriptionTenant(ctx, args?.scope?.tenant, directorTenant || ctx?.tenant || 'default'),
        whitelabelId: resolveSubscriptionTenant(ctx, args?.scope?.whitelabelId, directorTenant || ctx?.whitelabel?.id || 'default'),
        windowMins: args?.scope?.windowMins ?? 5,
        agentId,
      }
      const topic = dashboardTopic(scope)

      // An agent never reads the whitelabel's shared dashboard topic (whitelabel
      // and other agents' snapshots) and never publishes its own onto it; its
      // snapshot is recomputed for its own players on each change.
      if (agentId) {
        return createRecomputeIterator({
          compute: () => computeDashboard(scope),
          wrap: (snapshot) => ({ casinoLiveDashboard: snapshot }),
          tickTopics: [topic],
          intervalMs: 60000,
          minGapMs: 3000,
        })
      }
      const hasCtxPubsub = !!ctx?.pubsub?.subscribe
      const hasThisPubsub = !!(this && (this as any).pubsub && (this as any).pubsub.asyncIterator)
      
      if (hasCtxPubsub || hasThisPubsub) {
        const iterator = hasCtxPubsub
          ? await ctx.pubsub.subscribe(topic)
          : (this as any).pubsub.asyncIterator(topic)
        
        let isActive = true
        const pubsub = ctx?.pubsub || (this as any).pubsub
        
        // Safe publish helper that checks if subscription is still active
        const safePublish = async (snapshot: any) => {
          if (!isActive) return
          try {
            const publishResult = pubsub.publish({ topic, payload: { casinoLiveDashboard: snapshot } })
            if (publishResult && typeof publishResult.catch === 'function') {
              await publishResult.catch((err: Error) => {
                // Ignore EOF errors (stream already closed)
                if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
                  return
                }
              })
            }
          } catch (err: any) {
            // Ignore EOF errors (stream already closed)
            if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
              return
            }
          }
        }
        
        // Send initial snapshot immediately
        try {
          const initialSnapshot = await computeDashboard(scope)
          safePublish(initialSnapshot)
        } catch {}
        
        // Fallback: recompute and publish at ~60s cadence (reduced from 5s)
        let lastSent = 0
        const interval = setInterval(async () => {
          if (!isActive) {
            clearInterval(interval)
            return
          }
          try {
            const now = Date.now()
            // Ensure minimum 3 seconds between publishes (backend throttling)
            if (now - lastSent < 3000) return
            const snapshot = await computeDashboard(scope)
            await safePublish(snapshot)
            lastSent = now
          } catch {}
        }, 60000) // 60 seconds instead of 5
        
        // Override return to clean up interval and mark as inactive
        const originalReturn = iterator.return
        // @ts-ignore
        iterator.return = async () => {
          isActive = false
          clearInterval(interval)
          if (originalReturn) {
            try {
              return await originalReturn.call(iterator)
            } catch (err: any) {
              // Ignore errors during cleanup
              if (!err?.message?.includes('EOF') && !err?.message?.includes('stream.push')) {
              }
            }
          }
          return { value: undefined, done: true }
        }
        return iterator
      }
      
      // Deliver the first frame locally; retain live transport updates and the safety refresh.
      return createSnapshotStream({
        emitter: getRedisEmitter(), topic,
        compute: () => computeDashboard(scope),
        extract: message => message?.payload?.casinoLiveDashboard ?? message?.casinoLiveDashboard ?? message,
        wrap: snapshot => ({ casinoLiveDashboard: snapshot }),
      })

    },
    resolve: (payload: any) => payload.casinoLiveDashboard,
  },
  casinoPlayerEvents: {
    // The parameter list used to begin with a spurious `_this`, so every
    // argument was shifted one place: `args` received the context and `ctx`
    // received the GraphQLResolveInfo. Every read below — the director tenant,
    // ctx.tenant, ctx.user.type, ctx.pubsub — was therefore against the wrong
    // object, so this subscription always watched the `default` tenant and never
    // applied agent scoping. `this` is bound by the caller, which is what the
    // `this.pubsub` fallback further down relies on.
    subscribe: async function (this: any, _root: any, args: { scope?: LiveScope }, ctx: any) {
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const scope: LiveScope = {
        tenant: resolveSubscriptionTenant(ctx, args?.scope?.tenant, directorTenant || ctx?.tenant || 'default'),
        whitelabelId: resolveSubscriptionTenant(ctx, args?.scope?.whitelabelId, directorTenant || ctx?.whitelabel?.id || 'default'),
      }
      const topic = playerTopic(scope)

      // There was no agent filter at all: an agent watched every casino bet of
      // the whitelabel, player names included. It now sees its own players only.
      const agentId = subscriptionAgentId(ctx)
      if (agentId) {
        const players = agentPlayerMatcher(agentId, scope.tenant || 'default')
        return createFilteredIterator({
          topic,
          extract: (msg) => msg?.payload?.casinoPlayerEvents ?? msg?.casinoPlayerEvents ?? null,
          allow: (event) => players.has(event?.userId),
          wrap: (event) => ({ casinoPlayerEvents: event }),
        })
      }

      const hasCtxPubsub = !!ctx?.pubsub?.subscribe
      const hasThisPubsub = !!(this && (this as any).pubsub && (this as any).pubsub.asyncIterator)
      if (hasCtxPubsub || hasThisPubsub) {
        const iterator = hasCtxPubsub
          ? await ctx.pubsub.subscribe(topic)
          : (this as any).pubsub.asyncIterator(topic)
        return iterator
      }
      // Fallback to raw emitter
      const emitter = getRedisEmitter()
      const queue: any[] = []
      let resolveFn: ((value: any) => void) | null = null
      let isActive = true

      const listener = (msg: any, done: () => void) => {
        if (!isActive) { done(); return }
        // Extract the casinoPlayerEvents from the message
        const data = msg?.payload?.casinoPlayerEvents ?? msg?.casinoPlayerEvents ?? msg
        // Ensure userName and vendorName are null (not undefined) for GraphQL
        const normalizedData = {
          ...data,
          userName: data?.userName ?? null,
          vendorName: data?.vendorName ?? null,
        }
        // Wrap in payload structure for resolve function
        const payload = { casinoPlayerEvents: normalizedData }
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
          if (!isActive) return Promise.resolve({ value: undefined, done: true } as any)
          if (queue.length > 0) {
            const value = queue.shift()
            return Promise.resolve({ value, done: false } as any)
          }
          return new Promise((resolve) => { resolveFn = resolve })
        },
        return: () => {
          isActive = false
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.resolve({ value: undefined, done: true } as any)
        },
        throw: (err: any) => {
          isActive = false
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.reject(err)
        },
        [Symbol.asyncIterator]() { return this as any },
      } as AsyncIterator<any>
    },
    resolve: (payload: any) => {
      const event = payload.casinoPlayerEvents
      // Ensure userName and vendorName are null (not undefined) for GraphQL
      return {
        ...event,
        userName: event?.userName ?? null,
        vendorName: event?.vendorName ?? null,
      }
    },
  },
}
