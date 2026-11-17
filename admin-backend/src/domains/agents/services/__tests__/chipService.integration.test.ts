/**
 * ChipService against the real database (DATABASE_URL). The file builds its own whitelabel tenant, runs every
 * operation through the service, and in after() deletes every row of that tenant and nothing else.
 *
 * Tree (tenant T, pool 1,000,000 available):
 *   A (root CREDIT) ─┬─ B ── C
 *                    └─ D
 *   players: pA (AGENT_CREDIT of A), pB (of B), pC (of C), pW (WHITELABEL_CREDIT, no wallet yet), pR (REGULAR)
 *   S: a root SHARING agent.
 *
 * The tests run in order and share state; each says what it expects the balances to be. The lock-order test
 * wraps ChipRepo and the pool port to record every lock and write in the order ChipService makes them.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/chipService.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)
const T = `chiptest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const POOL = 1_000_000

let db: any
let pgPool: any
let svc: import('../ChipService.js').ChipService
let ChipError: typeof import('../ChipService.js').ChipError

const ag = { A: '', B: '', C: '', D: '', S: '' }
const pl = { pA: 0, pB: 0, pC: 0, pW: 0, pR: 0 }

const admin = () => ({ kind: 'admin' as const, tenant: T, userId: '999999999' })
const agent = (agentId: string) => ({ kind: 'agent' as const, tenant: T, agentId })

async function q(executor: any, query: ReturnType<typeof sql>): Promise<any[]> {
  const r = await executor.execute(query)
  return r?.rows ?? []
}

/** A CREDIT (or other scheme) agent with credentials and its closure rows, as createAgent maintains them. */
async function mkAgent(executor: any, username: string, parentId: string | null, scheme = 'CREDIT'): Promise<string> {
  const [row] = await q(executor, sql`
    INSERT INTO agents (tenant_id, scheme_type, allowed_domains, parent_agent_id, status)
    VALUES (${T}, ${scheme}, ARRAY['sports']::text[], ${parentId}, 'ACTIVE')
    RETURNING id::text AS id`)
  const id = String(row.id)
  await executor.execute(sql`
    INSERT INTO agent_credentials (agent_id, tenant_id, username, password_hash)
    VALUES (${id}::uuid, ${T}, ${username}, 'x')`)
  await executor.execute(sql`INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth) VALUES (${id}::uuid, ${id}::uuid, 0)`)
  if (parentId) {
    await executor.execute(sql`
      INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth)
      SELECT ancestor_id, ${id}::uuid, depth + 1 FROM agent_hierarchy_closure WHERE descendant_id = ${parentId}::uuid`)
  }
  return id
}

async function mkPlayer(executor: any, username: string, type: string, agentId: string | null, withWallet = true): Promise<number> {
  const [row] = await q(executor, sql`
    INSERT INTO users (tenant, name, username, password_hash, player_type, agent_id, status)
    VALUES (${T}, ${username + ' name'}, ${username}, 'x', ${type}, ${agentId}, 'active')
    RETURNING id`)
  const id = Number(row.id)
  if (withWallet) await executor.execute(sql`INSERT INTO wallets (tenant, user_id, currency) VALUES (${T}, ${id}, 'INR')`)
  return id
}

async function chips(agentId: string): Promise<number> {
  const [row] = await q(db, sql`SELECT chip_balance FROM agents WHERE id = ${agentId}::uuid`)
  return Number(row.chip_balance)
}

async function wallet(playerId: number): Promise<{ cash: number; exposure: number } | null> {
  const [row] = await q(db, sql`SELECT cash, exposure FROM wallets WHERE user_id = ${playerId} AND tenant = ${T} ORDER BY id LIMIT 1`)
  return row ? { cash: Number(row.cash), exposure: Number(row.exposure) } : null
}

async function poolAvailable(): Promise<number> {
  const [row] = await q(db, sql`SELECT credit_available FROM whitelabels WHERE id = ${T}`)
  return Number(row.credit_available)
}

async function transferRows(transferId: string): Promise<any[]> {
  return q(db, sql`
    SELECT account_type::text AS account_type, account_id, counterparty_type::text AS counterparty_type, counterparty_id,
      kind::text AS kind, amount::float8 AS amount, balance_before::float8 AS before, balance_after::float8 AS after,
      credit_reference_before::float8 AS cr_before, credit_reference_after::float8 AS cr_after, remark, created_by, created_by_type
    FROM credit_chip_ledger WHERE transfer_id = ${transferId}::uuid AND tenant_id = ${T}
    ORDER BY account_type`)
}

async function lastPoolLedger(): Promise<{ transaction_type: string; reason: string }> {
  const [row] = await q(db, sql`
    SELECT transaction_type::text AS transaction_type, reason FROM agent_credit_ledger
    WHERE tenant_id = ${T} ORDER BY created_at DESC, id DESC LIMIT 1`)
  return row
}

const code = (expected: string, message?: string | RegExp) => (err: unknown) => {
  assert.ok(err instanceof ChipError, `expected a ChipError, got: ${String((err as Error)?.message ?? err)}`)
  assert.equal((err as InstanceType<typeof ChipError>).code, expected, (err as Error).message)
  if (typeof message === 'string') assert.equal((err as Error).message, message)
  else if (message) assert.match((err as Error).message, message)
  return true
}

describe('ChipService against the database', { skip: !hasDb }, () => {
  before(async () => {
    ;({ db, pool: pgPool } = await import('@src/db/client.js'))
    const chipModule = await import('../ChipService.js')
    ChipError = chipModule.ChipError
    svc = new chipModule.ChipService()

    await db.execute(sql`
      INSERT INTO whitelabels (id, name, domain, status, credit_limit, credit_used, credit_available)
      VALUES (${T}, 'Chip Test WL', ${T + '.test'}, 'active', ${POOL}, 0, ${POOL})`)
    ag.A = await mkAgent(db, 'chipa', null)
    ag.B = await mkAgent(db, 'chipb', ag.A)
    ag.C = await mkAgent(db, 'chipc', ag.B)
    ag.D = await mkAgent(db, 'chipd', ag.A)
    ag.S = await mkAgent(db, 'chips-sharing', null, 'SHARING')
    pl.pA = await mkPlayer(db, 'chip-pa', 'AGENT_CREDIT', ag.A)
    pl.pB = await mkPlayer(db, 'chip-pb', 'AGENT_CREDIT', ag.B)
    pl.pC = await mkPlayer(db, 'chip-pc', 'AGENT_CREDIT', ag.C)
    pl.pW = await mkPlayer(db, 'chip-pw', 'WHITELABEL_CREDIT', null, false)
    pl.pR = await mkPlayer(db, 'chip-pr', 'REGULAR', null)
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

  it('admin → root CREDIT agent: the pool pays, two ledger rows share one transfer id', async () => {
    const r = await svc.depositChips(admin(), { accountType: 'AGENT', accountId: ag.A, amount: 10000, remark: 'seed' })
    assert.equal(r.account.id, ag.A)
    assert.equal(r.account.balance, 10000)
    assert.equal(r.parent, null)
    assert.equal(r.pool?.available, POOL - 10000)
    assert.equal(await chips(ag.A), 10000)
    assert.equal(await poolAvailable(), POOL - 10000)

    const rows = await transferRows(r.transferId)
    assert.equal(rows.length, 2)
    const [agentRow, poolRow] = rows // ordered by account_type: agent, whitelabel
    assert.deepEqual(
      [agentRow.account_type, agentRow.account_id, agentRow.counterparty_type, agentRow.counterparty_id, agentRow.kind, agentRow.amount, agentRow.before, agentRow.after],
      ['agent', ag.A, 'whitelabel', T, 'DEPOSIT', 10000, 0, 10000]
    )
    assert.deepEqual(
      [poolRow.account_type, poolRow.account_id, poolRow.counterparty_type, poolRow.counterparty_id, poolRow.amount, poolRow.before, poolRow.after],
      ['whitelabel', T, 'agent', ag.A, -10000, POOL, POOL - 10000]
    )
    assert.ok(rows.every((x) => x.remark === 'seed' && x.created_by === '999999999' && x.created_by_type === 'admin'))
    // The pool's own row goes through WhitelabelCreditService and must not read as a cash deposit.
    assert.deepEqual(await lastPoolLedger(), { transaction_type: 'USAGE', reason: 'Chips to agent chipa' })
  })

  it('agent → its direct sub-agent, and that sub-agent → its own sub-agent (3 levels)', async () => {
    const r1 = await svc.depositChips(agent(ag.A), { accountType: 'AGENT', accountId: ag.B, amount: 4000 })
    assert.equal(r1.account.balance, 4000)
    assert.equal(r1.parent?.id, ag.A)
    assert.equal(r1.parent?.balance, 6000)
    assert.equal(r1.pool, null)
    const rows = await transferRows(r1.transferId)
    assert.deepEqual(
      rows.map((x) => [x.account_id, x.counterparty_id, x.amount, x.before, x.after, x.created_by_type]).sort((a, b) => Number(a[2]) - Number(b[2])),
      [
        [ag.A, ag.B, -4000, 10000, 6000, 'agent'],
        [ag.B, ag.A, 4000, 0, 4000, 'agent'],
      ]
    )

    await svc.depositChips(agent(ag.B), { accountType: 'AGENT', accountId: ag.C, amount: 1500 })
    assert.deepEqual([await chips(ag.A), await chips(ag.B), await chips(ag.C)], [6000, 2500, 1500])
  })

  it('agent → its own player: wallets.cash moves and the player gets its wallet statement rows', async () => {
    const r = await svc.depositChips(agent(ag.C), { accountType: 'PLAYER', accountId: String(pl.pC), amount: 500, remark: 'first chips' })
    assert.equal(r.account.balance, 500)
    assert.equal(r.account.available, 500)
    assert.equal((await wallet(pl.pC))?.cash, 500)
    assert.equal(await chips(ag.C), 1000)

    const rows = await transferRows(r.transferId)
    assert.deepEqual(rows.map((x) => [x.account_type, x.amount]), [['agent', -500], ['player', 500]])

    const [entry] = await q(db, sql`
      SELECT le.type, le.balance_before::float8 AS before, le.balance_after::float8 AS after, le.meta
      FROM ledger_entries le JOIN wallets w ON w.id = le.wallet_id
      WHERE le.tenant = ${T} AND w.user_id = ${pl.pC} ORDER BY le.id DESC LIMIT 1`)
    assert.equal(entry.type, 'CHIP_DEPOSIT')
    assert.deepEqual([entry.before, entry.after], [0, 500])
    assert.equal(entry.meta.transferId, r.transferId)
    assert.equal(entry.meta.originalAmount, 500)
    assert.equal(entry.meta.type, 'chip_deposit')
    assert.equal(entry.meta.counterpartyName, 'chipc')

    const [wl] = await q(db, sql`
      SELECT wallet_type, category, direction, amount::float8 AS amount, balance_before::float8 AS before,
        balance_after::float8 AS after, reference_type, reference_id
      FROM wallet_ledger WHERE tenant = ${T} AND user_id = ${pl.pC} ORDER BY id DESC LIMIT 1`)
    assert.deepEqual(
      [wl.wallet_type, wl.category, wl.direction, wl.amount, wl.before, wl.after, wl.reference_type, wl.reference_id],
      ['cash', 'chip_deposit', 'credit', 500, 0, 500, 'credit_chip_transfer', r.transferId]
    )
  })

  it('only the direct parent moves chips; outside the subtree is "not found"', async () => {
    const before = [await chips(ag.A), await chips(ag.B), await chips(ag.C), await chips(ag.D)]
    const onlyDirect = code('NOT_DIRECT_PARENT', 'Only the direct upline can move chips for this account')
    await assert.rejects(svc.depositChips(agent(ag.A), { accountType: 'AGENT', accountId: ag.C, amount: 1 }), onlyDirect)
    await assert.rejects(svc.depositChips(agent(ag.A), { accountType: 'PLAYER', accountId: String(pl.pC), amount: 1 }), onlyDirect)
    await assert.rejects(svc.withdrawChips(agent(ag.A), { accountType: 'AGENT', accountId: ag.C, amount: 1 }), onlyDirect)
    await assert.rejects(svc.depositChips(agent(ag.B), { accountType: 'AGENT', accountId: ag.B, amount: 1 }), onlyDirect)
    await assert.rejects(svc.depositChips(admin(), { accountType: 'AGENT', accountId: ag.B, amount: 1 }), onlyDirect)
    await assert.rejects(svc.depositChips(admin(), { accountType: 'PLAYER', accountId: String(pl.pA), amount: 1 }), onlyDirect)

    await assert.rejects(svc.depositChips(agent(ag.B), { accountType: 'AGENT', accountId: ag.A, amount: 1 }), code('NOT_FOUND', 'Agent not found'))
    await assert.rejects(svc.depositChips(agent(ag.D), { accountType: 'AGENT', accountId: ag.B, amount: 1 }), code('NOT_FOUND', 'Agent not found'))
    await assert.rejects(svc.depositChips(agent(ag.D), { accountType: 'PLAYER', accountId: String(pl.pB), amount: 1 }), code('NOT_FOUND', 'Player not found'))
    await assert.rejects(svc.depositChips(agent(ag.A), { accountType: 'PLAYER', accountId: String(pl.pW), amount: 1 }), code('NOT_FOUND', 'Player not found'))

    const notCredit = code('NOT_CREDIT', 'Chips are only for CREDIT agents and credit players')
    await assert.rejects(svc.depositChips(admin(), { accountType: 'AGENT', accountId: ag.S, amount: 1 }), notCredit)
    await assert.rejects(svc.depositChips(admin(), { accountType: 'PLAYER', accountId: String(pl.pR), amount: 1 }), notCredit)

    assert.deepEqual([await chips(ag.A), await chips(ag.B), await chips(ag.C), await chips(ag.D)], before, 'nothing moved')
  })

  it('free-chip guards: the parent needs the chips; a player gives back only cash - exposure', async () => {
    await assert.rejects(
      svc.depositChips(agent(ag.C), { accountType: 'PLAYER', accountId: String(pl.pC), amount: 5000 }),
      code('INSUFFICIENT', 'Not enough chips: available 1,000.00')
    )
    await db.execute(sql`UPDATE wallets SET exposure = 200 WHERE user_id = ${pl.pC} AND tenant = ${T}`)
    await assert.rejects(
      svc.withdrawChips(agent(ag.C), { accountType: 'PLAYER', accountId: String(pl.pC), amount: 301 }),
      code('INSUFFICIENT', 'Not enough chips: available 300.00')
    )
    const r = await svc.withdrawChips(agent(ag.C), { accountType: 'PLAYER', accountId: String(pl.pC), amount: 300 })
    assert.deepEqual(await wallet(pl.pC), { cash: 200, exposure: 200 })
    assert.equal(r.account.available, 0)
    assert.equal(await chips(ag.C), 1300)
    const rows = await transferRows(r.transferId)
    assert.deepEqual(rows.map((x) => [x.account_type, x.kind, x.amount, x.before, x.after]), [
      ['agent', 'WITHDRAW', 300, 1000, 1300],
      ['player', 'WITHDRAW', -300, 500, 200],
    ])
    const [entry] = await q(db, sql`
      SELECT le.type, le.balance_before::float8 AS before, le.balance_after::float8 AS after
      FROM ledger_entries le JOIN wallets w ON w.id = le.wallet_id
      WHERE le.tenant = ${T} AND w.user_id = ${pl.pC} ORDER BY le.id DESC LIMIT 1`)
    assert.deepEqual([entry.type, entry.before, entry.after], ['CHIP_WITHDRAW', 500, 200])
    const [wl] = await q(db, sql`
      SELECT direction, category, balance_before::float8 AS before, balance_after::float8 AS after
      FROM wallet_ledger WHERE tenant = ${T} AND user_id = ${pl.pC} ORDER BY id DESC LIMIT 1`)
    assert.deepEqual([wl.direction, wl.category, wl.before, wl.after], ['debit', 'chip_withdraw', 300, 0])
  })

  it('credit reference: set by the direct parent only, one CREDIT_REFERENCE row, no chips move', async () => {
    const acc = await svc.setCreditReference(admin(), { accountType: 'AGENT', accountId: ag.A, creditReference: 10000, remark: 'line' })
    assert.equal(acc.creditReference, 10000)
    assert.equal(await chips(ag.A), 6000)
    const [row] = await q(db, sql`
      SELECT kind::text AS kind, amount::float8 AS amount, balance_before::float8 AS before, balance_after::float8 AS after,
        credit_reference_before::float8 AS cr_before, credit_reference_after::float8 AS cr_after, counterparty_type::text AS cp
      FROM credit_chip_ledger WHERE tenant_id = ${T} AND account_id = ${ag.A} AND kind = 'CREDIT_REFERENCE'`)
    assert.deepEqual([row.kind, row.amount, row.before, row.after, row.cr_before, row.cr_after, row.cp], ['CREDIT_REFERENCE', 0, 6000, 6000, 0, 10000, 'whitelabel'])

    await svc.setCreditReference(agent(ag.B), { accountType: 'PLAYER', accountId: String(pl.pB), creditReference: 750 })
    const [pb] = await q(db, sql`SELECT credit_limit::float8 AS cr FROM users WHERE id = ${pl.pB}`)
    assert.equal(pb.cr, 750)
    await assert.rejects(
      svc.setCreditReference(agent(ag.A), { accountType: 'AGENT', accountId: ag.C, creditReference: 1 }),
      code('NOT_DIRECT_PARENT')
    )
    await assert.rejects(
      svc.setCreditReference(agent(ag.A), { accountType: 'AGENT', accountId: ag.B, creditReference: -1 }),
      code('INVALID_INPUT', 'Credit reference cannot be negative')
    )
  })

  it('figures sum the whole subtree through the closure table (3 levels)', async () => {
    const a = await svc.getAccount(admin(), 'AGENT', ag.A)
    // Downline of A: B 2500 + C 1300 + D 0 chips, plus pC 200 cash (pA, pB 0). Exposure: pC 200.
    assert.deepEqual(
      a && [a.balance, a.downlineBalance, a.exposure, a.available, a.creditReference, a.refPnl, a.downlineCount],
      [6000, 4000, 200, 6000, 10000, 0, 3]
    )
    const b = await svc.getAccount(agent(ag.A), 'AGENT', ag.B)
    assert.deepEqual(b && [b.balance, b.downlineBalance, b.exposure, b.refPnl, b.downlineCount, b.parentAgentId], [2500, 1500, 200, 4000, 2, ag.A])
    const c = await svc.getAccount(agent(ag.B), 'AGENT', ag.C)
    assert.deepEqual(c && [c.balance, c.downlineBalance, c.exposure, c.downlineCount], [1300, 200, 200, 1])
    const pc = await svc.getAccount(agent(ag.A), 'PLAYER', String(pl.pC))
    assert.deepEqual(
      pc && [pc.balance, pc.exposure, pc.available, pc.downlineBalance, pc.refPnl, pc.playerType, pc.parentAgentId, pc.downlineCount],
      [200, 200, 0, 0, 200, 'AGENT_CREDIT', ag.C, 0]
    )
    // Every chip the pool gave is somewhere in A's tree.
    assert.equal((await poolAvailable()) + a!.balance + a!.downlineBalance, POOL)
  })

  it('a deposit is refused to or by a suspended account; a withdrawal still works', async () => {
    await db.execute(sql`UPDATE agents SET status = 'SUSPENDED' WHERE id = ${ag.B}::uuid`)
    try {
      await assert.rejects(
        svc.depositChips(agent(ag.A), { accountType: 'AGENT', accountId: ag.B, amount: 10 }),
        code('NOT_ACTIVE', 'Chips cannot be deposited while agent chipb is suspended')
      )
      await assert.rejects(
        svc.depositChips(agent(ag.B), { accountType: 'AGENT', accountId: ag.C, amount: 10 }),
        code('NOT_ACTIVE', 'Chips cannot be deposited while agent chipb is suspended')
      )
      await svc.withdrawChips(agent(ag.A), { accountType: 'AGENT', accountId: ag.B, amount: 500 })
      assert.deepEqual([await chips(ag.A), await chips(ag.B)], [6500, 2000])
    } finally {
      await db.execute(sql`UPDATE agents SET status = 'ACTIVE' WHERE id = ${ag.B}::uuid`)
    }
    await db.execute(sql`UPDATE users SET status = 'suspended' WHERE id = ${pl.pB}`)
    try {
      await assert.rejects(
        svc.depositChips(agent(ag.B), { accountType: 'PLAYER', accountId: String(pl.pB), amount: 10 }),
        code('NOT_ACTIVE', 'Chips cannot be deposited while player chip-pb is suspended')
      )
    } finally {
      await db.execute(sql`UPDATE users SET status = 'active' WHERE id = ${pl.pB}`)
    }
  })

  it('admin → WHITELABEL_CREDIT player: creates its wallet, debits the pool; withdraw credits it back', async () => {
    assert.equal(await wallet(pl.pW), null)
    const r = await svc.depositChips(admin(), { accountType: 'PLAYER', accountId: String(pl.pW), amount: 700 })
    assert.deepEqual(await wallet(pl.pW), { cash: 700, exposure: 0 })
    assert.equal(r.pool?.available, POOL - 10000 - 700)
    assert.equal(r.account.playerType, 'WHITELABEL_CREDIT')
    assert.equal(r.account.parentAgentId, null)
    assert.deepEqual(await lastPoolLedger(), { transaction_type: 'USAGE', reason: 'Chips to player chip-pw' })
    const rows = await transferRows(r.transferId)
    assert.deepEqual(rows.map((x) => [x.account_type, x.account_id, x.amount]), [['player', String(pl.pW), 700], ['whitelabel', T, -700]])

    const w = await svc.withdrawChips(admin(), { accountType: 'PLAYER', accountId: String(pl.pW), amount: 200 })
    assert.equal(w.pool?.available, POOL - 10000 - 500)
    assert.equal(await poolAvailable(), POOL - 10500)
    assert.equal((await wallet(pl.pW))?.cash, 500)
    assert.deepEqual(await lastPoolLedger(), { transaction_type: 'RELEASE', reason: 'Chips from player chip-pw' })
  })

  it('read scope: an agent sees itself and its subtree; an admin sees CREDIT accounts of its tenant', async () => {
    assert.equal(await svc.getAccount(agent(ag.D), 'AGENT', ag.B), null)
    assert.equal(await svc.getAccount(agent(ag.B), 'AGENT', ag.A), null)
    assert.equal(await svc.getAccount(agent(ag.B), 'PLAYER', String(pl.pA)), null)
    assert.ok(await svc.getAccount(agent(ag.A), 'AGENT', ag.C))
    assert.ok(await svc.getAccount(agent(ag.A), 'PLAYER', String(pl.pC)))
    assert.equal(await svc.getAccount(admin(), 'AGENT', ag.S), null, 'not CREDIT')
    assert.equal(await svc.getAccount(admin(), 'PLAYER', String(pl.pR)), null, 'not a credit player')
    assert.equal(await svc.getAccount(admin(), 'AGENT', 'not-a-uuid'), null)
    assert.equal(await svc.getAccount({ kind: 'admin', tenant: 'some-other-tenant', userId: '1' }, 'AGENT', ag.A), null)

    assert.equal((await svc.getMyAccount(agent(ag.A)))?.id, ag.A)
    assert.equal(await svc.getMyAccount(admin()), null)
    assert.equal(await svc.getMyAccount(agent(ag.S)), null)

    assert.equal((await svc.getPool(admin()))?.available, POOL - 10500)
    assert.equal(await svc.getPool(agent(ag.A)), null)
  })

  it('statements: newest first, signed, with counterparty names; scoped like accounts', async () => {
    const page = await svc.getStatement(agent(ag.A), { accountType: 'AGENT', accountId: ag.B })
    // B: +4000 from A, -1500 to C, -500 withdrawn by A.
    assert.equal(page.total, 3)
    assert.deepEqual(
      page.rows.map((r) => [r.kind, r.amount, r.balanceBefore, r.balanceAfter, r.counterpartyType, r.counterpartyName, r.createdBy]),
      [
        ['WITHDRAW', -500, 2500, 2000, 'AGENT', 'chipa', 'chipa'],
        ['DEPOSIT', -1500, 4000, 2500, 'AGENT', 'chipc', 'chipb'],
        ['DEPOSIT', 4000, 0, 4000, 'AGENT', 'chipa', 'chipa'],
      ]
    )
    assert.match(page.rows[0].createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const paged = await svc.getStatement(agent(ag.A), { accountType: 'AGENT', accountId: ag.B, offset: 1, limit: 1 })
    assert.deepEqual([paged.total, paged.rows.length, paged.rows[0].amount], [3, 1, -1500])
    const future = await svc.getStatement(agent(ag.A), { accountType: 'AGENT', accountId: ag.B, from: '2999-01-01' })
    assert.deepEqual([future.total, future.rows.length], [0, 0])
    await assert.rejects(svc.getStatement(agent(ag.D), { accountType: 'AGENT', accountId: ag.B }), code('NOT_FOUND'))

    const poolPage = await svc.getPoolStatement(admin())
    assert.deepEqual(
      poolPage.rows.map((r) => [r.kind, r.amount, r.counterpartyType]),
      [['WITHDRAW', 200, 'PLAYER'], ['DEPOSIT', -700, 'PLAYER'], ['DEPOSIT', -10000, 'AGENT']]
    )
    await assert.rejects(svc.getPoolStatement(agent(ag.A)), code('FORBIDDEN'))
  })

  it('downline lists: direct members with figures, totals over every match, search, filter, paging', async () => {
    const root = await svc.getDownline(admin())
    assert.equal(root.parent, null)
    assert.equal(root.pool?.available, POOL - 10500)
    assert.deepEqual(root.items.map((x) => [x.accountType, x.id]), [['AGENT', ag.A], ['PLAYER', String(pl.pW)]])
    assert.equal(root.total, 2)
    assert.equal(root.totals.balance, 6500 + 500)

    const mine = await svc.getDownline(agent(ag.A))
    assert.equal(mine.parent?.id, ag.A)
    assert.equal(mine.pool, null)
    assert.deepEqual(mine.items.map((x) => x.id), [ag.B, ag.D, String(pl.pA)])
    assert.deepEqual([mine.totals.balance, mine.totals.downlineBalance, mine.totals.exposure], [2000, 1500, 200])
    // A's downline balance is exactly its direct members' balances plus their own downlines.
    assert.equal(mine.parent!.downlineBalance, mine.totals.balance + mine.totals.downlineBalance)

    const ofB = await svc.getDownline(agent(ag.A), { parentAgentId: ag.B })
    assert.deepEqual(ofB.items.map((x) => x.id), [ag.C, String(pl.pB)])
    assert.equal(ofB.parent?.id, ag.B)
    await assert.rejects(svc.getDownline(agent(ag.B), { parentAgentId: ag.A }), code('NOT_FOUND', 'Agent not found'))

    assert.deepEqual((await svc.getDownline(agent(ag.A), { accountType: 'PLAYER' })).items.map((x) => x.id), [String(pl.pA)])
    assert.deepEqual((await svc.getDownline(agent(ag.A), { query: 'CHIPD' })).items.map((x) => x.id), [ag.D])
    assert.deepEqual((await svc.getDownline(agent(ag.A), { query: '%' })).items, [], 'LIKE wildcards are literal')

    const paged = await svc.getDownline(agent(ag.A), { offset: 1, limit: 1 })
    assert.deepEqual([paged.items.map((x) => x.id), paged.total, paged.totals.balance], [[ag.D], 3, 2000])

    const sharing = await svc.getDownline(agent(ag.S))
    assert.deepEqual([sharing.parent, sharing.items, sharing.total], [null, [], 0])
  })

  it('opening chips run inside the creation transaction and roll back with it', async () => {
    const bBefore = await chips(ag.B)
    let newPlayer = 0
    await db.transaction(async (tx: any) => {
      newPlayer = await mkPlayer(tx, 'chip-pn', 'AGENT_CREDIT', ag.B)
      const { transferId } = await svc.depositOpeningChips(
        { tenant: T, accountType: 'PLAYER', accountId: newPlayer, amount: 250, actor: { createdBy: ag.B, createdByType: 'agent' } },
        tx
      )
      assert.ok(transferId)
    })
    assert.equal((await wallet(newPlayer))?.cash, 250)
    assert.equal(await chips(ag.B), bBefore - 250)
    const [row] = await q(db, sql`SELECT remark, kind::text AS kind FROM credit_chip_ledger WHERE tenant_id = ${T} AND account_id = ${String(newPlayer)}`)
    assert.deepEqual([row.remark, row.kind], ['Opening chips', 'DEPOSIT'])

    const aBefore = await chips(ag.A)
    await assert.rejects(
      db.transaction(async (tx: any) => {
        const id = await mkAgent(tx, 'chip-rolled-back', ag.A)
        await svc.depositOpeningChips({ tenant: T, accountType: 'AGENT', accountId: id, amount: 100, actor: { createdBy: '1', createdByType: 'admin' } }, tx)
        throw new Error('creation failed after the opening deposit')
      }),
      /creation failed/
    )
    assert.equal(await chips(ag.A), aBefore, 'the opening deposit rolled back with the creation')
    assert.equal((await q(db, sql`SELECT 1 FROM agent_credentials WHERE tenant_id = ${T} AND username = 'chip-rolled-back'`)).length, 0)

    // A committed root agent funded from the pool, without a caller transaction.
    const root = await mkAgent(db, 'chip-root2', null)
    const poolBefore = await poolAvailable()
    await svc.depositOpeningChips({ tenant: T, accountType: 'AGENT', accountId: root, amount: 50, actor: { createdBy: '1', createdByType: 'admin' } })
    assert.deepEqual([await chips(root), await poolAvailable()], [50, poolBefore - 50])

    await assert.rejects(
      svc.depositOpeningChips({ tenant: T, accountType: 'AGENT', accountId: root, amount: 1, actor: { createdBy: null, createdByType: 'system' } }, db),
      /needs a transaction/
    )
  })

  it('refuses bad input and read-only agents before touching anything', async () => {
    for (const amount of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      await assert.rejects(svc.depositChips(agent(ag.A), { accountType: 'AGENT', accountId: ag.B, amount }), code('INVALID_INPUT'))
    }
    await assert.rejects(svc.depositChips(agent(ag.A), { accountType: 'BANK', accountId: ag.B, amount: 1 }), code('INVALID_INPUT'))
    await assert.rejects(svc.depositChips(agent(ag.A), { accountType: 'AGENT', accountId: 'nope', amount: 1 }), code('NOT_FOUND'))
    await assert.rejects(svc.depositChips(agent(ag.A), { accountType: 'PLAYER', accountId: '-3', amount: 1 }), code('NOT_FOUND'))
    await assert.rejects(
      svc.depositChips({ ...agent(ag.A), readOnly: true }, { accountType: 'AGENT', accountId: ag.B, amount: 1 }),
      code('FORBIDDEN', 'Your account is inactive. You cannot perform this action.')
    )
  })

  it('parallel deposits from one parent cannot overspend its chips (warm pool)', async () => {
    // Warm the pg pool so the transactions really overlap (memory: gw-concurrency-tests-need-warm-pool).
    await Promise.all(Array.from({ length: 10 }, () => pgPool.query('SELECT pg_sleep(0.05)')))
    const e = await mkAgent(db, 'chip-e', ag.D)
    const pd = await mkPlayer(db, 'chip-pd', 'AGENT_CREDIT', ag.D)
    await svc.depositChips(agent(ag.A), { accountType: 'AGENT', accountId: ag.D, amount: 100 })
    assert.equal(await chips(ag.D), 100)

    const attempts = Array.from({ length: 8 }, (_, i) =>
      svc.depositChips(agent(ag.D), i % 2 ? { accountType: 'AGENT', accountId: e, amount: 30 } : { accountType: 'PLAYER', accountId: String(pd), amount: 30 })
    )
    const settled = await Promise.allSettled(attempts)
    const ok = settled.filter((s) => s.status === 'fulfilled').length
    const refused = settled.filter((s) => s.status === 'rejected')
    assert.equal(ok, 3, '100 chips cover exactly three deposits of 30')
    for (const r of refused) code('INSUFFICIENT')((r as PromiseRejectedResult).reason)
    assert.equal(await chips(ag.D), 10)
    assert.equal((await chips(e)) + ((await wallet(pd))?.cash ?? 0), 90)
    const [{ n }] = await q(db, sql`SELECT COUNT(*)::int AS n FROM credit_chip_ledger WHERE tenant_id = ${T} AND account_id = ${ag.D} AND kind = 'DEPOSIT' AND amount < 0`)
    assert.equal(n, 3, 'one ledger pair per successful deposit')
  })

  it('parallel admin deposits cannot overspend the whitelabel pool', async () => {
    await Promise.all(Array.from({ length: 10 }, () => pgPool.query('SELECT pg_sleep(0.05)')))
    // Leave exactly 100 available in this test tenant's pool.
    await db.execute(sql`UPDATE whitelabels SET credit_limit = credit_used + 100, credit_available = 100 WHERE id = ${T}`)
    const settled = await Promise.allSettled(
      Array.from({ length: 4 }, () => svc.depositChips(admin(), { accountType: 'AGENT', accountId: ag.A, amount: 40 }))
    )
    assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 2, '100 covers exactly two deposits of 40')
    assert.equal(await poolAvailable(), 20)
  })

  it('lock order: parent before child, users before wallets, every lock before the first write (spec §4, §10)', async () => {
    const { ChipRepo } = await import('@src/repos/agents/ChipRepo.js')
    const chipModule = await import('../ChipService.js')
    const tags: string[] = []
    class RecordingRepo extends ChipRepo {
      async lockPool(tx: any, tenant: string) {
        tags.push('lock:pool')
        return super.lockPool(tx, tenant)
      }
      async lockAgent(tx: any, agentId: string) {
        tags.push(`lock:agent:${agentId}`)
        return super.lockAgent(tx, agentId)
      }
      async lockPlayer(tx: any, playerId: number, tenant: string) {
        tags.push(`lock:users:${playerId}`)
        return super.lockPlayer(tx, playerId, tenant)
      }
      async lockPlayerWallet(tx: any, playerId: number, tenant: string) {
        tags.push(`lock:wallet:${playerId}`)
        return super.lockPlayerWallet(tx, playerId, tenant)
      }
      async moveAgentChips(tx: any, agentId: string, delta: number) {
        tags.push(`write:agent:${agentId}`)
        return super.moveAgentChips(tx, agentId, delta)
      }
      async moveWalletCash(tx: any, walletId: number, delta: number) {
        tags.push('write:wallet')
        return super.moveWalletCash(tx, walletId, delta)
      }
      async createPlayerWallet(tx: any, playerId: number, tenant: string, currency: string) {
        tags.push('write:new-wallet')
        return super.createPlayerWallet(tx, playerId, tenant, currency)
      }
      async setAgentCreditReference(tx: any, agentId: string, value: number) {
        tags.push(`write:credit-reference:${agentId}`)
        return super.setAgentCreditReference(tx, agentId, value)
      }
    }
    const pool = chipModule.whitelabelPoolPort
    const recordingPool = {
      debit: (...args: Parameters<typeof pool.debit>) => {
        tags.push('write:pool')
        return pool.debit(...args)
      },
      credit: (...args: Parameters<typeof pool.credit>) => {
        tags.push('write:pool')
        return pool.credit(...args)
      },
      read: (tenant: string) => pool.read(tenant),
    }
    const recorded = new chipModule.ChipService(new RecordingRepo(), recordingPool)

    const expectOrder = async (label: string, op: () => Promise<unknown>, expected: string[]) => {
      tags.length = 0
      await op()
      assert.deepEqual(tags, expected, label)
      const lastLock = tags.map((t) => t.startsWith('lock:')).lastIndexOf(true)
      const firstWrite = tags.findIndex((t) => t.startsWith('write:'))
      assert.ok(firstWrite > lastLock, `${label}: every lock is taken before the first write`)
    }

    const start = [await chips(ag.A), await chips(ag.D), (await wallet(pl.pA))?.cash, (await wallet(pl.pW))?.cash, await poolAvailable()]
    const A = ag.A
    const D = ag.D
    const pA = pl.pA
    const pW = pl.pW

    // A withdrawal moves chips child → parent, and still locks the parent first.
    for (const op of ['depositChips', 'withdrawChips'] as const) {
      await expectOrder(
        `agent → sub-agent ${op}`,
        () => recorded[op](agent(A), { accountType: 'AGENT', accountId: D, amount: 10 }),
        [`lock:agent:${A}`, `lock:agent:${D}`, `write:agent:${A}`, `write:agent:${D}`]
      )
      await expectOrder(
        `agent → own player ${op}`,
        () => recorded[op](agent(A), { accountType: 'PLAYER', accountId: String(pA), amount: 5 }),
        [`lock:agent:${A}`, `lock:users:${pA}`, `lock:wallet:${pA}`, `write:agent:${A}`, 'write:wallet']
      )
      await expectOrder(
        `admin → WHITELABEL_CREDIT player ${op}`,
        () => recorded[op](admin(), { accountType: 'PLAYER', accountId: String(pW), amount: 5 }),
        ['lock:pool', `lock:users:${pW}`, `lock:wallet:${pW}`, 'write:pool', 'write:wallet']
      )
    }
    await expectOrder(
      'agent → sub-agent credit reference',
      () => recorded.setCreditReference(agent(A), { accountType: 'AGENT', accountId: D, creditReference: 100 }),
      [`lock:agent:${A}`, `lock:agent:${D}`, `write:credit-reference:${D}`]
    )

    const end = [await chips(ag.A), await chips(ag.D), (await wallet(pl.pA))?.cash, (await wallet(pl.pW))?.cash, await poolAvailable()]
    assert.deepEqual(end, start, 'each deposit was undone by its withdrawal')
  })

  it('admin → root CREDIT agent withdrawal: the chips go back to the pool (RELEASE), two rows, one transfer id', async () => {
    const aBefore = await chips(ag.A)
    const poolBefore = await poolAvailable()
    const r = await svc.withdrawChips(admin(), { accountType: 'AGENT', accountId: ag.A, amount: 1000, remark: 'back to pool' })
    assert.equal(r.account.balance, aBefore - 1000)
    assert.equal(r.parent, null)
    assert.equal(r.pool?.available, poolBefore + 1000)
    assert.deepEqual([await chips(ag.A), await poolAvailable()], [aBefore - 1000, poolBefore + 1000])
    assert.deepEqual(await lastPoolLedger(), { transaction_type: 'RELEASE', reason: 'Chips from agent chipa' })

    const rows = await transferRows(r.transferId)
    assert.equal(rows.length, 2, 'both rows carry the one transfer id')
    const [agentRow, poolRow] = rows // ordered by account_type: agent, whitelabel
    assert.deepEqual(
      [agentRow.account_type, agentRow.account_id, agentRow.counterparty_type, agentRow.counterparty_id, agentRow.kind, agentRow.amount, agentRow.before, agentRow.after],
      ['agent', ag.A, 'whitelabel', T, 'WITHDRAW', -1000, aBefore, aBefore - 1000]
    )
    assert.deepEqual(
      [poolRow.account_type, poolRow.account_id, poolRow.counterparty_type, poolRow.counterparty_id, poolRow.kind, poolRow.amount, poolRow.before, poolRow.after],
      ['whitelabel', T, 'agent', ag.A, 'WITHDRAW', 1000, poolBefore, poolBefore + 1000]
    )
    assert.ok(rows.every((x) => x.remark === 'back to pool' && x.created_by === '999999999' && x.created_by_type === 'admin'))
  })

  it('a responsible gambling block refuses chips in, never chips out', async () => {
    await svc.depositChips(agent(ag.A), { accountType: 'PLAYER', accountId: String(pl.pA), amount: 50 })
    const aBefore = await chips(ag.A)
    const poolBefore = await poolAvailable()
    const cashW = (await wallet(pl.pW))?.cash ?? 0
    await db.execute(sql`UPDATE users SET rg_blocked_until = now() + interval '1 day' WHERE id IN (${pl.pA}, ${pl.pW})`)
    try {
      await assert.rejects(
        svc.depositChips(agent(ag.A), { accountType: 'PLAYER', accountId: String(pl.pA), amount: 10 }),
        code('RG_BLOCKED', 'Chips cannot be deposited while player chip-pa has a responsible gambling block')
      )
      await assert.rejects(
        svc.depositChips(admin(), { accountType: 'PLAYER', accountId: String(pl.pW), amount: 1 }),
        code('RG_BLOCKED', 'Chips cannot be deposited while player chip-pw has a responsible gambling block')
      )
      assert.deepEqual([await chips(ag.A), (await wallet(pl.pA))?.cash, await poolAvailable(), (await wallet(pl.pW))?.cash], [aBefore, 50, poolBefore, cashW], 'nothing moved')

      // Money out is never gated.
      await svc.withdrawChips(agent(ag.A), { accountType: 'PLAYER', accountId: String(pl.pA), amount: 50 })
      assert.deepEqual([await chips(ag.A), (await wallet(pl.pA))?.cash], [aBefore + 50, 0])
    } finally {
      await db.execute(sql`UPDATE users SET rg_blocked_until = NULL WHERE id IN (${pl.pA}, ${pl.pW})`)
    }
  })

  it("the pool's own re-check refusal (limit - used + settlement) comes back as INSUFFICIENT and moves nothing", async () => {
    // The stored credit_available says 1,000, but WhitelabelCreditService's formula leaves 10: ChipService's
    // guard passes and deductCredit refuses under its lock.
    await db.execute(sql`UPDATE whitelabels SET credit_limit = credit_used + 10, credit_available = 1000 WHERE id = ${T}`)
    const aBefore = await chips(ag.A)
    try {
      await assert.rejects(
        svc.depositChips(admin(), { accountType: 'AGENT', accountId: ag.A, amount: 50 }),
        code('INSUFFICIENT', 'Not enough chips in the whitelabel pool: available 10.00')
      )
      assert.equal(await chips(ag.A), aBefore)
      assert.equal(await poolAvailable(), 1000, 'the transaction rolled back')
    } finally {
      await db.execute(sql`UPDATE whitelabels SET credit_available = credit_limit - credit_used WHERE id = ${T}`)
    }
  })
})
