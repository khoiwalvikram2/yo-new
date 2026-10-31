/* The five GraphQL documents /security/support-admins declared inline before the kit migration, moved here
   unchanged (byte for byte) so the page, its components and its tests share one copy. The other nine
   operations stay in lib/graphql/rbac.ts, which other pages import. */
import { gql } from '@apollo/client'

export const SET_USER_STATUS = gql`
  mutation SetUserStatus($id: ID!, $status: PlayerStatus!) {
    setUserStatus(id: $id, status: $status) {
      success
      message
      user { id status }
    }
  }
`

export const FORCE_LOGOUT = gql`
  mutation ForceLogout($id: ID!) {
    forceLogoutUser(id: $id) {
      success
      message
    }
  }
`

export const SET_REQUIRE_PASSWORD_RESET = gql`
  mutation SetRequirePasswordReset($id: ID!, $require: Boolean!) {
    setRequirePasswordReset(id: $id, require: $require) {
      success
      message
      user { id requirePasswordReset }
    }
  }
`

export const DELETE_USER = gql`
  mutation DeleteSupportAdmin($id: ID!) {
    deleteSupportAdmin(id: $id) {
      success
      message
    }
  }
`

export const AUDIT_QUERY = gql`
  query Audit($actor: ID, $from: String, $to: String, $limit: Int) {
    audit(actor: $actor, from: $from, to: $to, limit: $limit) {
      id
      actorId
      domain
      action
      resourceType
      resourceId
      timestamp
      before
      after
    }
  }
`

export const ADMIN_ACTIVITY_PAGE = gql`
  query SupportAdminActivityPage($filters: AuditListFilter) {
    auditEvents(filters: $filters) {
      total items { id actorId domain action resourceType resourceId before after timestamp }
    }
  }
`
