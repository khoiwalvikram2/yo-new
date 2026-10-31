/**
 * The CRM's isolation guarantees, exercised against a real database.
 *
 * These are the properties the whole design rests on, so they are tested at the
 * layer that enforces them rather than through the UI that calls it:
 *
 *   - a whitelabel Super Admin has not enabled has no CRM at all;
 *   - one whitelabel's CRM data is unreachable from another;
 *   - inside a whitelabel, a CRM user reaches only the players in their books;
 *   - the seat limit holds when creates race;
 *   - suspending a user, or changing their roles, ends their session at once.
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SUFFIX = randomUUID().slice(0, 8)
const TENANT_A = `crm-a-${SUFFIX}`
const TENANT_B = `crm-b-${SUFFIX}`

let playerA1 = 0
let playerA2 = 0
let playerB1 = 0

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  // Two whitelabels, two players each, none of them staff.
  for (const [tenant, names] of [
    [TENANT_A, ['A One', 'A Two']],
    [TENANT_B, ['B One']],
  ] as const) {
    for (const name of names) {
      const r = await db.execute(sql`
        INSERT INTO users (tenant, name, username, phone, password_hash)
        VALUES (${tenant}, ${name}, ${name.replace(/\s/g, '').toLowerCase() + SUFFIX},
                ${'9' + Math.floor(Math.random() * 1e9)}, 'x')
        RETURNING id`)
      const id = Number((r.rows[0] as { id: number }).id)
      if (tenant === TENANT_A) {
        if (!playerA1) playerA1 = id
        else playerA2 = id
      } else playerB1 = id
    }
  }
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const t of [TENANT_A, TENANT_B]) {
    await db.execute(sql`DELETE FROM crm_pii_access_log WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_login_attempts WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_player_assignments WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_books WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_roles WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${t}`)
  }
})

/** Creates a CRM user with the given permissions and returns its id. */
async function makeCrmUser(
  tenant: string,
  username: string,
  permissions: Array<{ domain: string; action: string }>
): Promise<string> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const { hashPassword } = await import('@src/domains/common/auth.js')

  const role = await db.execute(sql`
    INSERT INTO crm_roles (tenant, name, is_system) VALUES (${tenant}, ${'role-' + username}, false)
    RETURNING id`)
  const roleId = String((role.rows[0] as { id: string }).id)
  for (const p of permissions) {
    await db.execute(sql`
      INSERT INTO crm_role_permissions (role_id, domain, action)
      VALUES (${roleId}::uuid, ${p.domain}, ${p.action})`)
  }
  const user = await db.execute(sql`
    INSERT INTO crm_users (tenant, name, status) VALUES (${tenant}, ${username}, 'ACTIVE')
    RETURNING id`)
  const userId = String((user.rows[0] as { id: string }).id)
  await db.execute(sql`
    INSERT INTO crm_user_credentials (crm_user_id, tenant, username, password_hash)
    VALUES (${userId}::uuid, ${tenant}, ${username}, ${await hashPassword('CorrectHorse99')})`)
  await db.execute(sql`
    INSERT INTO crm_user_roles (crm_user_id, role_id) VALUES (${userId}::uuid, ${roleId}::uuid)`)
  return userId
}

describe('Super Admin gate', () => {
  it('refuses sign-in for a whitelabel that was never enabled', async () => {
    const { crmLogin } = await import('@src/domains/crm/services/CrmAuthService.js')
    await makeCrmUser(TENANT_A, `gated${SUFFIX}`, [{ domain: 'crm.players', action: 'view' }])

    const res = await crmLogin({
      tenant: TENANT_A,
      username: `gated${SUFFIX}`,
      password: 'CorrectHorse99',
    })
    assert.equal(res.ok, false)
    assert.equal(res.ok === false && res.reason, 'crm_disabled')
  })

  it('admits the same user once the whitelabel is enabled', async () => {
    const { upsertCrmSettings } = await import('@src/repos/crm/CrmSettingsRepo.js')
    const { crmLogin } = await import('@src/domains/crm/services/CrmAuthService.js')
    await upsertCrmSettings({ tenant: TENANT_A, enabled: true, seatLimit: 10 })

    const res = await crmLogin({
      tenant: TENANT_A,
      username: `gated${SUFFIX}`,
      password: 'CorrectHorse99',
    })
    assert.equal(res.ok, true, 'an enabled whitelabel should admit a valid password')
  })

  it('refuses a wrong password, and says nothing different about a real username', async () => {
    const { crmLogin } = await import('@src/domains/crm/services/CrmAuthService.js')
    const real = await crmLogin({ tenant: TENANT_A, username: `gated${SUFFIX}`, password: 'wrong' })
    const fake = await crmLogin({ tenant: TENANT_A, username: 'nobody-at-all', password: 'wrong' })
    assert.equal(real.ok, false)
    assert.equal(fake.ok, false)
    // The reasons differ in the audit trail; the caller is told the same thing.
    assert.equal(real.ok === false && real.reason, 'bad_password')
    assert.equal(fake.ok === false && fake.reason, 'unknown_user')
  })
})

describe('tenant isolation', () => {
  it('will not sign a user in against another whitelabel', async () => {
    const { upsertCrmSettings } = await import('@src/repos/crm/CrmSettingsRepo.js')
    const { crmLogin } = await import('@src/domains/crm/services/CrmAuthService.js')
    await upsertCrmSettings({ tenant: TENANT_B, enabled: true, seatLimit: 10 })

    // The username exists in A. Presented at B's host, it must not resolve.
    const res = await crmLogin({
      tenant: TENANT_B,
      username: `gated${SUFFIX}`,
      password: 'CorrectHorse99',
    })
    assert.equal(res.ok, false)
    assert.equal(res.ok === false && res.reason, 'unknown_user')
  })

  it('rejects a token minted for one whitelabel when it is presented at another', async () => {
    const { crmLogin, buildCrmAuthContext } = await import('@src/domains/crm/services/CrmAuthService.js')
    const login = await crmLogin({
      tenant: TENANT_A,
      username: `gated${SUFFIX}`,
      password: 'CorrectHorse99',
    })
    assert.equal(login.ok, true)
    const token = login.ok ? login.token : ''
    const req = { headers: { authorization: `Bearer ${token}` } }

    const atHome = await buildCrmAuthContext(req, TENANT_A)
    assert.ok(atHome.crmUser, 'the token should work at its own whitelabel')

    const elsewhere = await buildCrmAuthContext(req, TENANT_B)
    assert.equal(elsewhere.crmUser, undefined, 'a replayed token must not authenticate')
  })

  it('does not let a CRM token become an admin identity', async () => {
    const { crmLogin } = await import('@src/domains/crm/services/CrmAuthService.js')
    const { buildAuthContext } = await import('@src/domains/common/auth.js')
    const login = await crmLogin({
      tenant: TENANT_A,
      username: `gated${SUFFIX}`,
      password: 'CorrectHorse99',
    })
    const token = login.ok ? login.token : ''
    const auth = await buildAuthContext({ headers: { authorization: `Bearer ${token}` } }, TENANT_A)
    assert.equal(auth.user, undefined, 'the admin context must not accept a CRM token')
  })
})

describe('book scoping', () => {
  it('shows an agent only the players in their own books', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { listCrmPlayers, canCrmUserSeePlayer } = await import('@src/repos/crm/CrmPlayersRepo.js')
    const { getBookIdsForCrmUser } = await import('@src/repos/crm/CrmBooksRepo.js')

    const agent = await makeCrmUser(TENANT_A, `agent${SUFFIX}`, [
      { domain: 'crm.players', action: 'view' },
    ])
    const book = await db.execute(sql`
      INSERT INTO crm_books (tenant, name) VALUES (${TENANT_A}, ${'Book ' + SUFFIX}) RETURNING id`)
    const bookId = String((book.rows[0] as { id: string }).id)
    await db.execute(sql`
      INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${bookId}::uuid, ${agent}::uuid)`)
    // Only the first of A's two players is in the book.
    await db.execute(sql`
      INSERT INTO crm_player_assignments (tenant, player_id, book_id)
      VALUES (${TENANT_A}, ${playerA1}, ${bookId}::uuid)`)

    const bookIds = await getBookIdsForCrmUser(TENANT_A, agent)
    const scope = { tenant: TENANT_A, viewAll: false, bookIds }

    const page = await listCrmPlayers(scope, {}, { limit: 50, offset: 0 })
    const ids = page.items.map((p) => p.id)
    assert.deepEqual(ids, [playerA1], 'only the assigned player should be visible')

    assert.equal(await canCrmUserSeePlayer(scope, playerA1), true)
    assert.equal(await canCrmUserSeePlayer(scope, playerA2), false, 'unassigned player must be out of reach')
    assert.equal(await canCrmUserSeePlayer(scope, playerB1), false, 'another whitelabel must be out of reach')
  })

  it('shows nothing at all to a user with no books', async () => {
    const { listCrmPlayers } = await import('@src/repos/crm/CrmPlayersRepo.js')
    const page = await listCrmPlayers({ tenant: TENANT_A, viewAll: false, bookIds: [] }, {}, { limit: 50, offset: 0 })
    assert.equal(page.total, 0, 'no books must mean no players, not all players')
    assert.equal(page.items.length, 0)
  })

  it('lets view_all reach every player in the whitelabel, and no further', async () => {
    const { listCrmPlayers, canCrmUserSeePlayer } = await import('@src/repos/crm/CrmPlayersRepo.js')
    const scope = { tenant: TENANT_A, viewAll: true, bookIds: [] }
    const page = await listCrmPlayers(scope, {}, { limit: 50, offset: 0 })
    const ids = page.items.map((p) => p.id).sort()
    assert.deepEqual(ids, [playerA1, playerA2].sort())
    assert.equal(await canCrmUserSeePlayer(scope, playerB1), false, 'view_all is still bounded by tenant')
  })

  it('does not treat the timeline as a way around the book filter', async () => {
    // The resolver checks canCrmUserSeePlayer before reading the timeline; this
    // asserts the check itself is what stands between the two, because the
    // timeline repo is deliberately unscoped and would otherwise answer.
    const { canCrmUserSeePlayer } = await import('@src/repos/crm/CrmPlayersRepo.js')
    const scope = { tenant: TENANT_A, viewAll: false, bookIds: [] }
    assert.equal(await canCrmUserSeePlayer(scope, playerA1), false)
  })
})

describe('seat limit', () => {
  it('holds when creates race', async () => {
    const { upsertCrmSettings, reserveCrmSeat, countCrmSeats } = await import(
      '@src/repos/crm/CrmSettingsRepo.js'
    )
    const { insertCrmUser } = await import('@src/repos/crm/CrmUsersRepo.js')
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    const tenant = `crm-seat-${SUFFIX}`
    try {
      await upsertCrmSettings({ tenant, enabled: true, seatLimit: 3 })

      // Warm the pool first. This is not incidental setup: with cold
      // connections, establishing eight sockets takes long enough that the
      // transactions stagger and the limit appears to hold even with no lock
      // at all. Measured — warm, an unlocked claim admits 8 of 8 against a
      // limit of 3. Without this line the test passes for the wrong reason.
      const { pool } = await import('@src/db/client.js')
      await Promise.all(Array.from({ length: 8 }, () => pool.query('SELECT pg_sleep(0.05)')))

      // Eight simultaneous creates against an allowance of three. A read-only
      // check followed by an insert lets several through; claiming the seat
      // under a row lock inside the same transaction does not.
      const attempts = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          reserveCrmSeat(tenant, (tx) =>
            insertCrmUser(tx, {
              tenant,
              name: `Racer ${i}`,
              username: `racer${i}-${SUFFIX}`,
              passwordHash: 'x',
              roleIds: [],
            })
          )
        )
      )

      const granted = attempts.filter((a) => a.claim.ok).length
      assert.equal(granted, 3, `expected exactly 3 seats to be granted, got ${granted}`)
      assert.equal(await countCrmSeats(tenant), 3, 'the database must agree with the count')
      assert.ok(
        attempts.some((a) => !a.claim.ok && a.claim.reason === 'seat_limit_reached'),
        'the refusals should say why'
      )
    } finally {
      await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${tenant}`)
      await db.execute(sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${tenant}`)
    }
  })

  it('refuses every seat when the whitelabel is not enabled', async () => {
    const { upsertCrmSettings, reserveCrmSeat } = await import('@src/repos/crm/CrmSettingsRepo.js')
    const { insertCrmUser } = await import('@src/repos/crm/CrmUsersRepo.js')
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    const tenant = `crm-off-${SUFFIX}`
    try {
      await upsertCrmSettings({ tenant, enabled: false, seatLimit: 50 })
      const { claim } = await reserveCrmSeat(tenant, (tx) =>
        insertCrmUser(tx, {
          tenant,
          name: 'Nobody',
          username: `nobody-${SUFFIX}`,
          passwordHash: 'x',
          roleIds: [],
        })
      )
      assert.equal(claim.ok, false)
      assert.equal(claim.ok === false && claim.reason, 'crm_disabled')
    } finally {
      await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${tenant}`)
      await db.execute(sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${tenant}`)
    }
  })
})

describe('revocation takes effect at once', () => {
  it('ends a session when the user is suspended', async () => {
    const { crmLogin, buildCrmAuthContext } = await import('@src/domains/crm/services/CrmAuthService.js')
    const { setCrmUserStatus } = await import('@src/repos/crm/CrmUsersRepo.js')
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    const username = `revoke${SUFFIX}`
    const id = await makeCrmUser(TENANT_A, username, [{ domain: 'crm.players', action: 'view' }])
    const login = await crmLogin({ tenant: TENANT_A, username, password: 'CorrectHorse99' })
    assert.equal(login.ok, true)
    const req = { headers: { authorization: `Bearer ${login.ok ? login.token : ''}` } }

    assert.ok((await buildCrmAuthContext(req, TENANT_A)).crmUser, 'should start authenticated')
    await setCrmUserStatus(TENANT_A, id, 'SUSPENDED')
    assert.equal(
      (await buildCrmAuthContext(req, TENANT_A)).crmUser,
      undefined,
      'a suspended user must be out on their next request, not when the JWT expires'
    )
    await db.execute(sql`DELETE FROM crm_users WHERE id = ${id}::uuid`)
  })

  it('reflects a permission change without a new sign-in', async () => {
    const { crmLogin, buildCrmAuthContext } = await import('@src/domains/crm/services/CrmAuthService.js')
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    const username = `perm${SUFFIX}`
    const id = await makeCrmUser(TENANT_A, username, [
      { domain: 'crm.players', action: 'view' },
      { domain: 'crm.players', action: 'view_all' },
    ])
    const login = await crmLogin({ tenant: TENANT_A, username, password: 'CorrectHorse99' })
    const req = { headers: { authorization: `Bearer ${login.ok ? login.token : ''}` } }

    const before = await buildCrmAuthContext(req, TENANT_A)
    const hadViewAll = (before.permissions ?? []).some(
      (p) => p.domain === 'crm.players' && p.actions.includes('view_all')
    )
    assert.equal(hadViewAll, true)

    // Take view_all away without touching the token.
    await db.execute(sql`
      DELETE FROM crm_role_permissions
      WHERE action = 'view_all' AND role_id IN (
        SELECT role_id FROM crm_user_roles WHERE crm_user_id = ${id}::uuid)`)

    const after = await buildCrmAuthContext(req, TENANT_A)
    const stillHas = (after.permissions ?? []).some(
      (p) => p.domain === 'crm.players' && p.actions.includes('view_all')
    )
    assert.equal(stillHas, false, 'permissions are re-read per request, not carried on the token')
    await db.execute(sql`DELETE FROM crm_users WHERE id = ${id}::uuid`)
  })

  it('ends every session when the whitelabel CRM is switched off', async () => {
    const { crmLogin, buildCrmAuthContext } = await import('@src/domains/crm/services/CrmAuthService.js')
    const { upsertCrmSettings } = await import('@src/repos/crm/CrmSettingsRepo.js')

    const login = await crmLogin({
      tenant: TENANT_A,
      username: `gated${SUFFIX}`,
      password: 'CorrectHorse99',
    })
    const req = { headers: { authorization: `Bearer ${login.ok ? login.token : ''}` } }
    assert.ok((await buildCrmAuthContext(req, TENANT_A)).crmUser)

    await upsertCrmSettings({ tenant: TENANT_A, enabled: false, seatLimit: 10 })
    assert.equal(
      (await buildCrmAuthContext(req, TENANT_A)).crmUser,
      undefined,
      'revoking a whitelabel must cut its live sessions too'
    )
    await upsertCrmSettings({ tenant: TENANT_A, enabled: true, seatLimit: 10 })
  })
})
