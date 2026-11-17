import { gql } from '@apollo/client'

/* The GraphQL documents of /reporting/players/activity, moved byte for byte out of
   PlayerActivityReportPage.tsx (page migration C, W3 Task 123) so the page test can hand the same
   documents to MockedProvider. Gate 10 compares them with the page's pre-image. */

export const SPORTS_PLAYER_BREAKDOWN_QUERY = gql`
  query SportsPlayerBreakdown($filter: SportsDrillDownFilter!) {
    sportsPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      playerPhone
      directAgentId
      directAgentName
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
  query CasinoPlayerBreakdown($filter: CasinoDrillDownFilter!) {
    casinoPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      playerPhone
      directAgentId
      directAgentName
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
  query MatkaPlayerBreakdown($filter: MatkaDrillDownFilter!) {
    matkaPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      playerPhone
      directAgentId
      directAgentName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      avgStake
      winRate
    }
  }
`;

export const USERS_BY_IDS_QUERY = gql`
  query UsersByIds($ids: [ID!]!) {
    usersByIds(ids: $ids) {
      id
      name
      username
      email
      phone
      status
    }
  }
`;

export const PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY = gql`
  query PlayerActivityDepositWithdrawalStats($ids: [ID!]!, $dateFrom: String, $dateTo: String) {
    playerActivityDepositWithdrawalStats(ids: $ids, dateFrom: $dateFrom, dateTo: $dateTo) {
      playerId
      totalDepositAmount
      totalDepositCount
      totalWithdrawalAmount
      totalWithdrawalCount
      rangeDepositAmount
      rangeDepositCount
      rangeWithdrawalAmount
      rangeWithdrawalCount
    }
  }
`;

/* The domain KPI documents and the active-player count are gone (F-REP-16): the cards are summed from
   the listed players' rows, which are complete (the breakdowns are not capped). */
