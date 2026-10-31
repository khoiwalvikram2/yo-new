import { FastifyInstance } from 'fastify'
import pg from 'pg'
import { getSSLConfig } from '@shared/db/ssl.js'
import { publishPlayerEvent, dashboardTopic } from '@src/domains/casino/services/CasinoBetEvents.js'
import { computeDashboard } from '@src/domains/casino/services/LiveAnalyticsService.js'
import { getUserDb } from '@src/repos/users/usersRepo.js'
import { getCasinoGamesByIdsDb } from '@src/repos/casino/casinoRepo.js'
import { publishPlayerEvent as publishSportsPlayerEvent, dashboardTopic as sportsDashboardTopic } from '@src/domains/sports/services/SportsBetEvents.js'
import { computeDashboard as computeSportsDashboard } from '@src/domains/sports/services/LiveAnalyticsService.js'
import { db } from '@src/db/client.js'
import { sportsEventsTable, sportsMarketsTable } from '@shared/db/schema.js'
import { eq } from 'drizzle-orm'

export async function registerPgBridge(app: FastifyInstance, connectionString: string) {
  const client = new pg.Client({
    connectionString,
    ssl: getSSLConfig(connectionString),
  })
  await client.connect()
  await client.query('LISTEN wallet_updates')
  await client.query('LISTEN casino_bet_events')
  await client.query('LISTEN sports_bet_events')
  await client.query('LISTEN deposit_request_created')

  client.on('notification', (msg) => {
    try {
      if (msg.channel === 'wallet_updates') {
        const data = JSON.parse(msg.payload || '{}')
        // publish to GraphQL subscribers if available
        // @ts-ignore mercurius pubsub attached on context via this in resolvers, here use app to broadcast
        const pubsub = (app as any).graphql?.pubsub || app['pubsub']
        if (pubsub) {
          // One global topic put every tenant's balance changes on the same
          // stream, so any subscriber received all of them. The NOTIFY payload
          // already carries the tenant, so it costs nothing to separate them.
          // The platform-wide topic is kept for a caller holding `all:*`.
          const walletTenant = data.tenant || 'default'
          pubsub.publish({ topic: `WALLET_UPDATED_${walletTenant}`, payload: { walletUpdated: data } })
          pubsub.publish({ topic: 'WALLET_UPDATED_ALL', payload: { walletUpdated: data } })
        }
      } else if (msg.channel === 'casino_bet_events') {
        const data = JSON.parse(msg.payload || '{}')
        // Expected payload shape:
        // { id, userId, gameId, gameName, status, stake, payout, at, tenant, whitelabelId }
        // @ts-ignore pubsub from mercurius
        const pubsub = (app as any).graphql?.pubsub || app['pubsub']
        if (!pubsub) return

        const tenant = data.tenant || 'default'
        const wl = data.whitelabelId || 'default'
        const userIdNum = Number(data.userId)
        const gameIdNum = Number(data.gameId)

        // Always fetch userName and vendorName to ensure we have the latest data
        // This is async but we don't want to block the notification handler
        Promise.all([
          !isNaN(userIdNum) ? getUserDb(userIdNum, tenant).then(u => u?.name || u?.username || null).catch(() => data.userName || null) : Promise.resolve(data.userName || null),
          !isNaN(gameIdNum) ? getCasinoGamesByIdsDb(tenant, [gameIdNum]).then(games => games[0]?.vendorName || null).catch(() => data.vendorName || null) : Promise.resolve(data.vendorName || null),
        ]).then(([userName, vendorName]) => {
          // Stream player event with fetched userName and vendorName
          publishPlayerEvent(pubsub, {
            id: String(data.id),
            userId: String(data.userId),
            userName: userName || data.userName || null,
            gameId: String(data.gameId),
            gameName: data.gameName || null,
            vendorName: vendorName || data.vendorName || null,
            status: String(data.status),
            stake: Number(data.stake || 0),
            payout: data.payout != null ? Number(data.payout) : null,
            at: data.at || new Date().toISOString(),
            tenant,
            whitelabelId: wl,
          })
        }).catch((err) => {
          // Fallback: publish with data from notification if fetch fails
          publishPlayerEvent(pubsub, {
            id: String(data.id),
            userId: String(data.userId),
            userName: data.userName || null,
            gameId: String(data.gameId),
            gameName: data.gameName || null,
            vendorName: data.vendorName || null,
            status: String(data.status),
            stake: Number(data.stake || 0),
            payout: data.payout != null ? Number(data.payout) : null,
            at: data.at || new Date().toISOString(),
            tenant,
            whitelabelId: wl,
          })
        })

        // Recompute and publish dashboard snapshots for standard windows
        // Use same throttling as mutations to prevent rapid-fire updates
        const windows = [10, 15, 30, 60, 120, 180, 360]
        
        // Use same global throttling map as mutations
        const publishThrottle = (global as any).__casinoDashboardPublishThrottle || new Map<string, number>()
        if (!(global as any).__casinoDashboardPublishThrottle) {
          (global as any).__casinoDashboardPublishThrottle = publishThrottle
        }
        
        const now = Date.now()
        
        for (const wm of windows) {
          const scope = { tenant, whitelabelId: wl, windowMins: wm }
          const topicKey = `${tenant}:${wl}:${wm}`
          const lastPublish = publishThrottle.get(topicKey) || 0
          
          // Throttle: Only publish if last publish was more than 500ms ago
          if (now - lastPublish < 500) {
            continue
          }
          
          // Fire-and-forget; compute caches last snapshot internally
          computeDashboard(scope)
            .then(snapshot => {
              // Wrap publish in try-catch to handle EOF errors gracefully
              pubsub.publish({ topic: dashboardTopic(scope), payload: { casinoLiveDashboard: snapshot } })
                .then(() => {
                  publishThrottle.set(topicKey, Date.now())
                })
                .catch((err: Error) => {
                  // Ignore EOF errors (stream already closed)
                  if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
                    return
                  }
                  // Log other errors but don't throw
                })
            })
            .catch(() => {})
        }
      } else if (msg.channel === 'sports_bet_events') {
        const data = JSON.parse(msg.payload || '{}')
        // Payload: id, userId, eventId, marketId, stake, side, price, status, at, tenant, whitelabelId; plus result, settledAt when settled
        // @ts-ignore pubsub from mercurius
        const pubsub = (app as any).graphql?.pubsub || app['pubsub']
        if (!pubsub) return

        const tenant = data.tenant || 'default'
        const wl = data.whitelabelId || 'default'
        const userIdNum = Number(data.userId)
        const baseEvent = {
          id: String(data.id),
          userId: String(data.userId),
          eventId: String(data.eventId || ''),
          marketId: String(data.marketId || ''),
          stake: Number(data.stake || 0),
          side: (data.side || 'back') as 'back' | 'lay',
          price: Number(data.price || 0),
          status: String(data.status || 'matched'),
          at: data.at || new Date().toISOString(),
          tenant,
          whitelabelId: wl,
          result: data.result != null ? String(data.result) : null,
          settledAt: data.settledAt != null ? (typeof data.settledAt === 'string' ? data.settledAt : new Date(data.settledAt).toISOString()) : null,
        }

        Promise.all([
          !isNaN(userIdNum) ? getUserDb(userIdNum, tenant).then(u => u?.name || u?.username || null).catch(() => null) : Promise.resolve(null),
          data.eventId ? db.select({ name: sportsEventsTable.name }).from(sportsEventsTable)
            .where(eq(sportsEventsTable.id, String(data.eventId)))
            .limit(1)
            .then(rows => rows[0]?.name || null)
            .catch(() => null) : Promise.resolve(null),
          data.marketId ? db.select({ name: sportsMarketsTable.name }).from(sportsMarketsTable)
            .where(eq(sportsMarketsTable.id, String(data.marketId)))
            .limit(1)
            .then(rows => rows[0]?.name || null)
            .catch(() => null) : Promise.resolve(null),
        ]).then(([userName, eventName, marketName]) => {
          publishSportsPlayerEvent(pubsub, {
            ...baseEvent,
            userName: userName || null,
            eventName: eventName || null,
            marketName: marketName || null,
          })
        }).catch(() => {
          publishSportsPlayerEvent(pubsub, {
            ...baseEvent,
            userName: null,
            eventName: null,
            marketName: null,
          })
        })

        // Recompute and publish dashboard snapshot
        // Use throttling to prevent rapid-fire updates
        const publishThrottle = (global as any).__sportsDashboardPublishThrottle || new Map<string, number>()
        if (!(global as any).__sportsDashboardPublishThrottle) {
          (global as any).__sportsDashboardPublishThrottle = publishThrottle
        }
        
        const now = Date.now()
        const scope = { tenant, whitelabelId: wl }
        const topicKey = `sports:${tenant}:${wl}`
        const lastPublish = publishThrottle.get(topicKey) || 0
        
        // Throttle: Only publish if last publish was more than 500ms ago
        if (now - lastPublish >= 500) {
          // Fire-and-forget; compute caches last snapshot internally
          computeSportsDashboard(scope)
            .then(snapshot => {
              // Wrap publish in try-catch to handle EOF errors gracefully
              pubsub.publish({ topic: sportsDashboardTopic(scope), payload: { sportsLiveDashboard: snapshot } })
                .then(() => {
                  publishThrottle.set(topicKey, Date.now())
                })
                .catch((err: Error) => {
                  // Ignore EOF errors (stream already closed)
                  if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
                    return
                  }
                  // Log other errors but don't throw
                })
            })
            .catch(() => {})
        }
      } else if (msg.channel === 'deposit_request_created') {
        const data = JSON.parse(msg.payload || '{}')
        // Expected payload shape:
        // { id, userId, tenant, amount, currency, method, utr, referenceId, proofKey, status, createdAt }
        // @ts-ignore pubsub from mercurius
        const pubsub = (app as any).graphql?.pubsub || app['pubsub']
        if (!pubsub) return

        const tenant = data.tenant || 'default'
        const topic = `DEPOSIT_REQUEST_${tenant}`
        
        // Publish to GraphQL subscription
        pubsub.publish({
          topic,
          payload: {
            depositRequestUpdated: {
              id: data.id,
              tenant: data.tenant,
              userId: data.userId,
              amount: data.amount,
              currency: data.currency || 'INR',
              method: data.method,
              utr: data.utr,
              referenceId: data.referenceId,
              proofKey: data.proofKey,
              status: data.status || 'PENDING',
              reviewerId: null,
              reviewedAt: null,
              note: null,
              walletTxnId: null,
              createdAt: data.createdAt || new Date().toISOString(),
              updatedAt: data.updatedAt || data.createdAt || new Date().toISOString(),
            },
          },
        }).catch((err: Error) => {
          // Ignore EOF errors (stream already closed)
          if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
            return
          }
        })
      }
    } catch {}
  })

  const shutdown = async () => {
    try { await client.query('UNLISTEN *') } catch {}
    try { await client.end() } catch {}
  }
  app.addHook('onClose', async () => { await shutdown() })
}

