import { gql } from '@apollo/client'

export const SUB_MATKA_LIVE_DASHBOARD = gql`
  subscription MatkaLiveDashboard($scope: LiveScope) {
    matkaLiveDashboard(scope: $scope) {
      kpis {
        at
        betsPerMin
        wagered
        payouts
        ggr
        rtp
        activePlayers
      }
      breakdown {
        byType {
          matkaType
          wagered
          payouts
          ggr
          bets
        }
        byMarket {
          marketName
          wagered
          payouts
          ggr
          bets
        }
        byBidType {
          bidType
          wagered
          payouts
          ggr
          bets
        }
        byMatka {
          matkaId
          matkaName
          wagered
          payouts
          ggr
          bets
        }
        bySession {
          marketSession
          wagered
          payouts
          ggr
          bets
        }
        byDigit {
          digit
          wagered
          payouts
          exposure
          bets
        }
        bySelection {
          selection
          matkaId
          matkaName
          marketName
          marketSession
          bidType
          wagered
          payouts
          exposure
          bets
        }
      }
    }
  }
`

export const SUB_MATKA_PLAYER_EVENTS = gql`
  subscription MatkaPlayerEvents($scope: LiveScope) {
    matkaPlayerEvents(scope: $scope) {
      id
      userId
      userName
      matkaId
      matkaName
      matkaType
      marketName
      bidType
      betAmount
      potentialWin
      status
      at
    }
  }
`

export const CREATE_TEST_MATKA_BET = gql`
  mutation CreateTestMatkaBet($input: CreateTestMatkaBetInput!) {
    createTestMatkaBet(input: $input) {
      id
      userId
      matkaId
      matkaType
      marketName
      marketSession
      bidType
      betNumbers
      betAmount
      payoutMultiplier
      potentialWin
      status
      currency
      createdAt
    }
  }
`

export const SUB_MATKA_EXPOSURE_BOOK = gql`
  subscription MatkaExposureBook($scope: LiveScope) {
    matkaExposureBook(scope: $scope) {
      at
      markets {
        marketName
        marketSession
        bets
        totalStake
        potentialPayout
        exposure
        selections {
          marketName
          marketSession
          bidType
          selectionKey
          bets
          totalStake
          potentialPayout
          exposure
        }
      }
    }
  }
`

export const SUB_MATKA_RISK_ALERTS = gql`
  subscription MatkaRiskAlerts($scope: LiveScope) {
    matkaRiskAlerts(scope: $scope) {
      at
      items {
        id
        type
        severity
        title
        description
        entity
        value
        threshold
        at
      }
    }
  }
`

