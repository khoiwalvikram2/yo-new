import './loadEnv.js'
import { pathToFileURL } from 'node:url'
import { asc } from 'drizzle-orm'
import { db, pool } from '../src/db/client.js'
import { whitelabels } from '../src/db/schema.js'
import { seedDefaultVipTiers } from '../src/vip/defaultTiers.js'

/** Each whitelabel owns its own IDs and editable configuration. */
export async function seedVipTiers() {
  const tenants = await db.select({ id: whitelabels.id }).from(whitelabels).orderBy(asc(whitelabels.id))
  if (!tenants.length) throw new Error('No whitelabels found. Run seed:whitelabel first.')
  const results = []
  for (const { id } of tenants) {
    const result = await seedDefaultVipTiers(db, id)
    results.push(result)
    console.log(`[seed:vip] ${id}: ${result.created.length} created, ${result.preserved.length} existing names/levels preserved`)
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedVipTiers().catch(error => {
    console.error('[seed:vip] Failed:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }).finally(() => pool.end())
}
