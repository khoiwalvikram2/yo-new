import { appConfigQueryResolvers } from '@src/domains/app-config/resolvers/queries.js'
import { appConfigMutationResolvers } from '@src/domains/app-config/resolvers/mutations.js'
import { appConfigSubscriptionResolvers } from '@src/domains/app-config/resolvers/subscriptions.js'

// Helper to convert stored S3 keys (or base64/data URLs) into displayable URLs
async function convertS3KeyToUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null

  // Already a usable URL or data URI
  if (key.startsWith('http://') || key.startsWith('https://') || key.startsWith('data:')) {
    return key
  }

  try {
    // Prefer presigned URL so private buckets also work
    const { generatePresignedGetUrl, getS3ObjectUrl } = await import('@src/services/storage/s3.js')
    try {
      const presigned = await generatePresignedGetUrl(key, 7 * 24 * 3600) // 7 days
      if (presigned) return presigned
    } catch {}
    // Fallback to public URL construction (for public buckets/CloudFront)
    return getS3ObjectUrl(key)
  } catch (err) {
    return key
  }
}

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
    imageUrl: async (parent: any) => {
      // Convert S3 key to full URL for display, but keep original key in parent for updates
      if (!parent.imageUrl) {
        return null
      }
      try {
        const url = await convertS3KeyToUrl(parent.imageUrl)
        // If conversion returns the key itself (failed), log it
        if (url && url === parent.imageUrl && !url.startsWith('http://') && !url.startsWith('https://')) {
        }
        return url
      } catch (error) {
        // Return the key as-is if conversion fails - frontend might handle it
        return parent.imageUrl
      }
    },
  },
}

