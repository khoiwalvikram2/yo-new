import 'dotenv/config'
import { z, type ZodIssue } from 'zod'
import { otpEnvSchema } from '@shared/validation/env.js'
import { isCryptoAllowedForUser } from '@shared/utils/cryptoDeposit.js'

const userBackendEnvSchema = otpEnvSchema.extend({
  /** Global request ceiling for this public API (see index.ts). */
  RATE_LIMIT_MAX: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.string().optional(),
  /** Fastify proxy trust setting: false/true or comma-separated addresses/CIDRs. */
  TRUST_PROXY: z.string().optional(),
  /** Caps on OTP sends, which bill a real SMS per call. */
  OTP_MAX_PER_PHONE_PER_HOUR: z.string().optional(),
  OTP_MIN_SECONDS_BETWEEN_SENDS: z.string().optional(),
  CASINO_BASE_URL: z.string().url().optional(),
  CASINO_PARTNER_ID: z.string().optional(),
  /** Casino's public key (PEM) for verifying their callback signatures. */
  CASINO_SECRET: z.string().optional(),
  /** Our private key (PEM string) for signing outbound requests and callback responses. Alternative: CASINO_PRIVATE_KEY_PATH. */
  CASINO_PRIVATE_KEY: z.string().optional(),
  /** Path to our private key .pem file (e.g. certs/our_private.pem). Alternative: CASINO_PRIVATE_KEY. */
  CASINO_PRIVATE_KEY_PATH: z.string().optional(),
  CASINO_REDIRECT_URL: z.string().url().optional(),
  /** Optional base URL for user app (e.g. https://app.example.com) used for myReferralLink url. */
  USER_APP_BASE_URL: z.string().url().optional(),
  /** Admin backend base URL for internal API (e.g. signup referral rewards). */
  ADMIN_BASE_URL: z.string().url().optional(),
  /** API key for admin internal routes (e.g. X-Internal-Api-Key). */
  INTERNAL_API_KEY: z.string().optional(),
  /** API key for bet-tool HTTP routes (X-Bet-Tool-Key). When unset, routes return 401. */
  BET_TOOL_API_KEY: z.string().optional(),
  /** GM-Ag Casino: brand ID. */
  GMAG_BRAND_ID: z.union([z.coerce.number(), z.string().transform(Number)]).optional(),
  /** GM-Ag Casino: secret key for MD5 hash. */
  GMAG_SECRET_KEY: z.string().optional(),
  /** GM-Ag Casino: launcher base URL (for game redirect). */
  GMAG_LAUNCHER_URL: z.string().url().optional(),
  /** GM-Ag Casino: game list API base URL. */
  GMAG_GAME_DATA_URL: z.string().url().optional(),
  /** GM-Ag Casino: our callback base URL (for GM-Ag to call /gmag/auth, etc.). */
  GMAG_CALLBACK_ENDPOINT: z.string().url().optional(),
  /** Live TV URL (only served for grandwinn-com tenant). */
  LIVE_TV_URL: z.string().url().optional(),
  /** Score Card URL (only served for grandwinn-com tenant). */
  SCORE_CARD_URL: z.string().url().optional(),
})

export type UserBackendEnv = z.infer<typeof userBackendEnvSchema>

export function getEnv(): UserBackendEnv {
  const parsed = userBackendEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue: ZodIssue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid environment: ${issues}`)
  }
  return parsed.data
}

export function getCasinoEnv(): {
  CASINO_BASE_URL: string
  CASINO_PARTNER_ID: string
  CASINO_SECRET: string
  CASINO_REDIRECT_URL: string
} | null {
  const env = getEnv()
  if (
    env.CASINO_BASE_URL &&
    env.CASINO_PARTNER_ID &&
    env.CASINO_SECRET &&
    env.CASINO_REDIRECT_URL
  ) {
    return {
      CASINO_BASE_URL: env.CASINO_BASE_URL,
      CASINO_PARTNER_ID: env.CASINO_PARTNER_ID,
      CASINO_SECRET: env.CASINO_SECRET,
      CASINO_REDIRECT_URL: env.CASINO_REDIRECT_URL,
    }
  }
  return null
}

export function getGmagCasinoEnv(): {
  GMAG_BRAND_ID: number
  GMAG_SECRET_KEY: string
  GMAG_LAUNCHER_URL: string | null
  GMAG_GAME_DATA_URL: string | null
  GMAG_CALLBACK_ENDPOINT: string | null
} | null {
  const env = getEnv()
  if (env.GMAG_BRAND_ID != null && env.GMAG_SECRET_KEY) {
    const result = {
      GMAG_BRAND_ID: Number(env.GMAG_BRAND_ID),
      GMAG_SECRET_KEY: env.GMAG_SECRET_KEY,
      GMAG_LAUNCHER_URL: env.GMAG_LAUNCHER_URL ?? null,
      GMAG_GAME_DATA_URL: env.GMAG_GAME_DATA_URL ?? null,
      GMAG_CALLBACK_ENDPOINT: env.GMAG_CALLBACK_ENDPOINT ?? null,
    }
    return result
  }
  return null
}

export function getWelivepayBaseUrl(): string {
  return process.env.WELIVEPAY_BASE_URL || 'https://welivepay.in'
}

/**
 * TEMP test gate: restrict WeLivePay deposits to specific user IDs.
 * WELIVEPAY_ALLOWED_USER_IDS = comma-separated user IDs (e.g. "60").
 * Unset/empty => no restriction (all users allowed) — that's the production default.
 */
export function isWelivepayAllowedForUser(userId: number | null | undefined): boolean {
  const raw = process.env.WELIVEPAY_ALLOWED_USER_IDS
  if (!raw || !raw.trim()) return true // no restriction
  if (userId == null) return false
  const allowed = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  return allowed.includes(userId)
}

/**
 * TEMP test gate: restrict crypto (USDT) deposits to specific user IDs.
 * CRYPTO_DEPOSIT_ALLOWED_USER_IDS = comma-separated user IDs (e.g. "761").
 * Unset/empty => every player. A list with no valid ID allows nobody (a typo never opens crypto to all).
 */
export function isCryptoDepositAllowedForUser(userId: number | null | undefined): boolean {
  return isCryptoAllowedForUser(process.env.CRYPTO_DEPOSIT_ALLOWED_USER_IDS, userId)
}
