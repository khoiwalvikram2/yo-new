import { and, eq, gte, lte, isNull, or, sql } from 'drizzle-orm'
import { bonusCampaigns, bonusAwards, wallets, ledgerEntries, users } from '../db/schema.js'
import { appConfigs } from '../db/schema/appConfig.js'
import type { InferSelectModel } from 'drizzle-orm'
import { createWalletLedgerEntry } from './walletLedgerService.js'
import { resolveDb } from '../db/registry.js'

type BonusCampaign = InferSelectModel<typeof bonusCampaigns>
type BonusAward = InferSelectModel<typeof bonusAwards>

export interface AwardBonusParams {
  userId: number
  tenant: string
  campaignId: number
  depositAmount?: number // For deposit bonuses, the deposit amount
  tx?: any // Transaction object for atomicity
}

export interface ProcessBonusResult {
  success: boolean
  awardId?: number
  amount?: number
  message?: string
}

/**
 * Calculate bonus amount based on campaign configuration
 */
export function calculateBonusAmount(
  campaign: BonusCampaign,
  depositAmount?: number
): number {
  if (campaign.amountType === 'fixed' && campaign.amount) {
    return Number(campaign.amount)
  } else if (campaign.amountType === 'percentage' && campaign.percentage && depositAmount) {
    return depositAmount * (Number(campaign.percentage) / 100)
  }
  return 0
}

/**
 * Calculate wagering requirement
 */
export function calculateWageringRequirement(
  campaign: BonusCampaign,
  bonusAmount: number
): number {
  if (campaign.wagering) {
    return Number(campaign.wagering) * bonusAmount
  }
  return 0
}

/**
 * Validate deposit condition
 */
export function validateDepositCondition(
  campaign: BonusCampaign,
  depositAmount: number
): boolean {
  if (!campaign.depositConditionType || !campaign.depositConditionAmount) {
    return true // No condition means always valid
  }

  const conditionAmount = Number(campaign.depositConditionAmount)
  
  switch (campaign.depositConditionType) {
    case 'greater_than':
      return depositAmount > conditionAmount
    case 'equal_to':
      return depositAmount === conditionAmount
    default:
      return true
  }
}

/** Normalize rulesJson exclusion lists for DB comparison (player IDs as numbers, agent IDs as strings). */
function getExclusionLists(rulesJson: unknown): { excludedPlayerIds: number[]; excludedAgentIds: string[] } {
  const rules = (rulesJson as Record<string, unknown>) || {}
  const rawPlayerIds = Array.isArray(rules.excludedPlayerIds) ? rules.excludedPlayerIds : []
  const rawAgentIds = Array.isArray(rules.excludedAgentIds) ? rules.excludedAgentIds : []
  const excludedPlayerIds = rawPlayerIds.map((id) => (typeof id === 'string' ? parseInt(id, 10) : Number(id))).filter((n) => !Number.isNaN(n))
  const excludedAgentIds = rawAgentIds.map((id) => String(id)).filter(Boolean)
  return { excludedPlayerIds, excludedAgentIds }
}

/** IANA timezone from app_configs; safe fallback for bonus date boundaries. */
async function getTenantTimeZoneForBonus(dbInstance: any, tenant: string): Promise<string> {
  try {
    const [cfg] = await dbInstance
      .select({ timeZone: appConfigs.timeZone })
      .from(appConfigs)
      .where(eq(appConfigs.whitelabelId, tenant))
      .limit(1)
    const raw = cfg?.timeZone?.trim()
    if (raw && /^[A-Za-z0-9_\/+\-]+$/.test(raw)) return raw
  } catch {
    // ignore
  }
  return 'UTC'
}

/** Bonus types that run on the same deposit-approval / manual-deposit hooks as `deposit`. */
export const DEPOSIT_TRIGGER_BONUS_TYPES = ['deposit', 'daily_first_deposit'] as const

/**
 * Check if user is eligible for campaign
 */
export async function checkUserEligibility(
  userId: number,
  tenant: string,
  campaign: BonusCampaign,
  dbInstance: any
): Promise<{ eligible: boolean; reason?: string }> {
  if (!dbInstance) {
    throw new Error('Database instance is required for eligibility check')
  }

  // Check if user has bonuses enabled
  const userBonusRow = await dbInstance
    .select({ bonusAllowed: users.bonusAllowed })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1)
    .then((rows: any[]) => rows[0])
  if (userBonusRow && !userBonusRow.bonusAllowed) {
    return { eligible: false, reason: 'Bonuses are disabled for this user' }
  }

  // Exclusion list: players and agents in rulesJson must not receive this campaign
  const { excludedPlayerIds, excludedAgentIds } = getExclusionLists(campaign.rulesJson ?? null)
  if (excludedPlayerIds.length > 0 && excludedPlayerIds.includes(userId)) {
    return { eligible: false, reason: 'Excluded from this campaign' }
  }
  if (excludedAgentIds.length > 0) {
    const userRows = await dbInstance
      .select({ agentId: users.agentId })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
      .limit(1)
    const userAgentId = userRows[0]?.agentId ?? null
    if (userAgentId && excludedAgentIds.includes(String(userAgentId))) {
      return { eligible: false, reason: 'Excluded from this campaign (agent)' }
    }
  }

  // Check usage per player limit (lifetime max per user for this campaign; daily_first_deposit also enforces at most once per local day below)
  if (campaign.usagePerPlayer) {
    const userAwards = await dbInstance
      .select()
      .from(bonusAwards)
      .where(
        and(
          eq(bonusAwards.campaignId, campaign.id),
          eq(bonusAwards.userId, userId)
        )
      )

    if (userAwards.length >= campaign.usagePerPlayer) {
      return { eligible: false, reason: 'Usage limit reached' }
    }
  }

  // Check number of players limit
  if (campaign.numberOfPlayers) {
    const totalAwards = await dbInstance
      .select()
      .from(bonusAwards)
      .where(eq(bonusAwards.campaignId, campaign.id))

    if (totalAwards.length >= campaign.numberOfPlayers) {
      return { eligible: false, reason: 'Campaign player limit reached' }
    }
  }

  // Daily first deposit: at most one award per user per campaign per local calendar day (any award row counts, including cancelled)
  if (campaign.type === 'daily_first_deposit') {
    const tz = await getTenantTimeZoneForBonus(dbInstance, tenant)
    const sameDayRows = await dbInstance
      .select({ cnt: sql<number>`count(*)::int` })
      .from(bonusAwards)
      .where(
        and(
          eq(bonusAwards.campaignId, campaign.id),
          eq(bonusAwards.userId, userId),
          sql`date(timezone(${tz}::text, ${bonusAwards.awardedAt})) = date(timezone(${tz}::text, now()))`
        )
      )
    const cnt = Number(sameDayRows[0]?.cnt ?? 0)
    if (cnt > 0) {
      return { eligible: false, reason: 'Daily first deposit bonus already granted today' }
    }
  }

  // "Already awarded" only for signup (one-time per user). Deposit campaigns use usagePerPlayer only — never return "Already awarded".
  if (campaign.type === 'deposit' || campaign.type === 'daily_first_deposit') {
    // Skip existing-award check; usagePerPlayer / numberOfPlayers / daily window above are the limits.
  } else if (campaign.type === 'signup') {
    const existingAward = await dbInstance
      .select()
      .from(bonusAwards)
      .where(
        and(
          eq(bonusAwards.campaignId, campaign.id),
          eq(bonusAwards.userId, userId)
        )
      )
      .limit(1)
      .then((rows: any[]) => rows[0])

    if (existingAward) {
      return { eligible: false, reason: 'Already awarded' }
    }
  }

  return { eligible: true }
}

/**
 * Check if campaign is active and valid
 */
export function isCampaignActive(campaign: BonusCampaign): boolean {
  if (campaign.status !== 'active') {
    return false
  }

  const now = new Date()
  const startDate = campaign.startDate || campaign.validFrom
  const endDate = campaign.endDate || campaign.validTo

  if (startDate && new Date(startDate) > now) {
    return false
  }

  if (endDate && new Date(endDate) < now) {
    return false
  }

  return true
}

/**
 * Award bonus to user
 */
export async function awardBonus(
  params: AwardBonusParams
): Promise<ProcessBonusResult> {
  const { userId, tenant, campaignId, depositAmount, tx } = params
  
  
  const dbInstance = resolveDb(tx)
  if (!dbInstance) {
    return { success: false, message: 'Database connection not available' }
  }

  try {
    // Get campaign
    const campaign = await dbInstance
      .select()
      .from(bonusCampaigns)
      .where(
        and(
          eq(bonusCampaigns.id, campaignId),
          eq(bonusCampaigns.tenant, tenant)
        )
      )
      .limit(1)
      .then((rows: any[]) => rows[0])

    if (!campaign) {
      return { success: false, message: 'Campaign not found' }
    }
    

    // Check if campaign is active
    if (!isCampaignActive(campaign)) {
      return { success: false, message: 'Campaign is not active' }
    }

    // Validate deposit condition if applicable
    if (depositAmount !== undefined) {
      const conditionMet = validateDepositCondition(campaign, depositAmount)
      if (!conditionMet) {
        return { success: false, message: 'Deposit condition not met' }
      }
    }

    // Check user eligibility
    const eligibility = await checkUserEligibility(userId, tenant, campaign, dbInstance)
    if (!eligibility.eligible) {
      return { success: false, message: eligibility.reason || 'User not eligible' }
    }

    // Calculate bonus amount
    const bonusAmount = calculateBonusAmount(campaign, depositAmount)
    if (bonusAmount <= 0) {
      return { success: false, message: 'Invalid bonus amount' }
    }

    // Calculate wagering requirement
    const wageringReq = calculateWageringRequirement(campaign, bonusAmount)

    // Signup with deposit required: create pending award, do NOT credit - will unlock on first deposit
    const isSignupDepositRequired = campaign.type === 'signup' && campaign.depositRequired === true

    // Instant cash: credit on activation, not on award
    const isInstantCash = campaign.distributionType === 'instant_cash'

    // Determine initial status (all awards start pending; wallet credit only on user activation)
    let initialStatus: 'pending' | 'active' | 'completed' = 'pending'
    let firstDepositRequired = false

    if (isSignupDepositRequired) {
      initialStatus = 'pending'
      firstDepositRequired = true
    } else if (isInstantCash || campaign.distributionType === 'roll_over' || campaign.distributionType === 'instant_otp') {
      initialStatus = 'pending'
    }

    // Create bonus award
    const insertValues: Record<string, unknown> = {
      campaignId: campaign.id,
      userId,
      domain: campaign.domain,
      type: campaign.type,
      amount: String(bonusAmount),
      currency: campaign.currency,
      wageringReq: String(wageringReq),
      currentWagering: '0',
      status: initialStatus,
      firstDepositRequired: firstDepositRequired || false,
      distributionType: campaign.distributionType ?? null,
      releaseType: campaign.releaseType ?? null,
    }
    if (depositAmount != null) {
      insertValues.triggerAmount = String(depositAmount)
    }
    const [award] = await dbInstance
      .insert(bonusAwards)
      .values(insertValues as any)
      .returning()
    

    // Wallet credit only on user manual activation (activateBonusAward in user-backend).
    // Never credit here - regardless of bonus type or distribution type.
    return {
      success: true,
      awardId: award.id,
      amount: bonusAmount,
      message: 'Bonus awarded successfully',
    }
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to award bonus' }
  }
}

/**
 * Credit cash wallet
 */
async function creditWallet(
  dbInstance: any,
  userId: number,
  tenant: string,
  amount: number,
  currency: string,
  meta: any
): Promise<void> {
  // Get or create wallet
  const wallet = await dbInstance
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))
    .limit(1)
    .then((rows: any[]) => rows[0])

  if (!wallet) {
    throw new Error('Wallet not found')
  }

  const currentCash = Number(wallet.cash || 0)
  const newCash = currentCash + amount
  const exposure = Number(wallet.exposure ?? 0)
  const ledgerBefore = Math.max(0, currentCash - exposure)
  const ledgerAfter = Math.max(0, newCash - exposure)

  // Update wallet
  await dbInstance
    .update(wallets)
    .set({
      cash: String(newCash),
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, wallet.id))

  // Create ledger entry
  await dbInstance.insert(ledgerEntries).values({
    tenant,
    walletId: wallet.id,
    type: 'credit',
    amount: String(amount),
    currency,
    balanceBefore: String(currentCash),
    balanceAfter: String(newCash),
    meta: meta as any,
  })
  await createWalletLedgerEntry(dbInstance, {
    tenant,
    walletId: wallet.id,
    userId,
    walletType: 'cash',
    category: (meta?.type as string) ?? 'bonus_transfer',
    direction: 'credit',
    amount,
    balanceBefore: ledgerBefore,
    balanceAfter: ledgerAfter,
    description: (meta?.remark as string) ?? 'Bonus to cash',
    meta: meta as Record<string, unknown>,
  })
}

/**
 * Credit bonus wallet
 */
async function creditBonusWallet(
  dbInstance: any,
  userId: number,
  tenant: string,
  amount: number,
  currency: string,
  meta: any
): Promise<void> {
  // Get or create wallet
  const wallet = await dbInstance
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))
    .limit(1)
    .then((rows: any[]) => rows[0])

  if (!wallet) {
    throw new Error('Wallet not found')
  }

  const currentBonus = Number(wallet.bonus || 0)
  const newBonus = currentBonus + amount

  // Update wallet
  await dbInstance
    .update(wallets)
    .set({
      bonus: String(newBonus),
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, wallet.id))

  // Create ledger entry
  await dbInstance.insert(ledgerEntries).values({
    tenant,
    walletId: wallet.id,
    type: 'credit',
    amount: String(amount),
    currency,
    balanceBefore: String(currentBonus),
    balanceAfter: String(newBonus),
    meta: meta as any,
  })
  await createWalletLedgerEntry(dbInstance, {
    tenant,
    walletId: wallet.id,
    userId,
    walletType: 'bonus',
    category: (meta?.type as string) ?? 'bonus_activation',
    direction: 'credit',
    amount,
    balanceBefore: currentBonus,
    balanceAfter: newBonus,
    description: 'Bonus credit',
    meta: meta as Record<string, unknown>,
  })
}

/**
 * Unlock signup bonuses with deposit required when user makes first deposit.
 * Credits bonus amount to bonus wallet for each pending award with firstDepositRequired=true.
 */
export async function unlockSignupBonusOnFirstDeposit(
  userId: number,
  tenant: string,
  tx?: any
): Promise<void> {
  const dbInstance = resolveDb(tx)
  if (!dbInstance) {
    return
  }

  const pendingAwards = await dbInstance
    .select({
      id: bonusAwards.id,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      campaignId: bonusAwards.campaignId,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
    .where(
      and(
        eq(bonusAwards.userId, userId),
        eq(bonusAwards.status, 'pending'),
        eq(bonusAwards.firstDepositRequired, true),
        eq(bonusCampaigns.tenant, tenant)
      )
    )

  for (const award of pendingAwards) {
    const bonusAmount = Number(award.amount || 0)
    if (bonusAmount > 0) {
      await creditBonusWallet(dbInstance, userId, tenant, bonusAmount, award.currency || 'INR', {
        type: 'bonus',
        bonusAwardId: award.id,
        campaignId: award.campaignId,
      })
      await dbInstance
        .update(bonusAwards)
        .set({ firstDepositUnlocked: true })
        .where(eq(bonusAwards.id, award.id))
    }
  }
}

/**
 * Find eligible campaigns for a bonus type
 */
export async function findEligibleCampaigns(
  tenant: string,
  type: string,
  tx?: any
): Promise<BonusCampaign[]> {
  
  const dbInstance = resolveDb(tx)
  if (!dbInstance) {
    return []
  }
  const now = new Date()

  const campaigns = await dbInstance
    .select()
    .from(bonusCampaigns)
    .where(
      and(
        eq(bonusCampaigns.tenant, tenant),
        eq(bonusCampaigns.status, 'active'),
        eq(bonusCampaigns.type, type as any),
        or(isNull(bonusCampaigns.startDate), lte(bonusCampaigns.startDate, now)),
        or(isNull(bonusCampaigns.endDate), gte(bonusCampaigns.endDate, now)),
        or(isNull(bonusCampaigns.validFrom), lte(bonusCampaigns.validFrom, now)),
        or(isNull(bonusCampaigns.validTo), gte(bonusCampaigns.validTo, now))
      )
    )
    .orderBy(sql`${bonusCampaigns.createdAt} DESC`)

  
  const activeCampaigns = campaigns.filter((campaign: BonusCampaign) => isCampaignActive(campaign))
  
  if (activeCampaigns.length > 0) {
    activeCampaigns.forEach((c: BonusCampaign) => {
    })
  }
  
  return activeCampaigns
}

/**
 * Active campaigns for all bonus types that should run when a deposit is approved (or manual deposit + apply bonus).
 */
export async function findEligibleCampaignsForDepositTriggers(
  tenant: string,
  tx?: any
): Promise<BonusCampaign[]> {
  const merged: BonusCampaign[] = []
  for (const t of DEPOSIT_TRIGGER_BONUS_TYPES) {
    const list = await findEligibleCampaigns(tenant, t, tx)
    merged.push(...list)
  }
  return merged
}

/**
 * Release roll_over bonus to cash when wagering is complete.
 * Bonus Amount Only: credit card amount to cash, zero out bonus wallet (remaining forfeited).
 * Total bonus wallet: credit full bonus wallet to cash, zero out bonus wallet.
 * @param userId - User ID
 * @param tenant - Tenant identifier
 * @param awardId - Bonus award ID
 * @param dbInstance - DB or transaction executor
 */
export async function releaseRollOverBonusToCash(
  userId: number,
  tenant: string,
  awardId: number,
  dbInstance: any
): Promise<void> {
  const row = await dbInstance
    .select({
      amount: bonusAwards.amount,
      wageringReq: bonusAwards.wageringReq,
      currentWagering: bonusAwards.currentWagering,
      status: bonusAwards.status,
      completedAt: bonusAwards.completedAt,
      distributionTypeAward: bonusAwards.distributionType,
      distributionTypeCampaign: bonusCampaigns.distributionType,
      releaseTypeAward: bonusAwards.releaseType,
      releaseTypeCampaign: bonusCampaigns.releaseType,
      currency: bonusAwards.currency,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
    .where(
      and(
        eq(bonusAwards.id, awardId),
        eq(bonusAwards.userId, userId),
        eq(bonusCampaigns.tenant, tenant)
      )
    )
    .limit(1)
    .then((rows: any[]) => rows[0])

  const distributionType = row?.distributionTypeAward ?? row?.distributionTypeCampaign
  const releaseType = row?.releaseTypeAward ?? row?.releaseTypeCampaign

  if (!row || distributionType !== 'roll_over') return
  if (row.status === 'completed' && row.completedAt) return // Already released (e.g. auto-release)
  const wageringReq = Number(row.wageringReq ?? 0)
  const currentWagering = Number(row.currentWagering ?? 0)
  if (wageringReq > 0 && currentWagering < wageringReq) return

  const wallet = await dbInstance
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))
    .limit(1)
    .then((rows: any[]) => rows[0])
  if (!wallet) {
    return
  }

  const currentBonus = Math.max(0, Number(wallet.bonus ?? 0))
  const currentCash = Math.max(0, Number(wallet.cash ?? 0))
  const exposure = Number(wallet.exposure ?? 0)
  const bonusAmount = Math.max(0, Number(row.amount ?? 0))
  const currency = row.currency || 'INR'

  let creditToCash: number
  if (releaseType === 'total_bonus_wallet') {
    creditToCash = currentBonus
  } else {
    // bonus_amount_only: card amount to cash; bonus wallet zeroed (remaining forfeited)
    creditToCash = bonusAmount
  }
  creditToCash = Math.max(0, creditToCash)

  const newCash = currentCash + creditToCash
  const newBonus = 0

  // Only update wallet and write ledger when there is something to release or zero
  if (creditToCash > 0 || currentBonus > 0) {
    await dbInstance
      .update(wallets)
      .set({
        bonus: String(newBonus.toFixed(2)),
        cash: String(newCash.toFixed(2)),
      })
      .where(eq(wallets.id, wallet.id))

    // Bonus wallet: debit entry(ies) for rollover claim
    if (releaseType === 'total_bonus_wallet' && currentBonus > 0) {
      await createWalletLedgerEntry(dbInstance, {
        tenant,
        walletId: wallet.id,
        userId,
        walletType: 'bonus',
        category: 'bonus_transfer',
        direction: 'debit',
        amount: currentBonus,
        balanceBefore: currentBonus,
        balanceAfter: 0,
        description: 'ROLLOVER CLAIM to cash',
        referenceType: 'bonus_award',
        referenceId: String(awardId),
        meta: { awardId, releaseType },
      })
    } else if (releaseType === 'bonus_amount_only') {
      if (creditToCash > 0) {
        await createWalletLedgerEntry(dbInstance, {
          tenant,
          walletId: wallet.id,
          userId,
          walletType: 'bonus',
          category: 'bonus_transfer',
          direction: 'debit',
          amount: creditToCash,
          balanceBefore: currentBonus,
          balanceAfter: currentBonus - creditToCash,
          description: 'ROLLOVER CLAIM to cash',
          referenceType: 'bonus_award',
          referenceId: String(awardId),
          meta: { awardId, releaseType },
        })
      }
      if (currentBonus > creditToCash) {
        const consolidateAmount = currentBonus - creditToCash
        await createWalletLedgerEntry(dbInstance, {
          tenant,
          walletId: wallet.id,
          userId,
          walletType: 'bonus',
          category: 'bonus_consolidated',
          direction: 'debit',
          amount: consolidateAmount,
          balanceBefore: currentBonus - creditToCash,
          balanceAfter: 0,
          description: 'Consolidated (excess forfeited)',
          referenceType: 'bonus_award',
          referenceId: String(awardId),
          meta: { awardId },
        })
      }
    }
    // Single ledger entry for "Bonus Release to Cash" (credit to cash only).
    // Debit of bonus is not written so Statements shows one row per release.
    if (creditToCash > 0) {
      const cashLedgerBefore = Math.max(0, currentCash - exposure)
      const cashLedgerAfter = Math.max(0, newCash - exposure)
      await dbInstance.insert(ledgerEntries).values({
        tenant,
        walletId: wallet.id,
        type: 'credit',
        amount: String(creditToCash.toFixed(2)),
        balanceBefore: String(currentCash.toFixed(2)),
        balanceAfter: String(newCash.toFixed(2)),
        meta: {
          type: 'bonus_release',
          remark: 'BONUS TO CASH',
          bonusAwardId: awardId,
          currency,
          releaseType,
        } as Record<string, unknown>,
      })
      await createWalletLedgerEntry(dbInstance, {
        tenant,
        walletId: wallet.id,
        userId,
        walletType: 'cash',
        category: 'bonus_transfer',
        direction: 'credit',
        amount: creditToCash,
        balanceBefore: cashLedgerBefore,
        balanceAfter: cashLedgerAfter,
        description: 'ROLLOVER CLAIM',
        referenceType: 'bonus_award',
        referenceId: String(awardId),
        meta: { awardId, releaseType },
      })
      const { deductWhitelabelCredit } = await import('./whitelabelCreditDeduct.js')
      await deductWhitelabelCredit(dbInstance, tenant, creditToCash, currency, `Rollover bonus release to cash - awardId=${awardId} userId=${userId}`, {
        userId,
      })
    }
  }

  await dbInstance
    .update(bonusAwards)
    .set({
      status: 'completed',
      completedAt: new Date(),
    })
    .where(eq(bonusAwards.id, awardId))

}

/**
 * Update bonus wagering when a bet is settled
 * @param userId - User ID
 * @param tenant - Tenant identifier
 * @param betAmount - Bet stake amount
 * @param domain - Domain of the bet (sports, casino, matka)
 * @param gameId - Optional game identifier for casino/matka (used for weight calculation and game restriction)
 * @param walletType - Only `bonus` wallet stakes count toward rollover wagering; cash/referral skips update
 * @param tx - Optional transaction instance
 */
export async function updateBonusWagering(
  userId: number,
  tenant: string,
  betAmount: number,
  domain: 'sports' | 'casino' | 'matka',
  gameId?: string,
  walletType?: 'cash' | 'bonus' | 'referralBonus',
  tx?: any
): Promise<void> {
  if (walletType !== undefined && walletType !== 'bonus') {
    return
  }

  const dbInstance = resolveDb(tx)
  if (!dbInstance) {
    return
  }

  try {
    // Find active bonus awards for user in this tenant's campaigns only (matching domain or global)
    // Also fetch rulesJson and distributionType/releaseType for release on wagering complete
    const activeBonuses = await dbInstance
      .select({
        id: bonusAwards.id,
        campaignId: bonusAwards.campaignId,
        userId: bonusAwards.userId,
        domain: bonusAwards.domain,
        type: bonusAwards.type,
        amount: bonusAwards.amount,
        currency: bonusAwards.currency,
        wageringReq: bonusAwards.wageringReq,
        currentWagering: bonusAwards.currentWagering,
        status: bonusAwards.status,
        rulesJson: bonusCampaigns.rulesJson,
        distributionTypeAward: bonusAwards.distributionType,
        distributionTypeCampaign: bonusCampaigns.distributionType,
      })
      .from(bonusAwards)
      .innerJoin(bonusCampaigns, and(
        eq(bonusCampaigns.id, bonusAwards.campaignId),
        eq(bonusCampaigns.tenant, tenant)
      ))
      .where(
        and(
          eq(bonusAwards.userId, userId),
          eq(bonusAwards.status, 'active'),
          or(
            eq(bonusAwards.domain, domain),
            eq(bonusAwards.domain, 'global')
          )
        )
      )

    for (const bonus of activeBonuses) {
      const rulesJson = (bonus.rulesJson as Record<string, unknown>) || {}
      
      // Get game restrictions and weights based on domain
      let allowedGameIds: string[] = []
      let gameWeights: Record<string, number> = {}
      
      if (domain === 'casino') {
        allowedGameIds = (rulesJson.casinoGameIds as string[]) || []
        gameWeights = (rulesJson.casinoGameWeights as Record<string, number>) || {}
      } else if (domain === 'matka') {
        allowedGameIds = (rulesJson.matkaGameIds as string[]) || []
        // For matka, weights are per bid type, handled separately if needed
      }
      
      // Check game restriction: if allowedGameIds is configured, only those games count toward wagering
      if (gameId && allowedGameIds.length > 0) {
        if (!allowedGameIds.includes(gameId)) {
          continue
        }
      }
      
      // Calculate effective bet amount with game weight
      let effectiveBetAmount = betAmount
      if (gameId && gameWeights[gameId] !== undefined) {
        const weight = gameWeights[gameId]
        effectiveBetAmount = betAmount * weight
      }
      
      // Skip if effective amount is 0 (weight = 0)
      if (effectiveBetAmount <= 0) {
        continue
      }
      
      const currentWagering = Number(bonus.currentWagering || 0)
      const newWagering = currentWagering + effectiveBetAmount
      const wageringReq = Number(bonus.wageringReq || 0)

      const wageringJustComplete = newWagering >= wageringReq && wageringReq > 0
      const newStatus = wageringJustComplete ? 'completed' : bonus.status

      // Update current wagering
      await dbInstance
        .update(bonusAwards)
        .set({
          currentWagering: String(newWagering),
          status: newStatus,
        })
        .where(eq(bonusAwards.id, bonus.id))

      const distributionType =
        bonus.distributionTypeAward ?? bonus.distributionTypeCampaign

      // Auto-release roll_over bonus to cash when wagering completes
      if (wageringJustComplete && distributionType === 'roll_over') {
        try {
          await releaseRollOverBonusToCash(userId, tenant, bonus.id, dbInstance)
        } catch (err: any) {
          // Don't throw - wagering update already succeeded
        }
      }
    }
  } catch (error: any) {
    // Don't throw - wagering update should not block bet settlement
  }
}
