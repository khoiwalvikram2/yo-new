import { gql } from '@apollo/client'

/* The operations /reporting/pnl sends, moved byte for byte out of PNLPage.tsx (page migration C,
   W3 Task 122) so the page test can hand the same documents to MockedProvider. The first four are
   unchanged; AGENT_COMMISSION_DAYS_QUERY was added for a COMMISSION agent's report (F-REP-13). */

export const PNL_QUERY = gql`
  query PNL($range: String, $dateFrom: String, $dateTo: String) {
    pnl(range: $range, dateFrom: $dateFrom, dateTo: $dateTo) {
      dimension
      value
      date
    }
  }
`;

export const SPORTS_KPIS_QUERY = gql`
  query SportsKPIs($filter: SportsReportingFilter) {
    sportsKPIs(filter: $filter) {
      grossGamingRevenue
      totalStakes
      totalPayouts
      netRevenue
    }
  }
`;

export const MATKA_KPIS_QUERY = gql`
  query MatkaKPIs($filter: MatkaReportingFilter) {
    matkaKPIs(filter: $filter) {
      grossGamingRevenue
      totalStakes
      totalPayouts
      netRevenue
    }
  }
`;

export const CASINO_KPIS_QUERY = gql`
  query CasinoKPIs($filter: CasinoReportingFilter) {
    casinoKPIs(filter: $filter) {
      grossGamingRevenue
      totalStakes
      totalPayouts
      netRevenue
    }
  }
`;

/** A COMMISSION agent's Commission Earned Report: the commission posted to its own ledger, per day. */
export const AGENT_COMMISSION_DAYS_QUERY = gql`
  query AgentCommissionDays($filter: AgentReportingFilter) {
    agentTrends(filter: $filter) {
      date
      commission
    }
  }
`;
