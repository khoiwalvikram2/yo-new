import { db } from '@/db/client.js'
import { sql } from 'drizzle-orm'
import { coerceReportingRangeStart, coerceReportingRangeEnd } from '@src/shared/dateUtils.js'
import { FINANCIAL_SNAPSHOT_VERSION } from '@src/shared/reportingSql.js'

type Scope = { tenant?: string; whitelabelId?: string; currency?: string; dateFrom?: Date | string; dateTo?: Date | string }
/** A partial backfill or a later settlement must not make a saved financial
 * aggregate take precedence over newer accepted bets. Snapshot-only archived
 * ranges remain readable when their source bets no longer exist. */
export async function financialSnapshotsAreCurrent(filter: Scope, domain: 'sports' | 'casino' | 'matka', timezone: string): Promise<boolean> {
  const table = sql.raw(domain === 'sports' ? 'sports_bets' : domain === 'casino' ? 'casino_bets' : 'matka_bets')
  const conditions = [sql`true`]
  if (filter.tenant) conditions.push(sql`b.tenant = ${filter.tenant}`)
  if (filter.whitelabelId) conditions.push(sql`b.whitelabel_id = ${filter.whitelabelId}`)
  if (filter.currency) conditions.push(sql`b.currency = ${filter.currency}`)
  const from = filter.dateFrom ? coerceReportingRangeStart(filter.dateFrom, timezone) : null
  const to = filter.dateTo ? coerceReportingRangeEnd(filter.dateTo, timezone) : null
  if (from) conditions.push(sql`b.created_at >= ${from.toISOString()}`)
  if (to) conditions.push(sql`b.created_at <= ${to.toISOString()}`)
  const result = await db.execute(sql`SELECT NOT EXISTS (
    SELECT 1 FROM (
      SELECT b.tenant, b.whitelabel_id, b.currency,
        (b.created_at AT TIME ZONE ${timezone})::date activity_day,
        MAX(GREATEST(b.created_at, b.updated_at, b.settled_at)) newest
      FROM ${table} b WHERE ${sql.join(conditions, sql` AND `)}
      GROUP BY 1, 2, 3, 4
    ) activity
    WHERE NOT EXISTS (SELECT 1 FROM reporting_daily_snapshots s
      WHERE s.tenant = activity.tenant AND s.whitelabel_id = activity.whitelabel_id
        AND s.domain = ${domain} AND s.currency = activity.currency
        AND s.agent_id IS NULL AND s.player_id IS NULL
        AND s.metadata->>'financialCalculationVersion' = ${FINANCIAL_SNAPSHOT_VERSION}
        AND (s.snapshot_date AT TIME ZONE ${timezone})::date = activity.activity_day
        AND COALESCE((s.metadata->>'generatedAt')::timestamptz, s.created_at) >= activity.newest)
    LIMIT 1
  ) AS current`)
  return result.rows[0]?.current === true
}
