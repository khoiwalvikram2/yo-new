import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { isSuperAdminRoleName, paymentScopeOf, scopeAcceptsTenant } from './paymentWhitelabelScope'

const SUPER = { userId: 'u1', roles: ['Super Admin'], tenant: 'default' }

describe('paymentScopeOf', () => {
  test('a Super Admin in Core mode must select a whitelabel first', () => {
    assert.deepStrictEqual(paymentScopeOf({ ...SUPER, directorMode: 'core', selectedWhitelabelId: null }), {
      key: 'u1:core:',
      superAdmin: true,
      selectionRequired: true,
      expectedTenant: null,
    })
  })

  test('so must one in Whitelabel mode with no site, or a blank one (the server trims the header)', () => {
    for (const selected of [null, undefined, '', '   ']) {
      const scope = paymentScopeOf({ ...SUPER, directorMode: 'whitelabel', selectedWhitelabelId: selected })
      assert.equal(scope.selectionRequired, true, String(selected))
      assert.equal(scope.expectedTenant, null)
      assert.equal(scope.key, 'u1:whitelabel:')
    }
  })

  test('a selected site is the expected tenant and part of the key', () => {
    assert.deepStrictEqual(paymentScopeOf({ ...SUPER, directorMode: 'whitelabel', selectedWhitelabelId: ' floxi ' }), {
      key: 'u1:whitelabel:floxi',
      superAdmin: true,
      selectionRequired: false,
      expectedTenant: 'floxi',
    })
    // A site left selected in Core mode is not sent, so it is not the scope either.
    assert.equal(paymentScopeOf({ ...SUPER, directorMode: 'core', selectedWhitelabelId: 'floxi' }).selectionRequired, true)
  })

  test('switching the site, the mode or the admin changes the key', () => {
    const keys = new Set([
      paymentScopeOf({ ...SUPER, directorMode: 'whitelabel', selectedWhitelabelId: 'floxi' }).key,
      paymentScopeOf({ ...SUPER, directorMode: 'whitelabel', selectedWhitelabelId: 'other' }).key,
      paymentScopeOf({ ...SUPER, directorMode: 'core', selectedWhitelabelId: null }).key,
      paymentScopeOf({ ...SUPER, userId: 'u2', directorMode: 'whitelabel', selectedWhitelabelId: 'floxi' }).key,
    ])
    assert.equal(keys.size, 4)
  })

  test('anyone else acts on their own site: nothing to select, and the server names the tenant', () => {
    const scope = paymentScopeOf({
      userId: 'u9',
      roles: ['Whitelabel Admin'],
      directorMode: 'core',
      selectedWhitelabelId: null,
      tenant: 'floxi',
    })
    assert.deepStrictEqual(scope, { key: 'u9:floxi', superAdmin: false, selectionRequired: false, expectedTenant: null })
    assert.equal(paymentScopeOf({ userId: undefined, roles: undefined, directorMode: undefined, selectedWhitelabelId: undefined, tenant: undefined }).selectionRequired, false)
  })
})

test('isSuperAdminRoleName keeps the link and backend spellings', () => {
  for (const role of ['Super Admin', 'super_admin', 'SUPER ADMIN', 'Platform Super-Admin']) assert.equal(isSuperAdminRoleName(role), true, role)
  for (const role of ['Admin', 'Whitelabel Admin', 'Supervisor', '']) assert.equal(isSuperAdminRoleName(role), false, role)
})

describe('scopeAcceptsTenant', () => {
  test('a Super Admin takes only answers for the selected site', () => {
    const scope = { selectionRequired: false, expectedTenant: 'floxi' }
    assert.equal(scopeAcceptsTenant(scope, 'floxi'), true)
    assert.equal(scopeAcceptsTenant(scope, 'other'), false)
    assert.equal(scopeAcceptsTenant(scope, null), false)
  })

  test('without a selection nothing is accepted; a site admin takes any named tenant', () => {
    assert.equal(scopeAcceptsTenant({ selectionRequired: true, expectedTenant: null }, 'floxi'), false)
    assert.equal(scopeAcceptsTenant({ selectionRequired: false, expectedTenant: null }, 'floxi'), true)
    assert.equal(scopeAcceptsTenant({ selectionRequired: false, expectedTenant: null }, ''), false)
  })
})
