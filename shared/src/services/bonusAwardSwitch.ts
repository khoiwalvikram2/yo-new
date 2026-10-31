import { DateTime } from 'luxon'
import { and, eq, or, sql } from 'drizzle-orm'
import { bonusAwards, bonusCampaigns, depositRequests, ledgerEntries, wallets } from '../db/schema.js'
import { createWalletLedgerEntry } from './walletLedgerService.js'
import type { BonusActivationWalletRow } from './bonusAwardActivation.js'

export type SwitchBonusAwardCoreDeps = {
  newBonusId: number
  userId: number
  tenant: string
  db: {
    select: (...args: unknown[]) => unknown
    transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>
  }
  ensureWallet: (userId: number, tenant: string, currency?: string) => Promise<BonusActivationWalletRow>
  getWhitelabelCurrency: (tenant: string) => Promise<string>
}

/**
 * Cancels current active bonus (zeros bonus wallet) and activates the pending card.
 * Matches user-backend `switchBonusAward`.
 */
export async function switchBonusAwardCore(deps: SwitchBonusAwardCoreDeps): Promise<void> {
  const { newBonusId, userId, tenant, db, ensureWallet, getWhitelabelCurrency } = deps

  const currentActiveBonus = await (db as any)
    .select({
      id: bonusAwards.id,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      campaignId: bonusAwards.campaignId,
    })
    .from(bonusAwards)
    .where(and(eq(bonusAwards.userId, userId), eq(bonusAwards.status, 'active')))
    .limit(1)
    .then((rows: { id: number; amount: string | null; currency: string | null; campaignId: number }[]) => rows[0])

  const newBonusWithCampaign = await (db as any)
    .select({
      id: bonusAwards.id,
      status: bonusAwards.status,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      campaignId: bonusAwards.campaignId,
      firstDepositRequired: bonusAwards.firstDepositRequired,
      firstDepositUnlocked: bonusAwards.firstDepositUnlocked,
      distributionTypeAward: bonusAwards.distributionType,
      distributionTypeCampaign: bonusCampaigns.distributionType,
      expiryBonusDays: bonusCampaigns.expiryBonusDays,
      awardedAt: bonusAwards.awardedAt,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, and(eq(bonusCampaigns.id, bonusAwards.campaignId), eq(bonusCampaigns.tenant, tenant)))
    .where(and(eq(bonusAwards.id, newBonusId), eq(bonusAwards.userId, userId), eq(bonusAwards.status, 'pending')))
    .limit(1)
    .then(
      (
        rows: {
          id: number
          status: string
          amount: string | null
          currency: string | null
          campaignId: number
          firstDepositRequired: boolean | null
          firstDepositUnlocked: boolean | null
          distributionTypeAward: string | null
          distributionTypeCampaign: string | null
          expiryBonusDays: unknown
          awardedAt: Date | null
        }[],
      ) => rows[0],
    )

  if (!newBonusWithCampaign) {
    throw new Error('Bonus not found or not in pending status')
  }

  if (newBonusWithCampaign.firstDepositRequired) {
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
      const walletForCheck = await ensureWallet(userId, tenant)
      const depositLedgerEntry = await (db as any)
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.walletId, walletForCheck.id),
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

  const rawExpiryDays = newBonusWithCampaign.expiryBonusDays ?? null
  const expiryDays = typeof rawExpiryDays === 'number' ? rawExpiryDays : Number(rawExpiryDays)
  if (Number.isFinite(expiryDays) && expiryDays >= 1 && newBonusWithCampaign.awardedAt) {
    const expiryDate = DateTime.fromJSDate(new Date(newBonusWithCampaign.awardedAt), { zone: 'Asia/Kolkata' })
      .plus({ days: Math.floor(expiryDays) })
      .toJSDate()
    if (new Date() > expiryDate) {
      throw new Error('Bonus has expired')
    }
  }

  const wallet = await ensureWallet(userId, tenant)
  const currentBonusBalance = Number(wallet.bonus || 0)

  await (db as any).transaction(async (tx: any) => {
    if (currentActiveBonus) {
      await tx
        .update(bonusAwards)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(bonusAwards.id, currentActiveBonus.id))

      if (currentBonusBalance > 0) {
        await tx
          .update(wallets)
          .set({ bonus: '0' })
          .where(eq(wallets.id, wallet.id))

        await tx.insert(ledgerEntries).values({
          tenant,
          walletId: wallet.id,
          type: 'debit',
          amount: String(currentBonusBalance),
          balanceBefore: String(currentBonusBalance),
          balanceAfter: '0',
          meta: {
            type: 'bonus_switch_debit',
            bonusAwardId: currentActiveBonus.id,
            campaignId: currentActiveBonus.campaignId,
            reason: 'Bonus switched to new bonus',
            currency: currentActiveBonus.currency || 'INR',
          } as Record<string, unknown>,
        })
        await createWalletLedgerEntry(tx, {
          tenant,
          walletId: wallet.id,
          userId,
          walletType: 'bonus',
          category: 'bonus_forfeit',
          direction: 'debit',
          amount: currentBonusBalance,
          balanceBefore: currentBonusBalance,
          balanceAfter: 0,
          description: 'Bonus switch (old bonus zeroed)',
          referenceType: 'bonus_award',
          referenceId: String(currentActiveBonus.id),
          meta: { bonusAwardId: currentActiveBonus.id },
        })
      }
    }

    const newBonusAmount = Number(newBonusWithCampaign.amount || 0)
    const switchDistributionType =
      newBonusWithCampaign.distributionTypeAward ?? newBonusWithCampaign.distributionTypeCampaign
    const isInstantCash = switchDistributionType === 'instant_cash'

    if (isInstantCash) {
      const currentCash = Number(wallet.cash || 0)
      const newCash = currentCash + newBonusAmount
      const exposure = Number(wallet.exposure ?? 0)
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
        amount: String(newBonusAmount),
        balanceBefore: String(currentCash),
        balanceAfter: String(newCash),
        meta: {
          type: 'bonus_instant_cash',
          remark: 'BONUS TO CASH',
          bonusAwardId: newBonusId,
          campaignId: newBonusWithCampaign.campaignId,
          currency: newBonusWithCampaign.currency || 'INR',
        } as Record<string, unknown>,
      })
      await createWalletLedgerEntry(tx, {
        tenant,
        walletId: wallet.id,
        userId,
        walletType: 'cash',
        category: 'bonus_transfer',
        direction: 'credit',
        amount: newBonusAmount,
        balanceBefore: cashLedgerBefore,
        balanceAfter: cashLedgerAfter,
        description: 'Switch to INSTANT CASH',
        referenceType: 'bonus_award',
        referenceId: String(newBonusId),
        meta: { bonusAwardId: newBonusId, campaignId: newBonusWithCampaign.campaignId },
      })

      const { deductWhitelabelCredit } = await import('./whitelabelCreditDeduct.js')
      const currency = await getWhitelabelCurrency(tenant)
      await deductWhitelabelCredit(tx, tenant, newBonusAmount, currency, `Switch bonus to instant cash - awardId=${newBonusId} campaignId=${newBonusWithCampaign.campaignId}`, {
        userId,
      })

      await tx
        .update(bonusAwards)
        .set({
          status: 'completed',
          completedAt: new Date(),
          ...(newBonusWithCampaign.firstDepositRequired ? { firstDepositUnlocked: true } : {}),
        })
        .where(eq(bonusAwards.id, newBonusId))
    } else {
      const bonusBalanceAfterForfeit = currentActiveBonus && currentBonusBalance > 0 ? 0 : currentBonusBalance
      const newBonusBalance = bonusBalanceAfterForfeit + newBonusAmount

      await tx
        .update(wallets)
        .set({ bonus: String(newBonusBalance) })
        .where(eq(wallets.id, wallet.id))

      await tx.insert(ledgerEntries).values({
        tenant,
        walletId: wallet.id,
        type: 'credit',
        amount: String(newBonusAmount),
        balanceBefore: String(bonusBalanceAfterForfeit),
        balanceAfter: String(newBonusBalance),
        meta: {
          type: 'bonus',
          bonusAwardId: newBonusId,
          campaignId: newBonusWithCampaign.campaignId,
          currency: newBonusWithCampaign.currency || 'INR',
        } as Record<string, unknown>,
      })
      await createWalletLedgerEntry(tx, {
        tenant,
        walletId: wallet.id,
        userId,
        walletType: 'bonus',
        category: 'bonus_activation',
        direction: 'credit',
        amount: newBonusAmount,
        balanceBefore: bonusBalanceAfterForfeit,
        balanceAfter: newBonusBalance,
        description: 'Bonus switch (new bonus)',
        referenceType: 'bonus_award',
        referenceId: String(newBonusId),
        meta: { bonusAwardId: newBonusId, campaignId: newBonusWithCampaign.campaignId },
      })

      await tx
        .update(bonusAwards)
        .set({
          status: 'active',
          ...(newBonusWithCampaign.firstDepositRequired ? { firstDepositUnlocked: true } : {}),
        })
        .where(eq(bonusAwards.id, newBonusId))
    }
  })
}
