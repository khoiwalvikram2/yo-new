import { db } from '@src/db/client.js'
import {
  crmUsers,
  crmUserCredentials,
  crmRoles,
  crmRolePermissions,
  crmUserRoles,
} from '@shared/db/schema.js'
import { and, eq, sql, desc, inArray } from 'drizzle-orm'

export type CrmUserRow = typeof crmUsers.$inferSelect
export type CrmUserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

/** Usernames are compared case-insensitively; store what was typed, match on lower(). */
export function normalizeCrmUsername(raw: string): string {
  return String(raw ?? '').trim()
}

export async function findCrmUserByUsername(
  tenant: string,
  username: string
): Promise<{ user: CrmUserRow; credentials: typeof crmUserCredentials.$inferSelect } | null> {
  const uname = normalizeCrmUsername(username)
  if (!uname) return null
  const [row] = await db
    .select({ user: crmUsers, credentials: crmUserCredentials })
    .from(crmUserCredentials)
    .innerJoin(crmUsers, eq(crmUsers.id, crmUserCredentials.crmUserId))
    .where(
      and(
        eq(crmUserCredentials.tenant, tenant),
        sql`lower(${crmUserCredentials.username}) = lower(${uname})`
      )
    )
    .limit(1)
  return row ?? null
}

export async function getCrmUserById(tenant: string, id: string): Promise<CrmUserRow | null> {
  const [row] = await db
    .select()
    .from(crmUsers)
    .where(and(eq(crmUsers.tenant, tenant), eq(crmUsers.id, id)))
    .limit(1)
  return row ?? null
}

/**
 * The permissions a CRM user holds, as the union of their roles, in the
 * `{ domain, actions[] }` shape the platform's `hasPermission` already speaks.
 *
 * A user with no roles gets an empty list, which denies everything. There is no
 * implicit baseline: a CRM user who was created but never given a role can sign
 * in and see nothing, which is the safe reading of "not configured yet".
 */
export async function getCrmUserPermissions(
  crmUserId: string
): Promise<Array<{ domain: string; actions: string[] }>> {
  const rows = await db
    .select({ domain: crmRolePermissions.domain, action: crmRolePermissions.action })
    .from(crmUserRoles)
    .innerJoin(crmRolePermissions, eq(crmRolePermissions.roleId, crmUserRoles.roleId))
    .where(eq(crmUserRoles.crmUserId, crmUserId))

  const byDomain = new Map<string, Set<string>>()
  for (const r of rows) {
    let set = byDomain.get(r.domain)
    if (!set) {
      set = new Set()
      byDomain.set(r.domain, set)
    }
    set.add(r.action)
  }
  return [...byDomain.entries()].map(([domain, actions]) => ({ domain, actions: [...actions] }))
}

export async function listCrmUsers(tenant: string): Promise<
  Array<CrmUserRow & { username: string | null; roleNames: string[] }>
> {
  const rows = await db
    .select({ user: crmUsers, username: crmUserCredentials.username })
    .from(crmUsers)
    .leftJoin(crmUserCredentials, eq(crmUserCredentials.crmUserId, crmUsers.id))
    .where(eq(crmUsers.tenant, tenant))
    .orderBy(desc(crmUsers.createdAt))

  if (rows.length === 0) return []

  const ids = rows.map((r) => r.user.id)
  const roleRows = await db
    .select({ crmUserId: crmUserRoles.crmUserId, name: crmRoles.name })
    .from(crmUserRoles)
    .innerJoin(crmRoles, eq(crmRoles.id, crmUserRoles.roleId))
    .where(inArray(crmUserRoles.crmUserId, ids))

  const rolesByUser = new Map<string, string[]>()
  for (const r of roleRows) {
    const list = rolesByUser.get(r.crmUserId) ?? []
    list.push(r.name)
    rolesByUser.set(r.crmUserId, list)
  }

  return rows.map((r) => ({
    ...r.user,
    username: r.username ?? null,
    roleNames: rolesByUser.get(r.user.id) ?? [],
  }))
}

export async function getCrmUserRoleIds(crmUserId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: crmUserRoles.roleId })
    .from(crmUserRoles)
    .where(eq(crmUserRoles.crmUserId, crmUserId))
  return rows.map((r) => r.roleId)
}

/** True when the username is already taken in this tenant. Case-insensitive. */
export async function crmUsernameExists(tenant: string, username: string): Promise<boolean> {
  const uname = normalizeCrmUsername(username)
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(crmUserCredentials)
    .where(
      and(
        eq(crmUserCredentials.tenant, tenant),
        sql`lower(${crmUserCredentials.username}) = lower(${uname})`
      )
    )
    .limit(1)
  return !!row
}

export async function recordCrmLoginSuccess(crmUserId: string): Promise<void> {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(crmUsers)
      .set({ lastLoginAt: now, lastSeenAt: now })
      .where(eq(crmUsers.id, crmUserId))
    await tx
      .update(crmUserCredentials)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(crmUserCredentials.crmUserId, crmUserId))
  })
}

/**
 * Counts a failed attempt and locks the account once they pile up.
 *
 * The counter increments in SQL rather than being read and written back, so
 * simultaneous guesses each count. A lockout is a delay, not a ban: it clears
 * on its own, because a permanent lock on failed passwords is a way for anyone
 * who knows a username to deny that person their account.
 */
export async function recordCrmLoginFailure(
  crmUserId: string,
  opts: { maxAttempts: number; lockMinutes: number }
): Promise<{ locked: boolean }> {
  const [row] = await db
    .update(crmUserCredentials)
    .set({
      failedAttempts: sql`${crmUserCredentials.failedAttempts} + 1`,
      lockedUntil: sql`
        CASE WHEN ${crmUserCredentials.failedAttempts} + 1 >= ${opts.maxAttempts}
             THEN now() + (${opts.lockMinutes} || ' minutes')::interval
             ELSE ${crmUserCredentials.lockedUntil} END`,
    })
    .where(eq(crmUserCredentials.crmUserId, crmUserId))
    .returning({ lockedUntil: crmUserCredentials.lockedUntil })
  return { locked: !!row?.lockedUntil && row.lockedUntil.getTime() > Date.now() }
}

export async function touchCrmUserSeen(crmUserId: string): Promise<void> {
  await db.update(crmUsers).set({ lastSeenAt: new Date() }).where(eq(crmUsers.id, crmUserId))
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Any drizzle handle — the live db, or a transaction when a seat is being claimed. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function insertCrmUser(
  exec: Executor,
  input: {
    tenant: string
    name: string
    email?: string | null
    phone?: string | null
    username: string
    passwordHash: string
    roleIds: string[]
    createdBy?: string | null
  }
): Promise<CrmUserRow> {
  const [user] = await exec
    .insert(crmUsers)
    .values({
      tenant: input.tenant,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      status: 'ACTIVE',
      requirePasswordReset: true,
      createdBy: input.createdBy ?? null,
    })
    .returning()

  await exec.insert(crmUserCredentials).values({
    crmUserId: user.id,
    tenant: input.tenant,
    username: normalizeCrmUsername(input.username),
    passwordHash: input.passwordHash,
  })

  if (input.roleIds.length > 0) {
    // Only roles belonging to this tenant. `setCrmUserRoles` has always done
    // this and has a test for it; the create path did not, so a
    // `crm.users:manage` holder could name another whitelabel's role id and the
    // new account came out holding that whitelabel's permissions. Verified by
    // execution before this guard existed: a role carrying
    // `crm.players:view_all` in tenant B was granted to a user in tenant A, and
    // `getCrmUserPermissions` read it straight back.
    //
    // `crm_user_roles` has no tenant column of its own — it inherits scope from
    // both sides — so nothing downstream would have caught it.
    const valid = await exec
      .select({ id: crmRoles.id })
      .from(crmRoles)
      .where(and(eq(crmRoles.tenant, input.tenant), inArray(crmRoles.id, input.roleIds)))

    if (valid.length > 0) {
      await exec
        .insert(crmUserRoles)
        .values(valid.map((r) => ({ crmUserId: user.id, roleId: r.id })))
    }
  }

  return user
}

export async function updateCrmUser(
  tenant: string,
  id: string,
  patch: { name?: string; email?: string | null; phone?: string | null }
): Promise<CrmUserRow | null> {
  const [row] = await db
    .update(crmUsers)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(crmUsers.tenant, tenant), eq(crmUsers.id, id)))
    .returning()
  return row ?? null
}

/**
 * Changes status, and invalidates outstanding tokens when access is being taken
 * away. Without the version bump a suspended user keeps working until their JWT
 * happens to expire, which can be days.
 */
export async function setCrmUserStatus(
  tenant: string,
  id: string,
  status: CrmUserStatus
): Promise<CrmUserRow | null> {
  const revoking = status === 'SUSPENDED'
  const [row] = await db
    .update(crmUsers)
    .set({
      status,
      updatedAt: new Date(),
      ...(revoking ? { tokenVersion: sql`${crmUsers.tokenVersion} + 1` } : {}),
    })
    .where(and(eq(crmUsers.tenant, tenant), eq(crmUsers.id, id)))
    .returning()
  return row ?? null
}

/** Sets a new password, forces a change on next sign-in, and cuts existing sessions. */
export async function setCrmUserPassword(
  tenant: string,
  id: string,
  passwordHash: string,
  opts: { requireReset: boolean }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(crmUsers)
      .set({
        tokenVersion: sql`${crmUsers.tokenVersion} + 1`,
        requirePasswordReset: opts.requireReset,
        updatedAt: new Date(),
      })
      .where(and(eq(crmUsers.tenant, tenant), eq(crmUsers.id, id)))
      .returning({ id: crmUsers.id })
    if (!user) return false

    await tx
      .update(crmUserCredentials)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(crmUserCredentials.crmUserId, id))
    return true
  })
}

/** Replaces a user's roles wholesale, so the request describes the end state. */
export async function setCrmUserRoles(
  tenant: string,
  crmUserId: string,
  roleIds: string[]
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: crmUsers.id })
      .from(crmUsers)
      .where(and(eq(crmUsers.tenant, tenant), eq(crmUsers.id, crmUserId)))
      .limit(1)
    if (!user) return false

    // Only roles belonging to this tenant — a role id from elsewhere is ignored
    // rather than trusted, so a crafted request cannot borrow another
    // whitelabel's permissions.
    const valid =
      roleIds.length > 0
        ? await tx
            .select({ id: crmRoles.id })
            .from(crmRoles)
            .where(and(eq(crmRoles.tenant, tenant), inArray(crmRoles.id, roleIds)))
        : []

    await tx.delete(crmUserRoles).where(eq(crmUserRoles.crmUserId, crmUserId))
    if (valid.length > 0) {
      await tx.insert(crmUserRoles).values(valid.map((r) => ({ crmUserId, roleId: r.id })))
    }
    // Roles decide what a token may do, so a change takes effect immediately.
    await tx
      .update(crmUsers)
      .set({ tokenVersion: sql`${crmUsers.tokenVersion} + 1`, updatedAt: new Date() })
      .where(eq(crmUsers.id, crmUserId))
    return true
  })
}

export async function deleteCrmUser(tenant: string, id: string): Promise<boolean> {
  // Their personal saved segments go with them. `crm_segments.owner_id` is
  // `set null` rather than `cascade` so a *shared* segment outlives its author
  // — the work it describes did not leave when they did — but a personal one
  // with no owner is visible to nobody and would just accumulate.
  const { deleteCrmSegmentsOwnedBy } = await import('@src/repos/crm/CrmSegmentsRepo.js')
  await deleteCrmSegmentsOwnedBy(tenant, id).catch(() => 0)

  const rows = await db
    .delete(crmUsers)
    .where(and(eq(crmUsers.tenant, tenant), eq(crmUsers.id, id)))
    .returning({ id: crmUsers.id })
  return rows.length > 0
}

/**
 * Marks a user away, and optionally names who covers for them.
 *
 * The delegate is followed exactly one hop by the escalation ladder. That is
 * deliberate: a chain of delegates is a way for work to end up somewhere nobody
 * is looking, and a cycle would be a way for it to disappear entirely. The
 * database refuses a self-delegation; a longer loop simply stops after one step.
 */
export async function setCrmUserAvailability(
  tenant: string,
  id: string,
  patch: { outOfOfficeUntil: Date | null; delegateTo: string | null }
): Promise<{
  ok: boolean
  reason?: 'not_found' | 'self_delegate' | 'delegate_not_found' | 'delegate_cannot_escalate'
}> {
  if (patch.delegateTo && patch.delegateTo === id) return { ok: false, reason: 'self_delegate' }

  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: crmUsers.id })
      .from(crmUsers)
      .where(and(eq(crmUsers.tenant, tenant), eq(crmUsers.id, id)))
      .limit(1)
    if (!user) return { ok: false, reason: 'not_found' as const }

    if (patch.delegateTo) {
      // The delegate must be in this tenant, or cover would silently point at
      // somebody who cannot see the work.
      const [delegate] = await tx
        .select({ id: crmUsers.id })
        .from(crmUsers)
        .where(
          and(
            eq(crmUsers.tenant, tenant),
            eq(crmUsers.id, patch.delegateTo),
            eq(crmUsers.status, 'ACTIVE')
          )
        )
        .limit(1)
      if (!delegate) return { ok: false, reason: 'delegate_not_found' as const }

      // And they must be able to actually receive an escalation. The sweep now
      // drops a delegate who does not hold `crm.tasks:escalate`, which is the
      // safe behaviour — but silently, at breach time, long after the person
      // arranging cover has gone. Refusing here is how they find out while they
      // can still name somebody else.
      const holds = await tx.execute(sql`
        SELECT 1
        FROM crm_user_roles ur
        JOIN crm_role_permissions rp ON rp.role_id = ur.role_id
        JOIN crm_roles r ON r.id = ur.role_id AND r.tenant = ${tenant}
        WHERE ur.crm_user_id = ${patch.delegateTo}::uuid
          AND rp.domain = 'crm.tasks' AND rp.action = 'escalate'
        LIMIT 1`)
      if (holds.rows.length === 0) return { ok: false, reason: 'delegate_cannot_escalate' as const }
    }

    await tx
      .update(crmUsers)
      .set({
        outOfOfficeUntil: patch.outOfOfficeUntil,
        delegateTo: patch.delegateTo,
        updatedAt: new Date(),
      })
      .where(eq(crmUsers.id, id))
    return { ok: true }
  })
}
