/**
 * Three sports reads answer for the caller.
 *
 * - leaguesWithOpenBets / eventsWithOpenBets / marketsWithOpenBets (the
 *   declare-result pickers) read every whitelabel's open bets, so another
 *   brand, or any agent, saw where a brand's players held open bets. They now
 *   follow the declaration's own reach: the platform (all:*) sees every brand,
 *   a whitelabel its own, an agent its own players'.
 * - sportsResults' search matched the declarer's hidden user id, never the
 *   name the list shows; it now matches the name (and the event name).
 * - sports sent updatedAt as epoch milliseconds ("Invalid Date" in the UI); it
 *   is ISO now, like leagues and events.
 *
 * Requires DATABASE_URL. Builds an inactive vfyfix catalogue chain, an agent,
 * two players, a declaring admin, open bets and one result in tenant
 * vfyfix-g7-reads (all prefixed vfyfix-g7), and removes them.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const OWN = 'vfyfix-g7-reads'
const OTHER = 'vfyfix-g7-reads-other'
const STAMP = `vfyfix-g7-reads-${Date.now()}`

let db: (typeof import('@src/db/client.js'))['db']
let queries: (typeof import('@src/domains/sports/resolvers/queries.js'))['sportsQueryResolvers']
const ids = { sport: '', league: '', event: '', market: '', runner: '', agent: '', agentPlayer: 0, player: 0, declarer: 0 }

const adminOf = (tenant: string) => ({ tenant, whitelabel: { id: tenant }, user: { sub: '9401', type: 'admin', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'sports', actions: ['read', 'write'] }] })
const platform = { tenant: 'default', whitelabel: { id: 'default' }, user: { sub: '9400', type: 'admin', roles: ['Super Admin'] }, directorMode: 'core', permissions: [{ domain: 'all', actions: ['*'] }] }
const agentCtx = () => ({ tenant: OWN, whitelabel: { id: OWN }, user: { sub: '9402', type: 'agent', agentId: ids.agent }, permissions: [{ domain: 'sports.events', actions: ['view'] }] })

async function rows(query: ReturnType<typeof sql>): Promise<any[]> {
  const result: any = await db.execute(query)
  return Array.isArray(result) ? result : result?.rows ?? []
}
async function openBet(userId: number) {
  await db.execute(sql`
    INSERT INTO sports_bets (tenant, whitelabel_id, user_id, sport_id, league_id, event_id, market_id, runner_id, selection_id, side, price, size, stake, liability, status)
    VALUES (${OWN}, ${OWN}, ${userId}, ${ids.sport}, ${ids.league}, ${ids.event}, ${ids.market}, ${ids.runner}, ${STAMP}, 'back', 2, 10, 10, 10, 'matched')`)
}
async function pickers(ctx: any) {
  const leagues = await queries.leaguesWithOpenBets(null, { sportId: ids.sport }, ctx)
  const events = await queries.eventsWithOpenBets(null, { leagueId: ids.league }, ctx)
  const markets = await queries.marketsWithOpenBets(null, { eventId: ids.event }, ctx)
  return [leagues, events, markets].map((list: any[]) => list.map((row) => row.id))
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  ;({ sportsQueryResolvers: queries } = await import('@src/domains/sports/resolvers/queries.js'))
  ;[{ id: ids.sport }] = await rows(sql`INSERT INTO sports (sport_code, key, name, status) VALUES (${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.league }] = await rows(sql`INSERT INTO sports_leagues (sport_id, league_code, key, name, status) VALUES (${ids.sport}, ${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.event }] = await rows(sql`INSERT INTO sports_events (league_id, event_code, key, name, status) VALUES (${ids.league}, ${STAMP}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.market }] = await rows(sql`INSERT INTO sports_markets (event_id, market_code, name, status) VALUES (${ids.event}, ${STAMP}, ${STAMP}, 'inactive') RETURNING id`)
  ;[{ id: ids.runner }] = await rows(sql`INSERT INTO sports_runners (market_id, selection_code, name) VALUES (${ids.market}, ${STAMP}, ${STAMP}) RETURNING id`)
  ;[{ id: ids.agent }] = await rows(sql`
    INSERT INTO agents (tenant_id, scheme_type, allowed_domains, status) VALUES (${OWN}, 'CREDIT', ARRAY['sports']::text[], 'ACTIVE') RETURNING id`)
  await db.execute(sql`INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth) VALUES (${ids.agent}, ${ids.agent}, 0) ON CONFLICT DO NOTHING`)
  ;[{ id: ids.agentPlayer }] = await rows(sql`
    INSERT INTO users (tenant, name, username, status, password_hash, agent_id) VALUES (${OWN}, 'vfyfix agent player', ${STAMP + '-ap'}, 'active', 'x', ${ids.agent}) RETURNING id`)
  ;[{ id: ids.player }] = await rows(sql`
    INSERT INTO users (tenant, name, username, status, password_hash) VALUES (${OWN}, 'vfyfix player', ${STAMP + '-p'}, 'active', 'x') RETURNING id`)
  ;[{ id: ids.declarer }] = await rows(sql`
    INSERT INTO users (tenant, name, username, status, password_hash) VALUES (${OWN}, ${STAMP + ' declarer'}, ${STAMP + '-d'}, 'active', 'x') RETURNING id`)
  await openBet(ids.player)
  await db.execute(sql`
    INSERT INTO sports_results (tenant, whitelabel_id, sport_id, league_id, event_id, market_id, market_type, runner_id, selection_name, declared_by)
    VALUES (${OWN}, ${OWN}, ${ids.sport}, ${ids.league}, ${ids.event}, ${ids.market}, 'exchange', ${ids.runner}, 'vfyfix selection', ${String(ids.declarer)})`)
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM sports_results WHERE tenant = ${OWN}`)
    await db.execute(sql`DELETE FROM sports_bets WHERE tenant = ${OWN}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${OWN}`)
    if (ids.agent) {
      await db.execute(sql`DELETE FROM agent_hierarchy_closure WHERE ancestor_id = ${ids.agent}`)
      await db.execute(sql`DELETE FROM agents WHERE id = ${ids.agent}`)
    }
    if (ids.runner) await db.execute(sql`DELETE FROM sports_runners WHERE id = ${ids.runner}`)
    if (ids.market) await db.execute(sql`DELETE FROM sports_markets WHERE id = ${ids.market}`)
    if (ids.event) await db.execute(sql`DELETE FROM sports_events WHERE id = ${ids.event}`)
    if (ids.league) await db.execute(sql`DELETE FROM sports_leagues WHERE id = ${ids.league}`)
    if (ids.sport) await db.execute(sql`DELETE FROM sports WHERE id = ${ids.sport}`)
  }
})

describe('the declare-result pickers', () => {
  it("list a whitelabel's open bets to that whitelabel and the platform, not to another whitelabel", async () => {
    const own = [[ids.league], [ids.event], [ids.market]]
    assert.deepEqual(await pickers(adminOf(OWN)), own)
    assert.deepEqual(await pickers(platform), own)
    assert.deepEqual(await pickers(adminOf(OTHER)), [[], [], []])
    // A Super Admin in whitelabel mode settles that whitelabel only, so reads it only.
    assert.deepEqual(await pickers({ ...platform, tenant: OTHER, whitelabel: { id: OTHER }, directorMode: 'whitelabel' }), [[], [], []])
  })

  it("show an agent only its own players' open bets", async () => {
    assert.deepEqual(await pickers(agentCtx()), [[], [], []])
    await openBet(ids.agentPlayer)
    assert.deepEqual(await pickers(agentCtx()), [[ids.league], [ids.event], [ids.market]])
    assert.deepEqual(await pickers({ ...agentCtx(), user: { sub: '9402', type: 'agent' } }), [[], [], []])
  })
})

describe('the results search', () => {
  it('finds results by the declarer name the list shows, and by the event name', async () => {
    const search = async (text: string) => (await queries.sportsResults(null, { query: { search: text } }, adminOf(OWN))).items.map((item: any) => item.declaredByName)
    assert.deepEqual(await search(`${STAMP} declarer`), [`${STAMP} declarer`])
    assert.deepEqual(await search(STAMP), [`${STAMP} declarer`])
    assert.deepEqual(await search('vfyfix selection'), [`${STAMP} declarer`])
    assert.deepEqual(await search(`${STAMP}-nobody`), [])
  })
})

describe('the sports list', () => {
  it('sends updatedAt as an ISO time', async () => {
    const sport = (await queries.sports(null, {}, adminOf(OWN))).find((row: any) => row.id === ids.sport)
    assert.match(String(sport?.updatedAt), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})
