import { eq, and, ilike, desc } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { casinoGameBundles } from '@shared/db/schema.js'

export interface CasinoGameBundle {
  id: number
  tenant: string
  name: string
  description: string | null
  domain: string
  gameIds: string[]
  gameWeights: Record<string, number> | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateCasinoGameBundleInput {
  tenant: string
  name: string
  description?: string | null
  domain: string
  gameIds: string[]
  gameWeights?: Record<string, number>
  createdBy?: string | null
}

export interface UpdateCasinoGameBundleInput {
  name?: string
  description?: string | null
  domain?: string
  gameIds?: string[]
  gameWeights?: Record<string, number>
}

export interface CasinoGameBundleFilters {
  search?: string
  domain?: string
}

export async function listCasinoGameBundlesDb(
  tenant: string,
  filters?: CasinoGameBundleFilters
): Promise<CasinoGameBundle[]> {
  const conditions = [eq(casinoGameBundles.tenant, tenant)]

  if (filters?.search) {
    conditions.push(ilike(casinoGameBundles.name, `%${filters.search}%`))
  }

  if (filters?.domain) {
    conditions.push(eq(casinoGameBundles.domain, filters.domain))
  }

  const rows = await db
    .select()
    .from(casinoGameBundles)
    .where(and(...conditions))
    .orderBy(desc(casinoGameBundles.createdAt))

  return rows.map((row) => ({
    id: row.id,
    tenant: row.tenant,
    name: row.name,
    description: row.description,
    domain: row.domain || 'casino',
    gameIds: (row.gameIds as any) || [],
    gameWeights: (row.gameWeights as Record<string, number>) || null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export async function getCasinoGameBundleDb(
  id: number,
  tenant: string
): Promise<CasinoGameBundle | null> {
  const [row] = await db
    .select()
    .from(casinoGameBundles)
    .where(and(eq(casinoGameBundles.id, id), eq(casinoGameBundles.tenant, tenant)))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    tenant: row.tenant,
    name: row.name,
    description: row.description,
    domain: row.domain || 'casino',
    gameIds: (row.gameIds as any) || [],
    gameWeights: (row.gameWeights as Record<string, number>) || null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function createCasinoGameBundleDb(
  input: CreateCasinoGameBundleInput
): Promise<CasinoGameBundle> {
  const [row] = await db
    .insert(casinoGameBundles)
    .values({
      tenant: input.tenant,
      name: input.name,
      description: input.description || null,
      domain: input.domain,
      gameIds: input.gameIds as any,
      gameWeights: input.gameWeights || null,
      createdBy: input.createdBy || null,
    })
    .returning()

  return {
    id: row.id,
    tenant: row.tenant,
    name: row.name,
    description: row.description,
    domain: row.domain || 'casino',
    gameIds: (row.gameIds as any) || [],
    gameWeights: (row.gameWeights as Record<string, number>) || null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function updateCasinoGameBundleDb(
  id: number,
  tenant: string,
  input: UpdateCasinoGameBundleInput
): Promise<CasinoGameBundle | null> {
  const existing = await getCasinoGameBundleDb(id, tenant)
  if (!existing) return null

  const updateData: any = {
    updatedAt: new Date(),
  }

  if (input.name !== undefined) updateData.name = input.name
  if (input.description !== undefined) updateData.description = input.description || null
  if (input.domain !== undefined) updateData.domain = input.domain
  if (input.gameIds !== undefined) updateData.gameIds = input.gameIds as any
  if (input.gameWeights !== undefined) {
    updateData.gameWeights = input.gameWeights === null ? null : (input.gameWeights as any)
  }

  await db
    .update(casinoGameBundles)
    .set(updateData)
    .where(and(eq(casinoGameBundles.id, id), eq(casinoGameBundles.tenant, tenant)))

  return getCasinoGameBundleDb(id, tenant)
}

export async function deleteCasinoGameBundleDb(
  id: number,
  tenant: string
): Promise<boolean> {
  const existing = await getCasinoGameBundleDb(id, tenant)
  if (!existing) return false

  await db
    .delete(casinoGameBundles)
    .where(and(eq(casinoGameBundles.id, id), eq(casinoGameBundles.tenant, tenant)))

  return true
}
