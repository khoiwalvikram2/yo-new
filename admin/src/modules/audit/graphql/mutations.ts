import { gql } from '@apollo/client'

export const CREATE_AUDIT_ANNOTATION = gql`
  mutation CreateAuditAnnotation($input: CreateAuditAnnotationInput!) {
    createAuditAnnotation(input: $input) {
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

export const UPDATE_AUDIT_ANNOTATION = gql`
  mutation UpdateAuditAnnotation($input: UpdateAuditAnnotationInput!) {
    updateAuditAnnotation(input: $input) {
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

export const DELETE_AUDIT_ANNOTATION = gql`
  mutation DeleteAuditAnnotation($id: ID!) {
    deleteAuditAnnotation(id: $id) {
      success
    }
  }
`

export const CREATE_AUDIT_EXPORT_JOB = gql`
  mutation CreateAuditExportJob($input: AuditExportJobInput!) {
    createAuditExportJob(input: $input) {
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
