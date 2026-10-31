import {
  crmLogin,
  buildCrmAuthContext,
  hashCrmPassword,
  CRM_LOGIN_FAILED_MESSAGE,
} from '@src/domains/crm/services/CrmAuthService.js'
import {
  crmClientIp,
  requireCrmPermission,
  requireCrmUser,
  requireCrmWrite,
  type CrmContext,
} from '@src/domains/crm/guards.js'
import {
  getCrmSettings,
  upsertCrmSettings,
  reserveCrmSeat,
  countCrmSeats,
} from '@src/repos/crm/CrmSettingsRepo.js'
import {
  insertCrmUser,
  updateCrmUser,
  setCrmUserStatus,
  setCrmUserPassword,
  setCrmUserRoles,
  deleteCrmUser,
  setCrmUserAvailability,
  crmUsernameExists,
  getCrmUserById,
  type CrmUserStatus,
} from '@src/repos/crm/CrmUsersRepo.js'
import {
  createCrmRole,
  updateCrmRole,
  deleteCrmRole,
  seedCrmSystemRoles,
  reconcileCrmSystemRoles,
  listCrmRoles,
} from '@src/repos/crm/CrmRolesRepo.js'
import {
  createCrmBook,
  updateCrmBook,
  deleteCrmBook,
  setCrmBookMembers,
  assignPlayersToBook,
  unassignPlayers,
} from '@src/repos/crm/CrmBooksRepo.js'
import {
  addCrmIpAllowlistEntry,
  removeCrmIpAllowlistEntry,
} from '@src/repos/crm/CrmSecurityRepo.js'
import { verifyPassword } from '@src/domains/common/auth.js'
import { checkCrmPassword } from '@src/domains/crm/crmPasswordPolicy.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  clearLoginAttempts,
} from '@src/middleware/loginRateLimiter.js'

const ok = () => ({ ok: true, error: null })
const fail = (error: string) => ({ ok: false, error })

// The policy itself lives in `crmPasswordPolicy.ts` so the admin panel's CRM
// user management applies exactly this rule rather than its own copy of it.
const checkPassword = checkCrmPassword

function isSuperAdmin(ctx: any): boolean {
  const roles: string[] = ctx?.user?.roles ?? []
  return roles.some(
    (r) =>
      r === 'Super Admin' ||
      r.toLowerCase() === 'super_admin' ||
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
  )
}

/** Records a CRM write in the platform's own audit trail, alongside admin writes. */
function auditCrm(
  ctx: CrmContext,
  action: string,
  resourceType: string,
  resourceId: string,
  detail?: Record<string, unknown>
): void {
  const user = ctx?.crmUser
  if (!user) return
  recordAuditDb({
    tenant: user.tenant,
    actorId: `crm:${user.id}`,
    domain: 'crm',
    action,
    resourceType,
    resourceId,
    before: detail ?? null,
  }).catch(() => {})
}

export const crmMutations = {
  /**
   * The tenant comes from the request host, never from the request body.
   * A username and password alone must not be able to select which
   * whitelabel's desk they open.
   */
  crmLogin: async (_: unknown, args: { username: string; password: string }, ctx: any) => {
    const tenant = String(ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const req = ctx?.request
    const ip = crmClientIp(ctx) ?? 'unknown'
    const identifier = String(args.username ?? '').trim().toLowerCase() || 'unknown'

    // The same brute-force budget the admin and agent logins use: a few tries
    // per account, and a wider one per address so spraying a single password
    // across many usernames is not free. It sits in front of the per-account
    // lockout in crm_user_credentials rather than replacing it.
    checkLoginRateLimit(ip, identifier)

    const result = await crmLogin({
      tenant,
      username: String(args.username ?? ''),
      password: String(args.password ?? ''),
      ipAddress: crmClientIp(ctx),
      userAgent: typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    })

    if (!result.ok) {
      recordFailedLoginAttempt(ip, identifier)
      // Every failure reads the same. The reason is already in crm_login_attempts.
      return { ok: false, token: null, error: CRM_LOGIN_FAILED_MESSAGE, me: null }
    }
    clearLoginAttempts(ip, identifier)

    const settings = await getCrmSettings(tenant)
    return {
      ok: true,
      token: result.token,
      error: null,
      me: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        status: result.user.status,
        requirePasswordReset: result.user.requirePasswordReset,
        tenant,
        whitelabelName: ctx?.whitelabel?.name ?? null,
        permissions: result.permissions,
        bookIds: [],
        canViewAllPlayers: result.permissions.some(
          (p) => p.domain === 'crm.players' && (p.actions.includes('view_all') || p.actions.includes('*'))
        ),
        sessionIdleMinutes: settings?.sessionIdleMinutes ?? 60,
      },
    }
  },

  crmChangeOwnPassword: async (
    _: unknown,
    args: { currentPassword: string; newPassword: string },
    ctx: CrmContext
  ) => {
    const user = requireCrmUser(ctx)
    const invalid = checkPassword(args.newPassword)
    if (invalid) return fail(invalid)

    // Re-authenticate. Holding a valid session is not the same as proving you
    // are the person it belongs to — an unattended desk is the usual case.
    const { db } = await import('@src/db/client.js')
    const { crmUserCredentials } = await import('@shared/db/schema.js')
    const { eq } = await import('drizzle-orm')
    const [cred] = await db
      .select()
      .from(crmUserCredentials)
      .where(eq(crmUserCredentials.crmUserId, user.id))
      .limit(1)
    if (!cred) return fail('Account not found')
    if (!(await verifyPassword(args.currentPassword, cred.passwordHash))) {
      return fail('Current password is incorrect')
    }

    const hash = await hashCrmPassword(args.newPassword)
    await setCrmUserPassword(user.tenant, user.id, hash, { requireReset: false })
    auditCrm(ctx, 'change_own_password', 'crm_user', user.id)
    return ok()
  },

  crmCreateUser: async (
    _: unknown,
    args: {
      input: {
        name: string
        username: string
        password: string
        email?: string
        phone?: string
        roleIds?: string[]
      }
    },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.users', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const input = args.input

    const invalid = checkPassword(input.password)
    if (invalid) return fail(invalid)
    if (!input.username?.trim()) return fail('Username is required')
    if (!input.name?.trim()) return fail('Name is required')
    if (await crmUsernameExists(actor.tenant, input.username)) {
      return fail('That username is already taken')
    }

    const hash = await hashCrmPassword(input.password)
    // The seat is claimed and the user created in one transaction, so
    // simultaneous creates cannot both pass through the same free seat.
    const { claim, result } = await reserveCrmSeat(actor.tenant, (tx) =>
      insertCrmUser(tx, {
        tenant: actor.tenant,
        name: input.name.trim(),
        email: input.email ?? null,
        phone: input.phone ?? null,
        username: input.username,
        passwordHash: hash,
        roleIds: input.roleIds ?? [],
        createdBy: `crm:${actor.id}`,
      })
    )

    if (!claim.ok) {
      return fail(
        claim.reason === 'crm_disabled'
          ? 'The CRM is not enabled for this whitelabel'
          : `Seat limit reached (${claim.used} of ${claim.limit})`
      )
    }
    auditCrm(ctx, 'create_user', 'crm_user', result!.id, { username: input.username })
    return ok()
  },

  crmUpdateUser: async (
    _: unknown,
    args: { input: { id: string; name?: string; email?: string; phone?: string } },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.users', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const row = await updateCrmUser(actor.tenant, args.input.id, {
      name: args.input.name,
      email: args.input.email,
      phone: args.input.phone,
    })
    if (!row) return fail('User not found')
    auditCrm(ctx, 'update_user', 'crm_user', args.input.id)
    return ok()
  },

  crmSetUserStatus: async (_: unknown, args: { id: string; status: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.users', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const status = String(args.status).toUpperCase() as CrmUserStatus
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) return fail('Unknown status')
    // Suspending yourself locks you out of the screen you did it from, and if
    // you were the only administrator, locks out the whole whitelabel.
    if (args.id === actor.id && status !== 'ACTIVE') {
      return fail('You cannot suspend your own account')
    }
    const row = await setCrmUserStatus(actor.tenant, args.id, status)
    if (!row) return fail('User not found')
    auditCrm(ctx, 'set_user_status', 'crm_user', args.id, { status })
    return ok()
  },

  crmResetUserPassword: async (
    _: unknown,
    args: { id: string; newPassword: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.users', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const invalid = checkPassword(args.newPassword)
    if (invalid) return fail(invalid)
    const hash = await hashCrmPassword(args.newPassword)
    const done = await setCrmUserPassword(actor.tenant, args.id, hash, { requireReset: true })
    if (!done) return fail('User not found')
    auditCrm(ctx, 'reset_user_password', 'crm_user', args.id)
    return ok()
  },

  crmSetUserRoles: async (_: unknown, args: { id: string; roleIds: string[] }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.users', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const done = await setCrmUserRoles(actor.tenant, args.id, args.roleIds ?? [])
    if (!done) return fail('User not found')
    auditCrm(ctx, 'set_user_roles', 'crm_user', args.id, { roleIds: args.roleIds })
    return ok()
  },

  crmDeleteUser: async (_: unknown, args: { id: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.users', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    if (args.id === actor.id) return fail('You cannot delete your own account')
    const done = await deleteCrmUser(actor.tenant, args.id)
    if (!done) return fail('User not found')
    auditCrm(ctx, 'delete_user', 'crm_user', args.id)
    return ok()
  },

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------

  /**
   * A user marks themselves away.
   *
   * Their own record only — covering for someone is a thing you arrange, not a
   * thing you can be volunteered for, and letting one user redirect another's
   * escalations would be a way to make work quietly disappear.
   */
  crmSetMyAvailability: async (
    _: unknown,
    args: { outOfOfficeUntil?: string | null; delegateTo?: string | null },
    ctx: CrmContext
  ) => {
    const user = requireCrmUser(ctx)
    requireCrmWrite(ctx)

    let until: Date | null = null
    if (args.outOfOfficeUntil) {
      until = new Date(args.outOfOfficeUntil)
      if (Number.isNaN(until.getTime())) return { ok: false, error: 'That is not a date' }
    }

    const res = await setCrmUserAvailability(user.tenant, user.id, {
      outOfOfficeUntil: until,
      delegateTo: args.delegateTo ?? null,
    })
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.reason === 'self_delegate'
            ? 'You cannot delegate to yourself'
            : res.reason === 'delegate_not_found'
              ? 'That person is not an active user here'
              : res.reason === 'delegate_cannot_escalate'
                ? 'That person cannot receive escalations — they need the escalate permission first'
                : 'User not found',
      }
    }
    auditCrm(ctx, 'set_availability', 'crm_user', user.id, {
      outOfOfficeUntil: args.outOfOfficeUntil ?? null,
      delegateTo: args.delegateTo ?? null,
    })
    return { ok: true, error: null }
  },

  crmCreateRole: async (
    _: unknown,
    args: { name: string; description?: string; permissions: Array<{ domain: string; action: string }> },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.roles', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    if (!args.name?.trim()) return fail('Role name is required')
    const existing = await listCrmRoles(actor.tenant)
    if (existing.some((r) => r.name.toLowerCase() === args.name.trim().toLowerCase())) {
      return fail('A role with that name already exists')
    }
    const role = await createCrmRole({
      tenant: actor.tenant,
      name: args.name,
      description: args.description ?? null,
      permissions: args.permissions ?? [],
    })
    auditCrm(ctx, 'create_role', 'crm_role', role.id, { name: args.name })
    return ok()
  },

  crmUpdateRole: async (
    _: unknown,
    args: {
      id: string
      name?: string
      description?: string
      permissions?: Array<{ domain: string; action: string }>
    },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.roles', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const res = await updateCrmRole(actor.tenant, args.id, {
      name: args.name,
      description: args.description,
      permissions: args.permissions,
    })
    if (!res.ok) {
      return fail(
        res.reason === 'system_role_needs_permissions'
          ? 'The CRM Administrator role cannot be left with no permissions'
          : 'Role not found'
      )
    }
    auditCrm(ctx, 'update_role', 'crm_role', args.id)
    return ok()
  },

  crmDeleteRole: async (_: unknown, args: { id: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.roles', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const res = await deleteCrmRole(actor.tenant, args.id)
    if (!res.ok) {
      return fail(
        res.reason === 'system_role'
          ? 'This role is built in and cannot be deleted'
          : res.reason === 'in_use'
            ? 'Remove this role from its users before deleting it'
            : 'Role not found'
      )
    }
    auditCrm(ctx, 'delete_role', 'crm_role', args.id)
    return ok()
  },

  // -------------------------------------------------------------------------
  // Books and assignment
  // -------------------------------------------------------------------------

  crmCreateBook: async (_: unknown, args: { name: string; description?: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.books', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    if (!args.name?.trim()) return fail('Book name is required')
    const book = await createCrmBook({
      tenant: actor.tenant,
      name: args.name,
      description: args.description ?? null,
    })
    auditCrm(ctx, 'create_book', 'crm_book', book.id, { name: args.name })
    return ok()
  },

  crmUpdateBook: async (
    _: unknown,
    args: { id: string; name?: string; description?: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.books', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const row = await updateCrmBook(actor.tenant, args.id, {
      name: args.name,
      description: args.description,
    })
    if (!row) return fail('Book not found')
    auditCrm(ctx, 'update_book', 'crm_book', args.id)
    return ok()
  },

  crmDeleteBook: async (_: unknown, args: { id: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.books', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const res = await deleteCrmBook(actor.tenant, args.id)
    if (!res.ok) {
      return fail(
        res.reason === 'has_players'
          ? `Move its ${res.playerCount} player(s) to another book first`
          : 'Book not found'
      )
    }
    auditCrm(ctx, 'delete_book', 'crm_book', args.id)
    return ok()
  },

  crmSetBookMembers: async (
    _: unknown,
    args: { bookId: string; crmUserIds: string[] },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.books', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const done = await setCrmBookMembers(actor.tenant, args.bookId, args.crmUserIds ?? [])
    if (!done) return fail('Book not found')
    auditCrm(ctx, 'set_book_members', 'crm_book', args.bookId, { members: args.crmUserIds })
    return ok()
  },

  /**
   * Moves players between desks.
   *
   * Deliberately checks tenant but not book scope, unlike every other by-id
   * path in the CRM. Moving players between books *is* what
   * `crm.books:manage` means — the catalogue says so — and requiring the
   * caller to already see a player would make the permission unable to do its
   * job: you cannot reassign someone away from a desk you are not on.
   *
   * Nor would the check close anything. The same permission carries
   * `crmSetBookMembers`, so its holder can add themselves to any book and see
   * every player in it directly. `crm.books:manage` confers whitelabel-wide
   * player visibility by design; a scope check here would be theatre.
   */
  crmAssignPlayers: async (
    _: unknown,
    args: { playerIds: string[]; bookId: string; ownerId?: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.books', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const ids = (args.playerIds ?? []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)
    if (ids.length === 0) return fail('No players selected')

    // The book must belong to this tenant. Without this check a crafted book id
    // would move another whitelabel's desk assignments.
    const { listCrmBooks } = await import('@src/repos/crm/CrmBooksRepo.js')
    const books = await listCrmBooks(actor.tenant)
    if (!books.some((b) => b.id === args.bookId)) return fail('Book not found')

    // And the players must belong to this tenant.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const res = await db.execute(
      sql`SELECT id FROM users WHERE tenant = ${actor.tenant} AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `
      )})`
    )
    const valid = (res.rows as Array<{ id: number }>).map((r) => Number(r.id))
    if (valid.length === 0) return fail('No matching players in this whitelabel')

    // And so must the named owner. `crm_users.id` has no tenant component, and
    // the player list renders `owner_name` by joining that id — so a
    // well-formed id from elsewhere put another whitelabel's user's name on
    // this whitelabel's players. Verified by execution: the foreign name
    // rendered in `ownerName`.
    if (args.ownerId) {
      const owner = await getCrmUserById(actor.tenant, args.ownerId)
      if (!owner) return fail('That owner is not a user here')
    }

    const n = await assignPlayersToBook({
      tenant: actor.tenant,
      playerIds: valid,
      bookId: args.bookId,
      ownerId: args.ownerId ?? null,
      assignedBy: `crm:${actor.id}`,
    })

    // Open work follows the player. Leaving it behind strands it with a desk
    // that no longer holds them, and hides it from the one that now does.
    const { movePlayerTasksToBook } = await import('@src/repos/crm/CrmTasksRepo.js')
    let movedTasks = 0
    for (const playerId of valid) {
      movedTasks += await movePlayerTasksToBook({
        tenant: actor.tenant,
        playerId,
        bookId: args.bookId,
        actor: `crm:${actor.id}`,
      })
    }
    auditCrm(ctx, 'assign_players', 'crm_book', args.bookId, { count: n, movedTasks })
    return ok()
  },

  crmUnassignPlayers: async (_: unknown, args: { playerIds: string[] }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.books', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const ids = (args.playerIds ?? []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)
    if (ids.length === 0) return fail('No players selected')
    const n = await unassignPlayers(actor.tenant, ids)
    auditCrm(ctx, 'unassign_players', 'crm_player_assignment', String(n), { count: n })
    return ok()
  },

  // -------------------------------------------------------------------------
  // Session security
  // -------------------------------------------------------------------------

  crmAddIpAllowlistEntry: async (
    _: unknown,
    args: { crmUserId: string; cidr: string; label?: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.security', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const cidr = String(args.cidr ?? '').trim()
    if (!/^[0-9a-fA-F:.]+(\/[0-9]{1,3})?$/.test(cidr)) {
      return fail('Enter an address or range, e.g. 203.0.113.7 or 203.0.113.0/24')
    }
    // The user must be in this tenant; otherwise this writes an allowlist entry
    // against someone else's CRM account.
    const target = await getCrmUserById(actor.tenant, args.crmUserId)
    if (!target) return fail('User not found')

    await addCrmIpAllowlistEntry({
      tenant: actor.tenant,
      crmUserId: args.crmUserId,
      cidr,
      label: args.label ?? null,
    })
    auditCrm(ctx, 'add_ip_allowlist', 'crm_user', args.crmUserId, { cidr })
    return ok()
  },

  crmRemoveIpAllowlistEntry: async (_: unknown, args: { id: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.security', 'manage')
    requireCrmWrite(ctx)
    const actor = requireCrmUser(ctx)
    const done = await removeCrmIpAllowlistEntry(actor.tenant, args.id)
    if (!done) return fail('Entry not found')
    auditCrm(ctx, 'remove_ip_allowlist', 'crm_ip_allowlist', args.id)
    return ok()
  },

  // -------------------------------------------------------------------------
  // Run from the admin panel, not the CRM
  // -------------------------------------------------------------------------

  /**
   * Super Admin's gate. Enabling a whitelabel also seeds its starting roles, so
   * the first administrator has something to be given; the seed is idempotent,
   * so toggling the CRM off and on again does not duplicate or reset them.
   */
  setCrmWhitelabelSettings: async (
    _: unknown,
    args: {
      tenant: string
      enabled: boolean
      seatLimit: number
      sessionIdleMinutes?: number
      enforceIpAllowlist?: boolean
    },
    ctx: any
  ) => {
    if (!isSuperAdmin(ctx)) throw new Error('Only a Super Admin can change CRM access.')
    const tenant = String(args.tenant ?? '').trim()
    if (!tenant) throw new Error('A whitelabel must be named.')
    const seatLimit = Math.max(0, Math.floor(Number(args.seatLimit) || 0))

    const settings = await upsertCrmSettings({
      tenant,
      enabled: !!args.enabled,
      seatLimit,
      sessionIdleMinutes: args.sessionIdleMinutes,
      enforceIpAllowlist: args.enforceIpAllowlist,
      updatedBy: String(ctx?.user?.sub ?? 'unknown'),
    })
    // Reconcile, not seed. A tenant enabled under an earlier catalogue would
    // otherwise never receive permissions added later, and the feature they gate
    // would ship held by nobody.
    if (settings.enabled) await reconcileCrmSystemRoles(tenant)

    recordAuditDb({
      tenant,
      actorId: String(ctx?.user?.sub ?? 'unknown'),
      domain: 'crm.settings',
      action: 'set_crm_access',
      resourceType: 'whitelabel',
      resourceId: tenant,
      before: { enabled: settings.enabled, seatLimit: settings.seatLimit },
    }).catch(() => {})

    return {
      ...settings,
      seatsUsed: await countCrmSeats(tenant),
      updatedAt: settings.updatedAt.toISOString(),
    }
  },

  /**
   * Creates a CRM administrator from the admin panel.
   *
   * This exists to start a whitelabel off, and to recover one that has locked
   * itself out — not as a second way to create CRM users. It is therefore
   * refused whenever the whitelabel still has an active user who can manage
   * users; otherwise it would be a route around the CRM's own permissions,
   * reachable by anyone with admin-panel access.
   */
  crmCreateFirstAdmin: async (
    _: unknown,
    args: { tenant: string; name: string; username: string; password: string; email?: string },
    ctx: any
  ) => {
    if (!ctx?.user) throw new Error('Unauthorized: authentication required')
    const tenant = String(args.tenant ?? '').trim()
    if (!tenant) return fail('A whitelabel must be named')

    // Super Admin may do this for any whitelabel. Anyone else, only their own.
    if (!isSuperAdmin(ctx)) {
      const own = String(ctx?.tenant ?? ctx?.whitelabel?.id ?? '')
      if (own !== tenant) return fail('You can only do this for your own whitelabel')
      const { hasPermission } = await import('@src/domains/common/auth.js')
      if (!hasPermission(ctx?.permissions ?? [], 'config', 'write')) {
        return fail('You do not have permission to configure the CRM')
      }
    }

    const settings = await getCrmSettings(tenant)
    if (!settings || !settings.enabled) return fail('The CRM is not enabled for this whitelabel')

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const recoverable = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM crm_users u
      WHERE u.tenant = ${tenant} AND u.status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM crm_user_roles ur
          JOIN crm_role_permissions rp ON rp.role_id = ur.role_id
          WHERE ur.crm_user_id = u.id AND rp.domain = 'crm.users' AND rp.action = 'manage'
        )
    `)
    const activeAdmins = Number((recoverable.rows[0] as { n: number } | undefined)?.n ?? 0)
    if (activeAdmins > 0) {
      return fail('This whitelabel already has an active CRM administrator. Create further users inside the CRM.')
    }

    const invalid = checkPassword(args.password)
    if (invalid) return fail(invalid)
    if (!args.username?.trim()) return fail('Username is required')
    if (await crmUsernameExists(tenant, args.username)) return fail('That username is already taken')

    await seedCrmSystemRoles(tenant)
    const roles = await listCrmRoles(tenant)
    const adminRole = roles.find((r) => r.isSystem)
    if (!adminRole) return fail('The CRM Administrator role is missing for this whitelabel')

    const hash = await hashCrmPassword(args.password)
    const { claim, result } = await reserveCrmSeat(tenant, (tx) =>
      insertCrmUser(tx, {
        tenant,
        name: args.name.trim(),
        email: args.email ?? null,
        username: args.username,
        passwordHash: hash,
        roleIds: [adminRole.id],
        createdBy: `admin:${ctx?.user?.sub ?? 'unknown'}`,
      })
    )
    if (!claim.ok) {
      return fail(
        claim.reason === 'crm_disabled'
          ? 'The CRM is not enabled for this whitelabel'
          : `Seat limit reached (${claim.used} of ${claim.limit})`
      )
    }

    recordAuditDb({
      tenant,
      actorId: String(ctx?.user?.sub ?? 'unknown'),
      domain: 'crm.settings',
      action: 'create_first_admin',
      resourceType: 'crm_user',
      resourceId: result!.id,
      before: { username: args.username, priorActiveAdmins: activeAdmins },
    }).catch(() => {})

    return ok()
  },
}
