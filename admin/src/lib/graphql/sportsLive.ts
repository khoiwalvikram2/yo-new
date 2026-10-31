import { gql } from '@apollo/client'

export const SUB_SPORTS_LIVE_DASHBOARD = gql`
  subscription SportsLiveDashboard($scope: SportsLiveScope) {
    sportsLiveDashboard(scope: $scope) {
      kpis {
        at
        totalStake
        totalLiability
        netExposure
        grossExposure
        activeMarkets
        activePlayers
        betsPerMin
        avgOdds
        backBets
        layBets
      }
      breakdown {
        bySport {
          sportId
          sportName
          totalStake
          totalLiability
          netExposure
          bets
        }
        byLeague {
          leagueId
          leagueName
          totalStake
          totalLiability
          netExposure
          bets
        }
        byEvent {
          eventId
          eventName
          totalStake
          totalLiability
          netExposure
          bets
        }
        byMarketType {
          marketType
          totalStake
          totalLiability
          netExposure
          bets
        }
        byBetSide {
          side
          totalStake
          totalLiability
          bets
        }
      }
    }
  }
`

export const SUB_SPORTS_PLAYER_EVENTS = gql`
  subscription SportsPlayerEvents($scope: SportsLiveScope) {
    sportsPlayerEvents(scope: $scope) {
      id
      userId
      userName
      eventId
      eventName
      marketId
      marketName
      stake
      side
      price
      status
      at
    }
  }
`

export const SUB_SPORTS_RISK_ALERTS = gql`
  subscription SportsRiskAlerts($scope: SportsLiveScope) {
    sportsRiskAlerts(scope: $scope) {
      at
      items {
        id
        entityType
        entityId
        entityName
        severity
        metric
        value
        threshold
        description
        channel
        at
      }
    }
  }
`

