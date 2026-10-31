import { gql } from '@apollo/client'

/* The four operations /reporting/pnl sends, moved byte for byte out of PNLPage.tsx (page migration C,
   W3 Task 122) so the page test can hand the same documents to MockedProvider. Gate 10 compares them
   with the pre-image; none of them may change. */

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
