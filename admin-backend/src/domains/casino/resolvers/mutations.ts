import {
  createCategory as createCat, deleteCategory as deleteCat, renameCategory as renameCat, reorderCategory as reorderCat,
  upsertLimit as upsertCasinoLimit,
  setPaused as setJackpotPaused, payout as payoutJackpotAction,
  createPromotion as createPromo, publishPromotion as publishPromo, pausePromotion as pausePromo,
  createContent as createCms, updateContent as updateCms, publishContent as publishCms,
  record as recordAudit,
} from '@/stores/index.js'
import { z } from 'zod'
import { currencyService } from '../../../services/currencyService.js'
import { toggleCasinoGameEnabledDb, reorderVendorGamesDb, toggleVipTierGameEnabledDb, bulkUpdateVipTierGamesDb, updateCasinoGameSettingsDb, bulkUpdateCasinoGameSettingsDb, createCasinoProviderDb, updateCasinoProviderDb, deleteCasinoProviderDb, upsertCasinoGameBetSettingsDb, deleteCasinoGameBetSettingsDb, createCasinoCategoryDb, updateCasinoCategoryDb, deleteCasinoCategoryDb, reorderCasinoCategoriesDb, assignGamesToCategoryDb, removeGamesFromCategoryDb, getCasinoCategoryDb, upsertProviderVendorShareDb, toggleCasinoVendorEnabledDb, bulkUpdateVendorSettingsDb, updateVendorDisplayOrderDb, toggleCasinoGameMasterActiveDb, toggleWhitelabelCasinoProviderDb, setWhitelabelCasinoVendorSuperAdminOverrideDb, setWhitelabelCasinoGameSuperAdminOverrideDb, reorderCategoryGamesDb, resolveCasinoBetSettingPlayerMetaDb } from '@src/repos/casino/casinoRepo.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { generatePresignedGetUrl, getS3ObjectUrl } from '@src/services/storage/s3.js'
import { requireDiagnosticAccess } from '@src/domains/common/auth.js'
import { toCasinoCategoryDbType, toCasinoCategoryType, type CasinoCategoryType } from '../categoryType.js'
import { saveCasinoLoungeGamesDb } from '@src/repos/casino/loungeImagesRepo.js'
import type { CasinoLoungeImageInput } from '../loungeImages.js'

/** Convert a stored S3 icon key into a displayable presigned URL (data URIs / full URLs pass through). */
async function presignIcon(icon: any): Promise<string | null> {
  if (!icon || typeof icon !== 'string') return null
  if (icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:')) return icon
  try {
    const presigned = await generatePresignedGetUrl(icon, 7 * 24 * 3600)
    if (presigned) return presigned
  } catch {}
  try { return getS3ObjectUrl(icon) } catch { return icon }
}

const CreateCategoryInput = z.object({ input: z.object({ name: z.string().min(1), parentId: z.string().optional() }) })
const ReorderCategoryInput = z.object({ input: z.object({ id: z.string().min(1), parentId: z.string().optional(), order: z.number().int().optional() }) })
const RenameCategoryInput = z.object({ input: z.object({ id: z.string().min(1), name: z.string().min(1) }) })
const IdInput = z.object({ id: z.string().min(1) })
const UpsertLimitInput = z.object({ input: z.object({ scope: z.enum(['provider','category','game']), scopeId: z.string().min(1), maxStake: z.number(), maxPayout: z.number(), currency: z.string().min(3).max(3) }) })
const PauseJackpotInput = z.object({ id: z.string().min(1), pause: z.boolean() })
const PayoutJackpotInput = z.object({ id: z.string().min(1), amount: z.number().optional() })
const CreatePromotionInput = z.object({ input: z.object({ name: z.string().min(1), targetingRules: z.string().optional(), start: z.string().min(1), end: z.string().min(1) }) })
const CreateContentInput = z.object({ input: z.object({ name: z.string().min(1), locale: z.string().optional(), body: z.string().optional() }) })
const UpdateContentInput = z.object({ input: z.object({ id: z.string().min(1), name: z.string().optional(), locale: z.string().optional(), body: z.string().optional() }) })

export const casinoMutationResolvers = {
  createCategory: async (_: any, args: any) => { const p = CreateCategoryInput.safeParse(args); if (!p.success) throw new Error('Invalid input'); return createCat(p.data.input.name, p.data.input.parentId ?? undefined) },
  reorderCategory: async (_: any, args: any) => { const p = ReorderCategoryInput.safeParse(args); if (!p.success) throw new Error('Invalid input'); return reorderCat(p.data.input.id, p.data.input.parentId ?? undefined, p.data.input.order ?? undefined) },
  renameCategory: async (_: any, args: any) => { const p = RenameCategoryInput.safeParse(args); if (!p.success) throw new Error('Invalid input'); return renameCat(p.data.input.id, p.data.input.name) },
  deleteCategory: async (_: any, args: any) => { const p = IdInput.safeParse(args); if (!p.success) throw new Error('Invalid input'); return deleteCat(p.data.id) },
  upsertLimit: async (_: any, args: any) => { 
    const p = UpsertLimitInput.safeParse(args); 
    if (!p.success) throw new Error('Invalid input')
    
    // Validate currency
    if (!currencyService.isValidCurrency(p.data.input.currency)) {
      throw new Error(`Invalid currency: ${p.data.input.currency}`)
    }
    
    return upsertCasinoLimit({ 
      scope: p.data.input.scope, 
      scopeId: p.data.input.scopeId, 
      maxStake: p.data.input.maxStake, 
      maxPayout: p.data.input.maxPayout,
      currency: p.data.input.currency as any
    }) 
  },
  pauseJackpot: async (_: any, args: any, ctx: any) => {
    const p = PauseJackpotInput.safeParse(args); if (!p.success) throw new Error('Invalid input')
    const jp = setJackpotPaused(p.data.id, p.data.pause)
    recordAudit({ actorId: 'admin', domain: 'jackpots', action: 'pause', resourceType: 'jackpot', resourceId: p.data.id })
    ctx.pubsub.publish({ topic: 'JACKPOT', payload: { jackpotPot: jp } })
    return jp
  },
  payoutJackpot: async (_: any, args: any, ctx: any) => {
    const p = PayoutJackpotInput.safeParse(args); if (!p.success) throw new Error('Invalid input')
    const jp = payoutJackpotAction(p.data.id, p.data.amount ?? undefined)
    recordAudit({ actorId: 'admin', domain: 'jackpots', action: 'payout', resourceType: 'jackpot', resourceId: p.data.id })
    ctx.pubsub.publish({ topic: 'JACKPOT', payload: { jackpotPot: jp } })
    return jp
  },
  createPromotion: async (_: any, args: any, ctx: any) => { 
    const p = CreatePromotionInput.safeParse(args); 
    if (!p.success) throw new Error('Invalid input')
    const promo = createPromo({ 
    name: p.data.input.name, 
    targetingRules: p.data.input.targetingRules ? JSON.parse(p.data.input.targetingRules) : undefined, 
    schedule: { start: p.data.input.start, end: p.data.input.end } 
    })
    return {
      success: true,
      message: `Promotion "${promo.name}" created successfully`,
      promotion: {
        id: promo.id,
        tenant: ctx?.whitelabel?.id || ctx?.tenant || 'default',
        name: promo.name,
        status: promo.status,
        targetingJson: promo.targetingRules,
        scheduleStart: promo.schedule.start,
        scheduleEnd: promo.schedule.end,
        contentJson: null,
        createdAt: promo.updatedAt,
        updatedAt: promo.updatedAt,
      }
    }
  },
  publishPromotion: async (_: any, args: any, ctx: any) => { 
    const p = IdInput.safeParse(args); 
    if (!p.success) throw new Error('Invalid input')
    const promo = publishPromo(p.data.id)
    return {
      success: true,
      message: 'Promotion published successfully',
      promotion: {
        id: promo.id,
        tenant: ctx?.whitelabel?.id || ctx?.tenant || 'default',
        name: promo.name,
        status: promo.status,
        targetingJson: promo.targetingRules,
        scheduleStart: promo.schedule.start,
        scheduleEnd: promo.schedule.end,
        contentJson: null,
        createdAt: promo.updatedAt,
        updatedAt: promo.updatedAt,
      }
    }
  },
  pausePromotion: async (_: any, args: any, ctx: any) => { 
    const p = IdInput.safeParse(args); 
    if (!p.success) throw new Error('Invalid input')
    const promo = pausePromo(p.data.id)
    return {
      success: true,
      message: 'Promotion paused successfully',
      promotion: {
        id: promo.id,
        tenant: ctx?.whitelabel?.id || ctx?.tenant || 'default',
        name: promo.name,
        status: promo.status,
        targetingJson: promo.targetingRules,
        scheduleStart: promo.schedule.start,
        scheduleEnd: promo.schedule.end,
        contentJson: null,
        createdAt: promo.updatedAt,
        updatedAt: promo.updatedAt,
      }
    }
  },
  createContent: async (_: any, args: any) => { const p = CreateContentInput.safeParse(args); if (!p.success) throw new Error('Invalid input'); return createCms({ 
    name: p.data.input.name, 
    locale: p.data.input.locale ?? undefined, 
    body: p.data.input.body ?? undefined 
  }) },
  updateContent: async (_: any, args: any) => { const p = UpdateContentInput.safeParse(args); if (!p.success) throw new Error('Invalid input'); return updateCms({ 
    id: p.data.input.id, 
    name: p.data.input.name ?? undefined, 
    locale: p.data.input.locale ?? undefined, 
    body: p.data.input.body ?? undefined 
  }) },
  publishContent: async (_: any, args: any) => { const p = IdInput.safeParse(args); if (!p.success) throw new Error('Invalid input'); return publishCms(p.data.id) },
  // Casino management
  toggleCasinoGameEnabled: async (_: any, args: { gameId: string; enabled: boolean }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    await toggleCasinoGameEnabledDb(tenant, Number(args.gameId), args.enabled)
    return { success: true, message: args.enabled ? 'Game enabled' : 'Game disabled' }
  },
  toggleCasinoVendorEnabled: async (_: any, args: { vendorId: string; enabled: boolean }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    await toggleCasinoVendorEnabledDb(tenant, Number(args.vendorId), args.enabled)
    return { success: true, message: args.enabled ? 'Vendor enabled' : 'Vendor disabled' }
  },
  bulkUpdateVendorSettings: async (_: any, args: { vendorIds: string[]; enabled: boolean }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const vendorIds = args.vendorIds.map(id => Number(id))
    await bulkUpdateVendorSettingsDb(tenant, vendorIds, args.enabled)
    return { success: true, message: `Updated ${vendorIds.length} vendor(s)` }
  },
  updateVendorDisplayOrder: async (_: any, args: { vendorOrders: Array<{ vendorId: string; order: number }> }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const vendorOrders = args.vendorOrders.map(vo => ({ vendorId: Number(vo.vendorId), order: vo.order }))
    await updateVendorDisplayOrderDb(tenant, vendorOrders)
    return { success: true, message: 'Vendor display order updated' }
  },
  reorderVendorGames: async (_: any, args: { vendorId: string; category: 'LIVE_CASINO'|'CASINO'|'SLOTS'; gameIds: string[] }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const cat = args.category === 'LIVE_CASINO' ? 'live_casino' : (args.category as string).toLowerCase()
    const ids = (args.gameIds || []).map((g) => Number(g))
    const res = await reorderVendorGamesDb(tenant, Number(args.vendorId), cat as any, ids)
    return { success: true, message: `Updated ${res.updated} games` }
  },
  updateCasinoGameSettings: async (_: any, args: { gameId: string; enabled?: boolean; premiumOnly?: boolean; limits?: any }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const limits = args.limits ? {
      minStake: args.limits.minStake != null ? Number(args.limits.minStake) : null,
      maxStake: args.limits.maxStake != null ? Number(args.limits.maxStake) : null,
      maxWin: args.limits.maxWin != null ? Number(args.limits.maxWin) : null,
      maxWinTarget: args.limits.maxWinTarget || null,
      maxWinPlayers: args.limits.maxWinPlayers || [],
    } : undefined
    await updateCasinoGameSettingsDb(tenant, Number(args.gameId), {
      enabled: args.enabled,
      premiumOnly: args.premiumOnly,
      limits,
    })
    return { success: true, message: 'Game settings updated' }
  },
  bulkUpdateCasinoGameSettings: async (_: any, args: { gameIds: string[]; enabled?: boolean; premiumOnly?: boolean; limits?: any }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const ids = (args.gameIds || []).map((g) => Number(g))
    const limits = args.limits ? {
      minStake: args.limits.minStake != null ? Number(args.limits.minStake) : null,
      maxStake: args.limits.maxStake != null ? Number(args.limits.maxStake) : null,
      maxWin: args.limits.maxWin != null ? Number(args.limits.maxWin) : null,
      maxWinTarget: args.limits.maxWinTarget || null,
      maxWinPlayers: args.limits.maxWinPlayers || [],
    } : undefined
    const res = await bulkUpdateCasinoGameSettingsDb(tenant, ids, {
      enabled: args.enabled,
      premiumOnly: args.premiumOnly,
      limits,
    })
    return { success: true, message: `Updated ${res.updated} games` }
  },
  toggleCasinoGameMasterActive: async (_: any, args: { gameId: string; isActive: boolean }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.management', 'toggle-master')) {
      throw new Error('Forbidden: insufficient permissions to toggle master game control')
    }
    await toggleCasinoGameMasterActiveDb(Number(args.gameId), !!args.isActive)
    return { 
      success: true, 
      message: args.isActive ? 'Game enabled globally' : 'Game disabled globally (affects all whitelabels)' 
    }
  },
  toggleWhitelabelCasinoProvider: async (_: any, args: { tenantId: string; providerId: string; enabled: boolean }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.provider-settings', 'update')) {
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
    await toggleWhitelabelCasinoProviderDb(tenantToUse, Number(args.providerId), args.enabled)
    return { success: true, message: args.enabled ? 'Provider enabled for whitelabel' : 'Provider disabled for whitelabel' }
  },
  setWhitelabelCasinoVendorSuperAdminOverride: async (_: any, args: { tenantId: string; vendorId: string; disabled: boolean }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.vendor-overrides', 'update')) {
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
    await setWhitelabelCasinoVendorSuperAdminOverrideDb(tenantToUse, Number(args.vendorId), args.disabled)
    return { success: true, message: args.disabled ? 'Vendor disabled for whitelabel' : 'Vendor override cleared' }
  },
  setWhitelabelCasinoGameSuperAdminOverride: async (_: any, args: { tenantId: string; gameId: string; disabled: boolean }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.game-overrides', 'update')) {
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
    await setWhitelabelCasinoGameSuperAdminOverrideDb(tenantToUse, Number(args.gameId), args.disabled)
    return { success: true, message: args.disabled ? 'Game disabled for whitelabel' : 'Game override cleared' }
  },
  // VIP tier casino games
  toggleVipTierGameEnabled: async (_: any, args: { tierId: string; gameId: string; enabled: boolean }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.vip-games', 'update')) {
      throw new Error('Forbidden: insufficient permissions for casino VIP tier games')
    }
    await toggleVipTierGameEnabledDb(args.tierId, Number(args.gameId), args.enabled)
    return { success: true, message: args.enabled ? 'Game enabled for VIP tier' : 'Game disabled for VIP tier' }
  },
  bulkUpdateVipTierGames: async (_: any, args: { tierId: string; gameIds: string[]; enabled: boolean }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.vip-games', 'update')) {
      throw new Error('Forbidden: insufficient permissions for casino VIP tier games')
    }
    const ids = (args.gameIds || []).map((g) => Number(g))
    const res = await bulkUpdateVipTierGamesDb(args.tierId, ids, args.enabled)
    return { success: true, message: `Updated ${res.updated} games for VIP tier` }
  },
  createCasinoProvider: async (_: any, args: { input: { key?: string; name?: string; status?: string } }) => {
    if (!args.input?.key || !args.input?.name) throw new Error('key and name are required')
    const row = await createCasinoProviderDb({ key: args.input.key, name: args.input.name, status: args.input.status })
    return { id: String(row.id), key: row.key, name: row.name, status: row.status, lastSyncAt: row.lastSyncAt ? new Date(row.lastSyncAt).toISOString() : null }
  },
  updateCasinoProvider: async (_: any, args: { id: string; input: { key?: string; name?: string; status?: string } }) => {
    const row = await updateCasinoProviderDb(Number(args.id), { key: args.input?.key, name: args.input?.name, status: args.input?.status })
    if (!row) return null
    return { id: String(row.id), key: row.key, name: row.name, status: row.status, lastSyncAt: row.lastSyncAt ? new Date(row.lastSyncAt).toISOString() : null }
  },
  deleteCasinoProvider: async (_: any, args: { id: string }) => {
    return deleteCasinoProviderDb(Number(args.id))
  },
  upsertProviderVendorShare: async (_: any, args: { providerId: string; vendorId: string; sharePercentage: number }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const row = await upsertProviderVendorShareDb(tenant, Number(args.providerId), Number(args.vendorId), Number(args.sharePercentage))
    return {
      vendorId: String(row.vendorId),
      sharePercentage: Number(row.sharePercentage ?? 0),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  // Custom categories
  createCasinoCategory: async (_: any, args: { input: { mainCategory: 'LIVE_CASINO'|'CASINO'|'SLOTS'; type?: CasinoCategoryType; subtitle?: string; name: string; slug: string; iconData?: string; isActive?: boolean } }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const cat = args.input.mainCategory === 'LIVE_CASINO' ? 'live_casino' : (args.input.mainCategory as string).toLowerCase()
    const type = toCasinoCategoryDbType(args.input.type)
    const row = await createCasinoCategoryDb(tenant, { mainCategory: cat as any, type, subtitle: args.input.subtitle ?? null, name: args.input.name, slug: args.input.slug, iconData: args.input.iconData ?? null, isActive: args.input.isActive })
    return row ? {
      id: String(row.id),
      mainCategory: args.input.mainCategory,
      type: toCasinoCategoryType(row.type),
      name: row.name,
      subtitle: row.subtitle || null,
      slug: row.slug,
      iconData: await presignIcon((row as any).iconData),
      order: row.order ?? null,
      isActive: !!row.isActive,
      gameCount: 0,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    } : null
  },
  updateCasinoCategory: async (_: any, args: { id: string; input: { mainCategory?: 'LIVE_CASINO'|'CASINO'|'SLOTS'; name?: string; slug?: string; iconData?: string; isActive?: boolean; type?: CasinoCategoryType; subtitle?: string } }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const row = await updateCasinoCategoryDb(tenant, Number(args.id), {
      mainCategory: args.input?.mainCategory ? (args.input.mainCategory === 'LIVE_CASINO' ? 'live_casino' : (args.input.mainCategory as string).toLowerCase() as any) : undefined,
      name: args.input?.name,
      slug: args.input?.slug,
      iconData: typeof args.input?.iconData === 'string' ? args.input?.iconData : undefined,
      isActive: args.input?.isActive,
      type: args.input?.type
        ? toCasinoCategoryDbType(args.input.type)
        : undefined,
      subtitle: typeof args.input?.subtitle === 'string' ? args.input.subtitle : args.input?.subtitle === null ? null : undefined,
    })
    if (!row) return null
    const mapCat = (v: any) => v === 'live_casino' ? 'LIVE_CASINO' : (v === 'casino' ? 'CASINO' : 'SLOTS')
    return {
      id: String(row.id),
      mainCategory: mapCat(row.mainCategory),
      type: toCasinoCategoryType(row.type),
      name: row.name,
      subtitle: row.subtitle || null,
      slug: row.slug,
      iconData: await presignIcon((row as any).iconData),
      order: row.order ?? null,
      isActive: !!row.isActive,
      gameCount: undefined,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  deleteCasinoCategory: async (_: any, args: { id: string }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    return deleteCasinoCategoryDb(tenant, Number(args.id))
  },
  reorderCasinoCategories: async (_: any, args: { inputs: Array<{ id: string; order: number }> }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    if (!args.inputs || args.inputs.length === 0) return { success: false, message: 'No categories to reorder' }
    // Get first category to determine mainCategory
    const firstId = Number(args.inputs[0].id)
    const firstCat = await getCasinoCategoryDb(tenant, firstId)
    if (!firstCat) return { success: false, message: 'Category not found' }
    // Sort by order, then pass ids sequence
    const ordered = [...args.inputs].sort((a, b) => (a.order || 0) - (b.order || 0)).map(i => Number(i.id))
    const res = await reorderCasinoCategoriesDb(tenant, firstCat.mainCategory as any, ordered)
    return { success: true, message: `Updated ${res.updated} categories` }
  },
  assignGamesToCategory: async (_: any, args: { categoryId: string; gameIds: string[] }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const ids = (args.gameIds || []).map((g) => Number(g))
    const res = await assignGamesToCategoryDb(tenant, Number(args.categoryId), ids)
    return { success: true, message: `Assigned ${res.inserted} games` }
  },
  saveCasinoLoungeGames: async (_: unknown, args: { categoryId: string; gameIds: string[]; images?: CasinoLoungeImageInput[] }, ctx: any) => {
    const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? 'default'
    return saveCasinoLoungeGamesDb(tenant, args.categoryId, args.gameIds, args.images ?? [])
  },
  removeGamesFromCategory: async (_: any, args: { categoryId: string; gameIds: string[] }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const ids = (args.gameIds || []).map((g) => Number(g))
    const res = await removeGamesFromCategoryDb(tenant, Number(args.categoryId), ids)
    return { success: true, message: `Removed ${res.deleted} games` }
  },
  reorderCategoryGames: async (_: any, args: { categoryId: string; gameIds: string[] }, ctx: any) => {
    const tenant = ctx?.whitelabel?.id || 'default'
    const ids = (args.gameIds || []).map((g) => Number(g))
    const res = await reorderCategoryGamesDb(tenant, Number(args.categoryId), ids)
    return { success: true, message: `Updated ${res.updated} games` }
  },

  // Casino game bet settings
  upsertCasinoGameBetSettings: async (_: any, args: { gameId: string; settings: { playerId?: string; betEnabled: boolean; minStake?: number; maxStake?: number; maxWin?: number } }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.bet-settings', 'update') && !hasPermission(ctx?.permissions ?? [], 'casino.bet-settings', 'create')) {
      throw new Error('Forbidden: insufficient permissions for casino game bet settings')
    }
    const tenant = ctx?.whitelabel?.id || 'default'
    const row = await upsertCasinoGameBetSettingsDb(
      tenant,
      Number(args.gameId),
      args.settings.playerId || null,
      {
        betEnabled: args.settings.betEnabled,
        minStake: args.settings.minStake,
        maxStake: args.settings.maxStake,
        maxWin: args.settings.maxWin,
      }
    )
    const meta = await resolveCasinoBetSettingPlayerMetaDb(
      tenant,
      row.playerId || null
    )
    return {
      id: String(row.id),
      gameId: String(row.gameId),
      playerId: row.playerId || null,
      playerName: meta.name,
      playerPhone: meta.phone,
      betEnabled: !!row.betEnabled,
      minStake: row.minStake != null ? Number(row.minStake) : null,
      maxStake: row.maxStake != null ? Number(row.maxStake) : null,
      maxWin: row.maxWin != null ? Number(row.maxWin) : null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  deleteCasinoGameBetSettings: async (_: any, args: { gameId: string; playerId?: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'casino.bet-settings', 'delete')) {
      throw new Error('Forbidden: insufficient permissions for casino game bet settings')
    }
    const tenant = ctx?.whitelabel?.id || 'default'
    await deleteCasinoGameBetSettingsDb(tenant, Number(args.gameId), args.playerId || null)
    return { success: true, message: 'Bet settings deleted' }
  },
  // --- Test utilities ---
  createTestCasinoBet: async (_: any, args: { input: { userId: number; gameId: string; stake: number; payout?: number | null; status?: string | null } }, ctx: any) => {
    requireDiagnosticAccess(ctx, 'createTestCasinoBet')
    const { createCasinoBet } = await import('@src/repos/casino/casinoBetsRepo.js')
    const { getCasinoGamesByIdsDb } = await import('@src/repos/casino/casinoRepo.js')
    const { getUserDb } = await import('@src/repos/users/usersRepo.js')
    const { publishPlayerEvent, dashboardTopic } = await import('../services/CasinoBetEvents.js')
    const { computeDashboard } = await import('../services/LiveAnalyticsService.js')
    const tenant = ctx?.tenant || 'default'
    const wl = ctx?.whitelabel?.id || 'default'

    const gameIdNum = Number(args.input.gameId)
    const games = await getCasinoGamesByIdsDb(tenant, [gameIdNum])
    const game = games[0]
    if (!game) throw new Error('Game not found')

    // Fetch user name
    const user = await getUserDb(Number(args.input.userId), tenant)
    const userName = user?.name || user?.username || null
    
    const stake = Number(args.input.stake)
    const payout = args.input.payout != null ? Number(args.input.payout) : null
    const winAmount = payout != null ? payout : null
    const netAmount = payout != null ? payout - stake : null
    const status = (args.input.status || 'pending') as any

    const bet = await createCasinoBet({
      tenant,
      whitelabelId: wl,
      userId: Number(args.input.userId),
      gameId: gameIdNum,
      gameName: game.name,
      providerId: undefined,
      vendorId: Number(game.vendorId),
      vendorName: String(game.vendorName || ''),
      stake,
      payout: payout != null ? payout : undefined,
      winAmount: winAmount != null ? winAmount : undefined,
      netAmount: netAmount != null ? netAmount : undefined,
      status,
      currency: 'USD',
      metadata: undefined,
    })

    // Publish player event and dashboard update
    await publishPlayerEvent(ctx.pubsub, {
      id: String(bet.id),
      userId: String(bet.userId),
      userName,
      gameId: String(bet.gameId),
      gameName: bet.gameName || null,
      vendorName: String(game.vendorName || ''),
      status: bet.status,
      stake: Number(bet.stake),
      payout: bet.payout != null ? Number(bet.payout) : null,
      at: bet.createdAt ? new Date(bet.createdAt).toISOString() : new Date().toISOString(),
      tenant,
      whitelabelId: wl,
    })
    
    // Recompute and publish dashboard snapshots for all standard windows
    // Throttle publishes to prevent rapid-fire updates when multiple bets are placed quickly
    const windows = [10, 15, 30, 60, 120, 180, 360]
    process.nextTick(async () => {
      // Delay to ensure transaction is fully committed and visible
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Module-level throttling map (shared across all mutations)
      const publishThrottle = (global as any).__casinoDashboardPublishThrottle || new Map<string, number>()
      if (!(global as any).__casinoDashboardPublishThrottle) {
        (global as any).__casinoDashboardPublishThrottle = publishThrottle
      }
      
      const now = Date.now()
      
      for (const wm of windows) {
        const scope = { tenant, whitelabelId: wl, windowMins: wm }
        const topicKey = `${tenant}:${wl}:${wm}`
        const lastPublish = publishThrottle.get(topicKey) || 0
        
        // Throttle: Only publish if last publish was more than 500ms ago
        // This prevents rapid updates when multiple bets are placed quickly
        if (now - lastPublish < 500) {
          continue
        }
        
        try {
          const snapshot = await computeDashboard(scope)
          await ctx.pubsub.publish({ topic: dashboardTopic(scope), payload: { casinoLiveDashboard: snapshot } })
          publishThrottle.set(topicKey, now)
        } catch (err) {
        }
      }
    })

    return {
      id: bet.id,
      tenant: bet.tenant,
      whitelabelId: bet.whitelabelId,
      userId: String(bet.userId),
      gameId: String(bet.gameId),
      gameName: bet.gameName || null,
      providerId: bet.providerId ? String(bet.providerId) : null,
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
      currency: bet.currency || 'USD',
      metadata: bet.metadata || null,
      createdAt: bet.createdAt ? new Date(bet.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: bet.updatedAt ? new Date(bet.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  settleTestCasinoBet: async (_: any, args: { id: string; payout?: number | null; status: string }, ctx: any) => {
    requireDiagnosticAccess(ctx, 'settleTestCasinoBet')
    const { updateCasinoBetStatus, getCasinoBetById } = await import('@src/repos/casino/casinoBetsRepo.js')
    const { getUserDb } = await import('@src/repos/users/usersRepo.js')
    const { getCasinoGamesByIdsDb } = await import('@src/repos/casino/casinoRepo.js')
    const { publishPlayerEvent, dashboardTopic } = await import('../services/CasinoBetEvents.js')
    const { computeDashboard } = await import('../services/LiveAnalyticsService.js')
    const tenant = ctx?.tenant || 'default'
    const wl = ctx?.whitelabel?.id || 'default'

    const betBefore = await getCasinoBetById(args.id)
    if (!betBefore) throw new Error('Bet not found')
    
    // Fetch user name and game info
    const user = await getUserDb(Number(betBefore.userId), tenant)
    const userName = user?.name || user?.username || null
    
    const games = await getCasinoGamesByIdsDb(tenant, [Number(betBefore.gameId)])
    const game = games[0]
    const vendorName = game?.vendorName || null
    
    const stake = betBefore.stake ? Number(betBefore.stake) : 0
    const payout = args.payout != null ? Number(args.payout) : (betBefore.payout != null ? Number(betBefore.payout) : 0)
    const winAmount = payout
    const netAmount = payout - stake
    const settledAt = new Date()
    const updated = await updateCasinoBetStatus(args.id, args.status as any, winAmount, netAmount, settledAt)
    if (!updated) throw new Error('Bet update failed')

    // Publish player event and dashboard update
    await publishPlayerEvent(ctx.pubsub, {
      id: String(updated.id),
      userId: String(updated.userId),
      userName,
      gameId: String(updated.gameId),
      gameName: updated.gameName || null,
      vendorName,
      status: updated.status,
      stake: Number(updated.stake),
      payout: updated.payout != null ? Number(updated.payout) : null,
      at: updated.updatedAt ? new Date(updated.updatedAt).toISOString() : new Date().toISOString(),
      tenant,
      whitelabelId: wl,
    })
    
    // Recompute and publish dashboard snapshots for all standard windows
    // Throttle publishes to prevent rapid-fire updates when multiple bets are placed quickly
    const windows = [10, 15, 30, 60, 120, 180, 360]
    process.nextTick(async () => {
      // Delay to ensure transaction is fully committed and visible
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Module-level throttling map (shared across all mutations)
      const publishThrottle = (global as any).__casinoDashboardPublishThrottle || new Map<string, number>()
      if (!(global as any).__casinoDashboardPublishThrottle) {
        (global as any).__casinoDashboardPublishThrottle = publishThrottle
      }
      
      const now = Date.now()
      
      for (const wm of windows) {
        const scope = { tenant, whitelabelId: wl, windowMins: wm }
        const topicKey = `${tenant}:${wl}:${wm}`
        const lastPublish = publishThrottle.get(topicKey) || 0
        
        // Throttle: Only publish if last publish was more than 500ms ago
        // This prevents rapid updates when multiple bets are placed quickly
        if (now - lastPublish < 500) {
          continue
        }
        
        try {
          const snapshot = await computeDashboard(scope)
          await ctx.pubsub.publish({ topic: dashboardTopic(scope), payload: { casinoLiveDashboard: snapshot } })
          publishThrottle.set(topicKey, now)
        } catch (err) {
        }
      }
    })

    return {
      id: updated.id,
      tenant: updated.tenant,
      whitelabelId: updated.whitelabelId,
      userId: String(updated.userId),
      gameId: String(updated.gameId),
      gameName: updated.gameName || null,
      providerId: updated.providerId ? String(updated.providerId) : null,
      sessionId: updated.sessionId || null,
      vendorId: String(updated.vendorId),
      vendorName: updated.vendorName,
      tableId: updated.tableId || null,
      stake: updated.stake ? Number(updated.stake) : 0,
      payout: updated.payout ? Number(updated.payout) : null,
      winAmount: updated.winAmount ? Number(updated.winAmount) : null,
      netAmount: updated.netAmount ? Number(updated.netAmount) : null,
      status: updated.status,
      gameRoundId: updated.gameRoundId || null,
      transactionId: updated.transactionId || null,
      settledAt: updated.settledAt ? new Date(updated.settledAt).toISOString() : null,
      currency: updated.currency || 'USD',
      metadata: updated.metadata || null,
      createdAt: updated.createdAt ? new Date(updated.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: updated.updatedAt ? new Date(updated.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  gmagRoundDetail: async (_: any, args: { roundId: string; endTime: string; providerCode: string; language?: string | null }) => {
    const roundId = args.roundId?.trim()
    const endTime = args.endTime?.trim()
    const providerCode = args.providerCode?.trim()
    if (!roundId || !endTime || !providerCode) {
      throw new Error('roundId, endTime and providerCode are required')
    }
    const { fetchRoundDetail } = await import('../../../services/gmagGameHistoryClient.js')
    const result = await fetchRoundDetail({
      roundId,
      endTime,
      providerCode,
      language: args.language?.trim() || undefined,
    })
    return { url: result.url }
  },
}
