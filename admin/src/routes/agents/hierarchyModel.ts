export interface HierarchyAgentNode {
  id: string
  username?: string | null
  schemeType: string
  status: string
  levelIndex?: number | null
  creditLimit?: number | null
  creditUsed?: number | null
  creditAvailable?: number | null
  parentAgentId?: string | null
}

export interface HierarchyAgentAccount {
  schemeType?: string | null
  levelIndex?: number | null
}

export type CreditUsageTone = 'acc' | 'warn' | 'neg'

export function canCreateHierarchyAgent(agent?: HierarchyAgentAccount | null): boolean {
  if (!agent || !['SHARING', 'CREDIT'].includes(String(agent.schemeType || '').toUpperCase())) return false
  return agent.levelIndex == null || agent.levelIndex < 4
}

export function agentDisplayName(agent: Pick<HierarchyAgentNode, 'id' | 'username'>): string {
  const username = String(agent.username || '').trim()
  return username || `Agent ${agent.id.slice(0, 8)}`
}

export function creditUsagePercent(agent: Pick<HierarchyAgentNode, 'creditLimit' | 'creditUsed'>): number {
  const limit = Number(agent.creditLimit || 0)
  const used = Number(agent.creditUsed || 0)
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return 0
  return Math.max(0, Math.min(100, (used / limit) * 100))
}

export function creditUsageTone(percent: number): CreditUsageTone {
  if (percent > 80) return 'neg'
  if (percent > 60) return 'warn'
  return 'acc'
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

export function hierarchyDepthLabel(levelIndex?: number | null): string {
  return levelIndex == null ? 'Level not assigned' : `Level ${levelIndex}`
}
