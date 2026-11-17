import {
  listDraws, listRateVersions, getCurrentRates, listResults as mkListResults, listSettlements as mkListSettlements,
} from '@/stores/index.js'
import { listMatkasDb, getMatkaDb, exportMatkasCsvDb } from '@/repos/matka/matkaRepo.js'
import { z } from 'zod'
import { listMatkaBidRulesDb } from '@src/repos/matka/matkaBidRulesRepo.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { listResultsByDraw } from '@/repos/matka/resultsRepo.js'
import { listResultApprovals } from '@/repos/matka/approvalsRepo.js'
import { listApprovals } from '@/stores/index.js'
import { listMatkaResults, existsOpenResult, getResultByComposite } from '@src/repos/matka/matkaResultsRepo.js'
import { getEffectiveTenantForDirector, shouldSkipTenantFiltering } from '@src/domains/common/directorModeUtils.js'
import { requireReadPermission } from '@src/domains/common/auth.js'
import { runningMatkaTenant, listRunningMatkaMarkets, listRunningMatkaBets } from '../services/runningMarkets.js'

/** matkas.id is a uuid. Any other id (the audit trail's '*' or 'bulk', a typo in the URL) names no matka. */
const MATKA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const matkaQueryResolvers = {
  matkaRunningMarkets: (_: any, args: any, ctx: any) => listRunningMatkaMarkets(runningMatkaTenant(ctx), args.filters),
  matkaRunningBets: (_: any, args: any, ctx: any) => listRunningMatkaBets(runningMatkaTenant(ctx), args.filters),
  draws: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'matka.management', 'view')
    return listDraws({
      status: args.status ?? undefined,
      from: args.from ?? undefined,
      to: args.to ?? undefined,
    })
  },
  rates: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'matka.rates', 'view')
    if (args.current) {
      const cur = getCurrentRates()
      if (!cur) return []
      return [{ 
        id: cur.id, 
        effectiveFrom: cur.effectiveFrom, 
        createdBy: cur.createdBy, 
        status: cur.status, 
        rates: Object.entries(cur.rates).map(([key,value]) => ({ key, value })) 
      }]
    }
    return listRateVersions().map(v => ({ 
      id: v.id, 
      effectiveFrom: v.effectiveFrom, 
      createdBy: v.createdBy, 
      status: v.status, 
      rates: Object.entries(v.rates).map(([key,value]) => ({ key, value })) 
    }))
  },
  results: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'matka.results', 'view')
    const dbRows = await listResultsByDraw(args.drawId)
    if (dbRows.length) return dbRows.map(r => ({ 
      id: String(r.id), 
      drawId: r.drawId, 
      value: r.value, 
      enteredBy: r.enteredBy, 
      enteredAt: r.enteredAt.toISOString() 
    }))
    return mkListResults(args.drawId)
  },
  settlements: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'matka.management', 'view')
    return mkListSettlements(args.drawId)
  },
  resultApprovals: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'matka.results', 'view')
    const rows = await listResultApprovals(args.drawId ?? undefined)
    if (rows.length) return rows.map(r => ({ 
      id: String(r.id), 
      drawId: r.drawId, 
      value: r.value, 
      status: r.status, 
      requestedBy: r.requestedBy, 
      approvedBy: r.approvedBy ?? null, 
      reason: r.reason ?? null, 
      requestedAt: r.requestedAt.toISOString(), 
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null 
    }))
    return listApprovals(args.drawId ?? undefined)
  },
  // Matka entity management
  matkaCatalog: async (_: any, args: any, ctx: any): Promise<any> => matkaQueryResolvers.matkas(_, { ...args, complete: true }, ctx),
  matkas: async (_: any, args: any, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip tenant filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'view')) throw new Error('Forbidden')
    const schema = z.object({ filters: z.object({ query: z.string().optional(), status: z.string().optional(), timezone: z.string().optional(), page: z.number().int().optional(), limit: z.number().int().optional(), sort: z.string().optional() }).optional() })
    const p = schema.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    // normalize filters (UI sends status as UPPERCASE; DB stores lowercase)
    const rawFilters = p.data.filters ?? {}
    const normalizedFilters = {
      ...rawFilters,
      status: rawFilters.status ? (String(rawFilters.status).toLowerCase() as any) : undefined,
    }
    const page = await listMatkasDb(normalizedFilters, tenant, args.complete === true)
    return {
      items: (page.items || []).map((m: any) => ({
        ...m,
        status: String(m.status || '').toUpperCase(),
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
        updatedAt: m.updatedAt instanceof Date ? m.updatedAt.toISOString() : m.updatedAt,
        deletedAt: m.deletedAt instanceof Date ? m.deletedAt.toISOString() : (m.deletedAt ?? null),
      })),
      total: page.total ?? 0,
    }
  },
  matka: async (_: any, args: any, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip tenant filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'view')) throw new Error('Forbidden')
    // Not found, as for a uuid of no matka: Postgres refuses a malformed uuid, which reached the Matka Details
    // page as INTERNAL_SERVER_ERROR ("Failed to load").
    if (typeof args.id !== 'string' || !MATKA_ID.test(args.id)) return null
    const m = await getMatkaDb(args.id, tenant)
    if (!m) return null
    return {
      ...m,
      status: String(m.status || '').toUpperCase(),
      createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
      updatedAt: m.updatedAt instanceof Date ? m.updatedAt.toISOString() : m.updatedAt,
      deletedAt: m.deletedAt instanceof Date ? m.deletedAt.toISOString() : (m.deletedAt ?? null),
    }
  },
  matkasByIds: async (_: any, args: { matkaIds: string[] }, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip tenant filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'view')) throw new Error('Forbidden')
    const { getMatkasByIdsDb } = await import('@/repos/matka/matkaRepo.js')
    // Only uuids reach the read: Postgres refuses a malformed one in the uuid column, which failed the whole list the
    // way matka(id) failed. Any other id names no matka, so it is left out, like an id of no matka.
    const matkaIds = (Array.isArray(args.matkaIds) ? args.matkaIds : []).map(id => String(id)).filter(id => MATKA_ID.test(id))
    if (!matkaIds.length) return []
    const rows = await getMatkasByIdsDb(matkaIds, tenant)
    return rows.map((m: any) => ({
      ...m,
      id: String(m.id),
      status: String(m.status || '').toUpperCase(),
      createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
      updatedAt: m.updatedAt instanceof Date ? m.updatedAt.toISOString() : m.updatedAt,
      deletedAt: m.deletedAt instanceof Date ? m.deletedAt.toISOString() : (m.deletedAt ?? null),
    }))
  },
  matkaRateVersions: async (_: any, args: any, ctx: any) => {
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'view')) throw new Error('Forbidden')
    const { listRateVersionsByMatka } = await import('@/repos/matka/matkaRepo.js')
    return listRateVersionsByMatka(args.matkaId, tenant)
  },
  matkasExportCSV: async (_: any, args: any, ctx: any) => {
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'view')) throw new Error('Forbidden')
    const schema = z.object({ filters: z.object({ query: z.string().optional(), status: z.string().optional(), timezone: z.string().optional(), sort: z.string().optional() }).optional() })
    const p = schema.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const rawFilters = p.data.filters ?? {}
    const normalizedFilters = {
      ...rawFilters,
      status: rawFilters.status ? (String(rawFilters.status).toLowerCase() as any) : undefined,
    }
    return exportMatkasCsvDb(normalizedFilters, tenant)
  },
  matkaDefaultRates: async (_: any, _args: any, ctx: any) => {
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'view')) throw new Error('Forbidden')
    const { getDefaultRatesDb } = await import('@/repos/matka/matkaRepo.js')
    const row = await getDefaultRatesDb(tenant)
    return { tenant: row.tenant, entries: (row.entries as any)?.entries ?? [], updatedBy: row.updatedBy ?? null, updatedAt: row.updatedAt.toISOString?.() ?? new Date().toISOString() }
  },
  matkaBidRules: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'matka.management', 'view')
    const schema = z.object({ filters: z.object({ matkaId: z.string().optional(), search: z.string().optional(), page: z.number().optional(), limit: z.number().optional() }).optional() })
    const p = schema.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const { items, total } = await listMatkaBidRulesDb({ tenant, matkaId: p.data.filters?.matkaId, search: p.data.filters?.search, page: p.data.filters?.page, limit: p.data.filters?.limit })
    // Serialize dates and numerics
    const itemsNorm = items.map((r: any) => ({
      ...r,
      percentage: Number(r.percentage),
      minStake: r.minStake != null ? Number(r.minStake) : null,
      maxStake: r.maxStake != null ? Number(r.maxStake) : null,
      exposureCap: r.exposureCap != null ? Number(r.exposureCap) : null,
      createdAt: r.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: r.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    }))
    return { items: itemsNorm, total }
  },
  matkaBets: async (_: any, args: { query?: any }, ctx: any) => {
    requireReadPermission(ctx, 'matka.bets', 'view')
    const { getMatkaBets } = await import('@src/repos/matka/matkaBetsRepo.js')
    const { PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? ctx?.tenant ?? 'default'
    const wl = (directorTenant ?? ctx?.whitelabel?.id) as string
    
    // The session's tenant and whitelabel come LAST: the input type carries
    // `tenant` and `whitelabelId` fields, and spreading the query over them let
    // a caller read another whitelabel's matka bets by naming it.
    const filter: Record<string, unknown> = {
      ...args.query,
      tenant,
      whitelabelId: wl,
    }

    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const playerAuthService = new PlayerAuthService()
      const agentPlayerIds = await playerAuthService.getAgentPlayerIds(ctx.user.agentId, tenant)
      if (agentPlayerIds.length === 0) {
        return []
      }
      // A requested player narrows the list (only among the agent's own); it
      // used to be replaced by the agent's whole player list.
      const requested: number[] = []
      if (Array.isArray(filter.userIds)) requested.push(...(filter.userIds as unknown[]).map((v) => Number(v)))
      if (filter.userId != null) requested.push(Number(filter.userId))
      const own = new Set(agentPlayerIds)
      const scopedIds = requested.length > 0 ? requested.filter((id) => Number.isFinite(id) && own.has(id)) : agentPlayerIds
      if (scopedIds.length === 0) {
        return []
      }
      filter.userIds = scopedIds
      delete filter.userId
    }

    const bets = await getMatkaBets(filter as any)

    // Each bet's player as the bets page names one (name, else username): one read for the whole page, in the bets' own
    // tenant. userName was never filled, so the /matka/live player views listed every player as "User #<id>"; a player
    // not found there keeps userName null, and the views fall back to "User #<id>".
    const userIds = [...new Set(bets.map((bet: any) => Number(bet.userId)).filter((id: number) => Number.isSafeInteger(id) && id > 0))]
    const { getUsersByIdsBasicDb } = await import('@src/repos/users/usersRepo.js')
    const players = userIds.length ? await getUsersByIdsBasicDb(userIds, tenant) : []
    const userNames = new Map(players.map((player) => [player.id, player.name || player.username || null]))

    // Format the response
    return bets.map((bet: any) => ({
      id: bet.id,
      tenant: bet.tenant,
      whitelabelId: bet.whitelabelId,
      userId: bet.userId,
      userName: userNames.get(Number(bet.userId)) ?? null,
      matkaId: bet.matkaId,
      matkaName: bet.matkaName ?? null,
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
    }))
  },
  matkaResults: async (_: any, args: any, ctx: any) => {
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    if (!hasPermission(ctx?.permissions ?? [], 'matka.results', 'view')) throw new Error('Forbidden')
    const schema = z.object({
      filters: z.object({
        matkaId: z.string().optional(),
        type: z.enum(['open', 'close']).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        search: z.string().optional(),
        rolledBack: z.boolean().optional(),
        page: z.number().int().optional(),
        limit: z.number().int().optional(),
        sort: z.string().optional(),
      }).optional(),
    })
    const p = schema.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const filters = { ...p.data.filters, tenant }
    const page = await listMatkaResults(filters)
    
    // Get pending bets count and user names for each result
    const { countOpenMatkaBets } = await import('@src/domains/matka/services/runningMarkets.js')
    const { getUserDb } = await import('@src/repos/users/usersRepo.js')

    const itemsWithBets = await Promise.all(
      page.items.map(async (item: any) => {
        // The open bets this result session still has to settle (a rolled-back result re-opens its bets)
        const pendingBets = await countOpenMatkaBets(
          tenant,
          item.matkaId,
          String(item.date),
          item.type === 'open' ? 'open' : 'close',
        )
        
        // Resolve user names
        let declaredByName: string | undefined = undefined
        let rolledBackByName: string | undefined = undefined
        
        // Try to resolve declaredBy as user ID
        const declaredById = Number.parseInt(item.declaredBy, 10)
        if (Number.isFinite(declaredById)) {
          try {
            const user = await getUserDb(declaredById, tenant)
            declaredByName = user?.name || item.declaredBy
          } catch {
            declaredByName = item.declaredBy
          }
        } else {
          declaredByName = item.declaredBy
        }
        
        // Try to resolve rolledBackBy as user ID
        if (item.rolledBackBy) {
          const rolledBackById = Number.parseInt(item.rolledBackBy, 10)
          if (Number.isFinite(rolledBackById)) {
            try {
              const user = await getUserDb(rolledBackById, tenant)
              rolledBackByName = user?.name || item.rolledBackBy
            } catch {
              rolledBackByName = item.rolledBackBy
            }
          } else {
            rolledBackByName = item.rolledBackBy
          }
        }
        
        return {
          ...item,
          date: item.date,
          type: item.type,
          declaredAt: item.declaredAt instanceof Date ? item.declaredAt.toISOString() : item.declaredAt,
          rolledBackAt: item.rolledBackAt instanceof Date ? item.rolledBackAt.toISOString() : (item.rolledBackAt ?? null),
          createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
          pendingBetsCount: pendingBets,
          declaredByName,
          rolledBackByName,
        }
      })
    )
    
    return {
      items: itemsWithBets,
      total: page.total,
    }
  },
  matkaResultExists: async (_: any, args: any, ctx: any) => {
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    if (!hasPermission(ctx?.permissions ?? [], 'matka.results', 'view')) throw new Error('Forbidden')
    const schema = z.object({
      matkaId: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      type: z.enum(['open', 'close']),
    })
    const p = schema.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const { matkaId, date, type } = p.data
    if (type === 'open') {
      return await existsOpenResult(matkaId, date, tenant)
    }
    const existing = await getResultByComposite(matkaId, date, 'close', tenant)
    return Boolean(existing && !existing.rolledBackAt)
  },
}
