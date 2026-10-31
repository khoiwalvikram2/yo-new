import { describe, expect, test } from 'vitest'
import {
  AGENT_CREDIT_PAGE_SIZE,
  AGENT_CREDIT_TABS,
  agentCreditAccess,
  agentCreditStatus,
  agentCreditUsage,
  canLoadNextPage,
  formatAgentCreditPercent,
  isSettlementToAgent,
  pageRange,
  pageSummary,
  settlementDirectionLabel,
  transactionAmountTone,
} from './agentCreditManagementModel'

describe('agent credit management model', () => {
  test('keeps the exact CREDIT-only access gate', () => {
    expect(agentCreditAccess()).toBe('unauthenticated')
    expect(agentCreditAccess(null)).toBe('unauthenticated')
    expect(agentCreditAccess({ schemeType: 'CREDIT' })).toBe('allowed')
    for (const value of ['credit', 'SHARING', 'COMMISSION', '', null]) {
      expect(agentCreditAccess({ schemeType: value })).toBe('denied')
    }
  })

  test('keeps the three tabs and fixed server page size', () => {
    expect(AGENT_CREDIT_TABS).toEqual([
      { value: 'overview', label: 'Overview' },
      { value: 'history', label: 'Adjustments' },
      { value: 'settlements', label: 'Settlements' },
    ])
    expect(AGENT_CREDIT_PAGE_SIZE).toBe(20)
  })

  test('marks ninety percent critical before considering the threshold', () => {
    expect(agentCreditStatus(90, 95)).toMatchObject({ level: 'critical', label: 'Critical', pillTone: 'neg' })
    expect(agentCreditStatus(80, 80)).toMatchObject({ level: 'warning', label: 'Warning', pillTone: 'warn' })
    expect(agentCreditStatus(79.9, 80)).toMatchObject({ level: 'healthy', label: 'Healthy', pillTone: 'ok' })
  })

  test('uses zero for missing usage and retains the legacy remainder calculation', () => {
    expect(agentCreditUsage({ usagePercentage: null })).toEqual({ used: 0, available: 100 })
    expect(agentCreditUsage({ usagePercentage: 42.25 })).toEqual({ used: 42.25, available: 57.75 })
    expect(formatAgentCreditPercent(42.25)).toBe('42.3')
  })

  test('uses the stored numeric sign for credit transactions', () => {
    expect(transactionAmountTone(0)).toBe('positive')
    expect(transactionAmountTone(50)).toBe('positive')
    expect(transactionAmountTone(-0.01)).toBe('negative')
  })

  test('keeps exact TO_AGENT direction semantics', () => {
    expect(isSettlementToAgent('TO_AGENT')).toBe(true)
    expect(settlementDirectionLabel('TO_AGENT')).toBe('To Agent')
    expect(isSettlementToAgent('to_agent')).toBe(false)
    expect(settlementDirectionLabel('FROM_AGENT')).toBe('From Agent')
  })

  test('describes short and full server pages truthfully', () => {
    expect(pageSummary(1, 20, 1)).toBe('1 record')
    expect(pageSummary(1, 20, 4)).toBe('4 records')
    expect(pageSummary(2, 20, 20)).toBe('Page 2 • 20 rows')
    expect(pageRange(1, 20, 0)).toBe('0')
    expect(pageRange(2, 20, 3)).toBe('21–23')
    expect(canLoadNextPage(19, 20)).toBe(false)
    expect(canLoadNextPage(20, 20)).toBe(true)
  })
})
