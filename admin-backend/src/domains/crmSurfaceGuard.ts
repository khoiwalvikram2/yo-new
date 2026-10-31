/**
 * Keeps the two principals on this endpoint apart.
 *
 * The admin panel and the CRM are served by one GraphQL schema, so both
 * resolver maps are merged onto one endpoint and a CRM token reaches every
 * field the admin panel declares. `buildAuthContext` already refuses CRM
 * tokens, so `ctx.user` is undefined for a CRM caller and any resolver calling
 * `requirePermission` throws — but most resolvers on this surface check
 * nothing, and helpers like `validateAgentPlayerAccess` return early for
 * "anything that is not an agent", which a CRM caller now is.
 *
 * Rather than add a check to two hundred resolvers and hope the next one
 * remembers, every admin-surface field is wrapped once: if the caller is a CRM
 * principal, it is refused. The CRM reaches its data through `crm*` fields,
 * which apply book scoping and record what was read.
 */

type Resolver = (parent: unknown, args: unknown, ctx: any, info: unknown) => unknown
type ResolverMap = Record<string, unknown>

/** Fields a CRM principal is allowed to call on the shared surface. */
const CRM_FIELD_PREFIX = 'crm'

/**
 * Admin-panel operations that happen to be named inside the `crm` prefix.
 *
 * Each of these belongs to the admin panel — a Super Admin granting a CRM, or a
 * whitelabel bootstrapping its first administrator — and each refuses non-admin
 * callers on its own. Listing them here means they are covered by the blanket
 * guard as well, so the refusal does not depend on every one of them
 * remembering. New admin-side CRM work should be named outside the prefix
 * instead (see `whitelabelCrm*`); this list is for the names that already
 * shipped.
 */
const ADMIN_OPERATIONS_INSIDE_CRM_PREFIX = new Set([
  'crmWhitelabels',
  'crmCreateFirstAdmin',
  'setCrmWhitelabelSettings',
])

function isCrmField(name: string): boolean {
  if (ADMIN_OPERATIONS_INSIDE_CRM_PREFIX.has(name)) return false
  // `setCrmWhitelabelSettings` used to be named again here as a second guard.
  // It is in the set above, which returns first, so the extra clause could
  // never run — and reading as though it exempted the field was the opposite
  // of what it did.
  return name.startsWith(CRM_FIELD_PREFIX)
}

function refuseCrmCallers(name: string, fn: Resolver): Resolver {
  return function guarded(parent: unknown, args: unknown, ctx: any, info: unknown) {
    if (ctx?.crmUser) {
      throw new Error(
        `Forbidden: ${name} is an admin-panel operation. CRM sessions use the crm* fields.`
      )
    }
    return fn(parent, args, ctx, info)
  }
}

/**
 * Wraps every field in an admin resolver map so CRM sessions are refused.
 *
 * Fields whose names begin with `crm` are left alone — they are the CRM's own
 * surface and carry their own guards.
 */
export function guardAdminSurface<T extends ResolverMap>(map: T): T {
  const out: ResolverMap = {}
  for (const [name, value] of Object.entries(map)) {
    out[name] =
      typeof value === 'function' && !isCrmField(name)
        ? refuseCrmCallers(name, value as Resolver)
        : value
  }
  return out as T
}
