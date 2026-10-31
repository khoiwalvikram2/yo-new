/**
 * Saved segments, and raising one task for many players.
 *
 * The things worth asserting here are the ones that would not show up as an
 * error:
 *
 *   - a segment stores a *filter*, not a set of players, so a shared one shows
 *     each reader only their own. If it ever stored resolved ids, sharing would
 *     become a disclosure and no test would fail;
 *   - only a segment's author may change it, even though the whole whitelabel
 *     can read a shared one;
 *   - a bulk create is bounded, scoped per player, and deduplicated — a
 *     double-clicked batch of two hundred must produce two hundred tasks, not
 *     four hundred;
 *   - the counts it reports are true, because "created 191 of 200" is the whole
 *     value of returning counts instead of a boolean.
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-seg-${randomUUID().slice(0, 8)}`
const OTHER = `crm-seg-other-${randomUUID().slice(0, 8)}`

let asha = ''
let bruno = ''
let supervisor = ''
let ashaBook = ''
let brunoBook = ''
let ashaPlayers: number[] = []
let brunoPlayer = 0

const AGENT = [
  { domain: 'crm.players', actions: ['view'] },
  { domain: 'crm.tasks', actions: ['view', 'manage'] },
  { domain: 'crm.books', actions: ['view'] },
]
const SUPERVISOR = [
  { domain: 'crm.players', actions: ['view', 'view_all'] },
  { domain: 'crm.tasks', actions: ['view', 'manage'] },
  { domain: 'crm.books', actions: ['view'] },
]

function ctx(userId: string, permissions = AGENT, tenant = TENANT, status = 'ACTIVE') {
  return {
    crmUser: { id: userId, name: 'Actor', tenant, status, requirePasswordReset: false },
    permissions,
  } as any
}

async function makeUser(tenant: string, name: string) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`
    INSERT INTO crm_users (tenant, name, status) VALUES (${tenant}, ${name}, 'ACTIVE') RETURNING id`)
  return String((r.rows[0] as { id: string }).id)
}

async function makeBook(tenant: string, name: string, members: string[]) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const b = await db.execute(sql`
    INSERT INTO crm_books (tenant, name) VALUES (${tenant}, ${name}) RETURNING id`)
  const id = String((b.rows[0] as { id: string }).id)
  // No tenant column: membership cascades from the book and the user.
  for (const m of members) {
    await db.execute(sql`
      INSERT INTO crm_book_members (book_id, crm_user_id)
      VALUES (${id}::uuid, ${m}::uuid)`)
  }
  return id
}

async function makePlayer(tenant: string, bookId: string) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const p = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash)
    VALUES (${tenant}, 'Player', ${`p-${randomUUID().slice(0, 10)}`}, 'active', 'x') RETURNING id`)
  const id = Number((p.rows[0] as { id: number }).id)
  await db.execute(sql`
    INSERT INTO crm_player_assignments (tenant, player_id, book_id)
    VALUES (${tenant}, ${id}, ${bookId}::uuid)`)
  return id
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const t of [TENANT, OTHER]) {
    await db.execute(sql`
      INSERT INTO crm_whitelabel_settings (tenant, enabled, seat_limit, timezone, desk_open_minute, desk_close_minute, desk_days)
      VALUES (${t}, true, 20, 'UTC', 0, 1440, '{1,2,3,4,5,6,7}')`)
  }

  asha = await makeUser(TENANT, 'Asha')
  bruno = await makeUser(TENANT, 'Bruno')
  supervisor = await makeUser(TENANT, 'Supervisor')

  ashaBook = await makeBook(TENANT, 'Asha Book', [asha])
  brunoBook = await makeBook(TENANT, 'Bruno Book', [bruno])

  ashaPlayers = [await makePlayer(TENANT, ashaBook), await makePlayer(TENANT, ashaBook)]
  brunoPlayer = await makePlayer(TENANT, brunoBook)
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})

  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const t of [TENANT, OTHER]) {
    await db.execute(sql`DELETE FROM crm_segments WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_task_events WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_tasks WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_notifications WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_player_assignments WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${t}`)
    // crm_book_members has no tenant of its own; it cascades from both sides.
    await db.execute(sql`DELETE FROM crm_books WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM audit_logs WHERE tenant = ${t}`)
  }
})

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

describe('saving a segment', () => {
  it('refuses without crm.players:view', async () => {
    const { crmSegmentMutations } = await import('@src/domains/crm/resolvers/segments.js')
    await assert.rejects(
      () => crmSegmentMutations.crmCreateSegment(null, { name: 'Nope' }, ctx(asha, [])),
      /Forbidden/
    )
  })

  it('refuses an INACTIVE user, who keeps the read and loses the write', async () => {
    const { crmSegmentQueries, crmSegmentMutations } = await import(
      '@src/domains/crm/resolvers/segments.js'
    )
    const inactive = ctx(asha, AGENT, TENANT, 'INACTIVE')
    assert.ok(Array.isArray(await crmSegmentQueries.crmSegments(null, {}, inactive)))
    await assert.rejects(
      () => crmSegmentMutations.crmCreateSegment(null, { name: 'Nope' }, inactive),
      /inactive/i
    )
  })

  it('needs a name', async () => {
    const { crmSegmentMutations } = await import('@src/domains/crm/resolvers/segments.js')
    const res = await crmSegmentMutations.crmCreateSegment(null, { name: '   ' }, ctx(asha))
    assert.equal(res.ok, false)
    assert.match(String(res.error), /name/i)
  })

  it('keeps only the filter keys the player query knows', async () => {
    const { crmSegmentMutations, crmSegmentQueries } = await import(
      '@src/domains/crm/resolvers/segments.js'
    )
    const res = await crmSegmentMutations.crmCreateSegment(
      null,
      {
        name: 'Sanitised',
        // `tenant` is the one nobody must be able to smuggle into a stored
        // filter that is later spread into the player query.
        filter: { search: 'raj', tenant: OTHER, viewAll: true, nonsense: 1 } as never,
      },
      ctx(asha)
    )
    assert.equal(res.ok, true, res.error)

    const list = await crmSegmentQueries.crmSegments(null, {}, ctx(asha))
    const saved = list.find((s) => s.name === 'Sanitised')
    assert.ok(saved)
    assert.deepEqual(saved.filter, { search: 'raj' }, 'an unknown key survived into the stored filter')
  })

  it('drops values the player query would choke on, so a segment cannot break the list it feeds', async () => {
    // `bookId` and `tagIds` are interpolated with an explicit ::uuid cast, so a
    // value that is not uuid-shaped does not narrow the result — it aborts the
    // statement. The sanitiser filtered by key but not by value, so a segment
    // could store tagIds: ['garbage'], and opening it threw out of crmPlayers
    // AND crmExportPlayers. Planted in a *shared* segment that broke the player
    // list for the whole desk until somebody found and deleted it.
    const { crmSegmentMutations, crmSegmentQueries } = await import(
      '@src/domains/crm/resolvers/segments.js'
    )
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')

    const hostile = {
      tagIds: ['garbage', 'also-not-a-uuid'],
      bookId: "x'; DROP TABLE crm_tasks; --",
      tagMatch: "all') OR true --",
      assignment: 'everything',
      hasNotes: 'true',
      search: 'raj',
    }
    const name = `hostile-${randomUUID().slice(0, 8)}`
    const created = await crmSegmentMutations.crmCreateSegment(null, { name, filter: hostile }, ctx(asha))
    assert.equal(created.ok, true, created.error)

    const saved = (await crmSegmentQueries.crmSegments(null, {}, ctx(asha))).find((s) => s.name === name)
    assert.ok(saved)
    // Only the one value the query can actually run survives.
    assert.deepEqual(saved.filter, { search: 'raj' }, 'an unrunnable value was stored')

    // And opening it returns rows rather than throwing.
    const page = await crmQueries.crmPlayers(null, { filter: saved.filter as never }, ctx(asha))
    assert.ok(Array.isArray(page.items), 'the segment could not be opened')

    // A well-formed id is still honoured — the guard narrows nothing legitimate.
    const good = await crmSegmentMutations.crmCreateSegment(
      null,
      { name: `good-${randomUUID().slice(0, 8)}`, filter: { bookId: ashaBook, assignment: 'assigned' } },
      ctx(asha)
    )
    assert.equal(good.ok, true, good.error)
    const goodSaved = (await crmSegmentQueries.crmSegments(null, {}, ctx(asha))).find((s) =>
      s.name.startsWith('good-')
    )
    assert.deepEqual(goodSaved?.filter, { bookId: ashaBook, assignment: 'assigned' })
  })

  it('refuses two of your own by the same name, and allows someone else the same one', async () => {
    const { crmSegmentMutations } = await import('@src/domains/crm/resolvers/segments.js')
    const first = await crmSegmentMutations.crmCreateSegment(null, { name: 'My chases' }, ctx(asha))
    assert.equal(first.ok, true, first.error)

    const again = await crmSegmentMutations.crmCreateSegment(null, { name: 'My chases' }, ctx(asha))
    assert.equal(again.ok, false)
    assert.match(String(again.error), /already have a segment/i)

    // "My chases" means something different to Bruno.
    const bruno1 = await crmSegmentMutations.crmCreateSegment(null, { name: 'My chases' }, ctx(bruno))
    assert.equal(bruno1.ok, true, bruno1.error)
  })
})

describe('sharing a segment', () => {
  it('refuses an agent, who speaks for one book rather than the desk', async () => {
    const { crmSegmentMutations } = await import('@src/domains/crm/resolvers/segments.js')
    const res = await crmSegmentMutations.crmCreateSegment(
      null,
      { name: 'Agent tried to share', isShared: true },
      ctx(asha)
    )
    assert.equal(res.ok, false)
    assert.match(String(res.error), /View all players/i)
  })

  it('allows a supervisor, and the whole whitelabel then sees it', async () => {
    const { crmSegmentMutations, crmSegmentQueries } = await import(
      '@src/domains/crm/resolvers/segments.js'
    )
    const res = await crmSegmentMutations.crmCreateSegment(
      null,
      { name: 'Desk priority', filter: { status: 'active' }, isShared: true },
      ctx(supervisor, SUPERVISOR)
    )
    assert.equal(res.ok, true, res.error)

    for (const [who, perms] of [
      [asha, AGENT],
      [bruno, AGENT],
    ] as const) {
      const list = await crmSegmentQueries.crmSegments(null, {}, ctx(who, perms as never))
      const shared = list.find((s) => s.name === 'Desk priority')
      assert.ok(shared, 'a shared segment was invisible to an agent')
      assert.equal(shared.isShared, true)
      assert.equal(shared.isMine, false, 'someone else’s segment was reported as their own')
    }
  })

  it('is a filter, not a set of players — which is what makes sharing safe', async () => {
    // The property the whole design rests on. Asha and Bruno open the same
    // shared segment and must see only their own books' players.
    const { crmSegmentQueries } = await import('@src/domains/crm/resolvers/segments.js')
    const { crmQueries } = await import('@src/domains/crm/resolvers/queries.js')

    const list = await crmSegmentQueries.crmSegments(null, {}, ctx(asha))
    const shared = list.find((s) => s.name === 'Desk priority')
    assert.ok(shared)

    const ashaSees = await crmQueries.crmPlayers(null, { filter: shared.filter as never }, ctx(asha))
    const brunoSees = await crmQueries.crmPlayers(null, { filter: shared.filter as never }, ctx(bruno))

    const ashaIds = ashaSees.items.map((p: { id: number }) => p.id).sort()
    const brunoIds = brunoSees.items.map((p: { id: number }) => p.id).sort()

    assert.deepEqual(ashaIds, [...ashaPlayers].sort(), 'Asha saw the wrong players')
    assert.deepEqual(brunoIds, [brunoPlayer], 'Bruno saw the wrong players')
    assert.equal(
      ashaIds.some((id: number) => brunoIds.includes(id)),
      false,
      'the same shared segment returned overlapping players to two different books'
    )
  })
})

describe('changing a segment', () => {
  it('refuses everyone but its author, shared or not', async () => {
    const { crmSegmentMutations, crmSegmentQueries } = await import(
      '@src/domains/crm/resolvers/segments.js'
    )
    const list = await crmSegmentQueries.crmSegments(null, {}, ctx(asha))
    const shared = list.find((s) => s.name === 'Desk priority')
    assert.ok(shared, 'the shared segment is missing')

    // Asha can read it. She cannot rewrite what the desk works from.
    const edit = await crmSegmentMutations.crmUpdateSegment(
      null,
      { id: shared.id, name: 'Hijacked' },
      ctx(asha)
    )
    assert.equal(edit.ok, false)
    assert.match(String(edit.error), /not found/i)

    const remove = await crmSegmentMutations.crmDeleteSegment(null, { id: shared.id }, ctx(asha))
    assert.equal(remove.ok, false)

    const stillThere = (await crmSegmentQueries.crmSegments(null, {}, ctx(asha))).find(
      (s) => s.id === shared.id
    )
    assert.ok(stillThere, 'the segment was removed by someone who does not own it')
    assert.equal(stillThere.name, 'Desk priority', 'the segment was renamed by a non-owner')
  })

  it("does not reach another whitelabel's segment", async () => {
    const { crmSegmentMutations, crmSegmentQueries } = await import(
      '@src/domains/crm/resolvers/segments.js'
    )
    const mine = (await crmSegmentQueries.crmSegments(null, {}, ctx(asha))).find(
      (s) => s.name === 'My chases'
    )
    assert.ok(mine)

    // Same id, same owner id, different tenant on the token.
    const res = await crmSegmentMutations.crmUpdateSegment(
      null,
      { id: mine.id, name: 'Reached across' },
      ctx(asha, AGENT, OTHER)
    )
    assert.equal(res.ok, false)

    const after = (await crmSegmentQueries.crmSegments(null, {}, ctx(asha))).find(
      (s) => s.id === mine.id
    )
    assert.equal(after?.name, 'My chases', 'a segment was edited from another whitelabel')
  })

  it('lets its author rename and delete it', async () => {
    const { crmSegmentMutations, crmSegmentQueries } = await import(
      '@src/domains/crm/resolvers/segments.js'
    )
    const created = await crmSegmentMutations.crmCreateSegment(null, { name: 'Temporary' }, ctx(bruno))
    assert.equal(created.ok, true, created.error)

    const mine = (await crmSegmentQueries.crmSegments(null, {}, ctx(bruno))).find(
      (s) => s.name === 'Temporary'
    )
    assert.ok(mine)
    assert.equal(mine.isMine, true)

    const renamed = await crmSegmentMutations.crmUpdateSegment(
      null,
      { id: mine.id, name: 'Renamed' },
      ctx(bruno)
    )
    assert.equal(renamed.ok, true, renamed.error)

    const gone = await crmSegmentMutations.crmDeleteSegment(null, { id: mine.id }, ctx(bruno))
    assert.equal(gone.ok, true, gone.error)
    assert.equal(
      (await crmSegmentQueries.crmSegments(null, {}, ctx(bruno))).some((s) => s.id === mine.id),
      false
    )
  })
})

// ---------------------------------------------------------------------------
// Bulk task creation
// ---------------------------------------------------------------------------

describe('raising one task for many players', () => {
  it('refuses without crm.tasks:manage', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    await assert.rejects(
      () =>
        crmTaskMutations.crmCreateTasksForPlayers(
          null,
          { playerIds: ashaPlayers.map(String), bookId: ashaBook, title: 'Chase', slaMinutes: 60 },
          ctx(asha, [{ domain: 'crm.tasks', actions: ['view'] }])
        ),
      /Forbidden/
    )
  })

  it('refuses a book the caller does not work', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmCreateTasksForPlayers(
      null,
      { playerIds: ashaPlayers.map(String), bookId: brunoBook, title: 'Chase', slaMinutes: 60 },
      ctx(asha)
    )
    assert.equal(res.ok, false)
    assert.match(String(res.error), /not in your books/i)
    assert.equal(res.created, 0)
  })

  it('refuses an SLA below the floor and an unknown priority', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const short = await crmTaskMutations.crmCreateTasksForPlayers(
      null,
      { playerIds: ashaPlayers.map(String), bookId: ashaBook, title: 'Chase', slaMinutes: 1 },
      ctx(asha)
    )
    assert.equal(short.ok, false)
    assert.match(String(short.error), /at least 5 minutes/i)

    const bad = await crmTaskMutations.crmCreateTasksForPlayers(
      null,
      {
        playerIds: ashaPlayers.map(String),
        bookId: ashaBook,
        title: 'Chase',
        slaMinutes: 60,
        priority: 'WHENEVER',
      },
      ctx(asha)
    )
    assert.equal(bad.ok, false)
    assert.match(String(bad.error), /priority/i)
  })

  it('refuses a title the column cannot hold, rather than letting Postgres raise it', async () => {
    // `crm_tasks.title` is varchar(160) and Postgres does not truncate — it
    // raises 22001, which escaped `createTask` unhandled and reached the
    // operator as nothing at all. Both task paths check it, and the bulk loop
    // additionally counts a thrown row as failed rather than losing the batch.
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')

    const single = await crmTaskMutations.crmCreateTask(
      null,
      { bookId: ashaBook, title: 'x'.repeat(161), slaMinutes: 60 },
      ctx(asha)
    )
    assert.equal(single.ok, false)
    assert.match(String(single.error), /under 160 characters/i)

    const bulk = await crmTaskMutations.crmCreateTasksForPlayers(
      null,
      { playerIds: ashaPlayers.map(String), bookId: ashaBook, title: 'x'.repeat(161), slaMinutes: 60 },
      ctx(asha)
    )
    assert.equal(bulk.ok, false)
    assert.match(String(bulk.error), /under 160 characters/i)
    assert.equal(bulk.created, 0, 'part of an over-long batch was created')

    // Exactly at the limit is still accepted.
    const atLimit = await crmTaskMutations.crmCreateTask(
      null,
      { bookId: ashaBook, title: 'y'.repeat(160), slaMinutes: 60 },
      ctx(asha)
    )
    assert.equal(atLimit.ok, true, atLimit.error)
  })

  it('refuses more players than the cap, rather than creating some of them', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const tooMany = Array.from({ length: 201 }, (_, i) => String(900000 + i))
    const res = await crmTaskMutations.crmCreateTasksForPlayers(
      null,
      { playerIds: tooMany, bookId: ashaBook, title: 'Chase', slaMinutes: 60 },
      ctx(asha)
    )
    assert.equal(res.ok, false)
    assert.match(String(res.error), /at most 200/i)
    assert.equal(res.created, 0, 'part of an over-cap batch was created')
  })

  it('creates one task per player and reports the count', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmCreateTasksForPlayers(
      null,
      { playerIds: ashaPlayers.map(String), bookId: ashaBook, title: 'Welcome call', slaMinutes: 60 },
      ctx(asha)
    )
    assert.equal(res.ok, true, res.error)
    assert.equal(res.created, ashaPlayers.length)
    assert.equal(res.skippedDuplicate, 0)
    assert.equal(res.skippedUnreachable, 0)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute(sql`
      SELECT player_id, source FROM crm_tasks
      WHERE tenant = ${TENANT} AND title = 'Welcome call'`)
    assert.equal(rows.rows.length, ashaPlayers.length)
    assert.deepEqual(
      (rows.rows as Array<{ player_id: number }>).map((r) => Number(r.player_id)).sort(),
      [...ashaPlayers].sort()
    )
    assert.equal((rows.rows[0] as { source: string }).source, 'bulk', 'the batch is not attributable')
  })

  it('a second identical batch creates nothing and says so — the double-click case', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmCreateTasksForPlayers(
      null,
      { playerIds: ashaPlayers.map(String), bookId: ashaBook, title: 'Welcome call', slaMinutes: 60 },
      ctx(asha)
    )
    assert.equal(res.ok, true, res.error)
    assert.equal(res.created, 0, 'a repeated batch created duplicate tasks')
    assert.equal(res.skippedDuplicate, ashaPlayers.length)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute(sql`
      SELECT count(*)::int n FROM crm_tasks WHERE tenant = ${TENANT} AND title = 'Welcome call'`)
    assert.equal(
      (rows.rows[0] as { n: number }).n,
      ashaPlayers.length,
      'the queue now holds the same work twice'
    )
  })

  it('skips a player outside the caller’s books and counts them separately', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmCreateTasksForPlayers(
      null,
      {
        // One of hers, plus Bruno's — the crafted-id case.
        playerIds: [String(ashaPlayers[0]), String(brunoPlayer)],
        bookId: ashaBook,
        title: 'Mixed batch',
        slaMinutes: 60,
      },
      ctx(asha)
    )
    assert.equal(res.ok, true, res.error)
    assert.equal(res.created, 1)
    assert.equal(res.skippedUnreachable, 1)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute(sql`
      SELECT player_id FROM crm_tasks WHERE tenant = ${TENANT} AND title = 'Mixed batch'`)
    assert.equal(rows.rows.length, 1)
    assert.equal(
      Number((rows.rows[0] as { player_id: number }).player_id),
      ashaPlayers[0],
      "a task was created against another desk's player"
    )
  })

  it('gives every task a calendar-aware deadline, like a single one', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmCreateTasksForPlayers(
      null,
      { playerIds: [String(ashaPlayers[0])], bookId: ashaBook, title: 'Deadline check', slaMinutes: 90 },
      ctx(asha)
    )
    assert.equal(res.ok, true, res.error)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute(sql`
      SELECT due_at, breach_at, sla_minutes FROM crm_tasks
      WHERE tenant = ${TENANT} AND title = 'Deadline check'`)
    const row = rows.rows[0] as { due_at: Date; breach_at: Date; sla_minutes: number }
    assert.ok(row.due_at, 'a bulk task has no deadline')
    assert.equal(Number(row.sla_minutes), 90)
    // breach_at is constrained to due_at + sla; assert it rather than trust it.
    assert.equal(
      new Date(row.breach_at).getTime() - new Date(row.due_at).getTime(),
      90 * 60_000
    )
  })
})

describe('deleting a CRM user', () => {
  it('succeeds for someone who has written a note, keeping the note and its attribution', async () => {
    // `crm_player_notes.author_crm_user_id` is ON DELETE SET NULL so a note can
    // outlive its author — `author_name` is snapshotted for exactly that. But
    // the table also demanded *exactly* one author column, so nulling the CRM
    // one raised `crm_player_notes_one_author` and the delete failed outright:
    // `crmDeleteUser` was unusable for any desk user who had ever written a
    // note, which is nearly all of them.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { deleteCrmUser } = await import('@src/repos/crm/CrmUsersRepo.js')
    const { listPlayerNotes } = await import('@src/repos/crm/CrmNotesRepo.js')

    const scribe = await makeUser(TENANT, 'Scribe')
    await db.execute(sql`
      INSERT INTO crm_player_notes (tenant, player_id, body, author_crm_user_id, author_name)
      VALUES (${TENANT}, ${ashaPlayers[0]}, 'prefers evening calls', ${scribe}::uuid, 'Scribe')`)

    assert.equal(await deleteCrmUser(TENANT, scribe), true, 'the account could not be deleted')

    const notes = await listPlayerNotes(TENANT, ashaPlayers[0], 'crm')
    const orphan = notes.find((n) => n.body === 'prefers evening calls')
    assert.ok(orphan, 'the note was deleted along with its author')
    assert.equal(orphan.authorName, 'Scribe', 'the snapshotted name is what keeps attribution')
    assert.equal(
      orphan.authorKind,
      'crm',
      'an orphaned CRM note must not be re-attributed to the admin panel'
    )

    await db.execute(sql`
      DELETE FROM crm_player_notes WHERE tenant = ${TENANT} AND body = 'prefers evening calls'`)
  })

  it('takes their personal segments and leaves the shared one standing', async () => {
    const { crmSegmentMutations, crmSegmentQueries } = await import(
      '@src/domains/crm/resolvers/segments.js'
    )
    const { deleteCrmUser } = await import('@src/repos/crm/CrmUsersRepo.js')

    const leaver = await makeUser(TENANT, 'Leaver')
    const personal = await crmSegmentMutations.crmCreateSegment(
      null,
      { name: 'Leaver personal' },
      ctx(leaver)
    )
    assert.equal(personal.ok, true, personal.error)

    assert.equal(await deleteCrmUser(TENANT, leaver), true)

    const seen = await crmSegmentQueries.crmSegments(null, {}, ctx(supervisor, SUPERVISOR))
    assert.equal(
      seen.some((s) => s.name === 'Leaver personal'),
      false,
      'a personal segment outlived the account that owned it'
    )
    assert.ok(
      seen.some((s) => s.name === 'Desk priority'),
      'a shared segment was removed with an unrelated account'
    )
  })
})
