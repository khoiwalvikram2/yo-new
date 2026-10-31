import { gql } from '@apollo/client'

/* The three documents of /reporting/players/nth-dw, moved byte for byte out of
   NthDepositWithdrawalReportPage.tsx (page migration C, W3 Task 125) so the page test can mount them
   against MockedProvider. The page's useQuery calls, variables and policies are unchanged. */

export const USERS_PAGE_QUERY = gql`
  query NthDwUsersPage($query: String, $offset: Int, $limit: Int) {
    usersPage(
      query: $query
      offset: $offset
      limit: $limit
    ) {
      items {
        id
        name
        phone
        username
        parentAgent {
          id
          username
        }
      }
      total
    }
  }
`;

export const OVERVIEW_KPIS_QUERY = gql`
  query OverviewKPIsNthDW($dateRange: DashboardDateRange) {
    overviewKPIs(dateRange: $dateRange) {
      totalDeposits
      totalWithdrawals
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
