import { gql } from '@apollo/client'

export const GET_EVENT_RISK_CONFIG_QUERY = gql`
  query EventRiskConfig($eventId: ID!) {
    eventRiskConfig(eventId: $eventId) {
      id
      eventId
      percentiles {
        liability75
        liability90
        liability95
        exposure75
        exposure90
        betCount75
        betCount90
        odds75
        odds90
      }
      weights {
        liability
        exposure
        volume
        odds
      }
      amounts {
        highLiability
        mediumLiability
        highExposure
        mediumExposure
        highBetCount
        mediumBetCount
        highOdds
        mediumOdds
      }
      alerts {
        enabled
        triggerLevels
        notificationEnabled
        bannerEnabled
        sidebarIndicatorEnabled
        cooldownSeconds
      }
      createdAt
      updatedAt
    }
  }
`

export const UPSERT_EVENT_RISK_CONFIG_MUTATION = gql`
  mutation UpsertEventRiskConfig($input: UpsertRiskConfigInput!) {
    upsertEventRiskConfig(input: $input) {
      id
      eventId
      percentiles {
        liability75
        liability90
        liability95
        exposure75
        exposure90
        betCount75
        betCount90
        odds75
        odds90
      }
      weights {
        liability
        exposure
        volume
        odds
      }
      amounts {
        highLiability
        mediumLiability
        highExposure
        mediumExposure
        highBetCount
        mediumBetCount
        highOdds
        mediumOdds
      }
      alerts {
        enabled
        triggerLevels
        notificationEnabled
        bannerEnabled
        sidebarIndicatorEnabled
        cooldownSeconds
      }
      createdAt
      updatedAt
    }
  }
`

