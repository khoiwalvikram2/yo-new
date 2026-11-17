/**
 * Operations "Players Wallet Balance" (walletBalance) is the cash players' wallets.cash only. A credit player's
 * (AGENT_CREDIT, WHITELABEL_CREDIT) wallets.cash holds its Deposit/Withdraw chips (spec
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md §2), which Chips with Players already counts; counting
 * them in both figures would show the same chips twice.
 *
 * Against the real database (DATABASE_URL): the file builds its own whitelabel tenant with one player of each type
 * and in after() deletes every row of that tenant and nothing else.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/services/__tests__/dashboardWalletBalance.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)
const SUFFIX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T = `dashwallet-${SUFFIX}`

let db: any
let pgPool: any
let ops: typeof import('../dashboardOperationsService.js')

async function mkPlayer(username: string, type: string, cash: number, exposure = 0): Promise<number> {
  const r = await db.execute(sql`
    INSERT INTO users (tenant, name, username, password_hash, player_type, status)
    VALUES (${T}, ${username + ' name'}, ${username}, 'x', ${type}, 'active')
    RETURNING id`)
  const id = Number(r.rows[0].id)
  await db.execute(sql`INSERT INTO wallets (tenant, user_id, currency, cash, exposure) VALUES (${T}, ${id}, 'INR', ${cash}, ${exposure})`)
  return id
}

describe('dashboard operations: walletBalance counts the cash players only', { skip: !hasDb }, () => {
  before(async () => {
    ;({ db, pool: pgPool } = await import('@src/db/client.js'))
    ops = await import('../dashboardOperationsService.js')
    await db.execute(sql`
      INSERT INTO whitelabels (id, name, domain, status, credit_limit, credit_used, credit_available)
      VALUES (${T}, 'Dashboard Wallet WL', ${T + '.test'}, 'active', 0, 0, 0)`)
    await mkPlayer(`dw-regular-${SUFFIX}`, 'REGULAR', 1_000)
    await mkPlayer(`dw-sharing-${SUFFIX}`, 'SHARING_AGENT_PLAYER', 200)
    await mkPlayer(`dw-commission-${SUFFIX}`, 'COMMISSION_AGENT_PLAYER', 30)
    await mkPlayer(`dw-agentcredit-${SUFFIX}`, 'AGENT_CREDIT', 500)
    await mkPlayer(`dw-wlcredit-${SUFFIX}`, 'WHITELABEL_CREDIT', 300, 50)
  })

  after(async () => {
    if (db) {
      await db.execute(sql`DELETE FROM wallets WHERE tenant = ${T}`)
      await db.execute(sql`DELETE FROM users WHERE tenant = ${T}`)
      await db.execute(sql`DELETE FROM whitelabels WHERE id = ${T}`)
    }
    await pgPool?.end().catch(() => {})
  })

  it("the credit players' chips are in Chips with Players, not in Players Wallet Balance", async () => {
    const now = Date.now()
    const o = await ops.getDashboardOperations({ tenant: T }, { dateFrom: new Date(now - 60_000).toISOString(), dateTo: new Date(now + 60_000).toISOString() })
    assert.equal(o.walletBalance, 1_230, 'REGULAR 1,000 + SHARING_AGENT_PLAYER 200 + COMMISSION_AGENT_PLAYER 30')
    assert.equal(o.chipsWithPlayers, 750, 'AGENT_CREDIT 500 + WHITELABEL_CREDIT (300 - 50)')
  })
})
