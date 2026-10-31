import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sportsResultReadScope } from '../resultReadScope.js'

describe('manual-results list and stats visibility', () => {
  it('includes only caller-local plus global results for ordinary admins', () => {
    assert.deepEqual(sportsResultReadScope({ tenant: 'a', whitelabel: { id: 'a' }, user: { roles: ['Whitelabel Admin'] } }), { tenant: 'a', whitelabelId: 'a', includeGlobal: true })
  })
  it('restricts Super Admin core to global results and retains the whitelabel workspace exclusion', () => {
    assert.deepEqual(sportsResultReadScope({ tenant: 'a', directorMode: 'core', user: { roles: ['Super Admin'] } }), { tenant: 'default', whitelabelId: 'default', isGlobal: true })
    assert.equal(sportsResultReadScope({ tenant: 'a', directorMode: 'whitelabel', user: { roles: ['Super Admin'] } }), null)
  })
})
