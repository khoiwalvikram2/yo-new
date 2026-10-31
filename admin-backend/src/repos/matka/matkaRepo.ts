import { matkaSchedule } from '@shared/matka/schedule.js'
import { validateMatkaConfiguration, validateMatkaRates } from '@shared/matka/config.js'
import { matkaKind } from '@shared/matka/rules.js'
import { lockMatkaMarket } from '@shared/matka/settlement.js'
import { db } from '@/db/client.js'
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { matkas, matkaBets, matkaWorliInstances, matkaRateVersions, matkaDefaultRates } from '@/db/schema.js'

export type MatkaStatus = 'active' | 'inactive' | 'suspend'

export interface MatkaFilters {
  query?: string
  status?: MatkaStatus
  timezone?: string
  page?: number
  limit?: number
  sort?: string
}

export interface MatkaCreateInput {
  name: string
  code: string
  description?: string
  timezone: string
  schedule: any
  limits: any
  visibility: any
  priority?: number
  settings: any
  status?: MatkaStatus
  createdBy?: string
  reason?: string
}

export interface MatkaUpdateInput {
  id: string
  name?: string
  description?: string
  timezone?: string
  schedule?: any
  limits?: any
  visibility?: any
  priority?: number
  settings?: any
  status?: MatkaStatus
  updatedBy?: string
  reason?: string
}

export interface RateEntry { betType: string; payoutMultiplier: number; minOdds?: number | null; maxOdds?: number | null }
export interface MatkaRateVersionInput {
  matkaId: string
  versionTag: string
  entries: RateEntry[]
  effectiveFrom: string
  effectiveTo?: string | null
  createdBy?: string
}

function buildWhere(filters: MatkaFilters, tenant: string | undefined = 'default') {
  const parts: any[] = [isNull(matkas.deletedAt)]
  // CRITICAL: Skip tenant filtering if tenant is undefined (Director Admin core mode)
  if (tenant !== undefined) {
    parts.push(eq(matkas.tenant, tenant))
  }
  if (filters.status) parts.push(eq(matkas.status, String(filters.status).toLowerCase() as any))
  if (filters.timezone) parts.push(eq(matkas.timezone, filters.timezone))
  if (filters.query) {
    const q = `%${filters.query}%`
    parts.push(or(ilike(matkas.name, q), ilike(matkas.code, q)))
  }
  return and(...parts)
}

export async function listMatkasDb(filters: MatkaFilters = {}, tenant: string | undefined = 'default', complete = false) {
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20))
  const offset = (page - 1) * limit
  const where = buildWhere(filters, tenant)
  const orderBy = (() => {
    // Always sort by status first: active → inactive → suspend
    const statusOrder = sql`CASE 
      WHEN ${matkas.status} = 'active' THEN 1 
      WHEN ${matkas.status} = 'inactive' THEN 2 
      WHEN ${matkas.status} = 'suspend' THEN 3 
      ELSE 4 
    END`
    
    const sort = String(filters.sort ?? 'priority:asc,updatedAt:desc')
    const parts = sort.split(',').map(s => s.trim())
    const orders: any[] = [asc(statusOrder)] // Status order first
    parts.forEach(p => {
      const [field, dir] = p.split(':')
      const d = (dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
      switch (field) {
        case 'priority': orders.push(d === 'desc' ? desc(matkas.priority) : asc(matkas.priority)); break
        case 'name': orders.push(d === 'desc' ? desc(matkas.name) : asc(matkas.name)); break
        case 'updatedAt': orders.push(d === 'desc' ? desc(matkas.updatedAt) : asc(matkas.updatedAt)); break
        default: break
      }
    })
    // If no explicit sort fields, add default priority and updatedAt
    if (orders.length === 1) {
      orders.push(asc(matkas.priority), desc(matkas.updatedAt))
    }
    orders.push(asc(matkas.id))
    return orders
  })()

  const query = db.select().from(matkas).where(where).orderBy(...orderBy).$dynamic()
  const [items, [{ count }]] = await Promise.all([
    complete ? query : query.limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(matkas).where(where),
  ])
  return { items, total: count }
}

export async function listActiveMatkasDb(tenant = 'default') {
  const rows = await db
    .select({
      id: matkas.id,
      timezone: matkas.timezone,
      schedule: matkas.schedule,
      settings: matkas.settings,
    })
    .from(matkas)
    .where(and(eq(matkas.tenant, tenant), eq(matkas.status, 'active' as any), isNull(matkas.deletedAt)))
  return rows
}

export async function getMatkaDb(id: string, tenant: string | undefined = 'default') {
  const conditions: any[] = [eq(matkas.id, id)]
  // CRITICAL: Skip tenant filtering if tenant is undefined (Director Admin core mode)
  if (tenant !== undefined) {
    conditions.push(eq(matkas.tenant, tenant))
  }
  const rows = await db.select().from(matkas).where(and(...conditions))
  return rows[0] || null
}

export async function getMatkasByIdsDb(ids: string[], tenant: string | undefined = 'default') {
  if (!ids || ids.length === 0) return []
  
  const conditions: any[] = [
    inArray(matkas.id, ids),
    isNull(matkas.deletedAt)
  ]
  // CRITICAL: Skip tenant filtering if tenant is undefined (Director Admin core mode)
  if (tenant !== undefined) {
    conditions.push(eq(matkas.tenant, tenant))
  }
  
  const rows = await db.select().from(matkas).where(and(...conditions))
  return rows
}

export async function createMatkaDb(input: MatkaCreateInput, tenant = 'default') {
  validateMatkaConfiguration(input)
  const now = new Date()
  const [created] = await db.insert(matkas).values({
    tenant,
    name: input.name,
    code: input.code,
    description: input.description ?? null,
    timezone: input.timezone,
    schedule: input.schedule as any,
    status: (input.status ?? 'inactive'),
    limits: input.limits as any,
    visibility: input.visibility as any,
    priority: input.priority ?? 0,
    settings: input.settings as any,
    // keep DB column if exists; default handled by DB
    createdBy: input.createdBy ?? null,
    updatedBy: input.createdBy ?? null,
    reason: input.reason ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }).returning()
  return created
}

export async function updateMatkaDb(input: MatkaUpdateInput, tenant = 'default') {
  return db.transaction(async (tx) => {
    const before = await lockMatkaMarket(tx, tenant, input.id)
    const next = { ...before, ...input }
    validateMatkaConfiguration(next)
    if (matkaKind(before.settings) !== matkaKind(next.settings) || before.timezone !== next.timezone || JSON.stringify(before.schedule) !== JSON.stringify(next.schedule)) {
      const [open] = await tx.select({ id: matkaBets.id }).from(matkaBets).where(and(eq(matkaBets.matkaId, input.id), eq(matkaBets.tenant, tenant), inArray(matkaBets.status, ['active', 'pending']))).limit(1)
      if (open) throw new Error('Settle or void pending bets before changing the market type or schedule')
    }
    const where = and(eq(matkas.id, input.id), eq(matkas.tenant, tenant))
    const now = new Date()
    const values: any = {
      updatedAt: now,
      updatedBy: input.updatedBy ?? null,
      reason: input.reason ?? null,
    }
    if (typeof input.name !== 'undefined') values.name = input.name
    if (typeof input.description !== 'undefined') values.description = input.description
    if (typeof input.timezone !== 'undefined') values.timezone = input.timezone
    if (typeof input.schedule !== 'undefined') values.schedule = input.schedule as any
    if (typeof input.limits !== 'undefined') values.limits = input.limits as any
    if (typeof input.visibility !== 'undefined') values.visibility = input.visibility as any
    if (typeof input.priority !== 'undefined') values.priority = input.priority
    if (typeof input.settings !== 'undefined') values.settings = input.settings as any
    if (typeof input.status !== 'undefined') values.status = input.status

    const rows = await tx.update(matkas).set(values).where(where).returning()
    if (!rows.length) throw new Error('Not found')
    const schedule = matkaSchedule(rows[0])
    const sessions = await tx.select().from(matkaWorliInstances).where(and(eq(matkaWorliInstances.marketId, input.id), eq(matkaWorliInstances.runDate, schedule.runDate))).for('update')
    for (const session of sessions) {
      if (session.resultPublishedAtUtc) continue
      const current = matkaSchedule(rows[0], new Date(), [session])[session.side === 'OPEN' ? 'open' : 'close']
      await tx.update(matkaWorliInstances).set({ scheduledOpenAtUtc: new Date(current.startsAt), scheduledLockAtUtc: new Date(current.lockAt), scheduledCloseAtUtc: new Date(current.resultAt),
        ...(!current.enabled ? { status: 'CLOSED' as const } : {}), updatedAt: now }).where(eq(matkaWorliInstances.id, session.id))
    }
    return rows[0]
  })
}

export async function softDeleteMatkaDb(id: string, reason: string, tenant = 'default') {
  const now = new Date()
  const rows = await db.update(matkas)
    .set({ deletedAt: now, reason, updatedAt: now })
    .where(and(eq(matkas.id, id), eq(matkas.tenant, tenant), isNull(matkas.deletedAt)))
    .returning()
  if (!rows.length) throw new Error('Not found')
  return true
}

export async function reorderMatkasDb(order: Array<{ id: string; priority: number }>, tenant = 'default') {
  if (!order.length) return true
  // simple loop updates; DB transaction if needed
  for (const { id, priority } of order) {
    await db.update(matkas).set({ priority }).where(and(eq(matkas.id, id), eq(matkas.tenant, tenant)))
  }
  return true
}

export async function cloneMatkaDb(id: string, { name, code, actor }: { name: string; code: string; actor?: string }, tenant = 'default') {
  const src = await getMatkaDb(id, tenant)
  if (!src) throw new Error('Not found')
  const created = await createMatkaDb({
    name,
    code,
    description: src.description ?? undefined,
    timezone: src.timezone,
    schedule: src.schedule,
    limits: src.limits,
    visibility: src.visibility,
    priority: (src.priority ?? 0) + 1,
    settings: src.settings,
    createdBy: actor ?? 'admin',
    reason: 'clone',
  }, tenant)
  return created
}

export async function listRateVersionsByMatka(matkaId: string, tenant = 'default') {
  return db.select().from(matkaRateVersions).where(and(eq(matkaRateVersions.matkaId, matkaId), eq(matkaRateVersions.tenant, tenant))).orderBy(desc(matkaRateVersions.effectiveFrom))
}

export async function createRateVersionDb(input: MatkaRateVersionInput, tenant = 'default') {
  const entries = validateMatkaRates(input.entries)
  const from = new Date(input.effectiveFrom), to = input.effectiveTo ? new Date(input.effectiveTo) : null
  if (!Number.isFinite(from.getTime()) || to && (!Number.isFinite(to.getTime()) || to <= from)) throw new Error('Invalid rate effective range')
  return db.transaction(async (tx) => {
    await lockMatkaMarket(tx, tenant, input.matkaId)
    const existing = await tx.select().from(matkaRateVersions).where(and(eq(matkaRateVersions.matkaId, input.matkaId), eq(matkaRateVersions.tenant, tenant))).orderBy(desc(matkaRateVersions.effectiveFrom)).for('update')
    if (existing.some(v => v.effectiveFrom >= from)) throw new Error('New rates must start after the latest version')
    for (const v of existing) {
      if (v.effectiveTo && v.effectiveTo >= from) throw new Error('Overlapping rate version range')
      if (!v.effectiveTo) await tx.update(matkaRateVersions).set({ effectiveTo: new Date(from.getTime() - 1) }).where(eq(matkaRateVersions.id, v.id))
    }
    const [created] = await tx.insert(matkaRateVersions).values({ tenant, matkaId: input.matkaId, versionTag: input.versionTag, entries: { entries }, effectiveFrom: from, effectiveTo: to, createdBy: input.createdBy ?? null }).returning()
    return created
  })
}

export async function exportMatkasCsvDb(filters: MatkaFilters = {}, tenant = 'default') {
  const { items } = await listMatkasDb(filters, tenant, true)
  const headers = [
    'id','name','code','description','timezone','status','priority','schedule','limits','visibility','settings','createdAt','updatedAt','deletedAt'
  ]
  const lines = [headers.join(',')]
  for (const m of items) {
    const row = [
      m.id,
      JSON.stringify(m.name),
      JSON.stringify(m.code),
      JSON.stringify(m.description ?? ''),
      JSON.stringify(m.timezone),
      JSON.stringify(m.status),
      String(m.priority ?? 0),
      JSON.stringify(m.schedule),
      JSON.stringify(m.limits),
      JSON.stringify(m.visibility),
      JSON.stringify(m.settings),
      m.createdAt?.toISOString?.() ?? '',
      m.updatedAt?.toISOString?.() ?? '',
      m.deletedAt?.toISOString?.() ?? '',
    ]
    lines.push(row.join(','))
  }
  return lines.join('\n')
}

export async function importMatkasCsvDb(csv: string, { dryRun = true, actor }: { dryRun?: boolean; actor?: string }, tenant = 'default') {
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length)
  if (lines.length <= 1) return { inserted: 0, updated: 0, errors: [] as Array<{ line: number; error: string }> }
  const header = lines[0].split(',').map(h => h.trim())
  const idx = (k: string) => header.indexOf(k)
  const errors: Array<{ line: number; error: string }> = []
  let inserted = 0
  let updated = 0
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    try {
      const cols = line.split(',')
      const code = JSON.parse(cols[idx('code')])
      const name = JSON.parse(cols[idx('name')])
      const timezone = JSON.parse(cols[idx('timezone')])
      const schedule = JSON.parse(cols[idx('schedule')])
      const limits = JSON.parse(cols[idx('limits')])
      const visibility = JSON.parse(cols[idx('visibility')])
      const settings = JSON.parse(cols[idx('settings')])
      const existing = await db.select().from(matkas).where(and(eq(matkas.tenant, tenant), eq(matkas.code, code)))
      if (existing.length) {
        updated++
        if (!dryRun) {
          await updateMatkaDb({ id: existing[0].id, name, timezone, schedule, limits, visibility, settings, updatedBy: actor }, tenant)
        }
      } else {
        inserted++
        if (!dryRun) {
          await createMatkaDb({ name, code, timezone, schedule, limits, visibility, settings, description: JSON.parse(cols[idx('description')]) ?? undefined, createdBy: actor ?? 'admin' }, tenant)
        }
      }
    } catch (e: any) {
      errors.push({ line: i + 1, error: String(e?.message || e) })
    }
  }
  return { inserted, updated, errors }
}

// Tenant-wide default rates
export async function getDefaultRatesDb(tenant = 'default') {
  const rows = await db.select().from(matkaDefaultRates).where(eq(matkaDefaultRates.tenant, tenant))
  if (rows.length) return rows[0]
  // initialize with empty entries if not present
  const [created] = await db.insert(matkaDefaultRates).values({ tenant, entries: { entries: [] } as any, updatedBy: null }).returning()
  return created
}

export async function updateDefaultRatesDb(entries: RateEntry[], actor: string | null, tenant = 'default') {
  entries = validateMatkaRates(entries)
  const now = new Date()
  const existing = await db.select().from(matkaDefaultRates).where(eq(matkaDefaultRates.tenant, tenant))
  if (existing.length) {
    const [updated] = await db
      .update(matkaDefaultRates)
      .set({ entries: { entries } as any, updatedBy: actor ?? null, updatedAt: now })
      .where(eq(matkaDefaultRates.tenant, tenant))
      .returning()
    return updated
  }
  const [created] = await db
    .insert(matkaDefaultRates)
    .values({ tenant, entries: { entries } as any, updatedBy: actor ?? null, updatedAt: now })
    .returning()
  return created
}

