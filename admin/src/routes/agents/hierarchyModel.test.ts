import { describe, expect, test } from 'vitest'
import {
  agentDisplayName,
  canCreateHierarchyAgent,
  filterHierarchyAgents,
  hierarchyDepthLabel,
  hierarchySchemeFigure,
  hierarchyStatusCount,
  type HierarchyAgentNode,
} from './hierarchyModel'

const agents: HierarchyAgentNode[] = [
  {
    id: 'agent-alpha-123', username: 'Alpha Partner', schemeType: 'CREDIT', status: 'ACTIVE',
    levelIndex: 2, parentAgentId: 'root', chips: null,
  },
  {
    id: 'agent-beta-456', username: null, schemeType: 'SHARING', status: 'SUSPENDED',
    levelIndex: 3, parentAgentId: 'root', chips: null,
  },
]

describe('hierarchyModel', () => {
  test('allows sub-agent creation only for supported schemes below level four', () => {
    expect(canCreateHierarchyAgent({ schemeType: 'CREDIT', levelIndex: 3 })).toBe(true)
    expect(canCreateHierarchyAgent({ schemeType: 'SHARING', levelIndex: null })).toBe(true)
    expect(canCreateHierarchyAgent({ schemeType: 'CREDIT', levelIndex: 4 })).toBe(false)
    expect(canCreateHierarchyAgent({ schemeType: 'COMMISSION', levelIndex: 1 })).toBe(false)
    expect(canCreateHierarchyAgent(null)).toBe(false)
  })

  test('uses the username and a stable short-id fallback', () => {
    expect(agentDisplayName(agents[0])).toBe('Alpha Partner')
    expect(agentDisplayName(agents[1])).toBe('Agent agent-be')
  })

  test('searches all visible identity and state fields case-insensitively', () => {
    expect(filterHierarchyAgents(agents, ' alpha ')).toEqual([agents[0]])
    expect(filterHierarchyAgents(agents, 'SUSPENDED')).toEqual([agents[1]])
    expect(filterHierarchyAgents(agents, 'level 2')).toEqual([agents[0]])
    expect(filterHierarchyAgents(agents, 'beta-456')).toEqual([agents[1]])
    expect(filterHierarchyAgents(agents, '')).toEqual(agents)
  })

  test('counts normalized statuses and formats missing levels truthfully', () => {
    expect(hierarchyStatusCount(agents, 'active')).toBe(1)
    expect(hierarchyStatusCount(agents, ' blocked ')).toBe(0)
    expect(hierarchyDepthLabel(3)).toBe('Level 3')
    expect(hierarchyDepthLabel(null)).toBe('Level not assigned')
  })

  test("the scheme figure counts the signed-in agent's scheme and names any other scheme as itself (AGE-17)", () => {
    // Every non-CREDIT sub-agent used to be called a "sharing account", COMMISSION ones included.
    const commission: HierarchyAgentNode[] = [{ id: 'c1', schemeType: 'COMMISSION', status: 'ACTIVE' }]
    expect(hierarchySchemeFigure(commission, 'COMMISSION')).toEqual({ label: 'Commission accounts', value: 1, note: 'All on your scheme' })
    expect(hierarchySchemeFigure(agents, 'credit')).toEqual({ label: 'Credit accounts', value: 1, note: '1 sharing account' })
    expect(hierarchySchemeFigure([...agents, ...commission, ...commission], 'SHARING')).toEqual({ label: 'Sharing accounts', value: 1, note: '1 credit account · 2 commission accounts' })
    expect(hierarchySchemeFigure([], 'SHARING')).toEqual({ label: 'Sharing accounts', value: 0, note: 'None yet' })
  })
})
