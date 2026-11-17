import { db } from '@src/db/client.js'
import { agentCredentials, users } from '@src/db/schema.js'
import { eq } from 'drizzle-orm'
import { getRoleNamesByUserIds } from '@src/repos/rbac/rbacRepo.js'

export type AuditActorType = 'admin' | 'player' | 'agent' | 'system' | 'deleted' | 'unknown'

export interface AuditActor {
  id: string
  name: string
  email: string | null
  type: AuditActorType
  role: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Who an audit row's actor_id names, for the trail's Actor column and its "View Profile" link.
 *
 * The previous reading (getAuditActorInfo in the users repo) called every actor it could not place an agent:
 * a deleted support admin showed as "User 2047" of type AGENT with a link to /agents/2047, and so did the
 * Super Admin in a whitelabel's trail (its role lives in the platform tenant, not the trail's) and every player.
 *
 * - `system` and `system:*` are the system; any other label written in place of an id ('unknown', 'admin') is
 *   unknown.
 * - A UUID is an agent (agents.id); its sign-in name when it still has one.
 * - A number is a users row. Gone: 'deleted' (support admins are hard-deleted; the trail keeps their id).
 *   Holding a role in its own tenant, or in the platform tenant (the Super Admin): 'admin'. Otherwise a player.
 */
export async function resolveAuditActor(actorId: string): Promise<AuditActor> {
  const id = String(actorId ?? '')
  if (UUID.test(id)) {
    const [credentials] = await db
      .select({ username: agentCredentials.username })
      .from(agentCredentials)
      .where(eq(agentCredentials.agentId, id))
      .limit(1)
    return { id, name: credentials?.username || `Agent ${id.slice(0, 8)}`, email: null, type: 'agent', role: null }
  }
  if (id === 'system' || id.startsWith('system:')) return { id, name: 'System', email: null, type: 'system', role: null }
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return { id, name: id || 'Unknown', email: null, type: 'unknown', role: null }
  }

  const userId = Number(id)
  const [user] = await db
    .select({ name: users.name, username: users.username, email: users.email, tenant: users.tenant })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) return { id, name: `Deleted user ${id}`, email: null, type: 'deleted', role: null }

  const ownTenant = user.tenant || 'default'
  let roles = (await getRoleNamesByUserIds([userId], ownTenant)).get(userId) ?? []
  if (roles.length === 0 && ownTenant !== 'default') roles = (await getRoleNamesByUserIds([userId], 'default')).get(userId) ?? []
  return {
    id,
    name: user.name || user.username || `User ${id}`,
    email: user.email ?? null,
    type: roles.length > 0 ? 'admin' : 'player',
    role: roles[0] ?? null,
  }
}

const perRequest = new WeakMap<object, Map<string, Promise<AuditActor>>>()

/** resolveAuditActor once per actor per request: a page of 100 events names a handful of actors. */
export function resolveAuditActorForRequest(actorId: string, requestScope: object | undefined): Promise<AuditActor> {
  if (!requestScope) return resolveAuditActor(actorId)
  let memo = perRequest.get(requestScope)
  if (!memo) perRequest.set(requestScope, (memo = new Map()))
  let actor = memo.get(actorId)
  if (!actor) {
    actor = resolveAuditActor(actorId).catch((err) => {
      console.warn('[audit] actor lookup failed', { actorId, err: err instanceof Error ? err.message : String(err) })
      return { id: actorId, name: `User ${actorId}`, email: null, type: 'unknown', role: null } satisfies AuditActor
    })
    memo.set(actorId, actor)
  }
  return actor
}
