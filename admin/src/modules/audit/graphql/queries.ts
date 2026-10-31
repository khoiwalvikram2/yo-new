import { gql } from '@apollo/client'

export const AUDIT_EVENTS_QUERY = gql`
  query AuditEvents($filters: AuditListFilter) {
    auditEvents(filters: $filters) {
      items {
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
      total
      page
      pageSize
    }
  }
`

export const AUDIT_STATS_QUERY = gql`
  query AuditStats($filters: AuditListFilter) {
    auditStats(filters: $filters) {
      total
      today
      uniqueActors
      byDomain {
        domain
        count
      }
      byAction {
        action
        count
      }
      recentEvents {
        id
        domain
        action
        timestamp
      }
    }
  }
`

export const AUDIT_EXPORT_CSV_QUERY = gql`
  query AuditExportCSV($filters: AuditListFilter) {
    auditExportCSV(filters: $filters)
  }
`

export const AUDIT_EXPORT_JOBS_QUERY = gql`
  query AuditExportJobs($status: String, $limit: Int) {
    auditExportJobs(status: $status, limit: $limit) {
      id
      tenant
      whitelabelId
      createdBy
      filtersJson
      exportFormat
      status
      fileUrl
      errorMessage
      scheduledAt
      completedAt
      createdAt
    }
  }
`

export const AUDIT_ANNOTATIONS_QUERY = gql`
  query AuditAnnotations($auditEventId: ID!) {
    auditAnnotations(auditEventId: $auditEventId) {
      id
      tenant
      auditEventId
      createdBy
      note
      createdAt
      updatedAt
    }
  }
`

export const AUDIT_EXPORT_JOBS_PAGE_QUERY = gql`
  query AuditExportJobsPage($status: String, $limit: Int, $offset: Int) {
    auditExportJobsPage(status: $status, limit: $limit, offset: $offset) {
      total
      items {
      id
      tenant
      whitelabelId
      createdBy
      filtersJson
      exportFormat
      status
      fileUrl
      errorMessage
      scheduledAt
      completedAt
      createdAt
      }
    }
  }
`
