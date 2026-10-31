export interface CreatePaymentParams {
  baseUrl: string
  key: string
  orderid: string
  amount: number
  mobile: string
  username: string
  redirectUrl?: string
}

export interface CreatePaymentResult {
  paymentLink: string
  qrImage: string
  orderId: string
  status: string
}

const CREATE_PAYMENT_PATH = '/api/akmultisolutions/create-payment'

export async function createWelivepayPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const body: Record<string, unknown> = {
    key: params.key,
    orderid: params.orderid,
    amount: params.amount,
    mobile: params.mobile,
    username: params.username,
  }
  if (params.redirectUrl) body.redirect_url = params.redirectUrl

  const resp = await fetch(`${params.baseUrl}${CREATE_PAYMENT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  let data: any
  try {
    data = await resp.json()
  } catch {
    throw new Error(`WeLivePay returned a non-JSON response (HTTP ${resp.status})`)
  }

  if (!data || data.success !== true) {
    throw new Error(data?.error || `WeLivePay create-payment failed (HTTP ${resp.status})`)
  }

  return {
    paymentLink: data.payment_link,
    qrImage: data.qr_image,
    orderId: data.order_id,
    status: data.status ?? 'pending',
  }
}
