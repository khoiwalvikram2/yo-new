import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { chipNetworkTotals, chipsById, type AgentChipTotalsItem } from './agentChips'

const item = (id: string, parentAgentId: string | null, chips: Partial<NonNullable<AgentChipTotalsItem['chips']>> | null): AgentChipTotalsItem => ({
  id,
  parentAgentId,
  chips: chips ? { id, currency: 'INR', creditReference: 0, balance: 0, exposure: 0, downlineBalance: 0, refPnl: 0, ...chips } : null,
})

describe('chipNetworkTotals', () => {
  test('adds up top-level agents only: a sub-agent is already inside its parent’s downline balance and Ref P/L', () => {
    const totals = chipNetworkTotals([
      item('root', null, { balance: 30000, downlineBalance: 5000, exposure: 700, creditReference: 40000, refPnl: -5000 }),
      item('child', 'root', { balance: 5000, exposure: 300, creditReference: 1000, refPnl: 4000 }),
      // Its parent is outside the list (another scheme, or above a signed-in agent): it heads its own branch.
      item('detached', 'elsewhere', { balance: 1000, downlineBalance: 250, exposure: 50, creditReference: 1500, refPnl: -250 }),
    ])
    assert.deepEqual(totals, { chips: 36250, exposure: 750, creditReference: 41500, refPnl: -5250, currency: 'INR' })
  })

  test('an agent without chips (no CREDIT figures yet) adds nothing; no agents is all zeros', () => {
    assert.deepEqual(chipNetworkTotals([item('root', null, null)]), { chips: 0, exposure: 0, creditReference: 0, refPnl: 0, currency: null })
    assert.deepEqual(chipNetworkTotals([]), { chips: 0, exposure: 0, creditReference: 0, refPnl: 0, currency: null })
  })
})

describe('chipsById', () => {
  test('maps each agent with chips to them and skips the rest', () => {
    const map = chipsById([
      { id: 'a', chips: { accountType: 'AGENT', id: 'a', username: 'a', currency: 'INR', creditReference: 1, balance: 2, exposure: 0, available: 2, downlineBalance: 0, refPnl: 1, downlineCount: 0 } },
      { id: 'b', chips: null },
    ])
    assert.deepEqual([...map.keys()], ['a'])
    assert.equal(map.get('a')?.balance, 2)
    assert.equal(chipsById(null).size, 0)
  })
})
