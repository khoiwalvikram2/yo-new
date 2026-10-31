import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  BONUS_AWARD_COLUMNS,
  BONUS_AWARDS_DATE_PRESETS,
  bonusAwardPlayerContact,
  bonusAwardPlayerName,
  bonusAwardRowActionKind,
  bonusAwardsToday,
  bonusAwardStatusLabel,
  bonusRemarkModalMeta,
  bonusRoiPercent,
  buildBonusAwardsFiltersPayload,
  buildCardStats,
  buildLedgerStats,
  clampBonusAwardsOffset,
  countActiveBonusAwardFilters,
  formatWageringPair,
  getBonusAwardsPresetFromRange,
  getBonusAwardsRangeForPreset,
  initialBonusAwardsFilters,
  lookupEmptyText,
  requestErrorMessage,
  resolveBonusRemarkOutcome,
  shiftDay,
  toAgentOptions,
  toCampaignOptions,
  toPlayerOptions,
  wageringProgressPercent,
  type BonusAwardRow,
} from './bonusAwardsModel'

// 2026-10-07 00:30 IST is still 2026-10-06 in UTC; 23:30 IST is the same IST day, UTC 18:00.
const JUST_AFTER_IST_MIDNIGHT = new Date('2026-10-06T19:00:00.000Z')
const LATE_IST_EVENING = new Date('2026-10-07T18:00:00.000Z')

const ROW: BonusAwardRow = {
  id: '91',
  campaignId: 12,
  campaignName: 'Diwali Reload',
  userId: 4410,
  userName: null,
  userPhone: null,
  domain: 'sports',
  type: 'deposit',
  amount: 500,
  currency: 'INR',
  wageringReq: 5000,
  currentWagering: 1250,
  status: 'pending',
  awardedAt: '2026-10-06T10:00:00.000Z',
  completedAt: null,
  triggerAmount: null,
  firstDepositRequired: null,
  firstDepositUnlocked: null,
  distributionType: null,
}

describe('bonusAwardsModel dates', () => {
  test('today is the IST calendar day on both sides of IST midnight', () => {
    assert.equal(bonusAwardsToday(JUST_AFTER_IST_MIDNIGHT), '2026-10-07')
    assert.equal(bonusAwardsToday(LATE_IST_EVENING), '2026-10-07')
    assert.deepStrictEqual(initialBonusAwardsFilters(JUST_AFTER_IST_MIDNIGHT), {
      dateFrom: '2026-10-07',
      dateTo: '2026-10-07',
      domain: '',
    })
  })

  test('shiftDay moves calendar days across months and years', () => {
    assert.equal(shiftDay('2026-03-01', -1), '2026-02-28')
    assert.equal(shiftDay('2024-03-01', -1), '2024-02-29')
    assert.equal(shiftDay('2026-01-01', -29), '2025-12-03')
    assert.equal(shiftDay('2026-12-31', 1), '2027-01-01')
  })

  test('presets are the legacy inclusive IST windows; Custom applies nothing', () => {
    const now = JUST_AFTER_IST_MIDNIGHT
    assert.deepStrictEqual(getBonusAwardsRangeForPreset('today', now), { from: '2026-10-07', to: '2026-10-07' })
    assert.deepStrictEqual(getBonusAwardsRangeForPreset('yesterday', now), { from: '2026-10-06', to: '2026-10-06' })
    assert.deepStrictEqual(getBonusAwardsRangeForPreset('last7days', now), { from: '2026-10-01', to: '2026-10-07' })
    assert.deepStrictEqual(getBonusAwardsRangeForPreset('last30days', now), { from: '2026-09-08', to: '2026-10-07' })
    assert.equal(getBonusAwardsRangeForPreset('custom', now), null)
    assert.deepStrictEqual(
      BONUS_AWARDS_DATE_PRESETS.map((preset) => preset.label),
      ['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Custom Range'],
    )
  })

  test('a range reads back as its preset, anything else as Custom Range', () => {
    const now = LATE_IST_EVENING
    assert.equal(getBonusAwardsPresetFromRange('2026-10-07', '2026-10-07', now), 'today')
    assert.equal(getBonusAwardsPresetFromRange('2026-10-06', '2026-10-06', now), 'yesterday')
    assert.equal(getBonusAwardsPresetFromRange('2026-10-01', '2026-10-07', now), 'last7days')
    assert.equal(getBonusAwardsPresetFromRange('2026-09-08', '2026-10-07', now), 'last30days')
    assert.equal(getBonusAwardsPresetFromRange('2026-09-30', '2026-10-07', now), 'custom')
  })
})

describe('bonusAwardsModel filters', () => {
  test('the query filters keep the legacy keys, trimming and omissions', () => {
    const filters = {
      dateFrom: '2026-10-01',
      dateTo: '2026-10-07',
      status: ['pending', 'active'],
      domain: 'casino',
      playerSearch: '  rk_sharma  ',
      agentUsername: '  agent7 ',
      campaignId: 12,
    }
    const admin = buildBonusAwardsFiltersPayload(filters, false)
    assert.deepStrictEqual(Object.keys(admin), [
      'dateFrom', 'dateTo', 'status', 'domain', 'playerSearch', 'agentUsername', 'campaignId',
    ])
    assert.deepStrictEqual(admin, {
      dateFrom: '2026-10-01',
      dateTo: '2026-10-07',
      status: ['pending', 'active'],
      domain: 'casino',
      playerSearch: 'rk_sharma',
      agentUsername: 'agent7',
      campaignId: 12,
    })
    assert.notEqual(admin.status, filters.status, 'the status list is copied')

    const agent = buildBonusAwardsFiltersPayload(filters, true)
    assert.equal(agent.agentUsername, undefined)
    assert.equal(agent.campaignId, undefined)

    const empty = buildBonusAwardsFiltersPayload(
      { dateFrom: 'a', dateTo: 'b', domain: '', status: [], playerSearch: '   ', agentUsername: ' ' },
      false,
    )
    assert.deepStrictEqual(empty, {
      dateFrom: 'a',
      dateTo: 'b',
      status: undefined,
      domain: undefined,
      playerSearch: undefined,
      agentUsername: undefined,
      campaignId: undefined,
    })
  })

  test('the badge counts every status, each filter, and a date range other than today', () => {
    const today = '2026-10-07'
    const base = { dateFrom: today, dateTo: today, domain: '' }
    assert.equal(countActiveBonusAwardFilters(base, false, today), 0)
    assert.equal(
      countActiveBonusAwardFilters(
        { ...base, status: ['pending', 'active'], domain: 'sports', campaignId: 0, playerSearch: 'x', agentUsername: 'a' },
        false,
        today,
      ),
      6,
    )
    assert.equal(
      countActiveBonusAwardFilters({ ...base, campaignId: 3, agentUsername: 'a' }, true, today),
      0,
      'campaign and agent do not count for an agent',
    )
    assert.equal(countActiveBonusAwardFilters({ ...base, dateFrom: '2026-10-01' }, false, today), 1)
  })

  test('lookups keep the legacy option shapes and empty texts', () => {
    assert.deepStrictEqual(toCampaignOptions([{ id: '12', name: 'Diwali Reload' }]), [
      { value: '12', label: 'Diwali Reload (#12)' },
    ])
    assert.deepStrictEqual(toCampaignOptions(null), [])
    assert.deepStrictEqual(toAgentOptions([{ id: '1', username: 'agent7' }]), [{ label: 'agent7', value: 'agent7' }])
    assert.deepStrictEqual(
      toPlayerOptions([
        { id: 1, username: 'rk_sharma', phone: '9876500001' },
        { id: 2, name: 'Meena P' },
        { id: 3, username: '   ' },
      ]),
      [
        { label: 'rk_sharma (9876500001)', value: 'rk_sharma' },
        { label: 'Meena P', value: 'Meena P' },
        { label: '   ', value: '3' },
      ],
    )
    assert.equal(lookupEmptyText('a', 'players'), 'Type 2+ letters')
    assert.equal(lookupEmptyText(' ab ', 'players'), 'No players')
    assert.equal(lookupEmptyText('ag', 'agents'), 'No agents')
  })
})

describe('bonusAwardsModel rows and paging', () => {
  test('wagering progress follows the legacy rounding and its absent requirement', () => {
    assert.equal(wageringProgressPercent(1250, 5000), 25)
    assert.equal(wageringProgressPercent(1, 3), 33.3)
    assert.equal(wageringProgressPercent(9000, 5000), 100)
    assert.equal(wageringProgressPercent(0, 5000), 0)
    assert.equal(wageringProgressPercent(-5, 5000), 0)
    assert.equal(wageringProgressPercent(10, 0), null)
    assert.equal(wageringProgressPercent(10, Number.NaN), null)
    assert.equal(formatWageringPair(1250, 5000), '1,250.00 / 5,000.00')
  })

  test('row labels, fallbacks and actions', () => {
    assert.equal(bonusAwardStatusLabel('cancelled'), 'Cancelled')
    assert.equal(bonusAwardStatusLabel(''), '')
    assert.equal(bonusAwardPlayerName(ROW), 'User 4410')
    assert.equal(bonusAwardPlayerContact(ROW), 'ID 4410')
    assert.equal(bonusAwardPlayerName({ ...ROW, userName: 'rk_sharma' }), 'rk_sharma')
    assert.equal(bonusAwardPlayerContact({ ...ROW, userPhone: '9876500001' }), '9876500001')
    assert.equal(bonusAwardRowActionKind('pending'), 'pending')
    assert.equal(bonusAwardRowActionKind('active'), 'active')
    for (const status of ['completed', 'expired', 'cancelled', '']) {
      assert.equal(bonusAwardRowActionKind(status), 'none')
    }
    assert.equal(BONUS_AWARD_COLUMNS.length, 16)
  })

  test('the offset clamps to the last page and resets when nothing matches', () => {
    assert.equal(clampBonusAwardsOffset(0, 50, 100), 0)
    assert.equal(clampBonusAwardsOffset(120, 50, 200), 100)
    assert.equal(clampBonusAwardsOffset(120, 50, 100), 100)
    assert.equal(clampBonusAwardsOffset(100, 50, 100), 50)
    assert.equal(clampBonusAwardsOffset(10, 0, 30), 30)
  })
})

describe('bonusAwardsModel remark dialog', () => {
  test('each mode keeps its legacy title, description, button and tone', () => {
    assert.deepStrictEqual(bonusRemarkModalMeta({ mode: 'setStatus', awardId: '9', nextStatus: 'cancelled' }), {
      title: 'Cancel (revoke) this bonus card?',
      description: 'The pending bonus will be cancelled. No wallet amount is removed (card was not active yet).',
      okText: 'Confirm',
      danger: true,
    })
    assert.deepStrictEqual(bonusRemarkModalMeta({ mode: 'setStatus', awardId: '9', nextStatus: 'expired' }), {
      title: 'Mark this bonus expired?',
      description: 'The pending bonus will be marked as expired.',
      okText: 'Confirm',
      danger: false,
    })
    assert.deepStrictEqual(bonusRemarkModalMeta({ mode: 'activate', row: ROW }), {
      title: 'Activate this bonus card?',
      description: 'This runs the same activation rules as the user app (first deposit, expiry, wallet credit).',
      okText: 'Activate',
      danger: false,
    })
    assert.deepStrictEqual(bonusRemarkModalMeta({ mode: 'forfeit', row: ROW }), {
      title: 'Forfeit this active bonus?',
      description:
        'The player’s bonus wallet balance will be cleared to zero and this card will be marked cancelled — same as the player app “Forfeit” action.',
      okText: 'Forfeit bonus',
      danger: true,
    })
    assert.deepStrictEqual(bonusRemarkModalMeta({ mode: 'switch', row: ROW }), {
      title: 'Switch to this bonus?',
      description:
        'The current active bonus will be cancelled and the bonus wallet balance cleared, then this card will be activated.',
      okText: 'Switch bonus',
      danger: true,
    })
  })

  test('an answer closes, switches, errors or does nothing as the legacy handler did', () => {
    assert.deepStrictEqual(resolveBonusRemarkOutcome('setStatus', { success: true, message: 'Bonus expired' }), {
      kind: 'success',
      message: 'Bonus expired',
    })
    assert.deepStrictEqual(resolveBonusRemarkOutcome('setStatus', { success: true }), { kind: 'success', message: 'Updated' })
    assert.deepStrictEqual(resolveBonusRemarkOutcome('activate', { success: true, message: null }), {
      kind: 'success',
      message: 'Bonus activated',
    })
    assert.deepStrictEqual(resolveBonusRemarkOutcome('switch', { success: true }), { kind: 'success', message: 'Bonus switched' })
    assert.deepStrictEqual(resolveBonusRemarkOutcome('forfeit', { success: true }), { kind: 'success', message: 'Bonus forfeited' })
    assert.deepStrictEqual(
      resolveBonusRemarkOutcome('activate', { success: false, code: 'ALREADY_ACTIVE_BONUS', message: 'Already active' }),
      { kind: 'switch' },
    )
    assert.deepStrictEqual(
      resolveBonusRemarkOutcome('forfeit', { success: false, code: 'ALREADY_ACTIVE_BONUS', message: 'Nope' }),
      { kind: 'error', title: 'Forfeit bonus', message: 'Nope' },
      'only an activation turns into a switch',
    )
    assert.deepStrictEqual(resolveBonusRemarkOutcome('setStatus', { success: false, message: 'Locked' }), {
      kind: 'error',
      title: 'Bonus card',
      message: 'Locked',
    })
    assert.deepStrictEqual(resolveBonusRemarkOutcome('activate', { success: false, message: 'No deposit' }), {
      kind: 'error',
      title: 'Activate bonus',
      message: 'No deposit',
    })
    assert.deepStrictEqual(resolveBonusRemarkOutcome('switch', { success: false, message: 'x' }).kind, 'error')
    assert.deepStrictEqual(resolveBonusRemarkOutcome('switch', { success: false, message: '' }), { kind: 'none' })
    assert.deepStrictEqual(resolveBonusRemarkOutcome('forfeit', null), { kind: 'none' })
    assert.equal(requestErrorMessage(new Error('Network down'), 'Request failed'), 'Network down')
    assert.equal(requestErrorMessage('boom', 'Request failed'), 'Request failed')
  })
})

describe('bonusAwardsModel stats', () => {
  const fmt = (amount: number, currency?: string) => `${currency} ${amount.toFixed(2)}`

  test('ledger cards keep the legacy order, copy and arithmetic', () => {
    const stats = buildLedgerStats(
      {
        totalRevenue: '1500.5',
        totalWagering: 20000,
        totalIssued: 9000,
        totalRedeemed: 3000,
        outstandingLiability: 4000,
        totalExpired: 100,
        totalCancelled: null,
        awardCount: 1200,
        redemptionCount: 300,
        playerCount: 950,
        roi: 0.1667,
      },
      fmt,
      'INR',
    )
    assert.deepStrictEqual(
      stats.map((stat) => [stat.label, stat.value, stat.note]),
      [
        ['Bonus revenue (GGR)', 'INR 1500.50', 'Expired + cancelled bonuses (date range)'],
        ['Bonus wagering (stakes)', 'INR 20000.00', 'Turnover attributed to bonus activity'],
        ['Total issued', 'INR 9000.00', 'Bonus amounts issued in period'],
        ['Total redeemed', 'INR 3000.00', 'Completed bonus amounts (awarded in range)'],
        ['Outstanding liability', 'INR 4000.00', 'Pending + active bonus amounts'],
        ['Bonus ROI', '16.67%', 'Revenue ÷ issued (date range)'],
        ['Expired', 'INR 100.00', 'Bonus amounts expired in period'],
        ['Cancelled', 'INR 0.00', 'Bonus amounts cancelled in period'],
        ['Award / redemption events', '1,200 / 300', 'Total awards / completed redemptions'],
        ['Players', '950', 'Distinct players with bonus awards in range'],
      ],
    )
    assert.equal(bonusRoiPercent(null), '0.00')
    assert.equal(bonusRoiPercent({ roi: 'abc' }), '0.00')
    assert.equal(buildLedgerStats(undefined, fmt, 'INR')[0]?.value, 'INR 0.00')
  })

  test('list-scope cards keep the legacy order, copy and zero fallbacks', () => {
    const stats = buildCardStats(
      {
        total: 1240,
        pending: 40,
        active: 300,
        completed: 800,
        expired: 60,
        cancelled: 40,
        totalBonusPaid: 120000,
        bonusWalletTotal: 45000,
        wageringRemaining: 300000,
        bonusUses: 1100,
        bonusToCashTransferred: 25000,
      },
      fmt,
      'INR',
    )
    assert.deepStrictEqual(
      stats.map((stat) => [stat.label, stat.value, stat.note ?? null]),
      [
        ['Total bonus paid', 'INR 120000.00', 'Award amounts — active + completed cards (filtered)'],
        ['Bonus dues', 'INR 45000.00', 'Sum of bonus wallet balances for players in this scope'],
        ['Wagering left to complete', 'INR 300000.00', 'Active cards only: remaining wagering (req − progress), same filters as table'],
        [
          'Bonus → cash transferred',
          'INR 25000.00',
          'Cash credits from bonus → cash for cards matching filters (same awarded-date scope as the table)',
        ],
        ['Bonus uses', '1,100', 'Cards active or completed'],
        ['Total cards', '1,240', null],
        ['Pending', '40', null],
        ['Active', '300', null],
        ['Completed', '800', null],
        ['Expired', '60', null],
        ['Cancelled', '40', null],
      ],
    )
    assert.deepStrictEqual(
      buildCardStats(null, fmt, 'INR').map((stat) => stat.value),
      ['INR 0.00', 'INR 0.00', 'INR 0.00', 'INR 0.00', '0', '0', '0', '0', '0', '0', '0'],
    )
  })
})
