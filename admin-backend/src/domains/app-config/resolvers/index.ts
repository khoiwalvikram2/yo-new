import { appConfigQueryResolvers } from '@src/domains/app-config/resolvers/queries.js'
import { appConfigMutationResolvers } from '@src/domains/app-config/resolvers/mutations.js'
import { appConfigSubscriptionResolvers } from '@src/domains/app-config/resolvers/subscriptions.js'
import { displayableAsset } from '@shared/utils/dataUri.js'

export const appConfigResolvers = {
  Query: {
    ...appConfigQueryResolvers,
  },
  Mutation: {
    ...appConfigMutationResolvers,
  },
  Subscription: {
    ...appConfigSubscriptionResolvers,
  },
  AppConfig: {
    features: (parent: any) => {
      return {
        sportsEnabled: parent.sportsEnabled ?? true,
        casinoEnabled: parent.casinoEnabled ?? true,
        matkaEnabled: parent.matkaEnabled ?? true,
        agentsEnabled: parent.agentsEnabled ?? true,
        referralsEnabled: parent.referralsEnabled ?? true,
        bonusesEnabled: parent.bonusesEnabled ?? true,
        registerEnabled: parent.registerEnabled ?? true,
      }
    },
    payments: (parent: any) => {
      if (
        !parent.depositMin &&
        !parent.depositMax &&
        !parent.withdrawalMin &&
        !parent.withdrawalMax &&
        !parent.depositFeePercent &&
        !parent.withdrawalFeePercent &&
        parent.kycRequiredToWithdraw === undefined &&
        !parent.roundingStrategy &&
        !parent.upiPayoutsDisabled &&
        !parent.bankPayoutsDisabled &&
        !parent.hideAddUpi &&
        !parent.hideAddBank &&
        (parent.maxDailyWithdrawalRequests == null || Number(parent.maxDailyWithdrawalRequests) <= 0)
      ) {
        return null
      }
      return {
        depositMin: parent.depositMin ? Number(parent.depositMin) : null,
        depositMax: parent.depositMax ? Number(parent.depositMax) : null,
        withdrawalMin: parent.withdrawalMin ? Number(parent.withdrawalMin) : null,
        withdrawalMax: parent.withdrawalMax ? Number(parent.withdrawalMax) : null,
        depositFeePercent: parent.depositFeePercent ? Number(parent.depositFeePercent) : null,
        withdrawalFeePercent: parent.withdrawalFeePercent ? Number(parent.withdrawalFeePercent) : null,
        kycRequiredToWithdraw: parent.kycRequiredToWithdraw ?? false,
        roundingStrategy: parent.roundingStrategy ?? null,
        upiPayoutsDisabled: parent.upiPayoutsDisabled ?? false,
        bankPayoutsDisabled: parent.bankPayoutsDisabled ?? false,
        hideAddUpi: parent.hideAddUpi ?? false,
        hideAddBank: parent.hideAddBank ?? false,
        maxDailyWithdrawalRequests:
          parent.maxDailyWithdrawalRequests != null && Number(parent.maxDailyWithdrawalRequests) > 0
            ? Number(parent.maxDailyWithdrawalRequests)
            : null,
      }
    },
    risk: (parent: any) => {
      if (!parent.overallExposureCap && !parent.dailyStakeLimit && !parent.weeklyStakeLimit && parent.cashoutEnabled === undefined) {
        return null
      }
      return {
        overallExposureCap: parent.overallExposureCap ? Number(parent.overallExposureCap) : null,
        dailyStakeLimit: parent.dailyStakeLimit ? Number(parent.dailyStakeLimit) : null,
        weeklyStakeLimit: parent.weeklyStakeLimit ? Number(parent.weeklyStakeLimit) : null,
        cashoutEnabled: parent.cashoutEnabled ?? true,
      }
    },
    notifications: (parent: any) => {
      const smtp = parent.smtp
      if (!smtp || (!smtp.host && !smtp.port && !smtp.username && !smtp.fromEmail)) {
        return null
      }
      return {
        host: smtp.host ?? null,
        port: smtp.port ?? null,
        username: smtp.username ?? null,
        fromEmail: smtp.fromEmail ?? null,
        alertRecipients: Array.isArray(smtp.alertRecipients) ? smtp.alertRecipients : [],
      }
    },
    sms: (parent: any) => {
      const sms = parent.sms
      if (!sms || (!sms.provider && !sms.senderId)) {
        return null
      }
      return {
        provider: sms.provider ?? null,
        senderId: sms.senderId ?? null,
      }
    },
    updatedAt: (parent: any) => {
      return parent.updatedAt ? new Date(parent.updatedAt).toISOString() : new Date().toISOString()
    },
  },
  Advertisement: {
    // The stored data URI or link as it is; a legacy S3 key is null, since nothing can fetch it any more.
    imageUrl: (parent: any) => displayableAsset(parent.imageUrl),
  },
}

