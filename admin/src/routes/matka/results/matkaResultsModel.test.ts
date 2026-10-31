import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { MatkaResult } from '@/modules/matka/results'
import {
  MATKA_RESULT_DATE_PRESETS,
  MATKA_RESULT_STATUS_FILTER_OPTIONS,
  MATKA_RESULT_TYPE_FILTER_OPTIONS,
  ROLLBACK_TAG_OPTIONS,
  acceptDeclareDate,
  applyMatkaResultDateRange,
  applyStatusFilter,
  autoDeclareType,
  buildCreateMatkaResultInput,
  buildMatkaResultsVariables,
  buildRollbackInput,
  canConfirmRollback,
  canSubmitDeclare,
  closeTypeNotice,
  computeMatkaResultStats,
  countActiveMatkaResultFilters,
  declareFieldError,
  declarePreviewText,
  defaultMatkaResultFilters,
  initialDeclareValues,
  isRecentDeclaration,
  matkaListboxOptions,
  matkaNameFor,
  matkaOptionsFrom,
  matkaResultDatePreset,
  matkaResultStatCards,
  matkaResultStatus,
  matkaResultTypeLabel,
  pendingBetsAcross,
  pendingBetsCountLabel,
  pendingBetsDescription,
  pendingBetsSettlementHint,
  pendingBetsTitle,
  pendingBetsWaitingHint,
  resultCountLabel,
  rollbackActionLabel,
  rollbackFacts,
  rollbackReasonError,
  sanitizeResultInput,
  statusFilterValue,
  summarizePendingBets,
  typeFilterFromValue,
  validateDeclareResult,
  withMatkaResultFilter,
} from './matkaResultsModel'

function result(patch: Partial<MatkaResult> = {}): MatkaResult {
  return {
    id: 'r1',
    matkaId: 'm1',
    date: '2026-10-05',
    type: 'open',
    result: '45',
    declaredBy: 'u-1',
    declaredAt: '2026-10-05T04:00:00.000Z',
    createdAt: '2026-10-05T04:00:00.000Z',
    ...patch,
  }
}

const MATKAS = [
  { id: 'm1', name: 'Kalyan', code: 'KLN' },
  { id: 'm2', name: 'Milan Day', code: 'MLD' },
]

describe('matkaResultsModel', () => {
  test('defaults, variables in the legacy key order, and the two-character trimmed search', () => {
    assert.deepEqual(defaultMatkaResultFilters(), { page: 1, limit: 20, sort: 'createdAt:desc' })
    assert.notEqual(defaultMatkaResultFilters(), defaultMatkaResultFilters(), 'a fresh object each time')

    const variables = buildMatkaResultsVariables({
      sort: 'createdAt:desc',
      search: '  45 ',
      rolledBack: false,
      dateTo: '2026-10-02',
      dateFrom: '2026-10-01',
      type: 'close',
      matkaId: 'm1',
    })
    assert.deepEqual(Object.keys(variables), [
      'matkaId', 'type', 'dateFrom', 'dateTo', 'search', 'rolledBack', 'page', 'limit', 'sort',
    ])
    assert.deepEqual(variables, {
      matkaId: 'm1',
      type: 'close',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-02',
      search: '45',
      rolledBack: false,
      page: 1,
      limit: 20,
      sort: 'createdAt:desc',
    })
    assert.equal(buildMatkaResultsVariables({ search: ' 4 ' }).search, undefined)
    assert.equal(buildMatkaResultsVariables({ search: '' }).search, undefined)
    assert.deepEqual(buildMatkaResultsVariables({ page: 3, limit: 50, sort: 'date:asc' }), {
      matkaId: undefined,
      type: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      search: undefined,
      rolledBack: undefined,
      page: 3,
      limit: 50,
      sort: 'date:asc',
    })
  })

  test('filter count, filter changes and the select mappings', () => {
    assert.equal(countActiveMatkaResultFilters(defaultMatkaResultFilters()), 0)
    assert.equal(countActiveMatkaResultFilters({ search: 'a' }), 1, 'one character counts')
    assert.equal(countActiveMatkaResultFilters({ rolledBack: false }), 1, 'Active counts')
    assert.equal(countActiveMatkaResultFilters({
      search: '45', matkaId: 'm1', type: 'open', dateFrom: '2026-10-01', dateTo: '2026-10-02', rolledBack: true,
    }), 5)

    assert.deepEqual(withMatkaResultFilter({ page: 4, limit: 50 }, { type: 'open' }), { page: 1, limit: 50, type: 'open' })

    assert.deepEqual(MATKA_RESULT_TYPE_FILTER_OPTIONS.map((option) => option.label), ['All Types', 'Open', 'Close'])
    assert.equal(typeFilterFromValue('open'), 'open')
    assert.equal(typeFilterFromValue('close'), 'close')
    assert.equal(typeFilterFromValue(''), undefined)

    assert.deepEqual(MATKA_RESULT_STATUS_FILTER_OPTIONS.map((option) => option.label), ['All Status', 'Active', 'Rolled Back'])
    assert.equal(statusFilterValue(undefined), '')
    assert.equal(statusFilterValue(false), 'active')
    assert.equal(statusFilterValue(true), 'rolledBack')
    assert.deepEqual(applyStatusFilter({ page: 3 }, 'rolledBack'), { page: 1, rolledBack: true })
    assert.deepEqual(applyStatusFilter({ page: 3 }, 'active'), { page: 1, rolledBack: false })
    const cleared = applyStatusFilter({ page: 3, rolledBack: true, type: 'open' }, '')
    assert.deepEqual(cleared, { page: 1, type: 'open' })
    assert.ok(!('rolledBack' in cleared), 'All Status removes the key')
  })

  test('the date filter: All dates or a custom range of picked days', () => {
    assert.deepEqual(MATKA_RESULT_DATE_PRESETS.map((preset) => preset.label), ['All dates', 'Custom range'])
    assert.equal(matkaResultDatePreset({}), 'all')
    assert.equal(matkaResultDatePreset({ dateFrom: '2026-10-01' }), 'all')
    assert.equal(matkaResultDatePreset({ dateFrom: '2026-10-01', dateTo: '2026-10-02' }), 'custom')
    assert.deepEqual(
      applyMatkaResultDateRange({ page: 2, type: 'open' }, { kind: 'custom', from: '2026-09-01', to: '2026-09-15' }),
      { page: 1, type: 'open', dateFrom: '2026-09-01', dateTo: '2026-09-15' },
    )
    assert.deepEqual(
      applyMatkaResultDateRange({ page: 2, dateFrom: '2026-09-01', dateTo: '2026-09-15' }, { kind: 'preset', preset: 'all' }),
      { page: 1, dateFrom: undefined, dateTo: undefined },
    )
  })

  test('matka options, labels and names', () => {
    assert.deepEqual(matkaOptionsFrom(undefined), [])
    assert.deepEqual(matkaOptionsFrom(null), [])
    assert.equal(matkaOptionsFrom(MATKAS), MATKAS)
    assert.deepEqual(matkaListboxOptions(MATKAS), [
      { value: 'm1', label: 'Kalyan (KLN)' },
      { value: 'm2', label: 'Milan Day (MLD)' },
    ])
    assert.equal(matkaNameFor({ matkaId: 'm2' }, MATKAS), 'Milan Day')
    assert.equal(matkaNameFor({ matkaId: 'm9' }, MATKAS), 'm9')
  })

  test('pending bets: summary, singular and plural copy, separators and the "more" tail', () => {
    const rows = [
      result({ id: 'a', matkaId: 'm1', date: '2026-10-01', pendingBetsCount: 2 }),
      result({ id: 'b', matkaId: 'm2', date: '2026-10-02', pendingBetsCount: 1 }),
      result({ id: 'c', matkaId: 'm9', date: '2026-10-03', pendingBetsCount: 5 }),
      result({ id: 'd', matkaId: 'm1', date: '2026-10-04', pendingBetsCount: 1 }),
      result({ id: 'e', pendingBetsCount: 0 }),
      result({ id: 'f' }),
    ]
    const summary = summarizePendingBets(rows)
    assert.equal(summary.count, 4)
    assert.equal(summary.totalBets, 9)
    assert.deepEqual(summary.results.map((row) => row.id), ['a', 'b', 'c', 'd'])

    assert.equal(pendingBetsTitle(1), '1 pending bet waiting for settlement')
    assert.equal(pendingBetsTitle(9), '9 pending bets waiting for settlement')
    assert.equal(pendingBetsAcross(1), 'across 1 result')
    assert.equal(pendingBetsAcross(4), 'across 4 results')
    assert.equal(
      pendingBetsDescription(summary, MATKAS),
      'Kalyan (KLN) - 2026-10-01 (2 bets), Milan Day (MLD) - 2026-10-02 (1 bet), 2026-10-03 - 2026-10-03 (5 bets) and 1 more...',
    )
    assert.equal(
      pendingBetsDescription(summarizePendingBets(rows.slice(0, 1)), MATKAS),
      'Kalyan (KLN) - 2026-10-01 (2 bets)',
    )
    assert.equal(
      pendingBetsDescription(summarizePendingBets(rows.slice(0, 2)), MATKAS),
      'Kalyan (KLN) - 2026-10-01 (2 bets), Milan Day (MLD) - 2026-10-02 (1 bet)',
    )
    assert.equal(
      pendingBetsDescription(summarizePendingBets(rows.slice(0, 3)), MATKAS),
      'Kalyan (KLN) - 2026-10-01 (2 bets), Milan Day (MLD) - 2026-10-02 (1 bet), 2026-10-03 - 2026-10-03 (5 bets)',
    )
    assert.equal(summarizePendingBets([]).totalBets, 0)

    assert.equal(pendingBetsCountLabel(1), '1 bet')
    assert.equal(pendingBetsCountLabel(3), '3 bets')
    assert.equal(pendingBetsWaitingHint(1), '1 pending bet waiting for result')
    assert.equal(pendingBetsSettlementHint(2), '2 pending bets need settlement')
  })

  test('statistics over the first 1,000 results, with the legacy notes and fallbacks', () => {
    const rows = [
      result({ id: '1', date: '2026-10-07', type: 'open' }),
      result({ id: '2', date: '2026-10-07', type: 'close' }),
      result({ id: '3', date: '2026-10-06', type: 'open' }),
      result({ id: '4', date: '2026-10-06', type: 'open', rolledBackAt: '2026-10-06T10:00:00Z' }),
    ]
    const stats = computeMatkaResultStats(rows, '2026-10-07')
    assert.deepEqual(stats, { total: 4, today: 2, open: 2, close: 1, rolledBack: 1 })
    assert.deepEqual(matkaResultStatCards(stats), [
      { key: 'total', label: 'Total Results', value: '4', note: '2 today' },
      { key: 'open', label: 'Open Results', value: 2, note: '1 pending close' },
      { key: 'close', label: 'Closed Results', value: 1, note: '50% completion' },
      { key: 'rolledBack', label: 'Rolled Back', value: 1, note: '25%' },
    ])
    const empty = matkaResultStatCards(computeMatkaResultStats([], '2026-10-07'))
    assert.deepEqual(empty.map((card) => card.note), ['0 today', '0 pending close', '—', '—'])
    const big = matkaResultStatCards({ total: 1000, today: 0, open: 0, close: 0, rolledBack: 0 })
    assert.equal(big[0].value, (1000).toLocaleString())
  })

  test('row status, type label, recency, action names and the count line', () => {
    assert.deepEqual(matkaResultStatus({ type: 'open', rolledBackAt: '2026-10-06T10:00:00Z' }), { label: 'Rolled Back', tone: 'neg' })
    assert.deepEqual(matkaResultStatus({ type: 'open', rolledBackAt: null }), { label: 'Open', tone: 'ok' })
    assert.deepEqual(matkaResultStatus({ type: 'close' }), { label: 'Closed', tone: 'info' })
    assert.equal(matkaResultTypeLabel('open'), 'OPEN')
    assert.equal(matkaResultTypeLabel('close'), 'CLOSE')

    const now = Date.parse('2026-10-07T10:00:00.000Z')
    assert.equal(isRecentDeclaration('2026-10-07T09:30:00.000Z', now), true)
    assert.equal(isRecentDeclaration('2026-10-07T09:00:00.000Z', now), false, 'exactly an hour is not recent')
    assert.equal(isRecentDeclaration('not a date', now), false)
    assert.equal(isRecentDeclaration(null, now), false)

    assert.equal(rollbackActionLabel({ date: '2026-10-05', type: 'close' }, 'Kalyan'), 'Rollback Kalyan 2026-10-05 CLOSE result')
    assert.equal(resultCountLabel(true, 4), 'Loading...')
    assert.equal(resultCountLabel(false, 1), '1 result')
    assert.equal(resultCountLabel(false, 0), '0 results')
  })

  test('rollback: required reason (whitespace counts), the case-sensitive word, input and facts', () => {
    assert.deepEqual(ROLLBACK_TAG_OPTIONS.map((tag) => tag.value), ['error', 'correction', 'fraud', 'other'])
    assert.equal(rollbackReasonError(''), 'Please provide a reason for rollback')
    assert.equal(rollbackReasonError('  '), undefined)
    assert.equal(canConfirmRollback('ROLLBACK'), true)
    assert.equal(canConfirmRollback('rollback'), false)
    assert.equal(canConfirmRollback(' ROLLBACK'), false)
    assert.deepEqual(Object.keys(buildRollbackInput('r1', 'why', 'fraud')), ['id', 'reason', 'tag'])
    assert.deepEqual(buildRollbackInput('r1', 'why'), { id: 'r1', reason: 'why', tag: undefined })
    assert.deepEqual(rollbackFacts(result({ type: 'close', result: '456' })).map((fact) => [fact.term, fact.value]), [
      ['Market', 'm1'],
      ['Date', '2026-10-05'],
      ['Type', 'CLOSE'],
      ['Result', '456'],
    ])
  })

  test('declare: defaults, digits only, the later-day refusal and every field rule', () => {
    const values = initialDeclareValues('2026-10-07')
    assert.deepEqual(values, { matkaId: '', date: '2026-10-07', type: 'open', result: '' })
    assert.equal(sanitizeResultInput('4a5 6'), '456')
    assert.equal(sanitizeResultInput('abc'), '')
    assert.equal(acceptDeclareDate('2026-10-07', '2026-10-07'), true)
    assert.equal(acceptDeclareDate('2026-10-08', '2026-10-07'), false)
    assert.equal(acceptDeclareDate('', '2026-10-07'), true)

    assert.deepEqual(validateDeclareResult(values), {
      matkaId: 'Please select a market',
      result: 'Please enter result',
    })
    assert.equal(declareFieldError('date', { ...values, date: '' }), 'Please select a date')
    assert.equal(declareFieldError('result', { ...values, result: '4' }), 'Result must be 2 or 3 digits (00-99 or 000-999)')
    assert.equal(declareFieldError('result', { ...values, result: '4567' }), 'Result must be 2 or 3 digits (00-99 or 000-999)')
    assert.equal(declareFieldError('result', { ...values, result: '07' }), undefined)
    assert.equal(declareFieldError('result', { ...values, result: '007' }), undefined)
    assert.deepEqual(validateDeclareResult({ matkaId: 'm1', date: '2026-10-07', type: 'close', result: '123' }), {})

    assert.deepEqual(
      buildCreateMatkaResultInput({ result: '45', type: 'close', date: '2026-10-07', matkaId: 'm2' }),
      { matkaId: 'm2', date: '2026-10-07', type: 'close', result: '45' },
    )
    assert.deepEqual(
      Object.keys(buildCreateMatkaResultInput({ result: '45', type: 'close', date: '2026-10-07', matkaId: 'm2' })),
      ['matkaId', 'date', 'type', 'result'],
    )
    assert.equal(declarePreviewText('close', '2026-10-07'), 'This will be the close result for 2026-10-07')
  })

  test('declare: Close needs an open result, the type follows the check unless chosen by hand', () => {
    assert.equal(canSubmitDeclare('open', false), true)
    assert.equal(canSubmitDeclare('close', true), true)
    assert.equal(canSubmitDeclare('close', false), false)

    const base = {
      hasOpen: true,
      type: 'open' as const,
      matkaId: 'm1',
      date: '2026-10-07',
      existsLoading: false,
      existsKnown: true,
      typeManuallyChanged: false,
    }
    assert.equal(autoDeclareType(base), 'close')
    assert.equal(autoDeclareType({ ...base, hasOpen: false, type: 'close' }), 'open')
    assert.equal(autoDeclareType({ ...base, type: 'close' }), null)
    assert.equal(autoDeclareType({ ...base, hasOpen: false }), null)
    assert.equal(autoDeclareType({ ...base, typeManuallyChanged: true }), null)
    assert.equal(autoDeclareType({ ...base, existsLoading: true }), null)
    assert.equal(autoDeclareType({ ...base, existsKnown: false }), null)
    assert.equal(autoDeclareType({ ...base, matkaId: undefined }), null)

    assert.deepEqual(closeTypeNotice(true, true), {
      tone: 'ok',
      title: 'Open result found',
      body: 'Open result exists for the selected market/date. You can safely declare the close result.',
    })
    assert.deepEqual(closeTypeNotice(false, true), {
      tone: 'info',
      title: 'Validating open result…',
      body: 'Checking the server for an open result for this date/market.',
    })
    assert.deepEqual(closeTypeNotice(false, false), {
      tone: 'warn',
      title: 'Open result required',
      body: 'Cannot declare close result until open result is declared for this date/market.',
    })
  })
})
