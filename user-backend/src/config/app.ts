import { getEnv } from './env.js'

const DEV_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5177',
  'http://127.0.0.1:5177',
]

export function parseCorsOrigins(raw: string | undefined, nodeEnv: string | undefined): string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)

  if (nodeEnv !== 'development') {
    if (origins.length === 0) {
      throw new Error('CORS_ORIGIN is required outside development')
    }
    if (origins.some((origin) => origin.includes('*'))) {
      throw new Error('CORS_ORIGIN must contain explicit origins; wildcards are not allowed outside development')
    }
  }

  return origins.length > 0 ? origins : DEV_CORS_ORIGINS
}

export function parseTrustProxy(raw: string | undefined): boolean | string | string[] {
  const value = raw?.trim()
  if (!value || value.toLowerCase() === 'false') return false
  if (value.toLowerCase() === 'true') return true
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  return entries.length === 1 ? entries[0] : entries
}

export function getAppConfig() {
  const env = getEnv()
  return {
    port: Number(env.PORT || 4001),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGIN, process.env.NODE_ENV),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    jwtSecret: env.JWT_SECRET,
    otpExpiryMinutes: Number(env.OTP_EXPIRY_MINUTES ?? '10'),
    otpMaxAttempts: Number(env.OTP_MAX_ATTEMPTS ?? '5'),
    upstreamApiBaseUrl: env.UPSTREAM_API_BASE_URL || 'https://api.gamdaddy.com',
    sportsApiMarketOddsPath: env.SPORTS_API_MARKET_ODDS_PATH || '/get-market-odds',
    sportsApiFancyOddsPath: env.SPORTS_API_FANCY_ODDS_PATH || '',
    userAppBaseUrl: (env as any).USER_APP_BASE_URL as string | undefined,
    rateLimit: {
      // Public service: registration, login and OTP are all reachable without a
      // credential, so the ceiling has to hold for anonymous traffic too.
      max: Number(env.RATE_LIMIT_MAX ?? '300'),
      timeWindowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? '60000'),
    },
    otp: {
      // requestOtp bills a real SMS per call. These bound how often one phone
      // number (and one IP) can trigger that.
      perPhonePerHour: Number(env.OTP_MAX_PER_PHONE_PER_HOUR ?? '5'),
      minSecondsBetweenSends: Number(env.OTP_MIN_SECONDS_BETWEEN_SENDS ?? '60'),
    },
  }
}

