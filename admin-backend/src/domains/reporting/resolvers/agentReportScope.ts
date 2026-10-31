import { and, eq } from 'drizzle-orm'
import { hasPermission } from '@src/domains/common/auth.js'

/**
 * Which agent's direct sub-agents the Agent Performance report lists.
 *
 * The resolver passed the client's `filter.parentAgentId` straight to the repo.
 * For an agent caller that meant two leaks:
 *   - naming any other agent's id listed THAT agent's sub-agents with their
 *     turnover, GGR and commission, whether or not it was in the caller's tree;
 *   - leaving it out fell into the repo's whitelabel branch, which lists every
 *     root agent of the whitelabel with its whole downline's figures.
 *
 * An agent caller now always gets an agent view: its own id when nothing (or
 * itself) is named, the named agent only when it is a descendant of the caller
 * (agent_hierarchy_closure), and otherwise the request is ignored in favour of
 * the caller's own id — the caller receives exactly what it is entitled to.
 *
 * An admin caller keeps choosing freely within its own tenant; a named agent of
 * another tenant is ignored (the whitelabel view is returned instead).
 */
export interface AgentReportScopeDeps {
  /** True when `descendantId` is `ancestorId` or below it in the hierarchy. */
  isInSubtree(ancestorId: string, descendantId: string): Promise<boolean>
  /** The tenant an agent belongs to, or null when the agent does not exist. */
  agentTenant(agentId: string): Promise<string | null>
}

async function defaultIsInSubtree(ancestorId: string, descendantId: string): Promise<boolean> {
  const { db } = await import('@/db/client.js')
  const { agentHierarchyClosure } = await import('@shared/db/schema.js')
  const rows = await db
    .select({ d: agentHierarchyClosure.descendantId })
    .from(agentHierarchyClosure)
    .where(and(eq(agentHierarchyClosure.ancestorId, ancestorId), eq(agentHierarchyClosure.descendantId, descendantId)))
    .limit(1)
  return rows.length > 0
}

async function defaultAgentTenant(agentId: string): Promise<string | null> {
  const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
  const agent = await new AgentsRepo().findById(agentId)
  const tenant = (agent as { tenantId?: string | null } | null)?.tenantId
  return tenant ? String(tenant).trim() : null
}

const defaultDeps: AgentReportScopeDeps = {
  isInSubtree: defaultIsInSubtree,
  agentTenant: defaultAgentTenant,
}

export async function resolveAgentPerformanceParent(
  ctx: any,
  requestedParentAgentId: unknown,
  tenant: string | undefined,
  deps: AgentReportScopeDeps = defaultDeps,
): Promise<string | undefined> {
  const requested =
    typeof requestedParentAgentId === 'string' && requestedParentAgentId.trim() ? requestedParentAgentId.trim() : undefined

  if (ctx?.user?.type === 'agent') {
    const callerAgentId = ctx?.user?.agentId ? String(ctx.user.agentId) : ''
    // An agent session that names no agent cannot be scoped; fail closed.
    if (!callerAgentId) throw new Error('Forbidden: agent session has no agent id')
    if (!requested || requested === callerAgentId) return callerAgentId
    return (await deps.isInSubtree(callerAgentId, requested)) ? requested : callerAgentId
  }

  if (!requested) return undefined
  // A platform administrator may name any agent (director views span whitelabels).
  if (!tenant || hasPermission(ctx?.permissions ?? [], 'all', '*')) return requested
  const owner = await deps.agentTenant(requested)
  return owner === tenant ? requested : undefined
}
