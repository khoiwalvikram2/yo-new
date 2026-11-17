import { describe, expect, test } from 'vitest'
import { AGENT_CHIPS_TABS, agentChipsAccess } from './agentCreditManagementModel'

describe('agent chips page model', () => {
  test('keeps the exact CREDIT-only access gate', () => {
    expect(agentChipsAccess()).toBe('unauthenticated')
    expect(agentChipsAccess(null)).toBe('unauthenticated')
    expect(agentChipsAccess({ schemeType: 'CREDIT' })).toBe('allowed')
    for (const value of ['credit', 'SHARING', 'COMMISSION', '', null]) {
      expect(agentChipsAccess({ schemeType: value })).toBe('denied')
    }
  })

  test('has the downline and statement tabs, downline first', () => {
    expect(AGENT_CHIPS_TABS).toEqual([
      { value: 'downline', label: 'Downline' },
      { value: 'statement', label: 'Statement' },
    ])
  })
})
