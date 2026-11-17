import { gql } from '@apollo/client'

export const GET_PLAYER_PROFILE_QUERY = gql`
  query PlayerProfile($userId: ID!) {
    sportsPlayerProfile(userId: $userId) {
      user {
        id
        name
        username
        email
        phone
        status
        riskType
      }
      statistics {
        totalBets
        totalStake
        totalWinnings
        netProfit
        winRate
        averageStake
        averageOdds
        roi
        largestWin
        largestLoss
        favoriteMarketType
        bettingFrequency
        riskScore
      }
      patterns {
        peakBettingHours
        averageSessionDuration
        typicalStakeRange {
          min
          max
          median
        }
        marketPreferences {
          marketType
          percentage
          totalBets
        }
        oddsRange {
          min
          max
          median
        }
        bettingSidePreference
        streakBehavior {
          chasingLosses
          stopAfterWin
          averageStreakLength
        }
      }
      riskProfile {
        riskLevel
        flags
        manualFlags
        patternFlags
        patterns {
          id
          patternType
          severity
          detectedAt
          status
        }
        suspiciousActivityCount
        lastReviewedAt
        notes
      }
      devices {
        ipAddress
        userAgent
        location
        country
        firstUsed
        lastUsed
        betCount
      }
      relatedPlayers {
        userId
        userName
        relationshipType
        confidence
        sharedAttributes
      }
      agentChain {
        level
        agentId
        agentName
        commissionRate
        creditLimit
      }
      recentBets {
        id
        userId
        eventId
        marketId
        selectionId
        side
        price
        stake
        liability
        status
        currency
        createdAt
      }
    }
  }
`

export const VOID_BET_MUTATION = gql`
  mutation VoidBet($betId: ID!, $reason: String!) {
    voidBet(betId: $betId, reason: $reason) {
      success
      message
    }
  }
`

export const CANCEL_BET_MUTATION = gql`
  mutation CancelBet($betId: ID!, $reason: String!) {
    cancelBet(betId: $betId, reason: $reason) {
      success
      message
    }
  }
`

export const FLAG_PLAYER_MUTATION = gql`
  mutation FlagPlayer($userId: ID!, $flag: String!, $reason: String!) {
    flagPlayer(userId: $userId, flag: $flag, reason: $reason) {
      success
      message
    }
  }
`

export const UNFLAG_PLAYER_MUTATION = gql`
  mutation UnflagPlayer($userId: ID!, $flag: String!) {
    unflagPlayer(userId: $userId, flag: $flag) {
      success
      message
    }
  }
`

export const BET_PLACED_SUBSCRIPTION = gql`
  subscription BetPlaced($eventId: ID) {
    betPlaced(eventId: $eventId) {
      id
      userId
      userName
      userFlags
      eventId
      eventName
      sportId
      sportName
      leagueId
      leagueName
      marketId
      selectionId
      side
      price
      stake
      liability
      status
      currency
      createdAt
      ipAddress
      userAgent
      location
      country
      deviceInfo
      oddsSize
      agentInfo {
        agentId
        agentName
        schemeType
        rate
      }
    }
  }
`

