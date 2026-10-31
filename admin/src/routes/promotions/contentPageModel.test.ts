import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  CONTENT_FAILURE_MESSAGES,
  DEFAULT_CONTENT_DRAFT,
  EMPTY_VALUE,
  actionKey,
  contentRows,
  createContentVariables,
  failureMessage,
  listState,
  publishContentVariables,
  rowActionLabel,
  runThenRefetch,
  updateContentVariables,
  updatedLabel,
  type ContentRow,
} from './contentPageModel'

const stamp = (value: string) => `stamp(${value})`

function row(overrides: Partial<ContentRow> = {}): ContentRow {
  return {
    id: 'c-1',
    name: 'Welcome Banner',
    locale: 'en',
    body: 'Hello',
    status: 'draft',
    ...overrides,
  }
}

describe('contentPageModel', () => {
  test('starts the create fields at the legacy defaults', () => {
    assert.deepEqual(DEFAULT_CONTENT_DRAFT, { name: 'New Block', locale: 'en', body: '' })
    assert.equal(EMPTY_VALUE, '—')
  })

  test('takes the rows in the server order and treats a missing list as empty', () => {
    const rows = [row({ id: 'b' }), row({ id: 'a' })]
    assert.equal(contentRows({ content: rows }), rows)
    assert.deepEqual(contentRows({ content: null }), [])
    assert.deepEqual(contentRows({}), [])
    assert.deepEqual(contentRows(undefined), [])
    assert.deepEqual(contentRows(null), [])
  })

  test('prints Updated as date and time, or an em dash', () => {
    assert.equal(updatedLabel('2026-10-07T09:15:00Z', stamp), 'stamp(2026-10-07T09:15:00Z)')
    assert.equal(updatedLabel(null, stamp), '—')
    assert.equal(updatedLabel(undefined, stamp), '—')
    assert.equal(updatedLabel('', stamp), '—')
  })

  test('creates with the three fields exactly as typed, untrimmed and possibly blank', () => {
    assert.deepEqual(
      createContentVariables({ name: '  Promo  ', locale: 'hi', body: '' }),
      { input: { name: '  Promo  ', locale: 'hi', body: '' } },
    )
    assert.deepEqual(Object.keys(createContentVariables(DEFAULT_CONTENT_DRAFT).input), ['name', 'locale', 'body'])
  })

  test('updates with the id, name and body of the row itself, and no locale, as before', () => {
    const variables = updateContentVariables(row({ id: 'c-7', name: 'Footer', body: 'Bye', locale: 'hi' }))
    assert.deepEqual(variables, { input: { id: 'c-7', name: 'Footer', body: 'Bye' } })
    assert.deepEqual(Object.keys(variables.input), ['id', 'name', 'body'])
    assert.deepEqual(publishContentVariables('c-9'), { id: 'c-9' })
  })

  test('keys a busy action per button and names row buttons by block', () => {
    assert.equal(actionKey('create'), 'create')
    assert.equal(actionKey('update', 'c-1'), 'update:c-1')
    assert.equal(actionKey('publish', 'c-1'), 'publish:c-1')
    assert.notEqual(actionKey('update', 'c-1'), actionKey('update', 'c-2'))
    assert.equal(rowActionLabel('Update', row()), 'Update Welcome Banner')
    assert.equal(rowActionLabel('Publish', row({ name: '' })), 'Publish content c-1')
  })

  test('prefers the server message and falls back per action', () => {
    assert.deepEqual(CONTENT_FAILURE_MESSAGES, {
      create: 'Failed to create content',
      update: 'Failed to update content',
      publish: 'Failed to publish content',
    })
    assert.equal(failureMessage(new Error('Locale not supported'), 'fallback'), 'Locale not supported')
    assert.equal(failureMessage(new Error(' '), 'fallback'), 'fallback')
    assert.equal(failureMessage({ message: 'plain object' }, 'fallback'), 'fallback')
  })

  test('runs the mutation, then the refetch; a rejected mutation skips the refetch', async () => {
    const calls: string[] = []
    assert.deepEqual(
      await runThenRefetch(async () => { calls.push('mutate') }, async () => { calls.push('refetch') }, 'x'),
      { ok: true },
    )
    assert.deepEqual(calls, ['mutate', 'refetch'])

    calls.length = 0
    assert.deepEqual(
      await runThenRefetch(
        async () => { throw new Error('Content not found') },
        async () => { calls.push('refetch') },
        'Failed to update content',
      ),
      { ok: false, message: 'Content not found' },
    )
    assert.deepEqual(calls, [])
  })

  test('never rejects when only the refetch fails', async () => {
    assert.deepEqual(
      await runThenRefetch(async () => undefined, () => Promise.reject(new Error('down')), 'x'),
      { ok: true },
    )
  })

  test('puts an error before the first load, and the first load before ready', () => {
    assert.equal(listState(false, null), 'ready')
    assert.equal(listState(true, null), 'loading')
    assert.equal(listState(true, new Error('x')), 'error')
  })
})
