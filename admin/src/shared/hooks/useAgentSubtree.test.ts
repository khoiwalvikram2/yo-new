import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import type { ApolloClient } from '@apollo/client'
import { loadAgentSubtree } from './useAgentSubtree'

type Row = { id: string; username: string; schemeType: string; levelIndex: number; status: string }
function fakeClient(tree: Record<string, Row[]>, asked: string[] = []) {
  return {
    query: async ({ variables }: { variables: { parentAgentId: string } }) => {
      asked.push(variables.parentAgentId)
      const items = (tree[variables.parentAgentId] ?? []).map((row) => ({ ...row, parentAgentId: variables.parentAgentId }))
      return { data: { agents: { agentsPage: { items } } } }
    },
  } as unknown as ApolloClient<unknown>
}

describe('loadAgentSubtree', () => {
  test('walks every level below the root, depth-ordered, without the root itself', async () => {
    const asked: string[] = []
    const agents = await loadAgentSubtree(fakeClient({
      root: [{ id: 'a', username: 'A', schemeType: 'SHARING', levelIndex: 2, status: 'ACTIVE' }, { id: 'b', username: 'B', schemeType: 'SHARING', levelIndex: 2, status: 'ACTIVE' }],
      a: [{ id: 'a1', username: 'A1', schemeType: 'SHARING', levelIndex: 3, status: 'ACTIVE' }],
      a1: [{ id: 'a11', username: 'A11', schemeType: 'SHARING', levelIndex: 4, status: 'ACTIVE' }],
    }, asked), 'root')
    assert.deepEqual(agents.map((agent) => [agent.id, agent.depth]), [['a', 1], ['b', 1], ['a1', 2], ['a11', 3]])
    assert.deepEqual(asked, ['root', 'a', 'b', 'a1', 'a11'])
  })

  test('a suspended agent blocks its whole subtree (effectivelyActive), and the walk survives a cycle', async () => {
    const agents = await loadAgentSubtree(fakeClient({
      root: [{ id: 'off', username: 'Off', schemeType: 'CREDIT', levelIndex: 2, status: 'SUSPENDED' }, { id: 'on', username: 'On', schemeType: 'CREDIT', levelIndex: 2, status: 'active' }],
      off: [{ id: 'under-off', username: 'Under', schemeType: 'CREDIT', levelIndex: 3, status: 'ACTIVE' }],
      on: [{ id: 'root', username: 'Loop', schemeType: 'CREDIT', levelIndex: 3, status: 'ACTIVE' }],
    }), 'root')
    assert.deepEqual(agents.map((agent) => [agent.id, agent.effectivelyActive]), [['off', false], ['on', true], ['under-off', false]])
  })
})
