import {

  createDraw as mkCreateDraw, updateDraw as mkUpdateDraw, createRateDraft as mkCreateRateDraft, 

  submitRatesForReview as mkSubmitRatesForReview, publishRates as mkPublishRates, 

  postResult as mkPostResult, createSettlementBatch as mkCreateSettlementBatch,

  submitResultForApproval as apprSubmit, approveResult as apprApprove, rejectResult as apprReject,

  listDraws,

} from '@/stores/index.js'

import { upsertDraw } from '@/repos/matka/drawsRepo.js'

import { insertResult } from '@/repos/matka/resultsRepo.js'

import { createResultApproval, approveResultApproval, rejectResultApproval } from '@/repos/matka/approvalsRepo.js'

import { createMatkaBidRuleDb, updateMatkaBidRuleDb, deleteMatkaBidRuleDb } from '@src/repos/matka/matkaBidRulesRepo.js'

import { recordAuditDb } from '@/repos/audit/auditRepo.js'

import { hasPermission } from '@src/domains/common/auth.js'

import { z } from 'zod'

import { createMatkaResult, rollbackMatkaResult, buildMatkaResultContext } from '@src/repos/matka/matkaResultsRepo.js'

import { validateResultForMarket } from '@src/domains/matka/services/resultFormat.js'



import { checkRateLimit } from '@src/middleware/matkaResultRateLimit.js'

import { matkaResultMetrics } from '@src/routes/metrics.js'

// duplicate import removed

import { createMatkaDb, updateMatkaDb, softDeleteMatkaDb, reorderMatkasDb, cloneMatkaDb, createRateVersionDb, exportMatkasCsvDb, importMatkasCsvDb, type MatkaStatus } from '@/repos/matka/matkaRepo.js'

import { getEffectiveTenantForDirector, shouldSkipTenantFiltering } from '@src/domains/common/directorModeUtils.js'

import { requirePermission } from '@src/domains/common/auth.js'

import { requireDiagnosticAccess } from '@src/domains/common/auth.js'



const CreateDrawInput = z.object({ type: z.enum(['single','double']), openAt: z.string().min(1), cutoffAt: z.string().min(1), timezone: z.string().min(1) })

const UpdateDrawInput = z.object({ id: z.string().min(1), openAt: z.string().optional(), cutoffAt: z.string().optional(), status: z.enum(['scheduled','open','closed','settled','corrected']).optional() })

const BaseOnIdInput = z.object({ baseOnId: z.string().optional() })

const DrawIdInput = z.object({ id: z.string().min(1) })

const PostResultInput = z.object({ drawId: z.string().min(1), value: z.string().min(1) })

const SettlementInput = z.object({ drawId: z.string().min(1), mode: z.enum(['auto','recalc']) })

const SubmitApprovalInput = z.object({ drawId: z.string().min(1), value: z.string().min(1), reason: z.string().optional() })

const ApproveRejectInput = z.object({ approvalId: z.string().min(1) })



export const matkaMutationResolvers = {

  createDraw: async (_: any, args: any, ctx: any) => {

    requirePermission(ctx, 'matka.management', 'create')

    const p = CreateDrawInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    const draw = mkCreateDraw({ type: p.data.type, openAt: p.data.openAt, cutoffAt: p.data.cutoffAt, timezone: p.data.timezone })

    upsertDraw({ id: draw.id, type: draw.type, openAt: draw.openAt, cutoffAt: draw.cutoffAt, timezone: draw.timezone, status: draw.status }).catch(()=>{})

    return draw

  },

  updateDraw: async (_: any, args: any, ctx: any) => {

    requirePermission(ctx, 'matka.results', 'create')

    const p = UpdateDrawInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    const draw = mkUpdateDraw(p.data.id, { openAt: p.data.openAt ?? undefined, cutoffAt: p.data.cutoffAt ?? undefined, status: p.data.status ?? undefined })

    upsertDraw({ id: draw.id, type: draw.type, openAt: draw.openAt, cutoffAt: draw.cutoffAt, timezone: draw.timezone, status: draw.status }).catch(()=>{})

    return draw

  },

  createRateDraft: async (_: any, args: any, ctx: any) => {

    requirePermission(ctx, 'matka.rates', 'update')

    const p = BaseOnIdInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    const v = mkCreateRateDraft(p.data.baseOnId ?? undefined)

    return { 

      id: v.id, 

      effectiveFrom: v.effectiveFrom, 

      createdBy: v.createdBy, 

      status: v.status, 

      rates: Object.entries(v.rates).map(([key,value]) => ({ key, value })) 

    }

  },

  submitRatesForReview: async (_: any, args: any, ctx: any) => {

    requirePermission(ctx, 'matka.rates', 'update')

    const p = DrawIdInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    const v = mkSubmitRatesForReview(p.data.id)

    return { 

      id: v.id, 

      effectiveFrom: v.effectiveFrom, 

      createdBy: v.createdBy, 

      status: v.status, 

      rates: Object.entries(v.rates).map(([key,value]) => ({ key, value })) 

    }

  },

  publishRates: async (_: any, args: any, ctx: any) => {

    requirePermission(ctx, 'matka.rates', 'update')

    const p = DrawIdInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    const v = mkPublishRates(p.data.id)

    return { 

      id: v.id, 

      effectiveFrom: v.effectiveFrom, 

      createdBy: v.createdBy, 

      status: v.status, 

      rates: Object.entries(v.rates).map(([key,value]) => ({ key, value })) 

    }

  },

  postResult: async (_: any, args: any, ctx: any) => {

    requirePermission(ctx, 'matka.results', 'create')

    const p = PostResultInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    const r = mkPostResult(p.data.drawId, p.data.value, 'admin')

    insertResult(r.drawId, r.value, r.enteredBy).catch(()=>{})

    return r

  },

  // Declared no `ctx` parameter at all, so it could not have been authorising

  // anything. It settles a draw, which is what `matka.results:create` governs

  // for every neighbouring mutation in this map.

  createSettlementBatch: async (_: any, args: any, ctx: any) => {

    requirePermission(ctx, 'matka.results', 'create')

    const p = SettlementInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    return mkCreateSettlementBatch(p.data.drawId, p.data.mode)

  },

  submitResultForApproval: async (_: any, args: any, ctx: any) => {

    requirePermission(ctx, 'matka.results', 'create')

    const p = SubmitApprovalInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    const a = apprSubmit(p.data.drawId, p.data.value, 'admin', p.data.reason ?? undefined)

    // dual-write to DB best-effort

    createResultApproval(a.drawId, a.value, a.requestedBy, p.data.reason ?? undefined)

      .then(() => recordAuditDb({ actorId: 'admin', domain: 'matka.results', action: 'submit', resourceType: 'approval', resourceId: String(a.id) }))

      .catch(()=>{})

    return a

  },

  approveResult: async function (this: any, _root: any, args: any, ctx: any) {

    requirePermission(ctx, 'matka.results', 'create')

    const p = ApproveRejectInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    const a = apprApprove(p.data.approvalId, 'approver')

    approveResultApproval(Number(a.id), 'approver')

      .then(() => recordAuditDb({ actorId: 'approver', domain: 'matka.results', action: 'approve', resourceType: 'approval', resourceId: String(a.id) }))

      .catch(()=>{})

    mkPostResult(a.drawId, a.value, a.requestedBy)

    // notify subscribers about draw status change if any

    const d = listDraws({}).find(d => d.id === a.drawId)

    if (d) this.pubsub.publish({ topic: 'DRAW_STATUS', payload: { drawStatus: d } })

    return a

  },

  rejectResult: async (_: any, args: any, ctx: any) => {

    requirePermission(ctx, 'matka.results', 'create')

    const p = ApproveRejectInput.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    const a = apprReject(p.data.approvalId, 'approver')

    rejectResultApproval(Number(a.id), 'approver')

      .then(() => recordAuditDb({ actorId: 'approver', domain: 'matka.results', action: 'reject', resourceType: 'approval', resourceId: String(a.id) }))

      .catch(()=>{})

    return a

  },

  // Matka entity management

  createMatka: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'create')) throw new Error('Forbidden')

    const UPPER = z.enum(['ACTIVE','INACTIVE','SUSPEND'])

    const LOWER = z.enum(['active','inactive','suspend'])

    const schema = z.object({ input: z.object({

      name: z.string().min(1),

      code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),

      description: z.string().optional(),

      timezone: z.string().min(1),

      status: z.union([UPPER, LOWER]).optional(),

      schedule: z.any(),

      limits: z.any(),

      visibility: z.any(),

      priority: z.number().int().optional(),

      settings: z.any(),

      reason: z.string().optional(),

    }) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const statusNorm = (p.data.input.status ? String(p.data.input.status).toLowerCase() : 'inactive') as MatkaStatus

    const created = await createMatkaDb({ ...p.data.input, status: statusNorm, createdBy: ctx?.user?.sub ?? 'admin' }, tenant)

    await recordAuditDb({ actorId: ctx?.user?.sub ?? 'admin', domain: 'matka', action: 'create', resourceType: 'matka', resourceId: created.id, after: created })

    return { success: true, message: 'Matka created successfully', matka: { ...created, status: String(created.status || '').toUpperCase() } }

  },

  updateMatka: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const UPPER = z.enum(['ACTIVE','INACTIVE','SUSPEND'])

    const LOWER = z.enum(['active','inactive','suspend'])

    const schema = z.object({ input: z.object({

      id: z.string().min(1),

      name: z.string().optional(),

      description: z.string().optional(),

      timezone: z.string().optional(),

      schedule: z.any().optional(),

      limits: z.any().optional(),

      visibility: z.any().optional(),

      priority: z.number().int().optional(),

      settings: z.any().optional(),

      status: z.union([UPPER, LOWER]).optional(),

      reason: z.string().optional(),

    }) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const before = await (await import('@/repos/matka/matkaRepo.js')).getMatkaDb(p.data.input.id, tenant)

    const input = { ...p.data.input, status: p.data.input.status ? (String(p.data.input.status).toLowerCase() as MatkaStatus) : undefined }

    const updated = await updateMatkaDb({ ...input, updatedBy: ctx?.user?.sub ?? 'admin' }, tenant)

    await recordAuditDb({ actorId: ctx?.user?.sub ?? 'admin', domain: 'matka', action: 'update', resourceType: 'matka', resourceId: updated.id, before, after: updated })

    return { success: true, message: 'Matka updated successfully', matka: { ...updated, status: String(updated.status || '').toUpperCase() } }

  },

  deleteMatka: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'delete')) throw new Error('Forbidden')

    const schema = z.object({ id: z.string().min(1), reason: z.string().min(1) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    await softDeleteMatkaDb(p.data.id, p.data.reason, tenant)

    await recordAuditDb({ actorId: ctx?.user?.sub ?? 'admin', domain: 'matka', action: 'delete', resourceType: 'matka', resourceId: p.data.id, before: { id: p.data.id }, after: { deleted: true, reason: p.data.reason } })

    return true

  },

  setMatkaStatus: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const UPPER = z.enum(['ACTIVE','INACTIVE','SUSPEND'])

    const LOWER = z.enum(['active','inactive','suspend'])

    const schema = z.object({ id: z.string().min(1), toStatus: z.union([UPPER, LOWER]), reason: z.string().optional() })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const before = await (await import('@/repos/matka/matkaRepo.js')).getMatkaDb(p.data.id, tenant)

    if (!before) throw new Error('Not found')

    const from = String(before.status).toLowerCase() as any

    const to = String(p.data.toStatus).toLowerCase() as any

    const allowed: Record<string, string[]> = { active: ['inactive','suspend'], inactive: ['active','suspend'], suspend: ['inactive', 'active'] }

    if (!(allowed[from] || []).includes(to)) throw new Error('Invalid status transition')

    const updated = await updateMatkaDb({ id: p.data.id, status: to, updatedBy: ctx?.user?.sub ?? 'admin', reason: p.data.reason }, tenant)

    await recordAuditDb({ actorId: ctx?.user?.sub ?? 'admin', domain: 'matka', action: 'status', resourceType: 'matka', resourceId: updated.id, before, after: updated })

    return { success: true, message: `Status changed from ${from} to ${to}`, matka: { ...updated, status: String(updated.status || '').toUpperCase() } }

  },

  updateMatkaSettings: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const schema = z.object({ id: z.string().min(1), settings: z.any(), tierId: z.string().optional(), reason: z.string().optional() })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const { getMatkaDb } = await import('@/repos/matka/matkaRepo.js')

    const before = await getMatkaDb(p.data.id, tenant)

    if (!before) throw new Error('Not found')

    let nextSettings: any

    const incoming = p.data.settings

    const tierId = (p.data.tierId || '').trim()

    if (tierId && tierId.toLowerCase() !== 'default') {

      const current = (before.settings as any) || {}

      const tierOverrides = { ...(current.tierOverrides || {}) }

      const existingTier = { ...(tierOverrides[tierId] || {}) }

      // Shallow merge for now; enforce numbers where needed already handled on FE

      tierOverrides[tierId] = { ...existingTier, ...incoming }

      nextSettings = { ...current, tierOverrides }

    } else {

      // Merge into base settings

      const current = (before.settings as any) || {}

      nextSettings = { ...current, ...incoming }

    }

    const updated = await updateMatkaDb({ id: p.data.id, settings: nextSettings, updatedBy: ctx?.user?.sub ?? 'admin', reason: p.data.reason }, tenant)

    await recordAuditDb({ actorId: ctx?.user?.sub ?? 'admin', domain: 'matka', action: 'settings', resourceType: 'matka', resourceId: updated.id, before, after: updated })

    return { success: true, message: 'Settings updated', matka: { ...updated, status: String(updated.status || '').toUpperCase() } }

  },

  reorderMatkas: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const schema = z.object({ input: z.array(z.object({ id: z.string().min(1), priority: z.number().int() })) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    await reorderMatkasDb(p.data.input, tenant)

    await recordAuditDb({ actorId: ctx?.user?.sub ?? 'admin', domain: 'matka', action: 'reorder', resourceType: 'matka', resourceId: '*', after: p.data.input })

    return { success: true, message: 'Matkas order updated' }

  },

  createMatkaBidRule: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const schema = z.object({ input: z.object({

      matkaId: z.string().min(1),

      matkaType: z.string().min(1),

      marketName: z.string().min(1),

      marketSession: z.string().optional(),

      bidType: z.string().min(1),

      percentage: z.number(),

      includeAll: z.boolean(),

      includedPlayers: z.any().optional(),

      minStake: z.number().nullable().optional(),

      maxStake: z.number().nullable().optional(),

      exposureCap: z.number().nullable().optional(),

      status: z.enum(['active','inactive']).optional(),

      priority: z.number().int().optional(),

      notes: z.string().optional(),

    }) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const created = await createMatkaBidRuleDb(p.data.input, ctx?.user?.sub ?? 'admin', tenant)

    return created

  },

  updateMatkaBidRule: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const schema = z.object({ id: z.string().min(1), patch: z.object({

      matkaType: z.string().optional(),

      marketName: z.string().optional(),

      marketSession: z.string().optional(),

      bidType: z.string().optional(),

      percentage: z.number().optional(),

      includeAll: z.boolean().optional(),

      includedPlayers: z.any().optional(),

      minStake: z.number().nullable().optional(),

      maxStake: z.number().nullable().optional(),

      exposureCap: z.number().nullable().optional(),

      status: z.enum(['active','inactive']).optional(),

      priority: z.number().int().optional(),

      notes: z.string().optional(),

    }) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const row = await updateMatkaBidRuleDb(p.data.id, p.data.patch, ctx?.user?.sub ?? 'admin', tenant)

    return row

  },

  deleteMatkaBidRule: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const schema = z.object({ id: z.string().min(1) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    await deleteMatkaBidRuleDb(p.data.id, tenant)

    return true

  },

  cloneMatka: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const schema = z.object({ id: z.string().min(1), name: z.string().min(1), code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const created = await cloneMatkaDb(p.data.id, { name: p.data.name, code: p.data.code, actor: ctx?.user?.sub ?? 'admin' }, tenant)

    await recordAuditDb({ actorId: ctx?.user?.sub ?? 'admin', domain: 'matka', action: 'clone', resourceType: 'matka', resourceId: created.id, after: created })

    return { success: true, message: 'Matka cloned successfully', matka: { ...created, status: String(created.status || '').toUpperCase() } }

  },

  createMatkaRateVersion: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.rates', 'update')) throw new Error('Forbidden')

    const schema = z.object({ input: z.object({ matkaId: z.string().min(1), versionTag: z.string().min(1), entries: z.array(z.object({ betType: z.string().min(1), payoutMultiplier: z.number(), minOdds: z.number().nullable().optional(), maxOdds: z.number().nullable().optional() })), effectiveFrom: z.string().min(1), effectiveTo: z.string().nullable().optional() }) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    return createRateVersionDb({ ...p.data.input, createdBy: ctx?.user?.sub ?? 'admin' }, tenant)

  },

  importMatkasCSV: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const schema = z.object({ csv: z.string().min(1), dryRun: z.boolean().optional() })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const res = await importMatkasCsvDb(p.data.csv, { dryRun: p.data.dryRun ?? true, actor: ctx?.user?.sub ?? 'admin' }, tenant)

    await recordAuditDb({ actorId: ctx?.user?.sub ?? 'admin', domain: 'matka', action: 'import', resourceType: 'matka', resourceId: '*', after: res })

    return { inserted: res.inserted, updated: res.updated, errors: res.errors.map(e => ({ line: e.line, error: e.error })) }

  },

  updateMatkaDefaultRates: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.management', 'update')) throw new Error('Forbidden')

    const schema = z.object({ entries: z.array(z.object({ betType: z.string().min(1), payoutMultiplier: z.number(), minOdds: z.number().nullable().optional(), maxOdds: z.number().nullable().optional() })) })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input')

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const { updateDefaultRatesDb } = await import('@/repos/matka/matkaRepo.js')

    const row = await updateDefaultRatesDb(p.data.entries, ctx?.user?.sub ?? 'admin', tenant)

    return { tenant: row.tenant, entries: (row.entries as any)?.entries ?? [], updatedBy: row.updatedBy ?? null, updatedAt: row.updatedAt.toISOString?.() ?? new Date().toISOString() }

  },

  createTestMatkaBet: async (_: any, args: { input: any }, ctx: any) => {

    requireDiagnosticAccess(ctx, 'createTestMatkaBet')

    const { createMatkaBet } = await import('@src/repos/matka/matkaBetsRepo.js')

    const { getMatkaDb } = await import('@src/repos/matka/matkaRepo.js')

    const { getUserDb, getPlayerLimitsDb } = await import('@src/repos/users/usersRepo.js')

    const { publishPlayerEvent, publishDashboard } = await import('../services/MatkaBetEvents.js')

    const { computeDashboard } = await import('../services/LiveAnalyticsService.js')

    const { onBetCreated } = await import('@/domains/matka-worli/services/RealtimeService.js')

    const tenant = ctx?.tenant || 'default'

    const wl = ctx?.whitelabel?.id || 'default'



    const matka = await getMatkaDb(args.input.matkaId, tenant)

    if (!matka) throw new Error('Matka not found')



    // Fetch user name

    const user = await getUserDb(Number(args.input.userId), tenant)

    const userName = user?.name || user?.username || null



    const betAmount = Number(args.input.betAmount)

    const payoutMultiplier = Number(args.input.payoutMultiplier)

    const potentialWin = args.input.potentialWin != null ? Number(args.input.potentialWin) : betAmount * payoutMultiplier

    const status = (args.input.status || 'pending') as any



    // Check player-specific max bet limit for matka

    const playerLimits = await getPlayerLimitsDb(Number(args.input.userId), tenant)

    if (playerLimits?.maxBetMatka != null && betAmount > playerLimits.maxBetMatka) {

      throw new Error(`Bet amount ${betAmount} exceeds player matka limit of ${playerLimits.maxBetMatka}`)

    }



    const bet = await createMatkaBet({

      tenant,

      whitelabelId: wl,

      userId: Number(args.input.userId),

      matkaId: args.input.matkaId,

      matkaType: args.input.matkaType,

      marketName: args.input.marketName,

      marketSession: args.input.marketSession || undefined,

      bidType: args.input.bidType,

      betNumbers: args.input.betNumbers,

      betAmount,

      payoutMultiplier,

      potentialWin,

      currency: 'USD',

    })



    // Trigger realtime events via onBetCreated

    await onBetCreated(bet, ctx.pubsub)



    return {

      id: bet.id,

      tenant: bet.tenant,

      whitelabelId: bet.whitelabelId,

      userId: String(bet.userId),

      matkaId: bet.matkaId,

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

    }

  },

  // Matka Results mutations

  createMatkaResult: async function (this: any, _: any, args: any, ctx: any) {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.results', 'create')) throw new Error('Forbidden')

    

    // Rate limiting

    const actorId = ctx?.user?.sub ?? ctx?.actor?.id ?? 'anonymous'

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    if (!checkRateLimit(actorId)) {

      matkaResultMetrics.rateLimitHits.inc({ tenant })

      throw new Error('Rate limit exceeded. Please wait before declaring another result.')

    }

    

    const startTime = Date.now()

    const schema = z.object({

      input: z.object({

        matkaId: z.string().uuid(),

        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

        type: z.enum(['open', 'close']),

        result: z.string().min(1),

        idempotencyKey: z.string().optional(),

      }),

      idempotencyKey: z.string().optional(),

    })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input: ' + p.error.message)

    

    const resultCtx = buildMatkaResultContext(ctx)

    const idempotencyKey = p.data.idempotencyKey || p.data.input.idempotencyKey

    

    // Validate result format

    const validation = await validateResultForMarket(

      p.data.input.matkaId,

      p.data.input.type,

      p.data.input.result,

      resultCtx.tenant

    )

    if (!validation.valid) {

      throw new Error(validation.error || 'Invalid result format')

    }

    

    try {

      const created = await createMatkaResult(

        { ...p.data.input, idempotencyKey },

        resultCtx

      )

      

      // Audit

      await recordAuditDb({

        actorId: resultCtx.actorId,

        domain: 'matka.results',

        action: 'create',

        resourceType: 'matkaResult',

        resourceId: created.id,

        after: created,

        tenant: resultCtx.tenant,

      })

      

      // Publish event (use ctx.pubsub first, fallback to this.pubsub)

      const pubsub = ctx?.pubsub || (this as any)?.pubsub

      if (pubsub && typeof pubsub.publish === 'function') {

        try {

          pubsub.publish({

            topic: 'MATKA_RESULT_CREATED',

            payload: { matkaResultEvents: {

              id: created.id,

              matkaId: created.matkaId,

              date: created.date,

              type: created.type,

              result: created.result,

              declaredBy: created.declaredBy,

              declaredAt: created.declaredAt.toISOString(),

            } },

          }).catch((err: any) => {

          })

        } catch (err: any) {

        }

      }

      

      // Calculate impact

      const impact = created.impact

      

      // Record metrics

      const latency = (Date.now() - startTime) / 1000

      matkaResultMetrics.declaresTotal.inc({ tenant: resultCtx.tenant, type: p.data.input.type })

      matkaResultMetrics.declareLatency.observe({ tenant: resultCtx.tenant }, latency)

      

      // Resolve user name

      let declaredByName: string | undefined = undefined

      const declaredById = Number.parseInt(created.declaredBy, 10)

      if (Number.isFinite(declaredById)) {

        try {

          const { getUserDb } = await import('@src/repos/users/usersRepo.js')

          const user = await getUserDb(declaredById, resultCtx.tenant)

          declaredByName = user?.name || created.declaredBy

        } catch {

          declaredByName = created.declaredBy

        }

      } else {

        declaredByName = created.declaredBy

      }

      

      return {

        success: true,

        message: 'Result declared successfully',

        result: {

          ...created,

          tenant: resultCtx.tenant,

          declaredAt: created.declaredAt.toISOString(),

          createdAt: created.declaredAt.toISOString(),

          declaredByName,

        },

        impact,

      }

    } catch (error: any) {

      return {

        success: false,

        message: error.message || 'Failed to create result',

        result: null,

        impact: null,

      }

    }

  },

  rollbackMatkaResult: async function (this: any, _: any, args: any, ctx: any) {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.results', 'rollback')) throw new Error('Forbidden')

    

    // Rate limiting (stricter for rollbacks)

    const actorId = ctx?.user?.sub ?? ctx?.actor?.id ?? 'anonymous'

    // CRITICAL: For Director Admin, use effective tenant based on mode

    const directorTenant = getEffectiveTenantForDirector(ctx)

    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    if (!checkRateLimit(actorId)) {

      matkaResultMetrics.rateLimitHits.inc({ tenant })

      throw new Error('Rate limit exceeded. Please wait before rolling back another result.')

    }

    

    const startTime = Date.now()

    const schema = z.object({

      input: z.object({

        id: z.string().uuid(),

        reason: z.string().min(1),

        tag: z.string().optional(),

      }),

    })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input: ' + p.error.message)

    

    const resultCtx = buildMatkaResultContext(ctx)

    

    try {

      const rolledBack = await rollbackMatkaResult(p.data.input, resultCtx)

      

      // Audit

      await recordAuditDb({

        actorId: resultCtx.actorId,

        domain: 'matka.results',

        action: 'rollback',

        resourceType: 'matkaResult',

        resourceId: p.data.input.id,

        after: { reason: p.data.input.reason, tag: p.data.input.tag },

        tenant: resultCtx.tenant,

      })

      

      // Publish event (use ctx.pubsub first, fallback to this.pubsub)

      const pubsub = ctx?.pubsub || (this as any)?.pubsub

      if (pubsub && typeof pubsub.publish === 'function') {

        try {

          pubsub.publish({

            topic: 'MATKA_RESULT_ROLLED_BACK',

            payload: { matkaResultEvents: {

              id: rolledBack.id,

              rolledBackAt: rolledBack.rolledBackAt.toISOString(),

              rolledBackBy: rolledBack.rolledBackBy,

            } },

          }).catch((err: any) => {

          })

        } catch (err: any) {

        }

      }

      

      // Get full result for response

      const { getMatkaResultById } = await import('@src/repos/matka/matkaResultsRepo.js')

      const result = await getMatkaResultById(rolledBack.id, resultCtx.tenant)

      

      // Calculate rollback impact

      const impact = rolledBack.impact

      

      // Record metrics

      const latency = (Date.now() - startTime) / 1000

      matkaResultMetrics.rollbacksTotal.inc({ 

        tenant: resultCtx.tenant, 

        reason_tag: p.data.input.tag || 'unknown' 

      })

      matkaResultMetrics.rollbackLatency.observe({ tenant: resultCtx.tenant }, latency)



      // Settlement and wallet reversal have committed atomically; rebuild affected reports.
      try {

        const { regenerateSnapshotsForDateAfterRollback } = await import('@/services/reportingSnapshotService.js')

        const whitelabelId = ctx?.whitelabel?.id ?? resultCtx.tenant

        const affectedDate = result?.date ? new Date(`${result.date}T12:00:00Z`) : new Date()

        await regenerateSnapshotsForDateAfterRollback(

          resultCtx.tenant,

          whitelabelId,

          affectedDate,

          'matka',

        )

      } catch (snapshotErr: any) {

      }

      

      // Resolve user names

      let declaredByName: string | undefined = undefined

      let rolledBackByName: string | undefined = undefined

      if (result) {

        const { getUserDb } = await import('@src/repos/users/usersRepo.js')

        

        // Resolve declaredBy

        const declaredById = Number.parseInt(result.declaredBy, 10)

        if (Number.isFinite(declaredById)) {

          try {

            const user = await getUserDb(declaredById, resultCtx.tenant)

            declaredByName = user?.name || result.declaredBy

          } catch {

            declaredByName = result.declaredBy

          }

        } else {

          declaredByName = result.declaredBy

        }

        

        // Resolve rolledBackBy

        if (result.rolledBackBy) {

          const rolledBackById = Number.parseInt(result.rolledBackBy, 10)

          if (Number.isFinite(rolledBackById)) {

            try {

              const user = await getUserDb(rolledBackById, resultCtx.tenant)

              rolledBackByName = user?.name || result.rolledBackBy

            } catch {

              rolledBackByName = result.rolledBackBy

            }

          } else {

            rolledBackByName = result.rolledBackBy

          }

        }

      }

      

      return {

        success: true,

        message: 'Result rolled back successfully',

        result: result ? {

          ...result,

          date: result.date,

          type: result.type,

          declaredAt: result.declaredAt instanceof Date ? result.declaredAt.toISOString() : result.declaredAt,

          rolledBackAt: result.rolledBackAt instanceof Date ? result.rolledBackAt.toISOString() : (result.rolledBackAt ?? null),

          createdAt: result.createdAt instanceof Date ? result.createdAt.toISOString() : result.createdAt,

          declaredByName,

          rolledBackByName,

        } : null,

        impact,

      }

    } catch (error: any) {

      return {

        success: false,

        message: error.message || 'Failed to rollback result',

        result: null,

        impact: null,

      }

    }

  },

  importMatkaResults: async (_: any, args: any, ctx: any) => {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.results', 'create')) throw new Error('Forbidden')

    const schema = z.object({

      rows: z.array(z.object({

        matkaId: z.string().uuid(),

        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

        type: z.enum(['open', 'close']),

        result: z.string().min(1),

      })),

      dryRun: z.boolean(),

    })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input: ' + p.error.message)

    

    const resultCtx = buildMatkaResultContext(ctx)

    const valid: any[] = []

    const invalid: any[] = []

    const errors: any[] = []

    

    for (let i = 0; i < p.data.rows.length; i++) {

      const row = p.data.rows[i]

      try {

        // Validate format

        const validation = await validateResultForMarket(row.matkaId, row.type, row.result, resultCtx.tenant)

        if (!validation.valid) {

          invalid.push({ line: i + 1, error: validation.error || 'Invalid format' })

          continue

        }

        

        if (p.data.dryRun) {

          valid.push(row)

        } else {

          // Actually create (will be handled in bulk create logic)

          valid.push(row)

        }

      } catch (error: any) {

        errors.push({ line: i + 1, error: error.message || 'Validation failed' })

      }

    }

    

    return { valid, invalid, errors }

  },

  scheduleMatkaResult: async function (this: any, _: any, args: any, ctx: any) {

    if (!hasPermission(ctx?.permissions ?? [], 'matka.results', 'create')) throw new Error('Forbidden')

    const schema = z.object({

      input: z.object({

        matkaId: z.string().uuid(),

        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

        type: z.enum(['open', 'close']),

        result: z.string().min(1),

        scheduledAt: z.string().datetime(),

      }),

    })

    const p = schema.safeParse(args)

    if (!p.success) throw new Error('Invalid input: ' + p.error.message)

    

    const resultCtx = buildMatkaResultContext(ctx)

    

    // Validate result format

    const validation = await validateResultForMarket(

      p.data.input.matkaId,

      p.data.input.type,

      p.data.input.result,

      resultCtx.tenant

    )

    if (!validation.valid) {

      throw new Error(validation.error || 'Invalid result format')

    }

    

    // Create schedule (will be implemented in scheduler todo)

    // For now, return a placeholder

    const { createMatkaResultSchedule } = await import('@src/repos/matka/matkaResultSchedulesRepo.js')

    const schedule = await createMatkaResultSchedule(p.data.input, resultCtx)

    

    return {

      success: true,

      message: 'Result scheduled successfully',

      result: null,

      impact: null,

    }

  },

}

