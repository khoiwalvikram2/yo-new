import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  CREDIT_DEFAULT_PAGE_SIZE,
  CREDIT_PAGE_SIZE_OPTIONS,
  CREDIT_TABS,
  creditUsageFigures,
  formatCreditPercent,
  getCreditUsageStatus,
  historyCardSub,
  historyHasNextPage,
  historyPlayerLink,
  historyRange,
  historyTypeLabel,
  historyTypeTone,
  isPositiveHistoryAmount,
  isToAgent,
  isWhitelabelAdminRole,
  recordCountLabel,
  schemeTone,
  settlementAgentLabel,
  settlementDirectionLabel,
  sliceSettlementPage,
  whitelabelSettlementSign,
} from './creditManagementModel'

describe('creditManagementModel', () => {
  test('keeps the legacy tabs, page sizes and default page size', () => {
    assert.deepEqual(CREDIT_TABS.map((tab) => [tab.value, tab.label]), [
      ['overview', 'Overview'],
      ['history', 'Adjustments'],
      ['settlements', 'Settlements'],
    ])
    assert.deepEqual([...CREDIT_PAGE_SIZE_OPTIONS], [10, 20, 50, 100])
    assert.equal(CREDIT_DEFAULT_PAGE_SIZE, 20)
  })

  test('recognises a whitelabel admin by the legacy role-name test only', () => {
    assert.equal(isWhitelabelAdminRole(['Whitelabel Admin']), true)
    assert.equal(isWhitelabelAdminRole(['WHITELABEL_ADMIN']), true)
    assert.equal(isWhitelabelAdminRole(['Senior whitelabel operator']), true)
    assert.equal(isWhitelabelAdminRole(['Viewer', 'WhiteLabel Finance']), true)
    assert.equal(isWhitelabelAdminRole(['Super Admin']), false)
    assert.equal(isWhitelabelAdminRole(['White label admin']), false)
    assert.equal(isWhitelabelAdminRole([]), false)
  })

  test('grades usage: 90% and above is critical whatever the threshold, then the alert threshold', () => {
    assert.equal(getCreditUsageStatus(90, 95).level, 'critical')
    assert.equal(getCreditUsageStatus(99.9, 80).label, 'Critical')
    assert.equal(getCreditUsageStatus(80, 80).level, 'warning')
    assert.equal(getCreditUsageStatus(89.99, 50).label, 'Warning')
    assert.equal(getCreditUsageStatus(79.99, 80).level, 'healthy')
    assert.equal(getCreditUsageStatus(0, 0).level, 'warning')

    assert.deepEqual(
      ['critical', 'warning', 'healthy'].map((level) => {
        const status = level === 'critical'
          ? getCreditUsageStatus(95, 80)
          : level === 'warning'
            ? getCreditUsageStatus(85, 80)
            : getCreditUsageStatus(10, 80)
        return [status.label, status.noticeTone, status.pillTone, status.meterTone]
      }),
      [
        ['Critical', 'error', 'neg', 'neg'],
        ['Warning', 'warn', 'warn', 'warn'],
        ['Healthy', 'ok', 'ok', 'acc'],
      ],
    )
  })

  test('reads a missing usage as 0 and prints one decimal place', () => {
    assert.deepEqual(creditUsageFigures({ usagePercentage: null }), { usagePercentage: 0, availablePercentage: 100 })
    assert.deepEqual(creditUsageFigures({ usagePercentage: 37.7 }), {
      usagePercentage: 37.7,
      availablePercentage: 100 - 37.7,
    })
    assert.equal(formatCreditPercent(37.7), '37.7')
    assert.equal(formatCreditPercent(100 - 37.7), '62.3')
    assert.equal(formatCreditPercent(0), '0.0')
    assert.equal(formatCreditPercent(112.345), '112.3')
  })

  test('labels and tones adjustment types as the legacy tags did', () => {
    assert.equal(historyTypeLabel('RELEASE'), 'WITHDRAW')
    assert.equal(historyTypeLabel('DEPOSIT'), 'DEPOSIT')
    assert.equal(historyTypeLabel('ALLOCATION'), 'ALLOCATION')
    assert.deepEqual(
      ['DEPOSIT', 'RELEASE', 'USAGE', 'ALLOCATION', 'ADJUSTMENT', 'SETTLEMENT'].map(historyTypeTone),
      ['ok', 'warn', 'neutral', 'info', 'info', 'info'],
    )
  })

  test('signs an adjustment amount by its type, and an adjustment by its balance movement', () => {
    const row = (transactionType: string, balanceBefore = 100, balanceAfter = 100) => ({
      transactionType,
      balanceBefore,
      balanceAfter,
    })
    assert.equal(isPositiveHistoryAmount(row('ALLOCATION')), true)
    assert.equal(isPositiveHistoryAmount(row('RELEASE')), true)
    assert.equal(isPositiveHistoryAmount(row('DEPOSIT')), false)
    assert.equal(isPositiveHistoryAmount(row('USAGE')), false)
    assert.equal(isPositiveHistoryAmount(row('ADJUSTMENT', 100, 150)), true)
    assert.equal(isPositiveHistoryAmount(row('ADJUSTMENT', 150, 100)), false)
    assert.equal(isPositiveHistoryAmount(row('ADJUSTMENT', 100, 100)), false)
  })

  test('links a player only when the row names one, by trimmed phone or "View profile"', () => {
    assert.equal(historyPlayerLink({ playerId: null, playerPhone: '9876543210' }), null)
    assert.equal(historyPlayerLink({ playerPhone: '9876543210' }), null)
    assert.deepEqual(historyPlayerLink({ playerId: 22, playerPhone: '  9876543210 ' }), {
      to: '/players/profile/22',
      label: '9876543210',
    })
    assert.deepEqual(historyPlayerLink({ playerId: 0, playerPhone: '   ' }), {
      to: '/players/profile/0',
      label: 'View profile',
    })
    assert.deepEqual(historyPlayerLink({ playerId: 7, playerPhone: null }), {
      to: '/players/profile/7',
      label: 'View profile',
    })
    assert.equal(historyPlayerLink({ playerId: 7, playerPhone: 919812345678 })?.label, '919812345678')
  })

  test('describes the adjustments page as the legacy header and pager did', () => {
    assert.equal(historyCardSub(1, 20, 0), '0 transactions')
    assert.equal(historyCardSub(1, 20, 1), '1 transaction')
    assert.equal(historyCardSub(1, 20, 19), '19 transactions')
    assert.equal(historyCardSub(1, 20, 20), 'Page 1 • 20 rows')
    assert.equal(historyCardSub(3, 20, 4), 'Page 3 • 4 rows')

    assert.deepEqual(historyRange(1, 20, 20), { range: '1–20', more: false })
    assert.deepEqual(historyRange(3, 20, 4), { range: '41–44', more: false })
    assert.deepEqual(historyRange(2, 10, 10), { range: '11–20', more: false })

    assert.equal(historyHasNextPage(20, 20), false)
    assert.equal(historyHasNextPage(21, 20), true)
    assert.equal(historyHasNextPage(19, 20), false)
    assert.equal(historyHasNextPage(0, 20), false)
  })

  test('pages a settlement list on the client exactly as before', () => {
    const rows = Array.from({ length: 5 }, (_, index) => index + 1)
    assert.deepEqual(sliceSettlementPage(rows, 1, 2), [1, 2])
    assert.deepEqual(sliceSettlementPage(rows, 3, 2), [5])
    assert.deepEqual(sliceSettlementPage(rows, 4, 2), [])
    assert.deepEqual(sliceSettlementPage(undefined, 1, 20), [])
    assert.deepEqual(sliceSettlementPage(null, 1, 20), [])
    // The server already returns one page; the legacy slice on page 2 of a 20-row reply is empty.
    assert.deepEqual(sliceSettlementPage(Array.from({ length: 20 }, (_, index) => index), 2, 20), [])
  })

  test('labels settlement rows as the legacy table did', () => {
    assert.equal(recordCountLabel(0), '0 records')
    assert.equal(recordCountLabel(1), '1 record')
    assert.equal(recordCountLabel(12), '12 records')

    assert.equal(settlementAgentLabel({ agentId: 'a1b2c3d4e5f6', agent: { id: 'a1b2c3d4e5f6', username: 'north_desk' } }), 'north_desk')
    assert.equal(settlementAgentLabel({ agentId: 'a1b2c3d4e5f6', agent: { id: 'a1b2c3d4e5f6', username: '' } }), 'a1b2c3d4...')
    assert.equal(settlementAgentLabel({ agentId: 'a1b2c3d4e5f6', agent: null }), 'a1b2c3d4...')

    assert.deepEqual(['CREDIT', 'SHARING', 'COMMISSION'].map(schemeTone), ['info', 'ok', 'warn'])
    assert.equal(isToAgent('TO_AGENT'), true)
    assert.equal(isToAgent('FROM_AGENT'), false)
    assert.equal(settlementDirectionLabel('TO_AGENT'), 'To Agent')
    assert.equal(settlementDirectionLabel('FROM_AGENT'), 'From Agent')
    assert.equal(settlementDirectionLabel('SOMETHING_ELSE'), 'From Agent')

    assert.equal(whitelabelSettlementSign(250), '+')
    assert.equal(whitelabelSettlementSign(0), '+')
    assert.equal(whitelabelSettlementSign(-250), '')
  })
})
