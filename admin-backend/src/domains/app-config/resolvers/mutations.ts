import { z } from 'zod'
import { upsertAppConfigDb } from '@src/repos/app-config/appConfigRepo.js'
import { invalidateWhitelabelConfigCache } from '@src/shared/whitelabelConfig.js'
import { deleteCmsPageDb, publishCmsPageDb, upsertCmsPageDb } from '@src/repos/app-config/cmsRepo.js'
import { createAdvertisementDb, updateAdvertisementDb, deleteAdvertisementDb, reorderAdvertisementsDb } from '@src/repos/app-config/advertisementsRepo.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { hasPermission } from '@src/domains/common/auth.js'

const UpdateAppConfigInput = z.object({
  input: z.object({
    // appName removed - use whitelabel.name instead
    supportEmail: z.union([z.string().email(), z.null()]).optional(),
    supportPhone: z.string().nullish(),
    whatsappSupportPhone: z.string().nullish(),
    defaultLocale: z.string().nullish(),
    timeZone: z.string().nullish(),
    baseCurrency: z.string().nullish(),
    domains: z.object({
      cdnBaseUrl: z.string().url().nullish(),
      assetBasePath: z.string().nullish(),
      canonicalBaseUrl: z.string().url().nullish(),
      sitemapBaseUrl: z.string().url().nullish(),
      robotsTxt: z.string().nullish(),
      robotsEnabled: z.boolean().nullish(),
    }).nullish(),
    maintenance: z.boolean().nullish(),
    maintenanceMessage: z.string().max(512).nullish(),
    newsTicker: z.string().max(1024).nullish(),
    seoTitle: z.string().nullish(),
    seoDescription: z.string().nullish(),
    ogImageUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
    socialLinks: z.record(z.string(), z.string().nullable()).nullish(),
    analytics: z.record(z.string(), z.any()).nullish(),
    features: z.object({
      sportsEnabled: z.boolean().nullish(),
      casinoEnabled: z.boolean().nullish(),
      matkaEnabled: z.boolean().nullish(),
      agentsEnabled: z.boolean().nullish(),
      referralsEnabled: z.boolean().nullish(),
      bonusesEnabled: z.boolean().nullish(),
      registerEnabled: z.boolean().nullish(),
    }).nullish(),
    payments: z.object({
      depositMin: z.number().nullish(),
      depositMax: z.number().nullish(),
      withdrawalMin: z.number().nullish(),
      withdrawalMax: z.number().nullish(),
      depositFeePercent: z.number().nullish(),
      withdrawalFeePercent: z.number().nullish(),
      kycRequiredToWithdraw: z.boolean().nullish(),
      roundingStrategy: z.string().nullish(),
      upiPayoutsDisabled: z.boolean().nullish(),
      bankPayoutsDisabled: z.boolean().nullish(),
      hideAddUpi: z.boolean().nullish(),
      hideAddBank: z.boolean().nullish(),
      maxDailyWithdrawalRequests: z.number().int().min(0).nullish(),
    }).nullish(),
    risk: z.object({
      overallExposureCap: z.number().nullish(),
      dailyStakeLimit: z.number().nullish(),
      weeklyStakeLimit: z.number().nullish(),
      cashoutEnabled: z.boolean().nullish(),
    }).nullish(),
    notifications: z.object({
      host: z.string().nullish(),
      port: z.number().nullish(),
      username: z.string().nullish(),
      password: z.string().nullish(),
      fromEmail: z.union([z.string().email(), z.null()]).optional(),
      alertRecipients: z.array(z.string().email()).max(20).nullish(),
    }).nullish(),
    sms: z.object({
      provider: z.string().nullish(),
      apiKey: z.string().nullish(),
      senderId: z.string().nullish(),
    }).nullish(),
    adminUiNotifications: z.object({
      enabled: z.boolean().nullish(),
      placement: z.string().nullish(),
      durationMs: z.number().nullish(),
      showSuccess: z.boolean().nullish(),
      showError: z.boolean().nullish(),
      showInfo: z.boolean().nullish(),
      showWarning: z.boolean().nullish(),
      muteCategories: z.array(z.string()).nullish(),
      soundEnabled: z.boolean().nullish(),
    }).nullish(),
    webhooks: z.object({
      endpointUrl: z.string().url().nullish(),
      secret: z.string().nullish(),
      events: z.array(z.string()).nullish(),
    }).nullish(),
    observability: z.object({
      sentryDsn: z.string().nullish(),
      logLevel: z.string().nullish(),
      metricsEnabled: z.boolean().nullish(),
    }).nullish(),
    pwa: z.object({
      shortName: z.string().nullish(),
      themeColor: z.string().nullish(),
      backgroundColor: z.string().nullish(),
    }).nullish(),
    theme: z.object({
      primary: z.string().nullish(),
      success: z.string().nullish(),
      warning: z.string().nullish(),
      danger: z.string().nullish(),
      dark: z.object({
        bgPage: z.string().nullish(),
        textPrimary: z.string().nullish(),
        textSecondary: z.string().nullish(),
        border: z.string().nullish(),
      }).nullish(),
      light: z.object({
        bgPage: z.string().nullish(),
        textPrimary: z.string().nullish(),
        textSecondary: z.string().nullish(),
        border: z.string().nullish(),
      }).nullish(),
    }).nullish(),
    preLoginBannerUrl: z.string().nullish(),
    postLoginBannerUrl: z.string().nullish(),
    sportsGlobalConfig: z.object({
      oddsFormat: z.enum(['decimal', 'fractional', 'american']).nullish(),
      showFancy: z.boolean().nullish(),
      showBookmaker: z.boolean().nullish(),
      showExchange: z.boolean().nullish(),
      defaultCommission: z.object({
        exchange: z.number().nullish(),
        bookmaker: z.number().nullish(),
        fancy: z.number().nullish(),
      }).nullish(),
      defaultStakeLimits: z.object({
        exchangeMin: z.number().nullish(),
        exchangeMax: z.number().nullish(),
        bookmakerMin: z.number().nullish(),
        bookmakerMax: z.number().nullish(),
        fancyMin: z.number().nullish(),
        fancyMax: z.number().nullish(),
      }).nullish(),
      defaultBetDelays: z.object({
        exchange: z.number().int().min(0).nullish(),
        bookmaker: z.number().int().min(0).nullish(),
        fancy: z.number().int().min(0).nullish(),
      }).nullish(),
      defaultBetCooldowns: z.object({
        exchange: z.number().int().min(0).nullish(),
        bookmaker: z.number().int().min(0).nullish(),
        fancy: z.number().int().min(0).nullish(),
      }).nullish(),
    }).nullish(),
  })
})

const UpsertCMSPageInput = z.object({
  input: z.object({
    id: z.string().optional(),
    slug: z.string(),
    title: z.string(),
    locale: z.string().optional(),
    body: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  })
})

const IdInput = z.object({ id: z.string() })

export const appConfigMutationResolvers = {
  updateAppConfig: async (_: any, args: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.app', 'update')) {
      throw new Error('Forbidden: insufficient permissions to update app config')
    }
    const p = UpdateAppConfigInput.safeParse(args)
    if (!p.success) {
      const errorDetails = p.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      throw new Error(`Invalid input: ${errorDetails}`)
    }
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    const userId = ctx?.user?.sub || '0'
    const input = p.data.input

    // Check if features are being modified - only Super Admin can modify feature toggles
    if (input.features) {
      const userRoles = ctx?.user?.roles || []
      const permissions = ctx?.permissions || []
      
      // Check for Super Admin (has all:* permission)
      const isSuperAdmin = permissions.some((p: any) => p.domain === 'all' && p.actions.includes('*')) ||
        userRoles.some((r: string) => 
          r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
          (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
        )
      
      if (!isSuperAdmin) {
        throw new Error('Insufficient permissions: Only Super Admin can modify feature toggles')
      }
    }

    // Map write-only secrets to *_enc storage fields
    const normalizedRecipients = input.notifications?.alertRecipients
      ?.map(email => email.trim())
      .filter((email, index, arr) => !!email && arr.indexOf(email) === index)

    const smtp = input.notifications ? {
      host: input.notifications.host,
      port: input.notifications.port,
      username: input.notifications.username,
      passwordEnc: input.notifications.password ? input.notifications.password : undefined,
      fromEmail: input.notifications.fromEmail,
      alertRecipients: normalizedRecipients,
    } : undefined
    const sms = input.sms ? {
      provider: input.sms.provider,
      apiKeyEnc: input.sms.apiKey,
      senderId: input.sms.senderId,
    } : undefined
    const webhooks = input.webhooks ? {
      endpointUrl: input.webhooks.endpointUrl,
      secretEnc: input.webhooks.secret,
      events: input.webhooks.events,
    } : undefined

    await upsertAppConfigDb(tenant, {
      // appName removed - use whitelabel.name instead
      supportEmail: input.supportEmail ?? undefined,
      supportPhone: input.supportPhone ?? undefined,
      whatsappSupportPhone: input.whatsappSupportPhone ?? undefined,
      defaultLocale: input.defaultLocale ?? undefined,
      timeZone: input.timeZone ?? undefined,
      baseCurrency: input.baseCurrency ?? undefined,
      domains: input.domains ? {
        cdnBaseUrl: input.domains.cdnBaseUrl ?? undefined,
        assetBasePath: input.domains.assetBasePath ?? undefined,
        canonicalBaseUrl: input.domains.canonicalBaseUrl ?? undefined,
        sitemapBaseUrl: input.domains.sitemapBaseUrl ?? undefined,
        robotsTxt: input.domains.robotsTxt ?? undefined,
        robotsEnabled: input.domains.robotsEnabled ?? undefined,
      } : undefined,
      maintenance: input.maintenance ?? undefined,
      maintenanceMessage: input.maintenanceMessage ?? undefined,
      newsTicker: input.newsTicker ?? undefined,
      seoTitle: input.seoTitle ?? undefined,
      seoDescription: input.seoDescription ?? undefined,
      ogImageUrl: input.ogImageUrl ?? undefined,
      socialLinks: input.socialLinks as any,
      analytics: input.analytics as any,
      sportsEnabled: input.features?.sportsEnabled ?? undefined,
      casinoEnabled: input.features?.casinoEnabled ?? undefined,
      matkaEnabled: input.features?.matkaEnabled ?? undefined,
      agentsEnabled: input.features?.agentsEnabled ?? undefined,
      referralsEnabled: input.features?.referralsEnabled ?? undefined,
      bonusesEnabled: input.features?.bonusesEnabled ?? undefined,
      registerEnabled: input.features?.registerEnabled ?? undefined,
      depositMin: input.payments?.depositMin,
      depositMax: input.payments?.depositMax,
      withdrawalMin: input.payments?.withdrawalMin,
      withdrawalMax: input.payments?.withdrawalMax,
      depositFeePercent: input.payments?.depositFeePercent,
      withdrawalFeePercent: input.payments?.withdrawalFeePercent,
      kycRequiredToWithdraw: input.payments?.kycRequiredToWithdraw ?? undefined,
      roundingStrategy: input.payments?.roundingStrategy ?? undefined,
      upiPayoutsDisabled: input.payments?.upiPayoutsDisabled ?? undefined,
      bankPayoutsDisabled: input.payments?.bankPayoutsDisabled ?? undefined,
      hideAddUpi: input.payments?.hideAddUpi ?? undefined,
      hideAddBank: input.payments?.hideAddBank ?? undefined,
      maxDailyWithdrawalRequests: (() => {
        const v = input.payments?.maxDailyWithdrawalRequests
        if (v === undefined) return undefined
        if (v === null || v === 0) return null
        return Math.floor(Number(v))
      })(),
      overallExposureCap: input.risk?.overallExposureCap,
      dailyStakeLimit: input.risk?.dailyStakeLimit,
      weeklyStakeLimit: input.risk?.weeklyStakeLimit,
      cashoutEnabled: input.risk?.cashoutEnabled ?? undefined,
      smtp: smtp ? {
        host: smtp.host ?? undefined,
        port: smtp.port ?? undefined,
        username: smtp.username ?? undefined,
        passwordEnc: smtp.passwordEnc,
        fromEmail: smtp.fromEmail ?? undefined,
        alertRecipients: smtp.alertRecipients,
      } : undefined,
      sms: sms ? {
        provider: sms.provider ?? undefined,
        apiKeyEnc: sms.apiKeyEnc ?? undefined,
        senderId: sms.senderId ?? undefined,
      } : undefined,
      adminUiNotifications: input.adminUiNotifications ? {
        enabled: input.adminUiNotifications.enabled ?? undefined,
        placement: input.adminUiNotifications.placement ?? undefined,
        durationMs: input.adminUiNotifications.durationMs ?? undefined,
        showSuccess: input.adminUiNotifications.showSuccess ?? undefined,
        showError: input.adminUiNotifications.showError ?? undefined,
        showInfo: input.adminUiNotifications.showInfo ?? undefined,
        showWarning: input.adminUiNotifications.showWarning ?? undefined,
        muteCategories: input.adminUiNotifications.muteCategories ?? undefined,
      } : undefined,
      webhooks: webhooks ? {
        endpointUrl: webhooks.endpointUrl ?? undefined,
        secretEnc: webhooks.secretEnc ?? undefined,
        events: webhooks.events ?? undefined,
      } : undefined,
      observability: input.observability as any,
      pwa: input.pwa as any,
      theme: input.theme as any,
      sportsGlobalConfig: input.sportsGlobalConfig as any,
      preLoginBannerUrl: input.preLoginBannerUrl ?? undefined,
      postLoginBannerUrl: input.postLoginBannerUrl ?? undefined,
    })

    invalidateWhitelabelConfigCache(tenant)

    await recordAuditDb({
      tenant,
      actorId: String(userId),
      domain: 'app-config',
      action: 'update',
      resourceType: 'AppConfig',
      resourceId: tenant,
      before: null,
      after: { keys: Object.keys(input) },
    })
    return { success: true, message: 'Configuration updated' }
  },

  upsertCMSPage: async (_: any, args: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.cms', 'update') && !hasPermission(ctx?.permissions ?? [], 'config.cms', 'create')) {
      throw new Error('Forbidden: insufficient permissions to update CMS')
    }
    const p = UpsertCMSPageInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    const userId = ctx?.user?.sub || '0'
    const res = await upsertCmsPageDb(tenant, {
      id: p.data.input.id ? Number(p.data.input.id) : undefined,
      slug: p.data.input.slug,
      title: p.data.input.title,
      locale: p.data.input.locale,
      body: p.data.input.body,
      seoTitle: p.data.input.seoTitle,
      seoDescription: p.data.input.seoDescription,
    })
    await recordAuditDb({
      tenant,
      actorId: String(userId),
      domain: 'app-config',
      action: 'cms_upsert',
      resourceType: 'CMSPage',
      resourceId: String(res.id),
      before: null,
      after: { slug: p.data.input.slug },
    })
    return { success: true, message: 'CMS page saved' }
  },

  publishCMSPage: async (_: any, args: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.cms', 'update')) {
      throw new Error('Forbidden: insufficient permissions to publish CMS')
    }
    const p = IdInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    const userId = ctx?.user?.sub || '0'
    await publishCmsPageDb(tenant, Number(p.data.id))
    await recordAuditDb({
      tenant,
      actorId: String(userId),
      domain: 'app-config',
      action: 'cms_publish',
      resourceType: 'CMSPage',
      resourceId: p.data.id,
    })
    return { success: true, message: 'Published' }
  },

  deleteCMSPage: async (_: any, args: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.cms', 'delete')) {
      throw new Error('Forbidden: insufficient permissions to delete CMS')
    }
    const p = IdInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    const userId = ctx?.user?.sub || '0'
    await deleteCmsPageDb(tenant, Number(p.data.id))
    await recordAuditDb({
      tenant,
      actorId: String(userId),
      domain: 'app-config',
      action: 'cms_delete',
      resourceType: 'CMSPage',
      resourceId: p.data.id,
    })
    return { success: true, message: 'Deleted' }
  },

  createAdvertisement: async (_: any, args: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.advertisements', 'create')) {
      throw new Error('Forbidden: insufficient permissions to create advertisement')
    }
    const CreateAdvertisementInput = z.object({
      input: z.object({
        title: z.string().min(1),
        subtitle: z.string().optional().nullable(),
        imageUrl: z.string().min(1),
        type: z.enum(['BANNER', 'PROMOTIONAL', 'FEATURED']),
        url: z.string().optional().nullable().refine((val) => !val || val.startsWith('http://') || val.startsWith('https://') || val.startsWith('/'), {
          message: 'URL must be a valid HTTP/HTTPS URL or relative path',
        }),
        order: z.number().int().optional().nullable(),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
        deviceType: z.enum(['DESKTOP', 'MOBILE', 'BOTH']).optional(),
      })
    })
    const p = CreateAdvertisementInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    const userId = ctx?.user?.sub || '0'
    const res = await createAdvertisementDb(tenant, p.data.input)
    await recordAuditDb({
      tenant,
      actorId: String(userId),
      domain: 'app-config',
      action: 'advertisement_create',
      resourceType: 'Advertisement',
      resourceId: String(res.id),
      before: null,
      after: { title: p.data.input.title, type: p.data.input.type },
    })
    return { success: true, message: 'Advertisement created' }
  },

  updateAdvertisement: async (_: any, args: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.advertisements', 'update')) {
      throw new Error('Forbidden: insufficient permissions to update advertisement')
    }
    const UpdateAdvertisementInput = z.object({
      input: z.object({
        id: z.string().min(1),
        title: z.string().optional(),
        subtitle: z.string().optional().nullable(),
        imageUrl: z.string().optional(),
        type: z.enum(['BANNER', 'PROMOTIONAL', 'FEATURED']).optional(),
        url: z.string().optional().nullable().refine((val) => !val || val.startsWith('http://') || val.startsWith('https://') || val.startsWith('/'), {
          message: 'URL must be a valid HTTP/HTTPS URL or relative path',
        }),
        order: z.number().int().optional().nullable(),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
        deviceType: z.enum(['DESKTOP', 'MOBILE', 'BOTH']).optional(),
      })
    })
    const p = UpdateAdvertisementInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    const userId = ctx?.user?.sub || '0'
    await updateAdvertisementDb(Number(p.data.input.id), tenant, p.data.input)
    await recordAuditDb({
      tenant,
      actorId: String(userId),
      domain: 'app-config',
      action: 'advertisement_update',
      resourceType: 'Advertisement',
      resourceId: p.data.input.id,
      before: null,
      after: { keys: Object.keys(p.data.input).filter(k => k !== 'id') },
    })
    return { success: true, message: 'Advertisement updated' }
  },

  deleteAdvertisement: async (_: any, args: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.advertisements', 'delete')) {
      throw new Error('Forbidden: insufficient permissions to delete advertisement')
    }
    const p = IdInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    const userId = ctx?.user?.sub || '0'
    await deleteAdvertisementDb(Number(p.data.id), tenant)
    await recordAuditDb({
      tenant,
      actorId: String(userId),
      domain: 'app-config',
      action: 'advertisement_delete',
      resourceType: 'Advertisement',
      resourceId: p.data.id,
    })
    return { success: true, message: 'Advertisement deleted' }
  },

  reorderAdvertisements: async (_: any, args: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.advertisements', 'update')) {
      throw new Error('Forbidden: insufficient permissions to reorder advertisements')
    }
    const ReorderInput = z.object({
      orders: z.array(z.object({
        id: z.string().min(1),
        order: z.number().int(),
      }))
    })
    const p = ReorderInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    const userId = ctx?.user?.sub || '0'
    await reorderAdvertisementsDb(tenant, p.data.orders.map(o => ({ id: Number(o.id), order: o.order })))
    await recordAuditDb({
      tenant,
      actorId: String(userId),
      domain: 'app-config',
      action: 'advertisements_reorder',
      resourceType: 'Advertisement',
      resourceId: 'multiple',
    })
    return { success: true, message: 'Advertisements reordered' }
  },
}

