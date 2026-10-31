import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pendingLastSettlementDates } from '../pendingSettlementReads.js'

describe('batched last-settlement dates', () => {
  it('keeps the newest posted row per agent even when newer open rows exist', () => {
    const dates = pendingLastSettlementDates([
      { agentId: 'a', status: 'OPEN', createdAt: '2026-10-24' },
      { agentId: 'b', status: 'OPEN', createdAt: '2026-10-23' },
      { agentId: 'a', status: 'POSTED', createdAt: '2026-10-22' },
      { agentId: 'a', status: 'POSTED', createdAt: '2026-10-21' },
      { agentId: 'b', status: 'LOCKED', createdAt: '2026-10-20' },
    ])
    assert.equal(dates.get('a')?.toISOString(), '2026-10-22T00:00:00.000Z')
    assert.equal(dates.get('b')?.toISOString(), '2026-10-23T00:00:00.000Z')
  })
  it('preserves invalid/null selected dates and empty agents without borrowing older data', () => {
    assert.deepEqual([...pendingLastSettlementDates([
      { agentId: 'a', status: 'POSTED', createdAt: 'invalid' },
      { agentId: 'a', status: 'POSTED', createdAt: '2026-10-21' },
      { agentId: 'b', status: 'OPEN', createdAt: null },
    ])], [])
    assert.equal(pendingLastSettlementDates([]).size, 0)
  })
})
