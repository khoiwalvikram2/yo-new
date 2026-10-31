import { getAppConfigDb } from '@src/repos/app-config/appConfigRepo.js'
import { listCmsPagesDb, getCmsPageByIdDb, getCmsPageBySlugDb } from '@src/repos/app-config/cmsRepo.js'
import { listAdvertisementsDb } from '@src/repos/app-config/advertisementsRepo.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { requireReadPermission } from '@src/domains/common/auth.js'

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
    // Resolve S3 keys to presigned URLs so the admin panel can display previews
    const [preLoginBannerUrl, postLoginBannerUrl] = await Promise.all([
      convertS3KeyToUrl((config as any).preLoginBannerUrl),
      convertS3KeyToUrl((config as any).postLoginBannerUrl),
    ])
    return {
      ...config,
      preLoginBannerUrl: preLoginBannerUrl ?? (config as any).preLoginBannerUrl ?? null,
      postLoginBannerUrl: postLoginBannerUrl ?? (config as any).postLoginBannerUrl ?? null,
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

