import { db } from '@src/db/client.js'
import { and, eq, or, isNull, isNotNull } from 'drizzle-orm'
import { sportsAutoResultsTable } from '@shared/db/schema.js'
import { sportsTable } from '@shared/db/schema.js'
import { sportsLeaguesTable, sportsEventsTable } from '@shared/db/schema.js'

export interface SportsAutoResultsSettingsCreateInput {
  sportId?: string
  leagueId?: string
  eventId?: string
  exchangeEnabled: boolean
  bookmakerEnabled: boolean
  fancyEnabled: boolean
}

export interface SportsAutoResultsSettingsListFilter {
  tenant?: string
  whitelabelId?: string
  sportId?: string
  leagueId?: string
  eventId?: string
  enabled?: boolean
}

export interface SportsAutoResultsSettingsContext {
  tenant: string
  whitelabelId: string
  actorId: string
}

/**
 * Build context from GraphQL context
 */
export function buildSportsAutoResultsContext(ctx: any): SportsAutoResultsSettingsContext {
  const tenant = ctx?.tenant ?? 'default'
  const whitelabelId = ctx?.whitelabel?.id ?? 'default'
  const actorId = ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'
  return {
    tenant,
    whitelabelId,
    actorId: String(actorId),
  }
}

/**
 * Get settings by ID
 */
export async function getSportsAutoResultsSettingsById(
  id: string,
  tenant = 'default',
  whitelabelId = 'default'
) {
  const rows = await db.select().from(sportsAutoResultsTable)
    .where(
      and(
        eq(sportsAutoResultsTable.id, id),
        eq(sportsAutoResultsTable.tenant, tenant),
        eq(sportsAutoResultsTable.whitelabelId, whitelabelId)
      )
    )
    .limit(1)
  return rows[0] || null
}

/**
 * List settings with filters
 */
export async function getSportsAutoResultsSettings(filter: SportsAutoResultsSettingsListFilter = {}) {
  const tenant = filter.tenant ?? 'default'
  const whitelabelId = filter.whitelabelId ?? 'default'

  const conditions: any[] = [
    eq(sportsAutoResultsTable.tenant, tenant),
    eq(sportsAutoResultsTable.whitelabelId, whitelabelId)
  ]

  if (filter.sportId) {
    conditions.push(eq(sportsAutoResultsTable.sportId, filter.sportId))
  }

  if (filter.leagueId) {
    conditions.push(eq(sportsAutoResultsTable.leagueId, filter.leagueId))
  }

  if (filter.eventId) {
    conditions.push(eq(sportsAutoResultsTable.eventId, filter.eventId))
  }

  if (typeof filter.enabled === 'boolean') {
    conditions.push(eq(sportsAutoResultsTable.enabled, filter.enabled))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const items = await db.select({
    id: sportsAutoResultsTable.id,
    tenant: sportsAutoResultsTable.tenant,
    whitelabelId: sportsAutoResultsTable.whitelabelId,
    sportId: sportsAutoResultsTable.sportId,
    leagueId: sportsAutoResultsTable.leagueId,
    eventId: sportsAutoResultsTable.eventId,
    exchangeEnabled: sportsAutoResultsTable.exchangeEnabled,
    bookmakerEnabled: sportsAutoResultsTable.bookmakerEnabled,
    fancyEnabled: sportsAutoResultsTable.fancyEnabled,
    enabled: sportsAutoResultsTable.enabled,
    autoDeclareEnabled: sportsAutoResultsTable.autoDeclareEnabled,
    rules: sportsAutoResultsTable.rules,
    notifyOnAutoDeclare: sportsAutoResultsTable.notifyOnAutoDeclare,
    notifyChannels: sportsAutoResultsTable.notifyChannels,
    createdBy: sportsAutoResultsTable.createdBy,
    updatedBy: sportsAutoResultsTable.updatedBy,
    createdAt: sportsAutoResultsTable.createdAt,
    updatedAt: sportsAutoResultsTable.updatedAt,
  })
    .from(sportsAutoResultsTable)
    .where(whereClause)
    .orderBy(sportsAutoResultsTable.createdAt)

  return items.map(item => ({
    ...item,
    rules: item.rules ? JSON.stringify(item.rules) : null,
    notifyChannels: (item.notifyChannels as unknown as string[]) || [],
  }))
}

/**
 * Upsert settings (create or update)
 */
export async function upsertSportsAutoResultsSettings(
  input: SportsAutoResultsSettingsCreateInput,
  ctx: SportsAutoResultsSettingsContext
) {
  const { sportId, leagueId, eventId, exchangeEnabled, bookmakerEnabled, fancyEnabled } = input
  const { tenant, whitelabelId, actorId } = ctx

  // Validate: at least one scope must be provided
  if (!sportId && !leagueId && !eventId) {
    throw new Error('At least one scope (sportId, leagueId, or eventId) must be provided')
  }

  // Validate: at least one market type must be enabled
  if (!exchangeEnabled && !bookmakerEnabled && !fancyEnabled) {
    throw new Error('At least one market type (Exchange, Bookmaker, or Fancy) must be enabled')
  }

  // Check for existing settings with same scope (one record per scope, not per market type)
  const scopeConditions: any[] = [
    eq(sportsAutoResultsTable.tenant, tenant),
    eq(sportsAutoResultsTable.whitelabelId, whitelabelId)
  ]

  if (sportId) {
    scopeConditions.push(eq(sportsAutoResultsTable.sportId, sportId))
  } else {
    scopeConditions.push(isNull(sportsAutoResultsTable.sportId))
  }

  if (leagueId) {
    scopeConditions.push(eq(sportsAutoResultsTable.leagueId, leagueId))
  } else {
    scopeConditions.push(isNull(sportsAutoResultsTable.leagueId))
  }

  if (eventId) {
    scopeConditions.push(eq(sportsAutoResultsTable.eventId, eventId))
  } else {
    scopeConditions.push(isNull(sportsAutoResultsTable.eventId))
  }

  const existing = await db.select().from(sportsAutoResultsTable)
    .where(and(...scopeConditions))
    .limit(1)

  const now = new Date()

  if (existing.length > 0) {
    // Update existing
    const [updated] = await db.update(sportsAutoResultsTable)
      .set({
        exchangeEnabled,
        bookmakerEnabled,
        fancyEnabled,
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(eq(sportsAutoResultsTable.id, existing[0].id))
      .returning()

    return {
      id: updated.id,
      tenant: updated.tenant,
      whitelabelId: updated.whitelabelId,
      sportId: updated.sportId,
      leagueId: updated.leagueId,
      eventId: updated.eventId,
      exchangeEnabled: updated.exchangeEnabled,
      bookmakerEnabled: updated.bookmakerEnabled,
      fancyEnabled: updated.fancyEnabled,
      enabled: updated.enabled,
      autoDeclareEnabled: updated.autoDeclareEnabled,
      rules: updated.rules ? JSON.stringify(updated.rules) : null,
      notifyOnAutoDeclare: updated.notifyOnAutoDeclare,
      notifyChannels: (updated.notifyChannels as unknown as string[]) || [],
      createdBy: updated.createdBy,
      updatedBy: updated.updatedBy,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }
  } else {
    // Create new
    const [created] = await db.insert(sportsAutoResultsTable).values({
      tenant,
      whitelabelId,
      sportId: sportId || null,
      leagueId: leagueId || null,
      eventId: eventId || null,
      exchangeEnabled,
      bookmakerEnabled,
      fancyEnabled,
      enabled: false, // Default value
      autoDeclareEnabled: false, // Default value
      rules: null, // Default value
      notifyOnAutoDeclare: false, // Default value
      notifyChannels: [] as any, // Default value
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    }).returning()

    return {
      id: created.id,
      tenant: created.tenant,
      whitelabelId: created.whitelabelId,
      sportId: created.sportId,
      leagueId: created.leagueId,
      eventId: created.eventId,
      exchangeEnabled: created.exchangeEnabled,
      bookmakerEnabled: created.bookmakerEnabled,
      fancyEnabled: created.fancyEnabled,
      enabled: created.enabled,
      autoDeclareEnabled: created.autoDeclareEnabled,
      rules: created.rules ? JSON.stringify(created.rules) : null,
      notifyOnAutoDeclare: created.notifyOnAutoDeclare,
      notifyChannels: (created.notifyChannels as unknown as string[]) || [],
      createdBy: created.createdBy,
      updatedBy: created.updatedBy,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    }
  }
}

/**
 * Toggle individual market type for a setting
 */
export async function toggleAutoResultMarketType(
  id: string,
  marketType: 'exchange' | 'bookmaker' | 'fancy',
  enabled: boolean,
  ctx: SportsAutoResultsSettingsContext
) {
  const { tenant, whitelabelId, actorId } = ctx

  const setting = await getSportsAutoResultsSettingsById(id, tenant, whitelabelId)
  if (!setting) {
    throw new Error('Settings not found')
  }

  const updateData: any = {
    updatedBy: actorId,
    updatedAt: new Date(),
  }

  if (marketType === 'exchange') {
    updateData.exchangeEnabled = enabled
  } else if (marketType === 'bookmaker') {
    updateData.bookmakerEnabled = enabled
  } else if (marketType === 'fancy') {
    updateData.fancyEnabled = enabled
  }

  const [updated] = await db.update(sportsAutoResultsTable)
    .set(updateData)
    .where(
      and(
        eq(sportsAutoResultsTable.id, id),
        eq(sportsAutoResultsTable.tenant, tenant),
        eq(sportsAutoResultsTable.whitelabelId, whitelabelId)
      )
    )
    .returning()

  return {
    id: updated.id,
    tenant: updated.tenant,
    whitelabelId: updated.whitelabelId,
    sportId: updated.sportId,
    leagueId: updated.leagueId,
    eventId: updated.eventId,
    exchangeEnabled: updated.exchangeEnabled,
    bookmakerEnabled: updated.bookmakerEnabled,
    fancyEnabled: updated.fancyEnabled,
    enabled: updated.enabled,
    autoDeclareEnabled: updated.autoDeclareEnabled,
    rules: updated.rules ? JSON.stringify(updated.rules) : null,
    notifyOnAutoDeclare: updated.notifyOnAutoDeclare,
    notifyChannels: (updated.notifyChannels as unknown as string[]) || [],
    createdBy: updated.createdBy,
    updatedBy: updated.updatedBy,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
}

/**
 * Delete settings
 */
export async function deleteSportsAutoResultsSettings(
  id: string,
  tenant = 'default',
  whitelabelId = 'default'
) {
  const result = await getSportsAutoResultsSettingsById(id, tenant, whitelabelId)
  if (!result) {
    throw new Error('Settings not found')
  }

  await db.delete(sportsAutoResultsTable)
    .where(
      and(
        eq(sportsAutoResultsTable.id, id),
        eq(sportsAutoResultsTable.tenant, tenant),
        eq(sportsAutoResultsTable.whitelabelId, whitelabelId)
      )
    )

  return { id }
}

