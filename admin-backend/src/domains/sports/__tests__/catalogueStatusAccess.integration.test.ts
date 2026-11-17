/**
 * The shared sports catalogue's status and order change only for the platform.
 *
 * sports, sports_leagues, sports_events and sports_markets carry no whitelabel,
 * and a bet is refused on anything inactive. setSportStatus, setLeagueStatus,
 * setEventStatus, setMarketStatus, reorderSports and reorderLeagues were gated
 * on the map alone, which every Whitelabel Admin passes through flat
 * `sports:write`, so one brand switched a market off for every brand. They now
 * also ask for `all:*`. And an id that matches nothing is reported, where the
 * four status writes used to answer success.
 *
 * Requires DATABASE_URL. Builds its own inactive sport > league > event and an
 * active market (all named vfyfix-g7-*) and removes them. The market goes
 * inactive here, never the other way, so nothing new becomes bettable.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const STAMP = `vfyfix-g7-cat-${Date.now()}`

let db: (typeof import('@src/db/client.js'))['db']
let mutations: (typeof import('@src/domains/sports/resolvers/mutations.js'))['sportsMutationResolvers']
const ids = { sport: '', league: '', event: '', market: '' }

const whitelabelAdmin = {
  tenant: 'vfyfix-g7-cat',
  whitelabel: { id: 'vfyfix-g7-cat' },
  user: { sub: '9101', type: 'admin', roles: ['Whitelabel Admin'] },
  permissions: [{ domain: 'sports', actions: ['read', 'write'] }],
}
// A core-mode Super Admin; the tenant only names where this test's audit rows land (kept out of `default`).
const platformAdmin = {
  tenant: 'vfyfix-g7-cat-platform',
  whitelabel: { id: 'vfyfix-g7-cat-platform' },
  user: { sub: '9100', type: 'admin', roles: ['Super Admin'] },
  directorMode: 'core',
  permissions: [{ domain: 'all', actions: ['*'] }],
}

async function rows(query: ReturnType<typeof sql>): Promise<any[]> {
  const result: any = await db.execute(query)
  return Array.isArray(result) ? result : result?.rows ?? []
}
async function statusOf(table: 'sports' | 'sports_leagues' | 'sports_events' | 'sports_markets', id: string) {
  // Only sports and leagues carry an order.
  const sort = table === 'sports' || table === 'sports_leagues' ? sql`sort` : sql`NULL AS sort`
  const [row] = await rows(sql`SELECT status, ${sort} FROM ${sql.identifier(table)} WHERE id = ${id}`)
  return row
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  ;({ sportsMutationResolvers: mutations } = await import('@src/domains/sports/resolvers/mutations.js'))
  ;[{ id: ids.sport }] = await rows(sql`
    INSERT INTO sports (sport_code, key, name, sort, status) VALUES (${STAMP}, ${STAMP}, ${STAMP}, 990, 'inactive') RETURNING id`)
  ;[{ id: ids.league }] = await rows(sql`
    INSERT INTO sports_leagues (sport_id, league_code, key, name, sort, status) VALUES (${ids.sport}, ${STAMP}, ${STAMP}, ${STAMP}, 990, 'inactive') RETURNING id`)
  ;[{ id: ids.event }] = await rows(sql`
    INSERT INTO sports_events (league_id, event_code, key, name, status) VALUES (${ids.league}, ${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.market }] = await rows(sql`
    INSERT INTO sports_markets (event_id, market_code, name, status) VALUES (${ids.event}, ${STAMP}, ${STAMP}, 'active') RETURNING id`)
})

after(async () => {
  if (db) {
    if (ids.market) await db.execute(sql`DELETE FROM sports_markets WHERE id = ${ids.market}`)
    if (ids.event) await db.execute(sql`DELETE FROM sports_events WHERE id = ${ids.event}`)
    if (ids.league) await db.execute(sql`DELETE FROM sports_leagues WHERE id = ${ids.league}`)
    if (ids.sport) await db.execute(sql`DELETE FROM sports WHERE id = ${ids.sport}`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('a Whitelabel Admin', () => {
  it('is refused every status write and reorder, and the shared rows stay as they were', async () => {
    const forbidden = /requires platform administrator permission/
    await assert.rejects(() => mutations.setMarketStatus(null, { id: ids.market, status: 'inactive' }, whitelabelAdmin), forbidden)
    await assert.rejects(() => mutations.setEventStatus(null, { id: ids.event, status: 'active' }, whitelabelAdmin), forbidden)
    await assert.rejects(() => mutations.setLeagueStatus(null, { id: ids.league, status: 'active' }, whitelabelAdmin), forbidden)
    await assert.rejects(() => mutations.setSportStatus(null, { key: STAMP, status: 'active' }, whitelabelAdmin), forbidden)
    await assert.rejects(() => mutations.reorderSports(null, { inputs: [{ id: ids.sport, sort: 1 }] }, whitelabelAdmin), forbidden)
    await assert.rejects(() => mutations.reorderLeagues(null, { inputs: [{ id: ids.league, sort: 1 }] }, whitelabelAdmin), forbidden)

    assert.equal((await statusOf('sports_markets', ids.market)).status, 'active')
    assert.equal((await statusOf('sports_events', ids.event)).status, 'inactive')
    assert.equal((await statusOf('sports_leagues', ids.league)).status, 'inactive')
    const sport = await statusOf('sports', ids.sport)
    assert.deepEqual([sport.status, sport.sort], ['inactive', 990])
    assert.equal((await statusOf('sports_leagues', ids.league)).sort, 990)
  })
})

describe('the platform administrator', () => {
  it('changes status and order of the shared rows', async () => {
    assert.deepEqual(await mutations.setMarketStatus(null, { id: ids.market, status: 'inactive' }, platformAdmin), { success: true, message: 'Market status updated to inactive' })
    assert.equal((await statusOf('sports_markets', ids.market)).status, 'inactive')
    assert.equal(await mutations.setEventStatus(null, { id: ids.event, status: 'inactive' }, platformAdmin), true)
    assert.equal(await mutations.setLeagueStatus(null, { id: ids.league, status: 'inactive' }, platformAdmin), true)
    assert.equal(await mutations.setSportStatus(null, { key: STAMP, status: 'inactive' }, platformAdmin), true)

    assert.equal((await mutations.reorderSports(null, { inputs: [{ id: ids.sport, sort: 991 }] }, platformAdmin)).success, true)
    assert.equal((await statusOf('sports', ids.sport)).sort, 991)
    assert.equal((await mutations.reorderLeagues(null, { inputs: [{ id: ids.league, sort: 992 }] }, platformAdmin)).success, true)
    assert.equal((await statusOf('sports_leagues', ids.league)).sort, 992)
  })

  it('is told when an id matches nothing, instead of success, and a reorder with one writes nothing', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    await assert.rejects(() => mutations.setEventStatus(null, { id: missing, status: 'inactive' }, platformAdmin), /Event not found/)
    await assert.rejects(() => mutations.setEventStatus(null, { id: 'not-a-uuid', status: 'inactive' }, platformAdmin), /Event not found/)
    await assert.rejects(() => mutations.setLeagueStatus(null, { id: missing, status: 'inactive' }, platformAdmin), /League not found/)
    await assert.rejects(() => mutations.setSportStatus(null, { key: `${STAMP}-missing`, status: 'inactive' }, platformAdmin), /Sport not found/)
    assert.deepEqual(await mutations.setMarketStatus(null, { id: missing, status: 'inactive' }, platformAdmin), { success: false, message: 'Market not found' })

    assert.deepEqual(
      await mutations.reorderLeagues(null, { inputs: [{ id: ids.league, sort: 1 }, { id: missing, sort: 2 }] }, platformAdmin),
      { success: false, message: 'League not found' },
    )
    assert.equal((await statusOf('sports_leagues', ids.league)).sort, 992)
    assert.deepEqual(
      await mutations.reorderSports(null, { inputs: [{ id: ids.sport, sort: 1 }, { id: 'nope', sort: 2 }] }, platformAdmin),
      { success: false, message: 'Sport not found' },
    )
    assert.equal((await statusOf('sports', ids.sport)).sort, 991)
  })
})
