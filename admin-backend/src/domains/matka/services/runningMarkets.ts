import { sql, type SQL } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { db } from '@src/db/client.js'
import { requireReadPermission } from '@src/domains/common/auth.js'
import { getEffectiveTenantForDirector, shouldSkipTenantFiltering } from '@src/domains/common/directorModeUtils.js'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => DateTime.fromISO(value).isValid, 'Invalid trading date')
const filtersSchema = z.object({
  search: z.string().max(160).optional(), date: day.optional(), matkaId: z.string().uuid().optional(),
  matkaType: z.enum(['worli', 'starline', 'jackpot', 'sattaMatka']).optional(), session: z.enum(['open', 'close']).optional(),
  page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20),
})
const bidKey = sql`regexp_replace(regexp_replace(upper(trim(b.bid_type)),'[[:space:],/-]+','_','g'),'_BULK$','')`
const combinations = ['JODI','JODI_DIGITS','HS','FS','HALF_SANGAM','HALF_SANGAM_DIGITS','FULL_SANGAM','FULL_SANGAM_DIGITS']
const supportedBids = [...combinations,'SINGLE','SINGLE_DIGIT','SP','SP_MOTOR','SINGLE_PATTI','SINGLE_PANA','SINGLE_PANNA','DP','DP_MOTOR','DOUBLE_PATTI','DOUBLE_PANA','DOUBLE_PANNA','TP','TRIPLE_PATTI','TRIPLE_PANA','TRIPLE_PANNA','AB','A','B','SP_DP_TP']
// Match evaluateMatkaSelection/settlementSession, including legacy combination
// entries recorded as Open, and legacy singles with a missing market_session.
const settlementSession = sql`CASE WHEN NOT (${bidKey} IN (${sql.join(supportedBids.map(value => sql`${value}`), sql`,`)})) THEN NULL
  WHEN b.matka_type='starline' THEN 'open' WHEN b.matka_type IN ('jackpot','sattaMatka') THEN 'close'
  WHEN ${bidKey} IN (${sql.join(combinations.map(value => sql`${value}`), sql`,`)}) THEN 'close'
  WHEN b.market_session='close' THEN 'close' ELSE 'open' END`
export function runningMatkaTenant(ctx: any): string {
  requireReadPermission(ctx, 'matka.results', 'view')
  if (ctx?.user?.type === 'agent') throw new Error('Only administrators can manage pending Matka results')
  if (shouldSkipTenantFiltering(ctx)) throw new Error('Select a whitelabel to view running Matka markets')
  return getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
}
function scopedBets(tenant: string, filters: z.infer<typeof filtersSchema>): SQL {
  const conditions = [sql`b.tenant=${tenant}`, sql`m.tenant=${tenant}`, sql`b.status IN ('pending','active')`]
  if (filters.search?.trim()) conditions.push(sql`(m.name ILIKE ${'%' + filters.search.trim() + '%'} OR m.code ILIKE ${'%' + filters.search.trim() + '%'})`)
  if (filters.date) conditions.push(sql`COALESCE(b.run_date,(b.created_at AT TIME ZONE m.timezone)::date)=${filters.date}::date`)
  if (filters.matkaId) conditions.push(sql`m.id=${filters.matkaId}::uuid`)
  if (filters.matkaType) conditions.push(sql`COALESCE(m.settings->>'matkaType',b.matka_type::text)=${filters.matkaType}`)
  if (filters.session) conditions.push(sql`${settlementSession}=${filters.session}`)
  // Trading date matches the settlement engine, including the legacy null-runDate fallback.
  // No status/time-of-day/deleted-market filter: overdue obligations must remain visible.
  return sql`SELECT b.*,m.name,m.code,m.timezone,m.schedule,m.settings,
    COALESCE(m.settings->>'matkaType',b.matka_type::text) AS kind,
    COALESCE(b.run_date,(b.created_at AT TIME ZONE m.timezone)::date)::text AS trading_date,
    ${settlementSession} AS result_session
    FROM matka_bets b JOIN matkas m ON m.id=b.matka_id WHERE ${sql.join(conditions, sql` AND `)}`
}
const resultRows = (result: any) => result?.rows ?? result ?? []
function resultTime(row: any): string | null {
  if (!row.session) return null
  const schedule = row.schedule || {}, time = row.session === 'open' ? schedule.openTime : schedule.closeTime
  if (!/^\d{2}:\d{2}$/.test(time || '')) return null
  let value = DateTime.fromISO(`${row.date}T${time}`, { zone: row.timezone })
  if (row.session === 'close' && row.matkaType === 'worli' && (schedule.closesNextDay || schedule.closeTime <= schedule.openTime)) value = value.plus({ days: 1 })
  return value.isValid ? value.toUTC().toISO() : null
}
export async function listRunningMatkaMarkets(tenant: string, input: unknown = {}, executor: any = db) {
  const filters = filtersSchema.parse(input || {}), offset = (filters.page - 1) * filters.limit
  const [data] = resultRows(await executor.execute(sql`WITH open_bets AS (${scopedBets(tenant, filters)}), grouped AS (
    SELECT matka_id AS "matkaId",name AS "marketName",code,kind AS "matkaType",trading_date AS date,result_session AS session,
      timezone,schedule,COUNT(*)::int AS "betCount",COUNT(DISTINCT user_id)::int AS "playerCount",
      CASE WHEN COUNT(DISTINCT currency)=1 THEN MIN(currency) ELSE NULL END AS currency,
      CASE WHEN COUNT(DISTINCT currency)=1 THEN SUM(bet_amount)::float8 ELSE NULL END AS "totalStake",
      CASE WHEN COUNT(DISTINCT currency)=1 THEN SUM(COALESCE(potential_win,bet_amount*payout_multiplier))::float8 ELSE NULL END AS "potentialPayout",
      MIN(created_at) AS "oldestBetAt"
    FROM open_bets GROUP BY matka_id,name,code,kind,trading_date,result_session,timezone,schedule
  ), sessions AS (
    SELECT g.*,r.result AS "resultValue",o.result AS "openResultValue"
    FROM grouped g LEFT JOIN matka_results r ON r.tenant=${tenant} AND r.matka_id=g."matkaId" AND r.date=g.date::date AND r.type::text=g.session AND r.rolled_back_at IS NULL
    LEFT JOIN matka_results o ON o.tenant=${tenant} AND o.matka_id=g."matkaId" AND o.date=g.date::date AND o.type='open' AND o.rolled_back_at IS NULL
  ) SELECT COUNT(*)::int AS total,COALESCE(SUM("betCount"),0)::int AS "openBetCount",
    COUNT(*) FILTER(WHERE "resultValue" IS NULL)::int AS "pendingResultCount",
    COALESCE((SELECT json_agg(items) FROM (SELECT * FROM sessions ORDER BY date ASC,"marketName" ASC,CASE WHEN session='open' THEN 0 ELSE 1 END,"matkaId" ASC LIMIT ${filters.limit} OFFSET ${offset}) items),'[]'::json) AS items FROM sessions`))
  const items = (data?.items || []).map((row: any) => {
    const needsOpen = row.matkaType === 'worli' && row.session === 'close' && !row.openResultValue
    return { ...row, id: `${row.matkaId}:${row.date}:${row.session || 'unknown'}`, resultAt: resultTime(row),
      declareSession: needsOpen ? 'open' : row.session,
      resultStatus: !row.session ? 'REVIEW_REQUIRED' : row.resultValue ? 'SETTLEMENT_PENDING' : needsOpen ? 'OPEN_RESULT_REQUIRED' : 'RESULT_PENDING',
      canDeclare: !!row.session && !row.resultValue && row.date <= DateTime.now().setZone(row.timezone).toISODate()!,
    }
  })
  return { items, total: data?.total || 0, openBetCount: data?.openBetCount || 0, pendingResultCount: data?.pendingResultCount || 0 }
}
export async function listRunningMatkaBets(tenant: string, input: unknown, executor: any = db) {
  const filters = filtersSchema.extend({ matkaId: z.string().uuid(), date: day }).parse(input)
  const sessionClause = filters.session ? sql`result_session=${filters.session}` : sql`result_session IS NULL`
  const [data] = resultRows(await executor.execute(sql`WITH scoped AS (${scopedBets(tenant, filters)}), selected AS (
    SELECT b.id,b.user_id::text AS "userId",u.name AS "playerName",b.bid_type AS "bidType",b.bet_numbers AS selection,
      b.bet_amount::float8 AS amount,b.payout_multiplier::float8 AS "payoutMultiplier",
      COALESCE(b.potential_win,b.bet_amount*b.payout_multiplier)::float8 AS "potentialPayout",b.currency,b.status,b.created_at AS "createdAt",b.wallet_type AS "walletType"
    FROM scoped b LEFT JOIN users u ON u.id=b.user_id AND u.tenant=${tenant} WHERE ${sessionClause}
  ) SELECT COUNT(*)::int AS total,COALESCE((SELECT json_agg(items) FROM (SELECT * FROM selected ORDER BY "createdAt" ASC,id ASC LIMIT ${filters.limit} OFFSET ${(filters.page - 1) * filters.limit}) items),'[]'::json) AS items FROM selected`))
  return { items: data?.items || [], total: data?.total || 0 }
}
