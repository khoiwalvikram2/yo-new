import { isSuperAdminRoleName } from '@src/domains/common/roleNames.js'
import { hasPermission as callerHasPermission } from '@src/domains/common/auth.js'
import {
  getUserPermissions,
  getRolePermissions,
  getRoleById,
  aggregatePermissionPairs,
  type PermissionPair,
} from '@/repos/rbac/rbacRepo.js'

/** Matches supportAdmins query filter — these roles must not be granted via support-admin flows. */
export function isPrivilegedAdminRoleName(roleName: string): boolean {
  const privilegedRoles = ['Whitelabel Admin', 'Super Admin', 'whitelabel_admin', 'super_admin']
  const name = roleName || ''
  const roleLower = name.toLowerCase()
  return (
    privilegedRoles.includes(name) ||
    privilegedRoles.includes(roleLower) ||
    roleLower.includes('whitelabel') ||
    (roleLower.includes('super') && roleLower.includes('admin'))
  )
}

export type EnsureNoPrivilegeEscalationOptions = {
  /**
   * When true, skip the "actor must have every permission" check (WL delegating template/support roles).
   * Still blocks privileged platform roles. Call only after verifying `security.support-admins:create|update`.
   */
  allowSupportAdminDelegation?: boolean
}

/**
 * Checks if actor's effective permissions are a superset of target role's permissions.
 * This prevents privilege escalation when assigning roles.
 */
/**
 * Refuses a set of permissions the actor does not itself hold.
 *
 * `ensureNoPrivilegeEscalation` guards role *assignment*: it reads the target
 * role's stored permissions and compares them to the actor's. That leaves the
 * role *definition* paths unguarded, and they are the sharper edge — the pairs
 * arrive in the request and `ensurePermissions()` INSERTs any it has not seen,
 * so `{ domain: 'all', actions: ['*'] }` was accepted and created. A holder of
 * `security.roles:update` could write themselves an `all:*` role and, on the
 * assignment path, pass the subset check against the role they had just
 * authored.
 *
 * This takes the proposed pairs directly, so it can run before the write.
 */
/**
 * Refuses a role name that would confer platform standing on its holder.
 *
 * `buildAuthContext` decides Super Admin by role *name*, and a Super Admin may
 * name any tenant in `X-Whitelabel-ID` and operate there. So the name is itself
 * a privilege — one that `ensureActorMayGrantPermissions` cannot see, because a
 * role called "Supervisor Admin" holding nothing passes the subset check
 * trivially while still switching its holder's tenant.
 *
 * Only a caller who already holds platform-wide permission may mint such a
 * name. The test is deliberately the same one the header trusts, imported from
 * a single module so the two cannot diverge.
 */
export function ensureMayUseRoleName(permissions: unknown, roleName: string): void {
  if (!isSuperAdminRoleName(roleName)) return
  if (callerHasPermission((permissions ?? []) as any, 'all', '*')) return
  throw new Error(
    `Cannot use the role name "${roleName}": names matching the platform ` +
      'administrator pattern may only be created by a platform administrator.'
  )
}
export async function ensureActorMayGrantPermissions(
  actorUserId: number,
  tenant: string,
  proposed: ReadonlyArray<{ domain: string; action: string }>
): Promise<void> {
  if (proposed.length === 0) return

  let actorPerms = await getUserPermissions(actorUserId, tenant)
  let hasAllStar = actorPerms.some((p) => p.domain === 'all' && p.action === '*')
  // Super Admin holds all:* only in the platform tenant; when they operate in a
  // whitelabel tenant they hold no role there. Same fallback as the sibling.
  if (!hasAllStar && tenant !== 'default') {
    const platformPerms = await getUserPermissions(actorUserId, 'default')
    hasAllStar = platformPerms.some((p) => p.domain === 'all' && p.action === '*')
    if (platformPerms.length > 0) actorPerms = [...actorPerms, ...platformPerms]
  }
  if (hasAllStar) return

  // What the actor holds is decided by the predicate that authorizes them everywhere else, so a pair they
  // reach through a flat grant counts. A literal comparison of stored pairs refused a Whitelabel Admin every
  // nested permission the role editor offers (it holds flat `audit:read`, so `audit.events:view` was "not
  // held") while that same admin read the audit trail through it.
  const actorHeld = aggregatePermissionPairs(actorPerms)

  for (const { domain, action } of proposed) {
    // `all:*` is the platform wildcard. Only a holder of it may hand it out,
    // and a holder of it has already returned above.
    if (domain === 'all') {
      throw new Error(
        'Cannot grant permission "all:*": only a platform Super Admin may define a role that holds it.'
      )
    }
    if (callerHasPermission(actorHeld, domain, action)) continue
    throw new Error(
      `Cannot grant permission "${domain}:${action}": you do not hold it. ` +
        'Privilege escalation is not allowed.'
    )
  }
}
export async function ensureNoPrivilegeEscalation(
  actorUserId: number,
  tenant: string,
  targetRoleId: number,
  options?: EnsureNoPrivilegeEscalationOptions
): Promise<void> {
  if (options?.allowSupportAdminDelegation) {
    const role = await getRoleById(targetRoleId, tenant)
    if (!role) {
      throw new Error('Role not found')
    }
    if (isPrivilegedAdminRoleName(role.name)) {
      throw new Error(
        'Cannot assign privileged platform roles (e.g. Whitelabel Admin, Super Admin) in this flow.'
      )
    }
    // Delegation deliberately skips the subset check, so a whitelabel admin can
    // hand out a template role such as Finance Manager without holding every
    // permission in it. Two things make that wider than intended:
    //
    // `security.support-admins:create` maps from flat `roles:assign` — the same
    // flat permission as `security.roles:assign`. So any caller who passes the
    // assign gate by flat permission turns delegation on automatically, and the
    // subset check runs only for callers holding the nested permission
    // explicitly. And the only remaining bound was the role's *name*, which says
    // nothing about its contents: a role named "Reports Viewer" holding 253
    // permissions passes it.
    //
    // Delegation may still exceed the actor, but not into the permission system
    // itself. Granting `all:*`, or anything under `security.*` — roles, support
    // admins, the IP allowlist — is how a delegated grant becomes a route back
    // to granting anything at all.
    const contents = await getRolePermissions(targetRoleId, tenant)
    for (const { domain, action } of contents) {
      if (domain === 'all') {
        throw new Error('Cannot delegate a role holding "all:*".')
      }
      if (domain === 'security' || domain.startsWith('security.') || domain === 'roles') {
        throw new Error(
          `Cannot delegate a role holding "${domain}:${action}": delegated roles may not ` +
            'carry permissions over the permission system itself.'
        )
      }
    }
    return
  }

  // Get actor's effective permissions
  const actorPerms = await getUserPermissions(actorUserId, tenant)
  const actorAggregated = aggregatePermissionPairs(actorPerms)
  
  // Get target role's permissions
  const targetPerms = await getRolePermissions(targetRoleId, tenant)
  const targetAggregated = aggregatePermissionPairs(targetPerms)
  
  // Check if actor has 'all:*' permission (super admin) in current tenant
  let hasAllStar = actorPerms.some(p => p.domain === 'all' && p.action === '*')
  // Super Admin role with all:* is only seeded in default (platform) tenant.
  // When Super Admin operates in whitelabel tenant, they have no role there, so also check default tenant.
  if (!hasAllStar && tenant !== 'default') {
    const platformPerms = await getUserPermissions(actorUserId, 'default')
    hasAllStar = platformPerms.some(p => p.domain === 'all' && p.action === '*')
  }
  if (hasAllStar) {
    return // Super admin can assign any role
  }
  
  // Check if actor has all permissions that target role has. "Has" is the predicate that authorizes the
  // actor everywhere else (exact, wildcard, or through a flat grant), as in ensureActorMayGrantPermissions;
  // a domain wildcard in the role needs a wildcard (or all:*) in the actor.
  for (const { domain, actions } of targetAggregated) {
    for (const action of actions.includes('*') ? ['*'] : actions) {
      if (callerHasPermission(actorAggregated, domain, action)) continue
      // Actor doesn't have this permission
      throw new Error(
        `Cannot assign role: actor lacks permission "${domain}:${action}". ` +
        `Privilege escalation is not allowed.`
      )
    }
  }
}

/**
 * Checks if a user has a specific permission
 */
export function hasPermission(
  userPerms: { domain: string; actions: string[] }[],
  domain: string,
  action: string
): boolean {
  // Check for global wildcard
  const allStar = userPerms.find(p => p.domain === 'all' && p.actions.includes('*'))
  if (allStar) return true
  
  // Check for domain wildcard
  const domainPerm = userPerms.find(p => p.domain === domain)
  if (domainPerm) {
    if (domainPerm.actions.includes('*') || domainPerm.actions.includes(action)) {
      return true
    }
  }
  
  return false
}

