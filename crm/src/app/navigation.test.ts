import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { NAV, landingPath, visibleNav } from '@/app/navigation'
import { can, isIdleExpired, type CrmMe, type CrmPermissionPair } from '@/state/auth'

/** A signed-in user holding exactly the permissions given. */
function user(permissions: CrmPermissionPair[]): CrmMe {
  return {
    id: '1',
    name: 'Test Agent',
    email: null,
    status: 'ACTIVE',
    requirePasswordReset: false,
    tenant: 'default',
    whitelabelName: null,
    permissions,
    bookIds: [],
    canViewAllPlayers: false,
    sessionIdleMinutes: 60,
    outOfOfficeUntil: null,
    delegateTo: null,
  }
}

describe('landingPath', () => {
  test('sends a user to the first screen they can open, not to a fixed path', () => {
    // The defect this replaces: every refusal redirected to /players, which is
    // itself gated. Someone who may read the security log but not the player
    // list landed on a screen the server refuses, with no nav and no message.
    const securityOnly = user([{ domain: 'crm.security', actions: ['view'] }])
    assert.equal(landingPath(securityOnly), '/security')
    assert.notEqual(landingPath(securityOnly), '/players')
  })

  test('returns null when the account can open nothing, so the router can say so', () => {
    // Reachable: every screen's permission is grantable, so a role can be saved
    // with none of them. null drives a message; a path would drive a loop.
    assert.equal(landingPath(user([])), null)
    assert.equal(landingPath(user([{ domain: 'crm.notes', actions: ['view'] }])), null)
  })

  test('has no landing screen before sign-in', () => {
    assert.equal(landingPath(null), null)
  })

  test('follows nav order rather than permission order', () => {
    // Queue sits above Books in the sidebar, so it wins regardless of how the
    // permissions happen to be ordered on the role.
    const both = user([
      { domain: 'crm.books', actions: ['view'] },
      { domain: 'crm.tasks', actions: ['view'] },
    ])
    assert.equal(landingPath(both), '/queue')
  })

  test('honours a wildcard action', () => {
    assert.equal(landingPath(user([{ domain: 'crm.players', actions: ['*'] }])), '/players')
  })

  test('never returns a screen the same user would be refused', () => {
    // The property that makes redirecting safe. A landing path the user cannot
    // pass would bounce straight back into the guard that sent them there.
    // Checked over every single-permission role the nav can express, plus the
    // full set and the empty one.
    const roles: CrmPermissionPair[][] = [
      [],
      NAV.map((n) => ({ domain: n.domain, actions: [n.action] })),
      ...NAV.map((n) => [{ domain: n.domain, actions: [n.action] }]),
    ]

    for (const permissions of roles) {
      const me = user(permissions)
      const home = landingPath(me)
      if (home === null) {
        assert.equal(visibleNav(me).length, 0, 'null landing path but screens are visible')
        continue
      }
      const entry = NAV.find((n) => n.path === home)
      if (!entry) {
        assert.fail(`landing path ${home} is not a nav entry`)
      }
      assert.ok(
        can(me, entry.domain, entry.action),
        `landing path ${home} demands ${entry.domain}:${entry.action}, which this user lacks`
      )
    }
  })
})

describe('visibleNav', () => {
  test('shows only what the user holds', () => {
    const me = user([
      { domain: 'crm.players', actions: ['view'] },
      { domain: 'crm.tasks', actions: ['view'] },
    ])
    // One permission, two screens: Queue and Desk health share crm.tasks:view.
    assert.deepEqual(
      visibleNav(me).map((n) => n.path),
      ['/players', '/queue', '/desk-health']
    )
  })

  test('is empty for a signed-out visitor', () => {
    assert.deepEqual(visibleNav(null), [])
  })

  test('every entry names a distinct path', () => {
    // Two entries on one path would make the sidebar highlight ambiguous and
    // landingPath order-dependent in a way nothing else would reveal.
    assert.equal(new Set(NAV.map((n) => n.path)).size, NAV.length)
  })
})

describe('can', () => {
  test('matches an exact domain and action', () => {
    assert.equal(can(user([{ domain: 'crm.books', actions: ['view'] }]), 'crm.books', 'view'), true)
  })

  test('a wildcard covers any action in that domain only', () => {
    const me = user([{ domain: 'crm.books', actions: ['*'] }])
    assert.equal(can(me, 'crm.books', 'manage'), true)
    assert.equal(can(me, 'crm.users', 'manage'), false, 'a wildcard must not cross domains')
  })

  test('refuses an unheld action, an unknown domain, and a signed-out user', () => {
    const me = user([{ domain: 'crm.books', actions: ['view'] }])
    assert.equal(can(me, 'crm.books', 'manage'), false)
    assert.equal(can(me, 'crm.nonexistent', 'view'), false)
    assert.equal(can(null, 'crm.books', 'view'), false)
  })
})

describe('isIdleExpired', () => {
  const minutesAgo = (m: number) => Date.now() - m * 60_000

  test('expires a session past the whitelabel window', () => {
    const me = user([])
    me.sessionIdleMinutes = 30
    assert.equal(isIdleExpired({ me, lastActivityAt: minutesAgo(31) }), true)
    assert.equal(isIdleExpired({ me, lastActivityAt: minutesAgo(29) }), false)
  })

  test('falls back to 60 minutes when the whitelabel sets none', () => {
    // `|| 60` means 0 is treated as unset rather than as "expire instantly",
    // which is the safe reading: a misconfigured whitelabel should not sign
    // everybody out on their next keystroke.
    const me = user([])
    me.sessionIdleMinutes = 0
    assert.equal(isIdleExpired({ me, lastActivityAt: minutesAgo(59) }), false)
    assert.equal(isIdleExpired({ me, lastActivityAt: minutesAgo(61) }), true)
  })

  test('a signed-out visitor is never idle-expired', () => {
    assert.equal(isIdleExpired({ me: null, lastActivityAt: minutesAgo(10_000) }), false)
  })
})
