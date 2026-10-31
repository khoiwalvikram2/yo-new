/**
 * Rules for the admin `createPlayer` mutation (users domain) that need no
 * database of their own, kept apart from the resolver so they can be tested
 * without one. The agent lookup takes its repo as an argument for the same
 * reason.
 */

export type CreatePlayerType =
  | 'REGULAR'
  | 'AGENT_CREDIT'
  | 'WHITELABEL_CREDIT'
  | 'SHARING_AGENT_PLAYER'
  | 'COMMISSION_AGENT_PLAYER'

/** The scheme an agent must be on to own a player of each agent-player type. */
export const SCHEME_FOR_AGENT_PLAYER_TYPE: Partial<Record<CreatePlayerType, 'CREDIT' | 'SHARING' | 'COMMISSION'>> = {
  AGENT_CREDIT: 'CREDIT',
  SHARING_AGENT_PLAYER: 'SHARING',
  COMMISSION_AGENT_PLAYER: 'COMMISSION',
}

/**
 * A credit player's starting limit. Missing means 0, and 0 is valid for both
 * credit types: the line can be raised later through the credit tools.
 *
 * AGENT_CREDIT used to demand a limit above 0 on this path while the agent's
 * own path (createPlayerForAgent) accepted 0. The admin create form sends 0 by
 * default, so an admin could never create an AGENT_CREDIT player at all.
 */
export function normalizeCreditLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) throw new Error('Credit limit must be a number')
  if (n < 0) throw new Error('Credit limit cannot be negative')
  return n
}

export interface OwningAgentRow {
  id: string
  tenantId: string | null
  schemeType: string
  status: string
  allowedDomains?: string[] | null
}

export interface OwningAgentLookup {
  findByIdScoped(id: string, tenantId: string): Promise<OwningAgentRow | null>
}

/**
 * The agent a new player is created under, as named by the admin.
 *
 * Scoped to the caller's tenant: the unscoped `findById` this replaces accepted
 * an agent id from another whitelabel, which then owned (and, for
 * AGENT_CREDIT, funded) a player in this one. The agent must also be ACTIVE —
 * a suspended or blocked agent's players cannot bet (owner decision 1), so
 * giving it new ones only creates dead accounts.
 */
export async function resolveOwningAgentForCreate(
  repo: OwningAgentLookup,
  agentId: string,
  tenant: string,
  playerType: CreatePlayerType,
): Promise<OwningAgentRow> {
  const expected = SCHEME_FOR_AGENT_PLAYER_TYPE[playerType]
  if (!expected) throw new Error(`${playerType} players are not owned by an agent`)
  const agent = await repo.findByIdScoped(agentId, tenant)
  if (!agent) throw new Error('Agent not found')
  if (agent.schemeType !== expected) {
    throw new Error(`${playerType} players can only be created under ${expected} agents`)
  }
  if (agent.status !== 'ACTIVE') {
    throw new Error(`Agent is not active. Status: ${agent.status}`)
  }
  return agent
}

/**
 * The admin create path is for admins. An agent holds `players.create` through
 * its flat `users:write`, but creates players through `createPlayerForAgent`,
 * which derives the type from the agent's scheme and checks the subtree; here it
 * could name any agent and any type, WHITELABEL_CREDIT included.
 */
export function refuseAgentCallerForAdminCreate(ctx: any): void {
  if (ctx?.user?.type === 'agent') {
    throw new Error('Forbidden: agents create players through createPlayerForAgent')
  }
}
