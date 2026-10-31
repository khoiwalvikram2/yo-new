/**
 * Task by-id operations, when the id survives the reason it was reachable.
 *
 * `crmTasks` scopes its list by book membership. Everything that reaches a
 * task through its id instead — status changes, reassignment, event history,
 * creation into a named book, and the assignee named on a create or reassign —
 * did not use to check that at all: tenant and the row's own existence were
 * the only gates. A task id (or an assignee id) outlives the reason it was
 * legitimately held, because a player moves books and a crm_users.id carries
 * no tenant of its own.
 *
 * `crmAcknowledgeTask` is deliberately not covered here: the escalation
 * ladder's own fallback notifies a tenant-wide `crm.tasks:escalate` holder
 * precisely when nobody *in* the book holds it, so acknowledging from outside
 * the book is by design, not a gap. That path stays gated by the escalate
 * permission alone.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-taskscope-${randomUUID().slice(0, 8)}`
const OTHER_TENANT = `crm-taskscope-other-${randomUUID().slice(0, 8)}`

let bookA = ''
let bookB = ''
let aliceId = ''
let adminId = ''
let foreignUserId = ''
let taskInA = ''

/** A CRM user with the given permissions, in this tenant. */
async function makeUser(
  tenant: string,
  name: string,
  permissions: Array<{ domain: string; action: string }>
): Promise<string> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const role = await db.execute(sql`
    INSERT INTO crm_roles (tenant, name, is_system) VALUES (${tenant}, ${'role-' + name + randomUUID().slice(0, 4)}, false)
    RETURNING id`)
  const roleId = String((role.rows[0] as { id: string }).id)
  for (const p of permissions) {
    await db.execute(sql`
      INSERT INTO crm_role_permissions (role_id, domain, action)
      VALUES (${roleId}::uuid, ${p.domain}, ${p.action})`)
  }
  const user = await db.execute(sql`
    INSERT INTO crm_users (tenant, name, status) VALUES (${tenant}, ${name}, 'ACTIVE') RETURNING id`)
  const userId = String((user.rows[0] as { id: string }).id)
  await db.execute(sql`
    INSERT INTO crm_user_roles (crm_user_id, role_id) VALUES (${userId}::uuid, ${roleId}::uuid)`)
  return userId
}

function ctxFor(userId: string, tenant: string, permissions: Array<{ domain: string; actions: string[] }>) {
  return {
    crmUser: { id: userId, name: 'Test', tenant, status: 'ACTIVE', requirePasswordReset: false },
    permissions,
  } as any
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  const a = await db.execute(sql`INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, 'Book A') RETURNING id`)
  bookA = String((a.rows[0] as { id: string }).id)
  const b = await db.execute(sql`INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, 'Book B') RETURNING id`)
  bookB = String((b.rows[0] as { id: string }).id)

  // Alice: a book-A-only agent. No view_all, so scope comes entirely from
  // membership.
  aliceId = await makeUser(TENANT, 'Alice', [
    { domain: 'crm.tasks', action: 'view' },
    { domain: 'crm.tasks', action: 'manage' },
  ])
  await db.execute(sql`
    INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${bookA}::uuid, ${aliceId}::uuid)`)

  adminId = await makeUser(TENANT, 'Admin', [
    { domain: 'crm.tasks', action: 'view' },
    { domain: 'crm.tasks', action: 'manage' },
    { domain: 'crm.players', action: 'view_all' },
  ])

  foreignUserId = await makeUser(OTHER_TENANT, 'Foreign', [{ domain: 'crm.tasks', action: 'manage' }])

  const t = await db.execute(sql`
    INSERT INTO crm_tasks (tenant, book_id, created_by, title, due_at, sla_minutes, breach_at, next_escalation_at)
    VALUES (${TENANT}, ${bookA}::uuid, 'test', 'Follow up', now() + interval '1 day', 60,
            now() + interval '1 day' + make_interval(mins => 60), now() + interval '1 day')
    RETURNING id`)
  taskInA = String((t.rows[0] as { id: string }).id)
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const tenant of [TENANT, OTHER_TENANT]) {
    await db.execute(sql`DELETE FROM crm_notifications WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_task_events WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_tasks WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_book_members WHERE book_id IN (SELECT id FROM crm_books WHERE tenant = ${tenant})`)
    await db.execute(sql`DELETE FROM crm_books WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_user_roles WHERE crm_user_id IN (SELECT id FROM crm_users WHERE tenant = ${tenant})`)
    await db.execute(sql`DELETE FROM crm_role_permissions WHERE role_id IN (SELECT id FROM crm_roles WHERE tenant = ${tenant})`)
    await db.execute(sql`DELETE FROM crm_roles WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${tenant}`)
  }
})

const aliceCtx = () => ctxFor(aliceId, TENANT, [{ domain: 'crm.tasks', actions: ['view', 'manage'] }])
const adminCtx = () =>
  ctxFor(adminId, TENANT, [
    { domain: 'crm.tasks', actions: ['view', 'manage'] },
    { domain: 'crm.players', actions: ['view_all'] },
  ])

describe('while the task is in scope, Alice can act on it', () => {
  it('reads its events', async () => {
    const { crmTaskQueries } = await import('@src/domains/crm/resolvers/tasks.js')
    const rows = await crmTaskQueries.crmTaskEvents(null, { taskId: taskInA }, aliceCtx())
    assert.ok(Array.isArray(rows))
  })

  it('sets its status', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmSetTaskStatus(
      null,
      { taskId: taskInA, status: 'IN_PROGRESS' },
      aliceCtx()
    )
    assert.equal(res.ok, true, res.error ?? '')
  })
})

describe('once the task moves to a book Alice is not in, every by-id path refuses it', () => {
  it('moves the task to Book B', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`UPDATE crm_tasks SET book_id = ${bookB}::uuid WHERE id = ${taskInA}::uuid`)
  })

  it('crmTaskEvents returns nothing rather than the event trail', async () => {
    // Finding #5: this used to return the full trail — actor/assignee ids,
    // status transitions, escalation levels — for a task outside the caller's
    // books.
    const { crmTaskQueries } = await import('@src/domains/crm/resolvers/tasks.js')
    const rows = await crmTaskQueries.crmTaskEvents(null, { taskId: taskInA }, aliceCtx())
    assert.deepEqual(rows, [], 'out of scope must look identical to no events')
  })

  it('crmSetTaskStatus refuses to cancel another desk\'s task', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmSetTaskStatus(
      null,
      { taskId: taskInA, status: 'CANCELLED' },
      aliceCtx()
    )
    assert.equal(res.ok, false)
    assert.equal(res.error, 'Task not found')

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const row = await db.execute(sql`SELECT status::text FROM crm_tasks WHERE id = ${taskInA}::uuid`)
    assert.notEqual(
      (row.rows[0] as { status: string }).status,
      'CANCELLED',
      'the refusal must not have partially applied'
    )
  })

  it('crmAssignTask refuses to reassign it to herself', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmAssignTask(null, { taskId: taskInA, assigneeId: aliceId }, aliceCtx())
    assert.equal(res.ok, false)
    assert.equal(res.error, 'Task not found')
  })

  it('an admin with view_all reaches it exactly as before', async () => {
    const { crmTaskQueries, crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const events = await crmTaskQueries.crmTaskEvents(null, { taskId: taskInA }, adminCtx())
    assert.ok(Array.isArray(events))
    const res = await crmTaskMutations.crmSetTaskStatus(
      null,
      { taskId: taskInA, status: 'IN_PROGRESS' },
      adminCtx()
    )
    assert.equal(res.ok, true, res.error ?? '')
  })
})

describe('crmCreateTask refuses a book Alice is not a member of', () => {
  it('is refused, not merely validated for existence', async () => {
    // Finding #5: createTask previously checked only that the book existed in
    // the tenant, so a manage holder with no membership anywhere could inject
    // a task into any desk's queue.
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmCreateTask(
      null,
      { bookId: bookB, title: 'Injected', slaMinutes: 60 },
      aliceCtx()
    )
    assert.equal(res.ok, false)
    assert.equal(res.error, 'That book is not in your books')
  })

  it('succeeds in her own book', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmCreateTask(
      null,
      { bookId: bookA, title: 'Legitimate follow-up', slaMinutes: 60 },
      aliceCtx()
    )
    assert.equal(res.ok, true, res.error ?? '')
  })
})

describe('an assignee must belong to the same tenant', () => {
  it('crmCreateTask refuses a foreign-tenant assignee', async () => {
    // Finding #9: crm_users.id carries no tenant component, so an id from
    // another tenant validated as a well-formed uuid with nothing else to
    // catch it — writing a notification into a foreign tenant's inbox and
    // rendering its holder's name in this tenant's queue.
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmCreateTask(
      null,
      { bookId: bookA, title: 'Should not assign cross-tenant', slaMinutes: 60, assigneeId: foreignUserId },
      aliceCtx()
    )
    assert.equal(res.ok, false)
    assert.equal(res.error, 'Unknown assignee')
  })

  it('crmAssignTask refuses the same foreign-tenant id', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmCreateTask(
      null,
      { bookId: bookA, title: 'Reassign target', slaMinutes: 60 },
      aliceCtx()
    )
    assert.equal(res.ok, true, res.error ?? '')

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const row = await db.execute(sql`
      SELECT id FROM crm_tasks WHERE tenant = ${TENANT} AND title = 'Reassign target' LIMIT 1`)
    const taskId = String((row.rows[0] as { id: string }).id)

    const assignRes = await crmTaskMutations.crmAssignTask(
      null,
      { taskId, assigneeId: foreignUserId },
      aliceCtx()
    )
    assert.equal(assignRes.ok, false)
    assert.equal(assignRes.error, 'Unknown assignee')

    // Confirmed untouched — no notification was written into the foreign
    // tenant's inbox either.
    const foreignInbox = await db.execute(sql`
      SELECT count(*)::int AS n FROM crm_notifications
      WHERE tenant = ${OTHER_TENANT} AND crm_user_id = ${foreignUserId}::uuid`)
    assert.equal(Number((foreignInbox.rows[0] as { n: number }).n), 0)
  })

  it('assigns cleanly to a same-tenant user', async () => {
    const { crmTaskMutations } = await import('@src/domains/crm/resolvers/tasks.js')
    const res = await crmTaskMutations.crmAssignTask(null, { taskId: taskInA, assigneeId: aliceId }, adminCtx())
    assert.equal(res.ok, true, res.error ?? '')
  })
})
