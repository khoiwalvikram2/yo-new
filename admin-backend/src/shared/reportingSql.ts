import { sql, type SQL } from 'drizzle-orm';

export const FINANCIAL_SNAPSHOT_VERSION = '2026-10-25-v2';

/** Matches admin `DEFAULT_ADMIN_TZ` when tenant config is missing. */
const FALLBACK_REPORTING_TZ = 'Asia/Kolkata';

/**
 * Sanitize IANA timezone for embedding in SQL string literals (same rules as snapshot audit).
 */
export function escapeIanaTimezoneForSql(tz: string | undefined | null): string {
  const t = (tz ?? '').trim() || FALLBACK_REPORTING_TZ;
  return /^[A-Za-z0-9_/+-]+$/.test(t) ? t : FALLBACK_REPORTING_TZ;
}

/**
 * Calendar date in the given IANA zone as `YYYY-MM-DD` text — independent of PostgreSQL session `TimeZone`.
 * Use the same SQL instance for SELECT, GROUP BY, and ORDER BY.
 */
export function sqlDateBucketText(column: unknown, tz: string): SQL<string> {
  const z = escapeIanaTimezoneForSql(tz).replace(/'/g, "''");
  return sql<string>`to_char((${column}) AT TIME ZONE ${sql.raw(`'${z}'`)}, 'YYYY-MM-DD')`;
}

/**
 * The date a deposit/withdrawal actually settled (money moved): the admin/whitelabel
 * review timestamp when present, falling back to the request creation date for legacy
 * rows that have no `reviewedAt`.
 *
 * Use this — NOT `createdAt` — for any financial metric that should reflect APPROVED money
 * movement (dashboard deposits/withdrawals, net deposits, trends, FTD, player activity).
 * A withdrawal requested on day 1 but approved on day 3 belongs to day 3.
 *
 * Pass the table's `reviewedAt` and `createdAt` drizzle columns.
 */
export function settlementDateExpr(reviewedAt: unknown, createdAt: unknown): SQL<Date> {
  return sql<Date>`COALESCE(${reviewedAt}, ${createdAt})`;
}


/**
 * What a sports bet cost the player, as a SQL fragment over a table alias.
 *
 * `liability`, not `stake`. On an exchange a back bet risks the stake and a lay bet
 * risks the liability, and `liability` already holds the right figure for both — which
 * is why every existing revenue query reads it. Using `stake` understates every lay bet.
 *
 * Alias-based text rather than a drizzle expression because the CRM materialiser builds
 * raw `INSERT ... SELECT` statements, and a helper only the query builder can call would
 * have left the materialiser writing its own copy — which is the duplication this exists
 * to prevent.
 */
export function sportsStakeSql(alias: string): string {
  return `COALESCE(SUM(${alias}.liability::numeric), 0)`;
}

/** Gross return for one settled sports bet. Posted player P/L is authoritative.
 * Legacy numeric results are safely parsed only when posted P/L is absent.
 * Stake/risk plus player P/L is the returned amount for back, lay and fancy alike.
 */
export function sportsGrossReturnSql(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid sports SQL alias')
  const a = alias
  const risk = `COALESCE(${a}.liability::numeric, ${a}.stake::numeric, 0)`
  const result = `CASE WHEN TRIM(COALESCE(${a}.result,'')) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN TRIM(${a}.result)::numeric ELSE NULL END`
  return `CASE WHEN ${a}.status::text IN ('won','lost','settled') THEN CASE ` +
    `WHEN ${a}.pl IS NOT NULL THEN ${risk} + ${a}.pl::numeric ` +
    `WHEN ${a}.status::text = 'lost' OR LOWER(TRIM(COALESCE(${a}.result,''))) IN ('lost','loss') THEN 0 ` +
    `WHEN ${a}.status::text = 'won' OR LOWER(TRIM(COALESCE(${a}.result,''))) IN ('won','win') OR (${result}) IS NOT NULL THEN CASE ` +
    `WHEN ${a}.odds_size IS NOT NULL AND ${a}.side = 'back' THEN ${a}.stake::numeric + COALESCE((${result}), ${a}.stake::numeric * COALESCE(NULLIF(${a}.odds_size::numeric, 0), 100) / 100) ` +
    `WHEN ${a}.side = 'lay' THEN ${risk} + ${a}.stake::numeric ` +
    `ELSE COALESCE((${result}), ${a}.stake::numeric * COALESCE(${a}.price::numeric, 0)) END ` +
    `ELSE ${risk} END ELSE 0 END`
}

/** Aggregate gross returns using the same settlement rule on every reporting surface. */
export function sportsPayoutSql(alias: string): string {
  return `COALESCE(SUM(${sportsGrossReturnSql(alias)}), 0)`
}

export function sportsPayoutAggregateSql(alias = 'sports_bets'): SQL<number> {
  return sql<number>`${sql.raw(sportsPayoutSql(alias))}`
}

/** Realised player P/L; open, refunded and cancelled bets contribute zero. */
export function sportsPlayerProfitSql(alias: string): string {
  const gross = sportsGrossReturnSql(alias)
  return `CASE WHEN ${alias}.status::text IN ('won','lost','settled') THEN (${gross}) - COALESCE(${alias}.liability::numeric, ${alias}.stake::numeric, 0) ELSE 0 END`
}

/** Settled sports statuses — the ones that have produced revenue. */
export const SETTLED_SPORTS_STATUSES = ['won', 'lost', 'settled'] as const;
