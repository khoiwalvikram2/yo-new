import { hasPermission } from '@src/domains/common/auth.js'

/**
 * Resolves the tenant a live subscription should watch.
 *
 * Every live subscription built its scope as
 * `args?.scope?.tenant || ctx?.tenant || 'default'`, so a client-supplied value
 * took precedence over the session's own. A whitelabel admin, or an agent, could
 * subscribe to another brand's live dashboard, exposure book or risk alerts
 * simply by naming it — and unlike a query, a subscription then streams that
 * brand's activity for as long as the socket stays open.
 *
 * Naming a tenant is a platform-wide action, so it is honoured only for a caller
 * holding platform-wide permission. Everyone else watches their own tenant. The
 * request is ignored rather than refused: the scope argument is also how the
 * legitimate Super Admin views are selected, and narrowing a caller to what they
 * are entitled to gives them a working stream rather than an error.
 */
export function resolveSubscriptionTenant(
  ctx: any,
  requested: string | null | undefined,
  fallback: string | null | undefined
): string {
  const own = fallback ?? 'default'
  if (!requested) return own
  if (hasPermission(ctx?.permissions ?? [], 'all', '*')) return requested
  return own
}
