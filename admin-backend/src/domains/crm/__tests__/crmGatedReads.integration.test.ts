/**
 * The eight operations whose SQL was tested and whose gate was not.
 *
 * A repo-level test proves the query returns the right rows for the arguments
 * it is handed. It says nothing about who is allowed to hand them over, which
 * is the half that leaks: `crmPlayerConsents` reads a player's contact
 * preferences, `crmPlayerRgFlags` reads their gambling-harm record, and both
 * decide reachability in the resolver. Take that check out and the query still
 * passes its own tests while answering for any player in the whitelabel.
 *
 * The shared property here is *silence*: an unreachable player yields an empty
 * result, never data and never an error that would confirm the player exists.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-gated-${randomUUID().slice(0, 8)}`

let bookA = ''
let bookB = ''
let aliceId = ''
let bobId = ''
let minePlayerId = 0
let theirPlayerId = 0
let tagId = ''
let taskInBookB = ''

/** Alice: book A only. Bob: book B only. Neither holds view_all. */
function ctxFor(userId: string, permissions: Array<{ domain: string; actions: string[] }>, status = 'ACTIVE') {
  return {
    crmUser: { id: userId, name: 'Actor', tenant: TENANT, status, requirePasswordReset: false },
    permissions,
    request: { headers: {} },
  } as any
}

const RG_VIEW = [{ domain: 'crm.rg', actions: ['view'] }]
const CONSENT_VIEW = [{ domain: 'crm.consent', actions: ['view'] }]
const TASKS_VIEW = [{ domain: 'crm.tasks', actions: ['view'] }]

async function makeUser(name: string, bookId: string) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const { insertCrmUser } = await import('@src/repos/crm/CrmUsersRepo.js')
  const { hashCrmPassword } = await import('@src/domains/crm/services/CrmAuthService.js')
  const u = await insertCrmUser(db, {
    tenant: TENANT,
    name,
    username: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    passwordHash: await hashCrmPassword('Str0ng-Passw0rd!'),
    roleIds: [],
  })
  await db.execute(sql`
    INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${bookId}::uuid, ${u.id}::uuid)`)
  return String(u.id)
}

async function makePlayer(book: string) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const p = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash)
    VALUES (${TENANT}, 'Player', ${`p-${randomUUID().slice(0, 8)}`}, 'active', 'x') RETURNING id`)
  const id = Number((p.rows[0] as { id: number }).id)
  await db.execute(sql`
    INSERT INTO crm_player_assignments (tenant, player_id, book_id)
    VALUES (${TENANT}, ${id}, ${book}::uuid)`)
  return id
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  const a = await db.execute(sql`INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, 'Book A') RETURNING id`)
  bookA = String((a.rows[0] as { id: string }).id)
  const b = await db.execute(sql`INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, 'Book B') RETURNING id`)
  bookB = String((b.rows[0] as { id: string }).id)

  aliceId = await makeUser('Alice', bookA)
  bobId = await makeUser('Bob', bookB)

  minePlayerId = await makePlayer(bookA)
  theirPlayerId = await makePlayer(bookB)

  // Real rows to read, so an empty answer means the gate refused rather than
  // that there was nothing there in the first place.
  await db.execute(sql`
    INSERT INTO crm_player_rg_flags
      (tenant, player_id, flag_type, status, initiated_by, blocks_play, raised_by)
    VALUES (${TENANT}, ${theirPlayerId}, 'COOLING_OFF', 'ACTIVE', 'operator', true, ${bobId}::uuid)`)
  await db.execute(sql`
    INSERT INTO crm_player_consents
      (tenant, player_id, channel, purpose, state, state_since, source)
    VALUES (${TENANT}, ${theirPlayerId}, 'EMAIL', 'MARKETING', 'GRANTED', now(), 'ADMIN')`)

  const t = await db.execute(sql`
    INSERT INTO crm_tags (tenant, name, colour) VALUES (${TENANT}, 'Tag', '#3b82f6') RETURNING id`)
  tagId = String((t.rows[0] as { id: string }).id)

  // A task in Bob's book, for the acknowledgement rules below.
  const task = await db.execute(sql`
    INSERT INTO crm_tasks (tenant, book_id, created_by, title, due_at, sla_minutes, breach_at, next_escalation_at)
    VALUES (${TENANT}, ${bookB}::uuid, 'test', 'Chase', now() + interval '1 day', 60,
            now() + interval '1 day' + make_interval(mins => 60), now() + interval '1 day')
    RETURNING id`)
  taskInBookB = String((task.rows[0] as { id: string }).id)
})

after(async () => {
  // Audited mutations publish through the Redis emitter, which holds the event
  // loop open. See crmUserAdmin.integration.test.ts for the full explanation.
  await new Promise((r) => setTimeout(r, 250))
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()

  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  await db.execute(sql`DELETE FROM audit_logs WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_pii_access_log WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_consent_events WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_player_consents WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_player_rg_flags WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_player_tags WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_tags WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_notifications WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_task_events WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_tasks WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_player_assignments WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_book_members WHERE book_id IN (SELECT id FROM crm_books WHERE tenant = ${TENANT})`)
  await db.execute(sql`DELETE FROM crm_books WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM crm_user_credentials WHERE crm_user_id IN (SELECT id FROM crm_users WHERE tenant = ${TENANT})`)
  await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${TENANT}`)
  await db.execute(sql`DELETE FROM users WHERE tenant = ${TENANT}`)
})

describe('crmMe answers about the caller and nobody else', () => {
  it('reports each user’s own books', async () => {
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    const alice = await crmQueries.crmMe(null, {}, ctxFor(aliceId, []))
    const bob = await crmQueries.crmMe(null, {}, ctxFor(bobId, []))

    assert.equal(alice.id, aliceId)
    assert.deepEqual(alice.bookIds, [bookA])
    assert.deepEqual(bob.bookIds, [bookB], 'one user’s books leaked into another’s session')
  })

  it('is null without a session rather than throwing', async () => {
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    assert.equal(await crmQueries.crmMe(null, {}, {} as any), null)
  })

  it('reports the caller’s own email address', async () => {
    // The resolver used to hardcode `email: null` while fetching the row it
    // could have read it from, so the address shown at sign-in vanished on the
    // next page load. This pins the fix: the row's value must come back.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      UPDATE crm_users SET email = 'alice@example.test' WHERE id = ${aliceId}::uuid`)

    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    const me = await crmQueries.crmMe(null, {}, ctxFor(aliceId, []))
    assert.equal(me.email, 'alice@example.test', 'crmMe dropped the email on the floor again')
  })

  it('reports view_all only when the permission is held', async () => {
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    const plain = await crmQueries.crmMe(null, {}, ctxFor(aliceId, []))
    const wide = await crmQueries.crmMe(
      null,
      {},
      ctxFor(aliceId, [{ domain: 'crm.players', actions: ['view_all'] }])
    )
    assert.equal(plain.canViewAllPlayers, false)
    assert.equal(wide.canViewAllPlayers, true)
  })
})

describe('the hasNotes filter respects note visibility', () => {
  it('cannot be used to detect a note the CRM surface may not read', async () => {
    // An operator recording "suspected bonus abuse, do not disclose" writes an
    // `admin_only` note, which this surface cannot read — the note list omits
    // it and the per-row count excludes it. The filter did not: searching for
    // players "with notes" returned a player whose only note was admin_only, so
    // its existence was inferable from a screen that then showed nothing. The
    // filter and the column it filters on have to draw the same line.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { listCrmPlayers } = await import('@src/repos/crm/CrmPlayersRepo.js')

    await db.execute(sql`
      INSERT INTO crm_player_notes (tenant, player_id, body, visibility, author_admin_user_id, author_name)
      VALUES (${TENANT}, ${minePlayerId}, 'suspected bonus abuse', 'admin_only', 1, 'Admin')`)

    const scope = { tenant: TENANT, viewAll: true, bookIds: [] }
    const withNotes = await listCrmPlayers(scope, { hasNotes: true }, { limit: 50, offset: 0 })
    const withoutNotes = await listCrmPlayers(scope, { hasNotes: false }, { limit: 50, offset: 0 })

    assert.equal(
      withNotes.items.some((p) => p.id === minePlayerId),
      false,
      'a player whose only note is admin_only was surfaced by the filter'
    )
    assert.ok(
      withoutNotes.items.some((p) => p.id === minePlayerId),
      'and they must appear under "no notes", because to this surface they have none'
    )

    await db.execute(sql`
      DELETE FROM crm_player_notes WHERE tenant = ${TENANT} AND visibility = 'admin_only'`)
  })
})

describe('crmDeskHealth is gated and book-scoped', () => {
  it('needs crm.tasks:view', async () => {
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    await assert.rejects(() => crmQueries.crmDeskHealth(null, {}, ctxFor(aliceId, [])), /Forbidden/)
  })

  it('answers for a holder, without reaching outside their books', async () => {
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    const h = await crmQueries.crmDeskHealth(null, {}, ctxFor(aliceId, TASKS_VIEW))
    assert.ok(h && typeof h.allClear === 'boolean')
    // Alice is in Book A only, and every uncovered book reported must be hers.
    for (const row of h.uncoveredBooks?.rows ?? []) {
      assert.equal(String(row.bookId), bookA, 'a book outside Alice’s scope was reported to her')
    }
  })
})

describe('crmWhitelabels is Super Admin only', () => {
  it('refuses an ordinary admin and a CRM session alike', async () => {
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')
    await assert.rejects(
      () => crmQueries.crmWhitelabels(null, {}, { user: { roles: ['Support Admin'] } } as any),
      /Super Admin/
    )
    await assert.rejects(() => crmQueries.crmWhitelabels(null, {}, ctxFor(aliceId, [])), /Super Admin/)
  })
})

describe('a player outside your books yields nothing, not data', () => {
  it('crmPlayerRgFlags is gated, then silent', async () => {
    const { crmRgQueries } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    // Without the permission at all.
    await assert.rejects(
      () => crmRgQueries.crmPlayerRgFlags(null, { playerId: String(theirPlayerId) }, ctxFor(aliceId, [])),
      /Forbidden/
    )
    // With the permission, but for a player in Bob's book.
    const hidden = await crmRgQueries.crmPlayerRgFlags(
      null,
      { playerId: String(theirPlayerId) },
      ctxFor(aliceId, RG_VIEW)
    )
    assert.deepEqual(hidden, [], 'a gambling-harm record was readable from outside the book')

    // Bob, who is in that book, does see it — so the empty answer above was the
    // gate refusing rather than there being nothing to find.
    const seen = await crmRgQueries.crmPlayerRgFlags(
      null,
      { playerId: String(theirPlayerId) },
      ctxFor(bobId, RG_VIEW)
    )
    assert.equal(seen.length, 1)
  })

  it('crmPlayerConsents and crmPlayerConsentHistory are gated, then silent', async () => {
    const { crmRgQueries } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    await assert.rejects(
      () => crmRgQueries.crmPlayerConsents(null, { playerId: String(theirPlayerId) }, ctxFor(aliceId, [])),
      /Forbidden/
    )
    assert.deepEqual(
      await crmRgQueries.crmPlayerConsents(
        null,
        { playerId: String(theirPlayerId) },
        ctxFor(aliceId, CONSENT_VIEW)
      ),
      []
    )
    assert.deepEqual(
      await crmRgQueries.crmPlayerConsentHistory(
        null,
        { playerId: String(theirPlayerId) },
        ctxFor(aliceId, CONSENT_VIEW)
      ),
      []
    )

    const seen = await crmRgQueries.crmPlayerConsents(
      null,
      { playerId: String(theirPlayerId) },
      ctxFor(bobId, CONSENT_VIEW)
    )
    assert.equal(seen.length, 1, 'the consent row should be visible to the book it belongs to')
  })

  it('a malformed player id is refused rather than coerced', async () => {
    const { crmRgQueries } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    assert.deepEqual(
      await crmRgQueries.crmPlayerRgFlags(null, { playerId: 'not-a-number' }, ctxFor(bobId, RG_VIEW)),
      []
    )
  })
})

describe('recording consent', () => {
  const base = {
    channel: 'EMAIL',
    purpose: 'MARKETING',
    source: 'ADMIN',
  }

  it('withdrawal and restoration are not the same permission', async () => {
    // Deliberate asymmetry: a player asking to be left alone must always be able
    // to be recorded, while putting them back on a marketing list is the
    // privileged direction. Collapsing the two would quietly re-enable contact.
    const { crmRgMutations } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    const recorder = ctxFor(bobId, [{ domain: 'crm.consent', actions: ['record'] }])

    const withdrawn = await crmRgMutations.crmRecordConsent(
      null,
      { ...base, playerId: String(theirPlayerId), state: 'WITHDRAWN' },
      recorder
    )
    assert.equal(withdrawn.ok, true, String(withdrawn.error))

    await assert.rejects(
      () =>
        crmRgMutations.crmRecordConsent(
          null,
          { ...base, playerId: String(theirPlayerId), state: 'GRANTED' },
          recorder
        ),
      /Forbidden/,
      'restoring consent should need crm.consent:restore, not record'
    )
  })

  it('refuses a player outside your books', async () => {
    const { crmRgMutations } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    const res = await crmRgMutations.crmRecordConsent(
      null,
      { ...base, playerId: String(theirPlayerId), state: 'WITHDRAWN' },
      ctxFor(aliceId, [{ domain: 'crm.consent', actions: ['record'] }])
    )
    assert.equal(res.ok, false)
    assert.match(String(res.error), /not in your books/i)
  })

  it('rejects an unknown channel, purpose or state before touching the row', async () => {
    const { crmRgMutations } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    const recorder = ctxFor(bobId, [{ domain: 'crm.consent', actions: ['record'] }])
    const p = String(theirPlayerId)
    assert.equal((await crmRgMutations.crmRecordConsent(null, { ...base, playerId: p, channel: 'PIGEON', state: 'WITHDRAWN' }, recorder)).ok, false)
    assert.equal((await crmRgMutations.crmRecordConsent(null, { ...base, playerId: p, purpose: 'GOSSIP', state: 'WITHDRAWN' }, recorder)).ok, false)
    assert.equal((await crmRgMutations.crmRecordConsent(null, { ...base, playerId: p, state: 'MAYBE' }, recorder)).ok, false)
  })

  it('a verbal consent needs a reference to the recording', async () => {
    const { crmRgMutations } = await import('@src/domains/crm/resolvers/responsibleGambling.js')
    const res = await crmRgMutations.crmRecordConsent(
      null,
      { ...base, playerId: String(theirPlayerId), state: 'WITHDRAWN', source: 'AGENT_VERBAL' },
      ctxFor(bobId, [{ domain: 'crm.consent', actions: ['record'] }])
    )
    assert.equal(res.ok, false)
    assert.match(String(res.error), /reference/i)
  })
})

describe('acknowledging an escalated task', () => {
  const ESCALATE = [{ domain: 'crm.tasks', actions: ['escalate'] }]

  it('needs crm.tasks:escalate specifically — managing tasks is not enough', async () => {
    // Acknowledgement stops the ladder. Letting anyone who can work a task also
    // silence its escalation would make the ladder decorative.
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    await assert.rejects(
      () =>
        crmTaskMutations.crmAcknowledgeTask(
          null,
          { taskId: taskInBookB },
          ctxFor(bobId, [{ domain: 'crm.tasks', actions: ['view', 'manage'] }])
        ),
      /Forbidden/
    )
  })

  it('refuses a deactivated holder', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    await assert.rejects(
      () => crmTaskMutations.crmAcknowledgeTask(null, { taskId: taskInBookB }, ctxFor(bobId, ESCALATE, 'INACTIVE')),
      /inactive/i
    )
  })

  it('is deliberately NOT book-scoped, so the ladder’s last rung can answer', async () => {
    // Alice is in Book A; the task is in Book B. This is allowed on purpose:
    // when nobody *in* the book holds escalate, the sweep falls back to any
    // tenant-wide escalate holder — so the person it wakes must be able to
    // acknowledge. Adding a book predicate here would look like a fix and would
    // silently strand every escalation that used that fallback.
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmAcknowledgeTask(null, { taskId: taskInBookB }, ctxFor(aliceId, ESCALATE))
    assert.equal(res.ok, true, String(res.error))
  })

  it('cannot be acknowledged twice', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmAcknowledgeTask(null, { taskId: taskInBookB }, ctxFor(bobId, ESCALATE))
    assert.equal(res.ok, false)
    assert.match(String(res.error), /already acknowledged|not found/i)
  })

  it('refuses a task id that is not in this tenant', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmAcknowledgeTask(
      null,
      { taskId: '00000000-0000-0000-0000-000000000000' },
      ctxFor(aliceId, ESCALATE)
    )
    assert.equal(res.ok, false)
  })
})

describe('crmRemoveTags respects the same reach', () => {
  it('needs crm.tags:apply', async () => {
    const { crmTagsMutations } = await import('@src/domains/crm/resolvers/tags.js')
    await assert.rejects(
      () =>
        crmTagsMutations.crmRemoveTags(
          null,
          { playerIds: [String(minePlayerId)], tagIds: [tagId] },
          ctxFor(aliceId, [])
        ),
      /Forbidden/
    )
  })

  it('refuses when none of the selected players are reachable', async () => {
    const { crmTagsMutations } = await import('@src/domains/crm/resolvers/tags.js')
    const res = await crmTagsMutations.crmRemoveTags(
      null,
      { playerIds: [String(theirPlayerId)], tagIds: [tagId] },
      ctxFor(aliceId, [{ domain: 'crm.tags', actions: ['apply'] }])
    )
    assert.equal(res.ok, false)
    assert.match(String(res.error), /reach/i)
  })

  it('proceeds for a player in your own book', async () => {
    const { crmTagsMutations } = await import('@src/domains/crm/resolvers/tags.js')
    const res = await crmTagsMutations.crmRemoveTags(
      null,
      { playerIds: [String(minePlayerId)], tagIds: [tagId] },
      ctxFor(aliceId, [{ domain: 'crm.tags', actions: ['apply'] }])
    )
    assert.equal(res.ok, true, String(res.error))
  })
})
