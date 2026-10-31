import { expireStaleWelivepayOrders } from '../repos/welivepayOrdersRepo.js'

// How often the cleanup runs.
const RUN_INTERVAL_MS = 5 * 60 * 1000 // every 5 minutes
// Hard-expire threshold. Longer than the 15-min display TTL so a late success webhook for a
// payment made near the deadline can still credit (no money lost); truly abandoned orders are
// cleaned up after this grace window.
const HARD_EXPIRE_AFTER_MS = 30 * 60 * 1000 // 30 minutes

let timer: NodeJS.Timeout | null = null

/** Start the periodic background job that marks stale pending WeLivePay orders as expired. */
export function startWelivepayExpiryJob(): void {
  if (timer) return // already started
  const run = async () => {
    try {
      const expired = await expireStaleWelivepayOrders(HARD_EXPIRE_AFTER_MS)
      if (expired > 0) {
        console.log(`[welivepay-expiry] marked ${expired} stale pending order(s) as expired`)
      }
    } catch (err) {
      console.error('[welivepay-expiry] cleanup failed', err)
    }
  }
  void run() // run once at startup
  timer = setInterval(run, RUN_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref() // don't keep the process alive just for this
}

/** Stop the job (e.g. for graceful shutdown / tests). */
export function stopWelivepayExpiryJob(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
