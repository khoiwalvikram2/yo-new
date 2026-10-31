import { gql } from '@apollo/client'

export const ROLES = gql`
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

export const ROLE = gql`
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

export const PERMISSIONS = gql`
  query Permissions {
    permissions {
      domain
      actions
    }
  }
`

export const ADMIN_ROLES = gql`
  query AdminRoles($userId: ID!) {
    adminRoles(userId: $userId) {
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

export const CREATE_RBAC_ROLE = gql`
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

export const UPDATE_RBAC_ROLE = gql`
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

export const DELETE_RBAC_ROLE = gql`
  mutation DeleteRBACRole($id: ID!) {
    deleteRBACRole(id: $id) {
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

export const SET_RBAC_ROLE_PERMISSIONS = gql`
  mutation SetRBACRolePermissions($roleId: ID!, $permissions: [PermissionInput!]!) {
    setRBACRolePermissions(roleId: $roleId, permissions: $permissions) {
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

export const ASSIGN_ROLE_TO_ADMIN = gql`
  mutation AssignRoleToAdmin($input: AssignRoleInput!) {
    assignRoleToAdmin(input: $input) {
      success
      message
    }
  }
`

export const REVOKE_ROLE_FROM_ADMIN = gql`
  mutation RevokeRoleFromAdmin($input: AssignRoleInput!) {
    revokeRoleFromAdmin(input: $input) {
      success
      message
    }
  }
`

export const SUPPORT_ADMINS = gql`
  query SupportAdmins {
    supportAdmins {
      id
      name
      email
      status
      createdAt
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
  }
`

export const CREATE_SUPPORT_ADMIN = gql`
  mutation CreateSupportAdmin($input: CreateSupportAdminInput!) {
    createSupportAdmin(input: $input) {
      success
      message
      user {
        id
        name
        email
        createdAt
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
    }
  }
`

export const IP_ALLOWLIST = gql`
  query IpAllowlist($userId: ID!) {
    ipAllowlist(userId: $userId) {
      id
      cidr
      createdAt
    }
  }
`

export const ADD_IP_TO_ALLOWLIST = gql`
  mutation AddIpToAllowlist($userId: ID!, $cidr: String!) {
    addIpToAllowlist(userId: $userId, cidr: $cidr) {
      success
      message
    }
  }
`

export const REMOVE_IP_FROM_ALLOWLIST = gql`
  mutation RemoveIpFromAllowlist($id: ID!) {
    removeIpFromAllowlist(id: $id) {
      success
      message
    }
  }
`

