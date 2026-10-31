import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { SportsResult } from '@/modules/sports/results'
import {
  applyManualResultDateRange,
  applyStatusFilter,
  autoResultsSaveBlocker,
  buildAutoResultsInput,
  buildCreateSportsResultInput,
  buildHierarchySearchOptions,
  buildRollbackInput,
  buildSportsResultsVariables,
  canConfirmRollback,
  canDeclare,
  computeManualResultStats,
  countActiveManualResultFilters,
  declarableMarkets,
  declareErrorMessage,
  declareMarketTypeOptions,
  declareSubmitBlocker,
  declaredMarketIdSet,
  defaultManualResultFilters,
  emptyMarketsHint,
  eventDisableStep,
  fancyResultError,
  findExactSetting,
  isRecentDeclaration,
  marketMatchesType,
  manualResultDatePreset,
  manualResultStatCards,
  namedOptions,
  offToggles,
  openBetsChips,
  resultDisplay,
  resultStatus,
  rollbackDetailLines,
  rollbackErrorMessage,
  rollbackFacts,
  rollbackReasonError,
  scopeDisplay,
  scopeSportCode,
  searchEmptyText,
  searchNoResultsHint,
  searchPlaceholder,
  searchSelectionMessage,
  searchStepHint,
  settingIsCricket,
  statusFilterValue,
  toggleRefused,
  winnerOptions,
  withEvent,
  withLeague,
  withMarketType,
  withSearch,
  withSport,
} from './manualResultsModel'

const sportsResult = (patch: Partial<SportsResult> = {}): SportsResult => ({
  id: 'result-1',
  whitelabelId: 'wl-1',
  sportId: 'sport-1',
  leagueId: 'league-1',
  eventId: 'event-1',
  marketId: 'market-1',
  marketType: 'exchange',
  declaredBy: 'admin-1',
  declaredAt: '2026-01-01T06:30:00.000Z',
  createdAt: '2026-01-01T06:30:00.000Z',
  ...patch,
})

describe('manual results filters', () => {
  it('keeps the legacy defaults and query key order', () => {
    assert.deepEqual(defaultManualResultFilters(), { page: 1, limit: 20, sort: 'createdAt:desc' })
    const variables = buildSportsResultsVariables({
      sportId: 's', leagueId: 'l', eventId: 'e', marketId: 'm', marketType: 'fancy',
      dateFrom: '2026-01-01', dateTo: '2026-01-02', search: '  goal  ', rolledBack: false,
      page: 0, limit: 0, sort: '',
    })
    assert.deepEqual(Object.keys(variables), [
      'sportId', 'leagueId', 'eventId', 'marketId', 'marketType', 'dateFrom', 'dateTo',
      'search', 'rolledBack', 'page', 'limit', 'sort',
    ])
    assert.equal(variables.search, 'goal')
    assert.equal(variables.page, 1)
    assert.equal(variables.limit, 20)
    assert.equal(variables.sort, 'createdAt:desc')
    assert.equal(buildSportsResultsVariables({ search: ' x ' }).search, undefined)
  })

  it('counts each legacy filter once, including a one-character search and false status', () => {
    assert.equal(countActiveManualResultFilters({ search: 'x', sportId: 's', rolledBack: false }), 3)
  })

  it('resets paging and clears descendants', () => {
    const filters = { sportId: 's', leagueId: 'l', eventId: 'e', marketId: 'm', page: 8 }
    assert.deepEqual(withSearch(filters, 'goal'), { ...filters, search: 'goal', page: 1 })
    assert.deepEqual(withSport(filters, 's2'), { ...filters, sportId: 's2', leagueId: undefined, eventId: undefined, marketId: undefined, page: 1 })
    assert.deepEqual(withLeague(filters, 'l2'), { ...filters, leagueId: 'l2', eventId: undefined, marketId: undefined, page: 1 })
    assert.deepEqual(withEvent(filters, 'e2'), { ...filters, eventId: 'e2', marketId: undefined, page: 1 })
    assert.equal(withMarketType(filters, 'fancy').marketType, 'fancy')
    assert.equal(withMarketType(filters, 'unknown').marketType, undefined)
  })

  it('maps and removes the status key', () => {
    assert.equal(statusFilterValue(undefined), '')
    assert.equal(statusFilterValue(false), 'active')
    assert.equal(statusFilterValue(true), 'rolledBack')
    assert.equal(applyStatusFilter({ page: 4 }, 'active').rolledBack, false)
    assert.equal(applyStatusFilter({ rolledBack: true }, '').rolledBack, undefined)
  })

  it('applies or clears a calendar-day range', () => {
    const filters = { page: 4, dateFrom: 'old', dateTo: 'old' }
    const custom = applyManualResultDateRange(filters, { kind: 'custom', from: '2026-02-01', to: '2026-02-04' })
    assert.deepEqual(custom, { page: 1, dateFrom: '2026-02-01', dateTo: '2026-02-04' })
    assert.equal(manualResultDatePreset(custom), 'custom')
    assert.deepEqual(applyManualResultDateRange(custom, { kind: 'preset', preset: 'all' }), {
      page: 1, dateFrom: undefined, dateTo: undefined,
    })
  })

  it('turns only arrays of named entities into options', () => {
    assert.deepEqual(namedOptions([{ id: '1', name: 'Cricket' }]), [{ value: '1', label: 'Cricket' }])
    assert.deepEqual(namedOptions(null), [])
  })
})

describe('manual results rows, stats and rollback', () => {
  it('formats special, fancy and runner results', () => {
    assert.equal(resultDisplay(sportsResult({ selectionName: 'VOID' })), 'VOID')
    assert.equal(resultDisplay(sportsResult({ marketType: 'fancy', selectionName: 'Runs', result: '6' })), 'Runs: 6')
    assert.equal(resultDisplay(sportsResult({ runner: { id: 'r', name: 'India' } })), 'India')
    assert.equal(resultDisplay(sportsResult()), 'N/A')
  })

  it('maps status and the one-hour recent boundary', () => {
    assert.deepEqual(resultStatus(sportsResult()), { label: 'Active', tone: 'ok' })
    assert.deepEqual(resultStatus(sportsResult({ rolledBackAt: '2026-01-01' })), { label: 'Rolled Back', tone: 'neg' })
    const now = Date.parse('2026-01-01T12:00:00Z')
    assert.equal(isRecentDeclaration('2026-01-01T11:00:01Z', now), true)
    assert.equal(isRecentDeclaration('2026-01-01T11:00:00Z', now), false)
    assert.equal(isRecentDeclaration('bad', now), false)
  })

  it('keeps optional rollback details in legacy order', () => {
    assert.deepEqual(
      rollbackDetailLines({ rolledBackByName: 'Ops', rollbackReason: 'Wrong', rollbackTag: 'error' }, 'Jan 1'),
      [
        { key: 'at', label: 'Rolled Back:', value: 'Jan 1' },
        { key: 'by', label: 'By:', value: 'Ops' },
        { key: 'reason', label: 'Reason:', value: 'Wrong' },
        { key: 'tag', label: 'Tag:', value: 'error' },
      ],
    )
  })

  it('computes statistics from the first thousand rows and excludes rolled-back type counts', () => {
    const stats = computeManualResultStats([
      { declaredAt: '2026-01-01T00:00:00Z', marketType: 'exchange' },
      { declaredAt: '2025-12-31T20:00:00Z', marketType: 'bookmaker' },
      { declaredAt: '2026-01-01T03:00:00Z', marketType: 'fancy', rolledBackAt: '2026-01-02' },
    ], '2026-01-01')
    assert.deepEqual(stats, { total: 3, today: 3, exchange: 1, bookmaker: 1, fancy: 0, rolledBack: 1 })
    assert.deepEqual(manualResultStatCards(stats).map((card) => card.note), ['3 today', '33%', '0 fancy', '33%'])
  })

  it('preserves rollback validation, input key order, facts and error fallbacks', () => {
    assert.equal(rollbackReasonError(''), 'Please provide a reason for rollback')
    assert.equal(rollbackReasonError('   '), undefined)
    assert.equal(canConfirmRollback('ROLLBACK'), true)
    assert.equal(canConfirmRollback('rollback'), false)
    assert.deepEqual(Object.keys(buildRollbackInput('r', 'reason', 'fraud')), ['id', 'reason', 'tag'])
    const facts = rollbackFacts(sportsResult({ marketType: 'fancy', selectionName: 'Runs', result: '9' }))
    assert.deepEqual(facts.map((item) => item.term), ['Sport', 'League', 'Event', 'Market', 'Type', 'Result'])
    assert.equal(rollbackErrorMessage(new Error('network down')), 'network down')
    assert.equal(rollbackErrorMessage(null), 'An error occurred while rolling back the result')
  })
})

describe('declare sports result logic', () => {
  const markets = [
    { id: 'ex', name: 'Match Odds', type: 'MATCH_ODDS' },
    { id: 'book', name: 'Bookmaker Main', type: 'BOOK' },
    { id: 'fancy', name: 'Fancy Runs', type: null },
  ]

  it('offers cricket-only types and matches market names and types', () => {
    assert.deepEqual(declareMarketTypeOptions(false).map((item) => item.disabled), [undefined, true, true])
    assert.equal(marketMatchesType(markets[0], 'exchange'), true)
    assert.equal(marketMatchesType(markets[1], 'bookmaker'), true)
    assert.equal(marketMatchesType(markets[2], 'fancy'), true)
  })

  it('removes already declared markets and explains every empty state', () => {
    const declared = declaredMarketIdSet([{ marketId: 'book' }, { marketId: null }])
    assert.deepEqual(declarableMarkets(markets, 'bookmaker', declared), [])
    assert.equal(emptyMarketsHint('bookmaker', 3, 1), 'All bookmaker markets with open bets already have results declared.')
    assert.equal(emptyMarketsHint('exchange', 0, 0), 'No markets with open bets for this event.')
    assert.equal(emptyMarketsHint('fancy', 2, 0), 'No fancy markets with open bets for this event.')
  })

  it('builds busiest-first open-bet chips', () => {
    assert.deepEqual(openBetsChips([
      { marketId: 'ex' }, { marketId: 'book' }, { marketId: 'book' }, null,
    ], markets), [
      { marketId: 'book', marketName: 'Bookmaker Main', openCount: 2 },
      { marketId: 'ex', marketName: 'Match Odds', openCount: 1 },
    ])
  })

  it('builds hierarchy options only from two characters and keeps step copy', () => {
    assert.deepEqual(buildHierarchySearchOptions('c', []), [])
    const options = buildHierarchySearchOptions('cr', [
      { type: 'sport', sportId: 's', sportName: 'Cricket' },
      { type: 'league', sportId: 's', sportName: 'Cricket', leagueId: 'l', leagueName: 'IPL' },
      { type: 'event', sportId: 's', sportName: 'Cricket', leagueId: 'l', leagueName: 'IPL', eventId: 'e', eventName: 'Final' },
    ])
    assert.deepEqual(options.map((option) => option.type), ['sport', 'league', 'event'])
    assert.equal(searchSelectionMessage(options[2]), 'Auto-filled: Final → IPL → Cricket')
    assert.equal(searchStepHint(undefined, undefined), 'Search sports first, then select to load more data')
    assert.equal(searchPlaceholder('s', 'l'), 'Search events (e.g., Indonesia)...')
    assert.equal(searchEmptyText('cr', true), 'Searching...')
    assert.equal(searchNoResultsHint('s', undefined), 'No leagues with open bets. First select a sport from the dropdown below.')
  })

  it('adds the special statuses after runners', () => {
    const options = winnerOptions([{ id: 'r', name: 'India' }])
    assert.deepEqual(options.map((option) => option.value), ['r', 'STATUS:VOID', 'STATUS:CANCELLED', 'STATUS:SUSPENDED'])
    assert.equal(options[1].group, 'Status')
  })

  it('validates fancy values and the submit sequence', () => {
    assert.equal(fancyResultError(undefined, null), 'Please enter result value or select a status')
    assert.equal(fancyResultError(undefined, -1), 'Result value must be a whole number (digits only)')
    assert.equal(fancyResultError('STATUS:VOID', 2), 'Result value cannot be entered when status is selected')
    assert.equal(canDeclare({ sportId: 's', leagueId: 'l', eventId: 'e', marketId: 'm', marketType: 'exchange' }), true)
    assert.equal(declareSubmitBlocker({ sportId: 's', leagueId: 'l', eventId: 'e', marketId: 'm', marketType: 'exchange', result: null }), 'Please select a winner or status')
    assert.equal(declareSubmitBlocker({ sportId: 's', leagueId: 'l', eventId: 'e', marketId: 'm', marketType: 'fancy', fancyStatus: 'STATUS:VOID', result: null }), null)
  })

  it('keeps create mutation input mapping and key order', () => {
    const exchange = buildCreateSportsResultInput({ sportId: 's', leagueId: 'l', eventId: 'e', marketId: 'm', marketType: 'exchange', runnerId: 'r', result: null })
    assert.deepEqual(Object.keys(exchange), ['sportId', 'leagueId', 'eventId', 'marketId', 'marketType', 'runnerId', 'selectionName', 'result'])
    assert.equal(exchange.runnerId, 'r')
    const voided = buildCreateSportsResultInput({ sportId: 's', leagueId: 'l', eventId: 'e', marketId: 'm', marketType: 'bookmaker', runnerId: 'STATUS:VOID', result: null })
    assert.equal(voided.selectionName, 'VOID')
    assert.equal(voided.runnerId, undefined)
    const fancy = buildCreateSportsResultInput({ sportId: 's', leagueId: 'l', eventId: 'e', marketId: 'm', marketType: 'fancy', marketName: 'Runs', result: 6 })
    assert.equal(fancy.selectionName, 'Runs')
    assert.equal(fancy.result, '6')
  })

  it('chooses each event-disable outcome and error priority', () => {
    const base = { disableEvent: true, eventId: 'e', openBetsLoading: false, chips: [{ marketId: 'm', marketName: 'M', openCount: 1 }], marketId: 'm' }
    assert.equal(eventDisableStep({ ...base, disableEvent: false }), 'skip')
    assert.equal(eventDisableStep({ ...base, openBetsLoading: true }), 'stillLoading')
    assert.equal(eventDisableStep({ ...base, chips: [...base.chips, { marketId: 'other', marketName: 'O', openCount: 1 }] }), 'otherMarketsOpen')
    assert.equal(eventDisableStep(base), 'disable')
    assert.equal(declareErrorMessage({ networkError: { message: 'network' }, message: 'other' }), 'network')
    assert.equal(declareErrorMessage({ graphQLErrors: [{ message: 'graphql' }] }), 'graphql')
  })
})

describe('auto results settings logic', () => {
  const settings = [{
    id: 'one', sportId: 's', leagueId: 'l', eventId: 'e',
    exchangeEnabled: true, bookmakerEnabled: false, fancyEnabled: false,
    sport: { id: 's', name: 'Cricket' }, league: { id: 'l', name: 'IPL' }, event: { id: 'e', name: 'Final' },
  }]
  const sports = [{ id: 's', sportCode: '4' }, { id: 'f', sportCode: '1' }]

  it('finds sport codes, exact settings and readable scopes', () => {
    assert.equal(scopeSportCode(sports, [{ id: 'l', sportId: 's' }], undefined, 'l'), '4')
    assert.equal(findExactSetting(settings, 's', 'l', 'e')?.id, 'one')
    assert.equal(findExactSetting(settings, 's', undefined, undefined), undefined)
    assert.equal(scopeDisplay(settings[0]), 'Cricket / IPL / Final')
    assert.equal(settingIsCricket(settings[0], sports), true)
  })

  it('refuses cricket-only toggles for unknown/non-cricket scopes', () => {
    assert.equal(toggleRefused(settings, 'one', 'bookmaker', true, sports), false)
    const football = [{ ...settings[0], id: 'two', sportId: 'f' }]
    assert.equal(toggleRefused(football, 'two', 'fancy', true, sports), true)
    assert.equal(toggleRefused(football, 'two', 'exchange', true, sports), false)
  })

  it('validates saves and forces non-cricket market types off in mutation input', () => {
    assert.equal(autoResultsSaveBlocker({ isCricket: true, toggles: offToggles() }), 'Please select at least one scope (Sport, League, or Event)')
    assert.equal(autoResultsSaveBlocker({ sportId: 's', isCricket: true, toggles: offToggles() }), 'Please enable at least one market type (Exchange, Bookmaker, or Fancy)')
    assert.equal(autoResultsSaveBlocker({ sportId: 'f', isCricket: false, toggles: offToggles() }), 'Please enable Exchange market type')
    const input = buildAutoResultsInput({ sportId: 'f', isCricket: false, toggles: { exchangeEnabled: true, bookmakerEnabled: true, fancyEnabled: true } })
    assert.deepEqual(input, { sportId: 'f', leagueId: undefined, eventId: undefined, exchangeEnabled: true, bookmakerEnabled: false, fancyEnabled: false })
  })
})
