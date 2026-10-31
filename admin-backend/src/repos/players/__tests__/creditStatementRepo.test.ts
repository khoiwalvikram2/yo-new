/**
 * CreditStatementRepo without a database: a fake executor renders each query
 * with drizzle's PgDialect, records it and answers with canned rows. Proves the
 * row mapping, the range cap and the filters that decide which bets count.
 * The live SQL runs in creditStatementRepo.integration.test.ts.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/players/__tests__/creditStatementRepo.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { CreditStatementRepo, STATEMENT_ROW_CAP } from '../creditStatementRepo.js'

const dialect = new PgDialect()

function fake(answer: (text: string) => unknown[]) {
  const seen: Array<{ text: string; params: unknown[] }> = []
  const exec = {
    async execute(query: SQL) {
      const { sql: text, params } = dialect.sqlToQuery(query)
      seen.push({ text, params })
      return { rows: answer(text) }
    },
  }
  return { seen, repo: new CreditStatementRepo(exec) }
}

const FROM = new Date('2026-09-30T18:30:00.000Z')
const TO = new Date('2026-10-07T18:29:59.999Z')

describe('CreditStatementRepo.findCreditAccount', () => {
  it('maps the users row and scopes by id and tenant', async () => {
    const { seen, repo } = fake(() => [{
      id: 7, player_type: 'AGENT_CREDIT', credit_limit: '1000.00', credit_used: '120.50', credit_available: '879.50',
      settlement_balance: '-40.25', settlement_balance_sports: '-50.25', settlement_balance_casino: '10.00', settlement_balance_matka: '0.00',
    }])
    const account = await repo.findCreditAccount(7, 't1')
    assert.deepEqual(account, {
      playerId: 7, playerType: 'AGENT_CREDIT', creditLimit: 1000, creditUsed: 120.5, creditAvailable: 879.5,
      settlementBalance: -40.25, settlementBalanceSports: -50.25, settlementBalanceCasino: 10, settlementBalanceMatka: 0,
    })
    assert.match(seen[0].text, /FROM users\s+WHERE id = \$1 AND tenant = \$2/)
    assert.deepEqual(seen[0].params, [7, 't1'])
  })

  it('returns null when the tenant has no such player', async () => {
    const { repo } = fake(() => [])
    assert.equal(await repo.findCreditAccount(7, 'other'), null)
  })
})

describe('CreditStatementRepo.listSettledBets', () => {
  it('maps each domain row to a BET_SETTLED entry with a numeric amount', async () => {
    const { repo } = fake(() => [
      { id: 'sports:a', domain: 'sports', occurred_at: new Date('2026-10-02T10:00:00.000Z'), amount: '150.00', reference: 'India v Australia', details: 'Match Odds' },
      { id: 'casino:b', domain: 'casino', occurred_at: '2026-10-03T10:00:00.000Z', amount: '-20.50', reference: 'Live Roulette', details: 'Evolution' },
      { id: 'matka:c', domain: 'matka', occurred_at: new Date('2026-10-04T10:00:00.000Z'), amount: '-10.00', reference: 'Kalyan', details: null },
    ])
    const entries = await repo.listSettledBets(42, 't1', FROM, TO)
    assert.deepEqual(entries.map((e) => [e.id, e.type, e.domain, e.amount, e.occurredAt.toISOString(), e.reference, e.details, e.valueBefore, e.valueAfter]), [
      ['sports:a', 'BET_SETTLED', 'sports', 150, '2026-10-02T10:00:00.000Z', 'India v Australia', 'Match Odds', null, null],
      ['casino:b', 'BET_SETTLED', 'casino', -20.5, '2026-10-03T10:00:00.000Z', 'Live Roulette', 'Evolution', null, null],
      ['matka:c', 'BET_SETTLED', 'matka', -10, '2026-10-04T10:00:00.000Z', 'Kalyan', null, null, null],
    ])
  })

  it('counts final settled states only: no void/cancelled, cash casino only, scoped by player, tenant and range', async () => {
    const { seen, repo } = fake(() => [])
    await repo.listSettledBets(42, 't1', FROM, TO)
    const { text, params } = seen[0]
    assert.match(text, /b\.status IN \('won', 'lost', 'settled'\) AND b\.pl IS NOT NULL/)
    assert.match(text, /c\.status IN \('won', 'lost'\) AND c\.wallet_type = 'cash'/)
    assert.match(text, /k\.status IN \('won', 'lost'\)/)
    assert.doesNotMatch(text, /void|cancelled/)
    assert.ok(params.includes(42) && params.includes('t1'))
    assert.ok(params.includes(FROM.toISOString()) && params.includes(TO.toISOString()))
    assert.ok(params.includes(STATEMENT_ROW_CAP + 1), 'reads one row past the cap to detect overflow')
  })

  it('refuses a range with more settled bets than the cap, rather than truncating it', async () => {
    const row = { id: 'casino:x', domain: 'casino', occurred_at: new Date('2026-10-02T10:00:00.000Z'), amount: '1.00', reference: null, details: null }
    const { repo } = fake(() => Array.from({ length: STATEMENT_ROW_CAP + 1 }, () => row))
    await assert.rejects(() => repo.listSettledBets(42, 't1', FROM, TO), /More than 50000 settled bets fall in this date range\. Choose a shorter range\./)
  })
})

describe('CreditStatementRepo ledger reads and sums', () => {
  it('listLedgerRows maps the columns and reads both sides of the player, statement types only', async () => {
    const { seen, repo } = fake(() => [{
      id: 'l1', transaction_type: 'WITHDRAWAL', from_entity_type: 'player', from_entity_id: '42', to_entity_type: 'whitelabel', to_entity_id: 't1',
      amount: '500.00', balance_before: '2000.00', balance_after: '1500.00', reason: 'Credit withdrawal from whitelabel credit player', metadata: { a: 1 }, created_at: '2026-10-02T10:00:00.000Z',
    }])
    const rows = await repo.listLedgerRows(42, 't1', FROM, TO)
    assert.deepEqual(rows, [{
      id: 'l1', transactionType: 'WITHDRAWAL', fromEntityType: 'player', fromEntityId: '42', toEntityType: 'whitelabel', toEntityId: 't1',
      amount: 500, balanceBefore: 2000, balanceAfter: 1500, reason: 'Credit withdrawal from whitelabel credit player', metadata: { a: 1 }, createdAt: new Date('2026-10-02T10:00:00.000Z'),
    }])
    assert.match(seen[0].text, /to_entity_type = 'player' AND to_entity_id = \$\d+\)\s+OR \(from_entity_type = 'player' AND from_entity_id = \$\d+/)
    assert.ok(seen[0].params.includes('42'))
    assert.ok(seen[0].params.includes('CREDIT_LIMIT_ADJUSTMENT'))
    assert.ok(!seen[0].params.includes('USAGE'))
  })

  it('listSettlementRowsAfter reads only settlement ADJUSTMENT rows after the instant', async () => {
    const { seen, repo } = fake(() => [])
    await repo.listSettlementRowsAfter(42, 't1', TO)
    assert.match(seen[0].text, /transaction_type = 'ADJUSTMENT'/)
    assert.match(seen[0].text, /reason LIKE \$\d+/)
    assert.ok(seen[0].params.includes('Player credit settlement:%'))
    assert.match(seen[0].text, /created_at > \$\d+::timestamptz/)
  })

  it('sumSettledBetsAfter returns the total as a number, 0 when there is nothing', async () => {
    assert.equal(await fake(() => [{ total: '-125.50' }]).repo.sumSettledBetsAfter(42, 't1', TO), -125.5)
    assert.equal(await fake(() => [{ total: null }]).repo.sumSettledBetsAfter(42, 't1', TO), 0)
  })
})
