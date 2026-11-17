import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  casinoGames,
  casinoVendors,
  casinoApiProviders,
  casinoGameBetSettings,
  casinoBets,
  whitelabelCasinoGameSettings,
  vipTierCasinoGames,
  vipTiersTable,
} from '@shared/db/schema.js'

type Executor = typeof db

export interface CasinoGameRow {
  id: number
  name: string
  externalId: string
  vendorId: number
  vendorName: string
  providerId: number | null
  tableId: string | null
}

export async function getCasinoGameById(gameId: number, executor: Executor = db): Promise<CasinoGameRow | null> {
  const rows = await executor
    .select({
      id: casinoGames.id,
      name: casinoGames.name,
      externalId: casinoGames.externalId,
      vendorId: casinoGames.vendorId,
      vendorName: casinoVendors.name,
      apiProviderId: casinoGames.apiProviderId,
      tableId: casinoGames.tableId,
    })
    .from(casinoGames)
    .innerJoin(casinoVendors, eq(casinoGames.vendorId, casinoVendors.id))
    .where(eq(casinoGames.id, gameId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    externalId: row.externalId,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    providerId: row.apiProviderId,
    tableId: row.tableId,
  }
}

export async function getCasinoGameByExternalId(
  externalId: string,
  executor: Executor = db
): Promise<CasinoGameRow | null> {
  const rows = await executor
    .select({
      id: casinoGames.id,
      name: casinoGames.name,
      externalId: casinoGames.externalId,
      vendorId: casinoGames.vendorId,
      vendorName: casinoVendors.name,
      apiProviderId: casinoGames.apiProviderId,
      tableId: casinoGames.tableId,
    })
    .from(casinoGames)
    .innerJoin(casinoVendors, eq(casinoGames.vendorId, casinoVendors.id))
    .where(eq(casinoGames.externalId, externalId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    externalId: row.externalId,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    providerId: row.apiProviderId,
    tableId: row.tableId,
  }
}

export async function getCasinoGameByExternalIdAndProviderKey(
  externalId: string,
  providerKey: string,
  executor: Executor = db
): Promise<CasinoGameRow | null> {
  const rows = await executor
    .select({
      id: casinoGames.id,
      name: casinoGames.name,
      externalId: casinoGames.externalId,
      vendorId: casinoGames.vendorId,
      vendorName: casinoVendors.name,
      apiProviderId: casinoGames.apiProviderId,
      tableId: casinoGames.tableId,
    })
    .from(casinoGames)
    .innerJoin(casinoVendors, eq(casinoGames.vendorId, casinoVendors.id))
    .innerJoin(casinoApiProviders, eq(casinoGames.apiProviderId, casinoApiProviders.id))
    .where(and(eq(casinoGames.externalId, externalId), eq(casinoApiProviders.key, providerKey)))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return null
  }
  return {
    id: row.id,
    name: row.name,
    externalId: row.externalId,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    providerId: row.apiProviderId,
    tableId: row.tableId,
  }
}

export interface CasinoBetSettingsRow {
  minStake: number | null
  maxStake: number | null
  /** False when an admin switched betting off on this game, for this player or for everyone. */
  betEnabled: boolean
  /** The most the player may win (net) on this game in one whitelabel day; null for no cap. */
  maxWin: number | null
}

const betSettingsColumns = {
  minStake: casinoGameBetSettings.minStake,
  maxStake: casinoGameBetSettings.maxStake,
  betEnabled: casinoGameBetSettings.betEnabled,
  maxWin: casinoGameBetSettings.maxWin,
}

function toBetSettingsRow(r: { minStake: string | null; maxStake: string | null; betEnabled: boolean | null; maxWin: string | null }): CasinoBetSettingsRow {
  return {
    minStake: r.minStake != null ? Number(r.minStake) : null,
    maxStake: r.maxStake != null ? Number(r.maxStake) : null,
    betEnabled: r.betEnabled !== false,
    maxWin: r.maxWin != null ? Number(r.maxWin) : null,
  }
}

/**
 * The bet rule that applies to a player on a game: the player's own row when there is one,
 * otherwise the all-players row. The whole row applies; the two are not merged.
 */
export async function getCasinoBetSettings(
  tenantId: string,
  gameId: number,
  playerId: string | null,
  executor: Executor = db
): Promise<CasinoBetSettingsRow | null> {
  const conditions = [eq(casinoGameBetSettings.tenantId, tenantId), eq(casinoGameBetSettings.gameId, gameId)]
  if (playerId != null) {
    const playerRow = await executor
      .select(betSettingsColumns)
      .from(casinoGameBetSettings)
      .where(and(...conditions, eq(casinoGameBetSettings.playerId, playerId)))
      .limit(1)
    if (playerRow[0]) return toBetSettingsRow(playerRow[0])
  }
  const rows = await executor
    .select(betSettingsColumns)
    .from(casinoGameBetSettings)
    .where(and(...conditions, isNull(casinoGameBetSettings.playerId)))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return null
  }
  return toBetSettingsRow(row)
}

export interface CasinoGameAccessRules {
  /** The whitelabel marked the game premium: VIP members only. */
  premiumOnly: boolean
  /** The whitelabel's own VIP tiers the game is restricted to; empty when every tier may play. */
  vipTierIds: string[]
}

/** The whitelabel's premium flag and VIP tier restriction for one game. */
export async function getCasinoGameAccessRules(
  tenantId: string,
  gameId: number,
  executor: Executor = db
): Promise<CasinoGameAccessRules> {
  const [setting] = await executor
    .select({ premiumOnly: whitelabelCasinoGameSettings.premiumOnly })
    .from(whitelabelCasinoGameSettings)
    .where(and(eq(whitelabelCasinoGameSettings.tenantId, tenantId), eq(whitelabelCasinoGameSettings.gameId, gameId)))
    .limit(1)
  // A tier belongs to one whitelabel, so another whitelabel's rows for the same game never apply here.
  const tiers = await executor
    .select({ tierId: vipTierCasinoGames.tierId })
    .from(vipTierCasinoGames)
    .innerJoin(vipTiersTable, eq(vipTiersTable.id, vipTierCasinoGames.tierId))
    .where(and(
      eq(vipTierCasinoGames.gameId, gameId),
      eq(vipTierCasinoGames.enabled, true),
      eq(vipTiersTable.tenant, tenantId),
    ))
  return { premiumOnly: setting?.premiumOnly === true, vipTierIds: tiers.map((t) => t.tierId) }
}

/**
 * The player's net result on one game since `since`: settled wins minus settled stakes,
 * so a day of losses never counts towards a win cap.
 */
export async function getCasinoNetWinSince(
  tenant: string,
  userId: number,
  gameId: number,
  since: Date,
  executor: Executor = db
): Promise<number> {
  const [row] = await executor
    .select({ net: sql<string>`COALESCE(SUM(${casinoBets.netAmount}::numeric), 0)` })
    .from(casinoBets)
    .where(and(
      eq(casinoBets.tenant, tenant),
      eq(casinoBets.userId, userId),
      eq(casinoBets.gameId, gameId),
      inArray(casinoBets.status, ['won', 'lost']),
      gte(casinoBets.createdAt, since),
    ))
  return Number(row?.net ?? 0)
}
