import pg from 'pg'
import { getSSLConfig } from './ssl.js'

/**
 * Builds a tuned pg.Pool shared by every application and script.
 *
 * The previous per-app pools used pg defaults, which carried three problems:
 *   - `connectionTimeoutMillis` defaults to 0 (wait forever), so once the pool
 *     was saturated every new request hung instead of failing fast.
 *   - No `error` listener. pg emits `error` on the Pool when Postgres drops an
 *     idle connection (routine on managed databases); with no listener Node
 *     treats it as an unhandled 'error' event and terminates the process.
 *   - Session timezone was set for scripts but not for the servers, so date
 *     bucketing depended on the database server's default.
 *
 * All knobs are environment-overridable so deployments can tune without a
 * code change.
 */
export interface CreatePoolOptions {
  /** Shown in pg_stat_activity.application_name — makes it obvious which
   *  service owns a connection when diagnosing load. */
  applicationName: string
}

const int = (value: string | undefined, fallback: number): number => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function createPool(
  connectionString: string,
  { applicationName }: CreatePoolOptions
): pg.Pool {
  const env = process.env

  // Pin the session timezone so DATE()/NOW()/CURRENT_TIMESTAMP bucket
  // identically in every service and script, regardless of server default.
  const timeZone = env.DATABASE_TIMEZONE || 'Asia/Kolkata'
  const statementTimeoutMs = int(env.DATABASE_STATEMENT_TIMEOUT_MS, 120_000)

  const options = [`-c timezone=${timeZone}`]
  if (statementTimeoutMs > 0) {
    options.push(`-c statement_timeout=${statementTimeoutMs}`)
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: getSSLConfig(connectionString),
    application_name: applicationName,
    // Upper bound on concurrent server connections held by this process.
    max: int(env.DATABASE_POOL_MAX, 20),
    // Defaults to 0. A warm floor (>0) helps latency on long-running servers,
    // but idle sockets keep Node's event loop alive, so it is opt-in per
    // deployment rather than the default that every script inherits.
    min: int(env.DATABASE_POOL_MIN, 0),
    // Fail fast instead of queueing forever when the pool is saturated.
    connectionTimeoutMillis: int(env.DATABASE_CONNECTION_TIMEOUT_MS, 10_000),
    idleTimeoutMillis: int(env.DATABASE_IDLE_TIMEOUT_MS, 30_000),
    keepAlive: true,
    // Let short-lived processes (scripts, tests, one-shot jobs) exit once the
    // pool is idle instead of hanging on open sockets. Long-running servers are
    // unaffected: their HTTP listener holds the event loop open.
    allowExitOnIdle: true,
    options: options.join(' '),
  })

  // Without this listener a dropped idle connection crashes the process.
  pool.on('error', (err) => {
    console.error(`[db:${applicationName}] idle client error:`, err.message)
  })

  return pool
}
