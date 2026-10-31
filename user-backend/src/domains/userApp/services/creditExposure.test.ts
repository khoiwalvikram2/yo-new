/**
 * Credit players: credit_used = sports book exposure + open casino stake (plan W5, D1/D6).
 *
 * No database: a drizzle pg-proxy instance answers every statement from a scripted
 * router, so the real recalculation code runs (builder selects and raw SQL alike) and
 * every statement it sends is recorded for assertions.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { sql } from 'drizzle-orm'
import {
  recalculateAndUpdateExposure,
  syncCreditPlayerOpenExposureInTx,
  projectedCreditHeadroom,
} from './exposureCalculationService.js'
import * as exposureService from './exposureCalculationService.js'
import { getOpenCasinoStake } from '@shared/services/credit/casinoCredit.js'

type Stmt = { sql: string; params: unknown[]; method: string }
type Route = { match: (s: string) => boolean; rows: Record<string, unknown>[] }

/** Column names of a drizzle builder select, in order (rows go back as arrays in that order). */
function selectColumns(sqlText: string): string[] {
  const m = /^select (.+?) from /is.exec(sqlText.trim())
  if (!m) return []
  return m[1].split(/,\s*/).map((c) => {
    const ids = c.match(/"([^"]+)"/g)
    return ids ? ids[ids.length - 1].replace(/"/g, '') : c.trim()
  })
}

function fakeDb(routes: Route[]) {
  const log: Stmt[] = []
  const db = drizzle(async (sqlText: string, params: unknown[], method: string) => {
    log.push({ sql: sqlText, params, method })
    const flat = sqlText.replace(/\s+/g, ' ').toLowerCase()
    const route = routes.find((r) => r.match(flat))
    const rows = route ? route.rows : []
    if (method === 'all') {
      const cols = selectColumns(sqlText)
      return { rows: rows.map((r) => cols.map((c) => r[c])) }
    }
    return { rows }
  })
  return { db, log }
}

const has = (...parts: string[]) => (s: string) => parts.every((p) => s.includes(p))

const USER_ID = 4242
const TENANT = 'w5test'
const AGENT_ID = '00000000-0000-0000-0000-0000000000a1'

function creditPlayerRoutes(opts: { sportsStake: number; openCasino: number; apcOpenExposure: number }): Route[] {
  return [
    // recalculateAndUpdateExposure: player lookup (builder select)
    {
      match: has('from "users"', 'select "player_type"'),
      rows: [{ player_type: 'AGENT_CREDIT', credit_limit: '1000', settlement_balance: '50', agent_id: AGENT_ID, name: 'p', username: 'p', phone: '1' }],
    },
    // sports book: one open fancy BACK bet, worst case = -stake
    {
      match: has('from "sports_bets"'),
      rows: opts.sportsStake > 0
        ? [{ id: 'b1', market_id: 'm1', selection_id: 's1', side: 'back', price: '50', stake: String(opts.sportsStake), odds_size: '100' }]
        : [],
    },
    { match: has('from "sports_markets"'), rows: [{ id: 'm1', type: 'fancy', event_id: 'e1' }] },
    { match: has('from "wallets"'), rows: [{ cash: '0', bonus: '0', currency: 'INR', exposure: '0' }] },
    // syncCreditPlayerOpenExposureInTx: locked credit row
    {
      match: has('select player_type, agent_id::text as agent_id', 'from users', 'for update'),
      rows: [{ player_type: 'AGENT_CREDIT', agent_id: AGENT_ID, credit_limit: '1000', settlement_balance: '50' }],
    },
    { match: has('from casino_bets'), rows: [{ total: String(opts.openCasino) }] },
    {
      match: has('from agent_player_credits', 'for update'),
      rows: [{ credit_limit: '1000', current_balance: '0', open_exposure: String(opts.apcOpenExposure) }],
    },
  ]
}

test('recalc: credit_used = sports exposure + open casino stake (casino lock is kept)', async () => {
  const { db, log } = fakeDb(creditPlayerRoutes({ sportsStake: 300, openCasino: 200, apcOpenExposure: 300 }))

  const sports = await recalculateAndUpdateExposure(USER_ID, TENANT, db)
  assert.equal(sports, 300, 'return value stays the sports book exposure (wallet.exposure)')

  const userUpdate = log.find((s) => /^\s*update users/i.test(s.sql))
  assert.ok(userUpdate, 'users row is updated')
  assert.deepEqual(userUpdate!.params.slice(0, 2).map(Number), [500, 550], 'credit_used 300+200, available 1000-500+50')

  const apcUpdate = log.find((s) => /update agent_player_credits/i.test(s.sql))
  assert.ok(apcUpdate)
  assert.deepEqual(apcUpdate!.params.slice(0, 3).map(Number), [500, 500, 500], 'open_exposure / credit_used follow the same figure')

  // The users row lock is taken before the sports book is read.
  const lockIdx = log.findIndex((s) => /select id from users/i.test(s.sql) && /for update/i.test(s.sql))
  const sportsIdx = log.findIndex((s) => s.sql.includes('"sports_bets"'))
  assert.ok(lockIdx >= 0 && lockIdx < sportsIdx, 'credit player row locked before the exposure is computed')
})

test('recalc: the agent row is never read or written (W7: exposure is not cascaded into the agent)', async () => {
  // Exposure grows 300 -> 500. Before W7 the 200 delta was added to the agent's
  // credit_used, which already counts this player's whole limit: counted twice.
  const { db, log } = fakeDb(creditPlayerRoutes({ sportsStake: 300, openCasino: 200, apcOpenExposure: 300 }))
  await recalculateAndUpdateExposure(USER_ID, TENANT, db)

  assert.equal(log.filter((s) => /from agents/i.test(s.sql)).length, 0, 'agents row is never read')
  assert.equal(log.filter((s) => /update agents/i.test(s.sql)).length, 0, 'agents row is never written')
  const apcUpdate = log.find((s) => /update agent_player_credits/i.test(s.sql))
  assert.ok(apcUpdate, "the agent's view of this player still follows the exposure")
  // apc credit_available = limit 1000 - used 500 + current_balance 0
  assert.equal(Number(apcUpdate!.params[2]), 500)
})

test('the exposure cascade helper is gone (W7)', () => {
  assert.equal((exposureService as Record<string, unknown>).cascadePlayerExposureDeltaToAgent, undefined)
})

test('recalc: no open sports bets still keeps the open casino stake', async () => {
  const { db, log } = fakeDb(creditPlayerRoutes({ sportsStake: 0, openCasino: 750, apcOpenExposure: 750 }))
  await recalculateAndUpdateExposure(USER_ID, TENANT, db)
  const userUpdate = log.find((s) => /^\s*update users/i.test(s.sql))
  assert.equal(Number(userUpdate!.params[0]), 750, 'before the fix this wrote 0 and freed the casino credit')
  assert.equal(log.filter((s) => /update agents/i.test(s.sql)).length, 0, 'no change, no agent write')
})

test('syncCreditPlayerOpenExposureInTx: non-credit player is left alone', async () => {
  const { db, log } = fakeDb([
    { match: has('from users', 'for update'), rows: [{ player_type: 'REGULAR', agent_id: null, credit_limit: '0', settlement_balance: '0' }] },
  ])
  const res = await syncCreditPlayerOpenExposureInTx(db, { userId: USER_ID, tenant: TENANT, sportsExposure: 100 })
  assert.equal(res, null)
  assert.equal(log.filter((s) => /^\s*update/i.test(s.sql)).length, 0)
})

test('getOpenCasinoStake: sums pending/active stakes for the player and tenant', async () => {
  const { db, log } = fakeDb([{ match: has('from casino_bets'), rows: [{ total: '125.50' }] }])
  const total = await getOpenCasinoStake(db, USER_ID, TENANT)
  assert.equal(total, 125.5)
  assert.match(log[0].sql, /status IN \('pending', 'active'\)/)
  assert.deepEqual(log[0].params, [USER_ID, TENANT])
})

test('sports credit check: open casino stake counts against the credit limit', () => {
  // limit 1000 + settlement 0; projected sports exposure 500 fits on its own...
  assert.equal(
    projectedCreditHeadroom({ creditLimit: 1000, settlementBalance: 0, projectedSportsExposure: 500, openCasinoStake: 0 }),
    500
  )
  // ...but not with 600 of casino stake still locked: the bet must be refused.
  const headroom = projectedCreditHeadroom({
    creditLimit: 1000,
    settlementBalance: 0,
    projectedSportsExposure: 500,
    openCasinoStake: 600,
  })
  assert.ok(headroom < 0)
  assert.equal(headroom, -100)
  // Settlement (realised P&L) still extends or shrinks the room.
  assert.equal(
    projectedCreditHeadroom({ creditLimit: 1000, settlementBalance: 200, projectedSportsExposure: 500, openCasinoStake: 600 }),
    100
  )
})

test('fake router sanity: raw execute returns rows', async () => {
  const { db } = fakeDb([{ match: has('select 1'), rows: [{ one: 1 }] }])
  const rows: any = await db.execute(sql`select 1 as one`)
  assert.equal(rows[0].one, 1)
})
