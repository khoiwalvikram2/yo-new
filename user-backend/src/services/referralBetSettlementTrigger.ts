import { getEnv } from '../config/env.js'

export type ReferralBetSettlementPayload = {
  tenant: string
  userId: number
  netRevenue: number
  currency: string
  domain: 'sports' | 'casino' | 'matka'
  betId?: string
}

/**
 * Call admin-backend internal API to process referral bet settlement (loss share).
 * No-op if ADMIN_BASE_URL or INTERNAL_API_KEY is not set.
 */
export async function triggerReferralBetSettlement(
  payload: ReferralBetSettlementPayload
): Promise<void> {
  const env = getEnv() as { ADMIN_BASE_URL?: string; INTERNAL_API_KEY?: string }
  const baseUrl = env.ADMIN_BASE_URL
  const apiKey = env.INTERNAL_API_KEY
  if (!baseUrl || !apiKey) {
    return
  }
  const url = `${baseUrl.replace(/\/$/, '')}/internal/referral/process-bet-settlement`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`process-bet-settlement failed: ${res.status} ${text}`)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export type ReferralBetSettlementReversalPayload = {
  tenant: string
  userId: number
  betId: string
  domain: 'sports' | 'casino' | 'matka'
}

/**
 * Call admin-backend internal API to reverse referral bet settlement earnings (e.g. on rollback).
 * No-op if ADMIN_BASE_URL or INTERNAL_API_KEY is not set.
 */
export async function triggerReferralBetSettlementReversal(
  payload: ReferralBetSettlementReversalPayload
): Promise<void> {
  const env = getEnv() as { ADMIN_BASE_URL?: string; INTERNAL_API_KEY?: string }
  const baseUrl = env.ADMIN_BASE_URL
  const apiKey = env.INTERNAL_API_KEY
  if (!baseUrl || !apiKey) {
    return
  }
  const url = `${baseUrl.replace(/\/$/, '')}/internal/referral/process-bet-settlement-reversal`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`process-bet-settlement-reversal failed: ${res.status} ${text}`)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
