import { lockVipPlayer, assertVipDepositAllowed } from '@shared/vip/depositAccess.js'
import { assertPlayerCanFund } from '@shared/services/rgEnforcement.js'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { whitelabelPgSettings, users } from '@shared/db/schema.js'
import { decrypt } from '@shared/security/cryptoVault.js'
import { createWelivepayPayment, indianMobile, paymentAmount, WelivepayApiError, type CreatePaymentParams, type CreatePaymentResult } from '@shared/services/welivepay/welivepayClient.js'
import { generateOrderId } from '@shared/services/welivepay/orderId.js'
import { createWelivepayOrder, markOrderStatus, setOrderPaymentLink } from '../repos/welivepayOrdersRepo.js'
import { getUserDetail } from '../repos/userAppRepo.js'
import { getWelivepayBaseUrl, isWelivepayAllowedForUser } from '../config/env.js'
import { getWhitelabelCurrency } from '../shared/whitelabelConfig.js'

export interface CreateWelivepayDepositResult {
  paymentLink: string
  hostedUrl: string | null
  qrImage: string
  orderId: string
}

/** The provider call, injectable for tests; a stub may omit `hostedUrl`. */
type CreatePayment = (params: CreatePaymentParams) => Promise<Omit<CreatePaymentResult, 'hostedUrl'> & { hostedUrl?: string | null }>

/**
 * Whether a failed create request certainly left no order at WeLivePay. A refusal (HTTP 4xx) or a
 * request that was never sent did; a timeout, an unreachable host or a 5xx may still have created one.
 */
function providerCertainlyRejected(error: unknown): boolean {
  if (!(error instanceof WelivepayApiError)) return true
  return error.statusCode >= 400 && error.statusCode < 500
}

export async function createWelivepayDeposit(params: {
  userId: number
  tenant: string
  amount: number
}, createPayment: CreatePayment = createWelivepayPayment): Promise<CreateWelivepayDepositResult> {
  const amount = paymentAmount(params.amount)
  if (await getWhitelabelCurrency(params.tenant) !== 'INR') throw new Error('WeLivePay deposits support INR only')
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
  if (amount < Math.max(min, 10)) throw new Error(`Minimum deposit is ${Math.max(min, 10)}`)
  if (amount > max) throw new Error(`Maximum deposit is ${max}`)

  const user = await getUserDetail(params.userId, params.tenant)
  if (!user?.mobileNo) throw new Error('Please add a mobile number to your profile before depositing')
  const mobile = indianMobile(user.mobileNo)

  const key = decrypt(settings.secretSiteKeyEncrypted)
  const orderid = generateOrderId(params.userId)

  // Reserve first: the pending order is written under the player's VIP lock and
  // committed before the provider is called. A slow provider then holds neither
  // the lock nor a pool connection, and an order the provider accepted always
  // has a local row for its callback or the reconciliation job to settle. The
  // order keeps the gateway and the merchant key it was created with.
  await db.transaction(async tx => {
    await lockVipPlayer(tx, params.tenant, params.userId)
    await assertPlayerCanFund(params.tenant, params.userId, tx)
    const snapshot = await assertVipDepositAllowed(tx, params.tenant, params.userId, { method: 'GATEWAY', amount })
    await createWelivepayOrder({
      tenant: params.tenant,
      userId: params.userId,
      orderid,
      amount,
      paymentLink: null, vipPolicySnapshot: snapshot,
      gateway: settings.payinGateway, merchantKeyEncrypted: settings.secretSiteKeyEncrypted,
    }, tx)
  })

  let result: Awaited<ReturnType<CreatePayment>>
  try {
    result = await createPayment({
      baseUrl: getWelivepayBaseUrl(),
      key,
      orderid,
      amount,
      mobile,
      gateway: settings.payinGateway,
      username: user.username || user.name || 'User',
      redirectUrl: settings.redirectSuccessUrl || undefined,
    })
  } catch (error) {
    // A certain refusal releases the cap reservation now. An unconfirmed outcome stays pending:
    // reconciliation settles it if it was paid, and the expiry job releases it if it was not.
    if (providerCertainlyRejected(error)) await markOrderStatus(orderid, 'invalid')
    throw error
  }
  await setOrderPaymentLink(orderid, result.paymentLink)

  return { paymentLink: result.paymentLink, hostedUrl: result.hostedUrl ?? null, qrImage: result.qrImage, orderId: orderid }
}
