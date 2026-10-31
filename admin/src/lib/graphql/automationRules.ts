import { gql } from '@apollo/client'

export const GET_AUTOMATION_RULES_QUERY = gql`
  query AutomationRules($eventId: ID) {
    automationRules(eventId: $eventId) {
      id
      eventId
      ruleType
      config
      enabled
      priority
    }
  }
`

export const UPSERT_AUTOMATION_RULE_MUTATION = gql`
  mutation UpsertAutomationRule($input: AutomationRuleInput!) {
    upsertAutomationRule(input: $input) {
      success
      message
    }
  }
`

export const DELETE_AUTOMATION_RULE_MUTATION = gql`
  mutation DeleteAutomationRule($id: ID!) {
    deleteAutomationRule(id: $id) {
      success
      message
    }
  }
`

export const AUTOMATION_TRIGGERED_SUBSCRIPTION = gql`
  subscription AutomationTriggered($eventId: ID) {
    automationTriggered(eventId: $eventId)
  }
`

