import { db } from '@src/db/client.js'
import {
  referralPrograms,
  referralRules,
  referralLinks,
  referralClicks,
  referralAttributions,
  referralBudgets,
} from '@src/db/schema.js'
import { sportsBets, casinoBets, matkaBets } from '@shared/db/schema.js'
import { and, eq, desc, gte, lte, gt, sql, or, ilike, inArray } from 'drizzle-orm'

// ===== Referral Programs =====

export async function getReferralProgramByTenantDb(tenant: string) {
  const rows = await db
    .select()
    .from(referralPrograms)
    .where(eq(referralPrograms.tenant, tenant))
    .limit(1)
  return rows[0] ?? null
}

export async function upsertReferralProgramDb(
  tenant: string,
  data: {
    name?: string
    enabledModes?: string[]
    maxDepth?: number
    minReferralBalanceForCashTransfer?: number
    attributionModel?: 'LAST_CLICK' | 'FIRST_CLICK' | 'LINEAR' | 'TIME_DECAY'
    attributionWindowDays?: number
    depositsWindowDays?: number
    negativeCarryover?: boolean
    flags?: Record<string, boolean>
  }
) {
  const existing = await getReferralProgramByTenantDb(tenant)
  
  // Strip REVSHARE from enabledModes (not supported)
  const sanitizedModes = data.enabledModes?.filter((m: string) => m !== 'REVSHARE')

  if (existing) {
    const enabledModesUpdate =
      data.enabledModes !== undefined
        ? (sanitizedModes ?? [])
        : ((existing.enabledModes || []) as string[]).filter((m: string) => m !== 'REVSHARE')
    const updated = await db
      .update(referralPrograms)
      .set({
        ...(data.name && { name: data.name }),
        enabledModes: enabledModesUpdate as any,
        ...(data.maxDepth !== undefined && { maxDepth: data.maxDepth }),
        ...(data.minReferralBalanceForCashTransfer !== undefined && { minReferralBalanceForCashTransfer: String(data.minReferralBalanceForCashTransfer) }),
        ...(data.flags && { flags: data.flags as any }),
        // Deprecated fields - ignored if provided, keep existing values
        updatedAt: new Date(),
      })
      .where(eq(referralPrograms.id, existing.id))
      .returning()
    return updated[0]
  } else {
    const inserted = await db
      .insert(referralPrograms)
      .values({
        tenant,
        name: data.name || 'Default Referral Program',
        enabledModes: ((data.enabledModes || []) as string[]).filter((m: string) => m !== 'REVSHARE') as any,
        maxDepth: data.maxDepth ?? 4, // Default to 4 tiers
        minReferralBalanceForCashTransfer: data.minReferralBalanceForCashTransfer != null ? String(data.minReferralBalanceForCashTransfer) : '0',
        // Deprecated fields - use defaults for migration compatibility
        attributionModel: 'LAST_CLICK' as any,
        attributionWindowDays: 30,
        depositsWindowDays: 30,
        negativeCarryover: false,
        flags: (data.flags || {}) as any,
      })
      .returning()
    return inserted[0]
  }
}

// ===== Referral Rules =====

export async function getReferralRulesByProgramDb(programId: number, tenant: string) {
  return db
    .select()
    .from(referralRules)
    .where(and(eq(referralRules.programId, programId), eq(referralRules.tenant, tenant)))
    .orderBy(referralRules.id)
}

export async function getReferralRuleByIdDb(ruleId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralRules)
    .where(and(eq(referralRules.id, ruleId), eq(referralRules.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

/** Total turnover (sum of stakes) for a user across sports, casino, matka. Used for referral turnover milestone. */
export async function getTotalTurnoverForUserDb(userId: number, tenant: string): Promise<number> {
  const [sports, casino, matka] = await Promise.all([
    db
      .select({ sum: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)` })
      .from(sportsBets)
      .where(and(eq(sportsBets.tenant, tenant), eq(sportsBets.userId, userId))),
    db
      .select({ sum: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
      .from(casinoBets)
      .where(and(eq(casinoBets.tenant, tenant), eq(casinoBets.userId, userId))),
    db
      .select({ sum: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)` })
      .from(matkaBets)
      .where(and(eq(matkaBets.tenant, tenant), eq(matkaBets.userId, userId))),
  ])
  return (
    Number((sports[0] as any)?.sum ?? 0) +
    Number((casino[0] as any)?.sum ?? 0) +
    Number((matka[0] as any)?.sum ?? 0)
  )
}

/** Get the active rule for a tenant + rule type (at most one per tenant per rule type). */
export async function getReferralRuleByTenantAndTypeDb(tenant: string, ruleType: string) {
  const rows = await db
    .select()
    .from(referralRules)
    .where(and(eq(referralRules.tenant, tenant), eq(referralRules.ruleType, ruleType as any)))
    .limit(1)
  return rows[0] ?? null
}

export async function upsertReferralRuleDb(
  tenant: string,
  programId: number,
  ruleId: number | null,
  data: {
    ruleType: string
    tierRates?: Record<number, number>
    fixedAmounts?: Record<number, number>
    caps?: { perReferee?: number; perReferrer?: number; daily?: number; monthly?: number }
    thresholds?: { minDeposit?: number; minBets?: number; minNetDeposit?: number; turnoverTarget?: number }
    payoutType?: 'CASH' | 'BONUS' | 'SPLIT'
    splitRatio?: { cash: number; bonus: number }
    escrow?: { untilKyc: boolean; untilFraudClear: boolean }
    configJson?: Record<string, any>
    reloadDepositsCount?: number
    reloadMinDeposit?: number
    isActive?: boolean
  }
) {
  if (ruleId) {
    const existing = await getReferralRuleByIdDb(ruleId, tenant)
    if (!existing) {
      throw new Error('Referral rule not found')
    }
    if (data.ruleType !== existing.ruleType) {
      const other = await getReferralRuleByTenantAndTypeDb(tenant, data.ruleType)
      if (other && other.id !== ruleId) {
        throw new Error(`A rule for reward type "${data.ruleType}" already exists. Only one rule per reward type is allowed per tenant.`)
      }
    }
    const updated = await db
      .update(referralRules)
      .set({
        ruleType: data.ruleType as any,
        tierRates: (data.tierRates || {}) as any,
        fixedAmounts: (data.fixedAmounts || {}) as any,
        caps: (data.caps || {}) as any,
        thresholds: (data.thresholds || {}) as any,
        payoutType: (data.payoutType || 'CASH') as any,
        splitRatio: (data.splitRatio || { cash: 100, bonus: 0 }) as any,
        escrow: (data.escrow || { untilKyc: false, untilFraudClear: false }) as any,
        configJson: (data.configJson || {}) as any,
        ...(data.reloadDepositsCount !== undefined && { reloadDepositsCount: data.reloadDepositsCount }),
        ...(data.reloadMinDeposit !== undefined && { reloadMinDeposit: data.reloadMinDeposit }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        updatedAt: new Date(),
      })
      .where(and(eq(referralRules.id, ruleId), eq(referralRules.tenant, tenant)))
      .returning()
    return updated[0]
  } else {
    const existingByType = await getReferralRuleByTenantAndTypeDb(tenant, data.ruleType)
    if (existingByType) {
      throw new Error(`A rule for reward type "${data.ruleType}" already exists. Only one rule per reward type is allowed per tenant. Edit the existing rule instead.`)
    }
    const inserted = await db
      .insert(referralRules)
      .values({
        tenant,
        programId,
        ruleType: data.ruleType as any,
        tierRates: (data.tierRates || {}) as any,
        fixedAmounts: (data.fixedAmounts || {}) as any,
        caps: (data.caps || {}) as any,
        thresholds: (data.thresholds || {}) as any,
        payoutType: (data.payoutType || 'CASH') as any,
        splitRatio: (data.splitRatio || { cash: 100, bonus: 0 }) as any,
        escrow: (data.escrow || { untilKyc: false, untilFraudClear: false }) as any,
        reloadDepositsCount: data.reloadDepositsCount ?? null,
        reloadMinDeposit: data.reloadMinDeposit ?? null,
        configJson: (data.configJson || {}) as any,
        isActive: data.isActive ?? true,
      })
      .returning()
    return inserted[0]
  }
}

export async function deleteReferralRuleDb(ruleId: number, tenant: string) {
  const deleted = await db
    .delete(referralRules)
    .where(and(eq(referralRules.id, ruleId), eq(referralRules.tenant, tenant)))
    .returning()
  return deleted.length > 0
}

// ===== Referral Links =====

export async function getReferralLinkByUserDb(userId: number, tenant: string, tx?: any) {
  const dbInstance = tx || db
  const rows = await dbInstance
    .select()
    .from(referralLinks)
    .where(and(eq(referralLinks.userId, userId), eq(referralLinks.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

export async function getReferralLinkByCodeDb(code: string, tx?: any) {
  if (!code || code.trim() === '') {
    return null
  }

  const dbInstance = tx || db
  const rows = await dbInstance
    .select()
    .from(referralLinks)
    .where(eq(referralLinks.code, code.toUpperCase())) // Case-insensitive lookup
    .limit(1)
  return rows[0] ?? null
}

/**
 * Get referral link by agent ID
 */
export async function getReferralLinkByAgentDb(agentId: string, tenant: string, tx?: any) {
  const dbInstance = tx || db
  const rows = await dbInstance
    .select()
    .from(referralLinks)
    .where(
      and(
        eq(referralLinks.agentId, agentId),
        eq(referralLinks.tenant, tenant)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

/**
 * Generate a unique alphanumeric referral code
 */
function generateReferralCode(length: number = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

export async function generateReferralLinkDb(
  tenant: string,
  userId: number | null,
  agentId: string | null,
  code?: string,
  utmParams?: Record<string, string>,
  tx?: any
) {
  // Validation: Either userId or agentId must be provided
  if (!userId && !agentId) {
    throw new Error('Either userId or agentId must be provided')
  }
  if (userId && agentId) {
    throw new Error('Cannot provide both userId and agentId. Only one is allowed.')
  }

  // Validate tenant
  if (!tenant || tenant.trim() === '') {
    throw new Error('Tenant is required')
  }

  // If agentId provided, validate agent exists and is active
  if (agentId) {
    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    const agentsRepo = new AgentsRepo()
    const agent = await agentsRepo.findById(agentId)
    
    if (!agent) {
      throw new Error(`Agent with ID ${agentId} not found`)
    }
    
    if (agent.status !== 'ACTIVE') {
      throw new Error(`Agent is not active. Current status: ${agent.status}`)
    }
    
    if (agent.schemeType !== 'SHARING' && agent.schemeType !== 'COMMISSION') {
      throw new Error(`Agent must be SHARING or COMMISSION type. Current type: ${agent.schemeType}`)
    }
    
    if (agent.tenantId !== tenant) {
      throw new Error(`Agent belongs to different tenant`)
    }

    // Check if agent already has a referral link
    const existing = await getReferralLinkByAgentDb(agentId, tenant, tx)
    if (existing) {
      throw new Error(`Agent already has a referral link. Code: ${existing.code}`)
    }
  }

  // If userId provided, validate user exists and doesn't already have a link
  if (userId) {
    const existing = await getReferralLinkByUserDb(userId, tenant, tx)
    if (existing) {
      throw new Error(`User already has a referral link. Code: ${existing.code}`)
    }
  }

  // Generate code if not provided
  let finalCode = code
  if (!finalCode) {
    // Generate 8-character alphanumeric code (increased for better uniqueness)
    let attempts = 0
    const maxAttempts = 20 // Increased for better uniqueness
    do {
      finalCode = generateReferralCode(8)
      attempts++
      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique referral code after multiple attempts')
      }
    } while (await getReferralLinkByCodeDb(finalCode, tx))
  } else {
    // Validate code format
    if (!/^[A-Z0-9]{6,12}$/i.test(finalCode)) {
      throw new Error('Referral code must be 6-12 alphanumeric characters')
    }
    
    // Check if provided code already exists
    const existing = await getReferralLinkByCodeDb(finalCode, tx)
    if (existing) {
      throw new Error(`Referral code ${finalCode} already exists`)
    }
  }

  const dbInstance = tx || db
  const inserted = await dbInstance
    .insert(referralLinks)
    .values({
      tenant,
      userId: userId || null,
      agentId: agentId || null,
      code: finalCode.toUpperCase(), // Normalize to uppercase
      utmParams: (utmParams || {}) as any,
      isActive: true,
    })
    .returning()
  return inserted[0]
}

export async function updateReferralLinkDb(
  linkId: number,
  tenant: string,
  data: {
    isActive?: boolean
    utmParams?: Record<string, string>
    qrCodeUrl?: string
  }
) {
  const updated = await db
    .update(referralLinks)
    .set({
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.utmParams && { utmParams: data.utmParams as any }),
      ...(data.qrCodeUrl && { qrCodeUrl: data.qrCodeUrl }),
      updatedAt: new Date(),
    })
    .where(and(eq(referralLinks.id, linkId), eq(referralLinks.tenant, tenant)))
    .returning()
  return updated[0] ?? null
}

// ===== Referral Clicks =====

export async function recordReferralClickDb(
  tenant: string,
  linkId: number,
  referrerId: number,
  data: {
    ipAddress?: string
    userAgent?: string
    utmSource?: string
    utmMedium?: string
    utmCampaign?: string
  }
) {
  const inserted = await db
    .insert(referralClicks)
    .values({
      tenant,
      linkId,
      referrerId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      utmCampaign: data.utmCampaign,
    })
    .returning()
  return inserted[0]
}

export async function getReferralClicksByLinkDb(linkId: number, tenant: string, limit = 100) {
  return db
    .select()
    .from(referralClicks)
    .where(and(eq(referralClicks.linkId, linkId), eq(referralClicks.tenant, tenant)))
    .orderBy(desc(referralClicks.clickedAt))
    .limit(limit)
}

export async function getReferralClicksByRefereeDb(
  refereeId: number,
  tenant: string,
  windowDays = 30
) {
  const { DateTime } = await import('luxon')
  const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
  const tz = await getWhitelabelTimezone(tenant)
  const windowStart = DateTime.now().setZone(tz).minus({ days: windowDays }).startOf('day').toJSDate()

  return db
    .select()
    .from(referralClicks)
    .where(
      and(
        eq(referralClicks.tenant, tenant),
        gte(referralClicks.clickedAt, windowStart)
      )
    )
    .orderBy(desc(referralClicks.clickedAt))
}

// ===== Referral Attributions =====

export async function getReferralAttributionByRefereeDb(refereeId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralAttributions)
    .where(and(eq(referralAttributions.refereeId, refereeId), eq(referralAttributions.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

/** Batch: get confirmed user referral attributions for multiple referees. Only referrerId > 0 and status = 'confirmed'. */
export async function getReferralAttributionsByRefereeIdsDb(
  refereeIds: number[],
  tenant: string
): Promise<Array<{ refereeId: number; referrerId: number }>> {
  if (refereeIds.length === 0) return []
  const rows = await db
    .select({
      refereeId: referralAttributions.refereeId,
      referrerId: referralAttributions.referrerId,
    })
    .from(referralAttributions)
    .where(
      and(
        inArray(referralAttributions.refereeId, refereeIds),
        eq(referralAttributions.tenant, tenant),
        gt(referralAttributions.referrerId, 0),
        eq(referralAttributions.status, 'confirmed')
      )
    )
  return rows.map((r) => ({ refereeId: r.refereeId, referrerId: r.referrerId }))
}

/**
 * Who referred `refereeId`: the referrer of its attribution in the tenant, or null. One step up a referral upline
 * (RewardsCalculatorService walks it for tiered rules). Counted like every other referral read: a confirmed
 * attribution to a user (referrerId > 0); an agent referral (referrer 0) is not a user upline.
 */
export async function getConfirmedReferrerOfDb(refereeId: number, tenant: string): Promise<number | null> {
  const rows = await db
    .select({ referrerId: referralAttributions.referrerId })
    .from(referralAttributions)
    .where(
      and(
        eq(referralAttributions.refereeId, refereeId),
        eq(referralAttributions.tenant, tenant),
        gt(referralAttributions.referrerId, 0),
        eq(referralAttributions.status, 'confirmed')
      )
    )
    .limit(1)
  return rows[0]?.referrerId ?? null
}

export async function createReferralAttributionDb(
  tenant: string,
  data: {
    referrerId: number
    refereeId: number
    tier: number
    clickId?: number
    status?: 'pending' | 'confirmed' | 'rejected' | 'reattributed'
    reason?: string
    reattributedFrom?: number
  }
) {
  const inserted = await db
    .insert(referralAttributions)
    .values({
      tenant,
      referrerId: data.referrerId,
      refereeId: data.refereeId,
      tier: data.tier,
      clickId: data.clickId,
      status: (data.status || 'pending') as any,
      reason: data.reason,
      reattributedFrom: data.reattributedFrom,
    })
    .returning()
  return inserted[0]
}

export async function updateReferralAttributionStatusDb(
  attributionId: number,
  tenant: string,
  status: 'pending' | 'confirmed' | 'rejected' | 'reattributed',
  reason?: string
) {
  const updated = await db
    .update(referralAttributions)
    .set({
      status: status as any,
      reason,
      ...(status === 'confirmed' && { confirmedAt: new Date() }),
    })
    .where(and(eq(referralAttributions.id, attributionId), eq(referralAttributions.tenant, tenant)))
    .returning()
  return updated[0] ?? null
}

export async function getReferralAttributionsByReferrerDb(
  referrerId: number,
  tenant: string,
  tier?: number
) {
  const conditions = [
    eq(referralAttributions.referrerId, referrerId),
    eq(referralAttributions.tenant, tenant),
  ]
  if (tier !== undefined) {
    conditions.push(eq(referralAttributions.tier, tier))
  }
  return db
    .select()
    .from(referralAttributions)
    .where(and(...conditions))
    .orderBy(desc(referralAttributions.attributedAt))
}

// ===== Referral Budgets =====

export async function getReferralBudgetDb(
  tenant: string,
  programId: number | null,
  budgetType: 'daily' | 'monthly',
  periodStart: Date,
  periodEnd: Date
) {
  const conditions = [
    eq(referralBudgets.tenant, tenant),
    eq(referralBudgets.budgetType, budgetType),
    gte(referralBudgets.periodStart, periodStart),
    lte(referralBudgets.periodEnd, periodEnd),
  ]
  if (programId !== null) {
    conditions.push(eq(referralBudgets.programId, programId))
  } else {
    conditions.push(sql`${referralBudgets.programId} IS NULL`)
  }

  const rows = await db
    .select()
    .from(referralBudgets)
    .where(and(...conditions))
    .limit(1)
  return rows[0] ?? null
}

export async function upsertReferralBudgetDb(
  tenant: string,
  data: {
    programId?: number | null
    budgetType: 'daily' | 'monthly'
    amount: number
    currency: string
    periodStart: Date
    periodEnd: Date
  }
) {
  const existing = await getReferralBudgetDb(
    tenant,
    data.programId ?? null,
    data.budgetType,
    data.periodStart,
    data.periodEnd
  )

  if (existing) {
    const updated = await db
      .update(referralBudgets)
      .set({
        amount: String(data.amount),
        currency: data.currency,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(referralBudgets.id, existing.id))
      .returning()
    return updated[0]
  } else {
    const inserted = await db
      .insert(referralBudgets)
      .values({
        tenant,
        programId: data.programId ?? null,
        budgetType: data.budgetType,
        amount: String(data.amount),
        currency: data.currency,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        spent: '0',
      })
      .returning()
    return inserted[0]
  }
}

export async function incrementReferralBudgetSpentDb(
  budgetId: number,
  amount: number
) {
  const updated = await db
    .update(referralBudgets)
    .set({
      spent: sql`${referralBudgets.spent} + ${String(amount)}`,
      updatedAt: new Date(),
    })
    .where(eq(referralBudgets.id, budgetId))
    .returning()
  return updated[0] ?? null
}

