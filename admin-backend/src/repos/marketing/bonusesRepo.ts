import { db } from '@src/db/client.js'
import { bonusCampaigns, bonusAwards, bonusCodes, users, wallets, walletLedger, ledgerEntries } from '@shared/db/schema.js'
import { eq, and, or, like, sql, desc, notInArray, gte, lte, inArray, type SQL } from 'drizzle-orm'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'
import { ensurePlayerWalletDb } from '@/repos/players/walletsRepo.js'
import { DateTime } from 'luxon'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'

/** Bonus cards admin list/stats: date filters and expiry math use IST (matches admin UI presets). */
const BONUS_AWARDS_ADMIN_TZ = 'Asia/Kolkata'

export type BonusCampaignFilters = {
  status?: 'draft' | 'active' | 'paused' | 'ended'
  domain?: 'sports' | 'casino' | 'matka' | 'global'
  type?: string
  search?: string
}

export type BonusCampaignCreateInput = {
  name: string
  domain: 'sports' | 'casino' | 'matka' | 'global'
  type: string
  status?: 'draft' | 'active' | 'paused' | 'ended'
  budgetNumeric?: number
  currency: string
  rulesJson?: any
  codeMode?: 'auto' | 'claim' | 'code'
  validFrom?: string
  validTo?: string
  limitsJson?: any
  directSubType?: string
  depositConditionType?: 'greater_than' | 'equal_to' | 'less_than' | 'greater_equal' | 'less_equal'
  depositConditionAmount?: number
  distributionType?: 'instant_otp' | 'instant_cash' | 'roll_over'
  amountType?: 'fixed' | 'percentage'
  amount?: number
  percentage?: number
  numberOfPlayers?: number
  usagePerPlayer?: number
  startDate?: string
  endDate?: string
  wagering?: number
  expiryBonusDays?: number | null
  depositRequired?: boolean
  releaseType?: 'bonus_amount_only' | 'total_bonus_wallet'
}

export type BonusCampaignUpdateInput = Partial<BonusCampaignCreateInput> & {
  id: number
}

export async function listBonusCampaignsDb(tenant: string, filters: BonusCampaignFilters = {}) {
  const conditions = [eq(bonusCampaigns.tenant, tenant)]

  if (filters.status) {
    conditions.push(eq(bonusCampaigns.status, filters.status))
  }

  if (filters.domain) {
    conditions.push(eq(bonusCampaigns.domain, filters.domain))
  }

  if (filters.type) {
    conditions.push(eq(bonusCampaigns.type, filters.type as any))
  }

  if (filters.search && filters.search.length > 0) {
    conditions.push(like(bonusCampaigns.name, `%${filters.search}%`))
  }

  return db
    .select()
    .from(bonusCampaigns)
    .where(and(...conditions))
    .orderBy(desc(bonusCampaigns.createdAt))
}

export async function getBonusCampaignDb(id: number, tenant: string) {
  const rows = await db
    .select()
    .from(bonusCampaigns)
    .where(and(eq(bonusCampaigns.id, id), eq(bonusCampaigns.tenant, tenant)))
    .limit(1)

  return rows[0] || null
}

/** Returns the active signup bonus campaign for the tenant, or null if none. */
export async function getActiveSignupCampaignDb(tenant: string) {
  const rows = await db
    .select()
    .from(bonusCampaigns)
    .where(
      and(
        eq(bonusCampaigns.tenant, tenant),
        eq(bonusCampaigns.type, 'signup'),
        eq(bonusCampaigns.status, 'active')
      )
    )
    .limit(1)
  return rows[0] || null
}

const ONLY_ONE_SIGNUP_ACTIVE_MESSAGE =
  'Only one signup bonus campaign can be active at a time. Please pause or end the current active signup campaign first.'

export async function createBonusCampaignDb(input: BonusCampaignCreateInput & { tenant: string }) {
  const effectiveStatus = input.status || 'draft'
  if (input.type === 'signup' && effectiveStatus === 'active') {
    const existing = await getActiveSignupCampaignDb(input.tenant)
    if (existing) {
      throw new Error(ONLY_ONE_SIGNUP_ACTIVE_MESSAGE)
    }
  }

  const validReleaseType = input.releaseType === 'bonus_amount_only' || input.releaseType === 'total_bonus_wallet' ? input.releaseType : undefined
  const validDistributionType = (input.distributionType === 'instant_otp' || input.distributionType === 'instant_cash' || input.distributionType === 'roll_over') ? input.distributionType : undefined
  const validAmountType = (input.amountType === 'fixed' || input.amountType === 'percentage') ? input.amountType : undefined

  const row: Record<string, unknown> = {
    tenant: input.tenant,
    name: input.name,
    domain: input.domain,
    type: input.type,
    status: input.status || 'draft',
    budgetNumeric: String(input.budgetNumeric || 0),
    currency: input.currency,
    rulesJson: input.rulesJson || null,
    codeMode: (input.codeMode || 'auto') as any,
    validFrom: input.validFrom ? new Date(input.validFrom) : null,
    validTo: input.validTo ? new Date(input.validTo) : null,
    limitsJson: input.limitsJson || null,
    directSubType: (input.directSubType && String(input.directSubType).trim()) || null,
    depositConditionType: input.depositConditionType || null,
    depositConditionAmount: input.depositConditionAmount ? String(input.depositConditionAmount) : null,
    amount: input.amount != null ? String(input.amount) : null,
    percentage: input.percentage != null ? String(input.percentage) : null,
    numberOfPlayers: input.numberOfPlayers ?? null,
    usagePerPlayer: input.usagePerPlayer ?? null,
    startDate: input.startDate ? parseDateFrom(input.startDate, 'Asia/Kolkata') : null,
    endDate: input.endDate ? parseDateTo(input.endDate, 'Asia/Kolkata') : null,
    wagering: input.wagering != null ? String(input.wagering) : null,
    expiryBonusDays: input.expiryBonusDays ?? null,
    depositRequired: input.depositRequired ?? false,
    activatedAt: (input.status || 'draft') === 'active' ? new Date() : null,
  }
  if (validDistributionType) row.distributionType = validDistributionType
  if (validAmountType) row.amountType = validAmountType
  if (validReleaseType) row.releaseType = validReleaseType

  const inserted = await db
    .insert(bonusCampaigns)
    .values(row as any)
    .returning()

  return inserted[0]
}

export async function updateBonusCampaignDb(id: number, tenant: string, input: BonusCampaignUpdateInput) {
  const updateData: any = {}

  if (input.name !== undefined) updateData.name = input.name
  if (input.domain !== undefined) updateData.domain = input.domain
  if (input.type !== undefined) updateData.type = input.type as any
  if (input.status !== undefined) updateData.status = input.status as any
  if (input.budgetNumeric !== undefined) updateData.budgetNumeric = String(input.budgetNumeric)
  if (input.currency !== undefined) updateData.currency = input.currency
  if (input.rulesJson !== undefined) updateData.rulesJson = input.rulesJson
  if (input.codeMode !== undefined) updateData.codeMode = input.codeMode as any
  if (input.validFrom !== undefined) updateData.validFrom = input.validFrom ? parseDateFrom(input.validFrom, 'Asia/Kolkata') : null
  if (input.validTo !== undefined) updateData.validTo = input.validTo ? parseDateTo(input.validTo, 'Asia/Kolkata') : null
  if (input.limitsJson !== undefined) updateData.limitsJson = input.limitsJson
  if (input.directSubType !== undefined) updateData.directSubType = input.directSubType === null || input.directSubType === '' ? null : input.directSubType
  if (input.depositConditionType !== undefined) updateData.depositConditionType = input.depositConditionType
  if (input.depositConditionAmount !== undefined) updateData.depositConditionAmount = input.depositConditionAmount ? String(input.depositConditionAmount) : null
  if (input.distributionType !== undefined) updateData.distributionType = input.distributionType
  if (input.amountType !== undefined) updateData.amountType = input.amountType
  if (input.amount !== undefined) updateData.amount = input.amount ? String(input.amount) : null
  if (input.percentage !== undefined) updateData.percentage = input.percentage ? String(input.percentage) : null
  if (input.numberOfPlayers !== undefined) updateData.numberOfPlayers = input.numberOfPlayers
  if (input.usagePerPlayer !== undefined) updateData.usagePerPlayer = input.usagePerPlayer
  if (input.startDate !== undefined) updateData.startDate = input.startDate ? parseDateFrom(input.startDate, 'Asia/Kolkata') : null
  if (input.endDate !== undefined) updateData.endDate = input.endDate ? parseDateTo(input.endDate, 'Asia/Kolkata') : null
  if (input.wagering !== undefined) updateData.wagering = input.wagering ? String(input.wagering) : null
  if (input.expiryBonusDays !== undefined) updateData.expiryBonusDays = input.expiryBonusDays
  if (input.depositRequired !== undefined) updateData.depositRequired = input.depositRequired
  if (input.releaseType !== undefined) updateData.releaseType = input.releaseType as any

  if (input.status === 'active') {
    const current = await getBonusCampaignDb(id, tenant)
    if (current?.type === 'signup') {
      const activeSignup = await getActiveSignupCampaignDb(tenant)
      if (activeSignup && activeSignup.id !== id) {
        throw new Error(ONLY_ONE_SIGNUP_ACTIVE_MESSAGE)
      }
    }
    if (current && current.status !== 'active' && (current as any).activatedAt == null) {
      updateData.activatedAt = new Date()
    }
  }

  updateData.updatedAt = new Date()

  const updated = await db
    .update(bonusCampaigns)
    .set(updateData)
    .where(and(eq(bonusCampaigns.id, id), eq(bonusCampaigns.tenant, tenant)))
    .returning()

  return updated[0] || null
}

export async function deleteBonusCampaignDb(id: number, tenant: string): Promise<boolean> {
  await db.delete(bonusCodes).where(eq(bonusCodes.campaignId, id))
  const res = await db.delete(bonusCampaigns)
    .where(and(eq(bonusCampaigns.id, id), eq(bonusCampaigns.tenant, tenant)))
    .returning({ id: bonusCampaigns.id })
  return res.length > 0
}

export async function createBonusCodeDb(campaignId: number, code: string, input?: {
  maxUses?: number
  perUserLimit?: number
  expiresAt?: Date | string
}) {
  const [bonusCode] = await db.insert(bonusCodes).values({
    campaignId,
    code,
    maxUses: input?.maxUses ?? 0,
    perUserLimit: input?.perUserLimit ?? 1,
    expiresAt: input?.expiresAt ? new Date(input.expiresAt) : null,
  }).returning()
  return bonusCode
}

export async function saveBonusCampaignGamesDb(
  campaignId: number,
  tenant: string,
  gameIds: string[],
  gameWeights?: Record<string, number>
) {
  // Get existing campaign
  const campaign = await getBonusCampaignDb(campaignId, tenant)
  if (!campaign) {
    throw new Error('Campaign not found')
  }

  // Update rulesJson with game assignments
  const rulesJson = (campaign.rulesJson as any) || {}
  rulesJson.casinoGameIds = gameIds
  if (gameWeights) {
    rulesJson.casinoGameWeights = gameWeights
  }

  return updateBonusCampaignDb(campaignId, tenant, {
    id: campaignId,
    rulesJson,
  })
}

export async function saveBonusCampaignMatkasDb(
  campaignId: number,
  tenant: string,
  matkaIds: string[],
  matkaBidTypeWeights?: Record<string, Record<string, number>>
) {
  // Get existing campaign
  const campaign = await getBonusCampaignDb(campaignId, tenant)
  if (!campaign) {
    throw new Error('Campaign not found')
  }

  // Update rulesJson with Matka assignments
  const rulesJson = (campaign.rulesJson as any) || {}
  rulesJson.matkaGameIds = matkaIds
  if (matkaBidTypeWeights) {
    rulesJson.matkaBidTypeWeights = matkaBidTypeWeights
  }

  return updateBonusCampaignDb(campaignId, tenant, {
    id: campaignId,
    rulesJson,
  })
}

type RulesJson = {
  excludedPlayerIds?: (number | string)[]
  excludedAgentIds?: string[]
}

/** Normalize exclusion lists from rulesJson: player IDs as numbers, agent IDs as strings. */
function normalizeExclusionLists(rules: RulesJson): { excludedPlayerIds: number[]; excludedAgentIds: string[] } {
  const rawPlayerIds = Array.isArray(rules.excludedPlayerIds) ? rules.excludedPlayerIds : []
  const rawAgentIds = Array.isArray(rules.excludedAgentIds) ? rules.excludedAgentIds : []
  const excludedPlayerIds = rawPlayerIds
    .map((id) => (typeof id === 'string' ? parseInt(id, 10) : Number(id)))
    .filter((n) => Number.isFinite(n))
  const excludedAgentIds = rawAgentIds.map((id) => String(id)).filter(Boolean)
  return { excludedPlayerIds, excludedAgentIds }
}

/**
 * Returns eligible user IDs for direct bonus distribution.
 * Filters: tenant, status=active, bonusAllowed=true; excludes rulesJson lists; no existing award; respects numberOfPlayers.
 */
export async function getEligibleUsersForDistribution(
  campaignId: number,
  tenant: string,
  campaign: { tenant: string; rulesJson: unknown; numberOfPlayers: number | null }
): Promise<number[]> {
  const rules = (campaign.rulesJson as RulesJson) || {}
  const { excludedPlayerIds, excludedAgentIds } = normalizeExclusionLists(rules)

  const conditions = [
    eq(users.tenant, tenant),
    eq(users.status, 'active'),
    eq(users.bonusAllowed, true),
  ]
  if (excludedPlayerIds.length > 0) {
    conditions.push(notInArray(users.id, excludedPlayerIds))
  }
  if (excludedAgentIds.length > 0) {
    conditions.push(or(sql`${users.agentId} IS NULL`, notInArray(users.agentId, excludedAgentIds))!)
  }

  const existingAwardUserIds = await db
    .select({ userId: bonusAwards.userId })
    .from(bonusAwards)
    .where(eq(bonusAwards.campaignId, campaignId))

  const excludedByAward = existingAwardUserIds.map((r) => r.userId)
  if (excludedByAward.length > 0) {
    conditions.push(notInArray(users.id, excludedByAward))
  }

  const existingCount = existingAwardUserIds.length
  const maxNew = campaign.numberOfPlayers != null && campaign.numberOfPlayers > 0
    ? Math.max(0, campaign.numberOfPlayers - existingCount)
    : undefined
  if (maxNew !== undefined && maxNew === 0) {
    return []
  }

  const baseQuery = db
    .select({ id: users.id })
    .from(users)
    .where(and(...conditions))
    .orderBy(users.id)

  const rows = maxNew != null && maxNew > 0
    ? await baseQuery.limit(maxNew)
    : await baseQuery
  return rows.map((r) => r.id)
}

/**
 * Bulk-create bonus awards for eligible users and set campaign.distributedAt.
 * Caller must ensure campaign type is direct_amount and distributedAt is null.
 */
export async function distributeBonusCampaignDb(
  campaignId: number,
  tenant: string
): Promise<{ distributedCount: number }> {
  const campaign = await getBonusCampaignDb(campaignId, tenant)
  if (!campaign) {
    throw new Error('Campaign not found')
  }
  if (campaign.type !== 'direct_amount') {
    throw new Error('Distribution only allowed for Direct Bonus campaigns')
  }
  if (campaign.distributedAt != null) {
    throw new Error(`Bonus has already been distributed on ${campaign.distributedAt.toISOString()}`)
  }

  const eligibleIds = await getEligibleUsersForDistribution(campaignId, tenant, campaign)
  if (eligibleIds.length === 0) {
    throw new Error('No eligible users for distribution')
  }

  const bonusAmount = Number(campaign.amount ?? 0)
  if (bonusAmount <= 0) {
    throw new Error('Invalid bonus amount: campaign amount must be greater than zero')
  }
  const wageringReq = campaign.wagering ? Number(campaign.wagering) * bonusAmount : 0

  const values = eligibleIds.map((userId) => ({
    campaignId: campaign.id,
    userId,
    domain: campaign.domain,
    type: campaign.type,
    amount: String(bonusAmount),
    currency: campaign.currency,
    wageringReq: String(wageringReq),
    currentWagering: '0',
    status: 'pending' as const,
    firstDepositRequired: false,
    distributionType: campaign.distributionType ?? null,
    releaseType: campaign.releaseType ?? null,
  }))

  await db.transaction(async (tx) => {
    await tx.insert(bonusAwards).values(values)
    await tx
      .update(bonusCampaigns)
      .set({ distributedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(bonusCampaigns.id, campaignId), eq(bonusCampaigns.tenant, tenant)))
  })

  return { distributedCount: eligibleIds.length }
}

const MANUAL_BONUS_CAMPAIGN_NAME = 'Manual / Admin grants'

/** Get or create the system campaign used for manual/admin bonus grants. */
export async function getOrCreateManualBonusCampaign(tenant: string) {
  const existing = await db
    .select()
    .from(bonusCampaigns)
    .where(
      and(
        eq(bonusCampaigns.tenant, tenant),
        eq(bonusCampaigns.name, MANUAL_BONUS_CAMPAIGN_NAME)
      )
    )
    .limit(1)
  if (existing[0]) return existing[0]
  const inserted = await db
    .insert(bonusCampaigns)
    .values({
      tenant,
      name: MANUAL_BONUS_CAMPAIGN_NAME,
      domain: 'global',
      type: 'direct_amount',
      status: 'draft',
      currency: 'INR',
    })
    .returning()
  const created = inserted[0]
  if (!created) throw new Error('Failed to create manual bonus campaign')
  return created
}

export type CreateManualBonusAwardInput = {
  amount: number
  currency: string
  bonusType: string
  wageringRequirement?: number
}

/** Create a bonus_awards row for an admin/manual grant so it appears in player bonuses list. */
export async function createManualBonusAward(
  tenant: string,
  userId: number,
  input: CreateManualBonusAwardInput
) {
  const campaign = await getOrCreateManualBonusCampaign(tenant)
  const wageringReq = input.wageringRequirement ?? 0
  const inserted = await db
    .insert(bonusAwards)
    .values({
      campaignId: campaign.id,
      userId,
      domain: 'global',
      type: 'direct_amount',
      amount: String(input.amount),
      currency: input.currency,
      wageringReq: String(wageringReq),
      currentWagering: '0',
      status: 'active',
      firstDepositRequired: false,
      distributionType: campaign.distributionType ?? null,
      releaseType: campaign.releaseType ?? null,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Failed to create bonus award')
  return row
}

/**
 * Create a pending bonus award for a special bonus campaign. No wallet credit; user activates later.
 * Campaign must be type 'special' and status 'active'.
 */
export async function createSpecialBonusAward(
  tenant: string,
  userId: number,
  campaignId: number,
  amount: number,
  currency?: string
) {
  const campaign = await getBonusCampaignDb(campaignId, tenant)
  if (!campaign) throw new Error('Campaign not found')
  if (campaign.type !== 'special') throw new Error('Campaign is not a Special Bonus campaign')
  if (campaign.status !== 'active') throw new Error('Campaign is not active')
  const effectiveCurrency = currency ?? campaign.currency ?? 'INR'
  const wagering = campaign.wagering ? Number(campaign.wagering) * amount : 0
  const [row] = await db
    .insert(bonusAwards)
    .values({
      campaignId: campaign.id,
      userId,
      domain: campaign.domain ?? 'global',
      type: 'special',
      amount: String(amount),
      currency: effectiveCurrency,
      wageringReq: String(wagering),
      currentWagering: '0',
      status: 'pending',
      firstDepositRequired: false,
      distributionType: campaign.distributionType ?? null,
      releaseType: campaign.releaseType ?? null,
    })
    .returning()
  if (!row) throw new Error('Failed to create special bonus award')
  return row
}

/** Count how many bonus awards a user has received for a given campaign (for usagePerPlayer cap). */
export async function countAwardsByCampaignAndUser(campaignId: number, userId: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bonusAwards)
    .where(and(eq(bonusAwards.campaignId, campaignId), eq(bonusAwards.userId, userId)))
  return Number(rows[0]?.count ?? 0)
}

/** Count awards for campaign+user with awardedAt >= since (for same-day idempotency: avoid duplicate run). */
export async function countAwardsByCampaignAndUserSince(
  campaignId: number,
  userId: number,
  since: Date
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bonusAwards)
    .where(
      and(
        eq(bonusAwards.campaignId, campaignId),
        eq(bonusAwards.userId, userId),
        gte(bonusAwards.awardedAt, since)
      )
    )
  return Number(rows[0]?.count ?? 0)
}

export type CreateLosingBonusAwardParams = {
  campaignId: number
  userId: number
  domain: 'sports' | 'casino' | 'matka' | 'global'
  currency: string
  amount: number
  wageringReq: number
  triggerAmount: number
}

/** Create a single pending bonus award for losing bonus (weekly job). */
export async function createLosingBonusAward(params: CreateLosingBonusAwardParams) {
  const [campaignSnap] = await db
    .select({
      distributionType: bonusCampaigns.distributionType,
      releaseType: bonusCampaigns.releaseType,
    })
    .from(bonusCampaigns)
    .where(eq(bonusCampaigns.id, params.campaignId))
    .limit(1)

  const [row] = await db
    .insert(bonusAwards)
    .values({
      campaignId: params.campaignId,
      userId: params.userId,
      domain: params.domain,
      type: 'losing_bonus',
      amount: String(params.amount),
      currency: params.currency,
      wageringReq: String(params.wageringReq),
      currentWagering: '0',
      status: 'pending',
      firstDepositRequired: false,
      triggerAmount: String(params.triggerAmount),
      distributionType: campaignSnap?.distributionType ?? null,
      releaseType: campaignSnap?.releaseType ?? null,
    })
    .returning({ id: bonusAwards.id })
  return row!
}

export type BonusAwardAdminStatusActor = {
  name: string
  phone: string | null
  remark: string | null
}

/** Update bonus award status (e.g. for revoke/cancel). Returns true if updated. */
export async function updateBonusAwardStatus(
  awardId: number,
  status: 'active' | 'completed' | 'expired' | 'cancelled' | 'pending',
  adminActor?: BonusAwardAdminStatusActor | null,
  actionRemark?: string | null,
) {
  const setPayload: Record<string, unknown> = { status: status as any }
  if (adminActor) {
    const note = actionRemark?.trim() || null
    setPayload.adminStatusUpdatedAt = new Date()
    setPayload.adminStatusUpdatedByName = adminActor.name
    setPayload.adminStatusUpdatedByPhone = adminActor.phone
    setPayload.adminStatusUpdatedByRemark = note ?? adminActor.remark
  }
  const result = await db
    .update(bonusAwards)
    .set(setPayload as any)
    .where(eq(bonusAwards.id, awardId))
    .returning({ id: bonusAwards.id })
  return result.length > 0
}

/** Stamp admin/agent identity after activate/switch (status already updated inside shared core). */
export async function touchBonusAwardAdminStatusActorDb(
  awardId: number,
  adminActor: BonusAwardAdminStatusActor,
  actionRemark?: string | null,
) {
  const note = actionRemark?.trim() || null
  await db
    .update(bonusAwards)
    .set({
      adminStatusUpdatedAt: new Date(),
      adminStatusUpdatedByName: adminActor.name,
      adminStatusUpdatedByPhone: adminActor.phone,
      adminStatusUpdatedByRemark: note ?? adminActor.remark,
    } as any)
    .where(eq(bonusAwards.id, awardId))
}

/** Get a single bonus award by id with campaign tenant (for revoke/access check). */
export async function getBonusAwardById(awardId: number): Promise<{
  id: number
  userId: number
  amount: string
  currency: string
  status: string
  awardedAt: Date
  campaignTenant: string
} | null> {
  const rows = await db
    .select({
      id: bonusAwards.id,
      userId: bonusAwards.userId,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      status: bonusAwards.status,
      awardedAt: bonusAwards.awardedAt,
      campaignTenant: bonusCampaigns.tenant,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusAwards.campaignId, bonusCampaigns.id))
    .where(eq(bonusAwards.id, awardId))
    .limit(1)
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    userId: r.userId,
    amount: r.amount ?? '0',
    currency: r.currency ?? 'INR',
    status: r.status,
    awardedAt: r.awardedAt,
    campaignTenant: r.campaignTenant,
  }
}

/**
 * Forfeit a single active bonus award: zero bonus wallet (with ledger lines) and mark award cancelled.
 * Mirrors user-backend `forfeitBonusAward` but targets a specific award id (must be active).
 */
export async function forfeitBonusAwardByIdAdmin(params: {
  awardId: number
  tenant: string
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rows = await db
    .select({
      id: bonusAwards.id,
      userId: bonusAwards.userId,
      status: bonusAwards.status,
      campaignId: bonusAwards.campaignId,
      currency: bonusAwards.currency,
      campaignTenant: bonusCampaigns.tenant,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusAwards.campaignId, bonusCampaigns.id))
    .where(eq(bonusAwards.id, params.awardId))
    .limit(1)

  const award = rows[0]
  if (!award) return { ok: false, reason: 'Bonus award not found' }
  if (award.campaignTenant !== params.tenant) {
    return { ok: false, reason: 'Unauthorized: bonus belongs to another tenant' }
  }
  if (award.status !== 'active') {
    return { ok: false, reason: `Only active bonus cards can be forfeited (current: ${award.status})` }
  }

  const wallet = await ensurePlayerWalletDb(award.userId, params.tenant, award.currency || undefined)
  const currentBonusBalance = Number(wallet.bonus || 0)

  await db.transaction(async (tx) => {
    if (currentBonusBalance > 0) {
      await tx.update(wallets).set({ bonus: '0' }).where(eq(wallets.id, wallet.id))

      await tx.insert(ledgerEntries).values({
        tenant: params.tenant,
        walletId: wallet.id,
        type: 'debit',
        amount: String(currentBonusBalance),
        balanceBefore: String(currentBonusBalance),
        balanceAfter: '0',
        meta: {
          type: 'bonus_forfeit',
          bonusAwardId: award.id,
          campaignId: award.campaignId,
          currency: award.currency || 'INR',
          source: 'admin',
        } as Record<string, unknown>,
      })

      await createWalletLedgerEntry(tx, {
        tenant: params.tenant,
        walletId: wallet.id,
        userId: award.userId,
        walletType: 'bonus',
        category: 'bonus_forfeit',
        direction: 'debit',
        amount: currentBonusBalance,
        balanceBefore: currentBonusBalance,
        balanceAfter: 0,
        description: 'Bonus forfeit (admin)',
        referenceType: 'bonus_award',
        referenceId: String(award.id),
        meta: { bonusAwardId: award.id, campaignId: award.campaignId, source: 'admin' },
      })
    }

    await tx
      .update(bonusAwards)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(bonusAwards.id, params.awardId))
  })

  return { ok: true }
}

export type PlayerBonusRow = {
  id: number
  campaignId: number
  type: string
  name: string
  domain: string
  amount: string
  currency: string
  status: string
  distributionType: string | null
  grantedAt: Date
  completedAt: Date | null
  expiresAt: string | null
  triggerAmount: number | null
  wageringRequirement: number
  wageringCompleted: number
  wageringRemaining: number
  firstDepositRequired: boolean
  firstDepositUnlocked: boolean
  contributionRules: string | null
}

export async function getActiveBonusCountForPlayer(userId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(bonusAwards)
    .where(
      and(
        eq(bonusAwards.userId, userId),
        inArray(bonusAwards.status, ['active', 'pending'])
      )
    )
  return Number(row?.count ?? 0)
}

/** List all bonus awards for a player (campaign + manual) for profile Bonuses tab. Optionally scoped by tenant. */
export async function listBonusAwardsByUserId(userId: number, tenant?: string): Promise<PlayerBonusRow[]> {
  const conditions = [eq(bonusAwards.userId, userId)]
  if (tenant != null && tenant !== '') {
    conditions.push(eq(bonusCampaigns.tenant, tenant))
  }
  const rows = await db
    .select({
      id: bonusAwards.id,
      campaignId: bonusAwards.campaignId,
      type: bonusAwards.type,
      domain: bonusAwards.domain,
      campaignName: bonusCampaigns.name,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      status: bonusAwards.status,
      awardedAt: bonusAwards.awardedAt,
      completedAt: bonusAwards.completedAt,
      triggerAmount: bonusAwards.triggerAmount,
      firstDepositRequired: bonusAwards.firstDepositRequired,
      firstDepositUnlocked: bonusAwards.firstDepositUnlocked,
      wageringReq: bonusAwards.wageringReq,
      currentWagering: bonusAwards.currentWagering,
      // Award-level snapshot (grant-time) preferred over live campaign value
      awardDistributionType: bonusAwards.distributionType,
      // Campaign fields (fallback)
      distributionTypeCampaign: bonusCampaigns.distributionType,
      expiryBonusDays: bonusCampaigns.expiryBonusDays,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusAwards.campaignId, bonusCampaigns.id))
    .where(and(...conditions))
    .orderBy(desc(bonusAwards.awardedAt))

  return rows.map((r) => {
    const req = Number(r.wageringReq ?? 0)
    const completed = Number(r.currentWagering ?? 0)
    // Compute expiresAt from awardedAt + expiryBonusDays
    let expiresAt: string | null = null
    if (r.expiryBonusDays && r.awardedAt) {
      expiresAt = DateTime.fromJSDate(new Date(r.awardedAt), { zone: 'Asia/Kolkata' })
        .plus({ days: r.expiryBonusDays })
        .toJSDate()
        .toISOString()
    }
    return {
      id: r.id,
      campaignId: r.campaignId,
      type: r.type,
      name: r.campaignName ?? r.type,
      domain: r.domain ?? 'global',
      amount: String(r.amount ?? 0),
      currency: r.currency ?? 'INR',
      status: r.status,
      distributionType: (r.awardDistributionType ?? r.distributionTypeCampaign) ?? null,
      grantedAt: r.awardedAt,
      completedAt: r.completedAt ?? null,
      expiresAt,
      triggerAmount: r.triggerAmount ? Number(r.triggerAmount) : null,
      wageringRequirement: req,
      wageringCompleted: completed,
      wageringRemaining: Math.max(0, req - completed),
      firstDepositRequired: r.firstDepositRequired ?? false,
      firstDepositUnlocked: r.firstDepositUnlocked ?? false,
      contributionRules: null,
    }
  })
}

export type BonusAwardsAdminPageFilters = {
  dateFrom?: string
  dateTo?: string
  status?: string[]
  domain?: 'sports' | 'casino' | 'matka' | 'global'
  campaignId?: number
}

export type BonusAwardAdminRow = {
  id: number
  campaignId: number
  campaignName: string
  userId: number
  userName: string | null
  userPhone: string | null
  domain: string
  type: string
  amount: string
  currency: string
  wageringReq: string
  currentWagering: string
  status: string
  awardedAt: Date
  completedAt: Date | null
  triggerAmount: string | null
  firstDepositRequired: boolean | null
  firstDepositUnlocked: boolean | null
  distributionType: string | null
  statusUpdatedAt: Date | null
  statusUpdatedByName: string | null
  statusUpdatedByPhone: string | null
  statusUpdatedByRemark: string | null
  /** ISO timestamp from awardedAt + campaign.expiryBonusDays (IST), or null if not set. */
  expiresAt: string | null
}

function buildBonusAwardsAdminWhere(
  tenant: string,
  filters: BonusAwardsAdminPageFilters,
  userIds: number[] | undefined,
  tz: string,
) {
  const conditions: any[] = [eq(bonusCampaigns.tenant, tenant)]

  if (userIds !== undefined) {
    conditions.push(inArray(bonusAwards.userId, userIds))
  }

  if (filters.campaignId != null && Number.isFinite(filters.campaignId)) {
    conditions.push(eq(bonusAwards.campaignId, filters.campaignId))
  }

  if (filters.dateFrom) {
    conditions.push(gte(bonusAwards.awardedAt, parseDateFrom(filters.dateFrom, tz)))
  }
  if (filters.dateTo) {
    conditions.push(lte(bonusAwards.awardedAt, parseDateTo(filters.dateTo, tz)))
  }

  if (filters.status?.length) {
    conditions.push(inArray(bonusAwards.status, filters.status as any))
  }

  if (filters.domain) {
    conditions.push(eq(bonusAwards.domain, filters.domain as any))
  }

  return and(...conditions)
}

/** Paginated bonus awards (user “bonus cards”) for admin list — tenant-scoped, optional userIds filter. */
export async function listBonusAwardsAdminPage(
  tenant: string,
  filters: BonusAwardsAdminPageFilters,
  offset: number,
  limit: number,
  userIds: number[] | undefined,
): Promise<{ items: BonusAwardAdminRow[]; total: number }> {
  if (userIds !== undefined && userIds.length === 0) {
    return { items: [], total: 0 }
  }

  const whereClause = buildBonusAwardsAdminWhere(tenant, filters, userIds, BONUS_AWARDS_ADMIN_TZ)

  const userJoin = and(eq(bonusAwards.userId, users.id), eq(users.tenant, tenant))

  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusAwards.campaignId, bonusCampaigns.id))
    .leftJoin(users, userJoin)
    .where(whereClause)

  const total = Number(countRow?.c ?? 0)

  const rows = await db
    .select({
      id: bonusAwards.id,
      campaignId: bonusAwards.campaignId,
      campaignName: bonusCampaigns.name,
      userId: bonusAwards.userId,
      userName: users.name,
      userUsername: users.username,
      userPhone: users.phone,
      domain: bonusAwards.domain,
      type: bonusAwards.type,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      wageringReq: bonusAwards.wageringReq,
      currentWagering: bonusAwards.currentWagering,
      status: bonusAwards.status,
      awardedAt: bonusAwards.awardedAt,
      completedAt: bonusAwards.completedAt,
      triggerAmount: bonusAwards.triggerAmount,
      firstDepositRequired: bonusAwards.firstDepositRequired,
      firstDepositUnlocked: bonusAwards.firstDepositUnlocked,
      awardDistributionType: bonusAwards.distributionType,
      distributionTypeCampaign: bonusCampaigns.distributionType,
      statusUpdatedAt: bonusAwards.adminStatusUpdatedAt,
      statusUpdatedByName: bonusAwards.adminStatusUpdatedByName,
      statusUpdatedByPhone: bonusAwards.adminStatusUpdatedByPhone,
      statusUpdatedByRemark: bonusAwards.adminStatusUpdatedByRemark,
      expiryBonusDays: bonusCampaigns.expiryBonusDays,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusAwards.campaignId, bonusCampaigns.id))
    .leftJoin(users, userJoin)
    .where(whereClause)
    .orderBy(desc(bonusAwards.awardedAt), desc(bonusAwards.id))
    .limit(limit)
    .offset(offset)

  const items: BonusAwardAdminRow[] = rows.map((r) => {
    const awarded =
      r.awardedAt instanceof Date ? r.awardedAt : new Date(r.awardedAt as unknown as string)
    let expiresAt: string | null = null
    if (r.expiryBonusDays != null && r.expiryBonusDays > 0 && awarded) {
      expiresAt = DateTime.fromJSDate(awarded, { zone: BONUS_AWARDS_ADMIN_TZ })
        .plus({ days: r.expiryBonusDays })
        .toJSDate()
        .toISOString()
    }
    return {
      id: r.id,
      campaignId: r.campaignId,
      campaignName: r.campaignName ?? '',
      userId: r.userId,
      userName: r.userName || r.userUsername || null,
      userPhone: r.userPhone ?? null,
      domain: r.domain ?? 'global',
      type: r.type,
      amount: String(r.amount ?? 0),
      currency: r.currency ?? 'INR',
      wageringReq: String(r.wageringReq ?? 0),
      currentWagering: String(r.currentWagering ?? 0),
      status: r.status,
      awardedAt: awarded,
      completedAt: r.completedAt ? (r.completedAt instanceof Date ? r.completedAt : new Date(r.completedAt)) : null,
      triggerAmount: r.triggerAmount != null ? String(r.triggerAmount) : null,
      firstDepositRequired: r.firstDepositRequired ?? null,
      firstDepositUnlocked: r.firstDepositUnlocked ?? null,
      distributionType: (r.awardDistributionType ?? r.distributionTypeCampaign) ?? null,
      statusUpdatedAt: r.statusUpdatedAt
        ? r.statusUpdatedAt instanceof Date
          ? r.statusUpdatedAt
          : new Date(r.statusUpdatedAt as unknown as string)
        : null,
      statusUpdatedByName: r.statusUpdatedByName ?? null,
      statusUpdatedByPhone: r.statusUpdatedByPhone ?? null,
      statusUpdatedByRemark: r.statusUpdatedByRemark ?? null,
      expiresAt,
    }
  })

  return { items, total }
}

export type BonusAwardsAdminPageStats = {
  total: number
  pending: number
  active: number
  completed: number
  expired: number
  cancelled: number
  totalBonusPaid: number
  /** Sum of wallets.bonus for scoped users (tenant + optional userIds from list scope). */
  bonusWalletTotal: number
  /** Sum of max(0, wageringReq - currentWagering) for active awards matching list filters. */
  wageringRemaining: number
  bonusUses: number
  /** Sum of cash credits from bonus → cash for bonus cards matching list filters (awarded date etc.), not ledger post date. */
  bonusToCashTransferred: number
}

function emptyBonusAwardsAdminPageStats(): BonusAwardsAdminPageStats {
  return {
    total: 0,
    pending: 0,
    active: 0,
    completed: 0,
    expired: 0,
    cancelled: 0,
    totalBonusPaid: 0,
    bonusWalletTotal: 0,
    wageringRemaining: 0,
    bonusUses: 0,
    bonusToCashTransferred: 0,
  }
}

/** Status breakdown for bonus cards list — same filters / scope as listBonusAwardsAdminPage. */
export async function aggregateBonusAwardsAdminPageStats(
  tenant: string,
  filters: BonusAwardsAdminPageFilters,
  userIds: number[] | undefined,
): Promise<BonusAwardsAdminPageStats> {
  if (userIds !== undefined && userIds.length === 0) {
    return emptyBonusAwardsAdminPageStats()
  }

  const whereClause = buildBonusAwardsAdminWhere(tenant, filters, userIds, BONUS_AWARDS_ADMIN_TZ)
  const userJoin = and(eq(bonusAwards.userId, users.id), eq(users.tenant, tenant))

  const statusPromise = db
    .select({
      status: bonusAwards.status,
      cnt: sql<number>`count(*)::int`,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusAwards.campaignId, bonusCampaigns.id))
    .leftJoin(users, userJoin)
    .where(whereClause)
    .groupBy(bonusAwards.status)

  const financialPromise = db
    .select({
      totalBonusPaid: sql<string>`
        coalesce(sum(
          case
            when ${bonusAwards.status}::text in ('active', 'completed')
            then coalesce(${bonusAwards.amount}, 0)::numeric
            else 0::numeric
          end
        ), 0)::text
      `,
      wageringRemaining: sql<string>`
        coalesce(sum(
          case
            when ${bonusAwards.status}::text = 'active'
            then greatest(
              0::numeric,
              coalesce(${bonusAwards.wageringReq}, 0)::numeric
                - coalesce(${bonusAwards.currentWagering}, 0)::numeric
            )
            else 0::numeric
          end
        ), 0)::text
      `,
      bonusUses: sql<number>`
        coalesce(
          count(*) filter (where ${bonusAwards.status}::text in ('active', 'completed')),
          0
        )::int
      `,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusAwards.campaignId, bonusCampaigns.id))
    .leftJoin(users, userJoin)
    .where(whereClause)

  const walletWhere =
    userIds !== undefined ? and(eq(wallets.tenant, tenant), inArray(wallets.userId, userIds)) : eq(wallets.tenant, tenant)

  const walletPromise = db
    .select({
      sumBonus: sql<string>`coalesce(sum(${wallets.bonus}), 0)::text`,
    })
    .from(wallets)
    .where(walletWhere)

  /**
   * Bonus → cash must use the same semantic date scope as the table: filters apply to bonus_awards.awardedAt.
   * Summing wallet_ledger by createdAt in that range double-counts unrelated transfers (e.g. card awarded earlier
   * but released yesterday) and misses cards awarded in-range whose transfer happened later.
   */
  const ledgerBase: SQL[] = [
    eq(walletLedger.tenant, tenant),
    eq(walletLedger.walletType, 'cash'),
    eq(walletLedger.direction, 'credit'),
    eq(walletLedger.category, 'bonus_transfer'),
  ]
  if (userIds !== undefined) {
    ledgerBase.push(inArray(walletLedger.userId, userIds))
  }
  const ledgerToAwardLink = or(
    and(eq(walletLedger.referenceType, 'bonus_award'), sql`${walletLedger.referenceId} = ${bonusAwards.id}::text`),
    sql`(${walletLedger.meta}->>'bonusAwardId') is not null
      and (${walletLedger.meta}->>'bonusAwardId') ~ '^[0-9]+$'
      and (${walletLedger.meta}->>'bonusAwardId')::int = ${bonusAwards.id}`,
  )

  const transferPromise = db
    .select({
      transferred: sql<string>`coalesce(sum(${walletLedger.amount}), 0)::text`,
    })
    .from(walletLedger)
    .innerJoin(bonusAwards, and(eq(walletLedger.userId, bonusAwards.userId), ledgerToAwardLink))
    .innerJoin(bonusCampaigns, eq(bonusAwards.campaignId, bonusCampaigns.id))
    .where(and(whereClause, ...ledgerBase))

  const [statusRows, [finRow], [wRow], [tRow]] = await Promise.all([
    statusPromise,
    financialPromise,
    walletPromise,
    transferPromise,
  ])

  const out = emptyBonusAwardsAdminPageStats()
  for (const row of statusRows) {
    const n = Number(row.cnt ?? 0)
    out.total += n
    const s = row.status
    if (s === 'pending') out.pending = n
    else if (s === 'active') out.active = n
    else if (s === 'completed') out.completed = n
    else if (s === 'expired') out.expired = n
    else if (s === 'cancelled') out.cancelled = n
  }

  const paid = Number.parseFloat(String(finRow?.totalBonusPaid ?? '0'))
  const wagerLeft = Number.parseFloat(String(finRow?.wageringRemaining ?? '0'))
  const walletSum = Number.parseFloat(String(wRow?.sumBonus ?? '0'))
  const transferred = Number.parseFloat(String(tRow?.transferred ?? '0'))
  out.totalBonusPaid = Number.isFinite(paid) ? paid : 0
  out.wageringRemaining = Number.isFinite(wagerLeft) ? wagerLeft : 0
  out.bonusWalletTotal = Number.isFinite(walletSum) ? walletSum : 0
  out.bonusUses = Number(finRow?.bonusUses ?? 0) || 0
  out.bonusToCashTransferred = Number.isFinite(transferred) ? transferred : 0

  return out
}
