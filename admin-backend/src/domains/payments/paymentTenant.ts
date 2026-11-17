import { hasSuperAdminRoleName } from '@src/domains/common/roleNames.js'

type PaymentContext = {
  user?: { roles?: string[] }
  tenant?: string
  whitelabel?: { id?: string }
  directorMode?: string | null
  directorWhitelabelId?: string | null
}

/** A Super Admin in Core mode, or in Whitelabel mode without a site, has no payment whitelabel. */
export function paymentWhitelabelSelectionRequired(ctx: PaymentContext): boolean {
  return Boolean(hasSuperAdminRoleName(ctx.user?.roles) && (ctx.directorMode !== 'whitelabel' || !ctx.directorWhitelabelId?.trim()))
}

/**
 * Payment credentials, gateway payouts and their approvals always act on one explicit, authenticated
 * whitelabel. Unlike getEffectiveTenantForDirector, this never falls back to 'default'.
 */
export function resolvePaymentTenant(ctx: PaymentContext): string {
  if (!ctx.user) throw new Error('Unauthorized: authentication required')
  if (paymentWhitelabelSelectionRequired(ctx)) throw new Error('Select a whitelabel before configuring or approving gateway payments')
  const tenant = hasSuperAdminRoleName(ctx.user.roles) ? ctx.directorWhitelabelId : ctx.tenant ?? ctx.whitelabel?.id
  if (!tenant?.trim()) throw new Error('A payment whitelabel is required')
  return tenant.trim()
}
