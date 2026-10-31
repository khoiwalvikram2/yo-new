export type AppConfig = {
  port: number
  corsOrigins: string[]
  rateLimit: { max: number; timeWindowMs: number }
  metricsEnabled: boolean
}

/** Normalize origin: trim and remove trailing slash (browser sends no trailing slash). */
function normalizeOrigin(o: string): string {
  const s = o.trim()
  return s.endsWith('/') ? s.slice(0, -1) : s
}

export function getAppConfig(): AppConfig {
  const port = Number(process.env.PORT || 4000)
  // Two development origins by default: the admin panel and the CRM, which
  // run side by side rather than one instead of the other. Production sets
  // CORS_ORIGIN explicitly and this default is not used.
  const cors = (process.env.CORS_ORIGIN || 'http://localhost:5174,http://localhost:5175')
    .split(',')
    .map((s) => normalizeOrigin(s))
    .filter(Boolean)
  const rateMax = Number(process.env.RATE_LIMIT_MAX || 400)
  const rateWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000)
  const metricsEnabled = String(process.env.METRICS_ENABLED || 'true') === 'true'
  return {
    port,
    corsOrigins: cors,
    rateLimit: { max: rateMax, timeWindowMs: rateWindowMs },
    metricsEnabled,
  }
}

