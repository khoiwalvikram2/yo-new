/**
 * Roles, books and the IP allowlist — the rest of the CRM's administrative
 * surface, none of which had a test.
 *
 * Each of these operations refuses in more than one way, and every refusal is a
 * separate thing that can rot: a built-in role that becomes deletable, a role
 * that can be removed while users still hold it, a book that can be deleted out
 * from under its players, an allowlist entry written against another
 * whitelabel's account. All of them fail quietly — the request succeeds and the
 * damage shows up later — so each refusal gets its own assertion.
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-rbs-${randomUUID().slice(0, 8)}`
const OTHER = `crm-rbs-other-${randomUUID().slice(0, 8)}`

let actorId = ''
let plainUserId = ''
let foreignUserId = ''
let systemRoleId = ''
let plainRoleId = ''
let heldRoleId = ''
let foreignRoleId = ''
let bookId = ''
let bookWithPlayers = ''
let foreignBookId = ''
let playerId = 0

const ALL = [
  { domain: 'crm.roles', actions: ['manage'] },
  { domain: 'crm.books', actions: ['manage'] },
  { domain: 'crm.security', actions: ['manage'] },
  { domain: 'crm.players', actions: ['view', 'assign'] },
]

function ctx(userId: string, tenant: string, permissions = ALL, status = 'ACTIVE') {
  return {
    crmUser: { id: userId, name: 'Actor', tenant, status, requirePasswordReset: false },
    permissions,
  } as any
}
const actorCtx = () => ctx(actorId, TENANT)

async function makeRole(tenant: string, label: string, isSystem = false) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`
    INSERT INTO crm_roles (tenant, name, is_system)
    VALUES (${tenant}, ${`${label}-${randomUUID().slice(0, 6)}`}, ${isSystem}) RETURNING id`)
  const id = String((r.rows[0] as { id: string }).id)
  await db.execute(sql`
    INSERT INTO crm_role_permissions (role_id, domain, action)
    VALUES (${id}::uuid, 'crm.players', 'view')`)
  return id
}

async function makeUser(tenant: string, name: string, roleId?: string) {
  const { db } = await import('@src/db/client.js')
  const { insertCrmUser } = await import('@src/repos/crm/CrmUsersRepo.js')
  const { hashCrmPassword } = await import('@src/domains/crm/services/CrmAuthService.js')
  const u = await insertCrmUser(db, {
    tenant,
    name,
    username: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    passwordHash: await hashCrmPassword('Str0ng-Passw0rd!'),
    roleIds: roleId ? [roleId] : [],
  })
  return String(u.id)
}

async function makeBook(tenant: string, name: string) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const b = await db.execute(sql`
    INSERT INTO crm_books (tenant, name) VALUES (${tenant}, ${name}) RETURNING id`)
  return String((b.rows[0] as { id: string }).id)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  systemRoleId = await makeRole(TENANT, 'built-in', true)
  plainRoleId = await makeRole(TENANT, 'plain')
  heldRoleId = await makeRole(TENANT, 'held')
  foreignRoleId = await makeRole(OTHER, 'foreign')

  actorId = await makeUser(TENANT, 'Actor')
  plainUserId = await makeUser(TENANT, 'Holder', heldRoleId)
  foreignUserId = await makeUser(OTHER, 'Foreigner')

  bookId = await makeBook(TENANT, 'Empty Book')
  bookWithPlayers = await makeBook(TENANT, 'Occupied Book')
  foreignBookId = await makeBook(OTHER, 'Foreign Book')

  // A player parked in one of the books, so deletion has something to protect.
  const p = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash)
    VALUES (${TENANT}, 'Test Player', ${`p-${randomUUID().slice(0, 8)}`}, 'active', 'x')
    RETURNING id`)
  playerId = Number((p.rows[0] as { id: number }).id)
  await db.execute(sql`
    INSERT INTO crm_player_assignments (tenant, player_id, book_id)
    VALUES (${TENANT}, ${playerId}, ${bookWithPlayers}::uuid)`)
})

after(async () => {
  // Audited mutations publish through the Redis emitter, which holds the event
  // loop open. See crmUserAdmin.integration.test.ts for the full explanation.
  await new Promise((r) => setTimeout(r, 250))
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()

  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const tenant of [TENANT, OTHER]) {
    await db.execute(sql`DELETE FROM audit_logs WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_ip_allowlist WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_player_assignments WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_book_members WHERE book_id IN (SELECT id FROM crm_books WHERE tenant = ${tenant})`)
    await db.execute(sql`DELETE FROM crm_books WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_user_credentials WHERE crm_user_id IN (SELECT id FROM crm_users WHERE tenant = ${tenant})`)
    await db.execute(sql`DELETE FROM crm_user_roles WHERE crm_user_id IN (SELECT id FROM crm_users WHERE tenant = ${tenant})`)
    await db.execute(sql`DELETE FROM crm_role_permissions WHERE role_id IN (SELECT id FROM crm_roles WHERE tenant = ${tenant})`)
    await db.execute(sql`DELETE FROM crm_roles WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${tenant}`)
  }
})

describe('roles', () => {
  it('needs crm.roles:manage, and an active account', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    await assert.rejects(
      () => crmMutations.crmDeleteRole(null, { id: plainRoleId }, ctx(actorId, TENANT, [])),
      /Forbidden/
    )
    await assert.rejects(
      () => crmMutations.crmDeleteRole(null, { id: plainRoleId }, ctx(actorId, TENANT, ALL, 'INACTIVE')),
      /inactive/i
    )
  })

  it('refuses to delete a built-in role', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmDeleteRole(null, { id: systemRoleId }, actorCtx())
    assert.equal(res.ok, false)
    assert.match(String(res.error), /built in/i)
  })

  it('refuses to delete a role somebody still holds', async () => {
    // Deleting it would strip that user's permissions without anyone choosing to.
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmDeleteRole(null, { id: heldRoleId }, actorCtx())
    assert.equal(res.ok, false)
    assert.match(String(res.error), /before deleting/i)
  })

  it('refuses a role id from another whitelabel', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    assert.equal((await crmMutations.crmDeleteRole(null, { id: foreignRoleId }, actorCtx())).ok, false)
    assert.equal(
      (await crmMutations.crmUpdateRole(null, { id: foreignRoleId, name: 'Taken' }, actorCtx())).ok,
      false
    )

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const still = await db.execute(sql`SELECT count(*)::int n FROM crm_roles WHERE id = ${foreignRoleId}::uuid`)
    assert.equal((still.rows[0] as { n: number }).n, 1, 'the foreign role was deleted')
  })

  it('refuses to strip a built-in role of every permission', async () => {
    // A system role with no permissions is a role nobody can use and nobody can
    // repair from the screen that emptied it.
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmUpdateRole(
      null,
      { id: systemRoleId, permissions: [] },
      actorCtx()
    )
    assert.equal(res.ok, false)
    // The reason matters: "not found" here would mean the guard never ran and
    // the refusal came from somewhere else entirely.
    assert.match(String(res.error), /no permissions/i)

    // The same role renames fine, so this is a guard on emptying it rather than
    // a blanket refusal to touch system roles.
    assert.equal(
      (await crmMutations.crmUpdateRole(null, { id: systemRoleId, name: 'Renamed' }, actorCtx())).ok,
      true
    )
  })

  it('deletes an unheld, non-system role', async () => {
    // The positive case, so the refusals above are not simply "nothing works".
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmDeleteRole(null, { id: plainRoleId }, actorCtx())
    assert.equal(res.ok, true, String(res.error))
  })
})

describe('books', () => {
  it('needs crm.books:manage, and an active account', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    await assert.rejects(
      () => crmMutations.crmUpdateBook(null, { id: bookId, name: 'x' }, ctx(actorId, TENANT, [])),
      /Forbidden/
    )
    await assert.rejects(
      () => crmMutations.crmDeleteBook(null, { id: bookId }, ctx(actorId, TENANT, ALL, 'INACTIVE')),
      /inactive/i
    )
  })

  it('refuses to delete a book that still holds players', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmDeleteBook(null, { id: bookWithPlayers }, actorCtx())
    assert.equal(res.ok, false)
    assert.match(String(res.error), /player/i)
  })

  it('refuses a book id from another whitelabel', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    assert.equal(
      (await crmMutations.crmUpdateBook(null, { id: foreignBookId, name: 'Taken' }, actorCtx())).ok,
      false
    )
    assert.equal((await crmMutations.crmDeleteBook(null, { id: foreignBookId }, actorCtx())).ok, false)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const row = await db.execute(sql`SELECT name FROM crm_books WHERE id = ${foreignBookId}::uuid`)
    assert.equal((row.rows[0] as { name: string }).name, 'Foreign Book', 'the foreign book was modified')
  })

  it('renames and deletes an empty book in its own tenant', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    assert.equal((await crmMutations.crmUpdateBook(null, { id: bookId, name: 'Renamed' }, actorCtx())).ok, true)
    assert.equal((await crmMutations.crmDeleteBook(null, { id: bookId }, actorCtx())).ok, true)
  })
})

describe('the IP allowlist', () => {
  it('needs crm.security:manage', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    await assert.rejects(
      () =>
        crmMutations.crmAddIpAllowlistEntry(
          null,
          { crmUserId: plainUserId, cidr: '203.0.113.7' },
          ctx(actorId, TENANT, [])
        ),
      /Forbidden/
    )
  })

  it('rejects anything that is not an address or range', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    for (const bad of ['not-an-ip', '203.0.113.7; DROP TABLE', '', 'localhost']) {
      const res = await crmMutations.crmAddIpAllowlistEntry(
        null,
        { crmUserId: plainUserId, cidr: bad },
        actorCtx()
      )
      assert.equal(res.ok, false, `accepted ${JSON.stringify(bad)} as an address`)
    }
  })

  it('refuses to write an entry against another whitelabel’s account', async () => {
    // Otherwise this narrows — or widens — who may sign in to someone else's CRM.
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmAddIpAllowlistEntry(
      null,
      { crmUserId: foreignUserId, cidr: '203.0.113.7' },
      actorCtx()
    )
    assert.equal(res.ok, false)
    assert.match(String(res.error), /not found/i)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute(
      sql`SELECT count(*)::int n FROM crm_ip_allowlist WHERE crm_user_id = ${foreignUserId}::uuid`
    )
    assert.equal((rows.rows[0] as { n: number }).n, 0, 'an entry landed on the foreign account')
  })

  it('refuses an owner from another whitelabel, and does not render one that is forced in', async () => {
    // `crm_users.id` carries no tenant, and the player list renders
    // `owner_name` by joining that id — so a well-formed foreign id put another
    // whitelabel's user's name on this whitelabel's players. Verified by
    // execution before the guard existed: the foreign name rendered.
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const { listCrmPlayers } = await import('@src/repos/crm/CrmPlayersRepo.js')
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    // `bookWithPlayers`, not `bookId` — the empty book is deleted by the
    // deletion test above, and this suite shares one fixture.
    const refused = await crmMutations.crmAssignPlayers(
      null,
      { playerIds: [String(playerId)], bookId: bookWithPlayers, ownerId: foreignUserId },
      actorCtx()
    )
    assert.equal(refused.ok, false)
    assert.match(String(refused.error), /not a user here/i)

    const accepted = await crmMutations.crmAssignPlayers(
      null,
      { playerIds: [String(playerId)], bookId: bookWithPlayers, ownerId: actorId },
      actorCtx()
    )
    assert.equal(accepted.ok, true, accepted.error)

    // Defence in depth: even an id forced straight into the table must not
    // render, because the join that reads it is tenant-scoped.
    await db.execute(sql`
      UPDATE crm_player_assignments SET owner_id = ${foreignUserId}::uuid
      WHERE tenant = ${TENANT} AND player_id = ${playerId}`)
    const page = await listCrmPlayers(
      { tenant: TENANT, viewAll: true, bookIds: [] },
      {},
      { limit: 5, offset: 0 }
    )
    const row = page.items.find((p) => p.id === playerId)
    assert.equal(row?.ownerName, null, "another whitelabel's user name rendered on a player row")
  })

  it('accepts a plain address and a CIDR range for a user in this tenant', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    for (const good of ['203.0.113.7', '203.0.113.0/24', '2001:db8::1']) {
      const res = await crmMutations.crmAddIpAllowlistEntry(
        null,
        { crmUserId: plainUserId, cidr: good },
        actorCtx()
      )
      assert.equal(res.ok, true, `rejected ${good}: ${res.error}`)
    }
  })
})
