import { gql } from '@apollo/client'

export const AUDIT_EVENTS_SUBSCRIPTION = gql`
  subscription AuditEvents($filters: AuditListFilter) {
    auditEvents(filters: $filters) {
      id
      tenant
      actorId
      actor {
        id
        name
        email
        type
        role
      }
      domain
      action
      resourceType
      resourceId
      before
      after
      timestamp
    }
  }
`
