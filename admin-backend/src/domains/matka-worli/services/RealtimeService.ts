import { recomputeInstanceCounters } from '@/domains/matka-worli/services/RiskService.js'
import { publishPlayerEvent, publishDashboard } from '@/domains/matka/services/MatkaBetEvents.js'
import { computeDashboard } from '@/domains/matka/services/LiveAnalyticsService.js'
import { getMatkaDb } from '@/repos/matka/matkaRepo.js'

export async function onBetCreated(bet: any, pubsub: any) {
  try {
    if (bet?.instanceId) {
      const topic = `WORLI_BET_CREATED_${bet.instanceId}`
      const payload = {
        id: bet.id,
        tenant: bet.tenant,
        whitelabelId: bet.whitelabelId,
        userId: bet.userId,
        matkaId: bet.matkaId,
        matkaType: bet.matkaType,
        marketName: bet.marketName,
        marketSession: bet.marketSession || null,
        bidType: bet.bidType,
        betNumbers: bet.betNumbers,
        betAmount: bet.betAmount ? Number(bet.betAmount) : 0,
        payoutMultiplier: bet.payoutMultiplier ? Number(bet.payoutMultiplier) : 0,
        potentialWin: bet.potentialWin ? Number(bet.potentialWin) : null,
        actualWin: bet.actualWin ? Number(bet.actualWin) : null,
        status: bet.status,
        result: bet.result || null,
        settledAt: bet.settledAt ? new Date(bet.settledAt).toISOString() : null,
        currency: bet.currency || 'USD',
        createdAt: bet.createdAt ? new Date(bet.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: bet.updatedAt ? new Date(bet.updatedAt).toISOString() : new Date().toISOString(),
      }
      pubsub.publish({ topic, payload: { worliBetCreated: payload } })
      await recomputeInstanceCounters(bet.instanceId, pubsub)
    }

    // Publish player event for live analysis
    try {
      const tenant = bet.tenant || 'default'
      const wl = bet.whitelabelId || 'default'
      let matkaName: string | null = null
      try {
        const matka = await getMatkaDb(bet.matkaId, tenant)
        matkaName = matka?.name || null
      } catch {
        // Ignore errors fetching matka name
      }

      await publishPlayerEvent(pubsub, {
        id: String(bet.id),
        tenant: bet.tenant,
        whitelabelId: bet.whitelabelId,
        userId: bet.userId,
        userName: null, // Can be fetched from users repo if needed
        matkaId: bet.matkaId,
        matkaName,
        matkaType: bet.matkaType,
        marketName: bet.marketName,
        bidType: bet.bidType,
        betAmount: bet.betAmount ? Number(bet.betAmount) : 0,
        potentialWin: bet.potentialWin ? Number(bet.potentialWin) : null,
        status: bet.status,
        at: bet.createdAt ? new Date(bet.createdAt).toISOString() : new Date().toISOString(),
      })

      // Trigger dashboard update for open bets (throttled)
      process.nextTick(async () => {
        // Delay to ensure transaction is fully committed
        await new Promise(resolve => setTimeout(resolve, 500))
        
        const publishThrottle = (global as any).__matkaDashboardPublishThrottle || new Map<string, number>()
        if (!(global as any).__matkaDashboardPublishThrottle) {
          (global as any).__matkaDashboardPublishThrottle = publishThrottle
        }
        
        const now = Date.now()
        const scope = { tenant, whitelabelId: wl }
        const topicKey = `${tenant}:${wl}:open`
        const lastPublish = publishThrottle.get(topicKey) || 0
        
        // Throttle: Only publish if last publish was more than 500ms ago
        if (now - lastPublish < 500) {
          return
        }
        
        try {
          const snapshot = await computeDashboard(scope)
          await publishDashboard(pubsub, scope, snapshot)
          publishThrottle.set(topicKey, now)
        } catch (err) {
        }
      })
    } catch {
      // Best-effort publishing
    }
  } catch {
    // best-effort realtime
  }
}

