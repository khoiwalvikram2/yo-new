import { gql } from '@apollo/client'

/** Every whitelabel and the state of its CRM. Super Admin only. */
export const CRM_WHITELABELS = gql`
  query CrmWhitelabels {
    crmWhitelabels {
      tenant
      name
      domain
      enabled
      seatLimit
      seatsUsed
    }
  }
`

export const SET_CRM_WHITELABEL_SETTINGS = gql`
  mutation SetCrmWhitelabelSettings(
    $tenant: String!
    $enabled: Boolean!
    $seatLimit: Int!
    $sessionIdleMinutes: Int
    $enforceIpAllowlist: Boolean
  ) {
    setCrmWhitelabelSettings(
      tenant: $tenant
      enabled: $enabled
      seatLimit: $seatLimit
      sessionIdleMinutes: $sessionIdleMinutes
      enforceIpAllowlist: $enforceIpAllowlist
    ) {
      tenant
      enabled
      seatLimit
      seatsUsed
      sessionIdleMinutes
      enforceIpAllowlist
      updatedAt
    }
  }
`

/** The caller's own whitelabel allowance. */

export const CRM_CREATE_FIRST_ADMIN = gql`
  mutation CrmCreateFirstAdmin(
    $tenant: String!
    $name: String!
    $username: String!
    $password: String!
    $email: String
  ) {
    crmCreateFirstAdmin(
      tenant: $tenant
      name: $name
      username: $username
      password: $password
      email: $email
    ) {
      ok
      error
    }
  }
`

/**
 * CRM user management for whoever owns the whitelabel.
 *
 * `tenant` is optional and only honoured for a Super Admin — a whitelabel
 * administrator's own tenant is used regardless of what is sent, so the
 * argument is a Super Admin's selector rather than anyone's escape hatch.
 */
export const WHITELABEL_CRM_USERS = gql`
  query WhitelabelCrmUsers($tenant: ID) {
    whitelabelCrmUsers(tenant: $tenant) {
      tenant
      enabled
      seatLimit
      seatsUsed
      canChooseTenant
      users {
        id
        name
        username
        email
        phone
        status
        requirePasswordReset
        lastLoginAt
        lastSeenAt
        createdAt
        roleNames
        roleIds
      }
    }
  }
`

export const WHITELABEL_CRM_ROLES = gql`
  query WhitelabelCrmRoles($tenant: ID) {
    whitelabelCrmRoles(tenant: $tenant) {
      id
      name
      description
      isSystem
    }
  }
`

export const WHITELABEL_CRM_CREATE_USER = gql`
  mutation WhitelabelCrmCreateUser($tenant: ID, $input: CrmCreateUserInput!) {
    whitelabelCrmCreateUser(tenant: $tenant, input: $input) {
      ok
      error
    }
  }
`

export const WHITELABEL_CRM_UPDATE_USER = gql`
  mutation WhitelabelCrmUpdateUser($tenant: ID, $input: CrmUpdateUserInput!) {
    whitelabelCrmUpdateUser(tenant: $tenant, input: $input) {
      ok
      error
    }
  }
`

export const WHITELABEL_CRM_SET_USER_STATUS = gql`
  mutation WhitelabelCrmSetUserStatus($tenant: ID, $id: ID!, $status: String!) {
    whitelabelCrmSetUserStatus(tenant: $tenant, id: $id, status: $status) {
      ok
      error
    }
  }
`

export const WHITELABEL_CRM_RESET_PASSWORD = gql`
  mutation WhitelabelCrmResetPassword($tenant: ID, $id: ID!, $newPassword: String!) {
    whitelabelCrmResetPassword(tenant: $tenant, id: $id, newPassword: $newPassword) {
      ok
      error
    }
  }
`

export const WHITELABEL_CRM_SET_USER_ROLES = gql`
  mutation WhitelabelCrmSetUserRoles($tenant: ID, $id: ID!, $roleIds: [ID!]!) {
    whitelabelCrmSetUserRoles(tenant: $tenant, id: $id, roleIds: $roleIds) {
      ok
      error
    }
  }
`

export const WHITELABEL_CRM_DELETE_USER = gql`
  mutation WhitelabelCrmDeleteUser($tenant: ID, $id: ID!) {
    whitelabelCrmDeleteUser(tenant: $tenant, id: $id) {
      ok
      error
    }
  }
`
