import { describe, expect, test } from 'vitest'
import {
  COMMISSION_HISTORY_DEFAULT_PAGE_SIZE,
  COMMISSION_HISTORY_PAGE_SIZES,
  COMMISSION_HISTORY_TABS,
  activeCommissionHistoryFilters,
  applyHistoryDateRange,
  historyTabFromParams,
  paidAtLabel,
  subAgentLabel,
  subAgentOptions,
  weekLabel,
} from './commissionHistoryModel'

describe('commission history model', () => {
  test('keeps tab order and paging options', () => {
    expect(COMMISSION_HISTORY_TABS).toEqual([
      { value: 'my', label: 'My Settlements' },
      { value: 'subAgent', label: 'Sub-agent Settlements' },
    ])
    expect(COMMISSION_HISTORY_DEFAULT_PAGE_SIZE).toBe(50)
    expect(COMMISSION_HISTORY_PAGE_SIZES).toEqual([10, 20, 50, 100])
  })

  test('derives the tab exactly from URL state', () => {
    expect(historyTabFromParams('my', 'sub-1')).toBe('my')
    expect(historyTabFromParams('subAgent', null)).toBe('subAgent')
    expect(historyTabFromParams('invalid', 'sub-1')).toBe('subAgent')
    expect(historyTabFromParams(null, null)).toBe('my')
  })

  test('formats a settlement week in IST and keeps missing data truthful', () => {
    expect(weekLabel(null, '2026-10-07')).toBe('—')
    expect(weekLabel('2026-09-28T00:00:00.000Z', '2026-10-05T00:00:00.000Z')).toBe('28 Sep – 05 Oct 2026 (IST)')
  })

  test('formats the paid instant in IST', () => {
    expect(paidAtLabel('2026-10-01T10:00:00.000Z')).toBe('01 Oct 2026 15:30')
  })

  test('uses username then the first eight agent-id characters', () => {
    expect(subAgentLabel({ agentId: '1234567890', agent: { id: '1', username: 'Partner', schemeType: 'COMMISSION' } })).toBe('Partner')
    expect(subAgentLabel({ agentId: '1234567890', agent: null })).toBe('12345678')
  })

  test('counts only a selected sub-agent as the legacy active filter', () => {
    expect(activeCommissionHistoryFilters('my', 'sub-1')).toBe(0)
    expect(activeCommissionHistoryFilters('subAgent')).toBe(0)
    expect(activeCommissionHistoryFilters('subAgent', 'sub-1')).toBe(1)
  })

  test('applies a custom range and ignores unsupported presets', () => {
    expect(applyHistoryDateRange(['2026-09-01', '2026-09-30'], { kind: 'custom', from: '2026-10-01', to: '2026-10-07' })).toEqual(['2026-10-01', '2026-10-07'])
    expect(applyHistoryDateRange(['2026-09-01', '2026-09-30'], { kind: 'preset', preset: 'anything' })).toEqual(['2026-09-01', '2026-09-30'])
  })

  test('builds the all option and truthful sub-agent labels', () => {
    expect(subAgentOptions([
      { agentId: 'agent-123456789', username: 'Partner' },
      { agentId: 'abcdefghijk', username: null },
    ])).toEqual([
      { value: 'all', label: 'All sub-agents' },
      { value: 'agent-123456789', label: 'Partner' },
      { value: 'abcdefghijk', label: 'abcdefgh' },
    ])
  })
})
