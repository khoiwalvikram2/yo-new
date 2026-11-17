import { and, eq, lte } from 'drizzle-orm'
import { whitelabelPgSettings, welivepayOrders } from '@shared/db/schema.js'
import { decrypt } from '@shared/security/cryptoVault.js'
import { getWelivepayPayin } from '@shared/services/welivepay/welivepayClient.js'
import { db } from '../db/client.js'
import { getWelivepayBaseUrl } from '../config/env.js'
import { findOrderByOrderId, creditOrderOnSuccess, markOrderStatus, shouldCreditOnWebhook, type WelivepayOrderRow } from '../repos/welivepayOrdersRepo.js'

/**
 * Settles one pay-in from WeLivePay's authenticated order detail, never from a callback body: the local
 * order must belong to `tenant`, and the provider's amount and gateway must match it before any credit.
 * With `force` false the call is a claimed background check: it skips an order checked within the last
 * minute, so concurrent callers do not hit the provider twice.
 */
export async function reconcileWelivepayPayin(orderid: string, tenant: string, force = true): Promise<WelivepayOrderRow> {
  const local = await findOrderByOrderId(orderid)
  if (!local || local.tenant !== tenant) throw new Error('Payment order not found')
  if (local.status === 'success' || local.depositRequestId != null) return local
  if (!force) {
    const [claimed] = await db.update(welivepayOrders).set({ nextCheckAt: new Date(Date.now() + 60_000) })
      .where(and(eq(welivepayOrders.id, local.id), lte(welivepayOrders.nextCheckAt, new Date())))
      .returning({ id: welivepayOrders.id })
    if (!claimed) return local
  }
  const [settings] = await db.select().from(whitelabelPgSettings).where(eq(whitelabelPgSettings.tenant, tenant)).limit(1)
  const cipher = local.merchantKeyEncrypted || settings?.secretSiteKeyEncrypted
  if (!cipher) throw new Error('Payment gateway is not configured')
  const remote = await getWelivepayPayin({ baseUrl: getWelivepayBaseUrl(), key: decrypt(cipher), orderid })
  if (Number(local.amount) !== remote.amount || remote.gateway.toUpperCase() !== local.gateway) throw new Error('Payment order verification mismatch')
  if (shouldCreditOnWebhook(local, remote.status, remote.amount).credit) {
    await creditOrderOnSuccess({ orderid, txnRef: remote.txnRef })
  } else if (remote.status === 'expired') await markOrderStatus(orderid, 'expired', remote.txnRef)
  return (await findOrderByOrderId(orderid))!
}
