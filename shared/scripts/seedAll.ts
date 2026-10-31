import './loadEnv.js'
import { logStep, logSuccess } from './seedUtils.js'

/**
 * Master seed script. Runs all seeds in order. Shared has no dependency on admin-backend.
 * 1. seedWhitelabel 2. seedVipTiers 3. seedRoles 4. seedSuperAdmin 5. seedSports
 * (Gap Casino and GMAG Casino are optional: run seed:gap-casino / seed:gmag-casino separately.)
 */
async function main() {
  console.log('\n🌱 [seed:all] Starting...\n')
  try {
    logStep(1, 5, 'Seeding default whitelabel')
    const { seedWhitelabel } = await import('./seedWhitelabel.js')
    await seedWhitelabel()
    logSuccess('Whitelabel seeded')

    logStep(2, 5, 'Seeding default VIP tiers for all whitelabels')
    const { seedVipTiers } = await import('./seedVipTiers.js')
    await seedVipTiers()
    logSuccess('VIP tiers seeded')

    logStep(3, 5, 'Seeding roles')
    const { seedRoles } = await import('./seedRbac.js')
    await seedRoles()
    logSuccess('Roles seeded')

    logStep(4, 5, 'Seeding Super Admin')
    const { seedSuperAdmin } = await import('./seedSuperAdmin.js')
    await seedSuperAdmin()
    logSuccess('Super Admin seeded')

    logStep(5, 5, 'Seeding sports')
    const { seedSports } = await import('./seedSports.js')
    try {
      await seedSports()
      logSuccess('Sports seeded')
    } catch (sportsErr) {
      const msg = sportsErr instanceof Error ? sportsErr.message : String(sportsErr)
      console.warn(`\n⚠️ Sports seeding failed (${msg}). Continuing with remaining seeds.`)
      console.warn('  To retry later: cd shared && npm run seed:sports\n')
    }

    console.log('\n✅ [seed:all] Complete! All seeds ran successfully (no duplicates)\n')
    process.exit(0)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`\n❌ [seed:all] Failed: ${msg}`)
    if (error instanceof Error && error.cause) console.error('Cause:', error.cause)
    console.error('')
    process.exit(1)
  }
}

main()
