import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import dayjs from 'dayjs'
import {
  addDays,
  DEFAULT_ADMIN_TZ,
  endOfDay,
  endOfMonth,
  startOfDay,
  startOfMonth,
} from '@/shared/utils/date'
import {
  AGENT_OVERVIEW_DEFAULT_PRESET,
  AGENT_OVERVIEW_DOMAIN_LABELS,
  AGENT_OVERVIEW_PAGE_SIZE_OPTIONS,
  AGENT_OVERVIEW_PRESETS,
  AGENT_OVERVIEW_TABS,
  PERFORMANCE_PAGE_SIZE,
  TOP_PLAYERS_LIMIT,
  TOP_PLAYERS_PAGE_SIZE,
  TRENDS_PAGE_SIZE,
  agentOverviewCustomPeriod,
  agentOverviewErrorLines,
  agentOverviewExportRange,
  agentOverviewFilter,
  agentOverviewFilterChanged,
  agentOverviewPresetPeriod,
  clampPage,
  formatCount,
  initialAgentOverviewPeriod,
  isAgentOverviewPreset,
  isAgentOverviewTab,
  pageRows,
  shortAgentId,
  topPlayerRows,
  visibleAgentOverviewDomains,
  type AgentOverviewPreset,
} from './agentOverviewReportModel'

type FixedPreset = Exclude<AgentOverviewPreset, 'custom'>

const FIXED_PRESETS: FixedPreset[] = ['today', 'yesterday', 'last7days', 'last30days', 'thisMonth', 'lastMonth']

/* The legacy page's getDateRangeForPreset, verbatim but for the dayjs wrapper: the instants it built. */
function legacyPresetInstants(preset: FixedPreset): [Date, Date] {
  const now = new Date()
  const tz = DEFAULT_ADMIN_TZ
  if (preset === 'today') return [startOfDay(now, tz), endOfDay(now, tz)]
  if (preset === 'yesterday') {
    const yesterdayStart = addDays(startOfDay(now, tz), -1)
    return [yesterdayStart, endOfDay(yesterdayStart, tz)]
  }
  if (preset === 'last7days') return [addDays(startOfDay(now, tz), -7), endOfDay(now, tz)]
  if (preset === 'last30days') return [addDays(startOfDay(now, tz), -30), endOfDay(now, tz)]
  if (preset === 'thisMonth') return [startOfMonth(now, tz), endOfDay(now, tz)]
  const lastMonthStart = addDays(startOfMonth(now, tz), -1)
  return [startOfMonth(lastMonthStart, tz), endOfMonth(lastMonthStart, tz)]
}

const istDay = (instant: Date) => dayjs(instant).tz(DEFAULT_ADMIN_TZ).format('YYYY-MM-DD')

/* The legacy helpers build `new Date(y, m, d)` in the process zone, so a comparison with them holds only
   for a given zone. Node applies a runtime change of process.env.TZ (Vitest runs this file in a forked
   worker), so each zone-bound test pins the zone and then restores the one the process started in
   (restoring by name, because unsetting TZ does not reset the zone on Windows). */
const PROCESS_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

function inProcessZone(zone: string, run: () => void) {
  const previous = process.env.TZ
  process.env.TZ = zone
  try {
    run()
  } finally {
    process.env.TZ = previous ?? PROCESS_ZONE
  }
}

const IST_OFFSET_MINUTES = -330

/* Every preset on 2026-10-07: [dateFrom, dateTo, exportFrom, exportTo]. */
const PRESETS_ON_2026_10_07: Record<FixedPreset, [string, string, string, string]> = {
  today: ['2026-10-07', '2026-10-07', '2026-10-06T18:30:00.000Z', '2026-10-07T18:29:59.999Z'],
  yesterday: ['2026-10-06', '2026-10-06', '2026-10-05T18:30:00.000Z', '2026-10-06T18:29:59.999Z'],
  last7days: ['2026-09-30', '2026-10-07', '2026-09-29T18:30:00.000Z', '2026-10-07T18:29:59.999Z'],
  last30days: ['2026-09-07', '2026-10-07', '2026-09-06T18:30:00.000Z', '2026-10-07T18:29:59.999Z'],
  thisMonth: ['2026-10-01', '2026-10-07', '2026-09-30T18:30:00.000Z', '2026-10-07T18:29:59.999Z'],
  lastMonth: ['2026-09-01', '2026-09-30', '2026-08-31T18:30:00.000Z', '2026-09-30T18:29:59.999Z'],
}

/* Clock instants either side of IST midnight, a leap day and a year end, with the IST day of each. */
const CLOCK_IST_DAYS: Array<[string, string]> = [
  ['2026-10-06T18:29:59.999Z', '2026-10-06'],
  ['2026-10-06T18:30:00.000Z', '2026-10-07'],
  ['2024-02-29T18:30:00.000Z', '2024-03-01'],
  ['2025-12-31T18:29:59.999Z', '2025-12-31'],
  ['2026-01-01T00:00:00.000Z', '2026-01-01'],
]

afterEach(() => {
  vi.useRealTimers()
})

describe('agentOverviewReportModel', () => {
  test('keeps the legacy option lists, labels, page sizes and default', () => {
    assert.deepEqual(AGENT_OVERVIEW_PRESETS.map((preset) => preset.label), [
      'Today',
      'Yesterday',
      'Last 7 Days',
      'Last 30 Days',
      'This Month',
      'Last Month',
      'Custom Range',
    ])
    assert.deepEqual(AGENT_OVERVIEW_PRESETS.map((preset) => preset.value), [
      'today',
      'yesterday',
      'last7days',
      'last30days',
      'thisMonth',
      'lastMonth',
      'custom',
    ])
    assert.equal(AGENT_OVERVIEW_DEFAULT_PRESET, 'last30days')
    assert.deepEqual(AGENT_OVERVIEW_TABS.map((tab) => [tab.value, tab.label]), [
      ['ggr', 'GGR by Domain'],
      ['activity', 'Player Activity'],
      ['top-players', 'Top Players'],
      ['top-events', 'Top Events/Games'],
    ])
    assert.deepEqual(AGENT_OVERVIEW_DOMAIN_LABELS, {
      all: 'All Domains',
      sports: 'Sports',
      casino: 'Casino',
      matka: 'Matka',
    })
    assert.deepEqual([...AGENT_OVERVIEW_PAGE_SIZE_OPTIONS], [10, 20, 50, 100])
    assert.deepEqual([PERFORMANCE_PAGE_SIZE, TRENDS_PAGE_SIZE, TOP_PLAYERS_PAGE_SIZE], [10, 10, 20])
    assert.equal(TOP_PLAYERS_LIMIT, 50)
    assert.equal(isAgentOverviewPreset('lastMonth'), true)
    assert.equal(isAgentOverviewPreset('allTime'), false)
    assert.equal(isAgentOverviewTab('top-events'), true)
    assert.equal(isAgentOverviewTab('events'), false)
  })

  test('opens on the IST days of now-30d and now, and exports those two moments', () => {
    const now = new Date('2026-10-07T06:00:00.000Z')
    assert.deepEqual(initialAgentOverviewPeriod(now), {
      preset: 'last30days',
      dateFrom: '2026-09-07',
      dateTo: '2026-10-07',
      exportFrom: '2026-09-07T06:00:00.000Z',
      exportTo: '2026-10-07T06:00:00.000Z',
    })

    // both sides of IST midnight
    const before = initialAgentOverviewPeriod(new Date('2026-10-06T18:29:59.999Z'))
    assert.equal(before.dateFrom, '2026-09-06')
    assert.equal(before.dateTo, '2026-10-06')
    const after = initialAgentOverviewPeriod(new Date('2026-10-06T18:30:00.000Z'))
    assert.equal(after.dateFrom, '2026-09-07')
    assert.equal(after.dateTo, '2026-10-07')
  })

  test('the opening days match the legacy nowIST().subtract(30, "day") formatting (IST process zone)', () => {
    inProcessZone(DEFAULT_ADMIN_TZ, () => {
      for (const instant of ['2026-10-07T06:00:00.000Z', '2026-10-06T18:29:59.999Z', '2026-03-01T18:30:00.000Z']) {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(instant))
        assert.equal(new Date().getTimezoneOffset(), IST_OFFSET_MINUTES, 'the process zone is pinned to IST')
        const legacyFrom = dayjs.tz(undefined, DEFAULT_ADMIN_TZ).subtract(30, 'day')
        const legacyTo = dayjs.tz(undefined, DEFAULT_ADMIN_TZ)
        const period = initialAgentOverviewPeriod()
        assert.equal(period.dateFrom, legacyFrom.format('YYYY-MM-DD'), instant)
        assert.equal(period.dateTo, legacyTo.format('YYYY-MM-DD'), instant)
        assert.equal(period.exportFrom, legacyFrom.toISOString(), instant)
        assert.equal(period.exportTo, legacyTo.toISOString(), instant)
        vi.useRealTimers()
      }
    })
  })

  test('resolves every preset to its IST days and day-boundary instants', () => {
    const today = '2026-10-07'
    for (const preset of FIXED_PRESETS) {
      const period = agentOverviewPresetPeriod(preset, today)
      assert.deepEqual(
        [period.dateFrom, period.dateTo, period.exportFrom, period.exportTo],
        PRESETS_ON_2026_10_07[preset],
        preset,
      )
      assert.equal(period.preset, preset)
    }

    // a leap day and a year end
    assert.equal(agentOverviewPresetPeriod('yesterday', '2024-03-01').dateFrom, '2024-02-29')
    assert.deepEqual(
      [agentOverviewPresetPeriod('lastMonth', '2024-03-01').dateFrom, agentOverviewPresetPeriod('lastMonth', '2024-03-01').dateTo],
      ['2024-02-01', '2024-02-29'],
    )
    assert.deepEqual(
      [agentOverviewPresetPeriod('lastMonth', '2026-01-01').dateFrom, agentOverviewPresetPeriod('lastMonth', '2026-01-01').dateTo],
      ['2025-12-01', '2025-12-31'],
    )
    assert.equal(agentOverviewPresetPeriod('last30days', '2026-01-01').dateFrom, '2025-12-02')
    assert.throws(() => agentOverviewPresetPeriod('today', '07-10-2026'))
  })

  test('in an IST process zone the preset instants equal the legacy getDateRangeForPreset ones', () => {
    inProcessZone(DEFAULT_ADMIN_TZ, () => {
      for (const [instant] of CLOCK_IST_DAYS) {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(instant))
        assert.equal(new Date().getTimezoneOffset(), IST_OFFSET_MINUTES, 'the process zone is pinned to IST')
        for (const preset of FIXED_PRESETS) {
          const [from, to] = legacyPresetInstants(preset)
          const period = agentOverviewPresetPeriod(preset)
          assert.equal(period.exportFrom, from.toISOString(), `${instant} ${preset} from`)
          assert.equal(period.exportTo, to.toISOString(), `${instant} ${preset} to`)
          assert.equal(period.dateFrom, istDay(from), `${instant} ${preset} dateFrom`)
          assert.equal(period.dateTo, istDay(to), `${instant} ${preset} dateTo`)
        }
        vi.useRealTimers()
      }
    })
  })

  test('resolves the clock to IST days and IST day boundaries in any process zone', () => {
    for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo', DEFAULT_ADMIN_TZ]) {
      inProcessZone(zone, () => {
        const offset = new Date('2026-10-07T06:00:00.000Z').getTimezoneOffset()
        assert.equal(offset === IST_OFFSET_MINUTES, zone === DEFAULT_ADMIN_TZ, `${zone} is pinned`)

        for (const preset of FIXED_PRESETS) {
          const period = agentOverviewPresetPeriod(preset, '2026-10-07')
          assert.deepEqual(
            [period.dateFrom, period.dateTo, period.exportFrom, period.exportTo],
            PRESETS_ON_2026_10_07[preset],
            `${zone} ${preset}`,
          )
        }
        assert.deepEqual(agentOverviewCustomPeriod('2026-01-02', '2026-01-04'), {
          preset: 'custom',
          dateFrom: '2026-01-02',
          dateTo: '2026-01-04',
          exportFrom: '2026-01-01T18:30:00.000Z',
          exportTo: '2026-01-04T18:29:59.999Z',
        }, zone)
        assert.deepEqual(initialAgentOverviewPeriod(new Date('2026-10-06T18:30:00.000Z')), {
          preset: 'last30days',
          dateFrom: '2026-09-07',
          dateTo: '2026-10-07',
          exportFrom: '2026-09-06T18:30:00.000Z',
          exportTo: '2026-10-06T18:30:00.000Z',
        }, zone)

        for (const [instant, istToday] of CLOCK_IST_DAYS) {
          vi.useFakeTimers({ toFake: ['Date'] })
          vi.setSystemTime(new Date(instant))
          assert.equal(agentOverviewPresetPeriod('today').dateFrom, istToday, `${zone} ${instant}`)
          for (const preset of FIXED_PRESETS) {
            assert.deepEqual(
              agentOverviewPresetPeriod(preset),
              agentOverviewPresetPeriod(preset, istToday),
              `${zone} ${instant} ${preset}`,
            )
          }
          vi.useRealTimers()
        }
      })
    }
  })

  test('outside IST the legacy preset instants were the browser’s own midnights of the IST days', () => {
    // the named behaviour change 3 in the record, at 00:00 IST on 2026-10-07 in a UTC browser
    inProcessZone('UTC', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-06T18:30:00.000Z'))
      const [from, to] = legacyPresetInstants('today')
      assert.deepEqual([from.toISOString(), to.toISOString()], ['2026-10-07T00:00:00.000Z', '2026-10-07T23:59:59.999Z'])
      // the legacy query days, dayjs(instant).format() in the browser zone, were the IST day already
      assert.deepEqual([dayjs(from).format('YYYY-MM-DD'), dayjs(to).format('YYYY-MM-DD')], ['2026-10-07', '2026-10-07'])
      const period = agentOverviewPresetPeriod('today')
      assert.deepEqual(
        [period.dateFrom, period.dateTo, period.exportFrom, period.exportTo],
        ['2026-10-07', '2026-10-07', '2026-10-06T18:30:00.000Z', '2026-10-07T18:29:59.999Z'],
      )
      vi.useRealTimers()
    })
  })

  test('a custom range runs from the first instant of its first day to the last of its last', () => {
    assert.deepEqual(agentOverviewCustomPeriod('2026-01-02', '2026-01-04'), {
      preset: 'custom',
      dateFrom: '2026-01-02',
      dateTo: '2026-01-04',
      exportFrom: '2026-01-01T18:30:00.000Z',
      exportTo: '2026-01-04T18:29:59.999Z',
    })
  })

  test('builds the query filter with the domain only when one is chosen, and the export range', () => {
    const period = agentOverviewPresetPeriod('today', '2026-10-07')
    const all = agentOverviewFilter(period, 'all')
    assert.deepEqual(all, { dateFrom: '2026-10-07', dateTo: '2026-10-07' })
    assert.deepEqual(Object.keys(all), ['dateFrom', 'dateTo'])

    const casino = agentOverviewFilter(period, 'casino')
    assert.deepEqual(casino, { dateFrom: '2026-10-07', dateTo: '2026-10-07', domain: 'casino' })
    assert.deepEqual(Object.keys(casino), ['dateFrom', 'dateTo', 'domain'])

    assert.deepEqual(agentOverviewExportRange(period), {
      from: '2026-10-06T18:30:00.000Z',
      to: '2026-10-07T18:29:59.999Z',
    })
  })

  test('a filter counts as changed only when the query variables differ', () => {
    // the opening period and a same-day Reset send the same days, though their export instants differ
    const opening = agentOverviewFilter(initialAgentOverviewPeriod(new Date('2026-10-07T06:00:00.000Z')), 'all')
    assert.equal(agentOverviewFilterChanged(opening, agentOverviewFilter(agentOverviewPresetPeriod('last30days', '2026-10-07'), 'all')), false)

    const today = agentOverviewFilter(agentOverviewPresetPeriod('today', '2026-10-07'), 'all')
    assert.equal(agentOverviewFilterChanged(today, agentOverviewFilter(agentOverviewCustomPeriod('2026-10-07', '2026-10-07'), 'all')), false)
    assert.equal(agentOverviewFilterChanged(today, agentOverviewFilter(agentOverviewPresetPeriod('today', '2026-10-08'), 'all')), true)
    assert.equal(agentOverviewFilterChanged(today, agentOverviewFilter(agentOverviewCustomPeriod('2026-10-01', '2026-10-07'), 'all')), true)
    assert.equal(agentOverviewFilterChanged(today, agentOverviewFilter(agentOverviewPresetPeriod('today', '2026-10-07'), 'sports')), true)
    const sports = agentOverviewFilter(agentOverviewPresetPeriod('today', '2026-10-07'), 'sports')
    assert.equal(agentOverviewFilterChanged(sports, agentOverviewFilter(agentOverviewPresetPeriod('today', '2026-10-07'), 'sports')), false)
    assert.equal(agentOverviewFilterChanged(sports, agentOverviewFilter(agentOverviewPresetPeriod('today', '2026-10-07'), 'casino')), true)
    assert.equal(agentOverviewFilterChanged(sports, today), true)
  })

  test('offers every domain to admins and only the allowed ones to agents', () => {
    assert.deepEqual(visibleAgentOverviewDomains(false, ['casino']), ['all', 'sports', 'casino', 'matka'])
    assert.deepEqual(visibleAgentOverviewDomains(true, ['casino']), ['all', 'casino'])
    assert.deepEqual(visibleAgentOverviewDomains(true, ['matka', 'sports']), ['all', 'sports', 'matka'])
    assert.deepEqual(visibleAgentOverviewDomains(true, undefined), ['all', 'sports', 'casino', 'matka'])
    assert.deepEqual(visibleAgentOverviewDomains(true, null), ['all', 'sports', 'casino', 'matka'])
    // an empty list is truthy, as it was in `agent?.allowedDomains || [...]`
    assert.deepEqual(visibleAgentOverviewDomains(true, []), ['all'])
  })

  test('lists the failed queries in the legacy order and wording', () => {
    assert.deepEqual(agentOverviewErrorLines({}), [])
    assert.deepEqual(
      agentOverviewErrorLines({
        players: { message: 'p failed' },
        kpis: { message: 'k failed' },
        performance: null,
        trends: { message: 't failed' },
      }),
      ['KPIs: k failed', 'Trends: t failed', 'Players: p failed'],
    )
    assert.deepEqual(agentOverviewErrorLines({ performance: { message: 'x' } }), ['Performance: x'])
  })

  test('formats the agent id caption and counts as the legacy cells did', () => {
    assert.equal(shortAgentId('a1b2c3d4e5f6'), 'a1b2c3d4...')
    assert.equal(shortAgentId('abc'), 'abc...')
    assert.equal(shortAgentId(undefined), '...')
    assert.equal(shortAgentId(null), '...')
    assert.equal(formatCount(1234567), (1234567).toLocaleString())
    assert.equal(formatCount(0), '0')
  })

  test('pages the rows like antd did, holding a page inside the rows it has', () => {
    const rows = Array.from({ length: 25 }, (_, index) => index + 1)
    assert.deepEqual(pageRows(rows, 1, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepEqual(pageRows(rows, 3, 10), [21, 22, 23, 24, 25])
    assert.deepEqual(pageRows(rows, 9, 10), [21, 22, 23, 24, 25])
    assert.deepEqual(pageRows([], 4, 10), [])
    assert.equal(clampPage(9, 25, 10), 3)
    assert.equal(clampPage(0, 25, 10), 1)
    assert.equal(clampPage(2, 0, 10), 1)
    assert.equal(clampPage(2, 25, 0), 2)
  })

  test('keeps the first fifty players in the order they came', () => {
    const rows = Array.from({ length: 55 }, (_, index) => `p${index}`)
    const top = topPlayerRows(rows)
    assert.equal(top.length, 50)
    assert.equal(top[0], 'p0')
    assert.equal(top[49], 'p49')
    assert.equal(topPlayerRows(rows.slice(0, 3)).length, 3)
  })
})
