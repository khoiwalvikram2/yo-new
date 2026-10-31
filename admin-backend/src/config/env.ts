import { z } from 'zod'

export const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  /** Optional path to CA certificate for DB SSL (e.g. DigitalOcean). Default: <cwd>/certs/ca-certificate.crt */
  DATABASE_CA_CERT: z.string().optional(),
  PORT: z.string().optional(),
  /**
   * What this process is for.
   *
   * 'full' (the default) serves GraphQL and owns the platform's scheduled work.
   * 'crm' serves the same GraphQL surface and starts no schedulers, so a busy
   * CRM desk can be given its own process without a second copy of every
   * scheduled job — settlement accrual, snapshot generation and result polling
   * must each have exactly one owner.
   */
  SERVER_ROLE: z.enum(['full', 'crm']).optional().default('full'),
  CORS_ORIGIN: z.string().optional(),
  RATE_LIMIT_MAX: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.string().optional(),
  METRICS_ENABLED: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  SPORTS_API_URL: z.string().url().optional(),
  SPORTS_API_BASE_URL: z.string().url().optional(),
  SPORTS_API_SPORTS_PATH: z.string().optional(),
  SPORTS_API_LEAGUES_PATH: z.string().optional(),
  SPORTS_API_EVENTS_PATH: z.string().optional(),
  MATKA_RESULT_ROLLBACK_WINDOW_MINUTES: z.string().optional().default('60'), // Default 60 minutes
  PAYMENT_CREDENTIALS_KEY: z.string().optional(), // 32-byte base64 key for AES-256-GCM encryption
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.string().optional().default('5'), // Default 5 failures
  CIRCUIT_BREAKER_COOLDOWN_SEC: z.string().optional().default('60'), // Default 60 seconds
  CIRCUIT_BREAKER_HALF_OPEN_PROBES: z.string().optional().default('3'), // Default 3 probes
  // S3 Configuration
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_UPLOAD_EXPIRY_SEC: z.string().optional().default('3600'), // Default 1 hour
  // Snapshot Generation Configuration
  SNAPSHOT_DEBOUNCE_MS: z.string().optional().default('5000'), // Default 5 seconds
  SNAPSHOT_LOCK_TTL_SECONDS: z.string().optional().default('300'), // Default 5 minutes
  SNAPSHOT_CRON_SCHEDULE: z.string().optional().default('0 0 * * *'), // Default midnight daily
  SNAPSHOT_SKIP_IF_EXISTS_HOURS: z.string().optional().default('1'), // Default 1 hour
  REDIS_URL: z.string().optional().default('redis://localhost:6379'),
  INTERNAL_API_KEY: z.string().optional(),
  /** Optional: override "now" for commission cycle (IST Monday–Monday). Use next Monday ISO date to test settlement on non-Monday. e.g. COMMISSION_CYCLE_NOW_OVERRIDE=2025-03-03 */
  COMMISSION_CYCLE_NOW_OVERRIDE: z.string().optional(),
  /** Test-only: allow commission cycle readiness despite LEDGER_GAP. Ignored in production. */
  COMMISSION_TEST_ALLOW_LEDGER_GAP: z.string().optional(),
  /** Public base URL of the user-facing backend; used to build the WeLivePay webhook URL shown in admin. */
  USER_BACKEND_PUBLIC_URL: z.string().url().optional(),
  USER_APP_PUBLIC_URL: z.string().url().optional(),
  // --- AI portal assistant ---
  /** OpenAI API key. Without it the assistant endpoints report unavailable. */
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional().default('gpt-4o-mini'),
  /** Ceiling on tool-call rounds within one turn, so a confused model cannot loop. */
  AI_MAX_TOOL_ITERATIONS: z.string().optional().default('6'),
  /** Token budget for a whole conversation; past it the assistant asks for a fresh one. */
  AI_MAX_TOKENS_PER_CONVERSATION: z.string().optional().default('120000'),
  /** How long a proposed write stays confirmable. */
  AI_PROPOSAL_TTL_SECONDS: z.string().optional().default('900'),
})

export type Env = z.infer<typeof EnvSchema>

export function getEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')
    throw new Error(`Invalid environment: ${issues}`)
  }
  return parsed.data
}

/** Base URL of the user-facing backend (used to construct webhook URLs). */
export function getUserBackendBaseUrl(): string {
  const url = process.env.USER_BACKEND_PUBLIC_URL || process.env.USER_APP_PUBLIC_URL
  if (!url) {
    // Falling back to localhost would make every generated WeLivePay webhook URL point at
    // localhost in production (all deposits go uncredited). Loudly warn outside development.
    if (process.env.NODE_ENV === 'production') {
      console.warn('[pg-settings] USER_BACKEND_PUBLIC_URL is not set — webhook URLs will point to localhost:4001. Set it in production.')
    }
    return 'http://localhost:4001'
  }
  return url
}
