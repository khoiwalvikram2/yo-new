/**
 * Which whitelabel the payment gateway screens act on. PG settings, WeLivePay payouts and their approvals
 * always run on one explicit whitelabel: admin-backend (domains/payments/paymentTenant.ts) refuses a Super
 * Admin in Core mode, or in Whitelabel mode with no site selected, with "Select a whitelabel before
 * configuring or approving gateway payments", and never falls back to `default`. The pages read the same
 * facts the GraphQL link sends (shared/core/api.ts: X-Admin-Mode, X-Whitelabel-ID) and detect that case
 * up front instead of asking the server. Pure; usePaymentWhitelabelScope reads the stores.
 */

export interface PaymentScopeSource {
  userId: string | null | undefined
  roles: readonly string[] | null | undefined
  /** uiStore.directorMode: 'core' | 'whitelabel'. */
  directorMode: string | null | undefined
  selectedWhitelabelId: string | null | undefined
  /** uiStore.tenant, the signed-in site of everyone but a Super Admin. */
  tenant: string | null | undefined
}

export interface PaymentScope {
  /** Changes whenever the payment whitelabel can change. Key a payment form or drawer by it, so a switch
   *  remounts it empty instead of carrying the last site's draft or open request over. */
  key: string
  superAdmin: boolean
  /** A Super Admin who has not selected a site: every payment operation would be refused, so none starts. */
  selectionRequired: boolean
  /** The tenant a Super Admin's answers must carry (the selected site). Null when the server derives it. */
  expectedTenant: string | null
}

/** The role-name test of the admin's GraphQL link and of admin-backend domains/common/roleNames.ts. */
export function isSuperAdminRoleName(role: string): boolean {
  const lower = (role ?? '').toLowerCase()
  return role === 'Super Admin' || lower === 'super_admin' || (lower.includes('super') && lower.includes('admin'))
}

export function paymentScopeOf(source: PaymentScopeSource): PaymentScope {
  const superAdmin = (source.roles ?? []).some(isSuperAdminRoleName)
  // The server trims the X-Whitelabel-ID header, so a blank selection is no selection.
  const selected = source.selectedWhitelabelId?.trim() || null
  const mode = source.directorMode === 'whitelabel' ? 'whitelabel' : 'core'
  const user = source.userId ?? ''
  if (!superAdmin) {
    return { key: `${user}:${source.tenant ?? ''}`, superAdmin, selectionRequired: false, expectedTenant: null }
  }
  const site = mode === 'whitelabel' ? selected : null
  return {
    key: `${user}:${mode}:${site ?? ''}`,
    superAdmin,
    selectionRequired: site === null,
    expectedTenant: site,
  }
}

/**
 * Whether an answer for `tenant` belongs to this scope. A Super Admin's must be for the selected site, so a
 * cached answer from before a switch is never shown as the new site's; for anyone else the server derives
 * the tenant, and any answer that names one is theirs.
 */
export function scopeAcceptsTenant(
  scope: Pick<PaymentScope, 'selectionRequired' | 'expectedTenant'>,
  tenant: string | null | undefined,
): boolean {
  if (scope.selectionRequired || !tenant) return false
  return scope.expectedTenant === null || tenant === scope.expectedTenant
}

export const SELECT_WHITELABEL_TITLE = 'Select a whitelabel'
export const SELECT_WHITELABEL_MESSAGE =
  'Switch to Whitelabel mode and select the site whose payment gateway you want to configure.'
