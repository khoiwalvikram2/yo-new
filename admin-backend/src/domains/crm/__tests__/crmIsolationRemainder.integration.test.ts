/**
 * The last of the untested CRM surface: availability, unassignment, the
 * allowlist reads, notifications, and the small catalogue queries.
 *
 * Three of these carry a claim that exists only as a comment in the source:
 *
 *   - `crmMarkNotificationsRead` is "predicated on the caller's own id, so a
 *     crafted id list cannot touch anyone else's inbox"
 *   - `crmSetMyAvailability` is "their own record only — covering for someone is
 *     a thing you arrange, not a thing you can be volunteered for"
 *   - `crmUnassignPlayers` passes the actor's tenant, and nothing proved a
 *     player id from elsewhere could not be dragged out of its book
 *
 * A claim in a comment survives a refactor that breaks it. These are the
 * assertions that do not.
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-rem-${randomUUID().slice(0, 8)}`
const OTHER = `crm-rem-other-${randomUUID().slice(0, 8)}`

let actorId = ''
let colleagueId = ''
let foreignUserId = ''
let bookId = ''
let playerId = 0
let foreignPlayerId = 0
let foreignBookId = ''
let myNoteId = ''
let theirNoteId = ''
let foreignAllowlistId = ''
let foreignTagId = ''

const ALL = [
  // `manage` does not imply `view` — the catalogue treats them as separate
  // grants, so a context that only manages books cannot read their members.
  { domain: 'crm.books', actions: ['manage', 'view'] },
  { domain: 'crm.security', actions: ['manage', 'view'] },
  { domain: 'crm.tags', actions: ['apply', 'manage'] },
  { domain: 'crm.players', actions: ['view'] },
  { domain: 'crm.rg', actions: ['view'] },
]

function ctx(userId: string, tenant: string, permissions = ALL, status = 'ACTIVE') {
  return {
    crmUser: { id: userId, name: 'Actor', tenant, status, requirePasswordReset: false },
    permissions,
  } as any
}
const actorCtx = () => ctx(actorId, TENANT)

async function makeUser(tenant: string, name: string) {
  const { db } = await import('@src/db/client.js')
  const { insertCrmUser } = await import('@src/repos/crm/CrmUsersRepo.js')
  const { hashCrmPassword } = await import('@src/domains/crm/services/CrmAuthService.js')
  const u = await insertCrmUser(db, {
    tenant,
    name,
    username: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    passwordHash: await hashCrmPassword('Str0ng-Passw0rd!'),
    roleIds: [],
  })
  return String(u.id)
}

async function makePlayer(tenant: string, book: string) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const p = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash)
    VALUES (${tenant}, 'Player', ${`p-${randomUUID().slice(0, 8)}`}, 'active', 'x') RETURNING id`)
  const id = Number((p.rows[0] as { id: number }).id)
  await db.execute(sql`
    INSERT INTO crm_player_assignments (tenant, player_id, book_id)
    VALUES (${tenant}, ${id}, ${book}::uuid)`)
  return id
}

async function makeNotification(tenant: string, crmUserId: string) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const n = await db.execute(sql`
    INSERT INTO crm_notifications (tenant, crm_user_id, kind, title)
    VALUES (${tenant}, ${crmUserId}::uuid, 'TASK_ASSIGNED', 'Something happened') RETURNING id`)
  return String((n.rows[0] as { id: string }).id)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  actorId = await makeUser(TENANT, 'Actor')
  colleagueId = await makeUser(TENANT, 'Colleague')
  foreignUserId = await makeUser(OTHER, 'Foreigner')

  const b = await db.execute(sql`INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, 'Book') RETURNING id`)
  bookId = String((b.rows[0] as { id: string }).id)
  const fb = await db.execute(sql`INSERT INTO crm_books (tenant, name) VALUES (${OTHER}, 'Foreign Book') RETURNING id`)
  foreignBookId = String((fb.rows[0] as { id: string }).id)

  playerId = await makePlayer(TENANT, bookId)
  foreignPlayerId = await makePlayer(OTHER, foreignBookId)

  myNoteId = await makeNotification(TENANT, actorId)
  theirNoteId = await makeNotification(TENANT, colleagueId)

  const a = await db.execute(sql`
    INSERT INTO crm_ip_allowlist (tenant, crm_user_id, cidr)
    VALUES (${OTHER}, ${foreignUserId}::uuid, '203.0.113.0/24') RETURNING id`)
  foreignAllowlistId = String((a.rows[0] as { id: string }).id)

  const t = await db.execute(sql`
    INSERT INTO crm_tags (tenant, name, colour) VALUES (${OTHER}, 'Foreign Tag', '#3b82f6') RETURNING id`)
  foreignTagId = String((t.rows[0] as { id: string }).id)
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
    await db.execute(sql`DELETE FROM crm_notifications WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_ip_allowlist WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_player_tags WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_tags WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_player_assignments WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_books WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_user_credentials WHERE crm_user_id IN (SELECT id FROM crm_users WHERE tenant = ${tenant})`)
    await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${tenant}`)
  }
})

describe('notifications are one person’s inbox', () => {
  it('lists only the caller’s own', async () => {
    const { crmTaskQueries } = await import('@src/domains/crm/resolvers/tasks.js')
    const mine = await crmTaskQueries.crmMyNotifications(null, {}, actorCtx())
    assert.equal(mine.length, 1)
    assert.equal(String(mine[0].id), myNoteId)
  })

  it('a crafted id belonging to a colleague is not marked read', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmMarkNotificationsRead(null, { ids: [theirNoteId] }, actorCtx())
    // The call succeeds — it simply matches nothing, which is the safe shape.
    assert.equal(res.ok, true)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const row = await db.execute(sql`SELECT read_at FROM crm_notifications WHERE id = ${theirNoteId}::uuid`)
    assert.equal(
      (row.rows[0] as { read_at: Date | null }).read_at,
      null,
      'a colleague’s notification was marked read by someone else'
    )
  })

  it('marks the caller’s own', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    assert.equal((await crmTaskMutations.crmMarkNotificationsRead(null, { ids: [myNoteId] }, actorCtx())).ok, true)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const row = await db.execute(sql`SELECT read_at FROM crm_notifications WHERE id = ${myNoteId}::uuid`)
    assert.notEqual((row.rows[0] as { read_at: Date | null }).read_at, null)
  })
})

describe('availability is your own record', () => {
  it('takes no user argument, so it can only ever write the caller’s row', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const until = new Date(Date.now() + 3_600_000).toISOString()
    const res = await crmMutations.crmSetMyAvailability(null, { outOfOfficeUntil: until }, actorCtx())
    assert.equal(res.ok, true, String(res.error))

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute(
      sql`SELECT id, out_of_office_until FROM crm_users WHERE tenant = ${TENANT} ORDER BY id`
    )
    const touched = rows.rows.filter((r: any) => r.out_of_office_until !== null)
    assert.equal(touched.length, 1, 'more than the caller’s row changed')
    assert.equal(String((touched[0] as any).id), actorId)
  })

  it('refuses to delegate to yourself', async () => {
    // Delegating to yourself is a loop the escalation ladder cannot leave.
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmSetMyAvailability(null, { delegateTo: actorId }, actorCtx())
    assert.equal(res.ok, false)
  })

  it('refuses a date it cannot parse', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmSetMyAvailability(null, { outOfOfficeUntil: 'next tuesday' }, actorCtx())
    assert.equal(res.ok, false)
  })
})

describe('unassigning players stays inside the tenant', () => {
  it('needs crm.books:manage and a non-empty selection', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    await assert.rejects(
      () => crmMutations.crmUnassignPlayers(null, { playerIds: [String(playerId)] }, ctx(actorId, TENANT, [])),
      /Forbidden/
    )
    assert.equal((await crmMutations.crmUnassignPlayers(null, { playerIds: [] }, actorCtx())).ok, false)
  })

  it('leaves a player from another whitelabel in their book', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    await crmMutations.crmUnassignPlayers(null, { playerIds: [String(foreignPlayerId)] }, actorCtx())

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const still = await db.execute(
      sql`SELECT count(*)::int n FROM crm_player_assignments WHERE player_id = ${foreignPlayerId}`
    )
    assert.equal((still.rows[0] as { n: number }).n, 1, 'a foreign player was pulled out of their book')
  })

  it('unassigns a player in its own tenant', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    assert.equal((await crmMutations.crmUnassignPlayers(null, { playerIds: [String(playerId)] }, actorCtx())).ok, true)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const gone = await db.execute(
      sql`SELECT count(*)::int n FROM crm_player_assignments WHERE player_id = ${playerId}`
    )
    assert.equal((gone.rows[0] as { n: number }).n, 0)
  })
})

describe('security reads and writes do not cross whitelabels', () => {
  it('crmIpAllowlist shows nothing for a user in another tenant', async () => {
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    const rows = await crmQueries.crmIpAllowlist(null, { crmUserId: foreignUserId }, actorCtx())
    assert.equal(rows.length, 0, 'another whitelabel’s allowlist was readable')
  })

  it('crmRemoveIpAllowlistEntry refuses an entry from another tenant', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmRemoveIpAllowlistEntry(null, { id: foreignAllowlistId }, actorCtx())
    assert.equal(res.ok, false)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const still = await db.execute(
      sql`SELECT count(*)::int n FROM crm_ip_allowlist WHERE id = ${foreignAllowlistId}::uuid`
    )
    assert.equal((still.rows[0] as { n: number }).n, 1, 'a foreign allowlist entry was deleted')
  })

  it('crmUpdateTag refuses a tag from another tenant', async () => {
    const { crmTagsMutations } = await import('@src/domains/crm/resolvers/tags.js')
    const res = await crmTagsMutations.crmUpdateTag(null, { id: foreignTagId, name: 'Taken' }, actorCtx())
    assert.equal(res.ok, false)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const row = await db.execute(sql`SELECT name FROM crm_tags WHERE id = ${foreignTagId}::uuid`)
    assert.equal((row.rows[0] as { name: string }).name, 'Foreign Tag')
  })
})

describe('the catalogue queries answer', () => {
  it('crmPermissionCatalog lists grantable permissions', async () => {
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    const rows = await crmQueries.crmPermissionCatalog(null, {}, actorCtx())
    assert.ok(rows.length > 0)
    assert.ok(rows.every((g: any) => Array.isArray(g.actions) && g.actions.length > 0))
  })

  it('crmRgFlagTypes lists the flag types the UI offers', async () => {
    const { crmRgQueries } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    const rows = await crmRgQueries.crmRgFlagTypes(null, {}, actorCtx())
    assert.ok(rows.length > 0)
  })

  it('crmTagLimit reports the cap and what is used against it', async () => {
    const { crmTagsQueries } = await import('@src/domains/crm/resolvers/tags.js')
    const res = await crmTagsQueries.crmTagLimit(null, {}, actorCtx())
    assert.ok(Number(res.limit) > 0, `expected a cap, got ${JSON.stringify(res)}`)
    assert.equal(typeof res.used, 'number')
    // Counted per tenant: this tenant's only tag lives in the other one.
    assert.equal(res.used, 0)
  })

  it('crmBookMembers reads a book in this tenant', async () => {
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    const rows = await crmQueries.crmBookMembers(null, { bookId }, actorCtx())
    assert.ok(Array.isArray(rows))
  })
})
