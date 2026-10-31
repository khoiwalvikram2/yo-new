/**
 * CRM user management from the admin panel.
 *
 * The CRM administers its own users through `crm*` fields, gated by
 * `crm.users:manage` and a CRM session. That is the right home for it — until
 * the whitelabel has no working CRM login, which is precisely when someone has
 * to create one. These fields are the way in for the people who own the
 * whitelabel rather than the desk.
 *
 * Two things hold this file together:
 *
 *   1. **No business logic lives here.** Every operation calls the same
 *      `CrmUsersRepo` function the CRM's own resolver calls, and the same
 *      shared helpers for password policy, hashing and seat claiming. Two
 *      surfaces over one implementation, the way `CrmNotesRepo` already serves
 *      both the CRM and the admin panel. A second implementation is a second
 *      set of rules to keep in step, and they never stay in step.
 *
 *   2. **The field names do not start with `crm`.** `guardAdminSurface` exempts
 *      that prefix, so a `crm*` name here would quietly opt these operations
 *      out of the blanket refusal of CRM sessions and rest the boundary
 *      entirely on this file remembering to check. The names are the guard.
 */
import {
  assertCrmAdminSurface,
  assertCrmEnabled,
  type CrmAdminScope,
} from '@src/domains/crm/adminCrmSurface.js'
import { checkCrmPassword } from '@src/domains/crm/crmPasswordPolicy.js'
import { hashCrmPassword } from '@src/domains/crm/services/CrmAuthService.js'
import { getCrmSettings, countCrmSeats, reserveCrmSeat } from '@src/repos/crm/CrmSettingsRepo.js'
import {
  listCrmUsers,
  getCrmUserRoleIds,
  crmUsernameExists,
  insertCrmUser,
  updateCrmUser,
  setCrmUserStatus,
  setCrmUserPassword,
  setCrmUserRoles,
  deleteCrmUser,
  getCrmUserById,
  type CrmUserStatus,
} from '@src/repos/crm/CrmUsersRepo.js'
import { listCrmRoles, seedCrmSystemRoles } from '@src/repos/crm/CrmRolesRepo.js'
import { CRM_PERMISSIONS } from '@src/domains/crm/permissions.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'

const ok = () => ({ ok: true, error: null })
const fail = (error: string) => ({ ok: false, error })

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

/**
 * Records the change against the admin who made it.
 *
 * `admin:<id>`, never `crm:<id>` — "who created this login" has to point at the
 * admin panel, because the person who did it has no CRM account at all.
 */
function audit(
  scope: CrmAdminScope,
  action: string,
  resourceId: string,
  before?: Record<string, unknown>
): void {
  recordAuditDb({
    tenant: scope.tenant,
    actorId: `admin:${scope.actorId}`,
    domain: 'crm.users',
    action,
    resourceType: 'crm_user',
    resourceId,
    before: before ?? null,
  }).catch(() => {})
}

/**
 * Refuses a target that is not in the scoped whitelabel.
 *
 * Every repository call below already carries the tenant, so this is not the
 * only thing standing between a caller and another whitelabel's user. It is
 * here so the *response* is the same "User not found" whether the id is
 * unknown or merely out of reach — an id from another tenant must not be
 * confirmable as real.
 */
async function assertInScope(scope: CrmAdminScope, id: string): Promise<boolean> {
  const row = await getCrmUserById(scope.tenant, id)
  return !!row
}

export const adminCrmUserQueries = {
  /**
   * The whitelabel's CRM users, with seat usage.
   *
   * Readable even when the CRM is switched off: an administrator looking at a
   * disabled CRM should see what exists and be told why nothing can change,
   * rather than an empty screen that looks like data loss.
   */
  whitelabelCrmUsers: async (_: unknown, args: { tenant?: string | null }, ctx: any) => {
    const scope = await assertCrmAdminSurface(ctx, args.tenant)
    const [rows, settings, used] = await Promise.all([
      listCrmUsers(scope.tenant),
      getCrmSettings(scope.tenant),
      countCrmSeats(scope.tenant),
    ])
    return {
      tenant: scope.tenant,
      enabled: settings?.enabled ?? false,
      seatLimit: settings?.seatLimit ?? 0,
      seatsUsed: used,
      canChooseTenant: scope.isSuperAdmin,
      users: await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          name: r.name,
          username: r.username,
          email: r.email,
          phone: r.phone,
          status: r.status,
          requirePasswordReset: r.requirePasswordReset,
          lastLoginAt: iso(r.lastLoginAt),
          lastSeenAt: iso(r.lastSeenAt),
          createdAt: iso(r.createdAt),
          roleNames: r.roleNames,
          roleIds: await getCrmUserRoleIds(r.id),
        }))
      ),
    }
  },

  /** The roles a user may be given. Seeded on first read so the list is never empty. */
  whitelabelCrmRoles: async (_: unknown, args: { tenant?: string | null }, ctx: any) => {
    const scope = await assertCrmAdminSurface(ctx, args.tenant)
    const settings = await getCrmSettings(scope.tenant)
    if (!settings?.enabled) return []
    await seedCrmSystemRoles(scope.tenant)
    const roles = await listCrmRoles(scope.tenant)
    const catalog = new Map(
      CRM_PERMISSIONS.flatMap((g) => g.actions.map((a) => [`${a.domain}:${a.action}`, a]))
    )
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      userCount: r.userCount,
      permissions: r.permissions
        .map((p) => catalog.get(`${p.domain}:${p.action}`))
        .filter((p): p is NonNullable<typeof p> => !!p),
    }))
  },
}

export const adminCrmUserMutations = {
  whitelabelCrmCreateUser: async (
    _: unknown,
    args: {
      tenant?: string | null
      input: {
        name: string
        username: string
        password: string
        email?: string
        phone?: string
        roleIds?: string[]
      }
    },
    ctx: any
  ) => {
    const scope = await assertCrmAdminSurface(ctx, args.tenant)
    await assertCrmEnabled(scope.tenant)
    const input = args.input

    const invalid = checkCrmPassword(input.password)
    if (invalid) return fail(invalid)
    if (!input.username?.trim()) return fail('Username is required')
    if (!input.name?.trim()) return fail('Name is required')
    if (await crmUsernameExists(scope.tenant, input.username)) {
      return fail('That username is already taken')
    }

    // A whitelabel that has never opened its CRM has no roles yet, and a user
    // with no role can sign in and do nothing.
    await seedCrmSystemRoles(scope.tenant)

    const hash = await hashCrmPassword(input.password)
    // Seat claimed and user created in one transaction, so two administrators
    // creating at once cannot both pass through the same free seat.
    const { claim, result } = await reserveCrmSeat(scope.tenant, (tx) =>
      insertCrmUser(tx, {
        tenant: scope.tenant,
        name: input.name.trim(),
        email: input.email ?? null,
        phone: input.phone ?? null,
        username: input.username,
        passwordHash: hash,
        roleIds: input.roleIds ?? [],
        createdBy: `admin:${scope.actorId}`,
      })
    )

    if (!claim.ok) {
      return fail(
        claim.reason === 'crm_disabled'
          ? 'The CRM is not enabled for this whitelabel'
          : `Seat limit reached (${claim.used} of ${claim.limit}). A Super Admin can raise it.`
      )
    }

    audit(scope, 'create_user', result!.id, { username: input.username, roleIds: input.roleIds ?? [] })
    return ok()
  },

  whitelabelCrmUpdateUser: async (
    _: unknown,
    args: {
      tenant?: string | null
      input: { id: string; name?: string; email?: string; phone?: string }
    },
    ctx: any
  ) => {
    const scope = await assertCrmAdminSurface(ctx, args.tenant)
    await assertCrmEnabled(scope.tenant)
    const row = await updateCrmUser(scope.tenant, args.input.id, {
      name: args.input.name,
      email: args.input.email,
      phone: args.input.phone,
    })
    if (!row) return fail('User not found')
    audit(scope, 'update_user', args.input.id)
    return ok()
  },

  /**
   * Suspend, deactivate or reinstate.
   *
   * There is no "you cannot do this to yourself" guard here, unlike the CRM's
   * own version. That guard exists there because a CRM administrator
   * suspending themselves is locked out of the screen they did it from; an
   * admin-panel caller is not a CRM user, so there is no self to protect — and
   * this surface is the way back in if the last CRM administrator is stopped.
   */
  whitelabelCrmSetUserStatus: async (
    _: unknown,
    args: { tenant?: string | null; id: string; status: string },
    ctx: any
  ) => {
    const scope = await assertCrmAdminSurface(ctx, args.tenant)
    await assertCrmEnabled(scope.tenant)
    const status = String(args.status).toUpperCase() as CrmUserStatus
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) return fail('Unknown status')
    const row = await setCrmUserStatus(scope.tenant, args.id, status)
    if (!row) return fail('User not found')
    audit(scope, 'set_user_status', args.id, { status })
    return ok()
  },

  whitelabelCrmResetPassword: async (
    _: unknown,
    args: { tenant?: string | null; id: string; newPassword: string },
    ctx: any
  ) => {
    const scope = await assertCrmAdminSurface(ctx, args.tenant)
    await assertCrmEnabled(scope.tenant)
    const invalid = checkCrmPassword(args.newPassword)
    if (invalid) return fail(invalid)
    if (!(await assertInScope(scope, args.id))) return fail('User not found')

    const hash = await hashCrmPassword(args.newPassword)
    // `requireReset` so the password an administrator typed — and therefore
    // knows, and probably sent over chat — cannot stay in use.
    const done = await setCrmUserPassword(scope.tenant, args.id, hash, { requireReset: true })
    if (!done) return fail('User not found')
    audit(scope, 'reset_user_password', args.id)
    return ok()
  },

  whitelabelCrmSetUserRoles: async (
    _: unknown,
    args: { tenant?: string | null; id: string; roleIds: string[] },
    ctx: any
  ) => {
    const scope = await assertCrmAdminSurface(ctx, args.tenant)
    await assertCrmEnabled(scope.tenant)
    const done = await setCrmUserRoles(scope.tenant, args.id, args.roleIds ?? [])
    if (!done) return fail('User not found')
    audit(scope, 'set_user_roles', args.id, { roleIds: args.roleIds })
    return ok()
  },

  /**
   * Removes the account outright.
   *
   * Every foreign key into `crm_users` is CASCADE or SET NULL, so this always
   * succeeds — but `crm_pii_access_log.crm_user_id` is one of the SET NULLs and
   * that table does not snapshot the name, so deleting a user permanently
   * anonymises the record of every player whose contact details they read.
   * Notes and contact attempts survive intact because both store the author's
   * name alongside the id. The UI leads with suspension for this reason.
   */
  whitelabelCrmDeleteUser: async (
    _: unknown,
    args: { tenant?: string | null; id: string },
    ctx: any
  ) => {
    const scope = await assertCrmAdminSurface(ctx, args.tenant)
    await assertCrmEnabled(scope.tenant)
    // Read before deleting so the audit row can name who was removed — the
    // account itself is gone by the time the row is written. Username lives in
    // `crm_user_credentials` and goes with the cascade, so the name is what
    // there is to keep.
    const target = await getCrmUserById(scope.tenant, args.id)
    if (!target) return fail('User not found')
    const done = await deleteCrmUser(scope.tenant, args.id)
    if (!done) return fail('User not found')
    audit(scope, 'delete_user', args.id, { name: target.name, status: target.status })
    return ok()
  },
}
