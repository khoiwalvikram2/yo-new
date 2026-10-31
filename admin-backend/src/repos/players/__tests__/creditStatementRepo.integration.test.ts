/**
 * The credit statement's SQL against the real database — READ ONLY.
 *
 * Every statement is a SELECT or runs inside the repo's READ ONLY snapshot.
 * The fixtures are whatever live data exists, and a check that finds no
 * suitable data skips rather than fails. It proves that the statement SQL runs
 * on PostgreSQL (the three-way UNION, the ledger filter, the snapshot) and that
 * its rows agree with independent aggregates.
 *
 * On 2026-10-22 the live database had no AGENT_CREDIT / WHITELABEL_CREDIT
 * player and no player-side ledger row, so the credit-player check skips there.
 *
 * Requires DATABASE_URL.
 *   node --env-file-if-exists=.env --test --import tsx src/repos/players/__tests__/creditStatementRepo.integration.test.ts
 */
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

type Picked = { playerId: number; tenant: string }

let db: (typeof import('@src/db/client.js'))['db']
let repoModule: typeof import('@src/repos/players/creditStatementRepo.js')
let busiest: Picked | null = null
let creditPlayer: Picked | null = null
let nonCreditPlayer: (Picked & { playerType: string }) | null = null
let ledgerPlayer: Picked | null = null

const DAY = 24 * 60 * 60 * 1000
const FROM = new Date(Date.now() - 90 * DAY)
const MID = new Date(Date.now() - 45 * DAY)
const TO = new Date(Date.now() - 3 * DAY)
// The isolated audit supplies deterministic history; ordinary read-only runs
// may still select existing live records without creating any fixtures.
const fixtureTenant = process.env.CREDIT_STATEMENT_TEST_TENANT?.trim()
const tenantScope = fixtureTenant ? sql`AND tenant = ${fixtureTenant}` : sql``

function rows(result: unknown): any[] {
  return Array.isArray(result) ? result : ((result as { rows?: any[] } | null)?.rows ?? [])
}
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`
const adminCtx = (tenant: string) => ({
  tenant, whitelabel: { id: tenant }, user: { sub: '1', type: 'admin', roles: ['Whitelabel Admin'] },
  permissions: [{ domain: 'players.credit', actions: ['view'] }],
})

before(async () => {
  ;({ db } = await import('@src/db/client.js'))
  repoModule = await import('@src/repos/players/creditStatementRepo.js')

  // The player with the most settled bets 90–3 days ago, within the statement cap.
  const [b] = rows(await db.execute(sql`
    SELECT user_id, tenant, COUNT(*)::int AS n FROM (
      SELECT user_id, tenant FROM sports_bets
       WHERE status IN ('won', 'lost', 'settled') AND pl IS NOT NULL AND settled_at >= ${ts(FROM)} AND settled_at <= ${ts(TO)} ${tenantScope}
      UNION ALL
      SELECT user_id, tenant FROM casino_bets
       WHERE status IN ('won', 'lost') AND wallet_type = 'cash' AND net_amount IS NOT NULL AND settled_at >= ${ts(FROM)} AND settled_at <= ${ts(TO)} ${tenantScope}
      UNION ALL
      SELECT user_id, tenant FROM matka_bets
       WHERE status IN ('won', 'lost') AND settled_at >= ${ts(FROM)} AND settled_at <= ${ts(TO)} ${tenantScope}
    ) s
    GROUP BY user_id, tenant
    HAVING COUNT(*) <= ${repoModule.STATEMENT_ROW_CAP}
    ORDER BY n DESC
    LIMIT 1`))
  if (b) busiest = { playerId: Number(b.user_id), tenant: String(b.tenant) }

  const [c] = rows(await db.execute(sql`
    SELECT id, tenant FROM users WHERE player_type IN ('AGENT_CREDIT', 'WHITELABEL_CREDIT') ${tenantScope} ORDER BY id LIMIT 1`))
  if (c) creditPlayer = { playerId: Number(c.id), tenant: String(c.tenant) }

  const [n] = rows(await db.execute(sql`
    SELECT id, tenant, player_type::text AS player_type FROM users
     WHERE player_type NOT IN ('AGENT_CREDIT', 'WHITELABEL_CREDIT') ${tenantScope} ORDER BY id LIMIT 1`))
  if (n) nonCreditPlayer = { playerId: Number(n.id), tenant: String(n.tenant), playerType: String(n.player_type) }

  const [l] = rows(await db.execute(sql`
    SELECT to_entity_id, tenant_id FROM agent_credit_ledger
     WHERE to_entity_type = 'player' AND to_entity_id ~ '^[0-9]+$'
       ${fixtureTenant ? sql`AND tenant_id = ${fixtureTenant}` : sql``}
     ORDER BY created_at DESC LIMIT 1`))
  if (l) ledgerPlayer = { playerId: Number(l.to_entity_id), tenant: String(l.tenant_id) }
  if (fixtureTenant) {
    assert.ok(busiest && creditPlayer && nonCreditPlayer && ledgerPlayer, 'The requested isolated credit statement history must exist; do not skip missing fixtures')
  }
})

describe('CreditStatementRepo on PostgreSQL', () => {
  it('listSettledBets: settled bets in range, oldest first, per-domain sums match an independent aggregate', async (t) => {
    if (!busiest) return t.skip('no settled bets between 90 and 3 days ago')
    const { playerId, tenant } = busiest
    const entries = await new repoModule.CreditStatementRepo().listSettledBets(playerId, tenant, FROM, TO)
    assert.ok(entries.length > 0)
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      assert.equal(e.type, 'BET_SETTLED')
      assert.ok(e.domain === 'sports' || e.domain === 'casino' || e.domain === 'matka', `domain ${e.domain}`)
      assert.ok(e.id.startsWith(`${e.domain}:`), e.id)
      assert.ok(e.occurredAt.getTime() >= FROM.getTime() && e.occurredAt.getTime() <= TO.getTime(), `${e.id} at ${e.occurredAt.toISOString()} is outside the range`)
      assert.ok(Number.isFinite(e.amount))
      if (i > 0) assert.ok(entries[i - 1].occurredAt.getTime() <= e.occurredAt.getTime(), 'rows are oldest first')
    }
    const [agg] = rows(await db.execute(sql`
      SELECT
        (SELECT COALESCE(SUM(pl), 0) FROM sports_bets WHERE user_id = ${playerId} AND tenant = ${tenant}
           AND status IN ('won', 'lost', 'settled') AND pl IS NOT NULL AND settled_at BETWEEN ${ts(FROM)} AND ${ts(TO)}) AS sports,
        (SELECT COALESCE(SUM(net_amount), 0) FROM casino_bets WHERE user_id = ${playerId} AND tenant = ${tenant}
           AND status IN ('won', 'lost') AND wallet_type = 'cash' AND net_amount IS NOT NULL AND settled_at BETWEEN ${ts(FROM)} AND ${ts(TO)}) AS casino,
        (SELECT COALESCE(SUM(COALESCE(actual_win, 0) - bet_amount), 0) FROM matka_bets WHERE user_id = ${playerId} AND tenant = ${tenant}
           AND status IN ('won', 'lost') AND settled_at BETWEEN ${ts(FROM)} AND ${ts(TO)}) AS matka`))
    for (const domain of ['sports', 'casino', 'matka'] as const) {
      const mine = entries.filter((e) => e.domain === domain).reduce((sum, e) => sum + e.amount, 0)
      assert.ok(Math.abs(mine - Number(agg[domain])) < 0.005, `${domain}: rows ${mine} vs aggregate ${agg[domain]}`)
    }
  })

  it('sumSettledBetsAfter: in one snapshot, after(MID) − after(TO) equals the rows in (MID, TO]', async (t) => {
    if (!busiest) return t.skip('no settled bets between 90 and 3 days ago')
    const { playerId, tenant } = busiest
    const repo = new repoModule.CreditStatementRepo()
    const [afterMid, afterTo] = await repo.readSnapshot(async (snap) => [
      await snap.sumSettledBetsAfter(playerId, tenant, MID),
      await snap.sumSettledBetsAfter(playerId, tenant, TO),
    ])
    const entries = await repo.listSettledBets(playerId, tenant, FROM, TO)
    const between = entries.filter((e) => e.occurredAt.getTime() > MID.getTime()).reduce((sum, e) => sum + e.amount, 0)
    assert.ok(Math.abs(afterMid - afterTo - between) < 0.005, `${afterMid} − ${afterTo} vs ${between}`)
  })

  it('readSnapshot runs in a READ ONLY, REPEATABLE READ transaction', async () => {
    const repo = new repoModule.CreditStatementRepo()
    const flags = await repo.readSnapshot(async (snap) => {
      const exec = (snap as unknown as { exec: { execute: (q: unknown) => Promise<unknown> } }).exec
      const [ro] = rows(await exec.execute(sql`SHOW transaction_read_only`))
      const [iso] = rows(await exec.execute(sql`SHOW transaction_isolation`))
      return { readOnly: ro.transaction_read_only, isolation: iso.transaction_isolation }
    })
    assert.deepEqual(flags, { readOnly: 'on', isolation: 'repeatable read' })
  })

  it('listLedgerRows and listSettlementRowsAfter run, and every row they return maps', async (t) => {
    const pick = ledgerPlayer ?? busiest
    if (!pick) return t.skip('no player to read')
    const { ledgerRowToEntry, STATEMENT_LEDGER_TYPES } = await import('@src/domains/players/services/creditStatementLedger.js')
    const repo = new repoModule.CreditStatementRepo()
    const ledger = await repo.listLedgerRows(pick.playerId, pick.tenant, new Date(0), new Date())
    const after = await repo.listSettlementRowsAfter(pick.playerId, pick.tenant, new Date(0))
    for (const row of ledger) {
      assert.ok((STATEMENT_LEDGER_TYPES as readonly string[]).includes(row.transactionType), row.transactionType)
      assert.doesNotThrow(() => ledgerRowToEntry(row, String(pick.playerId)))
    }
    for (const row of after) {
      assert.equal(ledgerRowToEntry(row, String(pick.playerId))?.type, 'SETTLEMENT')
    }
  })
})

describe('resolvePlayerCreditStatement on PostgreSQL', () => {
  it('refuses a player who is not a credit player, with the clear message', async (t) => {
    if (!nonCreditPlayer) return t.skip('no non-credit player in this database')
    const picked = nonCreditPlayer
    const { resolvePlayerCreditStatement } = await import('@src/domains/players/services/playerCreditStatementQuery.js')
    await assert.rejects(
      () => resolvePlayerCreditStatement({ playerId: String(picked.playerId), dateFrom: '2026-10-01', dateTo: '2026-10-21' }, adminCtx(picked.tenant)),
      new RegExp(`credit players only .*This player is ${picked.playerType}`),
    )
  })

  it("a credit player: with dateTo in the future the closing balance is today's settlement balance, and balances chain", async (t) => {
    if (!creditPlayer) return t.skip('no AGENT_CREDIT or WHITELABEL_CREDIT player in this database')
    const picked = creditPlayer
    const { resolvePlayerCreditStatement } = await import('@src/domains/players/services/playerCreditStatementQuery.js')
    const dateFrom = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10)
    const s = await resolvePlayerCreditStatement({ playerId: String(picked.playerId), dateFrom, dateTo: '2099-12-31', limit: 1000 }, adminCtx(picked.tenant))
    assert.equal(s.closingBalance, s.summary.settlementBalance)
    const money = s.rows.filter((r) => r.affectsBalance)
    if (money.length > 0) assert.equal(money[0].balanceAfter, s.closingBalance)
    for (let i = 0; i + 1 < money.length; i++) {
      const newer = money[i]
      const older = money[i + 1]
      assert.ok(Math.abs((older.balanceAfter as number) - ((newer.balanceAfter as number) - newer.amount)) < 0.005, `row ${newer.id}`)
    }
    // Not true by construction: a settlement returns the balance to 0 only if every
    // amount before it (bets, earlier settlements, the opening balance) is right.
    for (const r of s.rows.filter((row) => row.type === 'SETTLEMENT')) {
      assert.equal(r.balanceAfter, 0, `settlement ${r.id} at ${r.occurredAt} leaves ${r.balanceAfter}, not 0`)
    }
    if (s.totalRows <= 1000 && money.length > 0) {
      const oldest = money[money.length - 1]
      assert.ok(Math.abs((oldest.balanceAfter as number) - oldest.amount - s.openingBalance) < 0.005, 'the oldest row starts from the opening balance')
    }
  })
})
