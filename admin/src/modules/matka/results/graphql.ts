import { gql } from '@apollo/client'

export const MATKA_RESULTS_QUERY = gql`
  query MatkaResults($filters: MatkaResultListFilter) {
    matkaResults(filters: $filters) {
      items {
        id
        tenant
        matkaId
        date
        type
        result
        declaredBy
        declaredByName
        declaredAt
        rolledBackAt
        rolledBackBy
        rolledBackByName
        rollbackReason
        rollbackTag
        createdAt
        pendingBetsCount
      }
      total
    }
  }
`

export const CREATE_MATKA_RESULT_MUTATION = gql`
  mutation CreateMatkaResult($input: MatkaResultCreateInput!, $idempotencyKey: String) {
    createMatkaResult(input: $input, idempotencyKey: $idempotencyKey) {
      success
      message
      result {
        id
        matkaId
        date
        type
        result
        declaredBy
        declaredByName
        declaredAt
        createdAt
      }
      impact {
        betsSettled
        winners
        totalPayout
      }
    }
  }
`

export const ROLLBACK_MATKA_RESULT_MUTATION = gql`
  mutation RollbackMatkaResult($input: MatkaResultRollbackInput!) {
    rollbackMatkaResult(input: $input) {
      success
      message
      result {
        id
        matkaId
        date
        type
        result
        declaredBy
        declaredByName
        declaredAt
        rolledBackAt
        rolledBackBy
        rolledBackByName
        rollbackReason
        rollbackTag
        createdAt
      }
      impact {
        betsSettled
        winners
        totalPayout
      }
    }
  }
`

export const MATKA_RESULT_EVENTS_SUBSCRIPTION = gql`
  subscription MatkaResultEvents {
    matkaResultEvents {
      id
      matkaId
      date
      type
      result
      declaredBy
      declaredAt
      rolledBackAt
      rolledBackBy
    }
  }
`

export const MATKA_RESULT_EXISTS_QUERY = gql`
  query MatkaResultExists($matkaId: ID!, $date: String!, $type: MatkaResultType!) {
    matkaResultExists(matkaId: $matkaId, date: $date, type: $type)
  }
`

