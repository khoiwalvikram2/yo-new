import { fetchGames } from '@src/domains/casino/adapters/casinoApi.js'
import { aggregateRTP, aggregateIncidents } from '@src/domains/casino/adapters/casinoRegistry.js'
import { getProviderKeysByIdsDb, listCasinoApiProvidersDb, listVendorsByProviderAndCategoryDb, listCasinoGamesPagedDb, listCasinoSelectionGamesDb, readCasinoSelectionIdsDb, getVipTierGamesDb, getGameVipTiersDb, getProvidersWithVendorsDb, getWhitelabelCasinoProviderSettingsDb, getWhitelabelCasinoVendorOverrideSettingsDb, getWhitelabelCasinoGameOverrideSettingsDb, computeProviderGGRDb, computeVendorGGRDb, getProviderVendorsStatsDb, getVendorGamesStatsDb, getCasinoGameBetSettingsDb, getCasinoGameBetSettingByPlayerDb, listCasinoCategoriesDb, getCasinoCategoryDb, getCategoriesForGameDb, listProviderVendorSharesDb, getGamesInCategoryDb, getCasinoGamesByIdsDb, listCasinoVendorsWithSettingsDb } from '@src/repos/casino/casinoRepo.js'
import { vipTiersTable, casinoVendors } from '@src/db/schema.js'
import { db } from '@src/db/client.js'
import { eq, inArray, and } from 'drizzle-orm'
import { getEffectiveTenantForDirector, shouldSkipTenantFiltering } from '@src/domains/common/directorModeUtils.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { toCasinoCategoryType } from '../categoryType.js'
import { getCasinoLoungeGameImagesDb } from '@src/repos/casino/loungeImagesRepo.js'
import {
  listProviders,
  categoriesTree,
  listLimits as listCasinoLimits,
  listJackpots,
  listPromotions,
  listContent as listCms,
} from '@/stores/index.js'

function mapCasinoGamesPage(page: any) {
    const mapCat = (v: any) => v === 'live_casino' ? 'LIVE_CASINO' : (v === 'casino' ? 'CASINO' : 'SLOTS')
    return {
      ...page,
      items: (page.items || []).map((it: any) => ({
        ...it,
        mainCategory: mapCat(it.mainCategory),
        updatedAt: it.updatedAt ? new Date(it.updatedAt).toISOString() : null,
        limits: it.limits ? {
          minStake: it.limits.minStake != null ? Number(it.limits.minStake) : null,
          maxStake: it.limits.maxStake != null ? Number(it.limits.maxStake) : null,
          maxWin: it.limits.maxWin != null ? Number(it.limits.maxWin) : null,
          maxWinTarget: it.limits.maxWinTarget || null,
          maxWinPlayers: it.limits.maxWinPlayers || [],
        } : null,
      })),
    }
}
function requireCasinoSelectionRead(ctx: any) {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')
  const permissions = ctx?.permissions ?? []
  if (!hasPermission(permissions, 'bonuses.detail', 'view') && !['view', 'create', 'update'].some(action => hasPermission(permissions, 'bonuses.bundles', action))) throw new Error('Forbidden: insufficient permissions for casino game selection')
}
function selectionIds(values: string[] | undefined): number[] | undefined {
  if (values == null) return undefined
  if (values.length > 50000) throw new Error('Too many selection IDs')
  const ids = [...new Set(values.map(Number))]
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid casino game ID')
  return ids
}
function selectionId(value: string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  return selectionIds([value])?.[0]
}

export const casinoQueryResolvers = {
  casinoSelectionGames: async (_: any, args: { input: { providerId?: string; vendorId?: string; search?: string; includeGameIds?: string[]; excludeGameIds?: string[]; page?: number; pageSize?: number } }, ctx: any) => {
    requireCasinoSelectionRead(ctx)
    const tenant = shouldSkipTenantFiltering(ctx) ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const input = args.input
    const page = await listCasinoSelectionGamesDb({ tenant, selectionMode: true, providerId: selectionId(input.providerId), vendorId: selectionId(input.vendorId), search: input.search,
      includeGameIds: selectionIds(input.includeGameIds), excludeGameIds: selectionIds(input.excludeGameIds), page: input.page, pageSize: input.pageSize })
    return mapCasinoGamesPage(page)
  },
  casinoSelectionGameIds: async (_: any, args: { providerId: string; gameIds: string[] }, ctx: any) => {
    requireCasinoSelectionRead(ctx)
    const tenant = shouldSkipTenantFiltering(ctx) ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const rows = await readCasinoSelectionIdsDb({ tenant, selectionMode: true, providerId: selectionId(args.providerId), includeGameIds: selectionIds(args.gameIds) })
    return rows.map(row => String(row.id))
  },
  games: async (_: any, args: any, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip whitelabel filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const whitelabelId = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id)
    
    return fetchGames({ 
      provider: args.provider ?? undefined, 
      category: args.category ?? undefined, 
      enabled: args.enabled ?? undefined,
      whitelabelId, 
    })
  },
  providers: async (_: any, __: any, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip whitelabel filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const whitelabelId = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id)
    
    return listProviders(whitelabelId)
  },
  rtp: async (_: any, args: any) => aggregateRTP({ 
    provider: args.provider ?? undefined, 
    range: args.range ?? undefined, 
    gameId: args.gameId ?? undefined 
  }),
  incidents: async (_: any, args: any) => aggregateIncidents({ 
    provider: args.provider ?? undefined, 
    from: args.from ?? undefined, 
    to: args.to ?? undefined, 
    level: args.level ?? undefined 
  }),
  casinoCategories: async (_: any, __: any, _ctx: any) => categoriesTree(),
  limits: async (_: any, args: any, _ctx: any) => listCasinoLimits(args.scope ?? undefined),
  jackpots: async (_: any, __: any, _ctx: any) => listJackpots(),
  promotions: async (_: any, __: any, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip whitelabel filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const whitelabelId = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id)
    const promos = listPromotions(whitelabelId)
    return promos.map(p => ({
      id: p.id,
      tenant: ctx?.whitelabel?.id || ctx?.tenant || 'default',
      name: p.name,
      status: p.status,
      targetingJson: p.targetingRules,
      scheduleStart: p.schedule.start,
      scheduleEnd: p.schedule.end,
      contentJson: null,
      createdAt: p.updatedAt,
      updatedAt: p.updatedAt,
    }))
  },
  content: async (_: any, __: any, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip whitelabel filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const whitelabelId = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id)
    return listCms(whitelabelId)
  },
  // Casino management hierarchy
  casinoApiProviders: async (_: any, __: any, ctx: any) => {
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    return listCasinoApiProvidersDb(tenant)
  },
  casinoVendors: async (_: any, args: { providerId?: string; category?: 'LIVE_CASINO'|'CASINO'|'SLOTS' }, ctx: any) => {
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const cat = args.category ? (args.category === 'LIVE_CASINO' ? 'live_casino' : (args.category as string).toLowerCase()) : undefined
    return listVendorsByProviderAndCategoryDb(
      args.providerId ? Number(args.providerId) : undefined,
      cat as any,
      tenant
    )
  },
  casinoVendorsWithSettings: async (_: any, args: { providerId?: string; category?: 'LIVE_CASINO'|'CASINO'|'SLOTS' }, ctx: any) => {
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const cat = args.category ? (args.category === 'LIVE_CASINO' ? 'live_casino' : (args.category as string).toLowerCase()) : undefined
    const rows = await listCasinoVendorsWithSettingsDb(
      tenant,
      args.providerId ? Number(args.providerId) : undefined,
      cat as any
    )
    return rows.map((r: any) => ({
      id: String(r.id),
      name: r.name,
      slug: r.slug,
      enabled: r.enabled ?? null,
      gamesCount: r.gamesCount ?? 0,
      enabledGamesCount: r.enabledGamesCount ?? 0,
      displayOrder: r.displayOrder ?? null,
    }))
  },
  casinoGames: async (_: any, args: { input: { providerId?: string; category: 'LIVE_CASINO'|'CASINO'|'SLOTS'; vendorId?: string; vipTierId?: string; search?: string; enabled?: boolean; page?: number; pageSize?: number } }, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip tenant filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const cat = args.input.category === 'LIVE_CASINO' ? 'live_casino' : (args.input.category as string).toLowerCase()
    const page = await listCasinoGamesPagedDb({
      tenant,
      providerId: args.input.providerId ? Number(args.input.providerId) : undefined,
      category: cat as any,
      vendorId: args.input.vendorId ? Number(args.input.vendorId) : undefined,
      vipTierId: args.input.vipTierId || undefined,
      search: args.input.search,
      enabled: typeof args.input.enabled === 'boolean' ? args.input.enabled : undefined,
      page: args.input.page,
      pageSize: args.input.pageSize,
    })
    return mapCasinoGamesPage(page)
  },
  gamesInCategory: async (_: any, args: { categoryId: string }, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip tenant filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const ids = await getGamesInCategoryDb(tenant, Number(args.categoryId))
    return ids.map((id: number) => String(id))
  },
  casinoLoungeGameImages: async (_: unknown, args: { categoryId: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.categories', 'view')) throw new Error('Forbidden: insufficient permissions to view Casino lounge images')
    const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default'
    return getCasinoLoungeGameImagesDb(tenant, args.categoryId)
  },
  gamesByIds: async (_: any, args: { gameIds: string[]; skipVendorFilter?: boolean }, ctx: any) => {
    // CRITICAL: For Director Admin in core mode, skip tenant filtering
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const gameIds = args.gameIds.map(id => Number(id))
    // For bundle viewing, skip vendor filter to show all games regardless of vendor/tenant settings
    const rows = await getCasinoGamesByIdsDb(tenant, gameIds, { skipVendorFilter: args.skipVendorFilter ?? false })
    const mapCat = (v: any) => v === 'live_casino' ? 'LIVE_CASINO' : (v === 'casino' ? 'CASINO' : 'SLOTS')
    return rows.map((it: any) => ({
      ...it,
      id: String(it.id),
      vendorId: String(it.vendorId),
      mainCategory: mapCat(it.mainCategory),
      updatedAt: it.updatedAt ? new Date(it.updatedAt).toISOString() : null,
      limits: it.limits ? {
        minStake: it.limits.minStake != null ? Number(it.limits.minStake) : null,
        maxStake: it.limits.maxStake != null ? Number(it.limits.maxStake) : null,
        maxWin: it.limits.maxWin != null ? Number(it.limits.maxWin) : null,
        maxWinTarget: it.limits.maxWinTarget || null,
        maxWinPlayers: it.limits.maxWinPlayers || [],
      } : null,
      categoryAssigned: !!it.categoryAssigned,
    }))
  },
  vipTierGames: async (_: any, args: { tierId: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.vip-games', 'view')) {
      throw new Error('Forbidden: insufficient permissions for casino VIP tier games')
    }
    const rows = await getVipTierGamesDb(args.tierId)
    return rows.map((r: any) => ({
      tierId: args.tierId,
      gameId: String(r.gameId),
      enabled: r.enabled,
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    }))
  },
  gameVipTiers: async (_: any, args: { gameId: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.vip-games', 'view')) {
      throw new Error('Forbidden: insufficient permissions for casino VIP tier games')
    }
    const rows = await getGameVipTiersDb(Number(args.gameId))
    // Fetch tier names
    const tierIds = rows.map((r: any) => r.tierId)
    const tiers = tierIds.length > 0 ? await db.select({ id: vipTiersTable.id, name: vipTiersTable.name }).from(vipTiersTable).where(inArray(vipTiersTable.id, tierIds)) : []
    const tierMap = new Map(tiers.map((t: any) => [t.id, t.name]))
    
    return rows.map((r: any) => ({
      tierId: r.tierId,
      tierName: tierMap.get(r.tierId) || null,
      enabled: r.enabled,
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    }))
  },
  providersWithVendors: async (_: any, __: any, ctx: any) => {
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const providers = await getProvidersWithVendorsDb(tenant)
    // Add vendor stats for each provider; when tenant is set, only include stats for vendors we're showing
    const providersWithStats = await Promise.all(providers.map(async (p: any) => {
      const vendorStats = await getProviderVendorsStatsDb(Number(p.id))
      const filteredStats = tenant != null
        ? vendorStats.filter((vs: any) => (p.vendors ?? []).some((v: any) => v.id === String(vs.vendorId)))
        : vendorStats
      return {
        ...p,
        vendorStats: filteredStats.map((vs: any) => ({
          vendorId: String(vs.vendorId),
          vendorName: vs.vendorName,
          totalGames: vs.totalGames,
          activeGames: vs.activeGames,
        }))
      }
    }))
    return providersWithStats
  },
  whitelabelCasinoProviderSettings: async (_: any, args: { tenantId: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.provider-settings', 'view')) {
      throw new Error('Forbidden: insufficient permissions for casino provider settings')
    }
    const isSuperAdmin = ctx?.user?.roles?.some((r: string) =>
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' ||
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    const effectiveTenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const tenantToUse = isSuperAdmin && args.tenantId ? args.tenantId : effectiveTenant
    if (!isSuperAdmin && args.tenantId !== effectiveTenant) {
      throw new Error('Forbidden: cannot access other tenant data')
    }
    return getWhitelabelCasinoProviderSettingsDb(tenantToUse)
  },
  whitelabelCasinoVendorOverrideSettings: async (_: any, args: { tenantId: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.vendor-overrides', 'view')) {
      throw new Error('Forbidden: insufficient permissions for casino vendor overrides')
    }
    const isSuperAdmin = ctx?.user?.roles?.some((r: string) =>
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' ||
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    const effectiveTenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const tenantToUse = isSuperAdmin && args.tenantId ? args.tenantId : effectiveTenant
    if (!isSuperAdmin && args.tenantId !== effectiveTenant) {
      throw new Error('Forbidden: cannot access other tenant data')
    }
    return getWhitelabelCasinoVendorOverrideSettingsDb(tenantToUse)
  },
  whitelabelCasinoGameOverrideSettings: async (_: any, args: { tenantId: string; providerId?: string; vendorId?: string; search?: string; page?: number; pageSize?: number }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.game-overrides', 'view')) {
      throw new Error('Forbidden: insufficient permissions for casino game overrides')
    }
    const isSuperAdmin = ctx?.user?.roles?.some((r: string) =>
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' ||
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    const effectiveTenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const tenantToUse = isSuperAdmin && args.tenantId ? args.tenantId : effectiveTenant
    if (!isSuperAdmin && args.tenantId !== effectiveTenant) {
      throw new Error('Forbidden: cannot access other tenant data')
    }
    const page = Math.max(1, args.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, args.pageSize ?? 20))
    const options: { providerId?: number; vendorId?: number; search?: string; limit?: number; offset?: number } = {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }
    if (args.providerId != null && args.providerId !== '') options.providerId = Number(args.providerId)
    if (args.vendorId != null && args.vendorId !== '') options.vendorId = Number(args.vendorId)
    if (args.search?.trim()) options.search = args.search.trim()
    return getWhitelabelCasinoGameOverrideSettingsDb(tenantToUse, options)
  },
  providerVendorShares: async (_: any, args: { providerId: string }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const rows = await listProviderVendorSharesDb(tenant, Number(args.providerId))
    return rows.map((r: any) => ({
      vendorId: String(r.vendorId),
      vendorName: r.vendorName || null,
      sharePercentage: Number(r.sharePercentage ?? 0),
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString(),
    }))
  },
  providerAnalytics: async (_: any, args: { providerId: string; start?: string; end?: string }, ctx: any) => {
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const tenantForTz = tenant ?? 'default'
    const end = args.end ? new Date(args.end) : new Date()
    let startDate: Date
    if (args.start) {
      startDate = new Date(args.start)
    } else {
      const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
      const { getStartOfDay } = await import('@src/shared/dateUtils.js')
      const tz = await getWhitelabelTimezone(tenantForTz)
      startDate = getStartOfDay(tz)
    }
    const { totalGGR, vendorBreakdown: rawBreakdown } = await computeProviderGGRDb(Number(args.providerId), startDate.toISOString(), end.toISOString(), tenant)
    const shares = await listProviderVendorSharesDb(tenant ?? 'default', Number(args.providerId))
    const sharesMap = new Map<string, number>(shares.map((s: any) => [String(s.vendorId), Number(s.sharePercentage ?? 0)]))
    const vendorBreakdown = rawBreakdown.map((v: any) => {
      const sharePercentage = sharesMap.get(v.vendorId) ?? 0
      const shareAmount = v.ggr > 0 ? Number(((v.ggr * sharePercentage) / 100).toFixed(2)) : 0
      return {
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        ggr: v.ggr,
        shareAmount,
        transactionCount: v.transactionCount,
      }
    })
    return { providerId: args.providerId, totalGGR, vendorBreakdown }
  },
  providersAnalytics: async (_: any, args: { providerIds: string[]; start?: string; end?: string }, ctx: any) => {
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const tenantForTz = tenant ?? 'default'
    const end = args.end ? new Date(args.end) : new Date()
    let startDate: Date
    if (args.start) {
      startDate = new Date(args.start)
    } else {
      const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
      const { getStartOfDay } = await import('@src/shared/dateUtils.js')
      const tz = await getWhitelabelTimezone(tenantForTz)
      startDate = getStartOfDay(tz)
    }
    const providerIds = args.providerIds?.filter(Boolean) ?? []
    if (providerIds.length === 0) return []
    const results = await Promise.all(
      providerIds.map(async (providerId) => {
        const { totalGGR, vendorBreakdown: rawBreakdown } = await computeProviderGGRDb(Number(providerId), startDate.toISOString(), end.toISOString(), tenant)
        const shares = await listProviderVendorSharesDb(tenant ?? 'default', Number(providerId))
        const sharesMap = new Map<string, number>(shares.map((s: any) => [String(s.vendorId), Number(s.sharePercentage ?? 0)]))
        const vendorBreakdown = rawBreakdown.map((v: any) => {
          const sharePercentage = sharesMap.get(v.vendorId) ?? 0
          const shareAmount = v.ggr > 0 ? Number(((v.ggr * sharePercentage) / 100).toFixed(2)) : 0
          return {
            vendorId: v.vendorId,
            vendorName: v.vendorName,
            ggr: v.ggr,
            shareAmount,
            transactionCount: v.transactionCount,
          }
        })
        return { providerId, totalGGR, vendorBreakdown }
      })
    )
    return results
  },
  vendorAnalytics: async (_: any, args: { providerId: string; vendorId: string; start?: string; end?: string }, ctx: any) => {
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default')
    const tenantForTz = tenant ?? 'default'
    const end = args.end ? new Date(args.end) : new Date()
    let startDate: Date
    if (args.start) {
      startDate = new Date(args.start)
    } else {
      const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
      const { getStartOfDay } = await import('@src/shared/dateUtils.js')
      const tz = await getWhitelabelTimezone(tenantForTz)
      startDate = getStartOfDay(tz)
    }
    const { ggr, transactionCount, vendorName } = await computeVendorGGRDb(Number(args.vendorId), Number(args.providerId), startDate.toISOString(), end.toISOString(), tenant)
    const shares = await listProviderVendorSharesDb(tenant ?? 'default', Number(args.providerId))
    const sharesMap = new Map<string, number>(shares.map((s: any) => [String(s.vendorId), Number(s.sharePercentage ?? 0)]))
    const sharePercentage = sharesMap.get(String(args.vendorId)) ?? 0
    const shareAmount = ggr > 0 ? Number(((ggr * sharePercentage) / 100).toFixed(2)) : 0
    return {
      vendorId: args.vendorId,
      vendorName,
      ggr,
      shareAmount,
      transactionCount,
    }
  },
  vendorGamesStats: async (_: any, args: { vendorId: string }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const stats = await getVendorGamesStatsDb(Number(args.vendorId), tenant)
    // Get vendor name from database
    const vendorRows = await db.select({ id: casinoVendors.id, name: casinoVendors.name }).from(casinoVendors).where(eq(casinoVendors.id, Number(args.vendorId))).limit(1)
    const vendor = vendorRows[0]
    return {
      vendorId: args.vendorId,
      vendorName: vendor?.name || 'Vendor ' + args.vendorId,
      totalGames: stats.totalGames,
      activeGames: stats.activeGames,
    }
  },
  // Custom categories
  casinoCustomCategories: async (_: any, args: { mainCategory?: 'LIVE_CASINO'|'CASINO'|'SLOTS' }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const cat = args.mainCategory ? (args.mainCategory === 'LIVE_CASINO' ? 'live_casino' : (args.mainCategory as string).toLowerCase()) : undefined
    const rows = await listCasinoCategoriesDb(tenant, cat as any)
    const mapCat = (v: any) => v === 'live_casino' ? 'LIVE_CASINO' : (v === 'casino' ? 'CASINO' : 'SLOTS')
    // Convert stored S3 icon keys into displayable presigned URLs (data URIs / full URLs pass through)
    const { generatePresignedGetUrl, getS3ObjectUrl } = await import('@src/services/storage/s3.js')
    const toIconUrl = async (icon: string | null): Promise<string | null> => {
      if (!icon) return null
      if (icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:')) return icon
      try {
        const presigned = await generatePresignedGetUrl(icon, 7 * 24 * 3600)
        if (presigned) return presigned
      } catch {}
      try { return getS3ObjectUrl(icon) } catch { return icon }
    }
    return Promise.all(rows.map(async (r: any) => ({
      id: String(r.id),
      mainCategory: mapCat(r.mainCategory),
      type: toCasinoCategoryType(r.type),
      subtitle: r.subtitle || null,
      name: r.name,
      slug: r.slug,
      iconData: await toIconUrl(r.iconData || null),
      order: r.order ?? null,
      isActive: !!r.isActive,
      gameCount: r.gameCount != null ? Number(r.gameCount) : 0,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString(),
    })))
  },
  casinoCategory: async (_: any, args: { id: string }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const row = await getCasinoCategoryDb(tenant, Number(args.id))
    if (!row) return null
    const rIcon: any = (row as any).iconData
    const { generatePresignedGetUrl: presignGet, getS3ObjectUrl: s3Url } = await import('@src/services/storage/s3.js')
    let iconUrl: string | null = null
    if (rIcon && typeof rIcon === 'string') {
      if (rIcon.startsWith('http://') || rIcon.startsWith('https://') || rIcon.startsWith('data:')) {
        iconUrl = rIcon
      } else {
        try { iconUrl = await presignGet(rIcon, 7 * 24 * 3600) } catch {}
        if (!iconUrl) { try { iconUrl = s3Url(rIcon) } catch { iconUrl = rIcon } }
      }
    }
    const mapCat = (v: any) => v === 'live_casino' ? 'LIVE_CASINO' : (v === 'casino' ? 'CASINO' : 'SLOTS')
    return {
      id: String(row.id),
      mainCategory: mapCat(row.mainCategory),
      type: toCasinoCategoryType(row.type),
      subtitle: row.subtitle || null,
      name: row.name,
      slug: row.slug,
      iconData: iconUrl,
      order: row.order ?? null,
      isActive: !!row.isActive,
      gameCount: undefined,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  categoriesForGame: async (_: any, args: { gameId: string; mainCategory?: 'LIVE_CASINO'|'CASINO'|'SLOTS' }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const cat = args.mainCategory ? (args.mainCategory === 'LIVE_CASINO' ? 'live_casino' : (args.mainCategory as string).toLowerCase()) : undefined
    const rows = await getCategoriesForGameDb(tenant, Number(args.gameId), cat as any)
    const mapCat = (v: any) => v === 'live_casino' ? 'LIVE_CASINO' : (v === 'casino' ? 'CASINO' : 'SLOTS')
    return rows.map((r: any) => ({
      id: String(r.id),
      mainCategory: mapCat(r.mainCategory),
      type: toCasinoCategoryType(r.type),
      subtitle: r.subtitle || null,
      name: r.name,
      slug: r.slug,
      iconData: r.iconData || null,
      order: r.order ?? null,
      isActive: !!r.isActive,
      gameCount: undefined,
      createdAt: undefined,
      updatedAt: undefined,
    }))
  },

  // Casino game bet settings
  casinoGameBetSettings: async (_: any, args: { gameId: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.bet-settings', 'view')) {
      throw new Error('Forbidden: insufficient permissions for casino game bet settings')
    }
    const tenant = ctx?.whitelabel?.id || 'default'
    const rows = await getCasinoGameBetSettingsDb(tenant, Number(args.gameId))
    return rows.map((r: any) => ({
      id: String(r.id),
      gameId: String(r.gameId),
      playerId: r.playerId || null,
      playerName: r.playerName ?? null,
      playerPhone: r.playerPhone ?? null,
      betEnabled: !!r.betEnabled,
      minStake: r.minStake != null ? Number(r.minStake) : null,
      maxStake: r.maxStake != null ? Number(r.maxStake) : null,
      maxWin: r.maxWin != null ? Number(r.maxWin) : null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString(),
    }))
  },
  casinoGameBetSettingByPlayer: async (_: any, args: { gameId: string; playerId?: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.bet-settings', 'view')) {
      throw new Error('Forbidden: insufficient permissions for casino game bet settings')
    }
    const tenant = ctx?.whitelabel?.id || 'default'
    const row = await getCasinoGameBetSettingByPlayerDb(tenant, Number(args.gameId), args.playerId || null)
    if (!row) return null
    return {
      id: String(row.id),
      gameId: String(row.gameId),
      playerId: row.playerId || null,
      playerName: row.playerName ?? null,
      playerPhone: row.playerPhone ?? null,
      betEnabled: !!row.betEnabled,
      minStake: row.minStake != null ? Number(row.minStake) : null,
      maxStake: row.maxStake != null ? Number(row.maxStake) : null,
      maxWin: row.maxWin != null ? Number(row.maxWin) : null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  casinoBets: async (_: any, args: { query?: any }, ctx: any) => {
    const { getCasinoBets } = await import('@src/repos/casino/casinoBetsRepo.js')
    const { users } = await import('@src/db/schema.js')
    const { PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? ctx?.tenant ?? 'default'
    const wl = (directorTenant ?? ctx?.whitelabel?.id) as string
    
    // The session's tenant and whitelabel come LAST: the input type carries
    // `tenant` and `whitelabelId` fields, and spreading the query over them let
    // a caller read another whitelabel's casino bets by naming it.
    const filter: Record<string, unknown> = {
      ...args.query,
      tenant,
      whitelabelId: wl,
    }
    if (filter.userId != null) {
      filter.userId = Number(filter.userId)
    }
    if (filter.vendorId != null) {
      filter.vendorId = Number(filter.vendorId)
    }
    if (filter.gameId != null) {
      filter.gameId = Number(filter.gameId)
    }
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const playerAuthService = new PlayerAuthService()
      const agentPlayerIds = await playerAuthService.getAgentPlayerIds(ctx.user.agentId, tenant)
      if (agentPlayerIds.length === 0) {
        return []
      }
      // A requested player narrows the list (only among the agent's own); it
      // used to be replaced by the agent's whole player list, so a contributor
      // player's page showed every subtree player's bets.
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
    
    const bets = await getCasinoBets({ ...(filter as any), omitOpenAdminToolBets: true })
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js')
    const fallbackCurrency = await getWhitelabelCurrency(tenant)

    // Fetch user names for all unique user IDs
    const userIds = [...new Set(bets.map((b: any) => Number(b.userId)))]
    const userMap = new Map()
    if (userIds.length > 0) {
      const userRows = await db.select({ id: users.id, name: users.name, username: users.username }).from(users)
        .where(and(eq(users.tenant, tenant), inArray(users.id, userIds)))
      userRows.forEach((u: any) => {
        userMap.set(u.id, u.name || u.username || null)
      })
    }

    // Fetch provider keys for providerCode (e.g. for GMAG round detail)
    const providerIds = [...new Set(bets.map((b: any) => b.providerId).filter(Boolean))]
    const providerKeyMap = await getProviderKeysByIdsDb(providerIds)
    
    // Format the response
    return bets.map((bet: any) => ({
      id: bet.id,
      tenant: bet.tenant,
      whitelabelId: bet.whitelabelId,
      userId: bet.userId,
      userName: userMap.get(Number(bet.userId)) || null,
      gameId: String(bet.gameId),
      gameName: bet.gameName || null,
      providerId: bet.providerId ? String(bet.providerId) : null,
      providerCode: bet.providerId ? (providerKeyMap.get(bet.providerId) ?? null) : null,
      sessionId: bet.sessionId || null,
      vendorId: String(bet.vendorId),
      vendorName: bet.vendorName,
      tableId: bet.tableId || null,
      stake: bet.stake ? Number(bet.stake) : 0,
      payout: bet.payout ? Number(bet.payout) : null,
      winAmount: bet.winAmount ? Number(bet.winAmount) : null,
      netAmount: bet.netAmount ? Number(bet.netAmount) : null,
      status: bet.status,
      gameRoundId: bet.gameRoundId || null,
      transactionId: bet.transactionId || null,
      settledAt: bet.settledAt ? new Date(bet.settledAt).toISOString() : null,
      currency: bet.currency || fallbackCurrency,
      metadata: bet.metadata || null,
      createdAt: bet.createdAt ? new Date(bet.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: bet.updatedAt ? new Date(bet.updatedAt).toISOString() : new Date().toISOString(),
    }))
  },
}
