import { hasPermission, ensureAgentCanMutate } from '@/domains/common/auth.js'
import { resolvePaymentTenant } from '../paymentTenant.js'
import { getOrCreatePgSettings, upsertPgSettings, regenerateWebhookToken, buildWebhookUrl, getPgMerchantKey, type PgSettingsView } from '@/repos/payments/pgSettingsRepo.js'
import { getUserBackendBaseUrl } from '@/config/env.js'
import { getWelivepayAvailableGateways, isPayinGatewayCode, isPayoutGatewayCode, paymentAmount } from '@shared/services/welivepay/welivepayClient.js'

function withWebhookUrl(v: PgSettingsView) {
  const webhookUrl = buildWebhookUrl(getUserBackendBaseUrl(), v.webhookToken)
  return {
    id: v.id,
    tenant: v.tenant,
    provider: v.provider,
    enabled: v.enabled,
    payinGateway: v.payinGateway,
    payoutEnabled: v.payoutEnabled,
    payoutGateway: v.payoutGateway,
    minPayout: v.minPayout,
    maxPayout: v.maxPayout,
    displayName: v.displayName,
    secretSiteKeyMasked: v.secretSiteKeyMasked,
    hasSecretSiteKey: v.hasSecretSiteKey,
    webhookUrl,
    payoutWebhookUrl: `${webhookUrl}/payout`,
    minDeposit: v.minDeposit,
    maxDeposit: v.maxDeposit,
    redirectSuccessUrl: v.redirectSuccessUrl,
    redirectFailureUrl: v.redirectFailureUrl,
    updatedAt: v.updatedAt,
  }
}

function requirePgPermission(ctx: any, action: 'view' | 'update') {
  if (!hasPermission(ctx?.permissions ?? [], 'payments.pgsettings', action)) {
    throw new Error('Forbidden: insufficient permissions for PG settings')
  }
}

export const pgSettingsQueryResolvers = {
  whitelabelPgSettings: async (_: any, __: any, ctx: any) => {
    requirePgPermission(ctx, 'view')
    return withWebhookUrl(await getOrCreatePgSettings(resolvePaymentTenant(ctx)))
  },
  // The merchant key stays server-side; only non-secret gateway options reach the admin UI.
  welivepayAvailableGateways: async (_: any, __: any, ctx: any) => {
    requirePgPermission(ctx, 'view')
    const key = await getPgMerchantKey(resolvePaymentTenant(ctx))
    if (!key) throw new Error('Save the WeLivePay merchant API key to load the assigned gateways')
    return getWelivepayAvailableGateways({ baseUrl: process.env.WELIVEPAY_BASE_URL || 'https://welivepay.in', key })
  },
}

export const pgSettingsMutationResolvers = {
  upsertWhitelabelPgSettings: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    requirePgPermission(ctx, 'update')
    const tenant = resolvePaymentTenant(ctx)
    const input = args.input ?? {}
    // Assignment is enforced by WeLivePay on every create request; here only the stored code shape is checked.
    if (input.payinGateway != null && !isPayinGatewayCode(input.payinGateway)) throw new Error('Invalid pay-in gateway')
    if (input.payoutGateway != null && !isPayoutGatewayCode(input.payoutGateway)) throw new Error('Invalid payout gateway')
    for (const field of ['minDeposit', 'maxDeposit', 'minPayout', 'maxPayout']) if (input[field] != null) paymentAmount(input[field])
    const current = await getOrCreatePgSettings(tenant)
    const minPayout = input.minPayout === undefined ? current.minPayout : input.minPayout
    const maxPayout = input.maxPayout === undefined ? current.maxPayout : input.maxPayout
    if (minPayout != null && maxPayout != null && minPayout > maxPayout) throw new Error('Minimum payout must not exceed maximum payout')
    if (input.minDeposit != null && input.maxDeposit != null && input.minDeposit >= input.maxDeposit) {
      throw new Error('Minimum deposit must be less than maximum deposit')
    }
    // Don't allow enabling collections or payouts without a merchant key (every request would fail).
    if (input.enabled === true || input.payoutEnabled === true) {
      const hasNewKey = typeof input.secretSiteKey === 'string' && input.secretSiteKey.trim().length > 0
      if (!hasNewKey && !current.hasSecretSiteKey) {
        throw new Error('Add the WeLivePay secret site key before enabling the gateway')
      }
    }
    const updatedByUserId = ctx?.user?.sub ? String(ctx.user.sub) : null
    return withWebhookUrl(await upsertPgSettings({ tenant, updatedByUserId, ...input }))
  },
  regeneratePgWebhookToken: async (_: any, __: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    requirePgPermission(ctx, 'update')
    return withWebhookUrl(await regenerateWebhookToken(resolvePaymentTenant(ctx)))
  },
}
