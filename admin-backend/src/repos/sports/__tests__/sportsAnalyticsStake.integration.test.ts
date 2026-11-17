/**
 * Live Sports Intelligence's Total Stake is the stake of the open bets.
 *
 * Every total_stake in the live aggregates was a copy of the liability sum, so
 * the page showed Total Stake equal to Liability (20,490 for 19,000 of stakes)
 * and computed the exposure ratio on the liability.
 *
 * Requires DATABASE_URL. Builds an inactive vfyfix sport > league > event with
 * one active market, a player and two open bets in tenant vfyfix-g7-live (a
 * back bet of 100 risking 100, a lay bet of 100 risking 150), reads the
 * dashboard, and removes everything.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const TENANT = 'vfyfix-g7-live'
const STAMP = `vfyfix-g7-live-${Date.now()}`

let db: (typeof import('@src/db/client.js'))['db']
let repo: typeof import('@src/repos/sports/sportsAnalyticsRepo.js')
const ids = { sport: '', league: '', event: '', market: '', runner: '', user: 0 }

async function rows(query: ReturnType<typeof sql>): Promise<any[]> {
  const result: any = await db.execute(query)
  return Array.isArray(result) ? result : result?.rows ?? []
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  repo = await import('@src/repos/sports/sportsAnalyticsRepo.js')
  ;[{ id: ids.sport }] = await rows(sql`INSERT INTO sports (sport_code, key, name, status) VALUES (${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.league }] = await rows(sql`INSERT INTO sports_leagues (sport_id, league_code, key, name, status) VALUES (${ids.sport}, ${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.event }] = await rows(sql`INSERT INTO sports_events (league_id, event_code, key, name, status) VALUES (${ids.league}, ${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.market }] = await rows(sql`INSERT INTO sports_markets (event_id, market_code, name, status) VALUES (${ids.event}, ${STAMP}, ${STAMP}, 'active') RETURNING id`)
  ;[{ id: ids.runner }] = await rows(sql`INSERT INTO sports_runners (market_id, selection_code, name) VALUES (${ids.market}, ${STAMP}, ${STAMP}) RETURNING id`)
  ;[{ id: ids.user }] = await rows(sql`
    INSERT INTO users (tenant, name, username, status, password_hash) VALUES (${TENANT}, 'vfyfix g7 live', ${STAMP}, 'active', 'x') RETURNING id`)
  for (const [side, price, liability] of [['back', 2, 100], ['lay', 2.5, 150]] as const) {
    await db.execute(sql`
      INSERT INTO sports_bets (tenant, whitelabel_id, user_id, sport_id, league_id, event_id, market_id, runner_id, selection_id, side, price, size, stake, liability, status)
      VALUES (${TENANT}, ${TENANT}, ${ids.user}, ${ids.sport}, ${ids.league}, ${ids.event}, ${ids.market}, ${ids.runner}, ${STAMP}, ${side}, ${price}, 100, 100, ${liability}, 'matched')`)
  }
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM sports_bets WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${TENANT}`)
    if (ids.runner) await db.execute(sql`DELETE FROM sports_runners WHERE id = ${ids.runner}`)
    if (ids.market) await db.execute(sql`DELETE FROM sports_markets WHERE id = ${ids.market}`)
    if (ids.event) await db.execute(sql`DELETE FROM sports_events WHERE id = ${ids.event}`)
    if (ids.league) await db.execute(sql`DELETE FROM sports_leagues WHERE id = ${ids.league}`)
    if (ids.sport) await db.execute(sql`DELETE FROM sports WHERE id = ${ids.sport}`)
  }
})

describe('live sports dashboard', () => {
  it('sums stakes for Total Stake and liabilities for Total Liability, in the KPIs and every breakdown', async () => {
    const { kpis, breakdown } = await repo.getSportsLiveDashboard({ tenant: TENANT, whitelabelId: TENANT })
    assert.equal(kpis.totalStake, 200)
    assert.equal(kpis.totalLiability, 250)
    for (const [name, list] of Object.entries({ bySport: breakdown.bySport, byLeague: breakdown.byLeague, byEvent: breakdown.byEvent, byMarketType: breakdown.byMarketType })) {
      assert.equal(list.length, 1, name)
      assert.deepEqual([list[0].totalStake, list[0].totalLiability], [200, 250], name)
    }
    const bySide = Object.fromEntries(breakdown.byBetSide.map((row) => [row.side, [row.totalStake, row.totalLiability]]))
    assert.deepEqual(bySide, { back: [100, 100], lay: [100, 150] })
  })
})
