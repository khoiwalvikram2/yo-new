/**
 * Bet List "settled" finds settled sports bets.
 *
 * Settlement stores a sports bet as won or lost, and the raw status list went
 * to the sports table, so Status = settled returned no sports bet (and under
 * Domain All silently dropped all of them from the list and totals), while
 * casino and matka mapped it to won+lost. An open status from the casino side
 * (active) was an enum error on the sports table.
 *
 * Requires DATABASE_URL. Builds its own inactive vfyfix catalogue chain, one
 * player and two settled sports bets (won, lost) in tenant vfyfix-g7-bets, and
 * removes them. No bet is left open at any point.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const TENANT = 'vfyfix-g7-bets'
const STAMP = `vfyfix-g7-bets-${Date.now()}`

let db: (typeof import('@src/db/client.js'))['db']
let bets: (typeof import('@src/domains/bets/resolvers/queries.js'))['betsQueryResolvers']
const ids = { sport: '', league: '', event: '', market: '', runner: '', user: 0 }
const ctx = {
  tenant: TENANT,
  whitelabel: { id: TENANT },
  user: { sub: '9301', type: 'admin', roles: ['Whitelabel Admin'] },
  permissions: [{ domain: 'sports', actions: ['read'] }, { domain: 'casino', actions: ['read'] }, { domain: 'matka', actions: ['read'] }],
}
const today = new Date().toISOString().slice(0, 10)
const range = { dateFrom: '2026-01-01', dateTo: today }

async function rows(query: ReturnType<typeof sql>): Promise<any[]> {
  const result: any = await db.execute(query)
  return Array.isArray(result) ? result : result?.rows ?? []
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  ;({ betsQueryResolvers: bets } = await import('@src/domains/bets/resolvers/queries.js'))
  ;[{ id: ids.sport }] = await rows(sql`INSERT INTO sports (sport_code, key, name, status) VALUES (${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.league }] = await rows(sql`INSERT INTO sports_leagues (sport_id, league_code, key, name, status) VALUES (${ids.sport}, ${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.event }] = await rows(sql`INSERT INTO sports_events (league_id, event_code, key, name, status) VALUES (${ids.league}, ${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.market }] = await rows(sql`INSERT INTO sports_markets (event_id, market_code, name, status) VALUES (${ids.event}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.runner }] = await rows(sql`INSERT INTO sports_runners (market_id, selection_code, name) VALUES (${ids.market}, ${STAMP}, ${STAMP}) RETURNING id`)
  ;[{ id: ids.user }] = await rows(sql`
    INSERT INTO users (tenant, name, username, status, password_hash) VALUES (${TENANT}, 'vfyfix g7 bettor', ${STAMP}, 'active', 'x') RETURNING id`)
  for (const status of ['won', 'lost']) {
    await db.execute(sql`
      INSERT INTO sports_bets (tenant, whitelabel_id, user_id, sport_id, league_id, event_id, market_id, runner_id, selection_id, side, price, size, stake, liability, status)
      VALUES (${TENANT}, ${TENANT}, ${ids.user}, ${ids.sport}, ${ids.league}, ${ids.event}, ${ids.market}, ${ids.runner}, ${STAMP}, 'back', 2, 100, 100, 100, ${status})`)
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

describe('Status = settled on the Bet List', () => {
  it('counts the won and lost sports bets, under Sports and under All', async () => {
    const totals = await bets.betsPageTotals(null, { filters: { ...range, status: ['settled'] } }, ctx)
    assert.equal(totals.totalSports, 2)
    assert.equal(totals.totalAll, 2)
    const page = await bets.betsPage(null, { domain: 'SPORTS', filters: { ...range, status: ['settled'] }, offset: 0, limit: 50 }, ctx)
    assert.equal(page.total, 2)
    assert.deepEqual(page.items.map((item: any) => item.status).sort(), ['lost', 'won'])
  })

  it('reads an open status from the casino side as open sports bets instead of failing', async () => {
    const totals = await bets.betsPageTotals(null, { filters: { ...range, status: ['active'] } }, ctx)
    assert.equal(totals.totalSports, 0)
    assert.equal((await bets.betsPageTotals(null, { filters: { ...range, status: ['won'] } }, ctx)).totalSports, 1)
  })
})
