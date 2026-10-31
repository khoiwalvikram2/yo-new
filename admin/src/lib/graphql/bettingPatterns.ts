import { gql } from '@apollo/client'

export const GET_BETTING_PATTERNS_QUERY = gql`
  query BettingPatterns(
    $userId: ID
    $eventId: ID
    $severity: PatternSeverity
    $status: String
    $limit: Int
  ) {
    bettingPatterns(
      userId: $userId
      eventId: $eventId
      severity: $severity
      status: $status
      limit: $limit
    ) {
      id
      userId
      userName
      eventId
      patternType
      severity
      metrics
      detectedAt
      status
      notes
    }
  }
`

export const PATTERN_DETECTED_SUBSCRIPTION = gql`
  subscription PatternDetected($eventId: ID) {
    patternDetected(eventId: $eventId) {
      id
      userId
      userName
      eventId
      patternType
      severity
      metrics
      detectedAt
      status
      notes
    }
  }
`

export const DISMISS_PATTERN_MUTATION = gql`
  mutation DismissPattern($patternId: ID!, $reason: String!) {
    dismissPattern(patternId: $patternId, reason: $reason) {
      success
      message
    }
  }
`

