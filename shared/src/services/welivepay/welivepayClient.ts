/**
 * WeLivePay merchant API client, ported from the gw project (contract checked against the merchant
 * documentation dated 10 October 2026).
 *
 * A gateway is stored as its create-path segment, uppercased: `/api/qpc/create-payment` → `QPC`.
 * The assigned list comes from WeLivePay (`/api/get-available-gateways`); payout `AUTO` means
 * `/api/create-payout` (the project's active assigned provider).
 */
const GATEWAY_CODE = /^[A-Z0-9_-]{1,32}$/
export const isPayinGatewayCode = (code: unknown): code is string => typeof code === 'string' && GATEWAY_CODE.test(code)
export const isPayoutGatewayCode = (code: unknown): code is string => code === 'AUTO' || isPayinGatewayCode(code)
// Order detail reports the provider key; it differs from the create-path code only for AK Multi.
const PAYIN_KEY_CODES: Record<string, string> = { akms: 'AKMULTISOLUTIONS' }
export const payinGatewayCode = (key: string) => PAYIN_KEY_CODES[key.toLowerCase()] ?? key.toUpperCase()
const GATEWAY_NAMES: Record<string, string> = { IRISPAY: 'Iris Pay', QPC: 'QuickPayCash', AKMULTISOLUTIONS: 'AK Multi Solutions', PAYRUPY: 'PayRupy', PAYFINROW: 'PayFinRow', VYAPARVAULT: 'VyaparVault', AUTO: 'Automatic' }
export const gatewayDisplayName = (code: string) => GATEWAY_NAMES[code] ?? code
/** A pay-in checkout link expires ~15 minutes after creation; an unpaid order is shown as expired after that. */
export const PAYIN_LINK_TTL_MS = 15 * 60 * 1000
export type PayoutStatus = 'requested' | 'processing' | 'success' | 'failed' | 'rejected'
type Credentials = { baseUrl: string; key: string }

export class WelivepayApiError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); this.name = 'WelivepayApiError' }
}

/** Merchant amounts are INR rupees, with at most two decimal places. */
export function paymentAmount(raw: unknown): number {
  if (typeof raw !== 'number' && typeof raw !== 'string') throw new Error('Invalid payment amount')
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER / 100 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw new Error('Payment amount must be positive with at most two decimal places')
  }
  return Math.round(amount * 100) / 100
}

export function indianMobile(raw: string): string {
  let mobile = raw.replace(/\D/g, '')
  if (mobile.length === 12 && mobile.startsWith('91')) mobile = mobile.slice(2)
  if (!/^\d{10}$/.test(mobile)) throw new Error('A 10 digit Indian mobile number is required')
  return mobile
}

async function request(credentials: Credentials, path: string, body: Record<string, unknown>, method: 'POST' | 'GET' = 'POST'): Promise<any> {
  const url = new URL(path, credentials.baseUrl)
  if (!credentials.key || credentials.key.length > 512) throw new Error('Payment gateway merchant key is not configured')
  const payload = { ...body, key: credentials.key }
  if (method === 'GET') for (const [key, value] of Object.entries(payload)) url.searchParams.set(key, String(value))
  let response: Response
  try {
    response = await fetch(url.toString(), {
      method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    })
  } catch {
    // A GET status URL contains the merchant key. Never propagate fetch's URL/cause.
    throw new WelivepayApiError('WeLivePay could not be reached; reconcile the existing order before retrying', 0)
  }
  let data: any
  try { data = await response.json() } catch { throw new WelivepayApiError(`WeLivePay returned a non-JSON response (HTTP ${response.status})`, response.status) }
  if (!response.ok || data?.success !== true) {
    const message = typeof data?.error === 'string' ? data.error.split(credentials.key).join('[redacted]').slice(0, 400) : `WeLivePay request failed (HTTP ${response.status})`
    throw new WelivepayApiError(message, response.status)
  }
  return data
}

export interface GatewayOption { code: string; key: string; label: string }
export interface AvailableGateways { payin: GatewayOption[]; payout: GatewayOption[] }

function gatewayOptions(raw: unknown, action: 'create-payment' | 'create-payout'): GatewayOption[] {
  if (!Array.isArray(raw)) return []
  const path = new RegExp(`^/api/([a-z0-9_-]{1,32})/${action}$`)
  const options: GatewayOption[] = []
  for (const item of raw) {
    // An entry without a callable create path cannot be selected.
    const match = typeof item?.endpoint === 'string' ? path.exec(item.endpoint) : null
    if (!match || typeof item.key !== 'string' || (item.method ?? 'POST') !== 'POST') continue
    const code = match[1].toUpperCase()
    if (options.some(o => o.code === code)) continue
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 128) : item.key
    options.push({ code, key: item.key.slice(0, 64), label })
  }
  return options
}

/** Gateways assigned to this project and active platform-wide; payouts only with `payouts.create`. */
export async function getWelivepayAvailableGateways(credentials: Credentials): Promise<AvailableGateways> {
  const { gateways } = await request(credentials, '/api/get-available-gateways', {})
  if (!gateways || typeof gateways !== 'object') throw new Error('Invalid WeLivePay gateway list response')
  return { payin: gatewayOptions(gateways.payin, 'create-payment'), payout: gatewayOptions(gateways.payout, 'create-payout') }
}

export interface CreatePaymentParams extends Credentials {
  orderid: string; amount: number; mobile: string; username: string; redirectUrl?: string; gateway?: string
}
export interface CreatePaymentResult {
  paymentLink: string; hostedUrl: string | null; qrImage: string; orderId: string; status: string
}

export async function createWelivepayPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const gateway = params.gateway ?? 'IRISPAY'
  if (!isPayinGatewayCode(gateway)) throw new Error('Unsupported WeLivePay pay-in gateway')
  const amount = paymentAmount(params.amount)
  if (amount < 10) throw new Error('Minimum WeLivePay deposit is 10 INR')
  if (params.orderid.length < 10) throw new Error('Pay-in reference must contain at least 10 characters')
  const data = await request(params, `/api/${gateway.toLowerCase()}/create-payment`, {
    orderid: params.orderid, amount, mobile: indianMobile(params.mobile), username: params.username,
    ...(params.redirectUrl ? { redirect_url: params.redirectUrl } : {}),
  })
  if (data.order_id !== params.orderid) throw new Error('WeLivePay returned a different pay-in reference')
  const hostedUrl = typeof data.hosted_url === 'string' && data.hosted_url ? data.hosted_url : null
  const paymentLink = hostedUrl || (typeof data.payment_link === 'string' ? data.payment_link : '')
  const qrImage = typeof data.qr_image === 'string' ? data.qr_image : ''
  if (!paymentLink && !qrImage) throw new Error('WeLivePay did not return a checkout or QR code')
  return { paymentLink, hostedUrl, qrImage, orderId: data.order_id, status: data.status ?? 'pending' }
}

export interface PayinDetail { orderId: string; amount: number; status: 'pending' | 'success' | 'expired'; txnRef: string | null; gateway: string }
export async function getWelivepayPayin(params: Credentials & { orderid: string }): Promise<PayinDetail> {
  const { order } = await request(params, '/api/get-order-detail', { orderid: params.orderid }, 'GET')
  if (!order || order.order_id !== params.orderid || !['pending', 'success', 'expired'].includes(order.status)) throw new Error('Invalid WeLivePay pay-in status response')
  return { orderId: order.order_id, amount: paymentAmount(order.amount), status: order.status, txnRef: order.txn_ref || null, gateway: typeof order.gateway === 'string' ? payinGatewayCode(order.gateway) : '' }
}

export interface PayoutRequest {
  orderid: string; amount: number; payoutType: 'IMPS'; beneficiaryAccount: string; beneficiaryIFSC: string;
  beneficiaryName: string; beneficiaryMobNo: string; bankName: string; branchName?: string; payoutRemark?: string
}
export interface PayoutDetail {
  orderId: string; payoutId: string | null; merchantTransactionId: string | null; amount: number;
  status: PayoutStatus; utr: string | null; failureReason: string | null; beneficiaryAccount: string; beneficiaryIFSC: string
}

export function validatePayoutRequest(input: PayoutRequest): PayoutRequest {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.orderid)) throw new Error('Invalid payout reference')
  if (input.payoutType !== 'IMPS') throw new Error('WeLivePay supports IMPS bank payouts')
  if (!/^\d{1,64}$/.test(input.beneficiaryAccount)) throw new Error('A bank account number is required for IMPS payout')
  const beneficiaryIFSC = input.beneficiaryIFSC.trim().toUpperCase()
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(beneficiaryIFSC)) throw new Error('A valid bank IFSC is required')
  const beneficiaryName = input.beneficiaryName.trim(), bankName = input.bankName.trim()
  if (!beneficiaryName || beneficiaryName.length > 128 || !bankName || bankName.length > 128) throw new Error('Beneficiary and bank names are required (maximum 128 characters)')
  if ((input.branchName?.length ?? 0) > 128 || (input.payoutRemark?.length ?? 0) > 255) throw new Error('Payout branch or remark is too long')
  return { orderid: input.orderid, amount: paymentAmount(input.amount), payoutType: 'IMPS', beneficiaryAccount: input.beneficiaryAccount, beneficiaryIFSC, beneficiaryName, bankName, beneficiaryMobNo: indianMobile(input.beneficiaryMobNo), ...(input.branchName !== undefined ? { branchName: input.branchName } : {}), ...(input.payoutRemark !== undefined ? { payoutRemark: input.payoutRemark } : {}) }
}

function parsePayout(data: any, orderid: string, key: string): PayoutDetail {
  const payout = data?.payout
  if (!payout || payout.order_id !== orderid || !['requested', 'processing', 'success', 'failed', 'rejected'].includes(payout.status)) throw new Error('Invalid WeLivePay payout status response')
  return {
    orderId: payout.order_id, payoutId: payout.payout_id || null, merchantTransactionId: payout.merchant_transaction_id || null,
    amount: paymentAmount(payout.amount), status: payout.status, utr: payout.utr || null, failureReason: typeof payout.failure_reason === 'string' ? payout.failure_reason.split(key).join('[redacted]').slice(0, 400) : null,
    beneficiaryAccount: String(payout.beneficiary_account ?? ''), beneficiaryIFSC: String(payout.beneficiary_ifsc ?? '').toUpperCase(),
  }
}

export async function createWelivepayPayout(params: Credentials & { payout: PayoutRequest; gateway?: string }): Promise<PayoutDetail> {
  const gateway = params.gateway ?? 'AUTO'
  if (!isPayoutGatewayCode(gateway)) throw new Error('Unsupported WeLivePay payout gateway')
  const payout = validatePayoutRequest(params.payout)
  const path = gateway === 'AUTO' ? '/api/create-payout' : `/api/${gateway.toLowerCase()}/create-payout`
  return parsePayout(await request(params, path, { ...payout }), payout.orderid, params.key)
}

export async function getWelivepayPayout(params: Credentials & { orderid: string }): Promise<PayoutDetail> {
  return parsePayout(await request(params, '/api/get-payout-detail', { orderid: params.orderid }), params.orderid, params.key)
}
