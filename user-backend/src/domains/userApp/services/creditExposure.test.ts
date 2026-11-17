/**
 * Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) on Deposit/Withdraw chips: their chips sit
 * in wallets.cash and their sports liability in wallets.exposure, exactly like a cash player.
 * The exposure recalculation therefore writes wallets.exposure only. It no longer rewrites
 * users.credit_used / credit_available, takes no users row lock, reads no open casino stake
 * and never touches agent_player_credits or the agent row.
 *
 * No database: a drizzle pg-proxy instance answers every statement from a scripted
 * router, so the real recalculation code runs (builder selects and raw SQL alike) and
 * every statement it sends is recorded for assertions.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { sql } from 'drizzle-orm'
import { recalculateAndUpdateExposure } from './exposureCalculationService.js'
import * as exposureService from './exposureCalculationService.js'

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
const TENANT = 'dwtest'
const AGENT_ID = '00000000-0000-0000-0000-0000000000a1'

function routes(opts: { sportsStake: number; cash: number; exposure: number }): Route[] {
  return [
    {
      match: has('from "users"'),
      rows: [{ agent_id: AGENT_ID, name: 'p', username: 'p', phone: '1', player_type: 'AGENT_CREDIT' }],
    },
    // sports book: one open fancy BACK bet, worst case = -stake
    {
      match: has('from "sports_bets"'),
      rows: opts.sportsStake > 0
        ? [{ id: 'b1', market_id: 'm1', selection_id: 's1', side: 'back', price: '50', stake: String(opts.sportsStake), odds_size: '100' }]
        : [],
    },
    { match: has('from "sports_markets"'), rows: [{ id: 'm1', type: 'fancy', event_id: 'e1' }] },
    {
      match: has('select', 'from "wallets"'),
      rows: [{ cash: String(opts.cash), bonus: '0', currency: 'INR', exposure: String(opts.exposure) }],
    },
  ]
}

const writes = (log: Stmt[]) => log.filter((s) => /^\s*(update|insert|delete)\b/i.test(s.sql))
/** Anything the old credit model did on recalculation. */
const creditModelStatement = (s: Stmt) =>
  /player_type|credit_used|credit_available|settlement_balance|agent_player_credits|casino_bets|matka_bets|\bagents\b|for update/i.test(s.sql)

test('recalc: a credit player gets wallets.exposure only (no credit_used, no apc, no agent, no users lock)', async () => {
  const { db, log } = fakeDb(routes({ sportsStake: 300, cash: 1000, exposure: 0 }))

  const exposure = await recalculateAndUpdateExposure(USER_ID, TENANT, db)
  assert.equal(exposure, 300, 'the sports book exposure')

  const w = writes(log)
  assert.equal(w.length, 1, 'one write: the wallet exposure')
  assert.match(w[0].sql, /^update "wallets" set "exposure" = \$1/i)
  assert.equal(String(w[0].params[0]), '300')
  assert.deepEqual(log.filter(creditModelStatement).map((s) => s.sql), [], 'nothing from the old credit model runs')
})

test('recalc: no open sports bets sets wallets.exposure to 0 and writes nothing else', async () => {
  const { db, log } = fakeDb(routes({ sportsStake: 0, cash: 1000, exposure: 300 }))
  const exposure = await recalculateAndUpdateExposure(USER_ID, TENANT, db)
  assert.equal(exposure, 0)
  const w = writes(log)
  assert.equal(w.length, 1)
  assert.match(w[0].sql, /^update "wallets"/i)
  assert.equal(String(w[0].params[0]), '0')
  assert.deepEqual(log.filter(creditModelStatement).map((s) => s.sql), [])
})

test('recalc: the high exposure alert covers credit players too (their chips are cash)', async () => {
  // cash 350, exposure 0 -> 300 = 85.7% of the balance: crosses the 80% line.
  const { db, log } = fakeDb(routes({ sportsStake: 300, cash: 350, exposure: 0 }))
  await recalculateAndUpdateExposure(USER_ID, TENANT, db)
  const alert = log.find((s) => /^\s*insert into "notifications"/i.test(s.sql))
  assert.ok(alert, 'the alert is no longer skipped for credit players')
})

test('the credit-only exposure helpers are gone', () => {
  const mod = exposureService as Record<string, unknown>
  assert.equal(mod.syncCreditPlayerOpenExposureInTx, undefined, 'credit_used is no longer rewritten from the book')
  assert.equal(mod.projectedCreditHeadroom, undefined, 'sports placement checks cash − exposure for every player')
  assert.equal(mod.cascadePlayerExposureDeltaToAgent, undefined)
})

test('fake router sanity: raw execute returns rows', async () => {
  const { db } = fakeDb([{ match: has('select 1'), rows: [{ one: 1 }] }])
  const rows: any = await db.execute(sql`select 1 as one`)
  assert.equal(rows[0].one, 1)
})
