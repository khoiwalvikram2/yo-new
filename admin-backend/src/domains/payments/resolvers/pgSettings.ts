import { hasPermission } from '@/domains/common/auth.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { getOrCreatePgSettings, upsertPgSettings, regenerateWebhookToken, buildWebhookUrl, type PgSettingsView } from '@/repos/payments/pgSettingsRepo.js'
import { getUserBackendBaseUrl } from '@/config/env.js'

function resolveTenant(ctx: any): string {
  const directorTenant = getEffectiveTenantForDirector(ctx)
  return directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
}

function withWebhookUrl(v: PgSettingsView) {
  return {
    id: v.id,
    tenant: v.tenant,
    provider: v.provider,
    enabled: v.enabled,
    displayName: v.displayName,
    secretSiteKeyMasked: v.secretSiteKeyMasked,
    hasSecretSiteKey: v.hasSecretSiteKey,
    webhookUrl: buildWebhookUrl(getUserBackendBaseUrl(), v.webhookToken),
    minDeposit: v.minDeposit,
    maxDeposit: v.maxDeposit,
    redirectSuccessUrl: v.redirectSuccessUrl,
    redirectFailureUrl: v.redirectFailureUrl,
    updatedAt: v.updatedAt,
  }
}

export const pgSettingsQueryResolvers = {
  whitelabelPgSettings: async (_: any, __: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'payments.pgsettings', 'view')) {
      throw new Error('Forbidden: insufficient permissions for PG settings')
    }
    return withWebhookUrl(await getOrCreatePgSettings(resolveTenant(ctx)))
  },
}

export const pgSettingsMutationResolvers = {
  upsertWhitelabelPgSettings: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'payments.pgsettings', 'update')) {
      throw new Error('Forbidden: insufficient permissions for PG settings')
    }
    const tenant = resolveTenant(ctx)
    const input = args.input ?? {}
    if (input.minDeposit != null && input.maxDeposit != null && input.minDeposit >= input.maxDeposit) {
      throw new Error('Minimum deposit must be less than maximum deposit')
    }
    // Don't allow enabling the gateway without a secret key (would break every deposit).
    if (input.enabled === true) {
      const hasNewKey = typeof input.secretSiteKey === 'string' && input.secretSiteKey.trim().length > 0
      if (!hasNewKey) {
        const current = await getOrCreatePgSettings(tenant)
        if (!current.hasSecretSiteKey) {
          throw new Error('Add the WeLivePay secret site key before enabling the gateway')
        }
      }
    }
    const updatedByUserId = ctx?.user?.sub ? String(ctx.user.sub) : null
    return withWebhookUrl(await upsertPgSettings({ tenant, updatedByUserId, ...input }))
  },
  regeneratePgWebhookToken: async (_: any, __: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'payments.pgsettings', 'update')) {
      throw new Error('Forbidden: insufficient permissions for PG settings')
    }
    return withWebhookUrl(await regenerateWebhookToken(resolveTenant(ctx)))
  },
}
