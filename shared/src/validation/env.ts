import { z, type ZodIssue } from 'zod'

export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  /** Optional path to CA certificate for DB SSL (e.g. DigitalOcean). Default: <cwd>/certs/ca-certificate.crt */
  DATABASE_CA_CERT: z.string().optional(),
  PORT: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  JWT_SECRET: z.string().min(16),
  UPSTREAM_API_BASE_URL: z.string().url().optional(),
  SPORTS_API_MARKET_ODDS_PATH: z.string().optional(),
  /** Upstream path for fancy odds snapshot (same base as SPORTS_API_MARKET_ODDS_PATH). */
  SPORTS_API_FANCY_ODDS_PATH: z.string().optional(),
  // No S3 settings: deposit proofs and every other file are stored as base64 data URIs (owner decision 2026-11-04).
})

export const otpEnvSchema = baseEnvSchema.extend({
  OTP_EXPIRY_MINUTES: z.string().optional().default('10'),
  OTP_MAX_ATTEMPTS: z.string().optional().default('5'),
})

export type BaseEnv = z.infer<typeof baseEnvSchema>
export type OtpEnv = z.infer<typeof otpEnvSchema>

export function parseBaseEnv(): BaseEnv {
  const parsed = baseEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue: ZodIssue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid environment: ${issues}`)
  }
  return parsed.data
}

export function parseOtpEnv(): OtpEnv {
  const parsed = otpEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue: ZodIssue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid environment: ${issues}`)
  }
  return parsed.data
}

