import { db } from '@src/db/client.js'
import { crmIpAllowlist, crmLoginAttempts, crmPiiAccessLog, crmUsers } from '@shared/db/schema.js'
import { and, eq, sql, desc } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Sign-in history
// ---------------------------------------------------------------------------

export type CrmLoginFailureReason =
  | 'bad_password'
  | 'unknown_user'
  | 'suspended'
  | 'locked'
  | 'ip_blocked'
  | 'crm_disabled'

/**
 * Records an attempt. Never throws: a failure to write history must not turn a
 * valid sign-in into an error, nor an invalid one into a success.
 */
export async function recordCrmLoginAttempt(input: {
  tenant: string
  crmUserId?: string | null
  username: string
  success: boolean
  reason?: CrmLoginFailureReason | null
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<void> {
  try {
    await db.insert(crmLoginAttempts).values({
      tenant: input.tenant,
      crmUserId: input.crmUserId ?? null,
      username: input.username.slice(0, 120),
      success: input.success,
      reason: input.reason ?? null,
      ipAddress: input.ipAddress?.slice(0, 64) ?? null,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
    })
  } catch (err) {
    console.error('[crm] failed to record login attempt', {
      tenant: input.tenant,
      username: input.username,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function listCrmLoginAttempts(
  tenant: string,
  opts: { limit?: number; crmUserId?: string | null } = {}
): Promise<Array<typeof crmLoginAttempts.$inferSelect & { userName: string | null }>> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const where = opts.crmUserId
    ? and(eq(crmLoginAttempts.tenant, tenant), eq(crmLoginAttempts.crmUserId, opts.crmUserId))
    : eq(crmLoginAttempts.tenant, tenant)

  const rows = await db
    .select({ attempt: crmLoginAttempts, userName: crmUsers.name })
    .from(crmLoginAttempts)
    .leftJoin(crmUsers, eq(crmUsers.id, crmLoginAttempts.crmUserId))
    .where(where)
    .orderBy(desc(crmLoginAttempts.createdAt))
    .limit(limit)
  return rows.map((r) => ({ ...r.attempt, userName: r.userName ?? null }))
}

// ---------------------------------------------------------------------------
// Address allowlist
// ---------------------------------------------------------------------------

export async function listCrmIpAllowlist(
  tenant: string,
  crmUserId: string
): Promise<Array<typeof crmIpAllowlist.$inferSelect>> {
  return db
    .select()
    .from(crmIpAllowlist)
    .where(and(eq(crmIpAllowlist.tenant, tenant), eq(crmIpAllowlist.crmUserId, crmUserId)))
    .orderBy(desc(crmIpAllowlist.createdAt))
}

export async function addCrmIpAllowlistEntry(input: {
  tenant: string
  crmUserId: string
  cidr: string
  label?: string | null
}): Promise<typeof crmIpAllowlist.$inferSelect> {
  const [row] = await db
    .insert(crmIpAllowlist)
    .values({
      tenant: input.tenant,
      crmUserId: input.crmUserId,
      cidr: input.cidr.trim(),
      label: input.label ?? null,
    })
    .onConflictDoUpdate({
      target: [crmIpAllowlist.crmUserId, crmIpAllowlist.cidr],
      set: { label: input.label ?? null },
    })
    .returning()
  return row
}

export async function removeCrmIpAllowlistEntry(tenant: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(crmIpAllowlist)
    .where(and(eq(crmIpAllowlist.tenant, tenant), eq(crmIpAllowlist.id, id)))
    .returning({ id: crmIpAllowlist.id })
  return rows.length > 0
}

/** Rejects anything that is not plainly an IPv4 or IPv6 literal before it reaches a cast. */
function isIpLiteral(ip: string): boolean {
  return /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(ip) || /^[0-9a-fA-F:]+$/.test(ip)
}

/**
 * Whether an address may sign this user in.
 *
 * Postgres decides the match, using `inet <<= cidr`, so a range is a range
 * rather than a string comparison that happens to work for /24 and quietly
 * fails for /20. The address is bound as a parameter and shape-checked first,
 * because it arrives from a request header. A malformed stored entry matches
 * nothing instead of raising — one bad row must not lock a user out entirely.
 *
 * A user with no entries is allowed. The allowlist is opt-in per user, so
 * turning enforcement on for a tenant does not lock out everyone who has not
 * been configured yet.
 */
export async function isCrmIpAllowed(
  tenant: string,
  crmUserId: string,
  ip: string | null | undefined
): Promise<boolean> {
  const entries = await listCrmIpAllowlist(tenant, crmUserId)
  if (entries.length === 0) return true
  if (!ip || !isIpLiteral(ip)) return false

  const [row] = await db
    .select({
      allowed: sql<boolean>`bool_or(
        CASE WHEN ${crmIpAllowlist.cidr} ~ '^[0-9a-fA-F:.]+(/[0-9]{1,3})?$'
             THEN ${ip}::inet <<= ${crmIpAllowlist.cidr}::inet
             ELSE false END)`,
    })
    .from(crmIpAllowlist)
    .where(and(eq(crmIpAllowlist.tenant, tenant), eq(crmIpAllowlist.crmUserId, crmUserId)))
  return row?.allowed === true
}

// ---------------------------------------------------------------------------
// Read auditing
// ---------------------------------------------------------------------------

/**
 * Records that someone looked at personal data.
 *
 * Deliberately not awaited by its callers and deliberately swallowing its own
 * errors: this sits on the read path, and a logging failure must never fail the
 * query the user asked for.
 */
export function recordCrmPiiAccess(input: {
  tenant: string
  crmUserId?: string | null
  resourceType: string
  resourceId: string
  action: 'view' | 'search' | 'export' | 'erase'
  fields?: string[]
  ipAddress?: string | null
}): void {
  db.insert(crmPiiAccessLog)
    .values({
      tenant: input.tenant,
      crmUserId: input.crmUserId ?? null,
      resourceType: input.resourceType,
      resourceId: String(input.resourceId).slice(0, 128),
      action: input.action,
      fields: input.fields ?? null,
      ipAddress: input.ipAddress?.slice(0, 64) ?? null,
    })
    .catch((err) => {
      console.error('[crm] failed to record PII access', {
        tenant: input.tenant,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
}

export async function listCrmPiiAccess(
  tenant: string,
  opts: { limit?: number; resourceId?: string | null; crmUserId?: string | null } = {}
): Promise<Array<typeof crmPiiAccessLog.$inferSelect & { userName: string | null }>> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const clauses = [eq(crmPiiAccessLog.tenant, tenant)]
  if (opts.resourceId) clauses.push(eq(crmPiiAccessLog.resourceId, opts.resourceId))
  if (opts.crmUserId) clauses.push(eq(crmPiiAccessLog.crmUserId, opts.crmUserId))

  const rows = await db
    .select({ entry: crmPiiAccessLog, userName: crmUsers.name })
    .from(crmPiiAccessLog)
    .leftJoin(crmUsers, eq(crmUsers.id, crmPiiAccessLog.crmUserId))
    .where(and(...clauses))
    .orderBy(desc(crmPiiAccessLog.createdAt))
    .limit(limit)
  return rows.map((r) => ({ ...r.entry, userName: r.userName ?? null }))
}
