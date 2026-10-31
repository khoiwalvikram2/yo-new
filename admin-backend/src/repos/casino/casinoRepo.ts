import { db } from '@/db/client.js'
import { and, eq, ilike, inArray, count, sql, isNull, isNotNull, or, gte, lte } from 'drizzle-orm'
import { casinoApiProviders, casinoGames, casinoMainCategoryEnum, casinoVendors, whitelabelCasinoGameSettings, whitelabelCasinoVendorSettings, whitelabelCasinoProviderSettings, whitelabelCasinoVendorSuperAdminOverride, whitelabelCasinoGameSuperAdminOverride, vipTierCasinoGames, casinoGameBetSettings, casinoCategories, casinoCategoryGames, casinoProviderVendorShares, casinoBets, users } from '@/db/schema.js'
import type { CasinoCategoryDbType } from '@src/domains/casino/categoryType.js'
import { CASINO_LOUNGE_DEFAULT_CATEGORIES } from '@shared/casino/defaultLounge.js'
export { CASINO_LOUNGE_DEFAULT_CATEGORIES } from '@shared/casino/defaultLounge.js'

export type CasinoMainCategory = 'live_casino' | 'casino' | 'slots'

/** Lightweight search by game name for global search. Returns id and name only. */
export async function searchCasinoGamesByNameDb(query: string, limit: number = 10): Promise<{ id: number; name: string }[]> {
  const q = (query ?? '').trim()
  if (q.length < 2) return []
  const rows = await db
    .select({ id: casinoGames.id, name: casinoGames.name })
    .from(casinoGames)
    .where(ilike(casinoGames.name, `%${q}%`))
    .limit(limit)
  return rows
}

/** Returns a map of provider id -> provider key for the given ids. */
export async function getProviderKeysByIdsDb(providerIds: number[]): Promise<Map<number, string>> {
  if (!providerIds?.length) return new Map()
  const rows = await db
    .select({ id: casinoApiProviders.id, key: casinoApiProviders.key })
    .from(casinoApiProviders)
    .where(inArray(casinoApiProviders.id, providerIds))
  return new Map(rows.map((p) => [p.id, p.key]))
}

export async function listCasinoApiProvidersDb(tenant?: string) {
  let query = db.select({
    id: casinoApiProviders.id,
    key: casinoApiProviders.key,
    name: casinoApiProviders.name,
    status: casinoApiProviders.status,
    lastSyncAt: casinoApiProviders.lastSyncAt,
  }).from(casinoApiProviders)
  if (tenant) {
    query = query.where(
      sql`COALESCE(
        (SELECT ${whitelabelCasinoProviderSettings.enabled}
         FROM ${whitelabelCasinoProviderSettings}
         WHERE ${whitelabelCasinoProviderSettings.tenantId} = ${tenant}
           AND ${whitelabelCasinoProviderSettings.providerId} = ${casinoApiProviders.id}
         LIMIT 1),
        true
      ) = true`
    ) as typeof query
  }
  const rows = await query
  return rows
}

export async function listVendorsByProviderAndCategoryDb(
  providerId: number | undefined,
  category: CasinoMainCategory | undefined,
  tenant?: string
) {
  const whereConditions: any[] = []
  if (category) {
    whereConditions.push(eq(casinoGames.mainCategory, category as any))
  }
  if (providerId) {
    whereConditions.push(eq(casinoGames.apiProviderId, providerId))
  }
  if (tenant) {
    const providerEnabled = sql`COALESCE(
      (SELECT ${whitelabelCasinoProviderSettings.enabled}
       FROM ${whitelabelCasinoProviderSettings}
       WHERE ${whitelabelCasinoProviderSettings.tenantId} = ${tenant}
         AND ${whitelabelCasinoProviderSettings.providerId} = ${casinoGames.apiProviderId}
       LIMIT 1),
      true
    ) = true`
    const vendorNotDisabled = sql`NOT EXISTS (
      SELECT 1 FROM ${whitelabelCasinoVendorSuperAdminOverride}
      WHERE ${whitelabelCasinoVendorSuperAdminOverride.tenantId} = ${tenant}
        AND ${whitelabelCasinoVendorSuperAdminOverride.vendorId} = ${casinoVendors.id}
        AND ${whitelabelCasinoVendorSuperAdminOverride.disabled} = true
    )`
    whereConditions.push(providerEnabled, vendorNotDisabled)
  }

  const rows = await db
    .select({
      id: casinoVendors.id,
      name: casinoVendors.name,
      slug: casinoVendors.slug,
    })
    .from(casinoVendors)
    .innerJoin(casinoGames, eq(casinoGames.vendorId, casinoVendors.id))
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
    .groupBy(casinoVendors.id)
  return rows
}

export async function listCasinoVendorsWithSettingsDb(
  tenant: string | undefined,
  providerId?: number,
  category?: CasinoMainCategory
) {
  let query = db
    .select({
      id: casinoVendors.id,
      name: casinoVendors.name,
      slug: casinoVendors.slug,
      enabled: whitelabelCasinoVendorSettings.enabled,
      displayOrder: whitelabelCasinoVendorSettings.displayOrder,
    })
    .from(casinoVendors)
    .leftJoin(
      whitelabelCasinoVendorSettings,
      tenant !== undefined
        ? and(
            eq(whitelabelCasinoVendorSettings.vendorId, casinoVendors.id),
            eq(whitelabelCasinoVendorSettings.tenantId, tenant)
          )
        : and(
            eq(whitelabelCasinoVendorSettings.vendorId, casinoVendors.id),
            sql`1 = 0`
          )
    )

  const saVendorWhere =
    tenant &&
    and(
      sql`NOT EXISTS (
        SELECT 1 FROM casino_games g
        INNER JOIN whitelabel_casino_provider_settings pcs ON pcs.provider_id = g.api_provider_id
          AND pcs.tenant_id = ${tenant}
          AND pcs.enabled = false
        WHERE g.vendor_id = ${casinoVendors.id}
      )`,
      sql`NOT EXISTS (
        SELECT 1 FROM ${whitelabelCasinoVendorSuperAdminOverride}
        WHERE ${whitelabelCasinoVendorSuperAdminOverride.tenantId} = ${tenant}
          AND ${whitelabelCasinoVendorSuperAdminOverride.vendorId} = ${casinoVendors.id}
          AND ${whitelabelCasinoVendorSuperAdminOverride.disabled} = true
      )`
    )

  if (category) {
    // Filter by category (and provider if provided)
    const gameConditions = [
      eq(casinoGames.vendorId, casinoVendors.id),
      eq(casinoGames.mainCategory, category as any),
      eq(casinoGames.isActive, true), // Only show vendors with active games
    ]
    if (providerId) {
      gameConditions.push(eq(casinoGames.apiProviderId, providerId))
    }
    query = (query
      .innerJoin(
        casinoGames,
        and(...gameConditions)
      ) as any)
    if (saVendorWhere) query = (query as any).where(saVendorWhere)
    query = (query as any).groupBy(
      casinoVendors.id,
      casinoVendors.name,
      casinoVendors.slug,
      whitelabelCasinoVendorSettings.enabled,
      whitelabelCasinoVendorSettings.displayOrder
    )
  } else if (providerId) {
    // Filter by provider only (no category)
    query = query
      .innerJoin(
        casinoGames,
        and(
          eq(casinoGames.vendorId, casinoVendors.id),
          eq(casinoGames.apiProviderId, providerId),
          eq(casinoGames.isActive, true)
        )
      )
    if (saVendorWhere) query = (query as any).where(saVendorWhere)
    query = (query as any).groupBy((aliases: any) => [
      casinoVendors.id,
      casinoVendors.name,
      casinoVendors.slug,
      whitelabelCasinoVendorSettings.enabled,
      whitelabelCasinoVendorSettings.displayOrder
    ])
  } else {
    // No filters - show all vendors (but only those with active games)
    query = (query
      .innerJoin(
        casinoGames,
        and(
          eq(casinoGames.vendorId, casinoVendors.id),
          eq(casinoGames.isActive, true)
        )
      ) as any)
    if (saVendorWhere) query = (query as any).where(saVendorWhere)
    query = (query as any).groupBy((aliases: any) => [
      casinoVendors.id,
      casinoVendors.name,
      casinoVendors.slug,
      whitelabelCasinoVendorSettings.enabled,
      whitelabelCasinoVendorSettings.displayOrder
    ])
  }

  const rows = await query

  // Get game counts for each vendor
  const vendorsWithCounts = await Promise.all(
    rows.map(async (vendor) => {
      // Total games count - filter by category if provided, provider if provided, and always by isActive
      const totalGamesWhereConditions = [
        eq(casinoGames.vendorId, vendor.id),
        eq(casinoGames.isActive, true),
      ]
      if (category) {
        totalGamesWhereConditions.push(eq(casinoGames.mainCategory, category as any))
      }
      if (providerId) {
        totalGamesWhereConditions.push(eq(casinoGames.apiProviderId, providerId))
      }
      const totalGamesWhere = and(...totalGamesWhereConditions)

      const totalGames = await db
        .select({ count: count() })
        .from(casinoGames)
        .where(totalGamesWhere)
      
      const totalGamesCount = totalGames[0]?.count || 0

      // Get enabled games count for this tenant - same filters as total games
      const enabledGamesWhereConditions = [
        eq(casinoGames.vendorId, vendor.id),
        eq(casinoGames.isActive, true),
      ]
      if (category) {
        enabledGamesWhereConditions.push(eq(casinoGames.mainCategory, category as any))
      }
      if (providerId) {
        enabledGamesWhereConditions.push(eq(casinoGames.apiProviderId, providerId))
      }
      const enabledGamesWhere = and(...enabledGamesWhereConditions)

      let enabledGamesCount = 0
      if (tenant != null && tenant !== '') {
        const enabledGames = await db
          .select({ count: count() })
          .from(casinoGames)
          .innerJoin(
            whitelabelCasinoGameSettings,
            and(
              eq(whitelabelCasinoGameSettings.gameId, casinoGames.id),
              eq(whitelabelCasinoGameSettings.tenantId, tenant),
              eq(whitelabelCasinoGameSettings.enabled, true)
            )
          )
          .where(enabledGamesWhere)
        enabledGamesCount = enabledGames[0]?.count || 0
      }

      return {
        ...vendor,
        gamesCount: totalGamesCount,
        enabledGamesCount,
      }
    })
  )

  return vendorsWithCounts
}

export async function toggleCasinoVendorEnabledDb(tenant: string, vendorId: number, enabled: boolean) {
  await db
    .insert(whitelabelCasinoVendorSettings)
    .values({ tenantId: tenant, vendorId, enabled })
    .onConflictDoUpdate({
      target: [whitelabelCasinoVendorSettings.tenantId, whitelabelCasinoVendorSettings.vendorId],
      set: { enabled, updatedAt: sql`now()` },
    })
}

export async function bulkUpdateVendorSettingsDb(tenant: string, vendorIds: number[], enabled: boolean) {
  for (const vendorId of vendorIds) {
    await toggleCasinoVendorEnabledDb(tenant, vendorId, enabled)
  }
}

export async function updateVendorDisplayOrderDb(
  tenant: string,
  vendorOrders: Array<{ vendorId: number; order: number }>
) {
  for (const { vendorId, order } of vendorOrders) {
    await db
      .insert(whitelabelCasinoVendorSettings)
      .values({ tenantId: tenant, vendorId, displayOrder: order })
      .onConflictDoUpdate({
        target: [whitelabelCasinoVendorSettings.tenantId, whitelabelCasinoVendorSettings.vendorId],
        set: { displayOrder: order, updatedAt: sql`now()` },
      })
  }
}

export interface CasinoGameReadArgs {
  tenant?: string  // CRITICAL: undefined for Director Admin core mode (skip tenant filtering)
  providerId?: number  // Optional: if not provided, fetch from all providers
  category?: CasinoMainCategory
  vendorId?: number
  vipTierId?: string
  search?: string
  enabled?: boolean
  page?: number
  pageSize?: number
  includeGameIds?: number[]
  excludeGameIds?: number[]
  selectionMode?: boolean
}

function casinoGameReadConditions(args: CasinoGameReadArgs) {
  const baseWhere: any[] = [args.category
    ? eq(casinoGames.mainCategory, args.category)
    : inArray(casinoGames.mainCategory, ['slots', 'casino', 'live_casino'])]
  if (args.includeGameIds !== undefined) baseWhere.push(inArray(casinoGames.id, args.includeGameIds))
  if (args.excludeGameIds?.length) baseWhere.push(sql`NOT (${inArray(casinoGames.id, args.excludeGameIds)})`)
  // Only filter by provider if provided (for director admin)
  if (args.providerId) {
    baseWhere.push(eq(casinoGames.apiProviderId, args.providerId))
  }
  if (args.vendorId) baseWhere.push(eq(casinoGames.vendorId, args.vendorId))
  if (args.search && args.search.trim().length >= (args.selectionMode ? 2 : 3)) {
    const q = `%${args.search.trim()}%`
    baseWhere.push(args.selectionMode
      ? or(ilike(casinoGames.name, q), ilike(casinoGames.slug, q), sql`EXISTS (SELECT 1 FROM ${casinoVendors} WHERE ${casinoVendors.id} = ${casinoGames.vendorId} AND ${casinoVendors.name} ILIKE ${q})`)
      : ilike(casinoGames.name, q))
  }

  // Enabled filter overlays tenant settings on top of global isActive
  // Effective enabled = (game.isActive && (tenantSetting.enabled if exists else false))
  // CRITICAL: Skip tenant-specific enabled filtering if tenant is undefined (Director Admin core mode)
  // In core mode, show all games based on global isActive only
  let enabledFilter: any = null
  if (args.tenant !== undefined) {
    // Tenant-specific filtering (Whitelabel Admin mode)
    if (args.enabled === true) {
      // Show only games where tenant setting exists AND enabled = true
      enabledFilter = and(
        isNotNull(whitelabelCasinoGameSettings.enabled),
        eq(whitelabelCasinoGameSettings.enabled, true)
      )
    }
    if (args.enabled === false) {
      // Show games where tenant setting doesn't exist OR enabled = false
      enabledFilter = or(
        isNull(whitelabelCasinoGameSettings.enabled),
        eq(whitelabelCasinoGameSettings.enabled, false)
      )
    }
  } else {
    // Core mode: filter by global isActive only (no tenant-specific settings)
    // enabled filter is handled by baseWhere.push(eq(casinoGames.isActive, true)) below
  }

  // VIP tier filter: if vipTierId is provided, show ONLY games that are explicitly enabled for that tier
  let vipTierFilter: any = null
  if (args.vipTierId) {
    // Show only games that are explicitly enabled for the selected tier
    const tierIdParam = args.vipTierId
    vipTierFilter = sql`EXISTS (
      SELECT 1 FROM "vip_tier_casino_games" vtg
      WHERE vtg."game_id" = ${casinoGames.id}
        AND vtg."tier_id" = ${tierIdParam}::uuid
        AND vtg."enabled" = true
    )`
  }

  // Vendor filter: only show games from vendors that are enabled for this tenant
  // CRITICAL: Skip tenant filtering if tenant is undefined (Director Admin core mode)
  let vendorFilter: any = null
  if (args.tenant !== undefined) {
    // Use LEFT JOIN with COALESCE: if setting doesn't exist, default to enabled (true)
    // Note: In subquery, use raw column name for outer table reference
    vendorFilter = sql`
      COALESCE(
        (SELECT vcs.enabled 
         FROM whitelabel_casino_vendor_settings vcs 
         WHERE vcs.vendor_id = casino_games.vendor_id
           AND vcs.tenant_id = ${args.tenant}
         LIMIT 1),
        true
      ) = true
    `
  } else {
    // Core mode: show all vendors (no tenant filtering)
    vendorFilter = sql`true`
  }

  // Super Admin overrides: when tenant is set, exclude provider/vendor/game disabled by SA
  if (args.tenant !== undefined) {
    const providerEnabled = sql`COALESCE(
      (SELECT ${whitelabelCasinoProviderSettings.enabled}
       FROM ${whitelabelCasinoProviderSettings}
       WHERE ${whitelabelCasinoProviderSettings.tenantId} = ${args.tenant}
         AND ${whitelabelCasinoProviderSettings.providerId} = ${casinoGames.apiProviderId}
       LIMIT 1),
      true
    ) = true`
    const vendorNotDisabled = sql`NOT EXISTS (
      SELECT 1 FROM ${whitelabelCasinoVendorSuperAdminOverride}
      WHERE ${whitelabelCasinoVendorSuperAdminOverride.tenantId} = ${args.tenant}
        AND ${whitelabelCasinoVendorSuperAdminOverride.vendorId} = ${casinoGames.vendorId}
        AND ${whitelabelCasinoVendorSuperAdminOverride.disabled} = true
    )`
    const gameNotDisabled = sql`NOT EXISTS (
      SELECT 1 FROM ${whitelabelCasinoGameSuperAdminOverride}
      WHERE ${whitelabelCasinoGameSuperAdminOverride.tenantId} = ${args.tenant}
        AND ${whitelabelCasinoGameSuperAdminOverride.gameId} = ${casinoGames.id}
        AND ${whitelabelCasinoGameSuperAdminOverride.disabled} = true
    )`
    baseWhere.push(providerEnabled, vendorNotDisabled, gameNotDisabled)
  }

  // Always filter out platform-blocked games (isActive = false)
  // This ensures whitelabel admins don't see games that are globally disabled
  baseWhere.push(eq(casinoGames.isActive, true))

  // Build where conditions array - only include non-null filters
  const whereConditions = [...baseWhere]
  if (vendorFilter) whereConditions.push(vendorFilter)
  if (enabledFilter) whereConditions.push(enabledFilter)
  if (vipTierFilter) whereConditions.push(vipTierFilter)

  // Build total count query
  // For count, we can use EXISTS subqueries instead of LEFT JOIN to avoid issues
  let countWhereConditions = [...baseWhere]
  if (vendorFilter) countWhereConditions.push(vendorFilter)
  if (vipTierFilter) countWhereConditions.push(vipTierFilter)
  
  // Add enabled filter as EXISTS subquery for count (avoids LEFT JOIN)
  // CRITICAL: Skip tenant filtering if tenant is undefined (Director Admin core mode)
  if (args.enabled === true && args.tenant !== undefined) {
    countWhereConditions.push(sql`EXISTS (
      SELECT 1 FROM "whitelabel_casino_game_settings" gs
      WHERE gs."game_id" = ${casinoGames.id}
        AND gs."tenant_id" = ${args.tenant}
        AND gs."enabled" = true
    )`)
  } else if (args.enabled === false && args.tenant !== undefined) {
    countWhereConditions.push(sql`NOT EXISTS (
      SELECT 1 FROM "whitelabel_casino_game_settings" gs
      WHERE gs."game_id" = ${casinoGames.id}
        AND gs."tenant_id" = ${args.tenant}
        AND gs."enabled" = true
    )`)
  }

  return { baseWhere, vendorFilter, enabledFilter, vipTierFilter, countWhereConditions }
}

export async function listCasinoGamesPagedDb(args: CasinoGameReadArgs) {
  const page = Math.max(1, args.page || 1)
  const pageSize = Math.min(args.selectionMode ? 100 : 10000, Math.max(1, args.pageSize || 20))
  
  // Debug: Log when large pageSize is requested
  if (args.pageSize && args.pageSize > 100) {
  }

  const { baseWhere, vendorFilter, enabledFilter, vipTierFilter, countWhereConditions } = casinoGameReadConditions(args)

  let total = 0
  try {
    const totalRows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(casinoGames)
      .where(and(...countWhereConditions))
    
    total = Number(totalRows[0]?.value ?? 0)
  } catch (err: any) {
    throw err
  }

  // Build items query
  // For items query, we need to LEFT JOIN vendor settings to get vendor enabled status
  let itemsQuery = db
    .select({
      id: casinoGames.id,
      name: casinoGames.name,
      slug: casinoGames.slug,
      mainCategory: casinoGames.mainCategory,
      vendorId: casinoGames.vendorId,
      vendorName: casinoVendors.name,
      thumbnailUrl: casinoGames.thumbnailUrl,
      rtp: casinoGames.rtp,
      demoUrl: casinoGames.demoUrl,
      isActive: casinoGames.isActive,
      tenantEnabled: whitelabelCasinoGameSettings.enabled,
      premiumOnly: whitelabelCasinoGameSettings.premiumOnly,
      betSettingsCount: args.tenant !== undefined ? sql<number>`(
        SELECT COUNT(*)::int FROM "casino_game_bet_settings" s
        WHERE s."game_id" = ${casinoGames.id}
          AND s."tenant_id" = ${args.tenant}
      )` : sql<number>`0`,
      order: whitelabelCasinoGameSettings.order,
      featured: whitelabelCasinoGameSettings.featured,
      limits: whitelabelCasinoGameSettings.limits,
      updatedAt: whitelabelCasinoGameSettings.updatedAt,
      // Assigned to any category (across all main categories)
      categoryAssigned: sql<boolean>`EXISTS (
        SELECT 1 FROM "casino_category_games" cg
        WHERE cg."game_id" = ${casinoGames.id}
      )`,
      // Vendor enabled status (for filtering in items query)
      // CRITICAL: Skip tenant filtering if tenant is undefined (Director Admin core mode)
      vendorEnabled: args.tenant !== undefined ? sql<boolean>`COALESCE(
        (SELECT vcs.enabled 
         FROM whitelabel_casino_vendor_settings vcs 
         WHERE vcs.vendor_id = casino_games.vendor_id
           AND vcs.tenant_id = ${args.tenant}
         LIMIT 1),
        true
      )` : sql<boolean>`true`,
    })
    .from(casinoGames)
    .innerJoin(casinoVendors, eq(casinoVendors.id, casinoGames.vendorId))
    // CRITICAL: Skip tenant-specific settings JOIN if tenant is undefined (Director Admin core mode)
    .leftJoin(whitelabelCasinoGameSettings, args.tenant !== undefined ? and(
      eq(whitelabelCasinoGameSettings.gameId, casinoGames.id),
      eq(whitelabelCasinoGameSettings.tenantId, args.tenant),
    ) : args.selectionMode ? sql`false` : eq(whitelabelCasinoGameSettings.gameId, casinoGames.id))

  // Build where conditions for items query (same as count query but with vendorEnabled check)
  const itemsWhereConditions = [...baseWhere]
  if (vendorFilter) itemsWhereConditions.push(vendorFilter)
  if (enabledFilter) itemsWhereConditions.push(enabledFilter)
  if (vipTierFilter) itemsWhereConditions.push(vipTierFilter)

  const items = await itemsQuery
    .where(and(...itemsWhereConditions))
    .orderBy(...(args.selectionMode ? [sql`CASE ${casinoGames.mainCategory} WHEN 'slots' THEN 0 WHEN 'casino' THEN 1 ELSE 2 END`, whitelabelCasinoGameSettings.order, casinoGames.id] : [whitelabelCasinoGameSettings.order, casinoGames.id]))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  // Debug log to verify actual items returned
  if (pageSize >= 1000) {
  }

  return { total, items, page, pageSize }
}

export async function toggleCasinoGameEnabledDb(tenant: string, gameId: number, enabled: boolean) {
  // upsert
  await db.insert(whitelabelCasinoGameSettings).values({ tenantId: tenant, gameId, enabled })
    .onConflictDoUpdate({ target: [whitelabelCasinoGameSettings.tenantId, whitelabelCasinoGameSettings.gameId], set: { enabled } })
  const rows = await db.select({
    enabled: whitelabelCasinoGameSettings.enabled,
    order: whitelabelCasinoGameSettings.order,
    featured: whitelabelCasinoGameSettings.featured,
  }).from(whitelabelCasinoGameSettings)
  .where(and(eq(whitelabelCasinoGameSettings.tenantId, tenant), eq(whitelabelCasinoGameSettings.gameId, gameId)))
  return rows[0] ?? { enabled }
}

export async function updateCasinoGameSettingsDb(
  tenant: string,
  gameId: number,
  settings: {
    enabled?: boolean
    premiumOnly?: boolean
    limits?: {
      minStake?: number | null
      maxStake?: number | null
      maxWin?: number | null
      maxWinTarget?: 'all' | 'individual'
      maxWinPlayers?: string[]
    } | null
  }
) {
  const updateData: any = {}
  if (settings.enabled !== undefined) updateData.enabled = settings.enabled
  if (settings.premiumOnly !== undefined) updateData.premiumOnly = settings.premiumOnly
  
  // Handle limits update - merge with existing limits if any
  if (settings.limits !== undefined) {
    // Get existing settings to merge limits
    const existing = await db.select({
      limits: whitelabelCasinoGameSettings.limits,
    }).from(whitelabelCasinoGameSettings)
      .where(and(eq(whitelabelCasinoGameSettings.tenantId, tenant), eq(whitelabelCasinoGameSettings.gameId, gameId)))
      .limit(1)
    
    const existingLimits = existing[0]?.limits || {}
    const mergedLimits = {
      ...(existingLimits as any),
      ...settings.limits,
    }
    updateData.limits = mergedLimits
  }
  
  await db.insert(whitelabelCasinoGameSettings).values({
    tenantId: tenant,
    gameId,
    ...updateData,
  })
    .onConflictDoUpdate({
      target: [whitelabelCasinoGameSettings.tenantId, whitelabelCasinoGameSettings.gameId],
      set: updateData,
    })
  
  const rows = await db.select({
    enabled: whitelabelCasinoGameSettings.enabled,
    premiumOnly: whitelabelCasinoGameSettings.premiumOnly,
    limits: whitelabelCasinoGameSettings.limits,
    order: whitelabelCasinoGameSettings.order,
    featured: whitelabelCasinoGameSettings.featured,
  }).from(whitelabelCasinoGameSettings)
    .where(and(eq(whitelabelCasinoGameSettings.tenantId, tenant), eq(whitelabelCasinoGameSettings.gameId, gameId)))
  
  return rows[0] ?? null
}

export async function bulkUpdateCasinoGameSettingsDb(
  tenant: string,
  gameIds: number[],
  settings: {
    enabled?: boolean
    premiumOnly?: boolean
    limits?: {
      minStake?: number | null
      maxStake?: number | null
      maxWin?: number | null
      maxWinTarget?: 'all' | 'individual'
      maxWinPlayers?: string[]
    } | null
  }
) {
  if (!gameIds.length) return { updated: 0 }
  
  let updated = 0
  for (const gameId of gameIds) {
    await updateCasinoGameSettingsDb(tenant, gameId, settings)
    updated++
  }
  
  return { updated }
}

// =========== Master Control (Director Only) ==========

export async function toggleCasinoGameMasterActiveDb(gameId: number, isActive: boolean) {
  const rows = await db
    .update(casinoGames)
    .set({ isActive, updatedAt: sql`now()` })
    .where(eq(casinoGames.id, gameId))
    .returning({ id: casinoGames.id })
  return rows.length > 0
}

export async function reorderVendorGamesDb(tenant: string, vendorId: number, category: CasinoMainCategory, orderedGameIds: number[]) {
  if (!orderedGameIds.length) return { updated: 0 }
  // Ensure these belong to vendor and category for this tenant's scope
  const rows = await db.select({ id: casinoGames.id }).from(casinoGames).where(and(
    inArray(casinoGames.id, orderedGameIds),
    eq(casinoGames.vendorId, vendorId),
    eq(casinoGames.mainCategory, category as any),
  ))
  const validIds = rows.map(r => r.id)
  let updated = 0
  for (let i = 0; i < validIds.length; i++) {
    const gid = validIds[i]
    const ord = i + 1
    await db.insert(whitelabelCasinoGameSettings).values({ tenantId: tenant, gameId: gid, order: ord })
      .onConflictDoUpdate({ target: [whitelabelCasinoGameSettings.tenantId, whitelabelCasinoGameSettings.gameId], set: { order: ord } })
    updated++
  }
  return { updated }
}

// VIP Tier Game Management
export async function getVipTierGameSettingsDb(tierId: string, gameId: number) {
  const rows = await db
    .select()
    .from(vipTierCasinoGames)
    .where(and(eq(vipTierCasinoGames.tierId, tierId), eq(vipTierCasinoGames.gameId, gameId)))
    .limit(1)
  return rows[0] || null
}

export async function toggleVipTierGameEnabledDb(tierId: string, gameId: number, enabled: boolean) {
  await db
    .insert(vipTierCasinoGames)
    .values({ tierId, gameId, enabled, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [vipTierCasinoGames.tierId, vipTierCasinoGames.gameId],
      set: { enabled, updatedAt: sql`now()` },
    })
  return { tierId, gameId, enabled }
}

export async function getVipTierGamesDb(tierId: string) {
  const rows = await db
    .select({
      gameId: vipTierCasinoGames.gameId,
      enabled: vipTierCasinoGames.enabled,
      updatedAt: vipTierCasinoGames.updatedAt,
    })
    .from(vipTierCasinoGames)
    .where(eq(vipTierCasinoGames.tierId, tierId))
  return rows
}

export async function getGameVipTiersDb(gameId: number) {
  const rows = await db
    .select({
      tierId: vipTierCasinoGames.tierId,
      enabled: vipTierCasinoGames.enabled,
      updatedAt: vipTierCasinoGames.updatedAt,
    })
    .from(vipTierCasinoGames)
    .where(eq(vipTierCasinoGames.gameId, gameId))
  return rows
}

export async function bulkUpdateVipTierGamesDb(tierId: string, gameIds: number[], enabled: boolean) {
  if (!gameIds.length) return { updated: 0 }
  
  let updated = 0
  for (const gameId of gameIds) {
    await db
      .insert(vipTierCasinoGames)
      .values({ tierId, gameId, enabled, updatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: [vipTierCasinoGames.tierId, vipTierCasinoGames.gameId],
        set: { enabled, updatedAt: sql`now()` },
      })
    updated++
  }
  return { updated }
}

/** Real GGR and transaction count from casino_bets for a single vendor (settled bets only). */
export async function computeVendorGGRDb(
  vendorId: number,
  providerId: number,
  startDate: string,
  endDate: string,
  tenant: string | undefined
): Promise<{ ggr: number; transactionCount: number; vendorName: string }> {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const conditions = [
    eq(casinoBets.vendorId, vendorId),
    gte(casinoBets.createdAt, start),
    lte(casinoBets.createdAt, end),
    inArray(casinoBets.status, ['won', 'lost']),
  ]
  if (tenant != null && tenant !== '') {
    conditions.push(eq(casinoBets.tenant, tenant))
  }
  if (providerId != null) {
    conditions.push(eq(casinoBets.providerId, providerId))
  }
  const [row] = await db
    .select({
      ggr: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
      transactionCount: sql<number>`COUNT(*)::int`,
      vendorName: sql<string>`MAX(${casinoBets.vendorName})`,
    })
    .from(casinoBets)
    .where(and(...conditions))
  const ggr = Number(row?.ggr ?? 0)
  const transactionCount = Number(row?.transactionCount ?? 0)
  const vendorName = row?.vendorName ?? 'Vendor ' + vendorId
  return { ggr, transactionCount, vendorName }
}

export type VendorGGRBreakdownRow = {
  vendorId: string
  vendorName: string
  ggr: number
  transactionCount: number
}

/** Real GGR from casino_bets for a provider: total and per-vendor breakdown (settled bets only). */
export async function computeProviderGGRDb(
  providerId: number,
  startDate: string,
  endDate: string,
  tenant: string | undefined
): Promise<{ totalGGR: number; vendorBreakdown: VendorGGRBreakdownRow[] }> {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const conditions = [
    eq(casinoBets.providerId, providerId),
    gte(casinoBets.createdAt, start),
    lte(casinoBets.createdAt, end),
    inArray(casinoBets.status, ['won', 'lost']),
  ]
  if (tenant != null && tenant !== '') {
    conditions.push(eq(casinoBets.tenant, tenant))
  }
  const rows = await db
    .select({
      vendorId: casinoBets.vendorId,
      vendorName: casinoBets.vendorName,
      ggr: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
      transactionCount: sql<number>`COUNT(*)::int`,
    })
    .from(casinoBets)
    .where(and(...conditions))
    .groupBy(casinoBets.vendorId, casinoBets.vendorName)

  const vendorBreakdown: VendorGGRBreakdownRow[] = (rows || []).map((r: any) => ({
    vendorId: String(r.vendorId),
    vendorName: r.vendorName ?? 'Unknown',
    ggr: Number(r.ggr ?? 0),
    transactionCount: Number(r.transactionCount ?? 0),
  }))
  const totalGGR = vendorBreakdown.reduce((sum, v) => sum + v.ggr, 0)
  return { totalGGR, vendorBreakdown }
}

export async function getProvidersWithVendorsDb(tenant?: string) {
  let query = db
    .select({
      providerId: casinoApiProviders.id,
      providerKey: casinoApiProviders.key,
      providerName: casinoApiProviders.name,
      status: casinoApiProviders.status,
      lastSyncAt: casinoApiProviders.lastSyncAt,
      vendorId: casinoVendors.id,
      vendorName: casinoVendors.name,
      vendorSlug: casinoVendors.slug,
    })
    .from(casinoApiProviders)
    .leftJoin(casinoGames, eq(casinoGames.apiProviderId, casinoApiProviders.id))
    .leftJoin(casinoVendors, eq(casinoVendors.id, casinoGames.vendorId))

  if (tenant) {
    const providerEnabled = sql`COALESCE(
      (SELECT ${whitelabelCasinoProviderSettings.enabled}
       FROM ${whitelabelCasinoProviderSettings}
       WHERE ${whitelabelCasinoProviderSettings.tenantId} = ${tenant}
         AND ${whitelabelCasinoProviderSettings.providerId} = ${casinoApiProviders.id}
       LIMIT 1),
      true
    ) = true`
    const vendorNotDisabled = sql`(${casinoVendors.id} IS NULL OR NOT EXISTS (
      SELECT 1 FROM ${whitelabelCasinoVendorSuperAdminOverride}
      WHERE ${whitelabelCasinoVendorSuperAdminOverride.tenantId} = ${tenant}
        AND ${whitelabelCasinoVendorSuperAdminOverride.vendorId} = ${casinoVendors.id}
        AND ${whitelabelCasinoVendorSuperAdminOverride.disabled} = true
    ))`
    query = query.where(and(providerEnabled, vendorNotDisabled)) as typeof query
  }

  const rows = await query

  const map = new Map<number, any>()
  for (const r of rows) {
    const pid = Number(r.providerId)
    if (!map.has(pid)) {
      map.set(pid, {
        id: String(r.providerId),
        key: r.providerKey,
        name: r.providerName,
        status: r.status,
        lastSyncAt: r.lastSyncAt,
        vendors: [] as Array<{ id: string; name: string; slug: string }>,
      })
    }
    if (r.vendorId) {
      const list = map.get(pid).vendors as Array<{ id: string; name: string; slug: string }>
      if (!list.find((v) => v.id === String(r.vendorId))) {
        list.push({ id: String(r.vendorId), name: r.vendorName || '', slug: r.vendorSlug || '' })
      }
    }
  }
  return Array.from(map.values())
}

export async function getWhitelabelCasinoProviderSettingsDb(tenantId: string) {
  const rows = await db
    .select({
      id: whitelabelCasinoProviderSettings.id,
      tenantId: whitelabelCasinoProviderSettings.tenantId,
      providerId: casinoApiProviders.id,
      providerKey: casinoApiProviders.key,
      providerName: casinoApiProviders.name,
      enabled: whitelabelCasinoProviderSettings.enabled,
      displayOrder: whitelabelCasinoProviderSettings.displayOrder,
    })
    .from(casinoApiProviders)
    .leftJoin(
      whitelabelCasinoProviderSettings,
      and(
        eq(whitelabelCasinoProviderSettings.providerId, casinoApiProviders.id),
        eq(whitelabelCasinoProviderSettings.tenantId, tenantId)
      )
    )
  return rows.map((r) => ({
    id: r.id != null ? String(r.id) : `provider-${r.providerId}`,
    tenantId,
    providerId: r.providerId,
    providerKey: r.providerKey,
    providerName: r.providerName,
    enabled: r.enabled ?? true,
    displayOrder: r.displayOrder ?? undefined,
  }))
}

export async function toggleWhitelabelCasinoProviderDb(tenantId: string, providerId: number, enabled: boolean) {
  await db
    .insert(whitelabelCasinoProviderSettings)
    .values({
      tenantId,
      providerId,
      enabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [whitelabelCasinoProviderSettings.tenantId, whitelabelCasinoProviderSettings.providerId],
      set: { enabled, updatedAt: new Date() },
    })
}

export async function getWhitelabelCasinoVendorOverrideSettingsDb(tenantId: string) {
  const vendorRows = await db
    .select({
      vendorId: casinoVendors.id,
      vendorName: casinoVendors.name,
      vendorSlug: casinoVendors.slug,
      disabled: whitelabelCasinoVendorSuperAdminOverride.disabled,
    })
    .from(casinoVendors)
    .leftJoin(
      whitelabelCasinoVendorSuperAdminOverride,
      and(
        eq(whitelabelCasinoVendorSuperAdminOverride.vendorId, casinoVendors.id),
        eq(whitelabelCasinoVendorSuperAdminOverride.tenantId, tenantId)
      )
    )
  const vendorIds = vendorRows.map((r) => r.vendorId)
  if (vendorIds.length === 0) return []
  const providerPerVendor = await db
    .select({
      vendorId: casinoGames.vendorId,
      providerId: casinoGames.apiProviderId,
    })
    .from(casinoGames)
    .where(inArray(casinoGames.vendorId, vendorIds))
    .groupBy(casinoGames.vendorId, casinoGames.apiProviderId)
  const firstProvider = new Map<number, number>()
  for (const p of providerPerVendor) {
    if (!firstProvider.has(p.vendorId)) firstProvider.set(p.vendorId, p.providerId)
  }
  const providerIds = [...new Set(firstProvider.values())]
  const providers =
    providerIds.length > 0
      ? await db
          .select({
            id: casinoApiProviders.id,
            key: casinoApiProviders.key,
          })
          .from(casinoApiProviders)
          .where(inArray(casinoApiProviders.id, providerIds))
      : []
  const providerMap = new Map(providers.map((p) => [p.id, p.key]))
  return vendorRows.map((r) => {
    const providerId = firstProvider.get(r.vendorId)
    return {
      id: r.disabled != null ? `override-${r.vendorId}` : `vendor-${r.vendorId}`,
      tenantId,
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      vendorSlug: r.vendorSlug ?? '',
      providerId: providerId ?? 0,
      providerKey: (providerId != null ? providerMap.get(providerId) : undefined) ?? '',
      disabled: r.disabled ?? false,
    }
  })
}

export async function setWhitelabelCasinoVendorSuperAdminOverrideDb(tenantId: string, vendorId: number, disabled: boolean) {
  await db
    .insert(whitelabelCasinoVendorSuperAdminOverride)
    .values({
      tenantId,
      vendorId,
      disabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [whitelabelCasinoVendorSuperAdminOverride.tenantId, whitelabelCasinoVendorSuperAdminOverride.vendorId],
      set: { disabled, updatedAt: new Date() },
    })
}

export async function getWhitelabelCasinoGameOverrideSettingsDb(
  tenantId: string,
  options?: { providerId?: number; vendorId?: number; search?: string; limit?: number; offset?: number }
) {
  const limit = Math.min(Math.max(1, options?.limit ?? 20), 100)
  const offset = Math.max(0, options?.offset ?? 0)
  const conditions = []
  if (options?.providerId != null) conditions.push(eq(casinoGames.apiProviderId, options.providerId))
  if (options?.vendorId != null) conditions.push(eq(casinoGames.vendorId, options.vendorId))
  if (options?.search?.trim()) conditions.push(ilike(casinoGames.name, `%${options.search.trim()}%`))
  const whereClause = conditions.length ? and(...conditions) : undefined

  const baseQuery = db
    .select({
      gameId: casinoGames.id,
      gameName: casinoGames.name,
      externalId: casinoGames.externalId,
      thumbnailUrl: casinoGames.thumbnailUrl,
      vendorId: casinoGames.vendorId,
      providerId: casinoGames.apiProviderId,
      disabled: whitelabelCasinoGameSuperAdminOverride.disabled,
    })
    .from(casinoGames)
    .leftJoin(
      whitelabelCasinoGameSuperAdminOverride,
      and(
        eq(whitelabelCasinoGameSuperAdminOverride.gameId, casinoGames.id),
        eq(whitelabelCasinoGameSuperAdminOverride.tenantId, tenantId)
      )
    )

  const queryWithWhere = whereClause ? baseQuery.where(whereClause) : baseQuery
  const countQuery = whereClause
    ? db.select({ count: count() }).from(casinoGames).where(whereClause)
    : db.select({ count: count() }).from(casinoGames)
  const [rows, countResult] = await Promise.all([
    queryWithWhere.orderBy(casinoGames.id).limit(limit).offset(offset),
    countQuery,
  ])
  const total = Number(countResult[0]?.count ?? 0)
  const vendorIds = [...new Set(rows.map((r) => r.vendorId))]
  const providers = await db.select({ id: casinoApiProviders.id, key: casinoApiProviders.key }).from(casinoApiProviders)
  const vendorRows =
    vendorIds.length > 0
      ? await db.select({ id: casinoVendors.id, name: casinoVendors.name }).from(casinoVendors).where(inArray(casinoVendors.id, vendorIds))
      : []
  const providerMap = new Map(providers.map((p) => [p.id, p.key]))
  const vendorMap = new Map(vendorRows.map((v) => [v.id, v.name]))
  const items = rows.map((r) => ({
    id: r.disabled != null ? `override-${r.gameId}` : `game-${r.gameId}`,
    tenantId,
    gameId: r.gameId,
    gameName: r.gameName,
    externalId: r.externalId,
    thumbnailUrl: r.thumbnailUrl ?? null,
    vendorId: r.vendorId,
    vendorName: vendorMap.get(r.vendorId) ?? '',
    providerId: r.providerId,
    providerKey: providerMap.get(r.providerId) ?? '',
    disabled: r.disabled ?? false,
  }))
  return { items, total, hasMore: offset + items.length < total }
}

export async function setWhitelabelCasinoGameSuperAdminOverrideDb(tenantId: string, gameId: number, disabled: boolean) {
  await db
    .insert(whitelabelCasinoGameSuperAdminOverride)
    .values({
      tenantId,
      gameId,
      disabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [whitelabelCasinoGameSuperAdminOverride.tenantId, whitelabelCasinoGameSuperAdminOverride.gameId],
      set: { disabled, updatedAt: new Date() },
    })
}

export async function isProviderEnabledForTenant(tenantId: string, providerId: number): Promise<boolean> {
  const rows = await db
    .select({ enabled: whitelabelCasinoProviderSettings.enabled })
    .from(whitelabelCasinoProviderSettings)
    .where(
      and(
        eq(whitelabelCasinoProviderSettings.tenantId, tenantId),
        eq(whitelabelCasinoProviderSettings.providerId, providerId)
      )
    )
    .limit(1)
  return rows[0]?.enabled ?? true
}

export async function createCasinoProviderDb(args: { key: string; name: string; status?: string }) {
  const { key, name, status } = args
  const rows = await db
    .insert(casinoApiProviders)
    .values({ key, name, status: status ?? 'active' })
    .returning({ id: casinoApiProviders.id, key: casinoApiProviders.key, name: casinoApiProviders.name, status: casinoApiProviders.status, lastSyncAt: casinoApiProviders.lastSyncAt })
  const row = rows[0]
  if (!row) throw new Error('Failed to create casino provider')
  return row
}

export async function updateCasinoProviderDb(id: number, args: { key?: string; name?: string; status?: string; lastSyncAt?: Date | null }) {
  const patch: any = {}
  if (typeof args.key === 'string') patch.key = args.key
  if (typeof args.name === 'string') patch.name = args.name
  if (typeof args.status === 'string') patch.status = args.status
  if (typeof args.lastSyncAt !== 'undefined') patch.lastSyncAt = args.lastSyncAt as any
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ 
      id: casinoApiProviders.id, 
      key: casinoApiProviders.key, 
      name: casinoApiProviders.name, 
      status: casinoApiProviders.status, 
      lastSyncAt: casinoApiProviders.lastSyncAt 
    }).from(casinoApiProviders).where(eq(casinoApiProviders.id, id)).limit(1)
    return rows[0] ?? null
  }
  const rows = await db
    .update(casinoApiProviders)
    .set(patch)
    .where(eq(casinoApiProviders.id, id))
    .returning({ id: casinoApiProviders.id, key: casinoApiProviders.key, name: casinoApiProviders.name, status: casinoApiProviders.status, lastSyncAt: casinoApiProviders.lastSyncAt })
  return rows[0] ?? null
}

export async function getVendorGamesStatsDb(vendorId: number, tenant: string) {
  const stats = await db
    .select({
      totalGames: sql<number>`COUNT(DISTINCT ${casinoGames.id})::int`,
      activeGames: sql<number>`COUNT(DISTINCT CASE WHEN ${casinoGames.isActive} = true AND (${whitelabelCasinoGameSettings.enabled} = true OR ${whitelabelCasinoGameSettings.enabled} IS NULL) THEN ${casinoGames.id} END)::int`,
    })
    .from(casinoGames)
    .leftJoin(whitelabelCasinoGameSettings, and(
      eq(whitelabelCasinoGameSettings.gameId, casinoGames.id),
      eq(whitelabelCasinoGameSettings.tenantId, tenant),
    ))
    .where(eq(casinoGames.vendorId, vendorId))
    .groupBy(casinoGames.vendorId)

  return stats[0] || { totalGames: 0, activeGames: 0 }
}

export async function getProviderVendorsStatsDb(providerId: number) {
  const stats = await db
    .select({
      vendorId: casinoVendors.id,
      vendorName: casinoVendors.name,
      totalGames: sql<number>`COUNT(DISTINCT ${casinoGames.id})::int`,
      activeGames: sql<number>`COUNT(DISTINCT CASE WHEN ${casinoGames.isActive} = true THEN ${casinoGames.id} END)::int`,
    })
    .from(casinoVendors)
    .innerJoin(casinoGames, eq(casinoGames.vendorId, casinoVendors.id))
    .where(eq(casinoGames.apiProviderId, providerId))
    .groupBy(casinoVendors.id, casinoVendors.name)

  return stats
}

export async function deleteCasinoProviderDb(id: number) {
  const rows = await db
    .delete(casinoApiProviders)
    .where(eq(casinoApiProviders.id, id))
    .returning({ id: casinoApiProviders.id })
  return rows.length > 0
}

// Custom Categories (tenant-specific)

/** Deletes all casino categories for a tenant. Category-game links are removed by DB cascade. Returns number of categories deleted. */
export async function deleteAllCasinoCategoriesForTenant(tenantId: string): Promise<number> {
  const deleted = await db
    .delete(casinoCategories)
    .where(eq(casinoCategories.tenantId, tenantId))
    .returning({ id: casinoCategories.id })
  return deleted.length
}

export async function listCasinoCategoriesDb(tenant: string, mainCategory?: CasinoMainCategory) {
  try {
    const where: any[] = [eq(casinoCategories.tenantId, tenant)]
    if (mainCategory) where.push(eq(casinoCategories.mainCategory, mainCategory as any))

    // First get all categories
    const categories = await db
      .select({
        id: casinoCategories.id,
        tenantId: casinoCategories.tenantId,
        mainCategory: casinoCategories.mainCategory,
        type: casinoCategories.type,
        subtitle: casinoCategories.subtitle,
        name: casinoCategories.name,
        slug: casinoCategories.slug,
        iconData: casinoCategories.iconData,
        order: casinoCategories.order,
        isActive: casinoCategories.isActive,
        createdAt: casinoCategories.createdAt,
        updatedAt: casinoCategories.updatedAt,
      })
      .from(casinoCategories)
      .where(and(...where))

    // Then get game counts for each category
    const categoryIds = categories.map(c => c.id)
    const gameCounts = categoryIds.length > 0
      ? await db
          .select({
            categoryId: casinoCategoryGames.categoryId,
            count: count(casinoCategoryGames.gameId),
          })
          .from(casinoCategoryGames)
          .where(inArray(casinoCategoryGames.categoryId, categoryIds))
          .groupBy(casinoCategoryGames.categoryId)
      : []

    // Create a map of categoryId -> gameCount
    const gameCountMap = new Map<number, number>()
    gameCounts.forEach(gc => {
      gameCountMap.set(gc.categoryId, Number(gc.count))
    })

    // Merge game counts into categories and sort by order (NULLs last)
    return categories
      .map(cat => ({
        ...cat,
        gameCount: gameCountMap.get(cat.id) ?? 0,
      }))
      .sort((a, b) => {
        const orderA = a.order ?? 999999
        const orderB = b.order ?? 999999
        return orderA - orderB
      })
  } catch (error: any) {
    throw new Error(`Failed to fetch casino categories: ${error?.message || error}`)
  }
}

export async function getCasinoCategoryDb(tenant: string, id: number) {
  const rows = await db
    .select()
    .from(casinoCategories)
    .where(and(eq(casinoCategories.tenantId, tenant), eq(casinoCategories.id, id)))
    .limit(1)
  return rows[0] || null
}

export async function createCasinoCategoryDb(tenant: string, args: {
  mainCategory: CasinoMainCategory
  type?: CasinoCategoryDbType
  subtitle?: string | null
  name: string
  slug: string
  iconData?: string | null
  isActive?: boolean
  order?: number | null
}) {
  const rows = await db
    .insert(casinoCategories)
    .values({
      tenantId: tenant,
      mainCategory: args.mainCategory as any,
      type: (args.type ?? 'general') as any,
      subtitle: args.subtitle ?? null,
      name: args.name,
      slug: args.slug,
      iconData: (args.iconData ?? null) as any,
      isActive: args.isActive ?? true,
      order: args.order ?? null,
    })
    .returning({
      id: casinoCategories.id,
      tenantId: casinoCategories.tenantId,
      mainCategory: casinoCategories.mainCategory,
      type: casinoCategories.type,
      subtitle: casinoCategories.subtitle,
      name: casinoCategories.name,
      slug: casinoCategories.slug,
      iconData: casinoCategories.iconData,
      order: casinoCategories.order,
      isActive: casinoCategories.isActive,
      createdAt: casinoCategories.createdAt,
      updatedAt: casinoCategories.updatedAt,
    })
  return rows[0] || null
}

export async function updateCasinoCategoryDb(tenant: string, id: number, patch: {
  name?: string
  slug?: string
  iconData?: string | null
  isActive?: boolean
  type?: CasinoCategoryDbType
  subtitle?: string | null
  mainCategory?: CasinoMainCategory
}) {
  const data: any = {}
  if (typeof patch.name === 'string') data.name = patch.name
  if (typeof patch.slug === 'string') data.slug = patch.slug
  if (typeof patch.iconData !== 'undefined') data.iconData = patch.iconData as any
  if (typeof patch.isActive === 'boolean') data.isActive = patch.isActive
  if (typeof patch.type === 'string') data.type = patch.type as any
  if (typeof patch.subtitle !== 'undefined') data.subtitle = patch.subtitle
   // allow moving category between main categories
  if (typeof patch.mainCategory === 'string') data.mainCategory = patch.mainCategory as any
  if (Object.keys(data).length === 0) {
    return await getCasinoCategoryDb(tenant, id)
  }
  const rows = await db
    .update(casinoCategories)
    .set(data)
    .where(and(eq(casinoCategories.tenantId, tenant), eq(casinoCategories.id, id)))
    .returning({
      id: casinoCategories.id,
      tenantId: casinoCategories.tenantId,
      mainCategory: casinoCategories.mainCategory,
      type: casinoCategories.type,
      subtitle: casinoCategories.subtitle,
      name: casinoCategories.name,
      slug: casinoCategories.slug,
      iconData: casinoCategories.iconData,
      order: casinoCategories.order,
      isActive: casinoCategories.isActive,
      createdAt: casinoCategories.createdAt,
      updatedAt: casinoCategories.updatedAt,
    })
  return rows[0] || null
}

export async function deleteCasinoCategoryDb(tenant: string, id: number) {
  const rows = await db
    .delete(casinoCategories)
    .where(and(eq(casinoCategories.tenantId, tenant), eq(casinoCategories.id, id)))
    .returning({ id: casinoCategories.id })
  return rows.length > 0
}

export async function reorderCasinoCategoriesDb(tenant: string, mainCategory: CasinoMainCategory, orderedIds: number[]) {
  if (!orderedIds.length) return { updated: 0 }
  let updated = 0
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]
    const ord = i + 1
    const res = await db
      .update(casinoCategories)
      .set({ order: ord })
      .where(and(eq(casinoCategories.tenantId, tenant), eq(casinoCategories.mainCategory, mainCategory as any), eq(casinoCategories.id, id)))
      .returning({ id: casinoCategories.id })
    if (res.length) updated++
  }
  return { updated }
}

const ASSIGN_GAMES_BATCH_SIZE = 200

export async function assignGamesToCategoryDb(tenant: string, categoryId: number, gameIds: number[]) {
  const uniqueIds = [...new Set(gameIds)].filter((id) => Number.isInteger(id) && id > 0)
  if (!uniqueIds.length) return { inserted: 0 }
  const cat = await getCasinoCategoryDb(tenant, categoryId)
  if (!cat) throw new Error('Category not found')

  let inserted = 0
  for (let i = 0; i < uniqueIds.length; i += ASSIGN_GAMES_BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + ASSIGN_GAMES_BATCH_SIZE)
    const values = batch.map((gid) => ({ categoryId, gameId: gid }))
    const rows = await db
      .insert(casinoCategoryGames)
      .values(values)
      .onConflictDoNothing({ target: [casinoCategoryGames.categoryId, casinoCategoryGames.gameId] as any })
      .returning({ id: casinoCategoryGames.id })
    inserted += rows.length
  }
  return { inserted }
}

export async function removeGamesFromCategoryDb(tenant: string, categoryId: number, gameIds: number[]) {
  if (!gameIds.length) return { deleted: 0 }
  const cat = await getCasinoCategoryDb(tenant, categoryId)
  if (!cat) throw new Error('Category not found')

  const rows = await db
    .delete(casinoCategoryGames)
    .where(and(eq(casinoCategoryGames.categoryId, categoryId), inArray(casinoCategoryGames.gameId, gameIds)))
    .returning({ id: casinoCategoryGames.id })
  return { deleted: rows.length }
}

export async function getGamesInCategoryDb(tenant: string | undefined, categoryId: number) {
  // CRITICAL: Skip tenant filtering if tenant is undefined (Director Admin core mode)
  if (tenant === undefined) {
    // Core mode: return all games in category (no tenant filtering)
    const { casinoCategoryGames } = await import('@shared/db/schema/casino.js')
    const { eq } = await import('drizzle-orm')
    const ids = await db
      .select({ gameId: casinoCategoryGames.gameId })
      .from(casinoCategoryGames)
      .where(eq(casinoCategoryGames.categoryId, categoryId))
      .orderBy(casinoCategoryGames.order, casinoCategoryGames.id)
    return ids.map(r => r.gameId)
  }
  const cat = await getCasinoCategoryDb(tenant, categoryId)
  if (!cat) throw new Error('Category not found')

  const rows = await db
    .select({ gameId: casinoCategoryGames.gameId })
    .from(casinoCategoryGames)
    .where(eq(casinoCategoryGames.categoryId, categoryId))
    .orderBy(casinoCategoryGames.order, casinoCategoryGames.id)
  return rows.map(r => r.gameId)
}

export async function reorderCategoryGamesDb(tenant: string, categoryId: number, orderedGameIds: number[]) {
  if (!orderedGameIds.length) return { updated: 0 }
  const cat = await getCasinoCategoryDb(tenant, categoryId)
  if (!cat) throw new Error('Category not found')

  let updated = 0
  for (let i = 0; i < orderedGameIds.length; i++) {
    const res = await db
      .update(casinoCategoryGames)
      .set({ order: i + 1 })
      .where(and(eq(casinoCategoryGames.categoryId, categoryId), eq(casinoCategoryGames.gameId, orderedGameIds[i])))
      .returning({ id: casinoCategoryGames.id })
    if (res.length) updated++
  }
  return { updated }
}

const GAP_GMAG_PROVIDER_KEYS = ['gapcasino', 'gmagcasino'] as const

/** Returns provider id by key (e.g. 'gapcasino', 'gmagcasino'), or null if not found. */
export async function getProviderIdByKeyDb(key: string): Promise<number | null> {
  const rows = await db
    .select({ id: casinoApiProviders.id })
    .from(casinoApiProviders)
    .where(eq(casinoApiProviders.key, key))
    .limit(1)
  return rows[0]?.id ?? null
}

/** Returns provider IDs that are enabled for the tenant. Uses same rule as UI and isProviderEnabledForTenant: no row = enabled (default true). */
export async function getEnabledProviderIdsForTenantDb(tenantId: string): Promise<number[]> {
  const gapGmagProviders = await db
    .select({ id: casinoApiProviders.id })
    .from(casinoApiProviders)
    .where(inArray(casinoApiProviders.key, [...GAP_GMAG_PROVIDER_KEYS]))
  const providerIds = gapGmagProviders.map((p) => p.id)
  if (providerIds.length === 0) return []
  const settingsRows = await db
    .select({ providerId: whitelabelCasinoProviderSettings.providerId, enabled: whitelabelCasinoProviderSettings.enabled })
    .from(whitelabelCasinoProviderSettings)
    .where(
      and(
        eq(whitelabelCasinoProviderSettings.tenantId, tenantId),
        inArray(whitelabelCasinoProviderSettings.providerId, providerIds)
      )
    )
  const enabledByProvider = new Map(settingsRows.map((r) => [r.providerId, r.enabled ?? true]))
  return providerIds.filter((id) => enabledByProvider.get(id) ?? true)
}

/** Sets all casino_games for Gap and GMAG providers to is_active = true. Returns count of rows updated. */
export async function setGapGmagGamesActiveDb(): Promise<number> {
  const providers = await db
    .select({ id: casinoApiProviders.id })
    .from(casinoApiProviders)
    .where(inArray(casinoApiProviders.key, [...GAP_GMAG_PROVIDER_KEYS]))
  const providerIds = providers.map((p) => p.id)
  if (providerIds.length === 0) return 0
  const result = await db
    .update(casinoGames)
    .set({ isActive: true, updatedAt: new Date() })
    .where(inArray(casinoGames.apiProviderId, providerIds))
    .returning({ id: casinoGames.id })
  return result.length
}

/** Returns true if the name contains only Latin script, digits, spaces, and common punctuation (excludes CJK, Arabic, Cyrillic, etc.). */
export function isLatinGameName(name: string): boolean {
  if (typeof name !== 'string' || !name.trim()) return false
  const nonLatin =
    /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0600-\u06FF]/
  return !nonLatin.test(name)
}

/** Returns game IDs that are active and have Latin-only names for the given main category. */
export async function getEligibleGameIdsByMainCategoryDb(
  mainCategory: CasinoMainCategory
): Promise<number[]> {
  const rows = await db
    .select({ id: casinoGames.id, name: casinoGames.name })
    .from(casinoGames)
    .where(and(eq(casinoGames.mainCategory, mainCategory as any), eq(casinoGames.isActive, true)))
  return rows.filter(r => isLatinGameName(r.name)).map(r => r.id)
}

/** Eligible game row for hybrid mapping (id, name, slug, mainCategory, features). */
export type EligibleGameRow = {
  id: number
  name: string
  slug: string
  mainCategory: CasinoMainCategory
  features: unknown
}

/** Returns eligible games (Latin name, active) with fields needed for category mapping. */
export async function getEligibleGamesByMainCategoryDb(
  mainCategory: CasinoMainCategory
): Promise<EligibleGameRow[]> {
  const rows = await db
    .select({
      id: casinoGames.id,
      name: casinoGames.name,
      slug: casinoGames.slug,
      mainCategory: casinoGames.mainCategory,
      features: casinoGames.features,
    })
    .from(casinoGames)
    .where(and(eq(casinoGames.mainCategory, mainCategory as any), eq(casinoGames.isActive, true)))
  return rows
    .filter(r => isLatinGameName(r.name))
    .map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      mainCategory: r.mainCategory as CasinoMainCategory,
      features: r.features,
    }))
}

/** Returns eligible games (Latin name, active) for given provider IDs with fields needed for category mapping. */
export async function getEligibleGamesForTenantByProvidersDb(
  providerIds: number[]
): Promise<EligibleGameRow[]> {
  if (providerIds.length === 0) return []
  const rows = await db
    .select({
      id: casinoGames.id,
      name: casinoGames.name,
      slug: casinoGames.slug,
      mainCategory: casinoGames.mainCategory,
      features: casinoGames.features,
    })
    .from(casinoGames)
    .where(
      and(
        inArray(casinoGames.apiProviderId, providerIds),
        eq(casinoGames.isActive, true)
      )
    )
  return rows
    .filter(r => isLatinGameName(r.name))
    .map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      mainCategory: r.mainCategory as CasinoMainCategory,
      features: r.features,
    }))
}

/** Keyword rules: keyword (lowercase) -> category slug within that main. Order matters for multi-match; first match wins per slug. */
const LIVE_CASINO_KEYWORDS: Array<{ keywords: string[]; slug: string }> = [
  { keywords: ['roulette'], slug: 'live-roulette' },
  { keywords: ['blackjack', 'black jack'], slug: 'live-blackjack' },
  { keywords: ['baccarat'], slug: 'live-baccarat' },
  { keywords: ['teen patti', 'teenpatti', 'andhar bahar', 'andar bahar', 'andher bahar'], slug: 'live-teen-patti' },
  { keywords: ['game show', 'gameshow', 'dream catcher', 'crazy time', 'monopoly live'], slug: 'live-game-shows' },
]
const CASINO_KEYWORDS: Array<{ keywords: string[]; slug: string }> = [
  { keywords: ['teen patti', 'teenpatti', 'andar bahar', 'andhar bahar', 'rummy', 'rummi', 'indian', 'andher'], slug: 'indian-games' },
  { keywords: ['blackjack', 'black jack'], slug: 'blackjack' },
  { keywords: ['roulette'], slug: 'roulette' },
  { keywords: ['baccarat'], slug: 'baccarat' },
  { keywords: ['poker', 'caribbean'], slug: 'poker' },
]
const SLOTS_KEYWORDS: Array<{ keywords: string[]; slug: string }> = [
  { keywords: ['classic', 'fruit', '3 reel', '3reel'], slug: 'classic-slots' },
  { keywords: ['jackpot', 'megajackpot', 'progressive'], slug: 'jackpot-slots' },
  { keywords: ['megaways', 'megaway'], slug: 'megaways-slots' },
]

const FALLBACK_SLUG_BY_MAIN: Record<CasinoMainCategory, string> = {
  live_casino: 'live-game-shows',
  casino: 'table-games',
  slots: 'video-slots',
}

/**
 * Hybrid mapper: provider/features first, then keyword match on name/slug.
 * Returns one or more category slugs (from HARDCODED_CASINO_CATEGORY_TEMPLATE) for the game's main category.
 */
export function getCategorySlugsForGame(
  mainCategory: CasinoMainCategory,
  name: string,
  slug: string,
  features: unknown
): string[] {
  const text = `${(name || '').toLowerCase()} ${(slug || '').toLowerCase()}`
  const keywordList =
    mainCategory === 'live_casino'
      ? LIVE_CASINO_KEYWORDS
      : mainCategory === 'casino'
        ? CASINO_KEYWORDS
        : SLOTS_KEYWORDS

  const slugs = new Set<string>()
  if (features != null && typeof features === 'object' && 'gameType' in features) {
    const raw = String((features as { gameType?: string }).gameType || '').toLowerCase()
    for (const { keywords, slug: s } of keywordList) {
      if (keywords.some(k => raw.includes(k))) slugs.add(s)
    }
  }
  if (features != null && typeof features === 'object' && 'category' in features) {
    const raw = String((features as { category?: string }).category || '').toLowerCase()
    for (const { keywords, slug: s } of keywordList) {
      if (keywords.some(k => raw.includes(k))) slugs.add(s)
    }
  }
  for (const { keywords, slug: s } of keywordList) {
    if (keywords.some(k => text.includes(k))) slugs.add(s)
  }
  if (slugs.size === 0) {
    slugs.add(FALLBACK_SLUG_BY_MAIN[mainCategory])
  }
  return [...slugs]
}

/** Home lounge games are selected by the admin, separately for each catalog scope. */
/** Default category template for Gap Casino (same slugs as GMAG for merged behaviour when both enabled). */
export const GAP_DEFAULT_CASINO_CATEGORIES: Array<{
  mainCategory: CasinoMainCategory
  name: string
  slug: string
  order: number
  type?: CasinoCategoryDbType
}> = [
  { mainCategory: 'live_casino', name: 'Live Roulette', slug: 'live-roulette', order: 1, type: 'general' },
  { mainCategory: 'live_casino', name: 'Live Blackjack', slug: 'live-blackjack', order: 2, type: 'general' },
  { mainCategory: 'live_casino', name: 'Live Baccarat', slug: 'live-baccarat', order: 3, type: 'general' },
  { mainCategory: 'live_casino', name: 'Live Game Shows', slug: 'live-game-shows', order: 4, type: 'general' },
  { mainCategory: 'live_casino', name: 'Live Teen Patti', slug: 'live-teen-patti', order: 5, type: 'general' },
  { mainCategory: 'casino', name: 'Indian Games', slug: 'indian-games', order: 1, type: 'general' },
  { mainCategory: 'casino', name: 'Blackjack', slug: 'blackjack', order: 2, type: 'general' },
  { mainCategory: 'casino', name: 'Roulette', slug: 'roulette', order: 3, type: 'general' },
  { mainCategory: 'casino', name: 'Baccarat', slug: 'baccarat', order: 4, type: 'general' },
  { mainCategory: 'casino', name: 'Poker', slug: 'poker', order: 5, type: 'general' },
  { mainCategory: 'casino', name: 'Table Games', slug: 'table-games', order: 6, type: 'general' },
  { mainCategory: 'slots', name: 'Classic Slots', slug: 'classic-slots', order: 1, type: 'general' },
  { mainCategory: 'slots', name: 'Video Slots', slug: 'video-slots', order: 2, type: 'general' },
  { mainCategory: 'slots', name: 'Jackpot Slots', slug: 'jackpot-slots', order: 3, type: 'general' },
  { mainCategory: 'slots', name: 'Megaways Slots', slug: 'megaways-slots', order: 4, type: 'general' },
  ...CASINO_LOUNGE_DEFAULT_CATEGORIES,
]

/** Default category template for GMAG Casino (same slugs as Gap for merged behaviour when both enabled). */
export const GMAG_DEFAULT_CASINO_CATEGORIES: Array<{
  mainCategory: CasinoMainCategory
  name: string
  slug: string
  order: number
  type?: CasinoCategoryDbType
}> = [
  { mainCategory: 'live_casino', name: 'Live Roulette', slug: 'live-roulette', order: 1, type: 'general' },
  { mainCategory: 'live_casino', name: 'Live Blackjack', slug: 'live-blackjack', order: 2, type: 'general' },
  { mainCategory: 'live_casino', name: 'Live Baccarat', slug: 'live-baccarat', order: 3, type: 'general' },
  { mainCategory: 'live_casino', name: 'Live Game Shows', slug: 'live-game-shows', order: 4, type: 'general' },
  { mainCategory: 'live_casino', name: 'Live Teen Patti', slug: 'live-teen-patti', order: 5, type: 'general' },
  { mainCategory: 'casino', name: 'Indian Games', slug: 'indian-games', order: 1, type: 'general' },
  { mainCategory: 'casino', name: 'Blackjack', slug: 'blackjack', order: 2, type: 'general' },
  { mainCategory: 'casino', name: 'Roulette', slug: 'roulette', order: 3, type: 'general' },
  { mainCategory: 'casino', name: 'Baccarat', slug: 'baccarat', order: 4, type: 'general' },
  { mainCategory: 'casino', name: 'Poker', slug: 'poker', order: 5, type: 'general' },
  { mainCategory: 'casino', name: 'Table Games', slug: 'table-games', order: 6, type: 'general' },
  { mainCategory: 'slots', name: 'Classic Slots', slug: 'classic-slots', order: 1, type: 'general' },
  { mainCategory: 'slots', name: 'Video Slots', slug: 'video-slots', order: 2, type: 'general' },
  { mainCategory: 'slots', name: 'Jackpot Slots', slug: 'jackpot-slots', order: 3, type: 'general' },
  { mainCategory: 'slots', name: 'Megaways Slots', slug: 'megaways-slots', order: 4, type: 'general' },
  ...CASINO_LOUNGE_DEFAULT_CATEGORIES,
]

/** Hardcoded multi-category template when default tenant has no categories. Used for new and backfilled whitelabels. */
export const HARDCODED_CASINO_CATEGORY_TEMPLATE = GAP_DEFAULT_CASINO_CATEGORIES

export type ProvisionDefaultCasinoCategoriesResult = {
  categoriesCreated: number
  gamesAssigned: number
  nonLatinDisabled: number
}

/**
 * Clones default tenant's casino categories to the target tenant and assigns eligible (Latin-name, active) games.
 * Idempotent: skips categories that already exist (by slug per main), uses onConflictDoNothing for assignments.
 * Also disables whitelabel_casino_game_settings for games with non-Latin names and removes them from category links.
 */
export async function provisionDefaultCasinoCategoriesForTenant(
  targetTenant: string
): Promise<ProvisionDefaultCasinoCategoriesResult> {
  const result: ProvisionDefaultCasinoCategoriesResult = {
    categoriesCreated: 0,
    gamesAssigned: 0,
    nonLatinDisabled: 0,
  }

  const mainCategories: CasinoMainCategory[] = ['live_casino', 'casino', 'slots']

  // 1) Template categories from default tenant
  const templateCategories: Array<{
    mainCategory: CasinoMainCategory
    type: CasinoCategoryDbType
    subtitle: string | null
    name: string
    slug: string
    iconData: string | null
    order: number | null
    isActive: boolean
  }> = []
  for (const main of mainCategories) {
    const list = await listCasinoCategoriesDb('default', main)
    for (const c of list) {
      templateCategories.push({
        mainCategory: c.mainCategory as CasinoMainCategory,
        type: (c.type as CasinoCategoryDbType) ?? 'general',
        subtitle: c.subtitle ?? null,
        name: c.name,
        slug: c.slug,
        iconData: c.iconData ?? null,
        order: c.order ?? null,
        isActive: c.isActive ?? true,
      })
    }
  }

  // 2) Target tenant existing categories (by main + slug) – build before fallback so fallback is idempotent
  const targetSlugSet = new Set<string>()
  for (const main of mainCategories) {
    const list = await listCasinoCategoriesDb(targetTenant, main)
    for (const c of list) {
      targetSlugSet.add(`${c.mainCategory}:${c.slug}`)
    }
  }

  const useFallbackCategories = !templateCategories.some(category => category.type !== 'lounge')
  if (useFallbackCategories) {
    for (const spec of HARDCODED_CASINO_CATEGORY_TEMPLATE) {
      const key = `${spec.mainCategory}:${spec.slug}`
      if (targetSlugSet.has(key)) continue
      await createCasinoCategoryDb(targetTenant, {
        mainCategory: spec.mainCategory,
        name: spec.name,
        slug: spec.slug,
        order: spec.order,
        type: spec.type,
      })
      result.categoriesCreated++
      targetSlugSet.add(key)
    }
  }

  // 3) Create missing categories for target tenant (skip when we used fallback)
  if (!useFallbackCategories) {
  for (const t of templateCategories) {
    const key = `${t.mainCategory}:${t.slug}`
    if (targetSlugSet.has(key)) continue
    await createCasinoCategoryDb(targetTenant, {
      mainCategory: t.mainCategory,
      type: t.type,
      subtitle: t.subtitle,
      name: t.name,
      slug: t.slug,
      iconData: t.iconData,
      isActive: t.isActive,
      order: t.order,
    })
    result.categoriesCreated++
    targetSlugSet.add(key)
  }
  }

  // Older default templates may not have the home lounge yet. Keep its games empty
  // until an admin explicitly assigns them through Casino Categories.
  for (const spec of CASINO_LOUNGE_DEFAULT_CATEGORIES) {
    const key = `${spec.mainCategory}:${spec.slug}`
    if (targetSlugSet.has(key)) continue
    await createCasinoCategoryDb(targetTenant, spec)
    result.categoriesCreated++
    targetSlugSet.add(key)
  }

  // 4) Assign games to categories
  if (useFallbackCategories) {
    // Rule-based: hybrid mapper assigns each game to one or more category slugs within its main
    const categoryKeyToGameIds = new Map<string, number[]>()
    for (const main of mainCategories) {
      const games = await getEligibleGamesByMainCategoryDb(main)
      for (const g of games) {
        const slugs = getCategorySlugsForGame(g.mainCategory, g.name, g.slug, g.features)
        for (const slug of slugs) {
          const key = `${main}:${slug}`
          const list = categoryKeyToGameIds.get(key) ?? []
          list.push(g.id)
          categoryKeyToGameIds.set(key, list)
        }
      }
    }
    const targetCategories = await db
      .select({ id: casinoCategories.id, mainCategory: casinoCategories.mainCategory, slug: casinoCategories.slug, type: casinoCategories.type })
      .from(casinoCategories)
      .where(eq(casinoCategories.tenantId, targetTenant))
    for (const cat of targetCategories) {
      if (cat.type === 'lounge') continue
      const key = `${cat.mainCategory}:${cat.slug}`
      const gameIds = categoryKeyToGameIds.get(key) ?? []
      if (gameIds.length > 0) {
        const { inserted } = await assignGamesToCategoryDb(targetTenant, cat.id, gameIds)
        result.gamesAssigned += inserted
      }
    }
  } else {
    // Clone-from-default: assign all eligible games in main to every category in that main (legacy behavior)
    const eligibleByMain = new Map<CasinoMainCategory, number[]>()
    for (const main of mainCategories) {
      const ids = await getEligibleGameIdsByMainCategoryDb(main)
      eligibleByMain.set(main, ids)
    }
    for (const main of mainCategories) {
      const categories = await listCasinoCategoriesDb(targetTenant, main)
      const gameIds = eligibleByMain.get(main) ?? []
      for (const cat of categories) {
        if (cat.type === 'lounge') continue
        const { inserted } = await assignGamesToCategoryDb(targetTenant, cat.id, gameIds)
        result.gamesAssigned += inserted
      }
    }
  }

  // 6) Disable non-Latin games for this tenant and remove from category links
  const settingsRows = await db
    .select({
      gameId: whitelabelCasinoGameSettings.gameId,
      id: whitelabelCasinoGameSettings.id,
    })
    .from(whitelabelCasinoGameSettings)
    .where(eq(whitelabelCasinoGameSettings.tenantId, targetTenant))
  const gameIdsToCheck = [...new Set(settingsRows.map(r => r.gameId))]
  if (gameIdsToCheck.length > 0) {
    const gameRows = await db
      .select({ id: casinoGames.id, name: casinoGames.name })
      .from(casinoGames)
      .where(inArray(casinoGames.id, gameIdsToCheck))
    const nonLatinGameIds = gameRows.filter(r => !isLatinGameName(r.name)).map(r => r.id)
    if (nonLatinGameIds.length > 0) {
      await db
        .update(whitelabelCasinoGameSettings)
        .set({ enabled: false, updatedAt: sql`now()` })
        .where(
          and(
            eq(whitelabelCasinoGameSettings.tenantId, targetTenant),
            inArray(whitelabelCasinoGameSettings.gameId, nonLatinGameIds)
          )
        )
      result.nonLatinDisabled = nonLatinGameIds.length
      const targetCategoryIds = (
        await db
          .select({ id: casinoCategories.id })
          .from(casinoCategories)
          .where(eq(casinoCategories.tenantId, targetTenant))
      ).map(r => r.id)
      for (const categoryId of targetCategoryIds) {
        await removeGamesFromCategoryDb(targetTenant, categoryId, nonLatinGameIds)
      }
    }
  }

  return result
}

export type ProvisionFromProvidersResult = {
  categoriesCreated: number
  gamesAssigned: number
  nonLatinDisabled: number
}

/**
 * Provider-based category generation: delete existing categories, build merged template from
 * enabled providers (Gap/GMAG), create categories, assign games by rule-based mapping.
 * Replace mode: always deletes all categories for tenant first.
 */
export async function provisionCasinoCategoriesFromProvidersForTenant(
  tenantId: string
): Promise<ProvisionFromProvidersResult> {
  const result: ProvisionFromProvidersResult = {
    categoriesCreated: 0,
    gamesAssigned: 0,
    nonLatinDisabled: 0,
  }

  const enabledProviderIds = await getEnabledProviderIdsForTenantDb(tenantId)
  if (enabledProviderIds.length === 0) return result

  const providerRows = await db
    .select({ id: casinoApiProviders.id, key: casinoApiProviders.key })
    .from(casinoApiProviders)
    .where(inArray(casinoApiProviders.id, enabledProviderIds))

  const mergedByKey = new Map<string, { mainCategory: CasinoMainCategory; name: string; slug: string; order: number; type: CasinoCategoryDbType }>()
  for (const p of providerRows) {
    const keyLower = (p.key ?? '').toLowerCase()
    const template = keyLower === 'gapcasino' ? GAP_DEFAULT_CASINO_CATEGORIES : keyLower === 'gmagcasino' ? GMAG_DEFAULT_CASINO_CATEGORIES : null
    if (!template) continue
    for (const t of template) {
      const key = `${t.mainCategory}:${t.slug}`
      if (mergedByKey.has(key)) continue
      mergedByKey.set(key, {
        mainCategory: t.mainCategory,
        name: t.name,
        slug: t.slug,
        order: t.order,
        type: t.type ?? 'general',
      })
    }
  }

  const mergedCategories = [...mergedByKey.values()].sort(
    (a, b) => (a.mainCategory.localeCompare(b.mainCategory)) || (a.order - b.order)
  )
  if (mergedCategories.length === 0) return result

  await deleteAllCasinoCategoriesForTenant(tenantId)

  for (const spec of mergedCategories) {
    await createCasinoCategoryDb(tenantId, {
      mainCategory: spec.mainCategory,
      name: spec.name,
      slug: spec.slug,
      order: spec.order,
      type: spec.type,
    })
    result.categoriesCreated++
  }

  const games = await getEligibleGamesForTenantByProvidersDb(enabledProviderIds)
  const categoryKeyToGameIds = new Map<string, number[]>()
  for (const g of games) {
    const slugs = getCategorySlugsForGame(g.mainCategory, g.name, g.slug, g.features)
    for (const slug of slugs) {
      const key = `${g.mainCategory}:${slug}`
      const list = categoryKeyToGameIds.get(key) ?? []
      list.push(g.id)
      categoryKeyToGameIds.set(key, list)
    }
  }

  const targetCategories = await db
    .select({ id: casinoCategories.id, mainCategory: casinoCategories.mainCategory, slug: casinoCategories.slug, type: casinoCategories.type })
    .from(casinoCategories)
    .where(eq(casinoCategories.tenantId, tenantId))
  for (const cat of targetCategories) {
    if (cat.type === 'lounge') continue
    const key = `${cat.mainCategory}:${cat.slug}`
    const gameIds = categoryKeyToGameIds.get(key) ?? []
    if (gameIds.length > 0) {
      const { inserted } = await assignGamesToCategoryDb(tenantId, cat.id, gameIds)
      result.gamesAssigned += inserted
    }
  }

  const settingsRows = await db
    .select({ gameId: whitelabelCasinoGameSettings.gameId })
    .from(whitelabelCasinoGameSettings)
    .where(eq(whitelabelCasinoGameSettings.tenantId, tenantId))
  const gameIdsToCheck = [...new Set(settingsRows.map(r => r.gameId))]
  if (gameIdsToCheck.length > 0) {
    const gameRows = await db
      .select({ id: casinoGames.id, name: casinoGames.name })
      .from(casinoGames)
      .where(inArray(casinoGames.id, gameIdsToCheck))
    const nonLatinGameIds = gameRows.filter(r => !isLatinGameName(r.name)).map(r => r.id)
    if (nonLatinGameIds.length > 0) {
      await db
        .update(whitelabelCasinoGameSettings)
        .set({ enabled: false, updatedAt: sql`now()` })
        .where(
          and(
            eq(whitelabelCasinoGameSettings.tenantId, tenantId),
            inArray(whitelabelCasinoGameSettings.gameId, nonLatinGameIds)
          )
        )
      result.nonLatinDisabled = nonLatinGameIds.length
      const targetCategoryIds = (await db.select({ id: casinoCategories.id }).from(casinoCategories).where(eq(casinoCategories.tenantId, tenantId))).map(r => r.id)
      for (const categoryId of targetCategoryIds) {
        await removeGamesFromCategoryDb(tenantId, categoryId, nonLatinGameIds)
      }
    }
  }

  return result
}

export async function getCasinoGamesByIdsDb(
  tenant: string | undefined, 
  gameIds: number[],
  options?: { skipVendorFilter?: boolean }
) {
  if (!gameIds.length) return []
  
  const skipVendorFilter = options?.skipVendorFilter ?? false
  
  // CRITICAL: Skip tenant filtering if tenant is undefined (Director Admin core mode)
  // OR if skipVendorFilter is true (for bundle viewing - show all games regardless of vendor settings)
  let vendorFilter: any = null
  if (skipVendorFilter) {
    // Skip vendor filtering - show all games (useful for bundle viewing)
    vendorFilter = sql`true`
  } else if (tenant !== undefined) {
    // Vendor filter: only show games from vendors that are enabled for this tenant
    // Use COALESCE to default to true if no vendor setting exists (consistent with listCasinoGamesPagedDb)
    vendorFilter = sql`
      COALESCE(
        (SELECT vcs.enabled 
         FROM whitelabel_casino_vendor_settings vcs 
         WHERE vcs.vendor_id = casino_games.vendor_id
           AND vcs.tenant_id = ${tenant}
         LIMIT 1),
        true
      ) = true
    `
  } else {
    // Core mode: show all vendors (no tenant filtering)
    vendorFilter = sql`true`
  }

  const whereClauseConditions: any[] = [
    inArray(casinoGames.id, gameIds),
    eq(casinoGames.isActive, true), // Filter out platform-blocked games
    vendorFilter
  ]
  if (tenant !== undefined && !skipVendorFilter) {
    const providerEnabled = sql`COALESCE(
      (SELECT ${whitelabelCasinoProviderSettings.enabled}
       FROM ${whitelabelCasinoProviderSettings}
       WHERE ${whitelabelCasinoProviderSettings.tenantId} = ${tenant}
         AND ${whitelabelCasinoProviderSettings.providerId} = ${casinoGames.apiProviderId}
       LIMIT 1),
      true
    ) = true`
    const vendorNotDisabled = sql`NOT EXISTS (
      SELECT 1 FROM ${whitelabelCasinoVendorSuperAdminOverride}
      WHERE ${whitelabelCasinoVendorSuperAdminOverride.tenantId} = ${tenant}
        AND ${whitelabelCasinoVendorSuperAdminOverride.vendorId} = ${casinoGames.vendorId}
        AND ${whitelabelCasinoVendorSuperAdminOverride.disabled} = true
    )`
    const gameNotDisabled = sql`NOT EXISTS (
      SELECT 1 FROM ${whitelabelCasinoGameSuperAdminOverride}
      WHERE ${whitelabelCasinoGameSuperAdminOverride.tenantId} = ${tenant}
        AND ${whitelabelCasinoGameSuperAdminOverride.gameId} = ${casinoGames.id}
        AND ${whitelabelCasinoGameSuperAdminOverride.disabled} = true
    )`
    whereClauseConditions.push(providerEnabled, vendorNotDisabled, gameNotDisabled)
  }
  
  const rows = await db
    .select({
      id: casinoGames.id,
      name: casinoGames.name,
      slug: casinoGames.slug,
      mainCategory: casinoGames.mainCategory,
      vendorId: casinoGames.vendorId,
      vendorName: casinoVendors.name,
      thumbnailUrl: casinoGames.thumbnailUrl,
      rtp: casinoGames.rtp,
      demoUrl: casinoGames.demoUrl,
      isActive: casinoGames.isActive,
      tenantEnabled: whitelabelCasinoGameSettings.enabled,
      premiumOnly: whitelabelCasinoGameSettings.premiumOnly,
      order: whitelabelCasinoGameSettings.order,
      featured: whitelabelCasinoGameSettings.featured,
      limits: whitelabelCasinoGameSettings.limits,
      updatedAt: whitelabelCasinoGameSettings.updatedAt,
      categoryAssigned: sql<boolean>`EXISTS (
        SELECT 1 FROM "casino_category_games" cg
        WHERE cg."game_id" = ${casinoGames.id}
      )`,
    })
    .from(casinoGames)
    .innerJoin(casinoVendors, eq(casinoVendors.id, casinoGames.vendorId))
    // CRITICAL: Skip tenant-specific settings JOIN if tenant is undefined
    .leftJoin(whitelabelCasinoGameSettings, tenant !== undefined ? and(
      eq(whitelabelCasinoGameSettings.gameId, casinoGames.id),
      eq(whitelabelCasinoGameSettings.tenantId, tenant),
    ) : eq(whitelabelCasinoGameSettings.gameId, casinoGames.id))
    .where(and(...whereClauseConditions))
    .orderBy(whitelabelCasinoGameSettings.order)
  
  return rows
}

export async function getCategoriesForGameDb(tenant: string, gameId: number, mainCategory?: CasinoMainCategory) {
  const where: any[] = [eq(casinoCategories.tenantId, tenant), eq(casinoCategoryGames.gameId, gameId)]
  if (mainCategory) where.push(eq(casinoCategories.mainCategory, mainCategory as any))
  const rows = await db
    .select({
      id: casinoCategories.id,
      name: casinoCategories.name,
      slug: casinoCategories.slug,
      mainCategory: casinoCategories.mainCategory,
      type: casinoCategories.type,
      subtitle: casinoCategories.subtitle,
      iconData: casinoCategories.iconData,
      order: casinoCategories.order,
      isActive: casinoCategories.isActive,
    })
    .from(casinoCategoryGames)
    .innerJoin(casinoCategories, eq(casinoCategories.id, casinoCategoryGames.categoryId))
    .where(and(...where))
    .orderBy(casinoCategories.order)
  return rows
}

// =========== Casino Game Bet Settings ===========

type BetSettingRow = typeof casinoGameBetSettings.$inferSelect

type BetSettingEnriched = BetSettingRow & {
  playerName: string | null
  playerPhone: string | null
}

async function enrichBetSettingsWithPlayerNames(
  tenant: string,
  rows: BetSettingRow[]
): Promise<BetSettingEnriched[]> {
  const rawPids = rows
    .map((r) => r.playerId)
    .filter((id): id is string => id != null && id !== '')
  const numericIds = [
    ...new Set(
      rawPids
        .map((id) => Number(id))
        .filter((n) => Number.isInteger(n) && n > 0)
    ),
  ]
  const metaByPlayerId = new Map<
    string,
    { name: string; phone: string | null }
  >()
  if (numericIds.length > 0) {
    const userRows = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        phone: users.phone,
      })
      .from(users)
      .where(and(inArray(users.id, numericIds), eq(users.tenant, tenant)))
    for (const u of userRows) {
      const label =
        (u.name && u.name.trim()) ||
        (u.username && u.username.trim()) ||
        `User ${u.id}`
      metaByPlayerId.set(String(u.id), {
        name: label,
        phone: u.phone && u.phone.trim() ? u.phone.trim() : null,
      })
    }
  }
  return rows.map((r) => {
    const meta = r.playerId
      ? metaByPlayerId.get(String(r.playerId))
      : undefined
    return {
      ...r,
      playerName: meta?.name ?? null,
      playerPhone: meta?.phone ?? null,
    }
  })
}

export async function resolveCasinoBetSettingPlayerMetaDb(
  tenant: string,
  playerId: string | null
): Promise<{ name: string | null; phone: string | null }> {
  if (playerId == null || playerId === '') return { name: null, phone: null }
  const n = Number(playerId)
  if (!Number.isInteger(n) || n <= 0) return { name: null, phone: null }
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      phone: users.phone,
    })
    .from(users)
    .where(and(eq(users.id, n), eq(users.tenant, tenant)))
    .limit(1)
  if (!u) return { name: null, phone: null }
  const name =
    (u.name && u.name.trim()) ||
    (u.username && u.username.trim()) ||
    `User ${u.id}`
  const phone = u.phone && u.phone.trim() ? u.phone.trim() : null
  return { name, phone }
}

export async function getCasinoGameBetSettingsDb(tenant: string, gameId: number) {
  const rows = await db.select()
    .from(casinoGameBetSettings)
    .where(and(
      eq(casinoGameBetSettings.tenantId, tenant),
      eq(casinoGameBetSettings.gameId, gameId)
    ))
  return enrichBetSettingsWithPlayerNames(tenant, rows)
}

export async function getCasinoGameBetSettingByPlayerDb(tenant: string, gameId: number, playerId: string | null) {
  const where = [
    eq(casinoGameBetSettings.tenantId, tenant),
    eq(casinoGameBetSettings.gameId, gameId),
  ]
  if (playerId === null) {
    where.push(isNull(casinoGameBetSettings.playerId))
  } else {
    where.push(eq(casinoGameBetSettings.playerId, playerId))
  }
  const rows = await db.select()
    .from(casinoGameBetSettings)
    .where(and(...where))
    .limit(1)
  const row = rows[0] || null
  if (!row) return null
  const [enriched] = await enrichBetSettingsWithPlayerNames(tenant, [row])
  return enriched
}

export async function upsertCasinoGameBetSettingsDb(
  tenant: string,
  gameId: number,
  playerId: string | null,
  settings: {
    betEnabled: boolean
    minStake?: number | null
    maxStake?: number | null
    maxWin?: number | null
  }
) {
  const data = {
    tenantId: tenant,
    gameId,
    playerId,
    betEnabled: settings.betEnabled,
    minStake: settings.minStake != null ? String(settings.minStake) : null,
    maxStake: settings.maxStake != null ? String(settings.maxStake) : null,
    maxWin: settings.maxWin != null ? String(settings.maxWin) : null,
    updatedAt: new Date(),
  }
  // Special handling for ALL-players (playerId null): Postgres unique index with NULLs won't conflict-match.
  if (playerId === null) {
    // Try update first
    const updated = await db
      .update(casinoGameBetSettings)
      .set({
        betEnabled: data.betEnabled,
        minStake: data.minStake,
        maxStake: data.maxStake,
        maxWin: data.maxWin,
        updatedAt: data.updatedAt,
      })
      .where(and(
        eq(casinoGameBetSettings.tenantId, tenant),
        eq(casinoGameBetSettings.gameId, gameId),
        isNull(casinoGameBetSettings.playerId),
      ))
      .returning()

    if (updated.length > 0) return updated[0]

    // No existing row — insert fresh (unique partial index prevents duplicates)
    const inserted = await db
      .insert(casinoGameBetSettings)
      .values(data)
      .returning()
    return inserted[0]
  }

  // Player-specific: rely on composite unique constraint for upsert
  const result = await db.insert(casinoGameBetSettings)
    .values(data)
    .onConflictDoUpdate({
      target: [casinoGameBetSettings.tenantId, casinoGameBetSettings.gameId, casinoGameBetSettings.playerId],
      set: {
        betEnabled: data.betEnabled,
        minStake: data.minStake,
        maxStake: data.maxStake,
        maxWin: data.maxWin,
        updatedAt: data.updatedAt,
      },
    })
    .returning()

  return result[0]
}

export async function deleteCasinoGameBetSettingsDb(tenant: string, gameId: number, playerId: string | null) {
  const where = [
    eq(casinoGameBetSettings.tenantId, tenant),
    eq(casinoGameBetSettings.gameId, gameId),
  ]
  if (playerId === null) {
    where.push(isNull(casinoGameBetSettings.playerId))
  } else {
    where.push(eq(casinoGameBetSettings.playerId, playerId))
  }
  await db.delete(casinoGameBetSettings).where(and(...where))
}

// =========== Provider ↔ Vendor Shares ==========

export async function listProviderVendorSharesDb(tenant: string, providerId: number) {
  const rows = await db
    .select({
      vendorId: casinoProviderVendorShares.vendorId,
      sharePercentage: casinoProviderVendorShares.sharePercentage,
      updatedAt: casinoProviderVendorShares.updatedAt,
      vendorName: casinoVendors.name,
    })
    .from(casinoProviderVendorShares)
    .innerJoin(casinoVendors, eq(casinoVendors.id, casinoProviderVendorShares.vendorId))
    .where(and(
      eq(casinoProviderVendorShares.tenantId, tenant),
      eq(casinoProviderVendorShares.providerId, providerId),
    ))

  return rows.map((r) => ({
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    sharePercentage: r.sharePercentage != null ? Number(r.sharePercentage) : 0,
    updatedAt: r.updatedAt,
  }))
}

export async function upsertProviderVendorShareDb(
  tenant: string,
  providerId: number,
  vendorId: number,
  sharePercentage: number,
) {
  const values = {
    tenantId: tenant,
    providerId,
    vendorId,
    sharePercentage: String(sharePercentage),
    updatedAt: new Date(),
  } as any

  const res = await db
    .insert(casinoProviderVendorShares)
    .values(values)
    .onConflictDoUpdate({
      target: [
        casinoProviderVendorShares.tenantId,
        casinoProviderVendorShares.providerId,
        casinoProviderVendorShares.vendorId,
      ],
      set: {
        sharePercentage: values.sharePercentage,
        updatedAt: values.updatedAt,
      },
    })
    .returning({
      vendorId: casinoProviderVendorShares.vendorId,
      sharePercentage: casinoProviderVendorShares.sharePercentage,
      updatedAt: casinoProviderVendorShares.updatedAt,
    })

  const row = res[0]
  return row
    ? {
        vendorId: row.vendorId,
        sharePercentage: row.sharePercentage != null ? Number(row.sharePercentage) : 0,
        updatedAt: row.updatedAt,
      }
    : { vendorId, sharePercentage, updatedAt: new Date() }
}

/** Compact membership for candidate bundle game IDs, using the catalog's exact visibility predicates. */
export async function readCasinoSelectionIdsDb(args: CasinoGameReadArgs) {
  if (!args.includeGameIds?.length) return []
  const { countWhereConditions } = casinoGameReadConditions(args)
  return db.select({ id: casinoGames.id }).from(casinoGames).where(and(...countWhereConditions))
}

/** A visible selection page omits management-only settings/analytics projections. */
export async function listCasinoSelectionGamesDb(args: CasinoGameReadArgs) {
  const page = Math.max(1, args.page || 1), pageSize = Math.min(100, Math.max(1, args.pageSize || 20))
  const { countWhereConditions } = casinoGameReadConditions({ ...args, selectionMode: true })
  const [counts, items] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(casinoGames).where(and(...countWhereConditions)),
    db.select({ id: casinoGames.id, name: casinoGames.name, slug: casinoGames.slug, mainCategory: casinoGames.mainCategory,
      vendorId: casinoGames.vendorId, vendorName: casinoVendors.name, thumbnailUrl: casinoGames.thumbnailUrl })
      .from(casinoGames).innerJoin(casinoVendors, eq(casinoVendors.id, casinoGames.vendorId))
      .leftJoin(whitelabelCasinoGameSettings, args.tenant === undefined ? sql`false` : and(eq(whitelabelCasinoGameSettings.gameId, casinoGames.id), eq(whitelabelCasinoGameSettings.tenantId, args.tenant)))
      .where(and(...countWhereConditions))
      .orderBy(sql`CASE ${casinoGames.mainCategory} WHEN 'slots' THEN 0 WHEN 'casino' THEN 1 ELSE 2 END`, whitelabelCasinoGameSettings.order, casinoGames.id)
      .limit(pageSize).offset((page - 1) * pageSize),
  ])
  return { total: Number(counts[0]?.total ?? 0), page, pageSize, items }
}
