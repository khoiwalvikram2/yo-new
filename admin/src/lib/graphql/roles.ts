import { gql } from '@apollo/client'

export const ROLES_QUERY = gql`
  query Roles {
    roles {
      id
      name
      tenant
      permissions {
        domain
        actions
      }
      updatedAt
    }
  }
`

export const ROLE_QUERY = gql`
  query Role($id: ID!) {
    role(id: $id) {
      id
      name
      tenant
      permissions {
        domain
        actions
      }
      updatedAt
    }
  }
`

export const PERMISSIONS_QUERY = gql`
  query Permissions {
    permissions {
      domain
      actions
    }
  }
`

export const CREATE_RBAC_ROLE_MUTATION = gql`
  mutation CreateRBACRole($input: CreateRoleInput!) {
    createRBACRole(input: $input) {
      success
      message
      role {
        id
        name
        tenant
        permissions {
          domain
          actions
        }
        updatedAt
      }
    }
  }
`

export const UPDATE_RBAC_ROLE_MUTATION = gql`
  mutation UpdateRBACRole($input: UpdateRoleInput!) {
    updateRBACRole(input: $input) {
      success
      message
      role {
        id
        name
        tenant
        permissions {
          domain
          actions
        }
        updatedAt
      }
    }
  }
`

export const DELETE_RBAC_ROLE_MUTATION = gql`
  mutation DeleteRBACRole($id: ID!) {
    deleteRBACRole(id: $id) {
      success
      message
      role {
        id
        name
      }
    }
  }
`

export const ASSIGN_ROLE_TO_ADMIN_MUTATION = gql`
  mutation AssignRoleToAdmin($input: AssignRoleInput!) {
    assignRoleToAdmin(input: $input) {
      success
      message
    }
  }
`

export const REVOKE_ROLE_FROM_ADMIN_MUTATION = gql`
  mutation RevokeRoleFromAdmin($input: AssignRoleInput!) {
    revokeRoleFromAdmin(input: $input) {
      success
      message
    }
  }
`

