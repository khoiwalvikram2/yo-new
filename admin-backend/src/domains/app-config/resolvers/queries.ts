import { getAppConfigDb } from '@src/repos/app-config/appConfigRepo.js'
import { listCmsPagesDb, getCmsPageByIdDb, getCmsPageBySlugDb } from '@src/repos/app-config/cmsRepo.js'
import { listAdvertisementsDb } from '@src/repos/app-config/advertisementsRepo.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { requireReadPermission } from '@src/domains/common/auth.js'
import { displayableAsset } from '@shared/utils/dataUri.js'

export const appConfigQueryResolvers = {
  appDisplayConfig: async (_: any, __: any, ctx: any) => {
    if (!ctx?.user) throw new Error('Forbidden: authentication required')
    // Currency/date formatting is needed by agents and restricted admin roles.
    // Keep operational configuration behind its existing permission boundary.
    const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.whitelabel?.id ?? ctx?.tenant
    if (!tenant) throw new Error('Tenant context required')
    const config = await getAppConfigDb(tenant)
    return { baseCurrency: config.baseCurrency, timeZone: config.timeZone, defaultLocale: config.defaultLocale }
  },
  appConfig: async (_: any, __: any, ctx: any) => {
    requireReadPermission(ctx, 'config.app', 'view')
    if (!ctx?.user) {
      throw new Error('Forbidden: authentication required')
    }
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    const config = await getAppConfigDb(tenant)
    // The popup banners as stored (data URIs, or links); a legacy S3 key is null, since nothing can fetch it.
    return {
      ...config,
      preLoginBannerUrl: displayableAsset((config as any).preLoginBannerUrl),
      postLoginBannerUrl: displayableAsset((config as any).postLoginBannerUrl),
    }
  },
  cmsPages: async (_: any, args: { locale?: string; status?: 'DRAFT' | 'PUBLISHED' }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.app', 'view')) {
      throw new Error('Forbidden: insufficient permissions to access app config')
    }
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    return listCmsPagesDb(tenant, { locale: args.locale, status: args.status })
  },
  cmsPage: async (_: any, args: { id?: string; slug?: string; locale?: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.app', 'view')) {
      throw new Error('Forbidden: insufficient permissions to access app config')
    }
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    if (args.id) {
      return getCmsPageByIdDb(tenant, Number(args.id))
    }
    if (args.slug) {
      return getCmsPageBySlugDb(tenant, args.slug, args.locale)
    }
    return null
  },
  advertisements: async (_: any, args: { status?: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'config.app', 'view')) {
      throw new Error('Forbidden: insufficient permissions to access app config')
    }
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || 'default')
    return listAdvertisementsDb(tenant, { status: args.status })
  },
}

