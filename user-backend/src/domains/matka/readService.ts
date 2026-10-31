import { loadPlayerDomains } from '@shared/access/playerDomains.js'
import { matkaRateFingerprint } from '@shared/matka/catalogue.js'
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { appConfigs, matkaBets, matkaDefaultRates, matkaRateVersions, matkaResults, matkas, matkaWorliInstances, users, wallets } from '@shared/db/schema.js'
import { matkaKind, BID_LABELS, allowedBids, normalizeBid, resultDigit, payoutMinor, type MatkaSession } from '@shared/matka/rules.js'
import { matkaSchedule } from '@shared/matka/schedule.js'
import { creditPlayer } from '@shared/matka/wallet.js'
import { db } from '../../db/client.js'

export const matkaMeta = (total = 0, page = 1, limit = 50) => ({ code: 200, message: 'ok', total, page, hasMore: page * limit < total })
const kindFromEnum = (value?: string | null) => value === 'SATTA_MATKA' ? 'sattaMatka' : value?.toLowerCase()
const kindToEnum = (value: string) => value === 'sattaMatka' ? 'SATTA_MATKA' : value.toUpperCase()
export function publicMatkaResult(kind: string, date: string, openResult?: string | null, closeResult?: string | null) {
  const digit = (value?: string | null) => value && /^\d{3}$/.test(value) ? resultDigit(value) : null
  const openDigit = digit(openResult), closeDigit = digit(closeResult)
  const jodi = kind === 'jackpot' || kind === 'sattaMatka' ? closeResult || null : openDigit != null && closeDigit != null ? openDigit + closeDigit : null
  return { date, openResult: openResult || null, closeResult: closeResult || null, openDigit, closeDigit, jodi,
    complete: kind === 'starline' ? !!openResult : kind === 'worli' ? !!openResult && !!closeResult : !!closeResult }
}
async function snapshots(markets: Array<typeof matkas.$inferSelect>, tenant: string) {
  if (!markets.length) return []
  const now = new Date(), schedules = markets.map(market => matkaSchedule(market, now)), ids = markets.map(m => m.id)
  const scope = markets.map((market, i) => and(eq(matkaResults.matkaId, market.id), eq(matkaResults.date, schedules[i].runDate)))
  const instanceScope = markets.map((market, i) => and(eq(matkaWorliInstances.marketId, market.id), eq(matkaWorliInstances.runDate, schedules[i].runDate)))
  const [results, instances, versions, defaults] = await Promise.all([
    db.select().from(matkaResults).where(and(eq(matkaResults.tenant, tenant), isNull(matkaResults.rolledBackAt), or(...scope))),
    db.select().from(matkaWorliInstances).where(or(...instanceScope)),
    db.select().from(matkaRateVersions).where(and(eq(matkaRateVersions.tenant, tenant), inArray(matkaRateVersions.matkaId, ids), lte(matkaRateVersions.effectiveFrom, now), or(isNull(matkaRateVersions.effectiveTo), sql`${matkaRateVersions.effectiveTo}>${now}`))).orderBy(desc(matkaRateVersions.effectiveFrom)),
    db.select().from(matkaDefaultRates).where(eq(matkaDefaultRates.tenant, tenant)).limit(1),
  ])
  return markets.map((market, index) => {
    const published: Partial<Record<MatkaSession, string>> = {}
    for (const result of results) if (result.matkaId === market.id) published[result.type] = result.result
    const schedule = matkaSchedule(market, now, instances.filter(row => row.marketId === market.id), published), kind = schedule.kind
    const raw = (versions.find(row => row.matkaId === market.id)?.entries || defaults[0]?.entries || {}) as { entries?: Array<{ betType: string; payoutMultiplier: number }> }
    const rateMap = new Map()
    for (const entry of (Array.isArray(raw) ? raw : raw.entries || [])) {
      try {
        const bid = normalizeBid(entry.betType); payoutMinor(100n, entry.payoutMultiplier)
        if (allowedBids(kind).includes(bid)) rateMap.set(bid, { bidType: bid, label: BID_LABELS[bid], payoutMultiplier: Number(entry.payoutMultiplier) })
      } catch { /* Unsupported legacy rates are not offered to players. */ }
    }
    const rates = [...rateMap.values()]
    const limits = market.limits as { minBet?: number; maxBet?: number }, settings = market.settings as { message?: string }
    return { id: market.id, code: market.code, name: market.name, kind: kindToEnum(kind), description: market.description,
      timezone: market.timezone, runDate: schedules[index].runDate, status: schedule.status, message: instances.find(row => row.marketId === market.id && row.operatorMessage)?.operatorMessage || settings.message || null,
      minStake: Number(limits.minBet ?? 10), maxStake: Number(limits.maxBet ?? 10000), featured: Boolean((market.visibility as { featured?: boolean }).featured),
      quoteVersion: matkaRateFingerprint(rates), sessions: [schedule.open, schedule.close].map(side => ({ ...side, side: side.side.toUpperCase() })), rates,
      result: publicMatkaResult(kind, schedule.runDate, published.open, published.close),
    }
  })
}
export async function playerMatkaMarkets(tenant: string, input: { kind?: string; search?: string; page?: number; limit?: number } = {}) {
  const [config] = await db.select({ enabled: appConfigs.matkaEnabled }).from(appConfigs).where(eq(appConfigs.whitelabelId, tenant)).limit(1)
  if (config?.enabled === false) return { meta: matkaMeta(), data: [] }
  const page = Math.max(1, Math.trunc(input.page || 1)), limit = Math.max(1, Math.min(100, input.limit || 50))
  const filters = [eq(matkas.tenant, tenant), isNull(matkas.deletedAt), eq(matkas.status, 'active'), sql`COALESCE((${matkas.visibility}->>'hidden')::boolean,false)=false`]
  if (input.kind) filters.push(sql`COALESCE(${matkas.settings}->>'matkaType','worli')=${kindFromEnum(input.kind)}`)
  if (input.search?.trim()) filters.push(or(ilike(matkas.name, `%${input.search.trim().slice(0, 120)}%`), ilike(matkas.code, `%${input.search.trim().slice(0, 120)}%`))!)
  const [items, counts] = await Promise.all([db.select().from(matkas).where(and(...filters)).orderBy(asc(matkas.priority), asc(matkas.name), asc(matkas.id)).limit(limit).offset((page - 1) * limit), db.select({ total: sql<number>`count(*)::int` }).from(matkas).where(and(...filters))])
  return { meta: matkaMeta(Number(counts[0].total), page, limit), data: await snapshots(items, tenant) }
}
export async function playerMatkaMarket(tenant: string, identifier: string) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)
  const [market] = await db.select().from(matkas).where(and(eq(matkas.tenant, tenant), isNull(matkas.deletedAt), uuid ? eq(matkas.id, identifier) : eq(matkas.code, identifier.slice(0, 120)), sql`COALESCE((${matkas.visibility}->>'hidden')::boolean,false)=false`)).limit(1)
  if (!market) return { meta: { code: 404, message: 'Matka market not found' }, data: null }
  const [config] = await db.select({ enabled: appConfigs.matkaEnabled }).from(appConfigs).where(eq(appConfigs.whitelabelId, tenant)).limit(1)
  if (config?.enabled === false) return { meta: { code: 403, message: 'Matka is unavailable on this site' }, data: null }
  return { meta: matkaMeta(1), data: (await snapshots([market], tenant))[0] }
}
export async function playerMatkaChart(tenant: string, marketId: string, from: string, to: string) {
  const start = DateTime.fromISO(from), end = DateTime.fromISO(to)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !start.isValid || !end.isValid || end < start || end.diff(start, 'days').days > 366) throw new Error('Choose a valid chart range up to one year')
  const response = await playerMatkaMarket(tenant, marketId)
  if (!response.data) return { meta: response.meta, data: [] }
  const kind = kindFromEnum(response.data.kind)!, resultRows = await db.select().from(matkaResults).where(and(eq(matkaResults.tenant, tenant), eq(matkaResults.matkaId, response.data.id), isNull(matkaResults.rolledBackAt), gte(matkaResults.date, from), lte(matkaResults.date, to))).orderBy(asc(matkaResults.date))
  const dates = new Map<string, { open?: string; close?: string }>()
  for (const row of resultRows) dates.set(row.date, { ...dates.get(row.date), [row.type]: row.result })
  const data = [...dates].map(([date, result]) => publicMatkaResult(kind, date, result.open, result.close))
  return { meta: matkaMeta(data.length), data }
}
export function playerMatkaBet(row: typeof matkaBets.$inferSelect) {
  const payout = row.actualWin == null ? null : Number(row.actualWin)
  return { id: row.id, batchId: row.batchId, marketId: row.matkaId, marketName: row.marketName, runDate: row.runDate || DateTime.fromJSDate(row.createdAt, { zone: 'Asia/Kolkata' }).toISODate(),
    bidType: row.bidType, selection: row.betNumbers, session: row.marketSession === 'close' ? 'CLOSE' : 'OPEN', amount: Number(row.betAmount), payoutMultiplier: Number(row.payoutMultiplier),
    potentialWin: Number(row.potentialWin || 0), actualWin: payout, netProfit: payout == null ? null : payout - Number(row.betAmount), status: row.status,
    result: row.result, walletType: row.walletType, currency: row.currency, createdAt: row.createdAt.toISOString(), settledAt: row.settledAt?.toISOString() || null }
}
export async function ownMatkaBets(tenant: string, userId: number, input: { marketId?: string; status?: string; from?: string; to?: string; page?: number; limit?: number }) {
  const filters = [eq(matkaBets.tenant, tenant), eq(matkaBets.userId, userId)], page = Math.max(1, input.page || 1), limit = Math.max(1, Math.min(100, input.limit || 20))
  if (input.from && input.to && input.from > input.to) throw new Error('Entry date range is reversed')
  if (input.marketId && !/^[0-9a-f-]{36}$/i.test(input.marketId)) throw new Error('Invalid Matka market')
  if (input.marketId) filters.push(eq(matkaBets.matkaId, input.marketId))
  if (input.status && input.status !== 'all') {
    if (input.status === 'open') filters.push(inArray(matkaBets.status, ['active', 'pending']))
    else if (['won', 'lost', 'void', 'cancelled'].includes(input.status)) filters.push(sql`${matkaBets.status}::text=${input.status}`)
    else throw new Error('Invalid Matka entry status')
  }
  for (const [value, lower] of [[input.from, true], [input.to, false]] as const) if (value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !DateTime.fromISO(value).isValid) throw new Error('Invalid entry date')
    filters.push(lower ? sql`COALESCE(${matkaBets.runDate},(${matkaBets.createdAt} AT TIME ZONE 'Asia/Kolkata')::date)>=${value}::date` : sql`COALESCE(${matkaBets.runDate},(${matkaBets.createdAt} AT TIME ZONE 'Asia/Kolkata')::date)<=${value}::date`)
  }
  const [items, counts] = await Promise.all([db.select().from(matkaBets).where(and(...filters)).orderBy(desc(matkaBets.createdAt), desc(matkaBets.id)).limit(limit).offset((page - 1) * limit), db.select({ total: sql<number>`count(*)::int` }).from(matkaBets).where(and(...filters))])
  return { meta: matkaMeta(Number(counts[0].total), page, limit), data: items.map(playerMatkaBet) }
}
export async function ownMatkaWallet(tenant: string, userId: number) {
  const [row] = await db.select({ player: users, wallet: wallets }).from(users).innerJoin(wallets, and(eq(wallets.userId, users.id), eq(wallets.tenant, users.tenant))).where(and(eq(users.id, userId), eq(users.tenant, tenant))).limit(1)
  if (!row) return { meta: { code: 404, message: 'Wallet not found' }, data: [], canBet: false }
  const { player, wallet } = row, isCredit = creditPlayer(player.playerType)
  const access = (await loadPlayerDomains(db, tenant, userId)).matka
  const canBet = access.canBet
  return { meta: matkaMeta(), canBet, message: access.message, data: [
    { walletType: 'CASH', label: isCredit ? 'Available credit' : 'Main wallet', balance: isCredit ? Math.max(0, Number(player.creditLimit) - Number(player.creditUsed) + Number(player.settlementBalance)) : Math.max(0, Number(wallet.cash) - Number(wallet.exposure)), currency: wallet.currency },
    ...isCredit ? [] : [{ walletType: 'BONUS', label: 'Bonus wallet', balance: Number(wallet.bonus), currency: wallet.currency }, { walletType: 'REFERRAL_BONUS', label: 'Referral bonus', balance: Number(wallet.referralBonus), currency: wallet.currency }],
  ] }
}
