/**
 * /matka/:id's pure helpers: the status action and the variables it sends (PAUSED kept as the legacy
 * page sent it), the clone naming, the fact rows in legacy order, the JSON blocks exactly as the legacy
 * <pre> printed them, the not-found title and the failed-load copy.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  MATKA_DETAILS_TITLE,
  cloneMatkaVariables,
  matkaFacts,
  matkaJson,
  matkaJsonBlocks,
  matkaLoadErrorText,
  matkaStatusAction,
  matkaStatusVariables,
  matkaText,
  type MatkaDetail,
} from './matkaViewModel'

const MATKA: MatkaDetail = {
  id: '7',
  name: 'Kalyan Morning',
  code: 'KLM',
  timezone: 'Asia/Kolkata',
  schedule: { open: '09:30', close: '11:30', days: ['MON', 'TUE'] },
  status: 'INACTIVE',
  limits: { minBet: 10, maxBet: 50000 },
  priority: 0,
  settings: null,
  updatedAt: '2026-10-06T10:15:00.000Z',
}

describe('matkaViewModel', () => {
  test('ACTIVE offers Pause (sending PAUSED); every other status offers the primary Activate', () => {
    assert.deepEqual(matkaStatusAction('ACTIVE'), { label: 'Pause', toStatus: 'PAUSED', variant: 'secondary' })
    for (const status of ['INACTIVE', 'SUSPEND', 'active', '', null, undefined]) {
      assert.deepEqual(matkaStatusAction(status), { label: 'Activate', toStatus: 'ACTIVE', variant: 'primary' })
    }
    assert.deepEqual(matkaStatusVariables('7', 'ACTIVE'), { id: '7', toStatus: 'ACTIVE' })
    assert.deepEqual(matkaStatusVariables('7', 'PAUSED'), { id: '7', toStatus: 'PAUSED' })
    assert.deepEqual(Object.keys(matkaStatusVariables('7', 'ACTIVE')), ['id', 'toStatus'])
  })

  test('clone sends the id with "<name> Copy" and "<code>-copy"', () => {
    assert.deepEqual(cloneMatkaVariables(MATKA), { id: '7', name: 'Kalyan Morning Copy', code: 'KLM-copy' })
    assert.deepEqual(Object.keys(cloneMatkaVariables(MATKA)), ['id', 'name', 'code'])
  })

  test('raw values print as React printed them: nothing for null or undefined, zero as 0', () => {
    assert.equal(matkaText(null), '')
    assert.equal(matkaText(undefined), '')
    assert.equal(matkaText(0), '0')
    assert.equal(matkaText(12), '12')
    assert.equal(matkaText('UTC'), 'UTC')
  })

  test('the facts keep the legacy labels and order, Updated last', () => {
    assert.deepEqual(matkaFacts(MATKA), [
      { key: 'code', term: 'Code', value: 'KLM' },
      { key: 'status', term: 'Status', value: 'INACTIVE' },
      { key: 'timezone', term: 'Timezone', value: 'Asia/Kolkata' },
      { key: 'priority', term: 'Priority', value: '0' },
      { key: 'updated', term: 'Updated', value: '2026-10-06T10:15:00.000Z' },
    ])
    assert.deepEqual(
      matkaFacts({ id: '1', name: 'N', code: 'C' }).map((fact) => fact.value),
      ['C', '', '', '', ''],
    )
  })

  test('the JSON blocks are the legacy two-space JSON, in Schedule, Limits, Settings order', () => {
    assert.equal(matkaJson({ a: 1, b: [1, 2] }), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
    assert.equal(matkaJson(null), 'null')
    assert.equal(matkaJson(undefined), '')
    assert.equal(matkaJson('09:30-11:30'), '"09:30-11:30"')
    assert.deepEqual(matkaJsonBlocks(MATKA), [
      { key: 'schedule', label: 'Schedule', code: JSON.stringify(MATKA.schedule, null, 2) },
      { key: 'limits', label: 'Limits', code: JSON.stringify(MATKA.limits, null, 2) },
      { key: 'settings', label: 'Settings', code: 'null' },
    ])
  })

  test('the not-found title is the route label, and a failed load says why', () => {
    assert.equal(MATKA_DETAILS_TITLE, 'Matka Details')
    assert.equal(matkaLoadErrorText({ message: 'Response not successful: Received status code 502' }), 'Failed to load matka: Response not successful: Received status code 502')
    assert.equal(matkaLoadErrorText({ message: '   ' }), 'Failed to load matka')
    assert.equal(matkaLoadErrorText(undefined), 'Failed to load matka')
    assert.equal(matkaLoadErrorText(null), 'Failed to load matka')
  })
})
