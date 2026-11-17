import { DateTime } from 'luxon'
import { and, eq, or, sql } from 'drizzle-orm'
import { bonusAwards, bonusCampaigns, depositRequests, ledgerEntries, users, wallets } from '../db/schema.js'
import { createWalletLedgerEntry } from './walletLedgerService.js'
import { isCreditPlayer } from './credit/isCreditPlayer.js'

/** Same copy as user app when another bonus is already active (switch flow). */
export const BONUS_ACTIVATION_ALREADY_ACTIVE_MESSAGE =
  'You already have an active bonus. Please use switch bonus to change to a different bonus.'

/** Same copy as the admin paths (setUserBonusAllowed, grantSpecialBonus, activateBonusAwardAdmin). */
export const BONUS_CREDIT_PLAYER_MESSAGE = 'Credit players cannot receive bonuses: their chips move only through Deposit / Withdraw'
export const BONUS_ELIGIBILITY_OFF_MESSAGE = "This player's bonus eligibility is off"

/**
 * Bonus money reaches only a player of this tenant who may receive it (players/PLA-07). Credit players get none:
 * their chips move only through Deposit / Withdraw. A player whose bonus eligibility is off gets none either. The
 * admin paths check this when a card is granted, but a card issued earlier (or before eligibility was switched off)
 * must not be activated or switched to, so the activation and switch cores check it again. Throws the refusal;
 * returns 'not_found' when the player is not in the tenant.
 */
export async function assertPlayerMayReceiveBonus(
  db: { select: (...args: unknown[]) => unknown },
  userId: number,
  tenant: string,
): Promise<'ok' | 'not_found'> {
  const [player] = await (db as any)
    .select({ playerType: users.playerType, bonusAllowed: users.bonusAllowed })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1)
  if (!player) return 'not_found'
  if (isCreditPlayer(player.playerType)) throw new Error(BONUS_CREDIT_PLAYER_MESSAGE)
  if (player.bonusAllowed === false) throw new Error(BONUS_ELIGIBILITY_OFF_MESSAGE)
  return 'ok'
}

export type BonusActivationWalletRow = {
  id: number
  cash: string | null
  bonus: string | null
  exposure: string | null
}

export type ActivateBonusAwardCoreDeps = {
  bonusId: number
  userId: number
  tenant: string
  /** Drizzle db instance with `.select()` and `.transaction()`. */
  db: {
    select: (...args: unknown[]) => unknown
    transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>
  }
  ensureWallet: (userId: number, tenant: string, currency?: string) => Promise<BonusActivationWalletRow>
  getWhitelabelCurrency: (tenant: string) => Promise<string>
}

export type ActivateBonusAwardCoreResult = { kind: 'success' } | { kind: 'not_found' }

/**
 * Activates a pending bonus award (instant_cash → completed + cash credit; otherwise → active + bonus wallet).
 * Matches user-backend `activateBonusAward` behaviour.
 */
export async function activateBonusAwardCore(deps: ActivateBonusAwardCoreDeps): Promise<ActivateBonusAwardCoreResult> {
  const { bonusId, userId, tenant, db, ensureWallet, getWhitelabelCurrency } = deps

  if ((await assertPlayerMayReceiveBonus(db, userId, tenant)) === 'not_found') {
    return { kind: 'not_found' }
  }

  const existingActiveBonus = await (db as any)
    .select({ id: bonusAwards.id })
    .from(bonusAwards)
    .where(and(eq(bonusAwards.userId, userId), eq(bonusAwards.status, 'active')))
    .limit(1)
    .then((rows: { id: number }[]) => rows[0])

  if (existingActiveBonus) {
    throw new Error(BONUS_ACTIVATION_ALREADY_ACTIVE_MESSAGE)
  }

  const bonusWithCampaign = await (db as any)
    .select({
      id: bonusAwards.id,
      campaignId: bonusAwards.campaignId,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      awardedAt: bonusAwards.awardedAt,
      firstDepositRequired: bonusAwards.firstDepositRequired,
      firstDepositUnlocked: bonusAwards.firstDepositUnlocked,
      distributionTypeAward: bonusAwards.distributionType,
      distributionTypeCampaign: bonusCampaigns.distributionType,
      expiryBonusDays: bonusCampaigns.expiryBonusDays,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, and(eq(bonusCampaigns.id, bonusAwards.campaignId), eq(bonusCampaigns.tenant, tenant)))
    .where(
      and(eq(bonusAwards.id, bonusId), eq(bonusAwards.userId, userId), eq(bonusAwards.status, 'pending')),
    )
    .limit(1)
    .then(
      (
        rows: {
          id: number
          campaignId: number
          amount: string | null
          currency: string | null
          awardedAt: Date | null
          firstDepositRequired: boolean | null
          firstDepositUnlocked: boolean | null
          distributionTypeAward: string | null
          distributionTypeCampaign: string | null
          expiryBonusDays: unknown
        }[],
      ) => rows[0],
    )

  if (!bonusWithCampaign) {
    return { kind: 'not_found' }
  }

  if (bonusWithCampaign.firstDepositRequired) {
    const approvedDeposit = await (db as any)
      .select({ id: depositRequests.id })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.userId, userId),
          eq(depositRequests.tenant, tenant),
          eq(depositRequests.status, 'APPROVED'),
        ),
      )
      .limit(1)
      .then((rows: { id: number }[]) => rows[0])

    if (!approvedDeposit) {
      const wallet = await ensureWallet(userId, tenant)
      const depositLedgerEntry = await (db as any)
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.walletId, wallet.id),
            eq(ledgerEntries.tenant, tenant),
            eq(ledgerEntries.type, 'credit'),
            or(
              sql`${ledgerEntries.meta}->>'type' = 'deposit'`,
              sql`${ledgerEntries.meta}->>'type' = 'admin_adjustment'`,
            ),
          ),
        )
        .limit(1)
        .then((rows: { id: number }[]) => rows[0])

      if (!depositLedgerEntry) {
        throw new Error('Make a deposit first to activate this bonus.')
      }
    }
  }

  const rawExpiryDays = bonusWithCampaign.expiryBonusDays ?? null
  const expiryDays = typeof rawExpiryDays === 'number' ? rawExpiryDays : Number(rawExpiryDays)
  if (Number.isFinite(expiryDays) && expiryDays >= 1 && bonusWithCampaign.awardedAt) {
    const expiryDate = DateTime.fromJSDate(new Date(bonusWithCampaign.awardedAt), { zone: 'Asia/Kolkata' })
      .plus({ days: Math.floor(expiryDays) })
      .toJSDate()
    if (new Date() > expiryDate) {
      throw new Error('Bonus has expired')
    }
  }

  const distributionType =
    bonusWithCampaign.distributionTypeAward ?? bonusWithCampaign.distributionTypeCampaign

  if (distributionType === 'instant_cash') {
    const bonusAmount = Number(bonusWithCampaign.amount || 0)
    const wallet = await ensureWallet(userId, tenant)
    const currentCash = Number(wallet.cash || 0)
    const currentBonus = Number(wallet.bonus || 0)
    const exposure = Number(wallet.exposure ?? 0)

    await (db as any).transaction(async (tx: any) => {
      if (bonusWithCampaign.firstDepositUnlocked) {
        const newBonus = Math.max(0, currentBonus - bonusAmount)
        const newCash = currentCash + Math.min(bonusAmount, currentBonus)
        const cashLedgerBefore = Math.max(0, currentCash - exposure)
        const cashLedgerAfter = Math.max(0, newCash - exposure)

        await tx
          .update(wallets)
          .set({
            bonus: String(newBonus),
            cash: String(newCash),
          })
          .where(eq(wallets.id, wallet.id))

        if (bonusAmount > 0 && currentBonus > 0) {
          const amountToTransfer = Math.min(bonusAmount, currentBonus)
          await tx.insert(ledgerEntries).values({
            tenant,
            walletId: wallet.id,
            type: 'debit',
            amount: String(amountToTransfer),
            balanceBefore: String(currentBonus),
            balanceAfter: String(newBonus),
            meta: {
              type: 'bonus_instant_cash_transfer',
              remark: 'BONUS TO CASH',
              bonusAwardId: bonusId,
              campaignId: bonusWithCampaign.campaignId,
              currency: bonusWithCampaign.currency || 'INR',
            } as Record<string, unknown>,
          })
          await tx.insert(ledgerEntries).values({
            tenant,
            walletId: wallet.id,
            type: 'credit',
            amount: String(amountToTransfer),
            balanceBefore: String(currentCash),
            balanceAfter: String(newCash),
            meta: {
              type: 'bonus_instant_cash',
              remark: 'BONUS TO CASH',
              bonusAwardId: bonusId,
              campaignId: bonusWithCampaign.campaignId,
              currency: bonusWithCampaign.currency || 'INR',
            } as Record<string, unknown>,
          })
          await createWalletLedgerEntry(tx, {
            tenant,
            walletId: wallet.id,
            userId,
            walletType: 'bonus',
            category: 'bonus_transfer',
            direction: 'debit',
            amount: amountToTransfer,
            balanceBefore: currentBonus,
            balanceAfter: newBonus,
            description: 'INSTANT CASH transfer to cash',
            referenceType: 'bonus_award',
            referenceId: String(bonusId),
            meta: { bonusAwardId: bonusId, campaignId: bonusWithCampaign.campaignId },
          })
          await createWalletLedgerEntry(tx, {
            tenant,
            walletId: wallet.id,
            userId,
            walletType: 'cash',
            category: 'bonus_transfer',
            direction: 'credit',
            amount: amountToTransfer,
            balanceBefore: cashLedgerBefore,
            balanceAfter: cashLedgerAfter,
            description: 'INSTANT CASH',
            referenceType: 'bonus_award',
            referenceId: String(bonusId),
            meta: { bonusAwardId: bonusId, campaignId: bonusWithCampaign.campaignId },
          })
          const { deductWhitelabelCredit } = await import('./whitelabelCreditDeduct.js')
          const currency = await getWhitelabelCurrency(tenant)
          await deductWhitelabelCredit(tx, tenant, amountToTransfer, currency, `Instant cash bonus (transfer) - awardId=${bonusId} campaignId=${bonusWithCampaign.campaignId}`, { userId })
        }
      } else {
        const newCash = currentCash + bonusAmount
        const cashLedgerBefore = Math.max(0, currentCash - exposure)
        const cashLedgerAfter = Math.max(0, newCash - exposure)
        await tx
          .update(wallets)
          .set({ cash: String(newCash) })
          .where(eq(wallets.id, wallet.id))

        await tx.insert(ledgerEntries).values({
          tenant,
          walletId: wallet.id,
          type: 'credit',
          amount: String(bonusAmount),
          balanceBefore: String(currentCash),
          balanceAfter: String(newCash),
          meta: {
            type: 'bonus_instant_cash',
            remark: 'BONUS TO CASH',
            bonusAwardId: bonusId,
            campaignId: bonusWithCampaign.campaignId,
            currency: bonusWithCampaign.currency || 'INR',
          } as Record<string, unknown>,
        })
        await createWalletLedgerEntry(tx, {
          tenant,
          walletId: wallet.id,
          userId,
          walletType: 'cash',
          category: 'bonus_transfer',
          direction: 'credit',
          amount: bonusAmount,
          balanceBefore: cashLedgerBefore,
          balanceAfter: cashLedgerAfter,
          description: 'INSTANT CASH',
          referenceType: 'bonus_award',
          referenceId: String(bonusId),
          meta: { bonusAwardId: bonusId, campaignId: bonusWithCampaign.campaignId },
        })
        const { deductWhitelabelCredit } = await import('./whitelabelCreditDeduct.js')
        const currency = await getWhitelabelCurrency(tenant)
        await deductWhitelabelCredit(tx, tenant, bonusAmount, currency, `Instant cash bonus - awardId=${bonusId} campaignId=${bonusWithCampaign.campaignId}`, { userId })
      }

      await tx
        .update(bonusAwards)
        .set({
          status: 'completed',
          completedAt: new Date(),
          ...(bonusWithCampaign.firstDepositRequired ? { firstDepositUnlocked: true } : {}),
        })
        .where(eq(bonusAwards.id, bonusId))
    })
    return { kind: 'success' }
  }

  const bonusAmount = Number(bonusWithCampaign.amount || 0)
  const wallet = await ensureWallet(userId, tenant)
  const currentBonus = Number(wallet.bonus || 0)
  const newBonus = currentBonus + bonusAmount

  await (db as any).transaction(async (tx: any) => {
    await tx
      .update(wallets)
      .set({ bonus: String(newBonus) })
      .where(eq(wallets.id, wallet.id))

    await tx.insert(ledgerEntries).values({
      tenant,
      walletId: wallet.id,
      type: 'credit',
      amount: String(bonusAmount),
      balanceBefore: String(currentBonus),
      balanceAfter: String(newBonus),
      meta: {
        type: 'bonus',
        bonusAwardId: bonusId,
        campaignId: bonusWithCampaign.campaignId,
        currency: bonusWithCampaign.currency || 'INR',
      } as Record<string, unknown>,
    })
    await createWalletLedgerEntry(tx, {
      tenant,
      walletId: wallet.id,
      userId,
      walletType: 'bonus',
      category: 'bonus_activation',
      direction: 'credit',
      amount: bonusAmount,
      balanceBefore: currentBonus,
      balanceAfter: newBonus,
      description: 'Bonus activation (INSTANT_OTP/ROLLOVER)',
      referenceType: 'bonus_award',
      referenceId: String(bonusId),
      meta: { bonusAwardId: bonusId, campaignId: bonusWithCampaign.campaignId },
    })

    await tx
      .update(bonusAwards)
      .set({
        status: 'active',
        ...(bonusWithCampaign.firstDepositRequired ? { firstDepositUnlocked: true } : {}),
      })
      .where(
        and(eq(bonusAwards.id, bonusId), eq(bonusAwards.userId, userId), eq(bonusAwards.status, 'pending')),
      )
  })

  return { kind: 'success' }
}
