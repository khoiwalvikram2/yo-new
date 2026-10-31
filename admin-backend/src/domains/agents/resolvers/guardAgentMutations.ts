import { hasPermission, ensureAgentCanMutate } from '@src/domains/common/auth.js'

/**
 * Authorises the `Mutation.agents` namespace, which nothing did.
 *
 * `Query.agents` refuses a caller without `agents.list:view` before returning
 * its namespace object (resolvers/index.ts). `Mutation.agents` returned `{}`
 * unconditionally, and every one of the twenty-six mutations underneath it —
 * credit adjustment, credential resets, sharing and commission configuration,
 * settlement posting — ran with no authorization at all.
 *
 * Measured: with **no session whatsoever** (`ctx.user` undefined),
 * `adjustAgentCredit`, `setAgentCredentials`, `createAgent` and
 * `setSharingConfig` all reached their bodies and failed on missing input
 * rather than on permission. `guardAdminSurface` does not help — it refuses CRM
 * principals on admin fields and says nothing about an anonymous one.
 *
 * The gate lives per field rather than on the namespace because `agentLogin`
 * lives here too: it is the agent sign-in, and there is no session yet when it
 * is called.
 *
 * Agents keep their own paths. An agent principal carries flat permissions
 * (`agents:manage`, `agents:write`) which `hasPermission` resolves against the
 * nested names below, so an agent managing its own sub-tree still passes; the
 * resolvers then scope it through `agent_hierarchy_closure` as they always did.
 */

type Resolver = (parent: unknown, args: unknown, ctx: any, info: unknown) => unknown

const SETTLEMENT: [string, string][] = [
  ['settlements.agent', 'create'],
  ['agents.credit', 'update'],
]

/**
 * The permission each mutation demands, by the catalogue's own names.
 *
 * A value may list more than one pair, in which case holding **any** of them
 * suffices. That is not laxity: settlement is reachable both from the finance
 * screens (`settlements.agent:create`, flat `finance:write`) and from an agent
 * settling its own downline (`agents.credit:update`, flat `agents:manage`).
 * Naming only the first would refuse every agent principal, because
 * `deriveAgentPermissions` grants no finance permission at all — measured.
 */
export const AGENT_MUTATION_PERMISSIONS: Record<string, [string, string][]> = {
  createAgent: [['agents.create', 'create']],
  updateAgent: [['agents.profile', 'update']],
  updateAgentStatus: [['agents.profile', 'update']],
  suspendSubAgent: [['agents.profile', 'update']],
  blockSubAgent: [['agents.profile', 'update']],
  setAgentCredentials: [['agents.profile', 'update']],
  changeAgentPassword: [['agents.profile', 'update']],
  adminResetAgentPassword: [['agents.profile', 'update']],

  setCommissionConfig: [['agents.commission', 'update']],
  setSharingConfig: [['agents.sharing', 'update']],

  // Everything that moves money.
  adjustAgentCredit: [['agents.credit', 'update']],
  adjustSubAgentCredit: [['agents.credit', 'update']],
  allocateCreditToPlayer: [['agents.credit', 'update']],
  depositCredit: [['agents.credit', 'update']],
  withdrawCredit: [['agents.credit', 'update']],
  transferCredit: [['agents.credit', 'update']],
  applyCreditReconciliation: [['agents.credit', 'update']],
  setAgentCreditAlertThreshold: [['agents.credit', 'update']],
  resolveAgentCreditAlert: [['agents.credit', 'update']],
  adjustWhitelabelPlayerCredit: [['agents.credit', 'update']],
  depositCreditToWhitelabelPlayer: [['agents.credit', 'update']],
  withdrawCreditFromWhitelabelPlayer: [['agents.credit', 'update']],

  // Either the finance route or the agent's own downline route.
  settleAgent: SETTLEMENT,
  settleSharingAgent: SETTLEMENT,
  postSettlement: SETTLEMENT,
}

/**
 * The one mutation here that must stay open: it is how an agent obtains a
 * session in the first place.
 */
const OPEN: ReadonlySet<string> = new Set(['agentLogin'])

/**
 * Wraps the agent mutation map so every field states what it needs.
 *
 * A field absent from both lists is **refused** rather than allowed. That is
 * the opposite of the default this file exists to correct: a mutation added
 * here later should fail loudly and be given a permission, not inherit an open
 * door from its neighbours.
 */
export function guardAgentMutations<T extends Record<string, unknown>>(map: T): T {
  const out: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(map)) {
    if (typeof value !== 'function' || OPEN.has(name)) {
      out[name] = value
      continue
    }

    const required = AGENT_MUTATION_PERMISSIONS[name]
    const fn = value as Resolver

    out[name] = function guarded(parent: unknown, args: unknown, ctx: any, info: unknown) {
      if (!ctx?.user) throw new Error('Unauthorized: authentication required')
      ensureAgentCanMutate(ctx)

      if (!required) {
        throw new Error(
          `Forbidden: ${name} declares no permission. Add it to AGENT_MUTATION_PERMISSIONS.`
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
