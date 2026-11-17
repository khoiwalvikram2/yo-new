import { gql } from '@apollo/client'
import type { ChipAccount } from '@/modules/chips'
import { topLevelAgents } from './agentsSearchModel'

/* The chips of the CREDIT agents on the agents list, tree and stats cards (spec 2026-11-02 §7
   AgentAccount.chips, resolved in batch by the server). They are read apart from the list itself, only for
   the CREDIT scheme and outside the Apollo cache like every chips read (modules/chips/chipHooks), so a
   failed or slow chips read never holds up the list, and the list's own agents query is left as it is. */

/** The chips of one page of agentsPage: the same filters and page as the list query it sits beside. */
export const AGENTS_CHIPS_QUERY = gql`
  query AgentsChips(
    $query: String
    $schemeType: AgentScheme
    $status: String
    $parentAgentId: ID
    $directOnly: Boolean
    $offset: Int
    $limit: Int
  ) {
    agents {
      agentsPage(
        query: $query
        schemeType: $schemeType
        status: $status
        parentAgentId: $parentAgentId
        directOnly: $directOnly
        offset: $offset
        limit: $limit
        includeStats: false
      ) {
        items {
          id
          chips {
            accountType
            id
            username
            name
            status
            parentAgentId
            playerType
            currency
            creditReference
            balance
            exposure
            available
            downlineBalance
            refPnl
            downlineCount
          }
        }
      }
    }
  }
`

/** Every CREDIT agent in the caller's view with its chips, for the stats cards' network totals. */
export const AGENT_CHIP_TOTALS_QUERY = gql`
  query AgentChipTotals {
    agents {
      agentsPage(schemeType: CREDIT, limit: 1000, includeStats: false) {
        items {
          id
          parentAgentId
          chips {
            id
            currency
            creditReference
            balance
            exposure
            downlineBalance
            refPnl
          }
        }
      }
    }
  }
`

export interface AgentChipsItem {
  id: string
  parentAgentId?: string | null
  chips?: ChipAccount | null
}

export interface AgentsChipsData {
  agents?: { agentsPage?: { items?: AgentChipsItem[] | null } | null } | null
}

export type AgentChipTotalsItem = {
  id: string
  parentAgentId?: string | null
  chips?: Pick<ChipAccount, 'id' | 'currency' | 'creditReference' | 'balance' | 'exposure' | 'downlineBalance' | 'refPnl'> | null
}

export interface AgentChipTotalsData {
  agents?: { agentsPage?: { items?: AgentChipTotalsItem[] | null } | null } | null
}

/** id → chips, for merging a chips read into the rows of the list it sits beside. */
export function chipsById(items: readonly AgentChipsItem[] | null | undefined): Map<string, ChipAccount> {
  const map = new Map<string, ChipAccount>()
  for (const item of items ?? []) if (item?.id && item.chips) map.set(item.id, item.chips)
  return map
}

export interface ChipNetworkTotals {
  /** Chips held across the network: each top-level agent's own balance plus its downline's. */
  chips: number
  exposure: number
  creditReference: number
  refPnl: number
  currency: string | null
}

/**
 * A CREDIT network's totals. An agent's downline balance, exposure and Ref P/L already cover everything
 * beneath it, so only the top-level agents are added up (memory gw-agent-hierarchy-model: network totals sum
 * top-level agents only); adding the sub-agents too would count their chips twice.
 */
export function chipNetworkTotals(rows: readonly AgentChipTotalsItem[]): ChipNetworkTotals {
  const roots = topLevelAgents(rows).filter((row) => row.chips)
  const sum = (value: (chips: NonNullable<AgentChipTotalsItem['chips']>) => number) =>
    roots.reduce((total, row) => total + Number(row.chips ? value(row.chips) : 0), 0)
  return {
    chips: sum((chips) => chips.balance + chips.downlineBalance),
    exposure: sum((chips) => chips.exposure),
    creditReference: sum((chips) => chips.creditReference),
    refPnl: sum((chips) => chips.refPnl),
    currency: roots[0]?.chips?.currency ?? null,
  }
}
