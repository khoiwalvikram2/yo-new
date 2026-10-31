import { lockVipPlayer, assertVipDepositAllowed } from '@shared/vip/depositAccess.js'
import { assertPlayerCanFund } from '@shared/services/rgEnforcement.js'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { whitelabelPgSettings, users } from '@shared/db/schema.js'
import { decrypt } from '@shared/security/cryptoVault.js'
import { createWelivepayPayment } from '@shared/services/welivepay/welivepayClient.js'
import { generateOrderId } from '@shared/services/welivepay/orderId.js'
import { createWelivepayOrder, markOrderStatus, setOrderPaymentLink } from '../repos/welivepayOrdersRepo.js'
import { getUserDetail } from '../repos/userAppRepo.js'
import { getWelivepayBaseUrl, isWelivepayAllowedForUser } from '../config/env.js'

export interface CreateWelivepayDepositResult {
  paymentLink: string
  qrImage: string
  orderId: string
}

export async function createWelivepayDeposit(params: {
  userId: number
  tenant: string
  amount: number
}, createPayment = createWelivepayPayment): Promise<CreateWelivepayDepositResult> {
  // TEMP test gate: only allow specific user IDs while testing (WELIVEPAY_ALLOWED_USER_IDS).
  if (!isWelivepayAllowedForUser(params.userId)) {
    throw new Error('Online payment is not available right now')
  }

  const [settings] = await db.select().from(whitelabelPgSettings)
    .where(eq(whitelabelPgSettings.tenant, params.tenant)).limit(1)

  if (!settings || !settings.enabled) throw new Error('Online payment is not available right now')
  if (!settings.secretSiteKeyEncrypted) throw new Error('Payment gateway is not configured')

  // Block credit players (parity with the manual deposit flow, which rejects these).
  const [u] = await db.select({ playerType: users.playerType })
    .from(users).where(and(eq(users.id, params.userId), eq(users.tenant, params.tenant))).limit(1)
  if (!u) throw new Error('User not found')
  if (u.playerType === 'AGENT_CREDIT' || u.playerType === 'WHITELABEL_CREDIT') {
    throw new Error('Deposits are disabled for credit players. Please contact your agent.')
  }

  const min = settings.minDeposit != null ? Number(settings.minDeposit) : 10
  const max = settings.maxDeposit != null ? Number(settings.maxDeposit) : Number.MAX_SAFE_INTEGER
  if (params.amount < Math.max(min, 10)) throw new Error(`Minimum deposit is ${Math.max(min, 10)}`)
  if (params.amount > max) throw new Error(`Maximum deposit is ${max}`)

  const user = await getUserDetail(params.userId, params.tenant)
  if (!user?.mobileNo) throw new Error('Please add a mobile number to your profile before depositing')

  const key = decrypt(settings.secretSiteKeyEncrypted)
  const orderid = generateOrderId(params.userId)

  // Reserve first: the pending order is written under the player's VIP lock and
  // committed before the provider is called. A slow provider then holds neither
  // the lock nor a pool connection, and an order the provider accepted always
  // has a local row for its webhook to credit.
  await db.transaction(async tx => {
    await lockVipPlayer(tx, params.tenant, params.userId)
    await assertPlayerCanFund(params.tenant, params.userId, tx)
    const snapshot = await assertVipDepositAllowed(tx, params.tenant, params.userId, { method: 'GATEWAY', amount: params.amount })
    await createWelivepayOrder({
      tenant: params.tenant,
      userId: params.userId,
      orderid,
      amount: params.amount,
      paymentLink: null, vipPolicySnapshot: snapshot,
    }, tx)
  })

  let result: Awaited<ReturnType<typeof createPayment>>
  try {
    result = await createPayment({
      baseUrl: getWelivepayBaseUrl(),
      key,
      orderid,
      amount: params.amount,
      mobile: user.mobileNo,
      username: user.username || user.name || 'User',
      redirectUrl: settings.redirectSuccessUrl || undefined,
    })
  } catch (error) {
    // The player never received a link; release the cap reservation.
    await markOrderStatus(orderid, 'invalid')
    throw error
  }
  await setOrderPaymentLink(orderid, result.paymentLink)

  return { paymentLink: result.paymentLink, qrImage: result.qrImage, orderId: orderid }
}
