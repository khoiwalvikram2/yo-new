import { getEffectiveTenantForDirector, shouldSkipTenantFiltering } from '@/domains/common/directorModeUtils.js'
import { listWorliInstances, getWorliInstanceByIdScoped } from '@/repos/matka-worli/worliInstancesRepo.js'
import { computeWorliBookByInstance, listBetsByInstanceWithFilters } from '@/repos/matka/matkaBetsRepo.js'
import { listWorliActivity } from '@/repos/matka-worli/worliActivityRepo.js'
import { hasPermission } from '@/domains/common/auth.js'
import { worliInstanceViewOf, worliInstanceViews } from '@/domains/matka-worli/services/sessionView.js'
import { worliWorstOutcome } from '@/domains/matka-worli/services/RiskService.js'

export const SELECT_WHITELABEL_FOR_WORLI = 'Select a whitelabel to view and manage Worli sessions'
/**
 * The whitelabel a Worli read is scoped to.
 *
 * Agents are refused: these are operator screens (the admin router mounts them with adminRoute), and an
 * agent's flat `matka:read` reaches `matka.worli:view` through the nested-permission mapping, so every
 * agent read the whole whitelabel's sessions, figures and every player's Worli bets, and streamed new ones.
 * A Super Admin in core mode is refused too, as on the running-markets page: the session controls act per
 * whitelabel, and a platform-wide list whose controls all answered "Not found" helped nobody.
 */
export function worliReadTenant(ctx: any): string {
  if (ctx?.user?.type === 'agent') throw new Error('Forbidden')
  if (shouldSkipTenantFiltering(ctx)) throw new Error(SELECT_WHITELABEL_FOR_WORLI)
  return getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
}
const WORLI_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * Worli sessions, markets and bets have uuid ids. Postgres refuses anything else, which reached the session page
 * as INTERNAL_SERVER_ERROR; such an id names nothing, so callers treat it as not found before any lookup (as
 * matka(id) does), after their permission, agent and core-mode refusals.
 */
export function isWorliId(id: unknown): id is string {
  return typeof id === 'string' && WORLI_ID.test(id)
}
export const WORLI_DATE_INVALID = 'Date must be a valid calendar date in the form YYYY-MM-DD'
const WORLI_RUN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
/**
 * A session's run date as the running-markets page sends it: yyyy-MM-dd, of a day the calendar has (year 0001 on).
 * The list handed any other date to Postgres, which refused "abc", 2026-02-30 or year 0000 (INTERNAL_SERVER_ERROR)
 * and read its own spellings ('today', 20261103) the page never sends; so the list refuses such a date by name.
 */
export function isWorliRunDate(value: unknown): value is string {
  const parts = typeof value === 'string' ? WORLI_RUN_DATE.exec(value) : null
  if (!parts) return false
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return year >= 1 && days !== undefined && day >= 1 && day <= days
}
export const WORLI_USER_ID_INVALID = 'userId must be a player id: a whole number from 1 to 2147483647'
/**
 * The bets list's player filter (worliBets filters.userId; matka_bets.user_id is a Postgres integer). It was Number()ed
 * unchecked: "abc" became NaN, which the list read as no filter (every bet of the session came back), and "1.5" or
 * "99999999999" reached Postgres, which refused them (INTERNAL_SERVER_ERROR). Blank (absent, null, '' or spaces) is no
 * filter; anything else must be a whole number from 1 to 2147483647 (spaces around it allowed), or it is refused by name.
 */
export function worliBetsUserId(value: unknown): number | undefined {
  const text = value == null ? '' : String(value).trim()
  if (!text) return undefined
  const id = /^\d+$/.test(text) ? Number(text) : Number.NaN
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new Error(WORLI_USER_ID_INVALID)
  return id
}
export async function authorizedWorliInstance(id: string, ctx: any) {
  if (!hasPermission(ctx?.permissions, 'matka.worli', 'view')) throw new Error('Forbidden')
  const tenant = worliReadTenant(ctx)
  const instance = isWorliId(id) ? await getWorliInstanceByIdScoped(id, tenant) : null
  if (!instance) throw new Error('Market session not found')
  return instance
}
export const worliQueryResolvers = {
  worliRunningInstances: async function (_: any, args: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'view')) throw new Error('Forbidden')
    const { date, marketId, status, search, hasResult, page, limit, sort } = args || {}
    const tenant = worliReadTenant(ctx)
    // A date that is not a yyyy-MM-dd calendar date is refused by name, before the market filter's empty answer; no date is no filter.
    if (date && !isWorliRunDate(date)) throw new Error(WORLI_DATE_INVALID)
    // A market filter that is not a uuid names no market: nothing to list (Postgres would refuse it).
    if (marketId && !isWorliId(marketId)) return { items: [], total: 0 }
    const { items, total } = await listWorliInstances({ tenant, date, marketId, status, search, hasResult, page, limit, sort: (sort as any) ?? 'closeAt:desc' })
    // Status and lock time are the ones players get (worliInstanceView), so Live, Open and Locking Soon agree with the player API.
    const now = new Date()
    return {
      items: await worliInstanceViews(items, now),
      total,
    }
  },
  worliInstance: async function (_: any, { id }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'view')) throw new Error('Forbidden')
    const row = await authorizedWorliInstance(id, ctx)
    if (!row) return null
    const view = await worliInstanceViewOf(row)
    // Nothing stores the worst outcome (the columns were never written), so the session page works it out
    // from the open book on each read.
    const worst = await worliWorstOutcome(row)
    return { ...view, counters: { ...view.counters, worstOutcomeKey: worst?.key ?? null, worstOutcomePlMinor: worst ? Number(worst.plMinor) : null } }
  },
  worliBook: async function (_: any, { instanceId }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'view')) throw new Error('Forbidden')
    await authorizedWorliInstance(instanceId, ctx)
    const book = await computeWorliBookByInstance(instanceId)
    return {
      totalStakeMinor: Number(book.totalStakeMinor || 0),
      groups: book.groups.map((g: any) => ({
        bidType: g.bidType,
        items: g.items.map((i: any) => ({ selection: i.selection, betCount: i.betCount, plMinor: i.plMinor })),
      })),
    }
  },
  worliBets: async function (_: any, { instanceId, filters, page, limit }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'view')) throw new Error('Forbidden')
    await authorizedWorliInstance(instanceId, ctx)
    // A player filter that is not a player id is refused by name, after the session's refusals (as a bad time bound is).
    const userId = worliBetsUserId(filters?.userId)
    const { items, total } = await listBetsByInstanceWithFilters(instanceId, {
      search: filters?.search,
      userId,
      bidType: filters?.bidType,
      stakeMin: filters?.stakeMin,
      stakeMax: filters?.stakeMax,
      timeFrom: filters?.timeFrom,
      timeTo: filters?.timeTo,
    }, page ?? 1, limit ?? 50)
    return {
      items: items.map((bet: any) => ({
        id: bet.id,
        tenant: bet.tenant,
        whitelabelId: bet.whitelabelId,
        userId: bet.userId,
        matkaId: bet.matkaId,
        matkaType: bet.matkaType,
        marketName: bet.marketName,
        marketSession: bet.marketSession || null,
        bidType: bet.bidType,
        betNumbers: bet.betNumbers,
        betAmount: bet.betAmount ? Number(bet.betAmount) : 0,
        payoutMultiplier: bet.payoutMultiplier ? Number(bet.payoutMultiplier) : 0,
        potentialWin: bet.potentialWin ? Number(bet.potentialWin) : null,
        actualWin: bet.actualWin ? Number(bet.actualWin) : null,
        status: bet.status,
        result: bet.result || null,
        settledAt: bet.settledAt ? new Date(bet.settledAt).toISOString() : null,
        currency: bet.currency || 'USD',
        createdAt: bet.createdAt ? new Date(bet.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: bet.updatedAt ? new Date(bet.updatedAt).toISOString() : new Date().toISOString(),
      })),
      total,
    }
  },
  worliActivity: async function (_: any, { instanceId }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'view')) throw new Error('Forbidden')
    await authorizedWorliInstance(instanceId, ctx)
    const rows = await listWorliActivity(instanceId)
    return rows.map((r: any) => ({
      id: r.id,
      action: r.action,
      reason: r.reason,
      actorId: r.actorId,
      createdAt: r.createdAt?.toISOString?.() ?? new Date().toISOString(),
    }))
  },
}

