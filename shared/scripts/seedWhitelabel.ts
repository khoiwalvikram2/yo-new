import './loadEnv.js'
import { db } from '../src/db/client.js'
import { whitelabels } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { logStep, logSuccess, logSkip } from './seedUtils.js'
import { seedEmptyCasinoLounge } from '../src/casino/defaultLounge.js'

/**
 * Seed the default whitelabel. IDEMPOTENT.
 */
export async function seedWhitelabel() {
  const tenant = 'default'
  logStep(1, 1, 'Creating default whitelabel')
  const existing = await db.select({ id: whitelabels.id })
    .from(whitelabels)
    .where(eq(whitelabels.id, tenant))
    .limit(1)
  if (existing.length > 0) {
    await seedEmptyCasinoLounge(db, tenant)
    logSkip('Default whitelabel already exists')
    console.log('\n✅ Whitelabel seeding complete!')
    return
  }
  await db.insert(whitelabels).values({
    id: tenant,
    name: 'Default',
    domain: 'localhost',
    status: 'active',
    creditLimit: '0',
    creditUsed: '0',
    creditAvailable: '0',
    creditAlertThreshold: '80.00',
    settlementBalance: '0',
    settlementBalanceSports: '0',
    settlementBalanceCasino: '0',
    settlementBalanceMatka: '0',
  })
  await seedEmptyCasinoLounge(db, tenant)
  logSuccess('Default whitelabel created')
  console.log('\n✅ Whitelabel seeding complete!')
}

if (process.argv[1]?.includes('seedWhitelabel')) {
  seedWhitelabel().catch((err) => { console.error(err); process.exit(1) })
}
