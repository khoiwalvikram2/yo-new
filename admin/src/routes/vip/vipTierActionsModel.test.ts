import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { payloadOutcome, tierDeleteCopy, tierStatusChange } from './vipTierActionsModel'

describe('vipTierActionsModel', () => {
  test('an active tier is deactivated; an inactive or draft one is activated', () => {
    assert.deepEqual(
      [tierStatusChange({ id: 's', name: 'Silver', status: 'active' }).status, tierStatusChange({ id: 's', name: 'Silver', status: 'active' }).label],
      ['inactive', 'Deactivate'],
    )
    for (const status of ['inactive', 'draft']) {
      const change = tierStatusChange({ id: 'g', name: 'Gold', status })
      assert.deepEqual([change.status, change.label, change.title, change.done], ['active', 'Activate', 'Activate Gold?', 'Gold activated'])
    }
  })

  test('says what deactivating does to the members, and what delete refuses', () => {
    assert.match(tierStatusChange({ id: 's', name: 'Silver', status: 'active' }).description, /Players can no longer reach Silver/)
    assert.deepEqual(tierDeleteCopy({ id: 'g', name: 'Gold', status: 'inactive' }), {
      title: 'Delete Gold?',
      description: 'The tier is removed for good. A tier that players have been on cannot be deleted: deactivate it instead.',
      done: 'Gold deleted',
    })
  })

  test('turns a refused payload into the error the confirmation shows', () => {
    assert.doesNotThrow(() => payloadOutcome({ success: true, message: 'ok' }, 'fallback'))
    assert.throws(() => payloadOutcome({ success: false, message: 'Players have been on this tier' }, 'fallback'), /^Error: Players have been on this tier$/)
    assert.throws(() => payloadOutcome({ success: false, message: ' ' }, 'Unable to delete Gold'), /^Error: Unable to delete Gold$/)
    assert.throws(() => payloadOutcome(undefined, 'Unable to delete Gold'), /^Error: Unable to delete Gold$/)
  })
})
