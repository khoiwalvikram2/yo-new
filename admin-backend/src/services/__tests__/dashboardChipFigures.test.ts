/**
 * The dashboard's chip helpers that need no database: the credit shape the GraphQL types still carry, and the
 * Ref P/L sums (exact cents; "owing" stays negative, as the old settlement_balance sums did).
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/services/__tests__/dashboardChipFigures.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { creditShapeOf, splitRefPnl, sumRefPnl } from '../dashboardChipFigures.js'
import type { ChipAccount } from '@/domains/agents/services/ChipService.js'

const account = (over: Partial<ChipAccount>): ChipAccount => ({
  accountType: 'AGENT',
  id: 'agent-1',
  username: 'agent1',
  name: null,
  status: 'ACTIVE',
  parentAgentId: null,
  playerType: null,
  currency: 'INR',
  creditReference: 0,
  balance: 0,
  exposure: 0,
  available: 0,
  downlineBalance: 0,
  refPnl: 0,
  downlineCount: 0,
  ...over,
})

describe('creditShapeOf: a CREDIT agent in the credit shape', () => {
  it('reference, own chips, and how far the chips sit below the reference', () => {
    const shape = creditShapeOf(account({
      creditReference: 100_000, balance: 15_000, available: 15_000, downlineBalance: 80_000, exposure: 1_200, refPnl: -5_000,
    }))
    assert.deepEqual(shape, {
      agentId: 'agent-1',
      username: 'agent1',
      creditLimit: 100_000,
      creditUsed: 85_000,
      creditAvailable: 15_000,
      usedShare: 0.85,
      settlementBalance: -5_000,
      creditReference: 100_000,
      balance: 15_000,
      exposure: 1_200,
      downlineBalance: 80_000,
      refPnl: -5_000,
    })
  })

  it('chips above the reference use none of it; without a reference there is no share', () => {
    assert.equal(creditShapeOf(account({ creditReference: 1_000, balance: 1_500 })).creditUsed, 0)
    const none = creditShapeOf(account({ creditReference: 0, balance: 0 }))
    assert.equal(none.creditUsed, 0)
    assert.equal(none.usedShare, 0)
  })

  it('rounds to 2 decimals and reads an empty username as null', () => {
    assert.equal(creditShapeOf(account({ creditReference: 0.3, balance: 0.1 })).creditUsed, 0.2)
    assert.equal(creditShapeOf(account({ username: '' })).username, null)
  })
})

describe('Ref P/L sums', () => {
  const list = [account({ refPnl: 0.1 }), account({ refPnl: 0.2 }), account({ refPnl: -0.3 }), account({ refPnl: 0 })]

  it('splitRefPnl: owed is the positive sum, owing the negative sum kept negative, in exact cents', () => {
    assert.deepEqual(splitRefPnl(list), { owed: 0.3, owing: -0.3, withBalance: 3 })
    assert.deepEqual(splitRefPnl([]), { owed: 0, owing: 0, withBalance: 0 })
  })

  it('sumRefPnl: the net, in exact cents', () => {
    assert.equal(sumRefPnl(list), 0)
    assert.equal(sumRefPnl([account({ refPnl: -3_000 }), account({ refPnl: -200 })]), -3_200)
  })
})
