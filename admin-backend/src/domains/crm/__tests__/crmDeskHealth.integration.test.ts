/**
 * Desk health — what is falling through, right now.
 *
 * The property that matters most is the one the queue cannot show: a task the
 * escalation ladder could not deliver to anybody. The sweep already detects
 * that and writes `escalation_failed`; until this view existed nothing read
 * those events, so a task could reach nobody every two hours indefinitely and
 * leave no trace anyone would see.
 *
 * The second is subtler and is the reason this file exists at all: "uncovered
 * book" must mean exactly what the *sweep* means by it. The ladder falls back to
 * any escalate-holder in the tenant when a book has none, so a book with no
 * escalate-holding member is not automatically broken. A health view that
 * decided this for itself would eventually report a healthy desk while the
 * sweep kept reaching nobody.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-health-${randomUUID().slice(0, 8)}`

let bookA = ''
let bookB = ''
let supervisorId = ''
let agentId = ''
let playerA = 0
let playerB = 0

async function makeUser(
  name: string,
  permissions: Array<{ domain: string; action: string }>
): Promise<string> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const role = await db.execute(sql`
    INSERT INTO crm_roles (tenant, name, is_system)
    VALUES (${TENANT}, ${'role-' + name + randomUUID().slice(0, 4)}, false) RETURNING id`)
  const roleId = String((role.rows[0] as { id: string }).id)
  for (const p of permissions) {
    await db.execute(sql`
      INSERT INTO crm_role_permissions (role_id, domain, action)
      VALUES (${roleId}::uuid, ${p.domain}, ${p.action})`)
  }
  const user = await db.execute(sql`
    INSERT INTO crm_users (tenant, name, status) VALUES (${TENANT}, ${name}, 'ACTIVE') RETURNING id`)
  const id = String((user.rows[0] as { id: string }).id)
  await db.execute(sql`
    INSERT INTO crm_user_roles (crm_user_id, role_id) VALUES (${id}::uuid, ${roleId}::uuid)`)
  return id
}

async function makeTask(opts: {
  bookId: string
  assigneeId?: string | null
  breachedHoursAgo?: number
  level?: number
  acknowledged?: boolean
  playerId?: number | null
  title?: string
}): Promise<string> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const hours = opts.breachedHoursAgo ?? 3
  const r = await db.execute(sql`
    INSERT INTO crm_tasks (tenant, book_id, player_id, assignee_id, created_by, title,
                           due_at, sla_minutes, breach_at, escalation_level, acknowledged_at)
    VALUES (${TENANT}, ${opts.bookId}::uuid, ${opts.playerId ?? null}, ${opts.assigneeId ?? null}::uuid,
            'test', ${opts.title ?? 'Call the player back'},
            now() - make_interval(hours => ${hours + 1}), 60,
            now() - make_interval(hours => ${hours}),
            ${opts.level ?? 0},
            ${opts.acknowledged ? sql`now()` : sql`NULL`})
    RETURNING id`)
  return String((r.rows[0] as { id: string }).id)
}

async function failEscalation(taskId: string, times: number): Promise<void> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (let i = 0; i < times; i++) {
    await db.execute(sql`
      INSERT INTO crm_task_events (tenant, task_id, kind, actor, note, created_at)
      VALUES (${TENANT}, ${taskId}::uuid, 'escalation_failed', 'system',
              'No active user in this book holds crm.tasks:escalate',
              now() - make_interval(hours => ${(times - i) * 2}))`)
  }
}

async function health(scope: { viewAll: boolean; bookIds: string[] }) {
  const { getDeskHealth } = await import('@src/repos/crm/CrmDeskHealthRepo.js')
  return getDeskHealth({ tenant: TENANT, ...scope })
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  await db.execute(sql`
    INSERT INTO crm_whitelabel_settings (tenant, enabled, seat_limit, timezone, desk_open_minute, desk_close_minute, desk_days)
    VALUES (${TENANT}, true, 20, 'UTC', 0, 1440, '{1,2,3,4,5,6,7}')`)

  for (const name of ['Book A', 'Book B']) {
    const b = await db.execute(sql`
      INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, ${name}) RETURNING id`)
    const id = String((b.rows[0] as { id: string }).id)
    if (!bookA) bookA = id
    else bookB = id
  }

  supervisorId = await makeUser('Supervisor', [{ domain: 'crm.tasks', action: 'escalate' }])
  agentId = await makeUser('Agent', [{ domain: 'crm.tasks', action: 'manage' }])
  await db.execute(sql`
    INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${bookA}::uuid, ${supervisorId}::uuid)`)
  await db.execute(sql`
    INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${bookA}::uuid, ${agentId}::uuid)`)

  for (const name of ['Health One', 'Health Two']) {
    const p = await db.execute(sql`
      INSERT INTO users (tenant, name, username, phone, password_hash)
      VALUES (${TENANT}, ${name}, ${name.replace(/\s/g, '').toLowerCase() + randomUUID().slice(0, 5)},
              ${'9' + Math.floor(Math.random() * 1e9)}, 'x')
      RETURNING id`)
    const id = Number((p.rows[0] as { id: number }).id)
    if (!playerA) playerA = id
    else playerB = id
  }
  await db.execute(sql`
    INSERT INTO crm_player_assignments (tenant, player_id, book_id) VALUES (${TENANT}, ${playerA}, ${bookA}::uuid)`)
  await db.execute(sql`
    INSERT INTO crm_player_assignments (tenant, player_id, book_id) VALUES (${TENANT}, ${playerB}, ${bookB}::uuid)`)
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const stmt of [
    sql`DELETE FROM crm_contact_attempts WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_task_events WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_tasks WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_player_assignments WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_book_members WHERE book_id IN (SELECT id FROM crm_books WHERE tenant = ${TENANT})`,
    sql`DELETE FROM crm_books WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_user_roles WHERE crm_user_id IN (SELECT id FROM crm_users WHERE tenant = ${TENANT})`,
    sql`DELETE FROM crm_role_permissions WHERE role_id IN (SELECT id FROM crm_roles WHERE tenant = ${TENANT})`,
    sql`DELETE FROM crm_users WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_roles WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${TENANT}`,
    sql`DELETE FROM users WHERE tenant = ${TENANT}`,
  ]) {
    await db.execute(stmt)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
  const { closeRedisClient } = await import('@src/config/redisClient.js')
  await closeRedisClient()
})

describe('a task that reached nobody is surfaced once, with how often it failed', () => {
  let taskId = ''

  it('shows a repeatedly-failing task as one row', async () => {
    // The sweep rewrites `escalation_failed` every two hours for as long as the
    // problem lasts. Counting events would show the same task over and over.
    taskId = await makeTask({ bookId: bookA, assigneeId: agentId, title: 'Nobody heard this' })
    await failEscalation(taskId, 3)

    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(h.reachedNobody.total, 1, 'one task, not three events')
    assert.equal(h.reachedNobody.rows[0].id, taskId)
  })

  it('reports the repeat count, because that is the severity', async () => {
    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(h.reachedNobody.rows[0].failedAttempts, 3)
    assert.ok(h.reachedNobody.rows[0].firstFailedAt, 'and when it started')
    assert.ok(h.reachedNobody.rows[0].minutesOverdue > 0, 'and how late it is')
  })

  it('drops it once somebody acknowledges it', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`UPDATE crm_tasks SET acknowledged_at = now() WHERE id = ${taskId}::uuid`)

    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(h.reachedNobody.total, 0, 'the events remain, but the problem is over')
  })

  it('ignores the same events once the task is closed', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      UPDATE crm_tasks SET acknowledged_at = NULL, status = 'DONE', outcome = 'resolved', completed_at = now()
      WHERE id = ${taskId}::uuid`)

    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(h.reachedNobody.total, 0, 'history must not fill the list')
  })
})

describe('an uncovered book means what the sweep means by it', () => {
  it('a book whose members hold escalate is covered', async () => {
    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(
      h.uncoveredBooks.rows.some((b) => b.bookId === bookA),
      false,
      'Book A has a supervisor holding crm.tasks:escalate'
    )
  })

  it('a book with no escalate-holding member is still covered by the tenant-wide fallback', async () => {
    // Book B has no members at all. The ladder widens to any escalate-holder in
    // the tenant, and the supervisor qualifies — so it is not broken, and
    // reporting it as broken would send someone to fix nothing.
    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(
      h.uncoveredBooks.rows.some((b) => b.bookId === bookB),
      false,
      'the fallback covers it'
    )
  })

  it('becomes uncovered only when the tenant has no escalate-holder either', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      DELETE FROM crm_role_permissions
      WHERE domain = 'crm.tasks' AND action = 'escalate'
        AND role_id IN (SELECT id FROM crm_roles WHERE tenant = ${TENANT})`)

    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(h.uncoveredBooks.total, 2, 'now neither book can reach anybody')
  })

  it('agrees with resolveEscalationTargets, which is what the sweep asks', async () => {
    // The whole point: one definition, used by both. If these ever disagree the
    // screen reports a healthy desk while the sweep keeps failing.
    const { resolveEscalationTargets } = await import('@src/repos/crm/CrmEscalationRepo.js')
    const h = await health({ viewAll: true, bookIds: [] })
    for (const book of [bookA, bookB]) {
      const targets = await resolveEscalationTargets(TENANT, book, null)
      const flagged = h.uncoveredBooks.rows.some((b) => b.bookId === book)
      assert.equal(
        flagged,
        targets.length === 0,
        `book ${book}: view says uncovered=${flagged}, sweep would find ${targets.length} recipients`
      )
    }
  })

  it('restores cover when the permission comes back', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const role = await db.execute(sql`
      SELECT r.id FROM crm_roles r
      JOIN crm_user_roles ur ON ur.role_id = r.id
      WHERE ur.crm_user_id = ${supervisorId}::uuid LIMIT 1`)
    await db.execute(sql`
      INSERT INTO crm_role_permissions (role_id, domain, action)
      VALUES (${String((role.rows[0] as { id: string }).id)}::uuid, 'crm.tasks', 'escalate')`)

    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(h.uncoveredBooks.total, 0)
  })
})

describe('the other task buckets', () => {
  it('lists work nobody owns', async () => {
    await makeTask({ bookId: bookA, assigneeId: null, title: 'Nobody owns this' })
    const h = await health({ viewAll: true, bookIds: [] })
    assert.ok(h.unassigned.total >= 1)
    assert.ok(h.unassigned.rows.some((t) => t.title === 'Nobody owns this'))
  })

  it('lists a ladder that has run out of rungs', async () => {
    await makeTask({ bookId: bookA, assigneeId: agentId, level: 3, title: 'Climbed as far as it goes' })
    const h = await health({ viewAll: true, bookIds: [] })
    assert.ok(h.ladderExhausted.rows.some((t) => t.title === 'Climbed as far as it goes'))
  })

  it('lists what is simply late, oldest first', async () => {
    await makeTask({ bookId: bookA, assigneeId: agentId, breachedHoursAgo: 30, title: 'Very late' })
    const h = await health({ viewAll: true, bookIds: [] })
    assert.ok(h.breaching.total >= 1)
    assert.equal(h.breaching.rows[0].title, 'Very late', 'the oldest breach leads')
    assert.ok(h.breaching.rows[0].minutesOverdue > 1000)
  })
})

describe('players the desk keeps failing to reach', () => {
  async function attempt(playerId: number, outcome: string, daysAgo = 1) {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      INSERT INTO crm_contact_attempts (tenant, player_id, channel, direction, outcome, by_name, occurred_at)
      VALUES (${TENANT}, ${playerId}, 'CALL', 'out', ${outcome}, 'Tester',
              now() - make_interval(days => ${daysAgo}))`)
  }

  it('three unanswered attempts put a player on the list', async () => {
    await attempt(playerA, 'no_answer')
    await attempt(playerA, 'no_answer')
    await attempt(playerA, 'no_answer')
    const h = await health({ viewAll: true, bookIds: [] })
    const row = h.neverReached.rows.find((p) => p.playerId === playerA)
    assert.ok(row, 'three failures is when the desk should look')
    assert.equal(row!.attempts, 3)
  })

  it('a single connection clears them — the point is runs of failure', async () => {
    await attempt(playerA, 'connected')
    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(
      h.neverReached.rows.some((p) => p.playerId === playerA),
      false
    )
  })

  it('attempts outside the window do not count', async () => {
    await attempt(playerB, 'no_answer', 40)
    await attempt(playerB, 'no_answer', 40)
    await attempt(playerB, 'no_answer', 40)
    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(
      h.neverReached.rows.some((p) => p.playerId === playerB),
      false,
      'a run from six weeks ago is not a live problem'
    )
  })
})

describe('scope', () => {
  it('a caller sees only their own books', async () => {
    await makeTask({ bookId: bookB, assigneeId: null, title: 'Other desk work' })
    const h = await health({ viewAll: false, bookIds: [bookA] })
    assert.equal(
      h.unassigned.rows.some((t) => t.title === 'Other desk work'),
      false,
      'Book B is not theirs'
    )
    assert.ok(h.unassigned.rows.some((t) => t.title === 'Nobody owns this'), 'Book A is')
  })

  it('view_all sees both', async () => {
    const h = await health({ viewAll: true, bookIds: [] })
    assert.ok(h.unassigned.rows.some((t) => t.title === 'Other desk work'))
  })

  it('a caller with no books gets nothing, not everything', async () => {
    // The inversion this guards against — dropping the predicate instead of
    // matching nothing — is how every scope bug in this codebase has looked.
    const h = await health({ viewAll: false, bookIds: [] })
    assert.equal(h.unassigned.total, 0)
    assert.equal(h.breaching.total, 0)
    assert.equal(h.reachedNobody.total, 0)
    assert.equal(h.uncoveredBooks.total, 0)
    assert.equal(h.neverReached.total, 0)
    assert.equal(h.allClear, true, 'and it reads as clear, not as an error')
  })
})

describe('a healthy desk', () => {
  it('reports all clear rather than an empty page', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      UPDATE crm_tasks SET status = 'DONE', outcome = 'resolved', completed_at = now(),
                           acknowledged_at = now(), assignee_id = ${agentId}::uuid
      WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM crm_contact_attempts WHERE tenant = ${TENANT}`)

    const h = await health({ viewAll: true, bookIds: [] })
    assert.equal(h.allClear, true)
    assert.equal(h.breaching.total, 0)
    assert.equal(h.unassigned.total, 0)
  })
})
