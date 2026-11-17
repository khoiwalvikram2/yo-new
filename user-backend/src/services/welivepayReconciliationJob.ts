import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { welivepayOrders, welivepayPayouts } from '@shared/db/schema.js'
import { WelivepayPayoutService } from '@shared/services/welivepay/welivepayPayoutService.js'
import { db } from '../db/client.js'
import { getWelivepayBaseUrl } from '../config/env.js'
import { reconcileWelivepayPayin } from './welivepayPayinStatusService.js'

let timer: NodeJS.Timeout | null = null
let running = false

/** How many orders one tick may check, so a backlog never floods the provider. */
const BATCH = 8

/**
 * Catches callbacks WeLivePay never delivered. Every minute it reads the authenticated status of a few
 * recent unpaid pay-ins (pending, or expired locally within the last week, since a verified late payment
 * still credits once). It never initiates a payment or a transfer. Each order is claimed through
 * `next_check_at`, so several backend instances share the work instead of repeating it.
 */
export function startWelivepayReconciliationJob() {
  if (timer) return
  const run = async () => {
    if (running) return
    running = true
    try {
      const now = new Date()
      // An unpaid order past its checkout link is rarely paid late; check it far less often.
      const nextCheck = (status: string) => new Date(Date.now() + (status === 'pending' ? 120_000 : 30 * 60_000))
      const payins = await db.select().from(welivepayOrders).where(and(
        inArray(welivepayOrders.status, ['pending', 'expired']),
        lte(welivepayOrders.nextCheckAt, now),
        gte(welivepayOrders.createdAt, new Date(Date.now() - 7 * 86400_000)),
      )).orderBy(welivepayOrders.nextCheckAt).limit(BATCH)
      for (const order of payins) {
        const [claimed] = await db.update(welivepayOrders).set({ nextCheckAt: nextCheck(order.status) })
          .where(and(eq(welivepayOrders.id, order.id), lte(welivepayOrders.nextCheckAt, now)))
          .returning({ id: welivepayOrders.id })
        if (!claimed) continue
        try { await reconcileWelivepayPayin(order.orderid, order.tenant) } catch { console.warn('[welivepay] pay-in verification deferred', order.orderid) }
      }
      // Payouts already submitted and not final. It reads status only; it never submits a transfer.
      const payouts = await db.select().from(welivepayPayouts).where(and(
        inArray(welivepayPayouts.status, ['pending', 'requested', 'processing']),
        isNotNull(welivepayPayouts.submittedAt),
        lte(welivepayPayouts.nextCheckAt, now),
      )).orderBy(welivepayPayouts.nextCheckAt).limit(BATCH)
      const service = new WelivepayPayoutService(db, getWelivepayBaseUrl())
      for (const payout of payouts) {
        const [claimed] = await db.update(welivepayPayouts).set({ nextCheckAt: new Date(Date.now() + 120_000) })
          .where(and(eq(welivepayPayouts.id, payout.id), lte(welivepayPayouts.nextCheckAt, now)))
          .returning({ id: welivepayPayouts.id })
        if (!claimed) continue
        try { await service.reconcile(payout.orderid, payout.tenant) } catch { console.warn('[welivepay] payout verification deferred', payout.orderid) }
      }
    } catch { console.warn('[welivepay] reconciliation temporarily unavailable') }
    finally { running = false }
  }
  timer = setInterval(run, 60_000)
  timer.unref()
  void run()
}

export function stopWelivepayReconciliationJob() { if (timer) clearInterval(timer); timer = null }
