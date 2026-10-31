/**
 * Rolls the current CRM permission catalogue out to every enabled whitelabel.
 *
 * `package.json` has named this script as `seed:crm-rbac` for some time while
 * the file did not exist, so running it failed with a module error. It is
 * restored here because adding a permission needs exactly what it was for.
 *
 * **Reconcile, not seed.** `seedCrmSystemRoles` skips a role that already
 * exists, so a permission added to the catalogue today would reach no
 * whitelabel that was enabled before today — the feature it gates would ship
 * held by nobody, and the screen would be invisible to every existing
 * administrator. `reconcileCrmSystemRoles` grants what is missing to the
 * built-in role instead, and bumps the token version of everyone holding it so
 * the new permission is in effect on their next request rather than after they
 * next sign in.
 *
 * Only `CRM Administrator` is reconciled, because only it is a system role. The
 * Supervisor and Agent roles a whitelabel starts with are ordinary ones it may
 * have edited or deleted, and silently re-granting to those would undo a
 * deliberate decision. New permissions reach them through the role editor.
 *
 * `setCrmWhitelabelSettings` already reconciles when a tenant is enabled, so
 * this is only needed for tenants enabled before the catalogue changed.
 *
 * Usage:
 *   npm run seed:crm-rbac              # every enabled whitelabel
 *   npm run seed:crm-rbac -- <tenant>  # just one
 *   npm run seed:crm-rbac -- --dry-run # report what would change
 */
import 'dotenv/config'
import { db, pool } from '@src/db/client.js'
import { crmWhitelabelSettings } from '@shared/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { reconcileCrmSystemRoles } from '@src/repos/crm/CrmRolesRepo.js'
import { CRM_PERMISSION_KEYS } from '@src/domains/crm/permissions.js'

async function enabledTenants(only: string | null): Promise<string[]> {
  const rows = await db
    .select({ tenant: crmWhitelabelSettings.tenant })
    .from(crmWhitelabelSettings)
    .where(eq(crmWhitelabelSettings.enabled, true))
  const all = rows.map((r) => r.tenant)
  return only ? all.filter((t) => t === only) : all
}

/** What the built-in role is missing, per tenant, without changing anything. */
async function report(tenant: string): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT rp.domain, rp.action
    FROM crm_roles r
    JOIN crm_role_permissions rp ON rp.role_id = r.id
    WHERE r.tenant = ${tenant} AND r.is_system = true`)
  const held = new Set(
    (res.rows as Array<{ domain: string; action: string }>).map((r) => `${r.domain}:${r.action}`)
  )
  return [...CRM_PERMISSION_KEYS].filter((k) => !held.has(k))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const only = args.find((a) => !a.startsWith('--')) ?? null

  const tenants = await enabledTenants(only)
  if (tenants.length === 0) {
    console.log(only ? `No enabled CRM for "${only}".` : 'No whitelabel has its CRM enabled.')
    return
  }

  console.log(`catalogue: ${CRM_PERMISSION_KEYS.size} permissions`)
  console.log(`${tenants.length} whitelabel(s) with the CRM enabled\n`)

  let changed = 0
  for (const tenant of tenants) {
    if (dryRun) {
      const missing = await report(tenant)
      console.log(
        missing.length === 0
          ? `  ${tenant}: up to date`
          : `  ${tenant}: would grant ${missing.length} — ${missing.join(', ')}`
      )
      if (missing.length > 0) changed++
      continue
    }

    const res = await reconcileCrmSystemRoles(tenant)
    const added = res.grantedTo.reduce((n, g) => n + g.added, 0)
    if (res.created.length > 0 || added > 0) {
      changed++
      console.log(
        `  ${tenant}: ${res.created.length > 0 ? `created ${res.created.join(', ')}; ` : ''}` +
          `granted ${added} permission(s) to ${res.grantedTo.map((g) => g.role).join(', ') || 'nobody'}`
      )
    } else {
      console.log(`  ${tenant}: up to date`)
    }
  }

  console.log(
    `\n${dryRun ? 'would change' : 'changed'} ${changed} of ${tenants.length} whitelabel(s)` +
      (dryRun ? ' — run without --dry-run to apply' : '')
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
