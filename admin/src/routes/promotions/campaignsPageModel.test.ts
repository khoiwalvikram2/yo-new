import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  CAMPAIGN_FAILURE_MESSAGES,
  DEFAULT_CAMPAIGN_NAME,
  EMPTY_VALUE,
  actionKey,
  createPromotionVariables,
  failureMessage,
  listState,
  promotionIdVariables,
  promotionRows,
  rowActionLabel,
  runThenRefetch,
  scheduleLabel,
  updatedLabel,
  type PromotionRow,
} from './campaignsPageModel'

const day = (value: string) => `day(${value})`
const stamp = (value: string) => `stamp(${value})`

function row(overrides: Partial<PromotionRow> = {}): PromotionRow {
  return { id: 'p-1', name: 'Diwali Reload', status: 'draft', ...overrides }
}

describe('campaignsPageModel', () => {
  test('starts the name field at the legacy default', () => {
    assert.equal(DEFAULT_CAMPAIGN_NAME, 'New Campaign')
    assert.equal(EMPTY_VALUE, '—')
  })

  test('takes the rows in the server order and treats a missing list as empty', () => {
    const rows = [row({ id: 'b' }), row({ id: 'a' })]
    assert.equal(promotionRows({ promotions: rows }), rows)
    assert.deepEqual(promotionRows({ promotions: null }), [])
    assert.deepEqual(promotionRows({}), [])
    assert.deepEqual(promotionRows(undefined), [])
    assert.deepEqual(promotionRows(null), [])
  })

  test('prints the schedule as "start – end" with an em dash for a missing side', () => {
    assert.equal(
      scheduleLabel({ scheduleStart: '2026-10-01T00:00:00Z', scheduleEnd: '2026-10-31T00:00:00Z' }, day),
      'day(2026-10-01T00:00:00Z) – day(2026-10-31T00:00:00Z)',
    )
    assert.equal(scheduleLabel({ scheduleStart: '2026-10-01', scheduleEnd: null }, day), 'day(2026-10-01) – —')
    assert.equal(scheduleLabel({ scheduleStart: '', scheduleEnd: '2026-10-31' }, day), '— – day(2026-10-31)')
    assert.equal(scheduleLabel({}, day), '— – —')
  })

  test('prints Updated as date and time, or an em dash', () => {
    assert.equal(updatedLabel('2026-10-07T09:15:00Z', stamp), 'stamp(2026-10-07T09:15:00Z)')
    assert.equal(updatedLabel(null, stamp), '—')
    assert.equal(updatedLabel(undefined, stamp), '—')
    assert.equal(updatedLabel('', stamp), '—')
  })

  test('sends the name exactly as typed, untrimmed and even when blank', () => {
    assert.deepEqual(createPromotionVariables('  Spaced  '), { input: { name: '  Spaced  ' } })
    assert.deepEqual(createPromotionVariables(''), { input: { name: '' } })
    assert.deepEqual(Object.keys(createPromotionVariables('x').input), ['name'])
    assert.deepEqual(promotionIdVariables('p-9'), { id: 'p-9' })
  })

  test('keys a busy action per button and names row buttons by campaign', () => {
    assert.equal(actionKey('create'), 'create')
    assert.equal(actionKey('publish', 'p-1'), 'publish:p-1')
    assert.equal(actionKey('pause', 'p-1'), 'pause:p-1')
    assert.notEqual(actionKey('publish', 'p-1'), actionKey('publish', 'p-2'))
    assert.equal(rowActionLabel('Publish', row()), 'Publish Diwali Reload')
    assert.equal(rowActionLabel('Pause', row({ name: '   ' })), 'Pause campaign p-1')
  })

  test('prefers the server message and falls back per action', () => {
    assert.deepEqual(CAMPAIGN_FAILURE_MESSAGES, {
      create: 'Failed to create campaign',
      publish: 'Failed to publish campaign',
      pause: 'Failed to pause campaign',
    })
    assert.equal(failureMessage(new Error('Name already taken'), 'fallback'), 'Name already taken')
    assert.equal(failureMessage(new Error('   '), 'fallback'), 'fallback')
    assert.equal(failureMessage('not an error', 'fallback'), 'fallback')
    assert.equal(failureMessage(undefined, 'fallback'), 'fallback')
  })

  test('runs the mutation, then the refetch, in that order', async () => {
    const calls: string[] = []
    const outcome = await runThenRefetch(
      async () => { calls.push('mutate') },
      async () => { calls.push('refetch') },
      'fallback',
    )
    assert.deepEqual(outcome, { ok: true })
    assert.deepEqual(calls, ['mutate', 'refetch'])
  })

  test('skips the refetch and reports the message when the mutation rejects', async () => {
    const calls: string[] = []
    const outcome = await runThenRefetch(
      async () => { throw new Error('Promotion not found') },
      async () => { calls.push('refetch') },
      'Failed to publish campaign',
    )
    assert.deepEqual(outcome, { ok: false, message: 'Promotion not found' })
    assert.deepEqual(calls, [])

    const silent = await runThenRefetch(
      () => Promise.reject(new Error('')),
      async () => undefined,
      'Failed to pause campaign',
    )
    assert.deepEqual(silent, { ok: false, message: 'Failed to pause campaign' })
  })

  test('never rejects when only the refetch fails', async () => {
    const outcome = await runThenRefetch(
      async () => undefined,
      () => Promise.reject(new Error('network down')),
      'fallback',
    )
    assert.deepEqual(outcome, { ok: true })
  })

  test('puts an error before the first load, and the first load before ready', () => {
    assert.equal(listState(false, undefined), 'ready')
    assert.equal(listState(true, undefined), 'loading')
    assert.equal(listState(true, new Error('x')), 'error')
    assert.equal(listState(false, new Error('x')), 'error')
  })
})
