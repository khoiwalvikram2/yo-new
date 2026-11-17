/**
 * A catalogue upsert never re-activates a suspended row (SPO-GLOBAL-STATUS, Option A: catalogue status is platform
 * data). upsertLeague, upsertEvent and upsertMarket set status = 'active' on every EXISTING row they touched, and none
 * of their callers passes a status: any brand's Sports Builder save (persistSportsSelections), runAutoSportsIngestion
 * and the scheduled autoSportsQueue. So a league, event or market the platform had suspended, or an event the
 * declare form's "Disable event after result" had switched off, came back on with the next save or ingest.
 *
 * Requires DATABASE_URL. Builds a vfyog sport with an inactive league > event > market, upserts them the way those
 * callers do, and removes every row it made (by id or by its own code).
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/sports/__tests__/sportsUpsertStatus.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const STAMP = `vfyog-spo-${Date.now()}`
const NEW = `${STAMP}-new`

let db: (typeof import('@src/db/client.js'))['db']
let pgPool: (typeof import('@src/db/client.js'))['pool']
let repo: typeof import('@src/repos/sports/sportsRepo.js')
const ids = { sport: '', league: '', event: '', market: '' }

async function rows(query: ReturnType<typeof sql>): Promise<any[]> {
  const result: any = await db.execute(query)
  return Array.isArray(result) ? result : result?.rows ?? []
}

const statusOf = async (table: 'sports_leagues' | 'sports_events' | 'sports_markets', id: string) =>
  String((await rows(sql`SELECT status FROM ${sql.raw(table)} WHERE id = ${id}`))[0]?.status)
const nameOf = async (table: 'sports_leagues' | 'sports_events' | 'sports_markets', id: string) =>
  String((await rows(sql`SELECT name FROM ${sql.raw(table)} WHERE id = ${id}`))[0]?.name)

/** The inputs the Builder and the auto-ingest pass: no status. */
const league = (over: Record<string, unknown> = {}) => ({ sportId: ids.sport, leagueCode: STAMP, key: STAMP, name: `${STAMP} league`, ...over })
const event = (over: Record<string, unknown> = {}) => ({ leagueId: ids.league, eventCode: STAMP, key: STAMP, name: `${STAMP} event`, startTime: '2026-11-05T10:00:00.000Z', ...over })
const market = (over: Record<string, unknown> = {}) => ({ eventId: ids.event, marketCode: STAMP, name: 'Match Odds', type: 'match_odds', ...over })

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db, pool: pgPool } = await import('@src/db/client.js'))
  repo = await import('@src/repos/sports/sportsRepo.js')
  ;[{ id: ids.sport }] = await rows(sql`INSERT INTO sports (sport_code, key, name, status) VALUES (${STAMP}, ${STAMP}, ${STAMP}, 'active') RETURNING id`)
  // Suspended by the platform (setLeagueStatus / setEventStatus / setMarketStatus), or by "Disable event after result".
  ;[{ id: ids.league }] = await rows(sql`INSERT INTO sports_leagues (sport_id, league_code, key, name, status) VALUES (${ids.sport}, ${STAMP}, ${STAMP}, 'old', 'inactive') RETURNING id`)
  ;[{ id: ids.event }] = await rows(sql`INSERT INTO sports_events (league_id, event_code, key, name, status) VALUES (${ids.league}, ${STAMP}, ${STAMP}, 'old', 'inactive') RETURNING id`)
  ;[{ id: ids.market }] = await rows(sql`INSERT INTO sports_markets (event_id, market_code, name, status) VALUES (${ids.event}, ${STAMP}, 'old', 'inactive') RETURNING id`)
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM sports_markets WHERE market_code IN (${STAMP}, ${NEW})`)
    await db.execute(sql`DELETE FROM sports_events WHERE event_code IN (${STAMP}, ${NEW})`)
    await db.execute(sql`DELETE FROM sports_leagues WHERE league_code IN (${STAMP}, ${NEW})`)
    if (ids.sport) await db.execute(sql`DELETE FROM sports WHERE id = ${ids.sport}`)
  }
  await pgPool?.end().catch(() => {})
})

describe('catalogue upserts keep the status of an existing row', () => {
  it('a Builder save or an auto-ingest (no status passed) updates the rows but leaves them suspended', async () => {
    assert.equal(await repo.upsertLeague(league()), ids.league)
    assert.equal(await repo.upsertEvent(event()), ids.event)
    assert.equal(await repo.upsertMarket(market()), ids.market)

    assert.deepEqual(
      [await statusOf('sports_leagues', ids.league), await statusOf('sports_events', ids.event), await statusOf('sports_markets', ids.market)],
      ['inactive', 'inactive', 'inactive'],
    )
    // The rest of the row is still refreshed from the provider.
    assert.deepEqual(
      [await nameOf('sports_leagues', ids.league), await nameOf('sports_events', ids.event), await nameOf('sports_markets', ids.market)],
      [`${STAMP} league`, `${STAMP} event`, 'Match Odds'],
    )
    const [{ start_time: start }] = await rows(sql`SELECT start_time FROM sports_events WHERE id = ${ids.event}`)
    assert.ok(start, 'the start time was written')
  })

  it('a status the caller passes explicitly is still written', async () => {
    await repo.upsertLeague(league({ status: 'active' }))
    await repo.upsertEvent(event({ status: 'active' }))
    await repo.upsertMarket(market({ status: 'active' }))
    assert.deepEqual(
      [await statusOf('sports_leagues', ids.league), await statusOf('sports_events', ids.event), await statusOf('sports_markets', ids.market)],
      ['active', 'active', 'active'],
    )
    await repo.upsertEvent(event({ status: 'inactive' }))
    assert.equal(await statusOf('sports_events', ids.event), 'inactive')
    // ...and the next status-less upsert keeps it.
    await repo.upsertEvent(event())
    assert.equal(await statusOf('sports_events', ids.event), 'inactive')
  })

  it('new rows still start active', async () => {
    const leagueId = await repo.upsertLeague(league({ leagueCode: NEW, key: NEW }))
    const eventId = await repo.upsertEvent(event({ leagueId, eventCode: NEW, key: NEW }))
    const marketId = await repo.upsertMarket(market({ eventId, marketCode: NEW }))
    assert.ok(marketId)
    assert.deepEqual(
      [await statusOf('sports_leagues', leagueId), await statusOf('sports_events', eventId), await statusOf('sports_markets', marketId!)],
      ['active', 'active', 'active'],
    )
  })
})
