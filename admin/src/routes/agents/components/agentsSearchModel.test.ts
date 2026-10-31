import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { agentPrimaryAction, agentRowMoneyActions, creditUsage, topLevelAgents } from './agentsSearchModel'

describe('topLevelAgents', () => {
  test('keeps agents whose parent is not in the list, so a downline is not counted twice', () => {
    const rows = [
      { id: 'root', parentAgentId: null },
      { id: 'child', parentAgentId: 'root' },
      { id: 'grandchild', parentAgentId: 'child' },
      // Its parent is on another scheme (or outside a logged-in agent's view): it heads its own branch here.
      { id: 'detached', parentAgentId: 'elsewhere' },
    ]
    assert.deepEqual(topLevelAgents(rows).map(row => row.id), ['root', 'detached'])
    assert.deepEqual(topLevelAgents([]), [])
  })
})

describe('agentRowMoneyActions', () => {
  test('an agent settles and pays its direct children only', () => {
    const caller = { agentId: 'me' }
    assert.deepEqual(agentRowMoneyActions({ schemeType: 'SHARING', parentAgentId: 'me' }, caller), { settle: true, pay: false })
    assert.deepEqual(agentRowMoneyActions({ schemeType: 'CREDIT', parentAgentId: 'child' }, caller), { settle: false, pay: false })
    assert.deepEqual(agentRowMoneyActions({ schemeType: 'COMMISSION', parentAgentId: 'me' }, caller), { settle: false, pay: true })
    assert.deepEqual(agentRowMoneyActions({ schemeType: 'COMMISSION', parentAgentId: 'child' }, caller), { settle: false, pay: false })
  })
  test('an admin settles any agent but pays only top-level commission agents; whitelabel admins do not pay', () => {
    assert.equal(agentRowMoneyActions({ schemeType: 'SHARING', parentAgentId: 'p' }, {}).settle, true)
    assert.equal(agentRowMoneyActions({ schemeType: 'COMMISSION', parentAgentId: null }, {}).pay, true)
    assert.equal(agentRowMoneyActions({ schemeType: 'COMMISSION', parentAgentId: 'p' }, {}).pay, false)
    assert.equal(agentRowMoneyActions({ schemeType: 'COMMISSION', parentAgentId: null }, { isWhitelabelAdmin: true }).pay, false)
  })
})

describe('creditUsage', () => {
  test('share of the limit, headroom and the high-use band match the stats card', () => {
    assert.deepEqual(creditUsage({ creditLimit: 10000, creditUsed: 3000, creditAvailable: 7000 }), { limit: 10000, used: 3000, available: 7000, percent: 30, high: false })
    assert.equal(creditUsage({ creditLimit: 500000, creditUsed: 462000, creditAvailable: 38000 }).high, true)
    assert.equal(creditUsage({ creditLimit: 100, creditUsed: 80 }).high, false)
    assert.deepEqual(creditUsage({ creditLimit: 0, creditUsed: 0 }), { limit: 0, used: 0, available: 0, percent: 0, high: false })
    assert.equal(creditUsage({ creditLimit: 100, creditUsed: 150 }).percent, 100)
  })
})

describe('agentPrimaryAction', () => {
  const row = (schemeType: string, status = 'ACTIVE', commissionEarned = 0) => ({ schemeType, status, stats: { commissionEarned } })
  test('money that is due comes first, then reactivation, then the scheme routine', () => {
    assert.equal(agentPrimaryAction(row('CREDIT', 'SUSPENDED'), { settle: true, pay: false, hasPending: true }), 'settle')
    assert.equal(agentPrimaryAction(row('CREDIT'), { settle: true, pay: false, hasPending: false }), 'credit')
    assert.equal(agentPrimaryAction(row('CREDIT', 'SUSPENDED'), { settle: true, pay: false, hasPending: false }), 'reactivate')
    assert.equal(agentPrimaryAction(row('COMMISSION', 'ACTIVE', 1200), { settle: false, pay: true, hasPending: false }), 'pay')
    assert.equal(agentPrimaryAction(row('COMMISSION', 'ACTIVE', 1200), { settle: false, pay: false, hasPending: false }), 'view')
    assert.equal(agentPrimaryAction(row('SHARING'), { settle: false, pay: false, hasPending: true }), 'view')
  })
})
