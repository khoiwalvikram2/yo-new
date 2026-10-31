import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  HIGH_EXPOSURE_THRESHOLD,
  LOCKING_SOON_MS,
  PAGE_SUB,
  QUICK_FILTERS,
  WORLI_SORT_OPTIONS,
  WORLI_STATUS_OPTIONS,
  activeFilterCount,
  applyQuickFilter,
  clampPage,
  exposureHealth,
  groupMarketRows,
  isQuickFilter,
  isWorliStatus,
  loadErrorText,
  marketRowFigures,
  marketStats,
  matchesQuickFilter,
  pageRows,
  sessionCardFigures,
  sessionTone,
  toggleQuickFilter,
  volumeLabel,
  type WorliInstance,
} from './runningMarketsModel'

const NOW = Date.parse('2026-10-07T06:00:00.000Z')

function session(patch: Partial<WorliInstance> & { id: string }): WorliInstance {
  return {
    marketId: 'm1',
    marketName: 'Kalyan Worli',
    runDate: '2026-10-07',
    side: 'OPEN',
    status: 'OPEN',
    scheduledOpenAt: '2026-10-07T04:00:00.000Z',
    scheduledLockAt: '2026-10-07T07:00:00.000Z',
    scheduledCloseAt: '2026-10-07T07:30:00.000Z',
    counters: { betCount: 0, totalStakeMinor: 0, exposureTotalMinor: 0 },
    ...patch,
  }
}

describe('quick filters', () => {
  test('Live is status OPEN and Paused is status PAUSED', () => {
    assert.equal(matchesQuickFilter(session({ id: 'a', status: 'OPEN' }), 'live', NOW), true)
    assert.equal(matchesQuickFilter(session({ id: 'a', status: 'LOCKED' }), 'live', NOW), false)
    assert.equal(matchesQuickFilter(session({ id: 'a', status: 'PAUSED' }), 'paused', NOW), true)
    assert.equal(matchesQuickFilter(session({ id: 'a', status: 'OPEN' }), 'paused', NOW), false)
  })

  test('Locking Soon is a lock strictly inside the next ten minutes', () => {
    const at = (ms: number) => new Date(NOW + ms).toISOString()
    assert.equal(LOCKING_SOON_MS, 600000)
    assert.equal(matchesQuickFilter(session({ id: 'a', scheduledLockAt: at(60_000) }), 'locking-soon', NOW), true)
    assert.equal(matchesQuickFilter(session({ id: 'a', scheduledLockAt: at(599_999) }), 'locking-soon', NOW), true)
    assert.equal(matchesQuickFilter(session({ id: 'a', scheduledLockAt: at(600_000) }), 'locking-soon', NOW), false)
    assert.equal(matchesQuickFilter(session({ id: 'a', scheduledLockAt: at(0) }), 'locking-soon', NOW), false)
    assert.equal(matchesQuickFilter(session({ id: 'a', scheduledLockAt: at(-1000) }), 'locking-soon', NOW), false)
    assert.equal(matchesQuickFilter(session({ id: 'a', scheduledLockAt: null }), 'locking-soon', NOW), false)
  })

  test('High Exposure is at least 10,000 in major units, counters read as numbers', () => {
    assert.equal(HIGH_EXPOSURE_THRESHOLD, 10000)
    const at = (minor: number | string | null) =>
      matchesQuickFilter(session({ id: 'a', counters: { exposureTotalMinor: minor } }), 'high-exposure', NOW)
    assert.equal(at(1_000_000), true)
    assert.equal(at('1000000'), true)
    assert.equal(at(999_999), false)
    assert.equal(at(null), false)
    assert.equal(matchesQuickFilter(session({ id: 'a', counters: null }), 'high-exposure', NOW), false)
  })

  test('no quick filter keeps every row; the list and order are the legacy tags', () => {
    const rows = [session({ id: 'a', status: 'OPEN' }), session({ id: 'b', status: 'SETTLED' })]
    assert.deepEqual(applyQuickFilter(rows, null, NOW).map((r) => r.id), ['a', 'b'])
    assert.deepEqual(applyQuickFilter(rows, 'live', NOW).map((r) => r.id), ['a'])
    assert.deepEqual(QUICK_FILTERS.map((f) => f.label), ['Live', 'High Exposure', 'Locking Soon', 'Paused'])
  })

  test('picking the active quick filter turns it off; another one replaces it', () => {
    assert.equal(toggleQuickFilter(null, 'live'), 'live')
    assert.equal(toggleQuickFilter('live', 'live'), null)
    assert.equal(toggleQuickFilter('live', 'paused'), 'paused')
    assert.equal(isQuickFilter('locking-soon'), true)
    assert.equal(isQuickFilter(''), false)
  })
})

describe('stats and the filter count', () => {
  test('stats count OPEN sessions, sum minor exposure and bets, and count sessions', () => {
    const stats = marketStats([
      session({ id: 'a', status: 'OPEN', counters: { betCount: 3, exposureTotalMinor: 12345 } }),
      session({ id: 'b', status: 'LOCKED', counters: { betCount: '7', exposureTotalMinor: '55' } }),
      session({ id: 'c', status: 'OPEN', counters: null }),
    ])
    assert.deepEqual(stats, { openInstances: 2, totalExposure: 12400, totalBets: 10, totalInstances: 3 })
    assert.deepEqual(marketStats([]), { openInstances: 0, totalExposure: 0, totalBets: 0, totalInstances: 0 })
  })

  test('the count is search, a status choice, Has result on and a quick filter', () => {
    assert.equal(activeFilterCount({ search: '', status: [], hasResult: undefined, quickFilter: null }), 0)
    assert.equal(activeFilterCount({ search: 'kal', status: ['OPEN'], hasResult: true, quickFilter: 'live' }), 4)
    // Has result switched back off is false and does not count.
    assert.equal(activeFilterCount({ search: '', status: [], hasResult: false, quickFilter: null }), 0)
    assert.equal(activeFilterCount({ search: '', status: null, hasResult: undefined, quickFilter: 'paused' }), 1)
  })

  test('status and sort options are the legacy lists, labels included', () => {
    assert.deepEqual(WORLI_STATUS_OPTIONS.map((o) => o.value), [
      'SCHEDULED', 'OPENING_SOON', 'OPEN', 'LOCKED', 'CLOSED', 'SETTLING', 'SETTLED', 'PAUSED', 'VOIDED',
    ])
    assert.deepEqual(WORLI_STATUS_OPTIONS.map((o) => o.label), WORLI_STATUS_OPTIONS.map((o) => o.value))
    assert.deepEqual(WORLI_SORT_OPTIONS.map((o) => [o.value, o.label]), [
      ['closeAt:asc', 'Close ↑'],
      ['closeAt:desc', 'Close ↓'],
      ['name:asc', 'Name A→Z'],
      ['name:desc', 'Name Z→A'],
      ['bets:desc', 'Bets ↓'],
      ['exposure:desc', 'Exposure ↓'],
    ])
    assert.equal(isWorliStatus('PAUSED'), true)
    assert.equal(isWorliStatus('paused'), false)
    assert.equal(PAGE_SUB, 'Monitor and manage today’s Worli sessions (Open/Close)')
  })
})

describe('grouping and row figures', () => {
  test('sessions merge by market and day, OPEN and CLOSE side by side, in first-seen order', () => {
    const rows = groupMarketRows([
      session({ id: 'o1', marketId: 'm1', side: 'OPEN' }),
      session({ id: 'o2', marketId: 'm2', marketName: 'Milan Worli', side: 'open' }),
      session({ id: 'c1', marketId: 'm1', side: 'CLOSE' }),
      session({ id: 'c3', marketId: 'm1', runDate: '2026-10-06', side: 'CLOSE' }),
      session({ id: 'x', marketId: 'm4', side: 'OTHER' }),
    ])
    assert.deepEqual(rows.map((r) => [r.key, r.open?.id ?? null, r.close?.id ?? null]), [
      ['m1::2026-10-07', 'o1', 'c1'],
      ['m2::2026-10-07', 'o2', null],
      ['m1::2026-10-06', null, 'c3'],
      ['m4::2026-10-07', null, null],
    ])
    assert.equal(rows[1].marketName, 'Milan Worli')
  })

  test('figures add both sides in major units; statuses fall back to N/A; the view id prefers OPEN', () => {
    const [row] = groupMarketRows([
      session({ id: 'o1', side: 'OPEN', status: 'PAUSED', counters: { betCount: 2, totalStakeMinor: 15050, exposureTotalMinor: 100 } }),
      session({ id: 'c1', side: 'CLOSE', status: 'OPEN', counters: { betCount: '3', totalStakeMinor: '50', exposureTotalMinor: 250 } }),
    ])
    assert.deepEqual(marketRowFigures(row), {
      openBets: 2,
      closeBets: 3,
      openStake: 150.5,
      closeStake: 0.5,
      openExposure: 1,
      closeExposure: 2.5,
      totalStake: 151,
      totalExposure: 3.5,
      totalBets: 5,
      openStatus: 'PAUSED',
      closeStatus: 'OPEN',
      isLive: true,
      isPaused: true,
      viewId: 'o1',
    })
    const [closeOnly] = groupMarketRows([session({ id: 'c9', side: 'CLOSE', status: '' })])
    const figures = marketRowFigures(closeOnly)
    assert.equal(figures.openStatus, 'N/A')
    assert.equal(figures.closeStatus, 'N/A')
    assert.equal(figures.viewId, 'c9')
    assert.equal(figures.isLive, false)
    const [neither] = groupMarketRows([session({ id: 'z', side: null })])
    assert.equal(marketRowFigures(neither).viewId, undefined)
  })

  test('exposure health bands, volume label and session tones are the legacy thresholds', () => {
    assert.deepEqual(exposureHealth(100000.01), { text: 'High Risk', percent: 100, tone: 'neg' })
    assert.deepEqual(exposureHealth(100000), { text: 'Medium', percent: 60, tone: 'warn' })
    assert.deepEqual(exposureHealth(50000.01), { text: 'Medium', percent: 60, tone: 'warn' })
    assert.deepEqual(exposureHealth(50000), { text: 'Low', percent: 30, tone: 'acc' })
    assert.deepEqual(exposureHealth(0), { text: 'Low', percent: 30, tone: 'acc' })
    assert.equal(volumeLabel(50000), 'Normal volume')
    assert.equal(volumeLabel(50000.01), 'High volume')
    assert.deepEqual(
      ['OPEN', 'LOCKED', 'PAUSED', 'SETTLED', 'N/A', null].map((status) => sessionTone(status)),
      ['ok', 'warn', 'neg', 'neutral', 'neutral', 'neutral'],
    )
  })
})

describe('paging, cards and copy', () => {
  test('a page past the end clamps to the last page; slices are page-sized', () => {
    assert.equal(clampPage(5, 30, 25), 2)
    assert.equal(clampPage(1, 0, 25), 1)
    assert.equal(clampPage(0, 30, 10), 1)
    assert.deepEqual(pageRows([1, 2, 3, 4, 5], 2, 2), [3, 4])
    assert.deepEqual(pageRows([1, 2, 3, 4, 5], 3, 2), [5])
  })

  test('a card names the market (or its id), counts bets and converts minor exposure', () => {
    assert.deepEqual(
      sessionCardFigures(session({ id: 'a', counters: { betCount: '4', exposureTotalMinor: 123456 } })),
      { name: 'Kalyan Worli', bets: 4, exposure: 1234.56 },
    )
    assert.deepEqual(sessionCardFigures(session({ id: 'b', marketName: '', counters: null })), {
      name: 'm1',
      bets: 0,
      exposure: 0,
    })
  })

  test('the load error says what failed', () => {
    assert.equal(loadErrorText('Network down'), 'Failed to load Worli markets: Network down')
    assert.equal(loadErrorText(undefined), 'Failed to load Worli markets: Unknown error')
  })
})
