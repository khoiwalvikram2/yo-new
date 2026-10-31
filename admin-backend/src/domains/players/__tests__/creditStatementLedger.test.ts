/**
 * agent_credit_ledger rows → statement rows (services/creditStatementLedger.ts).
 * Settlements come from SETTLE's ADJUSTMENT row (settlements/resolvers/mutations.ts,
 * reason "Player credit settlement: X → 0", metadata.settlementBalanceBefore).
 * Pure: no database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/players/__tests__/creditStatementLedger.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSettlementLedgerRow,
  ledgerRowToEntry,
  settledBalanceOf,
  SETTLEMENT_REASON_PREFIX,
  STATEMENT_LEDGER_TYPES,
  type CreditLedgerSourceRow,
} from '../services/creditStatementLedger.js'

const PLAYER = '42'
const AT = new Date('2026-10-05T10:00:00.000Z')

function ledger(fields: Partial<CreditLedgerSourceRow>): CreditLedgerSourceRow {
  return {
    id: 'l1',
    transactionType: 'ADJUSTMENT',
    fromEntityType: 'agent',
    fromEntityId: 'agent-1',
    toEntityType: 'player',
    toEntityId: PLAYER,
    amount: 0,
    balanceBefore: 0,
    balanceAfter: 0,
    reason: null,
    metadata: null,
    createdAt: AT,
    ...fields,
  }
}

describe('settlement rows', () => {
  it('a SETTLE row is a SETTLEMENT for minus the settled balance, read from metadata', () => {
    const entry = ledgerRowToEntry(ledger({
      amount: 1500,
      reason: 'Player credit settlement: 1500 → 0',
      metadata: { adjustmentType: 'SETTLE', settlementBalanceBefore: 1500, settlementBalanceAfter: 0 },
    }), PLAYER)
    assert.deepEqual(entry, {
      id: 'ledger:l1',
      type: 'SETTLEMENT',
      occurredAt: AT,
      domain: null,
      reference: 'Settlement',
      details: 'Player credit settlement: 1500 → 0',
      amount: -1500,
      valueBefore: 1500,
      valueAfter: 0,
    })
  })

  it('a player who owed (negative balance) settles for a positive amount', () => {
    const entry = ledgerRowToEntry(ledger({ amount: 800, reason: 'Player credit settlement: -800 → 0', metadata: { settlementBalanceBefore: -800 } }), PLAYER)
    assert.equal(entry?.amount, 800)
  })

  it('metadata stored as a JSON string is read', () => {
    const entry = ledgerRowToEntry(ledger({ reason: 'Player credit settlement: 250 → 0', metadata: '{"settlementBalanceBefore":250}' }), PLAYER)
    assert.equal(entry?.amount, -250)
  })

  it('without metadata, the signed number in the reason is used', () => {
    const entry = ledgerRowToEntry(ledger({ reason: 'Player credit settlement: -1200.5 → 0 (paid in cash)' }), PLAYER)
    assert.equal(entry?.amount, 1200.5)
    assert.equal(entry?.valueBefore, -1200.5)
  })

  it('a settlement whose value cannot be read is left out', () => {
    assert.equal(ledgerRowToEntry(ledger({ reason: 'Player credit settlement: unknown' }), PLAYER), null)
  })

  it('settledBalanceOf prefers metadata over the reason', () => {
    assert.equal(settledBalanceOf({ reason: 'Player credit settlement: 200 → 0', metadata: { settlementBalanceBefore: 300 } }), 300)
  })

  it('isSettlementLedgerRow: only ADJUSTMENT rows whose reason starts with the settlement prefix', () => {
    assert.equal(isSettlementLedgerRow({ transactionType: 'ADJUSTMENT', reason: `${SETTLEMENT_REASON_PREFIX} 10 → 0` }), true)
    assert.equal(isSettlementLedgerRow({ transactionType: 'ADJUSTMENT', reason: 'Credit limit adjustment for whitelabel credit player' }), false)
    assert.equal(isSettlementLedgerRow({ transactionType: 'CREDIT_USED_DECREASE', reason: `${SETTLEMENT_REASON_PREFIX} 10 → 0` }), false)
    assert.equal(isSettlementLedgerRow({ transactionType: 'ADJUSTMENT', reason: null }), false)
  })
})

describe('informational rows', () => {
  it('CREDIT_LIMIT_ADJUSTMENT is a LIMIT_CHANGE from the old to the new limit', () => {
    const entry = ledgerRowToEntry(ledger({ transactionType: 'CREDIT_LIMIT_ADJUSTMENT', amount: 2000, balanceBefore: 10000, balanceAfter: 12000, reason: 'Credit limit adjustment: 10000 → 12000' }), PLAYER)
    assert.deepEqual(entry, { id: 'ledger:l1', type: 'LIMIT_CHANGE', occurredAt: AT, domain: null, reference: null, details: 'Credit limit adjustment: 10000 → 12000', amount: 2000, valueBefore: 10000, valueAfter: 12000 })
  })

  it('a whitelabel limit ADJUSTMENT that is not a settlement is a LIMIT_CHANGE', () => {
    const entry = ledgerRowToEntry(ledger({ fromEntityType: 'whitelabel', fromEntityId: 't1', amount: 1000, balanceBefore: 5000, balanceAfter: 4000, reason: 'Credit limit adjustment for whitelabel credit player' }), PLAYER)
    assert.equal(entry?.type, 'LIMIT_CHANGE')
    assert.equal(entry?.amount, -1000)
  })

  it('DEPOSIT to the player raises the limit; WITHDRAWAL from the player lowers it', () => {
    const deposit = ledgerRowToEntry(ledger({ transactionType: 'DEPOSIT', fromEntityType: 'whitelabel', fromEntityId: 't1', amount: 500, balanceBefore: 1000, balanceAfter: 1500 }), PLAYER)
    assert.deepEqual([deposit?.type, deposit?.amount, deposit?.valueBefore, deposit?.valueAfter], ['LIMIT_CHANGE', 500, 1000, 1500])
    const withdrawal = ledgerRowToEntry(ledger({ transactionType: 'WITHDRAWAL', fromEntityType: 'player', fromEntityId: PLAYER, toEntityType: 'whitelabel', toEntityId: 't1', amount: 500, balanceBefore: 1500, balanceAfter: 1000 }), PLAYER)
    assert.deepEqual([withdrawal?.type, withdrawal?.amount], ['LIMIT_CHANGE', -500])
  })

  it('CREDIT_USED_INCREASE is +amount and CREDIT_USED_DECREASE −amount, with available before → after', () => {
    const up = ledgerRowToEntry(ledger({ transactionType: 'CREDIT_USED_INCREASE', amount: 100, balanceBefore: 900, balanceAfter: 800 }), PLAYER)
    assert.deepEqual([up?.type, up?.amount, up?.valueBefore, up?.valueAfter], ['CREDIT_USED_CHANGE', 100, 900, 800])
    const down = ledgerRowToEntry(ledger({ transactionType: 'CREDIT_USED_DECREASE', amount: 100, balanceBefore: 800, balanceAfter: 900 }), PLAYER)
    assert.deepEqual([down?.type, down?.amount], ['CREDIT_USED_CHANGE', -100])
  })

  it('ALLOCATION to the player is the credit given at creation', () => {
    const entry = ledgerRowToEntry(ledger({ transactionType: 'ALLOCATION', amount: 5000, balanceBefore: 20000, balanceAfter: 15000, reason: 'Credit allocation to player at creation' }), PLAYER)
    assert.deepEqual([entry?.type, entry?.amount, entry?.valueBefore, entry?.valueAfter], ['ALLOCATION', 5000, null, null])
  })
})

describe("rows that are not this player's statement", () => {
  it("another player's row, bet-exposure rows and agent-side rows are left out", () => {
    assert.equal(ledgerRowToEntry(ledger({ transactionType: 'CREDIT_LIMIT_ADJUSTMENT', toEntityId: '43' }), PLAYER), null)
    assert.equal(ledgerRowToEntry(ledger({ transactionType: 'USAGE', fromEntityType: 'player', fromEntityId: PLAYER }), PLAYER), null)
    assert.equal(ledgerRowToEntry(ledger({ transactionType: 'RELEASE' }), PLAYER), null)
    assert.equal(ledgerRowToEntry(ledger({ transactionType: 'WITHDRAWAL', fromEntityType: 'agent' }), PLAYER), null)
    assert.equal(ledgerRowToEntry(ledger({ toEntityType: 'agent', toEntityId: 'agent-1', reason: 'Player credit settlement cascaded - Player ID: 42, settlement 100 → 0' }), PLAYER), null)
  })

  it('the SQL type list holds exactly the types the mapper can turn into rows', () => {
    assert.deepEqual([...STATEMENT_LEDGER_TYPES].sort(), ['ADJUSTMENT', 'ALLOCATION', 'CREDIT_LIMIT_ADJUSTMENT', 'CREDIT_USED_DECREASE', 'CREDIT_USED_INCREASE', 'DEPOSIT', 'WITHDRAWAL'])
  })
})
