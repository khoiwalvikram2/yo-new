/**
 * The Audit Trail's "View Resource" and "View Profile" links (SYS-14). Most of them pointed at addresses no route
 * serves (/whitelabels/:id, /admins/:id, /sports/events/:id, /transactions/...), and each opened "Something went
 * wrong". Every link is checked here against the router's own table: a link exists only where a page does.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { matchRoutes } from 'react-router-dom'
import { routes } from '@/app/router'
import { getActorNavigationPath, getResourceNavigationPath } from './resourceNavigation'

/** Whether a real route (not the not-found catch-all) serves this address. */
function served(path: string): boolean {
  const leaf = matchRoutes(routes, path.split('?')[0])?.at(-1)?.route
  return Boolean(leaf && leaf.path !== '*')
}

// The resource types the trail records that have a page (or a list) of their own.
const LINKED_TYPES = [
  'user', 'player', 'agent', 'event', 'matka', 'role', 'whitelabel', 'AppConfig', 'Advertisement',
  'deposit_request', 'withdrawal_request', 'sports_result', 'matkaResult', 'bonus_award',
]
const UUID = '726fc97a-cf23-4e5c-98d3-64a51e2a2a7e'
/** An id of the shape each type's rows record: serial players, roles and bonuses, uuid agents, events and matkas, a
 *  whitelabel's slug; a type that opens a list takes whatever its rows hold. */
function realId(type: string): string {
  if (['user', 'player', 'role', 'bonus'].includes(type)) return '746'
  if (['agent', 'event', 'matka'].includes(type)) return UUID
  return 'grandwinn-com'
}

describe('a resource links to a page the router serves', () => {
  test.each(LINKED_TYPES)('%s', (type) => {
    const nav = getResourceNavigationPath(type, realId(type))
    assert.equal(nav.available, true, `${type} has no link`)
    assert.ok(served(nav.path), `${type} links to ${nav.path}, which no route serves`)
  })

  test('an admin account in users.security opens Support Admins, not a player profile that cannot show it', () => {
    // 1,806 of 2,329 users.security "user" rows name an admin (its sign-ins, session checks, create/delete).
    for (const action of ['login', 'login_failed', 'cross_tenant_access_blocked', 'tenant_switch_blocked', 'unauthorized_admin_mode_header',
      'invalid_user_tenant', 'ip_blocked', 'change_password', 'create_support_admin', 'delete_support_admin']) {
      const nav = getResourceNavigationPath('user', '2', { domain: 'users.security', action })
      assert.deepEqual(nav, { available: true, path: '/security/support-admins' }, action)
      assert.ok(served(nav.path))
    }
    // Even when the failed sign-in names the email that was typed.
    assert.equal(getResourceNavigationPath('user', 'someone@example.invalid', { domain: 'users.security', action: 'login_failed' }).path, '/security/support-admins')
  })

  test('a player stays on the profile: player sign-ins, and account actions that name a player or an admin alike', () => {
    assert.equal(getResourceNavigationPath('user', '746', { domain: 'players', action: 'login' }).path, '/players/profile/746')
    // A player's own password change (user-backend) is recorded under 'players'; admin-backend's under users.security.
    assert.equal(getResourceNavigationPath('user', '746', { domain: 'players', action: 'change_password' }).path, '/players/profile/746')
    for (const action of ['deactivate_user', 'reactivate_user', 'suspend_user', 'require_password_reset', 'clear_password_reset', 'force_logout']) {
      assert.equal(getResourceNavigationPath('user', '746', { domain: 'users.security', action }).path, '/players/profile/746', action)
    }
    // With no event (an older caller) the profile link is kept.
    assert.equal(getResourceNavigationPath('user', '746').path, '/players/profile/746')
  })

  test('a row that records the kind of account it names (after.accountKind) is routed by it', () => {
    // Status, password-reset and force-logout name a player or a support admin alike; new rows say which.
    for (const action of ['deactivate_user', 'reactivate_user', 'suspend_user', 'require_password_reset', 'clear_password_reset', 'force_logout']) {
      const admin = getResourceNavigationPath('user', '2', { domain: 'users.security', action, after: { status: 'INACTIVE', accountKind: 'admin' } })
      assert.deepEqual(admin, { available: true, path: '/security/support-admins' }, action)
      assert.ok(served(admin.path))
      const player = getResourceNavigationPath('user', '746', { domain: 'users.security', action, after: { accountKind: 'player' } })
      assert.deepEqual(player, { available: true, path: '/players/profile/746' }, action)
    }
    // The admin sign-in looks accounts up across tenants, so a failed one can name a player's account.
    assert.equal(getResourceNavigationPath('user', '746', { domain: 'users.security', action: 'login_failed', after: { success: false, accountKind: 'player' } }).path,
      '/players/profile/746')
    assert.equal(getResourceNavigationPath('user', '2', { domain: 'users.security', action: 'login', after: { success: true, accountKind: 'admin' } }).path,
      '/security/support-admins')
    // A whitelabel admin's password reset is recorded under whitelabel.security; it names that admin.
    assert.equal(getResourceNavigationPath('user', '648', { domain: 'whitelabel.security', action: 'reset_whitelabel_admin_password', after: { passwordReset: true, accountKind: 'admin' } }).path,
      '/security/support-admins')
  })

  test('a row without a recognised accountKind keeps the old rule', () => {
    // Older rows: no after, an after without the key, or a value that is not one of the two kinds.
    for (const after of [undefined, null, {}, { accountKind: 'agent' }, { accountKind: 1 }, 'admin']) {
      assert.equal(getResourceNavigationPath('user', '746', { domain: 'users.security', action: 'force_logout', after }).path, '/players/profile/746', JSON.stringify(after))
      assert.equal(getResourceNavigationPath('user', '2', { domain: 'users.security', action: 'login_failed', after }).path, '/security/support-admins', JSON.stringify(after))
    }
    // Only a "user" is ambiguous: a "player" row stays a player whatever it records.
    assert.equal(getResourceNavigationPath('player', '746', { domain: 'players', action: 'set_withdrawal_lock', after: { accountKind: 'admin' } }).path, '/players/profile/746')
  })

  test('a "user" or "player" with no numeric id gets no link (the profile can only say "Invalid player ID")', () => {
    assert.equal(getResourceNavigationPath('user', 'unknown', { domain: 'players', action: 'login_failed' }).available, false)
    assert.equal(getResourceNavigationPath('player', 'player-1').available, false)
    assert.equal(getResourceNavigationPath('user', '12a').available, false)
  })

  test('the ones with no page get no link', () => {
    for (const type of ['market', 'league', 'sport', 'casino_bet', 'bet', 'commission_payout', 'user_role', 'tenant', 'transaction', 'wallet']) {
      assert.equal(getResourceNavigationPath(type, '42').available, false, type)
    }
  })

  test('a whitelabel opens its App Configuration, named by id', () => {
    assert.equal(getResourceNavigationPath('whitelabel', 'grandwinn-com').path, '/config/app-configuration?whitelabelId=grandwinn-com')
    assert.equal(getResourceNavigationPath('event', 'ca9ada1a-5b3e-4f7c-9d21-0e8b6a4c2f10').path, '/sports/event/ca9ada1a-5b3e-4f7c-9d21-0e8b6a4c2f10')
  })
})

/* N005 (SYS-14 follow-up): a matka reorder records '*' and a permanent delete 'bulk' as its resource id (events 28231
   and 24806 in grandwinn). Both still got View Resource, which opened /matka/* and Matka Details' "Failed to load".
   A link is offered only for an id that can name a resource of its type. */
describe('a resource id that names no one resource gets no link', () => {
  test('the matka events the trail records with "*" and "bulk"', () => {
    assert.deepEqual(getResourceNavigationPath('matka', '*', { domain: 'matka', action: 'reorder' }), { available: false, path: '' })
    assert.deepEqual(getResourceNavigationPath('matka', 'bulk', { domain: 'matka', action: 'permanent_delete' }), { available: false, path: '' })
    assert.equal(getResourceNavigationPath('matka', UUID).path, `/matka/${UUID}`, 'a real matka keeps its link')
  })

  test.each(LINKED_TYPES)('%s: no id, a blank one or a bulk marker', (type) => {
    for (const id of ['', '   ', '*', 'bulk', 'BULK', 'all']) {
      assert.equal(getResourceNavigationPath(type, id).available, false, `${type} "${id}"`)
    }
  })

  test('an id of the wrong shape for its page', () => {
    // A failed agent sign-in records the username (or number) that was typed, not an agent.
    for (const id of ['vfydas_nouser_mvzkohp1', 'admin.kondareddi.com', '9999999999']) {
      assert.equal(getResourceNavigationPath('agent', id, { domain: 'agents', action: 'login_failed' }).available, false, id)
    }
    assert.equal(getResourceNavigationPath('agent', UUID).path, `/agents/${UUID}`)
    for (const type of ['event', 'matka']) assert.equal(getResourceNavigationPath(type, '42').available, false, type)
    for (const type of ['role', 'bonus']) assert.equal(getResourceNavigationPath(type, UUID).available, false, type)
    for (const id of ['grandwinn com', '-grandwinn', '../x']) assert.equal(getResourceNavigationPath('whitelabel', id).available, false, id)
  })

  test('a type whose link opens a list keeps it whatever id its row holds', () => {
    assert.deepEqual(getResourceNavigationPath('deposit_request', '1143'), { available: true, path: '/payments/deposits' })
    assert.deepEqual(getResourceNavigationPath('AppConfig', 'grandwinn-com'), { available: true, path: '/config/app-configuration' })
    assert.deepEqual(getResourceNavigationPath('matkaResult', UUID), { available: true, path: '/matka/results' })
  })
})

/* B008 (SYS-14 follow-up): 'bonus' is written only by revokePlayerBonus, whose resourceId is the bonus AWARD's id and
   whose after is { awardId, userId, amount }. It linked to /bonuses/<award id>, a campaign page, which showed the wrong
   campaign or none. The award is on its player's profile, the one after.userId names. */
describe('a revoked bonus links to its player, never to a campaign', () => {
  const revoke = (after: unknown) => ({ domain: 'players', action: 'revoke_bonus', after })

  test('the row records the player: open that profile', () => {
    for (const userId of [746, '746']) {
      const nav = getResourceNavigationPath('bonus', '31', revoke({ awardId: 31, userId, amount: '50.00' }))
      assert.deepEqual(nav, { available: true, path: '/players/profile/746' }, String(userId))
      assert.ok(served(nav.path))
    }
  })

  test('without the player there is no link (the award id names no page)', () => {
    for (const after of [undefined, null, {}, { awardId: 31 }, { userId: 'abc' }, { userId: 0 }, { userId: -4 }, { userId: 1.5 }, { userId: [746] }, '746']) {
      assert.deepEqual(getResourceNavigationPath('bonus', '31', revoke(after)), { available: false, path: '' }, JSON.stringify(after))
    }
    assert.equal(getResourceNavigationPath('bonus', '31').available, false, 'an older caller with no event')
  })

  test('an award id that is not one, or a bulk marker, still gets no link', () => {
    for (const id of [UUID, '', '*', 'bulk']) {
      assert.equal(getResourceNavigationPath('bonus', id, revoke({ awardId: 31, userId: 746 })).available, false, id)
    }
  })
})

describe('an actor links to where it can be seen', () => {
  test.each(['admin', 'player', 'agent'])('%s', (type) => {
    const nav = getActorNavigationPath(type, '2')
    assert.equal(nav.available, true)
    assert.ok(served(nav.path), `${type} links to ${nav.path}, which no route serves`)
  })

  test('an admin opens Support Admins, not a profile address nothing serves', () => {
    assert.equal(getActorNavigationPath('admin', '2').path, '/security/support-admins')
  })

  test('a deleted, system or unknown actor gets no link', () => {
    for (const type of ['deleted', 'system', 'unknown']) assert.equal(getActorNavigationPath(type, '2047').available, false, type)
  })
})
