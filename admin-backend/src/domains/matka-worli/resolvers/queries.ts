import { getEffectiveTenantForDirector, shouldSkipTenantFiltering } from '@/domains/common/directorModeUtils.js'
import { listWorliInstances, getWorliInstanceById, getWorliInstanceByIdScoped } from '@/repos/matka-worli/worliInstancesRepo.js'
import { computeWorliBookByInstance, listBetsByInstanceWithFilters } from '@/repos/matka/matkaBetsRepo.js'
import { listWorliActivity } from '@/repos/matka-worli/worliActivityRepo.js'
import { hasPermission } from '@/domains/common/auth.js'

export function worliReadTenant(ctx: any) { return shouldSkipTenantFiltering(ctx) ? undefined : getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default' }
export async function authorizedWorliInstance(id: string, ctx: any) {
  if (!hasPermission(ctx?.permissions, 'matka.worli', 'view')) throw new Error('Forbidden')
  const tenant = worliReadTenant(ctx)
  const instance = tenant === undefined ? await getWorliInstanceById(id) : await getWorliInstanceByIdScoped(id, tenant)
  if (!instance) throw new Error('Market session not found')
  return instance
}
export const worliQueryResolvers = {
  worliRunningInstances: async function (_: any, args: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'view')) throw new Error('Forbidden')
    const { date, marketId, status, search, hasResult, page, limit, sort } = args || {}
    const { items, total } = await listWorliInstances({ tenant: worliReadTenant(ctx), date, marketId, status, search, hasResult, page, limit, sort: (sort as any) ?? 'closeAt:desc' })
    return {
      items: items.map((row: any) => {
        const inst = row
        const marketName = (row as any).__marketName ?? null
        return {
          id: inst.id,
          marketId: inst.marketId,
          marketName,
          runDate: inst.runDate,
          side: inst.side,
          status: inst.status,
          scheduledOpenAt: inst.scheduledOpenAtUtc?.toISOString?.() ?? null,
          scheduledLockAt: inst.scheduledLockAtUtc?.toISOString?.() ?? null,
          scheduledCloseAt: inst.scheduledCloseAtUtc?.toISOString?.() ?? null,
          operatorMessage: inst.operatorMessage,
        counters: {
            betCount: inst.betCount,
            totalStakeMinor: Number(inst.totalStakeMinor ?? 0),
            exposureTotalMinor: Number(inst.exposureTotalMinor ?? 0),
            worstOutcomeKey: inst.worstOutcomeKey ?? null,
            worstOutcomePlMinor: inst.worstOutcomePlMinor != null ? Number(inst.worstOutcomePlMinor) : null,
        },
          bidRulesVersionId: inst.bidRulesVersionId,
        }
      }),
      total,
    }
  },
  worliInstance: async function (_: any, { id }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'view')) throw new Error('Forbidden')
    const row = await authorizedWorliInstance(id, ctx)
    if (!row) return null
    return {
      id: row.id,
      marketId: row.marketId,
      marketName: null,
      runDate: row.runDate,
      side: row.side,
      status: row.status,
      scheduledOpenAt: row.scheduledOpenAtUtc?.toISOString?.() ?? null,
      scheduledLockAt: row.scheduledLockAtUtc?.toISOString?.() ?? null,
      scheduledCloseAt: row.scheduledCloseAtUtc?.toISOString?.() ?? null,
      operatorMessage: row.operatorMessage,
      counters: {
        betCount: row.betCount,
        totalStakeMinor: Number(row.totalStakeMinor ?? 0),
        exposureTotalMinor: Number(row.exposureTotalMinor ?? 0),
        worstOutcomeKey: row.worstOutcomeKey ?? null,
        worstOutcomePlMinor: row.worstOutcomePlMinor != null ? Number(row.worstOutcomePlMinor) : null,
      },
      bidRulesVersionId: row.bidRulesVersionId,
    }
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
    const { items, total } = await listBetsByInstanceWithFilters(instanceId, {
      search: filters?.search,
      userId: filters?.userId ? Number(filters.userId) : undefined,
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

