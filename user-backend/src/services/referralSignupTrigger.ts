import { getEnv } from '../config/env.js'

/**
 * Call admin-backend internal API to process signup referral rewards for a referee.
 * No-op if ADMIN_BASE_URL or INTERNAL_API_KEY is not set.
 */
export async function triggerSignupReferralRewards(tenant: string, refereeId: number): Promise<void> {
  const env = getEnv() as { ADMIN_BASE_URL?: string; INTERNAL_API_KEY?: string }
  const baseUrl = env.ADMIN_BASE_URL
  const apiKey = env.INTERNAL_API_KEY
  if (!baseUrl || !apiKey) {
    return
  }
  const url = `${baseUrl.replace(/\/$/, '')}/internal/referral/process-signup`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': apiKey,
      },
      body: JSON.stringify({ tenant, refereeId }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`process-signup failed: ${res.status} ${text}`)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
