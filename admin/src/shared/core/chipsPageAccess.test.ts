/**
 * T068: who can open /credit, the admin's Chips page, in the one rule the page and its sidebar link both read.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { CHIPS_PAGE_PERMISSION, canOpenChipProfile, canOpenChipsPage, isWhitelabelAdminRole } from './chipsPageAccess'

describe('canOpenChipProfile', () => {
  test("a row's View follows the profile page's own permission, so Finance Manager gets none", () => {
    const financeManager = [{ domain: 'credit.management', actions: ['view'] }]
    assert.equal(canOpenChipProfile('AGENT', ['Finance Manager'], financeManager), false)
    assert.equal(canOpenChipProfile('PLAYER', ['Finance Manager'], financeManager), false)
    assert.equal(canOpenChipProfile('AGENT', ['Reports Viewer'], [{ domain: 'agents.list', actions: ['view'] }]), true)
    assert.equal(canOpenChipProfile('PLAYER', ['Reports Viewer'], [{ domain: 'agents.list', actions: ['view'] }]), false)
    assert.equal(canOpenChipProfile('PLAYER', ['Support'], [{ domain: 'players.profile', actions: ['view'] }]), true)
    assert.equal(canOpenChipProfile('AGENT', ['Super Admin'], [{ domain: 'all', actions: ['*'] }]), true)
    assert.equal(canOpenChipProfile('PLAYER', ['Whitelabel Admin'], []), true)
  })
})

describe('canOpenChipsPage', () => {
  test('the whitelabel admin roles by name, though they hold no credit permission', () => {
    for (const role of ['Whitelabel Admin', 'whitelabel_admin', 'WHITELABEL_ADMIN', 'Senior Whitelabel Manager']) {
      assert.equal(canOpenChipsPage([role], []), true, role)
    }
    assert.equal(isWhitelabelAdminRole(['Super Admin', 'Support']), false)
  })

  test('anyone holding credit.management:view (Finance Manager, Reports Viewer), or a flat grant of it', () => {
    assert.deepEqual(CHIPS_PAGE_PERMISSION, { domain: 'credit.management', actions: ['view'] })
    assert.equal(canOpenChipsPage(['Finance Manager'], [{ domain: 'credit.management', actions: ['view'] }]), true)
    assert.equal(canOpenChipsPage(['Reports Viewer'], [{ domain: 'credit', actions: ['read'] }]), true)
    // Super Admin holds every permission.
    assert.equal(canOpenChipsPage(['Super Admin'], [{ domain: 'all', actions: ['*'] }]), true)
  })

  test('nobody else: other credit permissions, agent access or no permissions at all', () => {
    assert.equal(canOpenChipsPage(['Manager'], [{ domain: 'agents.list', actions: ['view'] }]), false)
    assert.equal(canOpenChipsPage(['Compliance Officer'], [{ domain: 'credit.history', actions: ['view'] }]), false)
    assert.equal(canOpenChipsPage(['Viewer'], null), false)
    assert.equal(canOpenChipsPage([], undefined), false)
  })
})
