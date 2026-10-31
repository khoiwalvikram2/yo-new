/**
 * Migration script: seed 270 nested permissions + 8 template roles for all existing tenants.
 * Keeps existing flat permissions; adds nested permissions and Support Admin template roles.
 * Run: npx tsx scripts/seedNestedRbacForAllTenants.ts (from admin-backend)
 */
import 'dotenv/config'
import { db } from '../src/db/client.js'
import { roles } from '../src/db/schema.js'
import { sql } from 'drizzle-orm'
import { seedDefaultRBAC } from '../src/repos/rbac/rbacRepo.js'

async function main() {
  console.log('Fetching all tenants...')
  const tenants = await db
    .selectDistinct({ tenant: roles.tenant })
    .from(roles)
    .where(sql`${roles.tenant} IS NOT NULL AND ${roles.tenant} != ''`)

  const tenantIds = tenants.map((r) => r.tenant).filter(Boolean) as string[]
  const withDefault = new Set(tenantIds)
  if (!withDefault.has('default')) {
    withDefault.add('default')
  }

  console.log(`Seeding nested RBAC for ${withDefault.size} tenant(s): ${[...withDefault].join(', ')}`)

  for (const tenant of withDefault) {
    console.log(`  → ${tenant}`)
    await seedDefaultRBAC(tenant)
  }

  console.log('Done. Nested permissions and 8 template roles are now available for all tenants.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
