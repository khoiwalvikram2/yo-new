import { createSnapshotStream } from '@src/realtime/snapshotStream.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { resolveSubscriptionTenant } from '@src/domains/common/subscriptionScope.js'
import { subscriptionAgentId, createRecomputeIterator, createFilteredIterator, agentPlayerMatcher } from '@src/realtime/agentScopedLive.js'

export const matkaSubscriptionResolvers = {
  drawStatus: {
    subscribe: async function (this: any) {
      const topic = 'DRAW_STATUS'
      const iterator = this.pubsub.asyncIterator(topic)
      return iterator
    },
    resolve: (payload: any) => payload.drawStatus,
  },
  matkaRiskAlerts: {
    subscribe: async function (this: any, _root: any, args: { scope?: any }, ctx: any) {
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const scope = {
        tenant: resolveSubscriptionTenant(ctx, args?.scope?.tenant, directorTenant || ctx?.tenant || 'default'),
        whitelabelId: resolveSubscriptionTenant(ctx, args?.scope?.whitelabelId, directorTenant || ctx?.whitelabel?.id || 'default'),
      }
      const { getRedisEmitter } = await import('@src/realtime/redisPubsub.js')
      const { computeRiskAlerts } = await import('../services/RiskAlertService.js')
      const { dispatchRiskAlertEmails } = await import('@src/services/alerts/riskAlertEmailService.js')
      const { exposureTopic } = await import('../services/MatkaBetEvents.js') // reuse emitter infra
      const topic = `matka.live.risk.${scope.tenant}.${scope.whitelabelId}.open`
      const hasCtxPubsub = !!ctx?.pubsub?.subscribe
      const hasThisPubsub = !!(this && (this as any).pubsub && (this as any).pubsub.asyncIterator)

      // An agent gets alerts computed over its own players on a stream of its
      // own — never the tenant-wide alert topic, never published onto it, and
      // no alert e-mails dispatched on its behalf.
      const agentId = subscriptionAgentId(ctx)
      if (agentId) {
        const agentScope = { ...scope, agentId }
        return createRecomputeIterator({
          compute: () => computeRiskAlerts(agentScope),
          wrap: (snapshot) => ({ matkaRiskAlerts: snapshot }),
          intervalMs: 7000,
        })
      }

      if (hasCtxPubsub || hasThisPubsub) {
        const iterator = hasCtxPubsub
          ? await ctx.pubsub.subscribe(topic)
          : (this as any).pubsub.asyncIterator(topic)
        const pubsub = ctx?.pubsub || (this as any).pubsub
        let isActive = true
        let previous: any = null
        
        // Safe publish helper
        const safePublish = async (snapshot: any) => {
          if (!isActive) return
          try {
            const res = pubsub.publish({ topic, payload: { matkaRiskAlerts: snapshot } })
            if (res && typeof (res as any).catch === 'function') {
              await (res as any).catch((err: Error) => {
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
        
        try {
          const snapshot = await computeRiskAlerts(scope, previous)
          dispatchRiskAlertEmails({ scope, alerts: snapshot.items }).catch(() => {})
          const LiveAnalyticsService = await import('../services/LiveAnalyticsService.js')
          previous = { kpis: LiveAnalyticsService.computeDashboard ? (await LiveAnalyticsService.computeDashboard(scope)).kpis : null }
          await safePublish(snapshot)
        } catch {}
        let lastSent = Date.now()
        const interval = setInterval(async () => {
          if (!isActive) {
            clearInterval(interval)
            return
          }
          try {
            const now = Date.now()
            if (now - lastSent < 3000) return
            const snapshot = await computeRiskAlerts(scope, previous)
            dispatchRiskAlertEmails({ scope, alerts: snapshot.items }).catch(() => {})
            await safePublish(snapshot)
            lastSent = now
          } catch {}
        }, 7000)
        
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

      return createSnapshotStream({
        emitter: getRedisEmitter(), topic,
        compute: async () => {
          const snapshot = await computeRiskAlerts(scope)
          dispatchRiskAlertEmails({ scope, alerts: snapshot.items }).catch(() => {})
          return snapshot
        },
        extract: message => message?.payload?.matkaRiskAlerts ?? message?.matkaRiskAlerts ?? message,
        wrap: snapshot => ({ matkaRiskAlerts: snapshot }),
        intervalMs: 7000,
      })
    },
    resolve: (payload: any) => payload.matkaRiskAlerts,
  },
  matkaExposureBook: {
    subscribe: async function (this: any, _root: any, args: { scope?: any }, ctx: any) {
      const scope = {
        tenant: resolveSubscriptionTenant(ctx, args?.scope?.tenant, ctx?.tenant || 'default'),
        whitelabelId: resolveSubscriptionTenant(ctx, args?.scope?.whitelabelId, ctx?.whitelabel?.id || 'default'),
      }
      const { exposureTopic } = await import('../services/MatkaBetEvents.js')
      const { computeExposureBook } = await import('../services/ExposureService.js')
      const { getRedisEmitter } = await import('@src/realtime/redisPubsub.js')
      const topic = exposureTopic(scope)
      const hasCtxPubsub = !!ctx?.pubsub?.subscribe
      const hasThisPubsub = !!(this && (this as any).pubsub && (this as any).pubsub.asyncIterator)

      // The book was tenant-wide for every caller, agents included. An agent's
      // book holds only its own players' open bets, and is never read from or
      // published onto the shared exposure topic.
      const agentId = subscriptionAgentId(ctx)
      if (agentId) {
        const agentScope = { ...scope, agentId }
        return createRecomputeIterator({
          compute: () => computeExposureBook(agentScope),
          wrap: (snapshot) => ({ matkaExposureBook: snapshot }),
          tickTopics: [topic],
          intervalMs: 5000,
          minGapMs: 3000,
        })
      }

      if (hasCtxPubsub || hasThisPubsub) {
        const iterator = hasCtxPubsub
          ? await ctx.pubsub.subscribe(topic)
          : (this as any).pubsub.asyncIterator(topic)

        // Publish initial snapshot
        const pubsub = ctx?.pubsub || (this as any).pubsub
        let isActive = true
        
        // Safe publish helper
        const safePublish = async (snapshot: any) => {
          if (!isActive) return
          try {
            const result = pubsub.publish({ topic, payload: { matkaExposureBook: snapshot } })
            if (result && typeof (result as any).catch === 'function') {
              await (result as any).catch((err: Error) => {
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
        
        try {
          const initial = await computeExposureBook(scope)
          await safePublish(initial)
        } catch {}

        // Safety ticker
        let lastSent = Date.now()
        const interval = setInterval(async () => {
          if (!isActive) {
            clearInterval(interval)
            return
          }
          try {
            const now = Date.now()
            if (now - lastSent < 3000) return
            const snapshot = await computeExposureBook(scope)
            await safePublish(snapshot)
            lastSent = now
          } catch {}
        }, 5000)
        
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

      return createSnapshotStream({
        emitter: getRedisEmitter(), topic,
        compute: () => computeExposureBook(scope),
        extract: message => message?.payload?.matkaExposureBook ?? message?.matkaExposureBook ?? message,
        wrap: snapshot => ({ matkaExposureBook: snapshot }),
        intervalMs: 5000,
      })
    },
    resolve: (payload: any) => payload.matkaExposureBook,
  },
  matkaLiveDashboard: {
    subscribe: async function (this: any, _root: any, args: { scope?: any }, ctx: any) {
      // Auth and agent scope are decided here: mercurius skips the context
      // function for WebSockets, so this resolver checks its own caller.
      const agentId = subscriptionAgentId(ctx) ?? undefined

      const scope = {
        tenant: resolveSubscriptionTenant(ctx, args?.scope?.tenant, ctx?.tenant || 'default'),
        whitelabelId: resolveSubscriptionTenant(ctx, args?.scope?.whitelabelId, ctx?.whitelabel?.id || 'default'),
        agentId,
        // No windowMins needed for open bets
      }
      const { dashboardTopic } = await import('../services/MatkaBetEvents.js')
      const { computeDashboard } = await import('../services/LiveAnalyticsService.js')
      const { getRedisEmitter } = await import('@src/realtime/redisPubsub.js')
      const topic = dashboardTopic(scope)

      // An agent never reads the whitelabel's shared dashboard topic (whitelabel
      // and other agents' snapshots) and never publishes its own onto it; its
      // snapshot is recomputed for its own players on each change.
      if (agentId) {
        return createRecomputeIterator({
          compute: () => computeDashboard(scope),
          wrap: (snapshot) => ({ matkaLiveDashboard: snapshot }),
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
        
        // Publish initial snapshot immediately
        const pubsub = ctx?.pubsub || (this as any).pubsub
        let isActive = true
        
        // Safe publish helper
        const safePublish = async (snapshot: any) => {
          if (!isActive) return
          try {
            const publishResult = pubsub.publish({ topic, payload: { matkaLiveDashboard: snapshot } })
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
        
        try {
          const initialSnapshot = await computeDashboard(scope)
          await safePublish(initialSnapshot)
        } catch (err: any) {
        }
        
        // Fallback: recompute and publish at ~60s cadence (reduced from 5s)
        let lastSent = Date.now()
        const interval = setInterval(async () => {
          if (!isActive) {
            clearInterval(interval)
            return
          }
          try {
            const now = Date.now()
            if (now - lastSent < 3000) return
            const snapshot = await computeDashboard(scope)
            await safePublish(snapshot)
            lastSent = now
          } catch (err: any) {
          }
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
      
      return createSnapshotStream({
        emitter: getRedisEmitter(), topic,
        compute: () => computeDashboard(scope),
        extract: message => message?.payload?.matkaLiveDashboard ?? message?.matkaLiveDashboard ?? message,
        wrap: snapshot => ({ matkaLiveDashboard: snapshot }),
        intervalMs: 60000,
      })
    },
    resolve: (payload: any) => payload.matkaLiveDashboard,
  },
  matkaPlayerEvents: {
    subscribe: async function (this: any, _root: any, args: { scope?: any }, ctx: any) {
      const scope = {
        tenant: resolveSubscriptionTenant(ctx, args?.scope?.tenant, ctx?.tenant || 'default'),
        whitelabelId: resolveSubscriptionTenant(ctx, args?.scope?.whitelabelId, ctx?.whitelabel?.id || 'default'),
      }
      const { playerTopic } = await import('../services/MatkaBetEvents.js')
      const { getRedisEmitter } = await import('@src/realtime/redisPubsub.js')
      const topic = playerTopic(scope)

      // There was no agent filter at all: an agent watched every matka bet of
      // the whitelabel. It now sees its own players' events only.
      const agentId = subscriptionAgentId(ctx)
      if (agentId) {
        const players = agentPlayerMatcher(agentId, scope.tenant || 'default')
        return createFilteredIterator({
          topic,
          extract: (msg) => msg?.payload?.matkaPlayerEvents ?? msg?.matkaPlayerEvents ?? null,
          allow: (event) => players.has(event?.userId),
          wrap: (event) => ({ matkaPlayerEvents: event }),
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
        const data = msg?.payload?.matkaPlayerEvents ?? msg?.matkaPlayerEvents ?? msg
        const normalizedData = {
          ...data,
          userName: data?.userName ?? null,
          matkaName: data?.matkaName ?? null,
        }
        const payload = { matkaPlayerEvents: normalizedData }
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
      const event = payload.matkaPlayerEvents
      return {
        ...event,
        userName: event?.userName ?? null,
        matkaName: event?.matkaName ?? null,
      }
    },
  },
  matkaResultEvents: {
    subscribe: async function (this: any, _root: any, _args: any, ctx: any) {
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const topic = `MATKA_RESULT_EVENTS.${tenant}`
      const hasCtxPubsub = !!ctx?.pubsub?.subscribe
      const hasThisPubsub = !!(this && (this as any).pubsub && (this as any).pubsub.asyncIterator)
      
      if (hasCtxPubsub || hasThisPubsub) {
        const iterator = hasCtxPubsub
          ? await ctx.pubsub.subscribe(topic)
          : (this as any).pubsub.asyncIterator([`MATKA_RESULT_CREATED`, `MATKA_RESULT_ROLLED_BACK`])
        return iterator
      }
      
      // Fallback to raw emitter
      const { getRedisEmitter } = await import('@src/realtime/redisPubsub.js')
      const emitter = getRedisEmitter()
      const queue: any[] = []
      let resolveFn: ((value: any) => void) | null = null
      let isActive = true
      
      const listener = (msg: any, done: () => void) => {
        if (!isActive) { done(); return }
        const data = msg?.payload?.matkaResultEvents ?? msg?.matkaResultEvents ?? msg
        if (resolveFn) {
          resolveFn({ value: data, done: false })
          resolveFn = null
        } else {
          queue.push(data)
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
    resolve: (payload: any) => payload.matkaResultEvents,
  },
}
