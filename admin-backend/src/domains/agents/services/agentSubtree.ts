import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'

/**
 * May this caller act on this agent?
 *
 * The agent model authorises **downward**: an agent sees and acts on its own
 * subtree, resolved through `agent_hierarchy_closure`, which covers arbitrary
 * depth so a grandparent reaches a grandchild. `canAgentAccess` in
 * `resolvers/queries.ts` enforces exactly that for reads.
 *
 * Nine mutations that take an agent id enforced none of it. They scoped by
 * tenant — some not even that — so an agent principal could name its own
 * PARENT or a SIBLING and: overwrite their login credentials, reset their
 * password, rewrite their commission or sharing rate, adjust their credit, or
 * settle them. Measured: zero hierarchy checks across `setAgentCredentials`,
 * `setCommissionConfig`, `setSharingConfig`, `settleAgent`, `adjustAgentCredit`,
 * `allocateCreditToPlayer`, `depositCredit`, `withdrawCredit`,
 * `settleSharingAgent` and `adminResetAgentPassword`.
 *
 * An admin principal is unconstrained here: tenant scoping is the boundary that
 * applies to them, and it is enforced at the call sites and in the repositories.
 * This is the constraint that applies only to an agent acting as itself.
 */
export type AgentActionScope = {
  /**
   * Whether the caller may name ITSELF as the target.
   *
   * Usually yes — settling with your parent, or setting your own credentials,
   * are ordinary self-actions. It is `false` for the three operations where
   * acting on yourself IS the escalation: raising your own credit limit, and
   * rewriting your own commission or sharing rate.
   */
  allowSelf: boolean
  /** Named in the error, so a refusal says which operation refused. */
  action: string
}

const repo = new AgentsRepo()

export async function ensureAgentMayActOn(
  ctx: any,
  targetAgentId: unknown,
  scope: AgentActionScope
): Promise<void> {
  const callerAgentId = ctx?.user?.type === 'agent' ? ctx?.user?.agentId : null
  if (!callerAgentId) return // an admin; tenant scoping is their boundary

  const target = String(targetAgentId ?? '')
  if (!target) {
    throw new Error(`Forbidden: ${scope.action} requires an agent id`)
  }

  if (target === String(callerAgentId)) {
    if (scope.allowSelf) return
    throw new Error(`Forbidden: an agent cannot ${scope.action} for itself`)
  }

  // The closure includes the ancestor itself, so this is "self or below".
  const descendants = await repo.getDescendantIds(String(callerAgentId))
  if (!descendants.includes(target)) {
    // Reported as not-found rather than forbidden: the response should not
    // confirm that an agent id outside the caller's subtree exists.
    throw new Error('Agent not found')
  }
}

/**
 * The tenant an agent operation must be scoped to.
 *
 * Kept here so the subtree check and the tenant check are read together — a
 * caller that passes one and not the other is the shape this module exists to
 * prevent.
 */
export function agentActionTenant(ctx: any): string {
  return getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
}

/**
 * The tenant a caller-supplied agent id must belong to, for
 * `AgentsRepo.findByIdScoped`. Same resolution the CR-11 call sites use, and it
 * refuses rather than defaulting when the context has no tenant at all.
 */
export function requireCallerTenant(ctx: any): string {
  const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant || ctx?.whitelabel?.id)
  if (!tenant) {
    throw new Error('Tenant ID is required. Please ensure you are authenticated.')
  }
  return String(tenant)
}

/** Refuses agent principals, for operations that belong to the whitelabel's admins. */
export function ensureAdminCaller(ctx: any, action: string): void {
  if (ctx?.user?.type === 'agent') {
    throw new Error(`Forbidden: ${action} is an admin operation`)
  }
}

/**
 * For an agent principal, the target must be one of its DIRECT children, never
 * itself and never deeper. Used where the hierarchy is deliberately one level at
 * a time: settlement posting (a parent settles with its own children).
 * Admins pass; their boundary is the tenant.
 */
export function ensureDirectChildForAgent(
  ctx: any,
  target: { id: string; parentAgentId?: string | null },
  action: string
): void {
  const callerAgentId = ctx?.user?.type === 'agent' ? ctx?.user?.agentId : null
  if (!callerAgentId) return
  if (String(target.id) === String(callerAgentId)) {
    throw new Error(`Forbidden: an agent cannot ${action} for itself`)
  }
  if (String(target.parentAgentId ?? '') !== String(callerAgentId)) {
    throw new Error(`Forbidden: an agent can only ${action} for its direct sub-agents`)
  }
}
