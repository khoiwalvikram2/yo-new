import { describe, expect, test } from 'vitest'
import {
  agentDisplayName,
  canCreateHierarchyAgent,
  creditUsagePercent,
  creditUsageTone,
  filterHierarchyAgents,
  hierarchyDepthLabel,
  hierarchyStatusCount,
  type HierarchyAgentNode,
} from './hierarchyModel'

const agents: HierarchyAgentNode[] = [
  {
    id: 'agent-alpha-123', username: 'Alpha Partner', schemeType: 'CREDIT', status: 'ACTIVE',
    levelIndex: 2, creditLimit: 1000, creditUsed: 650, creditAvailable: 350, parentAgentId: 'root',
  },
  {
    id: 'agent-beta-456', username: null, schemeType: 'SHARING', status: 'SUSPENDED',
    levelIndex: 3, creditLimit: 0, creditUsed: 0, creditAvailable: 0, parentAgentId: 'root',
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

  test('clamps credit usage and maps threshold tones', () => {
    expect(creditUsagePercent(agents[0])).toBe(65)
    expect(creditUsagePercent({ creditLimit: 100, creditUsed: 150 })).toBe(100)
    expect(creditUsagePercent({ creditLimit: 0, creditUsed: 20 })).toBe(0)
    expect(creditUsageTone(60)).toBe('acc')
    expect(creditUsageTone(61)).toBe('warn')
    expect(creditUsageTone(81)).toBe('neg')
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
})
