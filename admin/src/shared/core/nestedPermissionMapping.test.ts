import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { hasPermissionWithNested } from './nestedPermissionMapping'

/* The flat-to-nested map mirrors admin-backend's (config/nestedPermissions.ts). notifications.list and the
   Promotions pair (promotions.campaigns, promotions.content) gate nothing since 2026-11-04 and left both maps, so a
   flat grant no longer counts as holding them; the live entries still work. */
describe('nested permissions granted by flat ones', () => {
  test('the retired permissions are granted by no flat permission any more', () => {
    const flat = [
      { domain: 'notifications', actions: ['manage'] },
      { domain: 'promotions', actions: ['read', 'write'] },
    ]
    for (const [domain, action] of [
      ['notifications.list', 'view'],
      ['notifications.list', 'update'],
      ['promotions.campaigns', 'view'],
      ['promotions.campaigns', 'delete'],
      ['promotions.content', 'view'],
      ['promotions.content', 'update'],
    ]) {
      assert.equal(hasPermissionWithNested(flat, domain, action), false, `${domain}:${action}`)
    }
  })

  test('a flat grant still opens the nested permissions it maps to', () => {
    assert.equal(hasPermissionWithNested([{ domain: 'credit', actions: ['read'] }], 'credit.management', 'view'), true)
    assert.equal(hasPermissionWithNested([{ domain: 'credit', actions: ['read'] }], 'credit.settlements', 'create'), false)
    assert.equal(hasPermissionWithNested([{ domain: 'audit', actions: ['read'] }], 'audit.events', 'view'), true)
    assert.equal(hasPermissionWithNested([{ domain: 'all', actions: ['*'] }], 'promotions.campaigns', 'view'), true, 'all:* still holds anything')
  })
})
