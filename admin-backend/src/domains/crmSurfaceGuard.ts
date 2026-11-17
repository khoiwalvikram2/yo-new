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
 *
 * The same wrapper answers three more questions about the caller that no
 * resolver should have to remember:
 *
 *   - a token that was presented but is no longer honoured (`ctx.authRejected`,
 *     set by `buildAuthContext`) gets one answer on every field, so the panel
 *     ends a revoked session on its first request instead of navigating on
 *     "insufficient permissions" until a reload;
 *   - an admin who must choose a new password (`ctx.passwordChangeRequired`)
 *     may do only that;
 *   - an agent is refused the admin-only reads its flat grants would otherwise
 *     open (common/agentExcludedOperations.ts).
 */

import { isAgentExcludedOperation } from '@src/domains/common/agentExcludedOperations.js'

type Resolver = (parent: unknown, args: unknown, ctx: any, info: unknown) => unknown
type ResolverMap = Record<string, unknown>

/**
 * Root fields a caller reaches before, or instead of, a working session:
 * signing in and out, liveness, and the branding the login page renders. They
 * run as an anonymous caller when the token sent with them was refused, which
 * is what they did before; a stale token in the browser must not stop its
 * owner signing in again. `Mutation.agents` is the namespace `agentLogin` lives
 * under; every other field in it is gated by guardAgentMutations.
 */
const PRE_SESSION_FIELDS: ReadonlySet<string> = new Set([
  'Query.health',
  'Query.whitelabelCurrent',
  'Query.whitelabel',
  'Mutation.login',
  'Mutation.logout',
  'Mutation.agents',
])

/** What a session that must first choose a new password may still do. */
const PASSWORD_CHANGE_FIELDS: ReadonlySet<string> = new Set([
  ...PRE_SESSION_FIELDS,
  'Mutation.changeAdminPassword',
])

export const PASSWORD_CHANGE_REQUIRED_MESSAGE =
  'Password change required: change your password to continue.'

/** `Query.name` or `Mutation.name`; a field reached without its resolve info is treated as no pre-session field. */
function rootFieldOf(name: string, info: unknown): string {
  const parentType = (info as { parentType?: { name?: unknown } } | null | undefined)?.parentType?.name
  return `${typeof parentType === 'string' ? parentType : '?'}.${name}`
}

/**
 * Completes Reset Password: once the admin's own change succeeds the flag is
 * cleared, so the next sign-in is a normal one. Done here, beside the rule that
 * made the change the only thing the session could do, rather than in the
 * password-change resolver, which also serves changes nobody required.
 */
async function finishRequiredPasswordChange(result: unknown, ctx: any): Promise<unknown> {
  const out = await result
  const userId = Number(ctx?.user?.sub)
  if ((out as { success?: unknown } | null | undefined)?.success === true && Number.isSafeInteger(userId) && userId > 0) {
    const { clearRequiredPasswordChange } = await import('@src/domains/common/auth.js')
    await clearRequiredPasswordChange(userId)
  }
  return out
}

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
    if (ctx?.authRejected || ctx?.passwordChangeRequired) {
      const field = rootFieldOf(name, info)
      if (ctx.authRejected && !PRE_SESSION_FIELDS.has(field)) {
        throw new Error(String(ctx.authRejected.message))
      }
      if (ctx.passwordChangeRequired) {
        if (!PASSWORD_CHANGE_FIELDS.has(field)) throw new Error(PASSWORD_CHANGE_REQUIRED_MESSAGE)
        if (field === 'Mutation.changeAdminPassword') {
          return finishRequiredPasswordChange(fn(parent, args, ctx, info), ctx)
        }
      }
    }
    if (ctx?.user?.type === 'agent' && isAgentExcludedOperation(name)) {
      throw new Error(`Forbidden: ${name} is an admin-panel operation and is not available to agents`)
    }
    return fn(parent, args, ctx, info)
  }
}

/**
 * Wraps every field in an admin resolver map so CRM sessions are refused, and
 * so are refused sessions, password-change-only sessions and agents where the
 * header comment says.
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
