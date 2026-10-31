import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { casinoGames, casinoVendors, casinoApiProviders, casinoGameBetSettings } from '@shared/db/schema.js'

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
}

export async function getCasinoBetSettings(
  tenantId: string,
  gameId: number,
  playerId: string | null,
  executor: Executor = db
): Promise<CasinoBetSettingsRow | null> {
  const conditions = [eq(casinoGameBetSettings.tenantId, tenantId), eq(casinoGameBetSettings.gameId, gameId)]
  if (playerId != null) {
    const playerRow = await executor
      .select({ minStake: casinoGameBetSettings.minStake, maxStake: casinoGameBetSettings.maxStake })
      .from(casinoGameBetSettings)
      .where(and(...conditions, eq(casinoGameBetSettings.playerId, playerId)))
      .limit(1)
    if (playerRow[0]) {
      const r = playerRow[0]
      return { minStake: r.minStake != null ? Number(r.minStake) : null, maxStake: r.maxStake != null ? Number(r.maxStake) : null }
    }
  }
  const rows = await executor
    .select({ minStake: casinoGameBetSettings.minStake, maxStake: casinoGameBetSettings.maxStake })
    .from(casinoGameBetSettings)
    .where(and(...conditions, isNull(casinoGameBetSettings.playerId)))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return null
  }
  return {
    minStake: row.minStake != null ? Number(row.minStake) : null,
    maxStake: row.maxStake != null ? Number(row.maxStake) : null,
  }
}
