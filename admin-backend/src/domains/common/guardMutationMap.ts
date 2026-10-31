import { hasPermission, ensureAgentCanMutate } from '@src/domains/common/auth.js'

/**
 * Gates a resolver map field by field.
 *
 * Five domains wrapped their mutations in a single `canMutateX(ctx)` that ORed
 * every write permission the domain has. Holding any one of them opened all of
 * them: in sports, a caller entitled only to void a bet could declare a result
 * and delete automation rules; in casino, `casino.bet-settings:create` reached
 * the provider and vendor-override screens. Permissions an administrator can
 * grant and withhold separately collapsed into one.
 *
 * The shape here is the one `wrapVipMutations` already used and the rest did
 * not: a field names what it needs, and a field naming nothing is **refused**.
 * That default is the point — a mutation added later should fail loudly and be
 * given a permission rather than inherit an open door from its neighbours.
 *
 * A field may list alternatives, in which case any one suffices. That is not
 * laxity: some operations are legitimately reached by two different principals,
 * typically an admin through a finance screen and an agent acting on its own
 * downline, and `deriveAgentPermissions` grants no finance permission at all.
 */
export type RequiredPermission = readonly (readonly [string, string])[]

export type GuardOptions = {
  /** Named in error messages, e.g. "sports". */
  label: string
  /** Fields that must stay reachable, with the reason in a comment at the call site. */
  open?: readonly string[]
  /** Skip `ensureAgentCanMutate` — only for maps no agent can reach. */
  skipAgentGuard?: boolean
  /**
   * Per-call escape hatch, for the one shape a static table cannot express:
   * an agent generating its own referral link is entitled to that mutation
   * without holding the referral-management permission.
   */
  exempt?: (key: string, parent: unknown, args: unknown, ctx: any) => boolean
}

type Resolver = (parent: unknown, args: unknown, ctx: any, info: unknown) => unknown

export function guardMutationMap<T extends Record<string, unknown>>(
  map: T,
  permissions: Record<string, RequiredPermission>,
  options: GuardOptions
): T {
  const open = new Set(options.open ?? [])
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== 'function' || open.has(key)) {
      out[key] = value
      continue
    }

    const required = permissions[key]
    const fn = value as Resolver

    out[key] = function guarded(parent: unknown, args: unknown, ctx: any, info: unknown) {
      if (!ctx?.user) throw new Error('Unauthorized: authentication required')
      if (options.exempt?.(key, parent, args, ctx)) return fn(parent, args, ctx, info)
      if (!options.skipAgentGuard) ensureAgentCanMutate(ctx)

      if (!required || required.length === 0) {
        throw new Error(
          `Forbidden: ${key} declares no permission. Add it to the ${options.label} permission map.`
        )
      }
      const perms = ctx?.permissions ?? []
      if (!required.some(([domain, action]) => hasPermission(perms, domain, action))) {
        const names = required.map(([d, a]) => `${d}:${a}`).join(' or ')
        throw new Error(`Forbidden: insufficient permissions for ${names}`)
      }
      return fn(parent, args, ctx, info)
    }
  }

  return out as T
}
