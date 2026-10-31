import { useEffect, useState } from 'react'
import { gql, useApolloClient, type ApolloClient } from '@apollo/client'

/**
 * Every agent below a root agent, read level by level through agentsPage(parentAgentId), which an
 * agent may call for itself and for any agent beneath it. The API has no "whole subtree" listing,
 * so this walks the tree: one request per agent that may have children, a few at a time.
 */
export const AGENT_CHILDREN_QUERY = gql`
  query AgentSubtreeChildren($parentAgentId: ID!) {
    agents {
      agentsPage(parentAgentId: $parentAgentId, limit: 1000, offset: 0, includeStats: false) {
        items {
          id
          username
          schemeType
          levelIndex
          status
          parentAgentId
        }
      }
    }
  }
`

export interface SubtreeAgent {
  id: string
  username: string | null
  schemeType: string
  levelIndex: number | null
  status: string
  parentAgentId: string | null
  /** 1 for a direct child of the root, 2 for a grandchild, … */
  depth: number
  /** ACTIVE itself and under an all-ACTIVE chain up to the root: a suspended agent blocks its whole subtree. */
  effectivelyActive: boolean
}

interface ChildrenData {
  agents?: { agentsPage?: { items?: Array<Omit<SubtreeAgent, 'depth' | 'effectivelyActive'>> | null } | null } | null
}

const CONCURRENCY = 4
const isActive = (status?: string | null) => (status || '').toUpperCase() === 'ACTIVE'

/** Breadth-first walk from rootId. Depth-ordered; within a level, in the API's order. Cycles are ignored. */
export async function loadAgentSubtree(client: ApolloClient<unknown>, rootId: string, maxDepth = 12): Promise<SubtreeAgent[]> {
  const found: SubtreeAgent[] = []
  const seen = new Set([rootId])
  let frontier: Array<{ id: string; active: boolean }> = [{ id: rootId, active: true }]
  for (let depth = 1; frontier.length && depth <= maxDepth; depth += 1) {
    const next: Array<{ id: string; active: boolean }> = []
    for (let start = 0; start < frontier.length; start += CONCURRENCY) {
      const batch = frontier.slice(start, start + CONCURRENCY)
      const results = await Promise.all(batch.map((node) => client.query<ChildrenData>({
        query: AGENT_CHILDREN_QUERY, variables: { parentAgentId: node.id }, fetchPolicy: 'network-only',
      })))
      results.forEach((result, index) => {
        const parentActive = batch[index].active
        for (const item of result.data?.agents?.agentsPage?.items ?? []) {
          if (!item?.id || seen.has(item.id)) continue
          seen.add(item.id)
          const effectivelyActive = parentActive && isActive(item.status)
          found.push({ ...item, depth, effectivelyActive })
          next.push({ id: item.id, active: effectivelyActive })
        }
      })
    }
    frontier = next
  }
  return found
}

/** The agents below rootId (not rootId itself). Empty while skipped. */
export function useAgentSubtree(rootId: string | null | undefined, options: { skip?: boolean } = {}) {
  const client = useApolloClient()
  const skip = Boolean(options.skip) || !rootId
  const [state, setState] = useState<{ agents: SubtreeAgent[]; loading: boolean; error: Error | null }>({ agents: [], loading: !skip, error: null })
  useEffect(() => {
    if (skip || !rootId) { setState({ agents: [], loading: false, error: null }); return }
    let cancelled = false
    setState((previous) => ({ ...previous, loading: true, error: null }))
    loadAgentSubtree(client, rootId).then(
      (agents) => { if (!cancelled) setState({ agents, loading: false, error: null }) },
      (error: unknown) => { if (!cancelled) setState({ agents: [], loading: false, error: error instanceof Error ? error : new Error(String(error)) }) },
    )
    return () => { cancelled = true }
  }, [client, rootId, skip])
  return state
}
