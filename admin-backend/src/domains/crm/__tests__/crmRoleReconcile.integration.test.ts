/**
 * A permission added to the catalogue in a later phase must reach whitelabels
 * that were enabled under an earlier one.
 *
 * `seedCrmSystemRoles` creates a role only when its name is absent, so on every
 * already-enabled tenant a new permission would land on nobody and the feature
 * it gates would be dead on arrival. This is the test that would have caught it.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-recon-${randomUUID().slice(0, 8)}`

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_roles WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${TENANT}`)
})

/** Permissions currently held by the tenant's system role. */
async function adminRolePermissions(tenant: string): Promise<Set<string>> {
  const { listCrmRoles } = await import('@src/repos/crm/CrmRolesRepo.js')
  const roles = await listCrmRoles(tenant)
  const admin = roles.find((r) => r.isSystem)
  assert.ok(admin, 'the tenant should have a system role')
  return new Set(admin.permissions.map((p) => `${p.domain}:${p.action}`))
}

describe('system roles keep up with the catalogue', () => {
  it('grants a newly catalogued permission to a whitelabel enabled before it existed', async () => {
    const { seedCrmSystemRoles, reconcileCrmSystemRoles } = await import(
      '@src/repos/crm/CrmRolesRepo.js'
    )
    const perms = await import('@src/domains/crm/permissions.js')

    // Enable the tenant against the catalogue as it stands.
    await seedCrmSystemRoles(TENANT)
    const before = await adminRolePermissions(TENANT)
    assert.ok(before.size > 0)

    // A later phase adds a permission. Mutating the exported spec is exactly
    // what a real catalogue edit does.
    const spec = perms.CRM_SYSTEM_ROLES.find((r) => r.isSystem)
    assert.ok(spec, 'CRM Administrator should be a system role')
    const added = { domain: 'crm.reconcile-probe', action: 'use' }
    spec.permissions.push(added)
    const key = `${added.domain}:${added.action}`

    try {
      // Seeding alone must not deliver it — that is the defect being guarded.
      await seedCrmSystemRoles(TENANT)
      const afterSeed = await adminRolePermissions(TENANT)
      assert.equal(
        afterSeed.has(key),
        false,
        'seeding skips existing roles; if this ever passes, the test has stopped testing anything'
      )

      // Reconciling must deliver it.
      const result = await reconcileCrmSystemRoles(TENANT)
      const afterReconcile = await adminRolePermissions(TENANT)
      assert.equal(afterReconcile.has(key), true, 'reconcile should grant the new permission')
      assert.ok(
        result.grantedTo.some((g) => g.added > 0),
        'reconcile should report what it granted'
      )
    } finally {
      const i = spec.permissions.findIndex((p) => p.domain === added.domain)
      if (i >= 0) spec.permissions.splice(i, 1)
    }
  })

  it('does not take back a permission the whitelabel removed from its own role', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { listCrmRoles, reconcileCrmSystemRoles } = await import('@src/repos/crm/CrmRolesRepo.js')

    const roles = await listCrmRoles(TENANT)
    const agent = roles.find((r) => !r.isSystem)
    assert.ok(agent, 'the tenant should have a non-system role')
    const had = agent.permissions.length
    assert.ok(had > 0)

    await db.execute(sql`DELETE FROM crm_role_permissions WHERE role_id = ${agent.id}::uuid`)
    await reconcileCrmSystemRoles(TENANT)

    const after = (await listCrmRoles(TENANT)).find((r) => r.id === agent.id)
    assert.equal(
      after?.permissions.length,
      0,
      'a whitelabel trimming a non-system role must not be undone by reconciliation'
    )
  })

  it('bumps token version so a new permission is usable without signing in again', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { reconcileCrmSystemRoles, listCrmRoles } = await import('@src/repos/crm/CrmRolesRepo.js')
    const perms = await import('@src/domains/crm/permissions.js')

    const roles = await listCrmRoles(TENANT)
    const admin = roles.find((r) => r.isSystem)!
    const [user] = (
      await db.execute(sql`
        INSERT INTO crm_users (tenant, name, status) VALUES (${TENANT}, 'Holder', 'ACTIVE')
        RETURNING id, token_version`)
    ).rows as Array<{ id: string; token_version: number }>
    await db.execute(sql`
      INSERT INTO crm_user_roles (crm_user_id, role_id) VALUES (${user.id}::uuid, ${admin.id}::uuid)`)

    const spec = perms.CRM_SYSTEM_ROLES.find((r) => r.isSystem)!
    spec.permissions.push({ domain: 'crm.bump-probe', action: 'use' })
    try {
      await reconcileCrmSystemRoles(TENANT)
      const after = (
        await db.execute(sql`SELECT token_version FROM crm_users WHERE id = ${user.id}::uuid`)
      ).rows[0] as { token_version: number }
      assert.ok(
        Number(after.token_version) > Number(user.token_version),
        'holders of a changed role must be re-evaluated on their next request'
      )
    } finally {
      const i = spec.permissions.findIndex((p) => p.domain === 'crm.bump-probe')
      if (i >= 0) spec.permissions.splice(i, 1)
    }
  })
})
