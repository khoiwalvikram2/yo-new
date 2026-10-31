import { gql } from '@apollo/client'

/* The GraphQL documents of the drill-down report pieces, moved here byte for byte (page migration
   Task 121) so the legacy antd components and their kit replacements under ./ui share one copy:

   - the agent and bonus-campaign option lists of ReportFiltersBar
     (components/ReportFiltersBar.tsx and ui/ReportFiltersBar.tsx);
   - the bet lists of the contributors panel
     (routes/reporting/components/ReportDetailSidebar.tsx and ui/ReportDetailDrawer.tsx).

   This module imports nothing but Apollo, so a kit page can reach the documents without pulling
   antd into its import closure. */

export const AGENTS_SEARCH_QUERY = gql`
  query AgentsSearch($query: String, $offset: Int, $limit: Int) {
    agents {
      agentsPage(query: $query, offset: $offset, limit: $limit) {
        items {
          id
          username
          phone
        }
        total
      }
    }
  }
`

export const BONUS_CAMPAIGNS_QUERY = gql`
  query BonusCampaigns($status: BonusStatus, $domain: BonusDomain, $search: String) {
    bonusCampaigns(status: $status, domain: $domain, search: $search) {
      id
      name
      status
    }
  }
`

// Sports bets for a player or agent's players
export const SPORTS_BETS_FOR_SIDEBAR = gql`
  query SportsBetsForSidebar($query: SportsBetsQuery) {
    sportsBets(query: $query) {
      id
      userId
      userName
      sportName
      leagueName
      eventName
      selectionId
      side
      price
      stake
      liability
      status
      result
      oddsSize
      settledAt
      createdAt
    }
  }
`

// Casino bets for a player (contributors detail)
export const CASINO_BETS_FOR_SIDEBAR = gql`
  query CasinoBetsForSidebar($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      id
      userId
      gameId
      gameName
      vendorId
      vendorName
      stake
      payout
      winAmount
      status
      currency
      createdAt
    }
  }
`
