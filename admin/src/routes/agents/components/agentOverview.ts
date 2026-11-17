import { useQuery, gql } from '@apollo/client'

/** Every agent's scheme, status and level: the stats cards' counts and the scheme tab counts. CREDIT money
 *  comes from the agents' chips (agentChips.ts), no longer from the retired credit-limit columns. */
export const AGENT_OVERVIEW_QUERY = gql`
  query AgentOverviewStats {
    agents {
      agentsPage(limit: 1000, includeStats: false) {
        total
        items {
          id
          schemeType
          status
          levelIndex
          parentAgentId
        }
      }
    }
  }
`;

export type AgentOverviewItem = {
  id: string;
  schemeType?: string | null;
  status?: string | null;
  levelIndex?: number | null;
  parentAgentId?: string | null;
};

/** Agents per scheme for the scheme tabs. Same query and policy as the cards, so it shares their one request. */
export function useAgentSchemeCounts(skip = false): Record<string, number> | null {
  const { data } = useQuery(AGENT_OVERVIEW_QUERY, {
    fetchPolicy: "cache-and-network",
    nextFetchPolicy: "cache-first",
    skip,
  });
  const items: AgentOverviewItem[] = data?.agents?.agentsPage?.items ?? [];
  if (!data) return null;
  const counts: Record<string, number> = {};
  for (const item of items) if (item.schemeType) counts[item.schemeType] = (counts[item.schemeType] ?? 0) + 1;
  return counts;
}
