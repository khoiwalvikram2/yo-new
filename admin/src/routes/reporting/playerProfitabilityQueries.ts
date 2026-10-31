import { gql } from '@apollo/client'

/* The seven documents of /reporting/players/profitability, moved byte for byte out of
   PlayerProfitabilityPage.tsx (page migration C, W3 Task 124) so the page test can mount them against
   MockedProvider. The page's useQuery calls, variables and policies are unchanged. */

export const SPORTS_PLAYER_BREAKDOWN_QUERY = gql`
  query SportsPlayerBreakdownProfitability($filter: SportsDrillDownFilter!) {
    sportsPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      playerPhone
      directAgentId
      directAgentName
      agentChain
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      avgStake
      winRate
    }
  }
`;

export const CASINO_PLAYER_BREAKDOWN_QUERY = gql`
  query CasinoPlayerBreakdownProfitability($filter: CasinoDrillDownFilter!) {
    casinoPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      playerPhone
      directAgentId
      directAgentName
      agentChain
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      avgStake
      winRate
    }
  }
`;

export const MATKA_PLAYER_BREAKDOWN_QUERY = gql`
  query MatkaPlayerBreakdownProfitability($filter: MatkaDrillDownFilter!) {
    matkaPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      playerPhone
      directAgentId
      directAgentName
      agentChain
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      avgStake
      winRate
    }
  }
`;

export const SPORTS_KPIS_QUERY = gql`
  query SportsKPIsProfitability($filter: SportsReportingFilter) {
    sportsKPIs(filter: $filter) {
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
    }
  }
`;

export const CASINO_KPIS_QUERY = gql`
  query CasinoKPIsProfitability($filter: CasinoReportingFilter) {
    casinoKPIs(filter: $filter) {
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
    }
  }
`;

export const MATKA_KPIS_QUERY = gql`
  query MatkaKPIsProfitability($filter: MatkaReportingFilter) {
    matkaKPIs(filter: $filter) {
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
    }
  }
`;

export const ACTIVE_PLAYERS_QUERY = gql`
  query ActivePlayersProfitability($dateRange: DashboardDateRange) {
    overviewKPIs(dateRange: $dateRange) {
      activePlayers
    }
  }
`;
