/**
 * One-time backfill: provision default casino categories and game assignments for all whitelabels,
 * set Gap/GMAG games to active, and disable non-Latin games per tenant.
 * Uses legacy flow (clone-from-default or hardcoded template). Idempotent; safe to re-run.
 *
 * For provider-based categories (Gap/GMAG per whitelabel), use the admin UI instead:
 * Config > Whitelabels > "Generate categories" (per row) or Create Whitelabel > "Generate categories".
 *
 * Replace mode: set REPLACE_CASINO_CATEGORIES=1 to delete all existing categories per tenant
 * and re-seed fresh (new categories + assignments).
 *
 * Usage: from admin-backend: npx tsx scripts/backfillCasinoCategories.ts
 *        REPLACE_CASINO_CATEGORIES=1 npm run backfill:casino-categories  (from shared)
 * Requires: DATABASE_URL in env (e.g. admin-backend/.env or export).
 */
import 'dotenv/config'
import { listWhitelabelsDb } from '../src/repos/common/whitelabelRepo.js'
import {
  deleteAllCasinoCategoriesForTenant,
  provisionDefaultCasinoCategoriesForTenant,
  setGapGmagGamesActiveDb,
  type ProvisionDefaultCasinoCategoriesResult,
} from '../src/repos/casino/casinoRepo.js'

const REPLACE = process.env.REPLACE_CASINO_CATEGORIES === '1' || process.env.REPLACE_CASINO_CATEGORIES === 'true'

async function main() {
  console.log('Backfill: casino categories + game mapping + Gap/GMAG active')
  if (REPLACE) console.log('Mode: REPLACE (delete existing categories then re-seed)\n')
  else console.log('Mode: idempotent (skip existing)\n')

  console.log('1) Setting Gap/GMAG games to active...')
  const activeCount = await setGapGmagGamesActiveDb()
  console.log(`   Updated ${activeCount} games to active.\n`)

  console.log('2) Fetching all whitelabels...')
  const whitelabels = await listWhitelabelsDb()
  const tenantIds = whitelabels.map((w) => w.id)
  console.log(`   Found ${tenantIds.length} tenant(s): ${tenantIds.join(', ')}\n`)

  if (REPLACE) {
    console.log('2b) Deleting existing casino categories per tenant...')
    for (const tenantId of tenantIds) {
      try {
        const deleted = await deleteAllCasinoCategoriesForTenant(tenantId)
        if (deleted > 0) console.log(`   ${tenantId}: deleted ${deleted} categories`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`   ${tenantId}: delete failed - ${msg}`)
      }
    }
    console.log('')
  }

  console.log('3) Provisioning default categories and assignments per tenant...')
  let totalCategories = 0
  let totalAssigned = 0
  let totalNonLatinDisabled = 0
  for (const tenantId of tenantIds) {
    try {
      const r: ProvisionDefaultCasinoCategoriesResult =
        await provisionDefaultCasinoCategoriesForTenant(tenantId)
      totalCategories += r.categoriesCreated
      totalAssigned += r.gamesAssigned
      totalNonLatinDisabled += r.nonLatinDisabled
      if (
        r.categoriesCreated > 0 ||
        r.gamesAssigned > 0 ||
        r.nonLatinDisabled > 0
      ) {
        console.log(
          `   ${tenantId}: categories created=${r.categoriesCreated}, gamesAssigned=${r.gamesAssigned}, nonLatinDisabled=${r.nonLatinDisabled}`
        )
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`   ${tenantId}: failed - ${msg}`)
    }
  }

  console.log('\nDone.')
  console.log(
    `   Total: categories created=${totalCategories}, game assignments=${totalAssigned}, non-Latin disabled=${totalNonLatinDisabled}, Gap/GMAG set active=${activeCount}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
