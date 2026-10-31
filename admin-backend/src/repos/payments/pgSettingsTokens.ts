import { randomBytes } from 'crypto'

/**
 * Random, unguessable token embedded in a tenant's WeLivePay webhook URL.
 * 16 random bytes = 128 bits of entropy, base64url-encoded → 22 URL-safe chars.
 * (Shorter than hex while remaining cryptographically infeasible to guess — this
 * token is the sole authentication on the auto-credit webhook.)
 */
export function generateWebhookToken(): string {
  return randomBytes(16).toString('base64url')
}

/** Build the tenant's webhook URL from the user-backend base URL and token.
 *  Path kept short (/wlp/) on purpose — the URL is pasted into WeLivePay onboarding. */
export function buildWebhookUrl(userBackendBaseUrl: string, token: string): string {
  return `${userBackendBaseUrl.replace(/\/+$/, '')}/wlp/${token}`
}
