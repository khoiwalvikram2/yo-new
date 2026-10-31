/**
 * Pure logic of /security/roles/new and /security/roles/:id/edit, moved out of the legacy
 * CreateEditRolePage.tsx: the form values and their rules (the antd Form.Item rules, word for word), the
 * server's permission list grouped by domain, the stored role as form values, and the exact mutation input.
 */
import { z } from 'zod'
import type { Permission } from '@/state/rbacStore'

export interface RoleFormValues {
  name: string
  permissions: Permission[]
}

export const EMPTY_ROLE_VALUES: RoleFormValues = { name: '', permissions: [] }

export const NAME_REQUIRED = 'Please enter role name'
export const NAME_TOO_SHORT = 'Role name must be at least 2 characters'
export const NAME_TOO_LONG = 'Role name must not exceed 64 characters'

/**
 * antd's validator counts a surrogate pair (an emoji) as one character, so the bounds count code points.
 * As before, the name is not trimmed: three spaces pass.
 */
function nameLength(value: string): number {
  return Array.from(value).length
}

export const roleFormSchema = z.object({
  name: z.string().superRefine((value, ctx) => {
    if (value === '') {
      ctx.addIssue({ code: 'custom', message: NAME_REQUIRED })
      return
    }
    const length = nameLength(value)
    if (length < 2) ctx.addIssue({ code: 'custom', message: NAME_TOO_SHORT })
    else if (length > 64) ctx.addIssue({ code: 'custom', message: NAME_TOO_LONG })
  }),
  // The legacy form put no rule on the permissions; they are passed through as they are.
  permissions: z.array(z.custom<Permission>()),
})

interface StoredRole {
  name: string
  permissions?: Permission[] | null
}

/** The stored role as the form's first values. */
export function roleFormValues(role: StoredRole): RoleFormValues {
  return { name: role.name, permissions: role.permissions || [] }
}

/** Every domain the server offers with its actions, each action once, in the order they arrive. */
export function groupPermissionsByDomain(allPermissions: readonly Permission[]): Record<string, string[]> {
  return allPermissions.reduce((acc: Record<string, string[]>, perm: Permission) => {
    if (!acc[perm.domain]) {
      acc[perm.domain] = []
    }
    perm.actions.forEach((action) => {
      if (!acc[perm.domain].includes(action)) {
        acc[perm.domain].push(action)
      }
    })
    return acc
  }, {})
}

export interface CreateRoleInput {
  name: string
  permissions: Permission[]
}

export interface UpdateRoleInput extends CreateRoleInput {
  id: string
}

function inputPermissions(values: RoleFormValues): Permission[] {
  const permissions = values.permissions || []
  return permissions.map((p: Permission) => ({
    domain: p.domain,
    actions: p.actions,
  }))
}

/** `CreateRoleInput`: the name as typed and each permission as `{ domain, actions }` (no `__typename`). */
export function buildCreateRoleInput(values: RoleFormValues): CreateRoleInput {
  return { name: values.name, permissions: inputPermissions(values) }
}

/** `UpdateRoleInput`: the same, led by the role id. */
export function buildUpdateRoleInput(id: string, values: RoleFormValues): UpdateRoleInput {
  return { id, name: values.name, permissions: inputPermissions(values) }
}

export function pageTitle(isEdit: boolean): string {
  return isEdit ? 'Edit Role' : 'Create Role'
}

export function pageSub(isEdit: boolean): string {
  return isEdit ? 'Update role permissions and settings' : 'Set up a new role with comprehensive permissions'
}

export function submitLabel(isEdit: boolean): string {
  return isEdit ? 'Update Role' : 'Create Role'
}

