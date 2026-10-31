import {
  getReferralBudgetDb,
  upsertReferralBudgetDb,
  incrementReferralBudgetSpentDb,
} from '@src/repos/referrals/referralsRepo.js'
import { CurrencyCode } from '@src/types/currency.js'
import { getStartOfDay, getStartOfMonth } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'

/**
 * Budget Service - Enforces referral budget caps
 */
export class BudgetService {
  /**
   * Check if budget allows spending
   */
  async checkBudget(
    tenant: string,
    programId: number | null,
    amount: number,
    currency: CurrencyCode,
    budgetType: 'daily' | 'monthly' = 'monthly'
  ): Promise<{ allowed: boolean; remaining: number; budgetId?: number }> {
    const tz = await getWhitelabelTimezone(tenant)
    let periodStart: Date
    let periodEnd: Date

    if (budgetType === 'daily') {
      periodStart = getStartOfDay(tz)
      const { DateTime } = await import('luxon')
      periodEnd = DateTime.now().setZone(tz).plus({ days: 1 }).startOf('day').toJSDate()
    } else {
      periodStart = getStartOfMonth(tz)
      const { DateTime } = await import('luxon')
      periodEnd = DateTime.now().setZone(tz).plus({ months: 1 }).startOf('month').toJSDate()
    }

    const budget = await getReferralBudgetDb(
      tenant,
      programId,
      budgetType,
      periodStart,
      periodEnd
    )

    if (!budget) {
      // No budget set = unlimited
      return { allowed: true, remaining: Infinity }
    }

    const budgetAmount = Number(budget.amount)
    const spent = Number(budget.spent)
    const remaining = budgetAmount - spent

    if (remaining < amount) {
      return { allowed: false, remaining, budgetId: budget.id }
    }

    return { allowed: true, remaining: remaining - amount, budgetId: budget.id }
  }

  /**
   * Set budget cap
   */
  async setBudget(
    tenant: string,
    data: {
      programId?: number | null
      budgetType: 'daily' | 'monthly'
      amount: number
      currency: CurrencyCode
      periodStart: Date
      periodEnd: Date
    }
  ): Promise<void> {
    await upsertReferralBudgetDb(tenant, data)
  }

  /**
   * Increment spent amount
   */
  async incrementSpent(
    budgetId: number,
    amount: number
  ): Promise<void> {
    await incrementReferralBudgetSpentDb(budgetId, amount)
  }

  /**
   * Check and enforce budget before spending
   */
  async enforceBudget(
    tenant: string,
    programId: number | null,
    amount: number,
    currency: CurrencyCode,
    budgetType: 'daily' | 'monthly' = 'monthly'
  ): Promise<{ allowed: boolean; remaining: number }> {
    const check = await this.checkBudget(tenant, programId, amount, currency, budgetType)

    if (check.allowed && check.budgetId) {
      // Increment spent
      await this.incrementSpent(check.budgetId, amount)
    }

    return { allowed: check.allowed, remaining: check.remaining }
  }
}

export const budgetService = new BudgetService()

