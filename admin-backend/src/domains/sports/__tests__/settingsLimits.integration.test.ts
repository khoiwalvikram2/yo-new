/**
 * The settings writes refuse stake and odds limits that contradict each other.
 *
 * upsertEventSettings, upsertLeagueSettings and upsertSportSettings stored a Min
 * Stake above the Max Stake (and Min Odds 50 over Max Odds 1.5) with a success
 * message, after which user-backend refused every stake on the event. The app
 * config's default stake limits had the same gap. Now each is refused with the
 * reason and nothing is written; a sport save is checked on the row it would
 * leave, since its mode keeps stored fields the input does not name.
 *
 * Requires DATABASE_URL. Writes only sports_settings rows of the whitelabel
 * vfyfix-g7-limits and removes them.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const WL = 'vfyfix-g7-limits'

let db: (typeof import('@src/db/client.js'))['db']
let mutations: (typeof import('@src/domains/sports/resolvers/mutations.js'))['sportsMutationResolvers']
let appConfig: (typeof import('@src/domains/app-config/resolvers/mutations.js'))['appConfigMutationResolvers']

const ctx = {
  tenant: WL,
  whitelabel: { id: WL },
  user: { sub: '9201', type: 'admin', roles: ['Whitelabel Admin'] },
  permissions: [{ domain: 'sports', actions: ['read', 'write'] }, { domain: 'config.app', actions: ['update'] }],
}

async function rows(query: ReturnType<typeof sql>): Promise<any[]> {
  const result: any = await db.execute(query)
  return Array.isArray(result) ? result : result?.rows ?? []
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  ;({ sportsMutationResolvers: mutations } = await import('@src/domains/sports/resolvers/mutations.js'))
  ;({ appConfigMutationResolvers: appConfig } = await import('@src/domains/app-config/resolvers/mutations.js'))
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM sports_settings WHERE whitelabel_id = ${WL}`)
    await db.execute(sql`DELETE FROM league_settings WHERE whitelabel_id = ${WL}`)
    await db.execute(sql`DELETE FROM event_settings WHERE whitelabel_id = ${WL}`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('event and league settings', () => {
  it('refuse a min stake above the max, and odds that no price can meet, writing nothing', async () => {
    const eventId = randomUUID()
    assert.deepEqual(
      await mutations.upsertEventSettings(null, { eventIds: [eventId], input: { exchangeMinStake: 5000, exchangeMaxStake: 100 } }, ctx),
      { success: false, message: 'Exchange Min Stake (5000) cannot exceed Exchange Max Stake (100).' },
    )
    assert.deepEqual(
      await mutations.upsertEventSettings(null, { eventIds: [eventId], input: { exchangeMinOdds: 50, exchangeMaxOdds: 1.5 } }, ctx),
      { success: false, message: 'Min Odds (50) cannot exceed Max Odds (1.5).' },
    )
    assert.equal((await mutations.upsertEventSettings(null, { eventIds: [eventId], input: { exchangeMinOdds: 0 } }, ctx)).success, false)
    assert.deepEqual(
      await mutations.upsertLeagueSettings(null, { leagueIds: [randomUUID()], input: { bookmakerMinStake: 10, bookmakerMaxStake: 5 } }, ctx),
      { success: false, message: 'Bookmaker Min Stake (10) cannot exceed Bookmaker Max Stake (5).' },
    )
    assert.equal((await rows(sql`SELECT 1 FROM event_settings WHERE whitelabel_id = ${WL}`)).length, 0)
    assert.equal((await rows(sql`SELECT 1 FROM league_settings WHERE whitelabel_id = ${WL}`)).length, 0)
  })
})

describe('sport settings', () => {
  it('check the row the save would leave: a new min over the stored max is refused, an agreeing one saved', async () => {
    const sportId = randomUUID()
    await db.execute(sql`
      INSERT INTO sports_settings (tenant, whitelabel_id, sport_id, tier_id, exchange_min_stake, exchange_max_stake)
      VALUES ('default', ${WL}, ${sportId}, 'default', 10, 100)`)

    const refused = await mutations.upsertSportSettings(null, { input: { sportIds: [sportId], mode: 'overwrite', exchangeMinStake: 5000 } }, ctx)
    assert.deepEqual(refused, { success: false, message: 'Exchange Min Stake (5000) cannot exceed Exchange Max Stake (100).' })
    const [kept] = await rows(sql`SELECT exchange_min_stake::float AS min FROM sports_settings WHERE whitelabel_id = ${WL} AND sport_id = ${sportId}`)
    assert.equal(kept.min, 10)

    const saved = await mutations.upsertSportSettings(null, { input: { sportIds: [sportId], mode: 'overwrite', exchangeMinStake: 50 } }, ctx)
    assert.equal(saved.success, true)
    const [after] = await rows(sql`SELECT exchange_min_stake::float AS min FROM sports_settings WHERE whitelabel_id = ${WL} AND sport_id = ${sportId}`)
    assert.equal(after.min, 50)
  })
})

describe('app config default stake limits', () => {
  it('refuse a min above its max before anything is written', async () => {
    await assert.rejects(
      () => appConfig.updateAppConfig(null, { input: { sportsGlobalConfig: { defaultStakeLimits: { exchangeMin: 5000, exchangeMax: 100 } } } }, ctx),
      /defaultStakeLimits\.exchangeMin: Exchange Min Stake \(5000\) cannot exceed Exchange Max Stake \(100\)\./,
    )
  })
})
