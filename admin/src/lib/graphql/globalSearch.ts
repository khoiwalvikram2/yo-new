import { gql } from '@apollo/client'

/** Single unified search result from backend globalSearch */
export interface SearchResultItem {
  id: string
  type: string
  label: string
  subtitle: string | null
  route: string
  status: string | null
  metadata: Record<string, unknown> | null
  parentChain: ParentChainItem[] | null
}

export interface ParentChainItem {
  id: string
  username: string
  levelIndex: number | null
  route: string
}

export const GLOBAL_SEARCH_QUERY = gql`
  query GlobalSearch($query: String!, $limit: Int, $categories: [String!]) {
    globalSearch(query: $query, limit: $limit, categories: $categories) {
      players {
        id
        type
        label
        subtitle
        route
        status
        metadata
        parentChain {
          id
          username
          levelIndex
          route
        }
      }
      agents {
        id
        type
        label
        subtitle
        route
        status
        metadata
        parentChain {
          id
          username
          levelIndex
          route
        }
      }
      whitelabels {
        id
        type
        label
        subtitle
        route
        status
        metadata
      }
      casinoGames {
        id
        type
        label
        subtitle
        route
        status
        metadata
      }
      sports {
        id
        type
        label
        subtitle
        route
        status
        metadata
      }
      vipMembers {
        id
        type
        label
        subtitle
        route
        status
        metadata
      }
      matkas {
        id
        type
        label
        subtitle
        route
        status
        metadata
      }
      referralCodes {
        id
        type
        label
        subtitle
        route
        status
        metadata
      }
      bets {
        id
        type
        label
        subtitle
        route
        status
        metadata
      }
      bonuses {
        id
        type
        label
        subtitle
        route
        status
        metadata
      }
    }
  }
`

export interface GlobalSearchResult {
  globalSearch: {
    players: SearchResultItem[]
    agents: SearchResultItem[]
    whitelabels: SearchResultItem[]
    casinoGames: SearchResultItem[]
    sports: SearchResultItem[]
    vipMembers: SearchResultItem[]
    matkas: SearchResultItem[]
    referralCodes: SearchResultItem[]
    bets: SearchResultItem[]
    bonuses: SearchResultItem[]
  }
}

export type { GlobalSearchResult as GlobalSearchResultType }
