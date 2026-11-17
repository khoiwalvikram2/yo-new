/**
 * What the admin surface answers a caller whose token was refused, an admin who must change its password, and an
 * agent asking for an admin-only read (domains/crmSurfaceGuard.ts).
 *
 * Measured before: a suspended agent's open tab got "Forbidden: insufficient permissions to access agents" and
 * kept navigating until a reload (SCO-08); a whitelabel admin naming another tenant got a bare HTTP 500 (SCO-10);
 * Reset Password changed nothing (SYS-08); a sub-agent read matka configuration, Snapshot Health and any player's
 * phone number through movePlayerToAgentPreCheck (SCO-05).
 *
 * No database required: the guard decides before any resolver runs.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { guardAdminSurface, PASSWORD_CHANGE_REQUIRED_MESSAGE } from '../../crmSurfaceGuard.js'
import { AGENT_EXCLUDED_OPERATIONS } from '../agentExcludedOperations.js'

const SESSION_ENDED = 'Unauthorized: session invalid. Please sign in again.'
const revoked = { authRejected: { reason: 'session_ended', message: SESSION_ENDED } }
const otherTenant = {
  authRejected: { reason: 'access_denied', message: 'Access denied: Whitelabel Admins can only access their own tenant' },
}
const mustChangePassword = {
  user: { sub: '42', type: 'admin', roles: ['Support'] },
  permissions: [],
  passwordChangeRequired: true,
}
const agent = { user: { sub: 'a1', type: 'agent', agentId: 'a1' }, permissions: [{ domain: 'matka', actions: ['read'] }] }
const admin = { user: { sub: '2', type: 'admin', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'matka', actions: ['read'] }] }

const as = (root: 'Query' | 'Mutation', fieldName: string) => ({ parentType: { name: root }, fieldName })

describe('a refused token gets one answer on every admin field', () => {
  const map = guardAdminSurface({
    usersPage: () => 'ran',
    agents: () => 'ran',
    health: () => 'ok',
    whitelabelCurrent: () => 'brand',
    whitelabel: () => 'brand',
    login: () => 'token',
    logout: () => 'bye',
  })

  it('ends the session on an ordinary field, in words the panel treats as "Session ended"', () => {
    assert.throws(() => map.usersPage(undefined, {}, revoked, as('Query', 'usersPage')), /session invalid/)
    // admin/src/shared/core/api.ts ends the session on these and not on a permission error.
    assert.match(SESSION_ENDED, /token invalid|session invalid|token expired/)
    assert.doesNotMatch(SESSION_ENDED, /insufficient permissions|permission denied|not allowed|forbidden.*permissions/i)
    assert.doesNotMatch(SESSION_ENDED, /account is suspended|account is blocked|account is not active/i)
  })

  it('refuses the agent read namespace but still lets the owner sign in, and out, again', () => {
    // Query.agents is the agent reads; Mutation.agents is where agentLogin lives.
    assert.throws(() => map.agents(undefined, {}, revoked, as('Query', 'agents')), /session invalid/)
    assert.equal(map.agents(undefined, {}, revoked, as('Mutation', 'agents')), 'ran')
    assert.equal(map.login(undefined, {}, revoked, as('Mutation', 'login')), 'token')
    assert.equal(map.logout(undefined, {}, revoked, as('Mutation', 'logout')), 'bye')
  })

  it('still serves liveness and the sign-in page branding', () => {
    assert.equal(map.health(undefined, {}, revoked, as('Query', 'health')), 'ok')
    assert.equal(map.whitelabelCurrent(undefined, {}, revoked, as('Query', 'whitelabelCurrent')), 'brand')
    assert.equal(map.whitelabel(undefined, {}, revoked, as('Query', 'whitelabel')), 'brand')
  })

  it('refuses when it cannot tell which root the field is on', () => {
    assert.throws(() => map.login(undefined, {}, revoked, undefined), /session invalid/)
  })

  it('names the reason for a session used from the wrong tenant', () => {
    assert.throws(
      () => map.usersPage(undefined, {}, otherTenant, as('Query', 'usersPage')),
      /Access denied: Whitelabel Admins can only access their own tenant/
    )
  })

  it('leaves a caller who sent no token to the resolver, as before', () => {
    assert.equal(map.usersPage(undefined, {}, {}, as('Query', 'usersPage')), 'ran')
  })
})

describe('an admin who must change its password may do only that', () => {
  const map = guardAdminSurface({
    usersPage: () => 'ran',
    changeAdminPassword: async () => ({ success: false, message: 'Current password is incorrect' }),
    logout: () => 'bye',
  })

  it('refuses everything else with a message that is neither "session ended" nor a permission error', () => {
    assert.throws(() => map.usersPage(undefined, {}, mustChangePassword, as('Query', 'usersPage')), /Password change required/)
    assert.doesNotMatch(PASSWORD_CHANGE_REQUIRED_MESSAGE, /token invalid|session invalid|token expired|authentication required|not authenticated/i)
    assert.doesNotMatch(PASSWORD_CHANGE_REQUIRED_MESSAGE, /insufficient permissions|permission denied|not allowed/i)
  })

  it('lets the password change and sign-out through', async () => {
    const out = await map.changeAdminPassword(undefined, {}, mustChangePassword, as('Mutation', 'changeAdminPassword'))
    assert.deepEqual(out, { success: false, message: 'Current password is incorrect' })
    assert.equal(map.logout(undefined, {}, mustChangePassword, as('Mutation', 'logout')), 'bye')
  })
})

describe('an agent is refused the admin-only reads its flat grants would open', () => {
  const names = Object.keys(AGENT_EXCLUDED_OPERATIONS)
  const map = guardAdminSurface(Object.fromEntries([...names, 'matkas'].map((n) => [n, () => 'ran'])))

  it('lists the reads SCO-05 measured', () => {
    for (const n of ['matka', 'matkasExportCSV', 'matkaDefaultRates', 'snapshotRuns', 'snapshotPgBossOverview', 'sportsResultStats', 'casinoVendorsWithSettings', 'movePlayerToAgentPreCheck']) {
      assert.ok(names.includes(n), `${n} is not on the agent exclusion list`)
    }
  })

  it('refuses an agent on every one of them, before the resolver runs', () => {
    for (const n of names) {
      assert.throws(() => (map as any)[n](undefined, {}, agent, as('Query', n)), /not available to agents/, n)
    }
  })

  it('leaves the admin who holds the same flats alone, and the agent its own reads', () => {
    for (const n of names) assert.equal((map as any)[n](undefined, {}, admin, as('Query', n)), 'ran', n)
    // `matkas` lists markets for agent screens too, which is why matka.management:view could not simply be denied.
    assert.equal((map as any).matkas(undefined, {}, agent, as('Query', 'matkas')), 'ran')
  })
})
