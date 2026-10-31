import { db } from '@src/db/client.js'
import { crmRoles, crmRolePermissions, crmUserRoles } from '@shared/db/schema.js'
import { and, eq, sql, asc, inArray } from 'drizzle-orm'
import { isValidCrmPermission, CRM_SYSTEM_ROLES } from '@src/domains/crm/permissions.js'

export type CrmRoleRow = typeof crmRoles.$inferSelect
export type CrmRoleWithPermissions = CrmRoleRow & {
  permissions: Array<{ domain: string; action: string }>
  userCount: number
}

export async function listCrmRoles(tenant: string): Promise<CrmRoleWithPermissions[]> {
  const roles = await db
    .select()
    .from(crmRoles)
    .where(eq(crmRoles.tenant, tenant))
    .orderBy(asc(crmRoles.name))
  if (roles.length === 0) return []

  const ids = roles.map((r) => r.id)
  const [perms, counts] = await Promise.all([
    db
      .select({ roleId: crmRolePermissions.roleId, domain: crmRolePermissions.domain, action: crmRolePermissions.action })
      .from(crmRolePermissions)
      .where(inArray(crmRolePermissions.roleId, ids)),
    db
      .select({ roleId: crmUserRoles.roleId, n: sql<number>`count(*)::int` })
      .from(crmUserRoles)
      .where(inArray(crmUserRoles.roleId, ids))
      .groupBy(crmUserRoles.roleId),
  ])

  const permsByRole = new Map<string, Array<{ domain: string; action: string }>>()
  for (const p of perms) {
    const list = permsByRole.get(p.roleId) ?? []
    list.push({ domain: p.domain, action: p.action })
    permsByRole.set(p.roleId, list)
  }
  const countByRole = new Map(counts.map((c) => [c.roleId, Number(c.n) || 0]))

  return roles.map((r) => ({
    ...r,
    permissions: permsByRole.get(r.id) ?? [],
    userCount: countByRole.get(r.id) ?? 0,
  }))
}

/**
 * Anything not in the catalogue is dropped rather than stored.
 *
 * A permission nothing checks is worse than no permission: it appears on the
 * role, reads as an authority, and grants nothing. Filtering here means the
 * stored role and the enforced role are always the same thing.
 */
function validPermissions(
  input: Array<{ domain: string; action: string }>
): Array<{ domain: string; action: string }> {
  const seen = new Set<string>()
  const out: Array<{ domain: string; action: string }> = []
  for (const p of input) {
    const key = `${p.domain}:${p.action}`
    if (seen.has(key)) continue
    if (!isValidCrmPermission(p.domain, p.action)) continue
    seen.add(key)
    out.push({ domain: p.domain, action: p.action })
  }
  return out
}

export async function createCrmRole(input: {
  tenant: string
  name: string
  description?: string | null
  permissions: Array<{ domain: string; action: string }>
}): Promise<CrmRoleRow> {
  return db.transaction(async (tx) => {
    const [role] = await tx
      .insert(crmRoles)
      .values({
        tenant: input.tenant,
        name: input.name.trim(),
        description: input.description ?? null,
        isSystem: false,
      })
      .returning()
    const perms = validPermissions(input.permissions)
    if (perms.length > 0) {
      await tx.insert(crmRolePermissions).values(perms.map((p) => ({ roleId: role.id, ...p })))
    }
    return role
  })
}

/**
 * Replaces a role's permissions with exactly what was sent.
 *
 * Every holder's token version is bumped, so a permission removed here is gone
 * on their next request rather than at the end of their session. A system role
 * cannot be emptied — that is the path by which a whitelabel locks itself out
 * of its own CRM.
 */
export async function updateCrmRole(
  tenant: string,
  id: string,
  patch: {
    name?: string
    description?: string | null
    permissions?: Array<{ domain: string; action: string }>
  }
): Promise<{ ok: boolean; reason?: 'not_found' | 'system_role_needs_permissions' }> {
  return db.transaction(async (tx) => {
    const [role] = await tx
      .select()
      .from(crmRoles)
      .where(and(eq(crmRoles.tenant, tenant), eq(crmRoles.id, id)))
      .limit(1)
    if (!role) return { ok: false, reason: 'not_found' as const }

    if (patch.permissions !== undefined) {
      const perms = validPermissions(patch.permissions)
      if (role.isSystem && perms.length === 0) {
        return { ok: false, reason: 'system_role_needs_permissions' as const }
      }
      await tx.delete(crmRolePermissions).where(eq(crmRolePermissions.roleId, id))
      if (perms.length > 0) {
        await tx.insert(crmRolePermissions).values(perms.map((p) => ({ roleId: id, ...p })))
      }
      await tx.execute(sql`
        UPDATE crm_users SET token_version = token_version + 1
        WHERE id IN (SELECT crm_user_id FROM crm_user_roles WHERE role_id = ${id})
      `)
    }

    if (patch.name !== undefined || patch.description !== undefined) {
      await tx
        .update(crmRoles)
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          updatedAt: new Date(),
        })
        .where(eq(crmRoles.id, id))
    }
    return { ok: true }
  })
}

export async function deleteCrmRole(
  tenant: string,
  id: string
): Promise<{ ok: boolean; reason?: 'not_found' | 'system_role' | 'in_use' }> {
  return db.transaction(async (tx) => {
    const [role] = await tx
      .select()
      .from(crmRoles)
      .where(and(eq(crmRoles.tenant, tenant), eq(crmRoles.id, id)))
      .limit(1)
    if (!role) return { ok: false, reason: 'not_found' as const }
    if (role.isSystem) return { ok: false, reason: 'system_role' as const }

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(crmUserRoles)
      .where(eq(crmUserRoles.roleId, id))
    if ((Number(n) || 0) > 0) return { ok: false, reason: 'in_use' as const }

    await tx.delete(crmRoles).where(eq(crmRoles.id, id))
    return { ok: true }
  })
}

/**
 * Creates the starting roles for a whitelabel whose CRM has just been enabled.
 *
 * Idempotent: run it twice and the second call adds nothing, because enabling a
 * CRM that was previously enabled must not duplicate roles or quietly reset the
 * permissions the whitelabel has since edited.
 */
export async function seedCrmSystemRoles(tenant: string): Promise<{ created: string[] }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ name: crmRoles.name })
      .from(crmRoles)
      .where(eq(crmRoles.tenant, tenant))
    const have = new Set(existing.map((r) => r.name.toLowerCase()))
    const created: string[] = []

    for (const spec of CRM_SYSTEM_ROLES) {
      if (have.has(spec.name.toLowerCase())) continue
      const [role] = await tx
        .insert(crmRoles)
        .values({
          tenant,
          name: spec.name,
          description: spec.description,
          isSystem: spec.isSystem,
        })
        .returning()
      if (spec.permissions.length > 0) {
        await tx
          .insert(crmRolePermissions)
          .values(spec.permissions.map((p) => ({ roleId: role.id, ...p })))
      }
      created.push(spec.name)
    }
    return { created }
  })
}

/**
 * Brings a whitelabel's system roles in line with the catalogue.
 *
 * `seedCrmSystemRoles` creates a role only when its name is absent, which is
 * right for a first enablement and silently wrong afterwards: every permission
 * added to the catalogue in a later phase would land on no existing tenant, and
 * a feature would ship held by nobody. Reconciling closes that.
 *
 * Deliberately one-directional. Missing permissions are inserted; extra ones are
 * left alone, because a whitelabel is allowed to trim what a role grants and
 * this must not undo that. Only `is_system` roles are touched — the seeded
 * Supervisor and Agent roles are starting points a tenant owns and may edit
 * freely, so re-adding what they removed would be taking their CRM back.
 *
 * Holders get their token version bumped, so a newly granted permission is
 * usable on the next request rather than after their session ends.
 */
export async function reconcileCrmSystemRoles(
  tenant: string
): Promise<{ created: string[]; grantedTo: Array<{ role: string; added: number }> }> {
  const { created } = await seedCrmSystemRoles(tenant)

  return db.transaction(async (tx) => {
    const roles = await tx
      .select()
      .from(crmRoles)
      .where(and(eq(crmRoles.tenant, tenant), eq(crmRoles.isSystem, true)))

    const grantedTo: Array<{ role: string; added: number }> = []
    for (const role of roles) {
      const spec = CRM_SYSTEM_ROLES.find((r) => r.name.toLowerCase() === role.name.toLowerCase())
      if (!spec) continue

      const rows = await tx
        .insert(crmRolePermissions)
        .values(spec.permissions.map((p) => ({ roleId: role.id, ...p })))
        .onConflictDoNothing()
        .returning({ domain: crmRolePermissions.domain })

      if (rows.length > 0) {
        grantedTo.push({ role: role.name, added: rows.length })
        await tx.execute(sql`
          UPDATE crm_users SET token_version = token_version + 1
          WHERE id IN (SELECT crm_user_id FROM crm_user_roles WHERE role_id = ${role.id})
        `)
      }
    }
    return { created, grantedTo }
  })
}
