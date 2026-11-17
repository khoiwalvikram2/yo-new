/**
 * The WeLivePay checkout shown on the Deposit page. The open checkout is kept in localStorage, one per
 * site and player, so the card comes back after a reload or a return from the payment tab. Storage can be
 * blocked or full (private mode, site data cleared), so every access is guarded and the page works without it.
 */
import type { WelivepayCheckout } from '@/lib/api/user'

export type CheckoutStatus = 'pending' | 'success' | 'expired' | 'invalid'

const STATUSES: readonly string[] = ['pending', 'success', 'expired', 'invalid']

/** A status from the server; anything unknown counts as still pending. */
export function normalizeCheckoutStatus(value: unknown): CheckoutStatus {
  const status = String(value ?? '').trim().toLowerCase()
  return (STATUSES.includes(status) ? status : 'pending') as CheckoutStatus
}

/** 'welivepay-checkout:<whitelabelId>:<userId>', or null before the player is known. */
export function welivepayCheckoutKey(whitelabelId: string, userId: string | number | null | undefined): string | null {
  const player = userId == null ? '' : String(userId).trim()
  return player ? `welivepay-checkout:${whitelabelId}:${player}` : null
}

export function isWelivepayCheckout(value: unknown): value is WelivepayCheckout {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return typeof c.orderId === 'string' && c.orderId.trim() !== ''
    && typeof c.amount === 'number' && Number.isFinite(c.amount) && c.amount > 0
    && typeof c.paymentLink === 'string' && typeof c.qrImage === 'string'
    && (c.hostedUrl == null || typeof c.hostedUrl === 'string')
}

/** The checkout saved under `key`; null when there is none, it is not a checkout, or storage is unavailable. */
export function readSavedCheckout(key: string | null): WelivepayCheckout | null {
  if (!key) return null
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    return isWelivepayCheckout(saved) ? saved : null
  } catch {
    return null
  }
}

export function saveCheckout(key: string | null, checkout: WelivepayCheckout): void {
  if (!key) return
  try { localStorage.setItem(key, JSON.stringify(checkout)) } catch { /* the card still shows; it just will not survive a reload */ }
}

export function clearSavedCheckout(key: string | null): void {
  if (!key) return
  try { localStorage.removeItem(key) } catch { /* nothing to clear without storage */ }
}

/** The QR as an <img> src: '' when there is none, a data:image/ URI or http(s) URL as given, bare base64 as a PNG. */
export function checkoutQrSrc(qrImage: string | null | undefined): string {
  const value = typeof qrImage === 'string' ? qrImage.trim() : ''
  if (!value) return ''
  if (/^(?:data:image\/|https?:\/\/)/i.test(value)) return value
  return `data:image/png;base64,${value.replace(/\s+/g, '')}`
}

/** Where the checkout is paid: the hosted page, else the payment link; only an http(s):// or upi:// link, else null. */
export function checkoutLink(checkout: Pick<WelivepayCheckout, 'hostedUrl' | 'paymentLink'>): string | null {
  for (const candidate of [checkout.hostedUrl, checkout.paymentLink]) {
    const link = typeof candidate === 'string' ? candidate.trim() : ''
    if (/^(?:https?:\/\/|upi:\/\/)/i.test(link)) return link
  }
  return null
}
