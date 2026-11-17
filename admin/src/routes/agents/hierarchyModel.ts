import type { ChipAccount } from '@/modules/chips'

export interface HierarchyAgentNode {
  id: string
  username?: string | null
  schemeType: string
  status: string
  levelIndex?: number | null
  parentAgentId?: string | null
  /** A CREDIT agent's chips (spec 2026-11-02 §7 AgentAccount.chips); null for the other schemes. */
  chips?: ChipAccount | null
}

export interface HierarchyAgentAccount {
  schemeType?: string | null
  levelIndex?: number | null
}

export function canCreateHierarchyAgent(agent?: HierarchyAgentAccount | null): boolean {
  if (!agent || !['SHARING', 'CREDIT'].includes(String(agent.schemeType || '').toUpperCase())) return false
  return agent.levelIndex == null || agent.levelIndex < 4
}

export function agentDisplayName(agent: Pick<HierarchyAgentNode, 'id' | 'username'>): string {
  const username = String(agent.username || '').trim()
  return username || `Agent ${agent.id.slice(0, 8)}`
}

export function filterHierarchyAgents(
  agents: readonly HierarchyAgentNode[],
  query: string,
): HierarchyAgentNode[] {
  const needle = query.trim().toLocaleLowerCase('en-US')
  if (!needle) return [...agents]

  return agents.filter((agent) => [
    agent.id,
    agent.username,
    agent.schemeType,
    agent.status,
    agent.levelIndex == null ? '' : `level ${agent.levelIndex}`,
  ].some((value) => String(value || '').toLocaleLowerCase('en-US').includes(needle)))
}

export function hierarchyStatusCount(agents: readonly HierarchyAgentNode[], status: string): number {
  const expected = status.trim().toUpperCase()
  return agents.filter((agent) => String(agent.status || '').toUpperCase() === expected).length
}

const SCHEME_NAMES: Record<string, string> = { COMMISSION: 'commission', SHARING: 'sharing', CREDIT: 'credit' }

/**
 * The summary's scheme figure: the sub-agents on the signed-in agent's scheme, and any others by their own scheme.
 * A sub-agent always has its parent's scheme, so there are normally none. It used to count credit accounts and
 * call every other sub-agent a "sharing account", which named a COMMISSION tree wrongly.
 */
export function hierarchySchemeFigure(
  agents: readonly HierarchyAgentNode[],
  scheme?: string | null,
): { label: string; value: number; note: string } {
  const own = String(scheme || '').toUpperCase()
  const name = (value: string) => SCHEME_NAMES[value] ?? (value.toLowerCase() || 'unknown')
  const counts = new Map<string, number>()
  for (const agent of agents) {
    const key = String(agent.schemeType || '').toUpperCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const others = [...counts]
    .filter(([key]) => key !== own)
    .map(([key, count]) => `${count} ${name(key)} account${count === 1 ? '' : 's'}`)
  const ownName = name(own)
  return {
    label: `${ownName.charAt(0).toUpperCase()}${ownName.slice(1)} accounts`,
    value: counts.get(own) ?? 0,
    note: others.length ? others.join(' · ') : agents.length ? 'All on your scheme' : 'None yet',
  }
}

export function hierarchyDepthLabel(levelIndex?: number | null): string {
  return levelIndex == null ? 'Level not assigned' : `Level ${levelIndex}`
}
