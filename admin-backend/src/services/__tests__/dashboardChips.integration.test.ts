/**
 * The Executive Dashboard's credit figures on Deposit/Withdraw chips, against the real database (DATABASE_URL).
 * The file builds its own whitelabel tenant, moves chips through ChipService, then reads every repointed figure:
 * the Chip Movements section (credit_chip_ledger), Chips with Players, Settlement Due, the Agents tab's owed /
 * owing and credit agents, the low-on-chips insight, and their drill-downs. In after() it deletes every row of
 * that tenant and nothing else.
 *
 * Tree (tenant T, pool 1,000,000):
 *   A (root CREDIT, reference 12,000) ── B (CREDIT, reference 20,000)
 *   S (root SHARING)
 *   players: pA (AGENT_CREDIT of A, reference 400), pB (AGENT_CREDIT of B, reference 1,000, exposure 50),
 *            pW (WHITELABEL_CREDIT, reference 500), pR (REGULAR)
 * Moves: admin → A 10,000; A → B 4,000; B → pB 1,000; A → pA 500; admin → pW 300; B ← pB 200; admin ← A 1,000.
 * Chips after: A 4,500, B 3,200, pA 500, pB 800, pW 300.
 * Ref P/L: A = 4,500 + (3,200 + 500 + 800) - 12,000 = -3,000; B = 3,200 + 800 - 20,000 = -16,000;
 *          pW = 300 - 500 = -200.
 * The retired columns (agents.settlement_balance / credit_used / credit_available, users.credit_available,
 * whitelabels.settlement_balance) are then set to stale values the figures must ignore.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/services/__tests__/dashboardChips.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)
const SUFFIX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T = `dashchips-${SUFFIX}`
const POOL = 1_000_000
const startedAt = new Date(Date.now() - 60_000)

let db: any
let pgPool: any
let ops: typeof import('../dashboardOperationsService.js')
let tabs: typeof import('../dashboardTabsService.js')
let insights: typeof import('../dashboardInsightsService.js')
let drill: typeof import('../dashboardDrilldownService.js')

const ag = { A: '', B: '', S: '' }
const pl = { pA: 0, pB: 0, pW: 0, pR: 0 }
const name = (base: string) => `${base}-${SUFFIX}`

const scope = () => ({ tenant: T })
const range = () => ({ dateFrom: startedAt.toISOString(), dateTo: new Date(Date.now() + 60_000).toISOString() })

async function q(query: ReturnType<typeof sql>): Promise<any[]> {
  const r = await db.execute(query)
  return r?.rows ?? []
}

/** An agent with credentials and its closure rows, as createAgent maintains them. */
async function mkAgent(username: string, parentId: string | null, scheme = 'CREDIT'): Promise<string> {
  const [row] = await q(sql`
    INSERT INTO agents (tenant_id, scheme_type, allowed_domains, parent_agent_id, status)
    VALUES (${T}, ${scheme}, ARRAY['sports']::text[], ${parentId}, 'ACTIVE')
    RETURNING id::text AS id`)
  const id = String(row.id)
  await db.execute(sql`
    INSERT INTO agent_credentials (agent_id, tenant_id, username, password_hash)
    VALUES (${id}::uuid, ${T}, ${username}, 'x')`)
  await db.execute(sql`INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth) VALUES (${id}::uuid, ${id}::uuid, 0)`)
  if (parentId) {
    await db.execute(sql`
      INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth)
      SELECT ancestor_id, ${id}::uuid, depth + 1 FROM agent_hierarchy_closure WHERE descendant_id = ${parentId}::uuid`)
  }
  return id
}

async function mkPlayer(username: string, type: string, agentId: string | null): Promise<number> {
  const [row] = await q(sql`
    INSERT INTO users (tenant, name, username, password_hash, player_type, agent_id, status)
    VALUES (${T}, ${username + ' name'}, ${username}, 'x', ${type}, ${agentId}, 'active')
    RETURNING id`)
  const id = Number(row.id)
  await db.execute(sql`INSERT INTO wallets (tenant, user_id, currency) VALUES (${T}, ${id}, 'INR')`)
  return id
}

/** One drill-down row's cell by column key. */
function cellOf(result: { columns: Array<{ key: string }> }, row: { cells: Array<string | null> }, key: string): string | null {
  const index = result.columns.findIndex((c) => c.key === key)
  assert.ok(index >= 0, `no column ${key}`)
  return row.cells[index]
}

describe('dashboard credit figures on chips', { skip: !hasDb }, () => {
  before(async () => {
    ;({ db, pool: pgPool } = await import('@src/db/client.js'))
    const { ChipService } = await import('@src/domains/agents/services/ChipService.js')
    ops = await import('../dashboardOperationsService.js')
    tabs = await import('../dashboardTabsService.js')
    insights = await import('../dashboardInsightsService.js')
    drill = await import('../dashboardDrilldownService.js')
    const chips = new ChipService()
    const admin = { kind: 'admin' as const, tenant: T, userId: '999999999' }
    const agent = (agentId: string) => ({ kind: 'agent' as const, tenant: T, agentId })

    await db.execute(sql`
      INSERT INTO whitelabels (id, name, domain, status, credit_limit, credit_used, credit_available)
      VALUES (${T}, 'Dashboard Chips WL', ${T + '.test'}, 'active', ${POOL}, 0, ${POOL})`)
    ag.A = await mkAgent(name('dca'), null)
    ag.B = await mkAgent(name('dcb'), ag.A)
    ag.S = await mkAgent(name('dcs'), null, 'SHARING')
    pl.pA = await mkPlayer(name('dc-pa'), 'AGENT_CREDIT', ag.A)
    pl.pB = await mkPlayer(name('dc-pb'), 'AGENT_CREDIT', ag.B)
    pl.pW = await mkPlayer(name('dc-pw'), 'WHITELABEL_CREDIT', null)
    pl.pR = await mkPlayer(name('dc-pr'), 'REGULAR', null)

    await chips.depositChips(admin, { accountType: 'AGENT', accountId: ag.A, amount: 10_000 })
    await chips.depositChips(agent(ag.A), { accountType: 'AGENT', accountId: ag.B, amount: 4_000 })
    await chips.depositChips(agent(ag.B), { accountType: 'PLAYER', accountId: String(pl.pB), amount: 1_000, remark: 'first chips' })
    await chips.depositChips(agent(ag.A), { accountType: 'PLAYER', accountId: String(pl.pA), amount: 500 })
    await chips.depositChips(admin, { accountType: 'PLAYER', accountId: String(pl.pW), amount: 300 })
    await chips.withdrawChips(agent(ag.B), { accountType: 'PLAYER', accountId: String(pl.pB), amount: 200, remark: 'back' })
    await chips.withdrawChips(admin, { accountType: 'AGENT', accountId: ag.A, amount: 1_000 })
    await chips.setCreditReference(admin, { accountType: 'AGENT', accountId: ag.A, creditReference: 12_000 })
    await chips.setCreditReference(agent(ag.A), { accountType: 'AGENT', accountId: ag.B, creditReference: 20_000 })
    await chips.setCreditReference(agent(ag.A), { accountType: 'PLAYER', accountId: String(pl.pA), creditReference: 400 })
    await chips.setCreditReference(agent(ag.B), { accountType: 'PLAYER', accountId: String(pl.pB), creditReference: 1_000 })
    await chips.setCreditReference(admin, { accountType: 'PLAYER', accountId: String(pl.pW), creditReference: 500 })

    // An open sports liability on pB's chip wallet (its available chips are cash - exposure).
    await db.execute(sql`UPDATE wallets SET exposure = 50 WHERE user_id = ${pl.pB} AND tenant = ${T}`)
    // Stale values in the retired columns: no figure may read them.
    await db.execute(sql`UPDATE agents SET settlement_balance = 999, credit_used = 777, credit_available = 555 WHERE tenant_id = ${T}`)
    await db.execute(sql`UPDATE users SET credit_available = 4444, settlement_balance = 33 WHERE tenant = ${T}`)
    await db.execute(sql`UPDATE whitelabels SET settlement_balance = 8888 WHERE id = ${T}`)
  })

  after(async () => {
    if (db) {
      await db.execute(sql`DELETE FROM credit_chip_ledger WHERE tenant_id = ${T}`)
      await db.execute(sql`DELETE FROM agent_credit_ledger WHERE tenant_id = ${T}`)
      await db.execute(sql`DELETE FROM wallet_ledger WHERE tenant = ${T}`)
      await db.execute(sql`DELETE FROM ledger_entries WHERE tenant = ${T}`)
      await db.execute(sql`DELETE FROM wallets WHERE tenant = ${T}`)
      await db.execute(sql`DELETE FROM users WHERE tenant = ${T}`)
      await db.execute(sql`
        DELETE FROM agent_hierarchy_closure
        WHERE ancestor_id IN (SELECT id FROM agents WHERE tenant_id = ${T})
           OR descendant_id IN (SELECT id FROM agents WHERE tenant_id = ${T})`)
      await db.execute(sql`DELETE FROM agent_credentials WHERE tenant_id = ${T}`)
      await db.execute(sql`DELETE FROM agents WHERE tenant_id = ${T}`)
      await db.execute(sql`DELETE FROM whitelabels WHERE id = ${T}`)
    }
    const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
    await closeRedisEmitter().catch(() => {})
    await pgPool?.end().catch(() => {})
  })

  it('operations: chip movements come from credit_chip_ledger, each transfer once, by its parent', async () => {
    const o = await ops.getDashboardOperations(scope(), range())
    assert.equal(o.showCredit, true)
    assert.equal(o.chipsDepositedByWhitelabel, 10_300, 'admin → A and admin → pW')
    assert.equal(o.chipsDepositedByAgents, 5_500, 'A → B, B → pB, A → pA')
    assert.equal(o.chipsWithdrawnByWhitelabel, 1_000, 'admin ← A')
    assert.equal(o.chipsWithdrawnByAgents, 200, 'B ← pB')
    assert.equal(o.chipsGivenToAgents, 14_000, 'deposits received by A and B')
    assert.equal(o.creditAgentsActive, 2)
  })

  it('operations: chips with players, settlement due and the pool ignore the retired columns', async () => {
    const o = await ops.getDashboardOperations(scope(), range())
    assert.equal(o.chipsWithPlayers, 1_550, 'pA 500 + pB (800 - 50) + pW 300; not users.credit_available')
    assert.equal(o.settlementDue, -3_200, 'Ref P/L of A (-3,000) and pW (-200); not whitelabels.settlement_balance')
    assert.equal(o.creditLimit, POOL)
    assert.equal(o.creditAvailable, POOL - 9_300, 'the pool paid 10,300 out and took 1,000 back')
  })

  it('agents tab: owed / owing is the top CREDIT agents’ Ref P/L; the list and totals are in chips', async () => {
    const t = await tabs.getAgentsTab(scope(), range())
    assert.equal(t.network.credit, 2)
    assert.equal(t.settlementOwed, 0)
    assert.equal(t.settlementOwing, -3_000, 'A only: B sits under A, and S is not CREDIT')
    assert.equal(t.agentsWithBalance, 1)
    assert.deepEqual(
      t.creditAgents.map((a) => [a.agentId, a.creditLimit, a.creditUsed, a.creditAvailable, a.usedShare, a.refPnl]),
      [
        [ag.B, 20_000, 16_800, 3_200, 0.84, -16_000],
        [ag.A, 12_000, 7_500, 4_500, 0.625, -3_000],
      ]
    )
    assert.equal(t.creditLimit, 12_000, 'the top agent only')
    assert.equal(t.creditUsed, 7_500)
  })

  it('insights: agents low on chips replace agents near their credit limit', async () => {
    const i = await insights.getDashboardInsights(scope(), range(), { includeRisk: false })
    assert.equal(i.creditAgents, 2)
    assert.equal(i.nearLimitShare, insights.NEAR_LIMIT_SHARE)
    assert.deepEqual(
      i.agentsNearLimit.map((a) => [a.agentId, a.creditLimit, a.creditAvailable, a.usedShare, a.settlementBalance]),
      [[ag.B, 20_000, 3_200, 0.84, -16_000]],
      'B holds 16% of its reference; A still holds 37.5%'
    )
  })

  it('drill-down chip_moves: one row per transfer, the same totals as the figures', async () => {
    const every = await drill.getDashboardDrilldown(scope(), { kind: 'chip_moves', ...range(), limit: 50 })
    assert.equal(every.total, 7, '5 deposits and 2 withdrawals; reference changes move no chips')

    const wlIn = await drill.getDashboardDrilldown(scope(), { kind: 'chip_moves', arg: 'wl_in', ...range() })
    assert.equal(wlIn.total, 2)
    assert.equal(wlIn.rows.reduce((sum, row) => sum + Number(cellOf(wlIn, row, 'amount')), 0), 10_300)
    const toPw = wlIn.rows.find((row) => row.playerId === pl.pW)
    assert.ok(toPw, 'the deposit to pW links to the player')
    assert.equal(cellOf(wlIn, toPw, 'from_name'), 'Whitelabel')
    assert.equal(cellOf(wlIn, toPw, 'to_name'), name('dc-pw'))
    assert.equal(cellOf(wlIn, toPw, 'type'), 'Deposit')

    const agentOut = await drill.getDashboardDrilldown(scope(), { kind: 'chip_moves', arg: 'agent_out', ...range() })
    assert.equal(agentOut.total, 1)
    const back = agentOut.rows[0]
    assert.deepEqual(
      [cellOf(agentOut, back, 'from_name'), cellOf(agentOut, back, 'to_name'), cellOf(agentOut, back, 'type'), Number(cellOf(agentOut, back, 'amount')), cellOf(agentOut, back, 'reason')],
      [name('dc-pb'), name('dcb'), 'Withdraw', 200, 'back']
    )
    assert.equal(back.playerId, pl.pB)

    const toAgents = await drill.getDashboardDrilldown(scope(), { kind: 'chip_moves', arg: 'to_agents', ...range() })
    assert.deepEqual(toAgents.rows.map((row) => row.agentId).sort(), [ag.A, ag.B].sort())
  })

  it('drill-down credit_players: chip figures that add up to Chips with Players', async () => {
    const d = await drill.getDashboardDrilldown(scope(), { kind: 'credit_players', ...range() })
    assert.equal(d.total, 3)
    assert.equal(d.rows.reduce((sum, row) => sum + Number(cellOf(d, row, 'available')), 0), 1_550)
    const pB = d.rows.find((row) => row.playerId === pl.pB)
    assert.ok(pB)
    assert.deepEqual(
      ['credit_reference', 'balance', 'exposure', 'available', 'ref_pnl'].map((key) => Number(cellOf(d, pB, key))),
      [1_000, 800, 50, 750, -200]
    )
  })

  it('drill-down agents: CREDIT agents show their reference and chips, not credit used', async () => {
    const d = await drill.getDashboardDrilldown(scope(), { kind: 'agents', arg: 'CREDIT', ...range() })
    assert.equal(d.total, 2)
    assert.ok(!d.columns.some((c) => c.key === 'credit_used'))
    const a = d.rows.find((row) => row.agentId === ag.A)
    assert.ok(a)
    assert.deepEqual([Number(cellOf(d, a, 'credit_reference')), Number(cellOf(d, a, 'chips'))], [12_000, 4_500])
    const sharing = await drill.getDashboardDrilldown(scope(), { kind: 'agents', ...range() })
    const s = sharing.rows.find((row) => row.agentId === ag.S)
    assert.ok(s)
    assert.deepEqual([cellOf(sharing, s, 'credit_reference'), cellOf(sharing, s, 'chips')], [null, null])
  })
})
