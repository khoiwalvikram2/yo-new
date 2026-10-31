import { gql } from '@apollo/client'

export const SUB_CASINO_LIVE_DASHBOARD = gql`
  subscription CasinoLiveDashboard($scope: LiveScope) {
    casinoLiveDashboard(scope: $scope) {
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
        byGame {
          gameId
          gameName
          thumbnailUrl
          wagered
          payouts
          ggr
          bets
        }
        byProvider {
          providerId
          providerName
          wagered
          payouts
          ggr
          bets
        }
        byVendor {
          vendorId
          vendorName
          wagered
          payouts
          ggr
          bets
        }
      }
    }
  }
`

export const SUB_CASINO_PLAYER_EVENTS = gql`
  subscription CasinoPlayerEvents($scope: LiveScope) {
    casinoPlayerEvents(scope: $scope) {
      id
      userId
      userName
      gameId
      gameName
      vendorName
      status
      stake
      payout
      at
    }
  }
`

export const CREATE_TEST_CASINO_BET = gql`
  mutation CreateTestCasinoBet($input: CreateTestCasinoBetInput!) {
    createTestCasinoBet(input: $input) {
      id
      userId
      gameId
      gameName
      vendorId
      vendorName
      stake
      payout
      status
      createdAt
    }
  }
`

export const SETTLE_TEST_CASINO_BET = gql`
  mutation SettleTestCasinoBet($id: ID!, $payout: Float, $status: CasinoBetStatus!) {
    settleTestCasinoBet(id: $id, payout: $payout, status: $status) {
      id
      status
      payout
      settledAt
      updatedAt
    }
  }
`

