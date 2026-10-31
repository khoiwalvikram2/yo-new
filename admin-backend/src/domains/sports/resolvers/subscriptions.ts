import { getRedisEmitter } from '@src/realtime/redisPubsub.js'
import { computeDashboard } from '@src/domains/sports/services/LiveAnalyticsService.js'
import { createSportsDashboardStream } from '@src/domains/sports/services/sportsDashboardStream.js'
import { dashboardTopic, playerTopic } from '@src/domains/sports/services/SportsBetEvents.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { resolveSubscriptionTenant } from '@src/domains/common/subscriptionScope.js'
import { subscriptionAgentId, createRecomputeIterator, createFilteredIterator, agentPlayerMatcher } from '@src/realtime/agentScopedLive.js'
import { hasPermission } from '@src/domains/common/auth.js'

export const sportsSubscriptionResolvers = {
  // Unified book for exchange/bookmaker
  book: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const topic = `sports.book.${args.marketId}`
      const iterator = await ctx.pubsub.subscribe(topic)
      return iterator
    },
    resolve: (payload: any) => payload.book,
  },
  fancyBook: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const topic = `sports.fancy.${args.marketId}`
      const iterator = await ctx.pubsub.subscribe(topic)
      return iterator
    },
    resolve: (payload: any) => payload.fancyBook,
  },
  marketState: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const topic = 'sports.market_state'
      const iterator = await ctx.pubsub.subscribe(topic)
      return iterator
    },
    resolve: (payload: any) => payload.market,
  },
  orderbook: {
    subscribe: function (_root: any, args: any, ctx: any) {
      const topic = `sports.orderbook.${args.marketId}`
      
      // Get the raw emitter directly (not the wrapped ctx.pubsub)
      const emitter = getRedisEmitter()
      
      const queue: any[] = []
      let resolve: ((value: any) => void) | null = null
      let isActive = true
      
      const listener = (msg: any, done: () => void) => {
        if (!isActive) {
          done()
          return
        }
        const data = msg?.payload?.orderbook
        if (resolve) {
          resolve({ value: data, done: false })
          resolve = null
        } else {
          queue.push(data)
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
            const value = queue.shift()
            return Promise.resolve({ value, done: false })
          }
          // Wait for next message
          return new Promise(r => { resolve = r })
        },
        return: () => {
          isActive = false
          emitter.removeListener(topic, listener)
          return Promise.resolve({ value: undefined, done: true })
        },
        throw: (error: any) => {
          isActive = false
          emitter.removeListener(topic, listener)
          return Promise.reject(error)
        },
        [Symbol.asyncIterator]() {
          return this
        }
      }
    },
    // We yield the OrderbookMessage directly from the iterator,
    // so resolve must return the payload as-is
    resolve: (payload: any) => payload,
  },
  eventLive: {
    subscribe: function (_root: any, args: any) {
      const topic = `sports.event.${args.eventId}`
      
      const emitter = getRedisEmitter()
      const queue: any[] = []
      let resolve: ((value: any) => void) | null = null
      let isActive = true
      const listener = (msg: any, done: () => void) => {
        if (!isActive) return done()
        const data = msg?.payload?.eventLive
        if (resolve) {
          resolve({ value: data, done: false })
          resolve = null
        } else {
          queue.push(data)
        }
        done()
      }
      emitter.on(topic, listener)
      return {
        next: () => {
          if (!isActive) return Promise.resolve({ value: undefined, done: true })
          if (queue.length > 0) {
            const value = queue.shift()
            return Promise.resolve({ value, done: false })
          }
          return new Promise(r => { resolve = r })
        },
        return: () => {
          isActive = false
          emitter.removeListener(topic, listener)
          return Promise.resolve({ value: undefined, done: true })
        },
        throw: (error: any) => {
          isActive = false
          emitter.removeListener(topic, listener)
          return Promise.reject(error)
        },
        [Symbol.asyncIterator]() {
          return this
        }
      }
    },
    resolve: (payload: any) => payload,
  },
  sportsRiskAlerts: {
    subscribe: async function (this: any, _root: any, args: { scope?: any }, ctx: any) {
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const scope = {
        tenant: resolveSubscriptionTenant(ctx, args?.scope?.tenant, directorTenant || ctx?.tenant || 'default'),
        whitelabelId: resolveSubscriptionTenant(ctx, args?.scope?.whitelabelId, directorTenant || ctx?.whitelabel?.id || 'default'),
      }
      const topic = `sports.live.risk.${scope.tenant}.${scope.whitelabelId}`
      const hasCtxPubsub = !!ctx?.pubsub?.subscribe
      const hasThisPubsub = !!(this && (this as any).pubsub && (this as any).pubsub.asyncIterator)
      const { computeSportsRiskAlerts } = await import('../services/RiskAlertService.js')
      const { dispatchRiskAlertEmails } = await import('@src/services/alerts/riskAlertEmailService.js')

      // An agent gets alerts computed over its own players, on a stream of its
      // own: never the tenant topic (the whitelabel's alerts), never published
      // onto it, and no alert e-mails sent on its behalf.
      const agentId = subscriptionAgentId(ctx)
      if (agentId) {
        return createRecomputeIterator({
          compute: () => computeSportsRiskAlerts({ ...scope, agentId }),
          wrap: (snapshot) => ({ sportsRiskAlerts: snapshot }),
          intervalMs: 6000,
        })
      }

      if (hasCtxPubsub || hasThisPubsub) {
        const iterator = hasCtxPubsub
          ? await ctx.pubsub.subscribe(topic)
          : (this as any).pubsub.asyncIterator(topic)
        const pubsub = ctx?.pubsub || (this as any).pubsub
        let isActive = true
        
        // Safe publish helper that checks if subscription is still active
        const safePublish = async (snapshot: any) => {
          if (!isActive) return
          try {
            const res = pubsub.publish({ topic, payload: { sportsRiskAlerts: snapshot } })
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
          const snapshot = await computeSportsRiskAlerts(scope)
          dispatchRiskAlertEmails({ scope, alerts: snapshot.items.map(alert => ({
            id: alert.id,
            title: `${alert.metric} Alert`,
            description: alert.description,
            entity: alert.entityName || alert.entityId,
            severity: alert.severity,
            value: alert.value,
            threshold: alert.threshold,
            at: alert.at,
          })) }).catch(() => {})
          safePublish(snapshot)
        } catch {}
        let lastSent = Date.now()
        const interval = setInterval(async () => {
          if (!isActive) {
            clearInterval(interval)
            return
          }
          try {
            const now = Date.now()
            if (now - lastSent < 4000) return
            const snapshot = await computeSportsRiskAlerts(scope)
            dispatchRiskAlertEmails({ scope, alerts: snapshot.items.map(alert => ({
            id: alert.id,
            title: `${alert.metric} Alert`,
            description: alert.description,
            entity: alert.entityName || alert.entityId,
            severity: alert.severity,
            value: alert.value,
            threshold: alert.threshold,
            at: alert.at,
          })) }).catch(() => {})
            await safePublish(snapshot)
            lastSent = now
          } catch {}
        }, 6000)
        
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

      const emitter = getRedisEmitter()
      const queue: any[] = []
      let resolveFn: ((value: any) => void) | null = null
      let isActive = true
      const listener = (msg: any, done: () => void) => {
        if (!isActive) { done(); return }
        const data = msg?.payload?.sportsRiskAlerts ?? msg?.sportsRiskAlerts ?? msg
        if (resolveFn) {
          resolveFn({ value: data, done: false })
          resolveFn = null
        } else {
          queue.push(data)
        }
        done()
      }
      emitter.on(topic, listener)

      try {
        const snapshot = await computeSportsRiskAlerts(scope)
        dispatchRiskAlertEmails({ scope, alerts: snapshot.items.map(alert => ({
          id: alert.id,
          title: `${alert.metric} Alert`,
          description: alert.description,
          entity: alert.entityName || alert.entityId,
          severity: alert.severity,
          value: alert.value,
          threshold: alert.threshold,
          at: alert.at,
        })) }).catch(() => {})
        emitter.emit({ topic, payload: { sportsRiskAlerts: snapshot } })
      } catch {}

      const interval = setInterval(async () => {
        try {
          const snapshot = await computeSportsRiskAlerts(scope)
          dispatchRiskAlertEmails({ scope, alerts: snapshot.items.map(alert => ({
            id: alert.id,
            title: `${alert.metric} Alert`,
            description: alert.description,
            entity: alert.entityName || alert.entityId,
            severity: alert.severity,
            value: alert.value,
            threshold: alert.threshold,
            at: alert.at,
          })) }).catch(() => {})
          emitter.emit({ topic, payload: { sportsRiskAlerts: snapshot } })
        } catch {}
      }, 6000)

      return {
        next: () => {
          if (!isActive) return Promise.resolve({ value: undefined, done: true } as any)
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false } as any)
          return new Promise((resolve) => { resolveFn = resolve })
        },
        return: () => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          clearInterval(interval)
          return Promise.resolve({ value: undefined, done: true } as any)
        },
        throw: (err: any) => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          clearInterval(interval)
          return Promise.reject(err)
        },
        [Symbol.asyncIterator]() { return this as any },
      } as AsyncIterator<any>
    },
    resolve: (payload: any) => payload.sportsRiskAlerts,
  },
  sportsLiveDashboard: {
    subscribe: async function (this: any, _root: any, args: { scope?: any }, ctx: any) {
      // Auth and agent scope are decided here: mercurius skips the context
      // function for WebSockets, so this resolver checks its own caller.
      const agentId = subscriptionAgentId(ctx) ?? undefined

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const scope = {
        tenant: resolveSubscriptionTenant(ctx, args?.scope?.tenant, directorTenant || ctx?.tenant || 'default'),
        whitelabelId: resolveSubscriptionTenant(ctx, args?.scope?.whitelabelId, directorTenant || ctx?.whitelabel?.id || 'default'),
        agentId,
      }
      const topic = dashboardTopic(scope)

      // An agent never reads the whitelabel's shared dashboard topic (whitelabel
      // snapshots, and other subscribers' — other agents' — snapshots) and never
      // publishes its own onto it. Its snapshot is recomputed for its players;
      // the shared topic only says when something changed.
      if (agentId) {
        return createRecomputeIterator({
          compute: () => computeDashboard(scope),
          wrap: (snapshot) => ({ sportsLiveDashboard: snapshot }),
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
            await pubsub.publish({ topic, payload: { sportsLiveDashboard: snapshot } })
          } catch (err: any) {
            // Ignore EOF errors (stream already closed)
            if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
              return
            }
            // Log other errors but don't throw
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
      
      // Deliver the first frame locally instead of waiting for a safety tick or topic publish.
      return createSportsDashboardStream({
        emitter: getRedisEmitter(),
        topic,
        compute: () => computeDashboard(scope),
      })

    },
    resolve: (payload: any) => payload.sportsLiveDashboard,
  },
  sportsPlayerEvents: {
    // The parameter list used to begin with a spurious `_this`, so every
    // argument was shifted one place: `args` received the context and `ctx`
    // received the GraphQLResolveInfo. Every read below — the director tenant,
    // ctx.tenant, ctx.user.type, ctx.pubsub — was therefore against the wrong
    // object, so this subscription always watched the `default` tenant and never
    // applied agent scoping. `this` is bound by the caller, which is what the
    // `this.pubsub` fallback further down relies on.
    subscribe: async function (this: any, _root: any, args: { scope?: any }, ctx: any) {
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const scope = {
        tenant: resolveSubscriptionTenant(ctx, args?.scope?.tenant, directorTenant || ctx?.tenant || 'default'),
        whitelabelId: resolveSubscriptionTenant(ctx, args?.scope?.whitelabelId, directorTenant || ctx?.whitelabel?.id || 'default'),
      }
      const topic = playerTopic(scope)

      // An agent receives its own players' events only (subtree + referral),
      // checked against a set that refreshes on a miss so new players appear.
      // The old wrapper used a set fixed at subscribe time and an async
      // generator whose return() could not end a socket with no traffic.
      const agentId = subscriptionAgentId(ctx)
      if (agentId) {
        const players = agentPlayerMatcher(agentId, scope.tenant)
        return createFilteredIterator({
          topic,
          extract: (msg) => msg?.payload?.sportsPlayerEvents ?? msg?.sportsPlayerEvents ?? null,
          allow: (event) => players.has(event?.userId),
          wrap: (event) => ({ sportsPlayerEvents: event }),
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
        const data = msg?.payload?.sportsPlayerEvents ?? msg?.sportsPlayerEvents ?? msg

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
            if (queue.length > 100) {
              queue.splice(0, queue.length - 100)
            }
            return Promise.resolve({ value, done: false } as any)
          }
          return new Promise((resolve) => { resolveFn = resolve })
        },
        return: () => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.resolve({ value: undefined, done: true } as any)
        },
        throw: (err: any) => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.reject(err)
        },
        [Symbol.asyncIterator]() { return this as any },
      } as AsyncIterator<any>
    },
    resolve: (payload: any) => payload.sportsPlayerEvents,
  },
  // Bet Stream & Pattern Detection Subscriptions
  betPlaced: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const topic = args.eventId ? `sports.bet.placed.${args.eventId}` : 'sports.bet.placed'
      const emitter = getRedisEmitter()
      const queue: any[] = []
      let resolveFn: ((value: any) => void) | null = null
      let isActive = true
      subscriptionAgentId(ctx) // refuses a socket with no session, or an agent session with no id
      const watchesAllTenants = hasPermission(ctx?.permissions ?? [], 'all', '*')
      const callerTenant = String(getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant || 'default'))

      // Get agent's player IDs if agent is logged in
      let agentPlayerIds: Set<number> | null = null
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        try {
          const { PlayerAuthService } = await import(
            "@src/domains/players/services/PlayerAuthService.js"
          );
          const playerAuthService = new PlayerAuthService();
          // CRITICAL: For Director Admin, use effective tenant based on mode
          const directorTenant = getEffectiveTenantForDirector(ctx)
          const tenant = directorTenant ?? (ctx?.tenant || "default");
          const playerIds = await playerAuthService.getAgentPlayerIds(
            ctx.user.agentId,
            tenant
          );
          agentPlayerIds = new Set(playerIds);
        } catch (error) {
          // If error, agent won't see any bets (fail secure)
          agentPlayerIds = new Set();
        }
      }
      
      const listener = (msg: any, done: () => void) => {
        if (!isActive) { done(); return }
        const data = msg?.payload?.betPlaced ?? msg?.betPlaced ?? msg
        
        // Verify eventId matches (safety check - topic is already event-specific)
        if (args.eventId && data?.eventId && String(data.eventId) !== String(args.eventId)) {
          done();
          return;
        }

        // The topic is per event, not per whitelabel: every whitelabel's bets on
        // the same event share it. Only a platform admin may watch them all.
        if (!watchesAllTenants && data?.tenant && String(data.tenant) !== callerTenant) {
          done();
          return;
        }

        // Filter by agent's players if agent is logged in
        if (agentPlayerIds !== null) {
          const betUserId = data?.userId ? Number(data.userId) : null;
          // Check if userId is valid number and belongs to agent's players
          if (betUserId === null || isNaN(betUserId) || !agentPlayerIds.has(betUserId)) {
            // Bet is not from agent's player, skip it
            done();
            return;
          }
        }
        
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
            if (queue.length > 100) {
              queue.splice(0, queue.length - 100)
            }
            return Promise.resolve({ value, done: false } as any)
          }
          return new Promise((resolve) => { resolveFn = resolve })
        },
        return: () => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.resolve({ value: undefined, done: true } as any)
        },
        throw: (err: any) => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.reject(err)
        },
        [Symbol.asyncIterator]() { return this as any },
      } as AsyncIterator<any>
    },
    resolve: (payload: any) => payload.betPlaced || payload,
  },
  patternDetected: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const topic = args.eventId 
        ? `sports.pattern.detected.${args.eventId}`
        : 'sports.pattern.detected'
      const emitter = getRedisEmitter()
      const queue: any[] = []
      let resolveFn: ((value: any) => void) | null = null
      let isActive = true
      
      // Scoped like betPlaced: the topic is per event and shared by every whitelabel, so a caller
      // sees only its own whitelabel's patterns (a platform admin sees all), and an agent only its
      // own players'. An event without a tenant (published before it carried one) is dropped for
      // everyone except a platform admin.
      subscriptionAgentId(ctx) // refuses a socket with no session, or an agent session with no id
      const watchesAllTenants = hasPermission(ctx?.permissions ?? [], 'all', '*')
      const callerTenant = String(getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant || 'default'))
      let agentPlayerIds: Set<number> | null = null
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        try {
          const { PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js')
          agentPlayerIds = new Set(await new PlayerAuthService().getAgentPlayerIds(ctx.user.agentId, callerTenant))
        } catch {
          agentPlayerIds = new Set() // fail secure: no patterns
        }
      }

      const listener = (msg: any, done: () => void) => {
        if (!isActive) { done(); return }
        const data = msg?.payload?.patternDetected ?? msg?.patternDetected ?? msg
        if (!watchesAllTenants && String(data?.tenant ?? '') !== callerTenant) {
          done()
          return
        }
        if (agentPlayerIds !== null) {
          const playerId = Number(data?.userId)
          if (!Number.isFinite(playerId) || !agentPlayerIds.has(playerId)) {
            done()
            return
          }
        }
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
            if (queue.length > 100) {
              queue.splice(0, queue.length - 100)
            }
            return Promise.resolve({ value, done: false } as any)
          }
          return new Promise((resolve) => { resolveFn = resolve })
        },
        return: () => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.resolve({ value: undefined, done: true } as any)
        },
        throw: (err: any) => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.reject(err)
        },
        [Symbol.asyncIterator]() { return this as any },
      } as AsyncIterator<any>
    },
    resolve: (payload: any) => payload.patternDetected || payload,
  },
  automationTriggered: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const topic = args.eventId 
        ? `sports.automation.triggered.${args.eventId}`
        : 'sports.automation.triggered'
      const emitter = getRedisEmitter()
      const queue: any[] = []
      let resolveFn: ((value: any) => void) | null = null
      let isActive = true
      
      const listener = (msg: any, done: () => void) => {
        if (!isActive) { done(); return }
        const data = msg?.payload?.automationTriggered ?? msg?.automationTriggered ?? msg
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
            if (queue.length > 100) {
              queue.splice(0, queue.length - 100)
            }
            return Promise.resolve({ value, done: false } as any)
          }
          return new Promise((resolve) => { resolveFn = resolve })
        },
        return: () => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.resolve({ value: undefined, done: true } as any)
        },
        throw: (err: any) => {
          isActive = false
          resolveFn = null
          queue.length = 0
          try { emitter.removeListener(topic, listener) } catch {}
          return Promise.reject(err)
        },
        [Symbol.asyncIterator]() { return this as any },
      } as AsyncIterator<any>
    },
    resolve: (payload: any) => payload.automationTriggered || payload,
  },
}
