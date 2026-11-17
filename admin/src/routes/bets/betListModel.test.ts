import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  ALL_MY_PLAYERS_OPTION,
  BETS_EXPORT_BATCH,
  BET_DATE_PRESETS,
  betAgentEmptyText,
  betAgentFilterMode,
  betAgentOptions,
  betColumnSet,
  betCountLabel,
  betDomainLabel,
  betExportCompleteMessage,
  betHeadline,
  betHeadlineLabels,
  betListStateFromSearch,
  betLiability,
  betOutcome,
  betPL,
  betPlayerEmptyText,
  betSearchKeyAction,
  betPlayerOptions,
  betPlayerTextAfterPick,
  betRowKey,
  betsPageNumber,
  betStake,
  betStatusLabel,
  betStatusOptions,
  betStatusTone,
  betWalletLabel,
  buildBetsFiltersPayload,
  campaignDetailLines,
  canOpenRoundDetail,
  casinoDetailLines,
  clampBetsOffset,
  countActiveBetFilters,
  formatDistributionType,
  formatPL,
  getBetRangeForPreset,
  isBackSide,
  isBetDatePreset,
  isBetDomain,
  isBonusWalletLabel,
  isLastBetExportBatch,
  matkaMultiplierLabel,
  matkaPL,
  normalizeBetPageItems,
  outcomeTone,
  plTone,
  roundDetailErrorMessage,
  roundDetailVariables,
  showsBetWalletFilter,
  sportsDetailLines,
  sportsEventPath,
  sportsOddsLabel,
  type CasinoBetItem,
  type MatkaBetItem,
  type SportsBetItem,
} from './betListModel'

function sports(overrides: Partial<SportsBetItem> = {}): SportsBetItem {
  return {
    __typename: 'SportsBet',
    id: 's1',
    status: 'matched',
    currency: 'INR',
    createdAt: '2026-10-07T05:00:00.000Z',
    stake: 2500,
    ...overrides,
  }
}

function casino(overrides: Partial<CasinoBetItem> = {}): CasinoBetItem {
  return {
    __typename: 'CasinoBet',
    id: 'c1',
    status: 'won',
    currency: 'INR',
    createdAt: '2026-10-07T05:00:00.000Z',
    stake: 500,
    ...overrides,
  }
}

function matka(overrides: Partial<MatkaBetItem> = {}): MatkaBetItem {
  return {
    __typename: 'MatkaBet',
    id: 'm1',
    status: 'pending',
    currency: 'INR',
    createdAt: '2026-10-07T05:00:00.000Z',
    betAmount: 100,
    ...overrides,
  }
}

describe('betListModel — query contract', () => {
  test('normalizes the aliased status and market fields exactly as the legacy page did', () => {
    const items = normalizeBetPageItems([
      { __typename: 'SportsBet', id: '1', sportsStatus: 'won', sportsMarketName: 'Match Odds' },
      { __typename: 'CasinoBet', id: '2', casinoStatus: 'lost' },
      { __typename: 'MatkaBet', id: '3', matkaStatus: 'void', marketName: 'Kalyan' },
      { __typename: 'MatkaBet', id: '4' },
    ])
    assert.deepEqual(
      items.map((item) => [item.status, item.marketName]),
      [['won', 'Match Odds'], ['lost', null], ['void', 'Kalyan'], ['', null]],
    )
    assert.equal((items[0] as unknown as Record<string, unknown>).sportsStatus, 'won', 'the raw fields stay')
  })

  test('builds the filters payload with empty values left out and the legacy key order', () => {
    assert.deepEqual(buildBetsFiltersPayload({ dateFrom: '2026-10-07', dateTo: '2026-10-07', status: [] }), {
      status: undefined,
      dateFrom: '2026-10-07',
      dateTo: '2026-10-07',
      agentUsername: undefined,
      playerSearch: undefined,
      search: undefined,
      walletType: undefined,
      userId: undefined,
    })
    const full = buildBetsFiltersPayload({
      userId: '234',
      walletType: 'bonus',
      search: 'x',
      playerSearch: 'rk',
      agentUsername: 'ag1',
      dateTo: '2026-10-07',
      dateFrom: '2026-10-01',
      status: ['won'],
    })
    assert.deepEqual(Object.keys(full), [
      'status', 'dateFrom', 'dateTo', 'agentUsername', 'playerSearch', 'search', 'walletType', 'userId',
    ])
    assert.deepEqual(full.status, ['won'])
    // A picked player reaches the server as its id, the exact filter.
    assert.equal(full.userId, '234')
  })

  test('derives the page number and clamps the offset to the last page that exists', () => {
    assert.equal(betsPageNumber(0, 50), 1)
    assert.equal(betsPageNumber(100, 50), 3)
    assert.equal(betsPageNumber(100, 0), 1)

    assert.equal(clampBetsOffset(0, 120, 50), null)
    assert.equal(clampBetsOffset(100, 120, 50), null)
    assert.equal(clampBetsOffset(150, 120, 50), 100)
    assert.equal(clampBetsOffset(50, 0, 50), 0)
    assert.equal(clampBetsOffset(0, 0, 50), null)
    assert.equal(clampBetsOffset(200, 120, 0), null)
  })

  test('pages the export until the server total, an empty batch or a short batch', () => {
    assert.equal(BETS_EXPORT_BATCH, 500)
    assert.equal(isLastBetExportBatch(500, 1200, 500), false)
    assert.equal(isLastBetExportBatch(1200, 1200, 200), true)
    assert.equal(isLastBetExportBatch(500, 500, 500), true)
    assert.equal(isLastBetExportBatch(500, 900, 0), true)
    assert.equal(isLastBetExportBatch(499, 900, 499), true)
    assert.equal(betExportCompleteMessage(1234), `Exported ${(1234).toLocaleString()} bet(s) matching the current filters.`)
    assert.equal(betCountLabel(1), '1 bet')
    assert.equal(betCountLabel(0), '0 bets')
  })
})

describe('betListModel — date presets', () => {
  test('keeps the legacy preset labels and windows: last 7 days is today and six before it', () => {
    assert.deepEqual(BET_DATE_PRESETS.map((preset) => preset.label), [
      'Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Custom Range',
    ])
    const now = new Date('2026-10-07T06:00:00.000Z')
    assert.deepEqual(getBetRangeForPreset('today', now), { from: '2026-10-07', to: '2026-10-07' })
    assert.deepEqual(getBetRangeForPreset('yesterday', now), { from: '2026-10-06', to: '2026-10-06' })
    assert.deepEqual(getBetRangeForPreset('last7days', now), { from: '2026-10-01', to: '2026-10-07' })
    assert.deepEqual(getBetRangeForPreset('last30days', now), { from: '2026-09-08', to: '2026-10-07' })
    assert.deepEqual(getBetRangeForPreset('custom', now), { from: '2026-10-07', to: '2026-10-07' })
    assert.equal(isBetDatePreset('last7days'), true)
    assert.equal(isBetDatePreset('thisMonth'), false)
  })

  test('uses the IST calendar day on both sides of IST midnight and across month and year ends', () => {
    // 18:29 UTC is 23:59 IST; 18:30 UTC is already the next IST day.
    assert.deepEqual(getBetRangeForPreset('today', new Date('2026-10-06T18:29:00.000Z')).from, '2026-10-06')
    assert.deepEqual(getBetRangeForPreset('today', new Date('2026-10-06T18:30:00.000Z')).from, '2026-10-07')
    assert.deepEqual(getBetRangeForPreset('yesterday', new Date('2026-03-01T00:00:00.000Z')), {
      from: '2026-02-28',
      to: '2026-02-28',
    })
    assert.deepEqual(getBetRangeForPreset('last7days', new Date('2027-01-03T10:00:00.000Z')), {
      from: '2026-12-28',
      to: '2027-01-03',
    })
  })
})

describe('betListModel — filter options and counts', () => {
  test('offers each domain its statuses in the legacy order, matched reading Open', () => {
    assert.deepEqual(betStatusOptions('ALL').map((option) => option.label), [
      'Open', 'won', 'lost', 'void', 'cancelled', 'settled',
    ])
    assert.deepEqual(betStatusOptions('SPORTS').map((option) => option.value), [
      'matched', 'cancelled', 'settled', 'won', 'lost', 'void',
    ])
    // Open (matched) reads pending+active on the server, so open casino and matka bets can be listed too.
    assert.deepEqual(betStatusOptions('CASINO').map((option) => option.value), ['matched', 'won', 'lost', 'cancelled', 'void'])
    assert.deepEqual(betStatusOptions('MATKA').map((option) => option.value), ['matched', 'won', 'lost', 'cancelled', 'void'])
    assert.equal(betStatusOptions('CASINO')[0].label, 'Open')
    assert.equal(isBetDomain('MATKA'), true)
    assert.equal(isBetDomain('POKER'), false)
    assert.deepEqual([true, false, true, false], ['ALL', 'SPORTS', 'CASINO', 'MATKA'].map((domain) =>
      showsBetWalletFilter(domain as 'ALL')))
  })

  test('opens on what the URL names: domain, statuses, a range, a search; a plain /bets on Today', () => {
    const at = (query: string) => betListStateFromSearch(new URLSearchParams(query), '2026-11-03')
    assert.deepEqual(at(''), { domain: 'ALL', filters: { status: undefined, search: undefined, dateFrom: '2026-11-03', dateTo: '2026-11-03' }, datePreset: 'today' })
    // The stuck casino rounds alert: open casino bets, of any date.
    assert.deepEqual(at('domain=casino&status=active'), { domain: 'CASINO', filters: { status: ['matched'], search: undefined }, datePreset: 'any' })
    assert.deepEqual(at('status=pending,open&status=won').filters.status, ['matched', 'won'])
    assert.deepEqual(at('domain=matka&status=settled'), { domain: 'MATKA', filters: { status: undefined, search: undefined, dateFrom: '2026-11-03', dateTo: '2026-11-03' }, datePreset: 'today' })
    assert.deepEqual(at('domain=SPORTS&status=settled&dateFrom=2026-10-01&dateTo=2026-10-07'), {
      domain: 'SPORTS', filters: { status: ['settled'], search: undefined, dateFrom: '2026-10-01', dateTo: '2026-10-07' }, datePreset: 'custom',
    })
    assert.deepEqual(at('dateFrom=2026-10-01').filters, { status: undefined, search: undefined, dateFrom: '2026-10-01', dateTo: '2026-11-03' })
    assert.deepEqual(at('search=BET-77'), { domain: 'ALL', filters: { status: undefined, search: 'BET-77' }, datePreset: 'any' })
    assert.equal(at('domain=poker').domain, 'ALL')
    assert.equal(countActiveBetFilters({ status: ['matched'] }, 'any'), 2)
  })

  test('counts every chosen status and each set filter; the date only when not Today', () => {
    assert.equal(countActiveBetFilters({ dateFrom: 'a', dateTo: 'b' }, 'today'), 0)
    assert.equal(countActiveBetFilters({ status: ['won', 'lost'] }, 'today'), 2)
    assert.equal(countActiveBetFilters({}, 'custom'), 1)
    assert.equal(
      countActiveBetFilters(
        { status: ['won'], agentUsername: 'a', playerSearch: 'p', search: 's', walletType: 'cash' },
        'last7days',
      ),
      6,
    )
    // A picked player is the Player filter too.
    assert.equal(countActiveBetFilters({ userId: '234' }, 'today'), 1)
  })

  test('chooses the agent filter by session: sub-agents for any agent with an id, search for admins', () => {
    assert.equal(betAgentFilterMode(true, '42'), 'subAgents')
    assert.equal(betAgentFilterMode(true, undefined), 'none')
    assert.equal(betAgentFilterMode(false, undefined), 'search')
    assert.equal(betAgentFilterMode(false, '42'), 'search')

    const rows = [{ id: '1', username: 'ravi' }, { id: '2', username: 'sona' }]
    assert.deepEqual(betAgentOptions('subAgents', rows), [
      ALL_MY_PLAYERS_OPTION,
      { label: 'ravi', value: 'ravi' },
      { label: 'sona', value: 'sona' },
    ])
    assert.deepEqual(betAgentOptions('search', rows).map((option) => option.value), ['ravi', 'sona'])
    assert.equal(ALL_MY_PLAYERS_OPTION.value, '')
  })

  test('labels players by username, then name, then id, with the phone in brackets; the value is the id', () => {
    assert.deepEqual(
      betPlayerOptions([
        { id: 1, username: 'rk_sharma88', name: 'Rahul', phone: '9876543210' },
        { id: 2, username: null, name: 'Meena ', phone: null },
        { id: 3, username: '', name: '', phone: '9000000000' },
        { id: 4, username: '  ', name: null },
      ]),
      [
        { label: 'rk_sharma88 (9876543210)', value: '1' },
        { label: 'Meena ', value: '2' },
        { label: 'User 3 (9000000000)', value: '3' },
        { label: '  ', value: '4' },
      ],
    )
    // Two players sharing a username stay two options, each picking its own player.
    assert.deepEqual(
      betPlayerOptions([{ id: 45, username: 'rahul' }, { id: 49, username: 'rahul' }]).map((option) => option.value),
      ['45', '49'],
    )
  })

  test('keeps the legacy list messages for loading, short and empty searches', () => {
    assert.equal(betAgentEmptyText('subAgents', true, ''), 'Loading...')
    assert.equal(betAgentEmptyText('subAgents', false, ''), 'No sub-agents')
    assert.equal(betAgentEmptyText('search', true, 'r'), 'Loading...')
    assert.equal(betAgentEmptyText('search', false, ' r '), 'Type 2+ chars')
    assert.equal(betAgentEmptyText('search', false, 'ra'), 'No agents')
    assert.equal(betPlayerEmptyText(true, ''), 'Loading...')
    assert.equal(betPlayerEmptyText(false, 'a'), 'Type 2+ chars')
    assert.equal(betPlayerEmptyText(false, 'ab'), 'No players')
  })

  test('restarts the player search from the inserted characters after a pick; a deletion empties it', () => {
    const label = 'rk_sharma88 (9876543210)'
    assert.equal(betPlayerTextAfterPick(label, `${label}x`), 'x')
    assert.equal(betPlayerTextAfterPick(label, `${label}ab`), 'ab')
    assert.equal(betPlayerTextAfterPick(label, 'me'), 'me')
    assert.equal(betPlayerTextAfterPick(label, 'rk_shxarma88 (9876543210)'), 'x')
    // A repeated character inserted beside its twin is still the one character typed.
    assert.equal(betPlayerTextAfterPick(label, 'rk_sharma888 (9876543210)'), '8')
    assert.equal(betPlayerTextAfterPick(label, label.slice(0, -1)), '')
    assert.equal(betPlayerTextAfterPick(label, 'rk_sharma88 9876543210)'), '')
    assert.equal(betPlayerTextAfterPick(label, ''), '')
  })

  test('ends the player list as antd did: Enter or Tab picks the first player, other closes drop the text', () => {
    const typed = { listOpen: true, optionActive: false, hasOptions: true, showingPick: false }
    assert.equal(betSearchKeyAction('Enter', false, typed), 'pickFirst')
    assert.equal(betSearchKeyAction('Tab', false, typed), 'pickFirst')
    // An active option is the kit's to choose; a shown pick re-picks nothing; no players, nothing to pick.
    assert.equal(betSearchKeyAction('Enter', false, { ...typed, optionActive: true }), 'none')
    assert.equal(betSearchKeyAction('Tab', false, { ...typed, optionActive: true }), 'none')
    assert.equal(betSearchKeyAction('Enter', false, { ...typed, showingPick: true }), 'drop')
    assert.equal(betSearchKeyAction('Enter', false, { ...typed, hasOptions: false }), 'drop')
    assert.equal(betSearchKeyAction('Tab', false, { ...typed, hasOptions: false }), 'none')
    assert.equal(betSearchKeyAction('Escape', false, { ...typed, optionActive: true }), 'drop')
    assert.equal(betSearchKeyAction('ArrowUp', true, typed), 'drop')
    assert.equal(betSearchKeyAction('ArrowUp', false, typed), 'none')
    assert.equal(betSearchKeyAction('a', false, typed), 'none')
    assert.equal(betSearchKeyAction('Escape', false, { ...typed, listOpen: false }), 'none')
    assert.equal(betSearchKeyAction('Enter', false, { ...typed, listOpen: false }), 'none')
  })

  test('takes the headline count and stake from the domain in force', () => {
    const totals = {
      totalAll: 10, totalSports: 4, totalCasino: 3, totalMatka: 3,
      totalStake: 1000, totalStakeSports: 400, totalStakeCasino: 350, totalStakeMatka: 250,
    }
    assert.deepEqual(betHeadline(totals, 'ALL'), { count: 10, stake: 1000 })
    assert.deepEqual(betHeadline(totals, 'SPORTS'), { count: 4, stake: 400 })
    assert.deepEqual(betHeadline(totals, 'CASINO'), { count: 3, stake: 350 })
    assert.deepEqual(betHeadline(totals, 'MATKA'), { count: 3, stake: 250 })
    assert.deepEqual(betHeadline(undefined, 'ALL'), { count: 0, stake: 0 })
    assert.deepEqual(betHeadline({ totalSports: null }, 'SPORTS'), { count: 0, stake: 0 })
    assert.deepEqual(betHeadlineLabels('ALL'), { count: 'Total Bets', stake: 'Total Stake' })
    assert.deepEqual(betHeadlineLabels('CASINO'), { count: 'Bets in list', stake: 'Stake in list' })
  })
})

describe('betListModel — table rules', () => {
  test('picks the column set from the rows on the page', () => {
    assert.equal(betColumnSet([]), 'ALL')
    assert.equal(betColumnSet([sports(), sports({ id: 's2' })]), 'SPORTS')
    assert.equal(betColumnSet([casino()]), 'CASINO')
    assert.equal(betColumnSet([matka()]), 'MATKA')
    assert.equal(betColumnSet([sports(), casino()]), 'ALL')
    assert.equal(betColumnSet([{ __typename: 'PokerBet' }]), 'ALL')
    assert.equal(betRowKey(casino({ id: '9' })), 'CasinoBet-9')
  })

  test('labels domains, statuses, wallets and sides as the legacy badges did', () => {
    assert.deepEqual(['SportsBet', 'CasinoBet', 'MatkaBet', 'Other'].map(betDomainLabel), [
      'Sports', 'Casino', 'Matka', 'Matka',
    ])
    assert.deepEqual(['matched', 'MATCHED', 'won', 'LOST', 'settled'].map(betStatusLabel), [
      'Open', 'Open', 'Won', 'Lost', 'Settled',
    ])
    assert.deepEqual(['won', 'lost', 'void', 'Cancelled', 'matched', 'settled', 'pending'].map(betStatusTone), [
      'ok', 'neg', 'muted', 'muted', 'info', 'info', 'info',
    ])
    assert.deepEqual([null, 'bonus', 'BONUS', 'referralBonus', 'referral_bonus', 'cash', 'other'].map(betWalletLabel), [
      'Cash', 'Bonus', 'Bonus', 'Referral', 'Referral', 'Cash', 'Cash',
    ])
    assert.equal(isBonusWalletLabel('Referral'), true)
    assert.equal(isBonusWalletLabel('Cash'), false)
    assert.equal(isBackSide('BACK'), true)
    assert.equal(isBackSide('lay'), false)
  })

  test('lists campaign details in the legacy order, leaving out empty and unformattable values', () => {
    const lines = campaignDetailLines(
      {
        id: 'cmp1',
        name: 'Weekend Boost',
        type: 'deposit',
        distributionType: 'roll_over',
        domain: 'sports',
        status: 'active',
        wageringReq: 0,
        amount: 500,
        percentage: null,
        amountType: 'fixed',
        validFrom: '2026-10-01T00:00:00.000Z',
        validTo: 'bad',
        startDate: null,
        endDate: '2026-10-31T00:00:00.000Z',
      },
      (value) => {
        if (value === 'bad') throw new Error('Invalid time value')
        return `day:${value.slice(0, 10)}`
      },
    )
    assert.deepEqual(lines, [
      { label: 'Name', value: 'Weekend Boost' },
      { label: 'Type', value: 'deposit' },
      { label: 'Payout type', value: 'Roll Over' },
      { label: 'Domain', value: 'sports' },
      { label: 'Status', value: 'active' },
      { label: 'Wagering', value: '0x' },
      { label: 'Amount', value: '500' },
      { label: 'Amount type', value: 'fixed' },
      { label: 'Valid from', value: 'day:2026-10-01' },
      { label: 'End date', value: 'day:2026-10-31' },
    ])
    assert.deepEqual(campaignDetailLines({ id: 'x', name: '' }, () => ''), [])
    assert.equal(formatDistributionType('instant_otp'), 'Instant OTP')
    assert.equal(formatDistributionType('cash_back_daily'), 'cash back daily')
    assert.equal(formatDistributionType(null), '')
  })

  test('lists only the device and round identifiers a bet carries, and when a round can open', () => {
    assert.deepEqual(sportsDetailLines(sports({ ipAddress: '10.0.0.1', country: 'IN', deviceInfo: 'Android' })), [
      { label: 'IP', value: '10.0.0.1' },
      { label: 'Country', value: 'IN' },
      { label: 'Device', value: 'Android' },
    ])
    assert.deepEqual(sportsDetailLines(sports()), [])
    assert.deepEqual(casinoDetailLines(casino({ sessionId: 'S1', transactionId: 'T1' })), [
      { label: 'Session', value: 'S1' },
      { label: 'Txn', value: 'T1' },
    ])
    const settled = casino({ gameRoundId: 'R9', settledAt: '2026-10-07T05:10:00.000Z', providerCode: 'GMAG' })
    assert.equal(canOpenRoundDetail(settled), true)
    assert.equal(canOpenRoundDetail(casino({ gameRoundId: 'R9', providerCode: 'GMAG' })), false)
    assert.deepEqual(roundDetailVariables(settled), {
      roundId: 'R9',
      endTime: '2026-10-07T05:10:00.000Z',
      providerCode: 'GMAG',
    })
    assert.equal(roundDetailErrorMessage([{ message: 'Denied' }, {}, { message: 'twice' }]), 'Denied twice')
    assert.equal(roundDetailErrorMessage([{}]), 'Request failed')
  })

  test('writes odds, multipliers and the sports path as the legacy cells did', () => {
    assert.equal(sportsOddsLabel(sports({ price: 1.857 }), true), '1.86')
    assert.equal(sportsOddsLabel(sports({ price: 1.9, oddsSize: 120.4 }), true), '120 / 1.90')
    assert.equal(sportsOddsLabel(sports({ price: 1.9, oddsSize: 120.4 }), false), '120/1.90')
    assert.equal(sportsOddsLabel(sports({ price: null }), true), null)
    assert.equal(matkaMultiplierLabel(matka({ payoutMultiplier: 9 })), '9.0x')
    assert.equal(matkaMultiplierLabel(matka()), null)
    assert.equal(sportsEventPath(sports({ sportName: 'Cricket', eventName: 'Ind v Aus' })), 'Cricket › Ind v Aus')
    assert.equal(sportsEventPath(sports()), '')
  })

  test('takes stake, liability and P/L from each domain’s own fields', () => {
    assert.equal(betStake(sports({ stake: 25 })), 25)
    assert.equal(betStake(matka({ betAmount: 40 })), 40)
    assert.equal(betLiability(sports({ liability: 21 })), 21)
    assert.equal(betLiability(casino({ payout: 17 })), 17)
    assert.equal(betLiability(matka({ potentialWin: 900 })), 900)

    assert.equal(betPL(sports({ pl: -25 })), -25)
    assert.equal(betPL(sports()), null)
    assert.equal(betPL(casino({ netAmount: 120 })), 120)
    assert.equal(matkaPL(matka({ status: 'VOID', actualWin: 999 })), 0)
    assert.equal(matkaPL(matka({ status: 'cancelled' })), 0)
    assert.equal(matkaPL(matka({ status: 'won', actualWin: 900, betAmount: 100 })), 800)
    assert.equal(matkaPL(matka({ status: 'lost', actualWin: 0, betAmount: 100 })), -100)
    assert.equal(matkaPL(matka({ status: 'pending' })), null)
  })

  test('signs and tones gains and losses, and words settled outcomes', () => {
    const fmt = (value: number, currency?: string) => `${currency} ${value.toFixed(2)}`
    assert.equal(formatPL(120, 'INR', fmt), '+INR 120.00')
    assert.equal(formatPL(-5, 'INR', fmt), 'INR -5.00')
    assert.equal(formatPL(0, 'INR', fmt), 'INR 0.00')
    assert.deepEqual([5, -5, 0].map(plTone), ['pos', 'neg', 'zero'])
    assert.deepEqual(['won', 'LOST', 'void', 'cancelled', 'matched'].map((status) => betOutcome(status)), [
      'Won', 'Lost', 'Void', 'Cancelled', null,
    ])
    assert.equal(betOutcome('void', false), null)
    assert.deepEqual((['Won', 'Lost', 'Void', 'Cancelled'] as const).map(outcomeTone), ['pos', 'neg', 'dim', 'dim'])
  })
})
