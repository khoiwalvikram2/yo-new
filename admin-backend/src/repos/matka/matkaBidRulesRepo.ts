import { getMatkaDb } from './matkaRepo.js'
import { allowedBids, matkaKind, moneyMinor, normalizeBid } from '@shared/matka/rules.js'
import { db } from '@src/db/client.js'
import { and, desc, eq, like, sql } from 'drizzle-orm'
import { matkaBidRules } from '@shared/db/schema.js'
import { randomUUID } from 'crypto'

export interface MatkaBidRuleInput {
  matkaId: string
  matkaType: string
  marketName: string
  marketSession?: string | null
  bidType: string
  percentage: number
  includeAll: boolean
  includedPlayers?: { playerIds: string[] } | null
  minStake?: number | null
  maxStake?: number | null
  exposureCap?: number | null
  status?: 'active' | 'inactive'
  priority?: number
  notes?: string | null
}

export async function listMatkaBidRulesDb(params: { tenant: string; matkaId?: string; search?: string; page?: number; limit?: number }) {
  const page = Math.max(1, params.page ?? 1)
  const limit = Math.max(1, Math.min(100, params.limit ?? 20))
  const offset = (page - 1) * limit
  const wl = params.tenant
  const conditions = [eq(matkaBidRules.tenant, wl)] as any[]
  if (params.matkaId) conditions.push(eq(matkaBidRules.matkaId, params.matkaId))
  if (params.search && params.search.trim().length) {
    const q = `%${params.search.trim()}%`
    conditions.push(like(matkaBidRules.marketName, q))
  }
  const where = and(...conditions)
  const items = await db
    .select()
    .from(matkaBidRules)
    .where(where)
    .orderBy(desc(matkaBidRules.priority), desc(matkaBidRules.updatedAt), desc(matkaBidRules.id))
    .limit(limit)
    .offset(offset)
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(matkaBidRules)
    .where(where)
  return { items, total: Number(count || 0) }
}

async function validateRule(input: any, tenant: string) {
  const market = await getMatkaDb(input.matkaId, tenant)
  if (!market) throw new Error('Matka market not found')
  const kind = matkaKind(market.settings), bid = normalizeBid(input.bidType)
  if (!allowedBids(kind).includes(bid)) throw new Error('This bid type is unavailable for the market')
  if (!Number.isFinite(Number(input.percentage)) || Number(input.percentage) < 0 || Number(input.percentage) > 100) throw new Error('Bid percentage must be between 0 and 100')
  for (const key of ['minStake','maxStake','exposureCap']) if (input[key] != null && moneyMinor(input[key]) < 0n) throw new Error('Stake and exposure limits cannot be negative')
  if (input.minStake != null && input.maxStake != null && Number(input.maxStake) < Number(input.minStake)) throw new Error('Maximum stake must be at least the minimum')
  if (input.marketSession && !['open','close'].includes(input.marketSession.toLowerCase())) throw new Error('Invalid market session')
  return { ...input, matkaType: kind, marketName: market.name, bidType: bid }
}

export async function createMatkaBidRuleDb(input: MatkaBidRuleInput, actor: string, tenant: string) {
  input = await validateRule(input, tenant)
  const [row] = await db.insert(matkaBidRules).values({
    tenant,
    matkaId: input.matkaId,
    matkaType: input.matkaType,
    marketName: input.marketName,
    marketSession: input.marketSession ?? null,
    bidType: input.bidType,
    percentage: String(input.percentage),
    includeAll: input.includeAll,
    includedPlayers: input.includedPlayers as any,
    minStake: input.minStake != null ? String(input.minStake) : null,
    maxStake: input.maxStake != null ? String(input.maxStake) : null,
    exposureCap: input.exposureCap != null ? String(input.exposureCap) : null,
    status: (input.status ?? 'active') as any,
    priority: input.priority ?? 0,
    notes: input.notes ?? null,
    createdBy: actor,
    updatedBy: actor,
  }).returning()
  return row
}

export async function updateMatkaBidRuleDb(id: string, patch: Partial<MatkaBidRuleInput>, actor: string, tenant: string) {
  const [before] = await db.select().from(matkaBidRules).where(and(eq(matkaBidRules.id, id), eq(matkaBidRules.tenant, tenant))).limit(1)
  if (!before) throw new Error('Bid rule not found')
  await validateRule({ ...before, ...patch }, tenant)
  if (patch.bidType) patch = { ...patch, bidType: normalizeBid(patch.bidType) }
  const set: any = { updatedAt: new Date(), updatedBy: actor }
  if (patch.matkaType !== undefined) set.matkaType = patch.matkaType
  if (patch.marketName !== undefined) set.marketName = patch.marketName
  if (patch.marketSession !== undefined) set.marketSession = patch.marketSession
  if (patch.bidType !== undefined) set.bidType = patch.bidType
  if (patch.percentage !== undefined) set.percentage = String(patch.percentage)
  if (patch.includeAll !== undefined) set.includeAll = patch.includeAll
  if (patch.includedPlayers !== undefined) set.includedPlayers = patch.includedPlayers as any
  if (patch.minStake !== undefined) set.minStake = patch.minStake != null ? String(patch.minStake) : null
  if (patch.maxStake !== undefined) set.maxStake = patch.maxStake != null ? String(patch.maxStake) : null
  if (patch.exposureCap !== undefined) set.exposureCap = patch.exposureCap != null ? String(patch.exposureCap) : null
  if (patch.status !== undefined) set.status = patch.status as any
  if (patch.priority !== undefined) set.priority = patch.priority
  if (patch.notes !== undefined) set.notes = patch.notes
  const [row] = await db.update(matkaBidRules).set(set).where(and(eq(matkaBidRules.id, id), eq(matkaBidRules.tenant, tenant))).returning()
  return row
}

export async function deleteMatkaBidRuleDb(id: string, tenant: string) {
  await db.delete(matkaBidRules).where(and(eq(matkaBidRules.id, id), eq(matkaBidRules.tenant, tenant)))
  return true
}

// --------- Worli rules versioning helpers ---------

export async function getActiveRulesVersionDb(matkaId: string, tenant: string) {
  const rows = await db.select({ versionId: matkaBidRules.versionId, versionLabel: matkaBidRules.versionLabel, validFrom: matkaBidRules.validFrom, isActive: matkaBidRules.isActive })
    .from(matkaBidRules)
    .where(and(eq(matkaBidRules.tenant, tenant), eq(matkaBidRules.matkaId, matkaId), eq(matkaBidRules.isActive, true)))
    .orderBy(desc(matkaBidRules.validFrom))
    .limit(1)
  const v = rows[0]
  if (!v) return null
  return { versionId: v.versionId, label: v.versionLabel, isActive: v.isActive, createdAt: v.validFrom }
}

export interface RulesVersionEntry { betType: string; marketSession?: string | null; percentage: number; minStake?: number | null; maxStake?: number | null; exposureCap?: number | null }

export async function createRulesVersionDb(params: { matkaId: string; label: string; entries: RulesVersionEntry[]; validFrom?: Date | null; tenant: string }) {
  for (const entry of params.entries) await validateRule({ ...entry, matkaId: params.matkaId, bidType: entry.betType }, params.tenant)
  const versionId = randomUUID()
  const validFrom = params.validFrom ?? new Date()
  const values = params.entries.map(e => ({
    tenant: params.tenant,
    matkaId: params.matkaId,
    matkaType: 'worli',
    marketName: '',
    marketSession: e.marketSession ?? null,
    bidType: normalizeBid(e.betType),
    percentage: String(e.percentage),
    includeAll: true,
    includedPlayers: null as any,
    minStake: e.minStake != null ? String(e.minStake) : null,
    maxStake: e.maxStake != null ? String(e.maxStake) : null,
    exposureCap: e.exposureCap != null ? String(e.exposureCap) : null,
    status: 'active' as any,
    priority: 0,
    notes: null,
    versionId,
    versionLabel: params.label,
    isActive: false,
    validFrom,
    validTo: null,
    createdBy: 'system',
    updatedBy: 'system',
  }))
  await db.insert(matkaBidRules).values(values)
  return { versionId, label: params.label, createdAt: validFrom, isActive: false }
}

export async function activateRulesVersionDb(matkaId: string, versionId: string, tenant: string) {
  // deactivate previous
  await db.update(matkaBidRules).set({ isActive: false }).where(and(eq(matkaBidRules.tenant, tenant), eq(matkaBidRules.matkaId, matkaId)))
  // activate
  await db.update(matkaBidRules).set({ isActive: true }).where(and(eq(matkaBidRules.tenant, tenant), eq(matkaBidRules.matkaId, matkaId), eq(matkaBidRules.versionId, versionId)))
  const v = await getActiveRulesVersionDb(matkaId, tenant)
  return v
}

export async function getRulesByVersionDb(versionId: string, tenant: string) {
  return db.select().from(matkaBidRules).where(and(eq(matkaBidRules.tenant, tenant), eq(matkaBidRules.versionId, versionId)))
}

