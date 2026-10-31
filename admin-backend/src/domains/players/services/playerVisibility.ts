import { PlayerAuthService } from '@src/domains/players/services/PlayerAuthService.js'

/**
 * Which players may this caller see?
 *
 * An agent sees the players of its own subtree, resolved two ways — a player
 * assigned directly to an agent in the subtree, and a player referred by one of
 * those players. `PlayerAuthService.getAgentPlayerIds` covers both, and the
 * `players/` domain's read resolvers use it consistently.
 *
 * The `users/` domain did not. `Query.user`, `wallet`, `playerLimits`,
 * `usersByIds`, `playersStatsByIds` and
 * `playerActivityDepositWithdrawalStats` each check a permission and scope by
 * tenant, and then hand back whichever player the caller names — so an agent
 * read any player of the whitelabel rather than its own.
 *
 * An admin is unconstrained: tenant scoping is their boundary.
 */
const auth = new PlayerAuthService()

/** The agent id this caller acts as, or null for an admin. */
function callerAgentId(ctx: any): string | null {
  return ctx?.user?.type === 'agent' && ctx?.user?.agentId ? String(ctx.user.agentId) : null
}

/**
 * Whether the caller may see one player.
 *
 * Returns true for an admin without touching the database.
 */
export async function maySeePlayer(
  ctx: any,
  playerId: number | string | null | undefined,
  tenant: string
): Promise<boolean> {
  const agentId = callerAgentId(ctx)
  if (!agentId) return true
  const id = Number(playerId)
  if (!Number.isFinite(id)) return false
  return auth.canAgentAccessPlayer(agentId, id, tenant)
}

/**
 * Narrows a list of player ids to those the caller may see.
 *
 * Filtering rather than refusing is deliberate for the plural reads: a mixed
 * request should return the visible rows, the way a list query does, not fail
 * whole because one id was out of reach.
 */
export async function visiblePlayerIds(
  ctx: any,
  ids: Array<number | string>,
  tenant: string
): Promise<number[]> {
  const numeric = ids.map((x) => Number(x)).filter((x) => Number.isFinite(x))
  const agentId = callerAgentId(ctx)
  if (!agentId) return numeric
  const allowed = new Set(await auth.getAgentPlayerIds(agentId, tenant))
  return numeric.filter((id) => allowed.has(id))
}
