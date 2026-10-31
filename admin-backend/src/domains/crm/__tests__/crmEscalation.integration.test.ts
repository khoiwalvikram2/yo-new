/**
 * The escalation ladder.
 *
 * The property that matters most is the one nobody thinks to test: escalating
 * to *nobody* must not look like success. A sweep that stamps "escalated" on a
 * task no human was told about hides precisely the case a supervisor needs to
 * see — a book with no cover.
 *
 * Also asserted: two sweeps racing produce one escalation per level, and the
 * ladder does not climb outside desk hours.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-esc-${randomUUID().slice(0, 8)}`

let bookId = ''
let supervisorId = ''
let agentId = ''
let playerId = 0

/** A CRM user with the given permissions, in this tenant. */
async function makeUser(
  name: string,
  permissions: Array<{ domain: string; action: string }>
): Promise<string> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const role = await db.execute(sql`
    INSERT INTO crm_roles (tenant, name, is_system) VALUES (${TENANT}, ${'role-' + name}, false)
    RETURNING id`)
  const roleId = String((role.rows[0] as { id: string }).id)
  for (const p of permissions) {
    await db.execute(sql`
      INSERT INTO crm_role_permissions (role_id, domain, action)
      VALUES (${roleId}::uuid, ${p.domain}, ${p.action})`)
  }
  const user = await db.execute(sql`
    INSERT INTO crm_users (tenant, name, status) VALUES (${TENANT}, ${name}, 'ACTIVE') RETURNING id`)
  const userId = String((user.rows[0] as { id: string }).id)
  await db.execute(sql`
    INSERT INTO crm_user_roles (crm_user_id, role_id) VALUES (${userId}::uuid, ${roleId}::uuid)`)
  return userId
}

/** Makes a task that is already past its deadline. */
async function makeBreachingTask(opts: { assigneeId?: string | null; bookId?: string } = {}) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`
    INSERT INTO crm_tasks (tenant, book_id, assignee_id, created_by, title, due_at, sla_minutes, breach_at, next_escalation_at)
    VALUES (${TENANT}, ${opts.bookId ?? bookId}::uuid, ${opts.assigneeId ?? null}::uuid, 'test',
            'Call the player back',
            now() - interval '3 hours', 60,
            now() - interval '3 hours' + make_interval(mins => 60),
            now() - interval '1 hour')
    RETURNING id`)
  return String((r.rows[0] as { id: string }).id)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  // Desk open all day, every day, so the hours check never masks a result here.
  await db.execute(sql`
    INSERT INTO crm_whitelabel_settings (tenant, enabled, seat_limit, timezone, desk_open_minute, desk_close_minute, desk_days)
    VALUES (${TENANT}, true, 10, 'UTC', 0, 1440, '{1,2,3,4,5,6,7}')`)

  const book = await db.execute(sql`
    INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, 'Escalation Desk') RETURNING id`)
  bookId = String((book.rows[0] as { id: string }).id)

  supervisorId = await makeUser('Supervisor', [{ domain: 'crm.tasks', action: 'escalate' }])
  agentId = await makeUser('Agent', [{ domain: 'crm.tasks', action: 'manage' }])
  await db.execute(sql`
    INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${bookId}::uuid, ${supervisorId}::uuid)`)
  await db.execute(sql`
    INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${bookId}::uuid, ${agentId}::uuid)`)

  const p = await db.execute(sql`
    INSERT INTO users (tenant, name, username, phone, password_hash)
    VALUES (${TENANT}, 'Esc Player', ${'escplayer' + randomUUID().slice(0, 5)},
            ${'9' + Math.floor(Math.random() * 1e9)}, 'x')
    RETURNING id`)
  playerId = Number((p.rows[0] as { id: number }).id)
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const stmt of [
    sql`DELETE FROM crm_notifications WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_task_escalations WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_task_events WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_tasks WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_book_members WHERE book_id IN (SELECT id FROM crm_books WHERE tenant = ${TENANT})`,
    sql`DELETE FROM crm_books WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_users WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_roles WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${TENANT}`,
    sql`DELETE FROM users WHERE tenant = ${TENANT}`,
  ]) {
    await db.execute(stmt)
  }
})

async function eventsFor(taskId: string): Promise<string[]> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`
    SELECT kind FROM crm_task_events WHERE task_id = ${taskId}::uuid ORDER BY created_at`)
  return (r.rows as Array<{ kind: string }>).map((x) => x.kind)
}

async function levelOf(taskId: string): Promise<number> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`SELECT escalation_level FROM crm_tasks WHERE id = ${taskId}::uuid`)
  return Number((r.rows[0] as { escalation_level: number }).escalation_level)
}

describe('a breaching task reaches someone', () => {
  it('escalates to the book member who holds the permission', async () => {
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')
    const taskId = await makeBreachingTask({ assigneeId: agentId })

    const res = await runEscalationSweep(TENANT)
    assert.equal(res.escalated, 1, 'the task should escalate')
    assert.equal(res.failed, 0)
    assert.equal(await levelOf(taskId), 1)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const n = await db.execute(sql`
      SELECT crm_user_id FROM crm_notifications
      WHERE tenant = ${TENANT} AND resource_id = ${taskId} AND kind = 'task_escalated'`)
    const told = (n.rows as Array<{ crm_user_id: string }>).map((x) => x.crm_user_id)
    assert.deepEqual(told, [supervisorId], 'only the escalation-permission holder is told')
  })

  it('does not tell the assignee their own task is late', async () => {
    // The assignee already knows. Escalation exists to reach past them.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const n = await db.execute(sql`
      SELECT count(*)::int AS c FROM crm_notifications
      WHERE tenant = ${TENANT} AND crm_user_id = ${agentId}::uuid AND kind = 'task_escalated'`)
    assert.equal(Number((n.rows[0] as { c: number }).c), 0)
  })
})

describe('escalating to nobody is not a success', () => {
  it('leaves the task breaching and says why', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')

    // A book nobody covers, in a tenant where nobody else holds the permission
    // either — so both the book-level and the tenant-wide fallback are empty.
    await db.execute(sql`
      DELETE FROM crm_book_members WHERE crm_user_id = ${supervisorId}::uuid`)
    await db.execute(sql`
      DELETE FROM crm_role_permissions WHERE domain = 'crm.tasks' AND action = 'escalate'
        AND role_id IN (SELECT id FROM crm_roles WHERE tenant = ${TENANT})`)

    const taskId = await makeBreachingTask({ assigneeId: agentId })
    const res = await runEscalationSweep(TENANT)

    assert.equal(res.failed, 1, 'the sweep should report a failure')
    assert.equal(res.escalated, 0)
    assert.equal(await levelOf(taskId), 0, 'the level must not advance')
    assert.ok(
      (await eventsFor(taskId)).includes('escalation_failed'),
      'and it must say so, so a supervisor can see the book has no cover'
    )
  })

  it('escalates again once someone can receive it', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')

    // Restore cover, and make the failed task due again.
    const role = await db.execute(sql`
      SELECT id FROM crm_roles WHERE tenant = ${TENANT} AND name = 'role-Supervisor'`)
    await db.execute(sql`
      INSERT INTO crm_role_permissions (role_id, domain, action)
      VALUES (${String((role.rows[0] as { id: string }).id)}::uuid, 'crm.tasks', 'escalate')`)
    await db.execute(sql`
      INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${bookId}::uuid, ${supervisorId}::uuid)`)
    await db.execute(sql`
      UPDATE crm_tasks SET next_escalation_at = now() - interval '1 minute'
      WHERE tenant = ${TENANT} AND escalation_level = 0`)

    const res = await runEscalationSweep(TENANT)
    assert.ok(res.escalated >= 1, 'a task that failed to escalate must be retried, not abandoned')
  })
})

describe('two sweeps racing', () => {
  it('produce one escalation per level, not two', async () => {
    const { db, pool } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')

    const taskId = await makeBreachingTask({ assigneeId: agentId })
    // Warm the pool, or the two sweeps stagger and the race never happens.
    await Promise.all(Array.from({ length: 4 }, () => pool.query('SELECT pg_sleep(0.05)')))

    const [a, b] = await Promise.all([runEscalationSweep(TENANT), runEscalationSweep(TENANT)])
    assert.equal(a.claimed + b.claimed, 1, 'only one sweep may claim the task')
    assert.equal(await levelOf(taskId), 1)

    const rows = await db.execute(sql`
      SELECT count(*)::int AS c FROM crm_task_escalations
      WHERE task_id = ${taskId}::uuid AND level = 1`)
    assert.equal(Number((rows.rows[0] as { c: number }).c), 1)
  })
})

describe('acknowledgement stops the ladder', () => {
  it('takes the task out of the sweep', async () => {
    const { acknowledgeTask } = await import('@src/repos/crm/CrmTasksRepo.js')
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    const taskId = await makeBreachingTask({ assigneeId: agentId })
    assert.equal(await acknowledgeTask({ tenant: TENANT, taskId, crmUserId: supervisorId }), true)

    await db.execute(sql`
      UPDATE crm_tasks SET next_escalation_at = now() - interval '1 minute' WHERE id = ${taskId}::uuid`)
    const before = await levelOf(taskId)
    await runEscalationSweep(TENANT)
    assert.equal(await levelOf(taskId), before, 'an acknowledged task must not keep climbing')
  })

  it('cannot be acknowledged twice', async () => {
    const { acknowledgeTask } = await import('@src/repos/crm/CrmTasksRepo.js')
    const taskId = await makeBreachingTask()
    assert.equal(await acknowledgeTask({ tenant: TENANT, taskId, crmUserId: supervisorId }), true)
    assert.equal(await acknowledgeTask({ tenant: TENANT, taskId, crmUserId: agentId }), false)
  })
})

describe('the desk calendar', () => {
  it('does not climb the ladder when the desk is shut', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')

    // Shut the desk entirely.
    await db.execute(sql`
      UPDATE crm_whitelabel_settings SET desk_open_minute = 0, desk_close_minute = 0
      WHERE tenant = ${TENANT}`)
    const taskId = await makeBreachingTask({ assigneeId: agentId })

    const res = await runEscalationSweep(TENANT)
    assert.equal(res.skippedClosed, true, 'nobody could have acted, so nobody is woken')
    assert.equal(await levelOf(taskId), 0)

    await db.execute(sql`
      UPDATE crm_whitelabel_settings SET desk_open_minute = 0, desk_close_minute = 1440
      WHERE tenant = ${TENANT}`)
  })

  it('computes a deadline that falls inside working hours', async () => {
    const { addWorkingMinutes, isDeskOpen } = await import('@src/repos/crm/CrmTasksRepo.js')
    // A desk that works 09:00–17:00, Monday to Friday, in UTC.
    const hours = { timezone: 'UTC', openMinute: 540, closeMinute: 1020, days: [1, 2, 3, 4, 5] }
    // Friday 16:30 UTC + 120 working minutes must land on Monday morning, not
    // Friday evening when nobody is there.
    const friday1630 = new Date('2026-08-28T16:30:00Z')
    const due = addWorkingMinutes(friday1630, 120, hours)
    assert.ok(isDeskOpen(due, hours), 'the deadline must fall when someone could act on it')
    assert.ok(due.getTime() > friday1630.getTime())
  })
})

describe('a delegate has to be able to receive the escalation', () => {
  // Finding #8: the `holders` CTE filtered on tenant, ACTIVE status and the
  // escalate permission — and then the CASE substituted `delegate_to` *after*
  // that filtering, so whoever it named was never checked against any of it.
  // The sweep took the success branch for them: an escalation row, a
  // notification, an `escalated` event reading "1 recipient(s)", and the rung
  // advanced. Three rungs later the task exhausted the ladder having reached
  // nobody at all.
  let deputyId = ''

  it('drops a delegate suspended after cover was arranged, and reports the failure', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')

    // Take every task the earlier blocks left breaching out of the sweep, so
    // the counts below describe only the task this test creates.
    await db.execute(sql`
      UPDATE crm_tasks SET acknowledged_at = now()
      WHERE tenant = ${TENANT} AND acknowledged_at IS NULL`)

    // A second escalate-holder in the book, so cover is legitimate when set.
    deputyId = await makeUser('Deputy', [{ domain: 'crm.tasks', action: 'escalate' }])
    await db.execute(sql`
      INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${bookId}::uuid, ${deputyId}::uuid)`)

    // The supervisor goes away and names the deputy — valid at that moment.
    await db.execute(sql`
      UPDATE crm_users SET out_of_office_until = now() + interval '7 days', delegate_to = ${deputyId}::uuid
      WHERE id = ${supervisorId}::uuid`)

    // Then an administrator suspends the deputy. Nothing clears the pointer.
    await db.execute(sql`UPDATE crm_users SET status = 'SUSPENDED' WHERE id = ${deputyId}::uuid`)

    const taskId = await makeBreachingTask({ assigneeId: agentId })
    const res = await runEscalationSweep(TENANT)

    assert.equal(res.escalated, 0, 'a suspended delegate is not a recipient')
    assert.equal(res.failed, 1)
    assert.equal(await levelOf(taskId), 0, 'the rung is given back, not spent on nobody')
    assert.ok((await eventsFor(taskId)).includes('escalation_failed'))

    const told = await db.execute(sql`
      SELECT count(*)::int AS c FROM crm_notifications
      WHERE tenant = ${TENANT} AND resource_id = ${taskId} AND kind = 'task_escalated'`)
    assert.equal(Number((told.rows[0] as { c: number }).c), 0, 'and nobody was told anything')
  })

  it('drops a delegate who does not hold the escalate permission', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')

    // Reinstate the deputy but strip the permission: they can sign in, they
    // just cannot acknowledge an escalation, so telling them is telling nobody.
    await db.execute(sql`UPDATE crm_users SET status = 'ACTIVE' WHERE id = ${deputyId}::uuid`)
    await db.execute(sql`
      DELETE FROM crm_role_permissions
      WHERE domain = 'crm.tasks' AND action = 'escalate'
        AND role_id IN (SELECT role_id FROM crm_user_roles WHERE crm_user_id = ${deputyId}::uuid)`)

    const taskId = await makeBreachingTask({ assigneeId: agentId })
    const res = await runEscalationSweep(TENANT)

    assert.equal(res.escalated, 0)
    assert.equal(await levelOf(taskId), 0)
    assert.ok((await eventsFor(taskId)).includes('escalation_failed'))
  })

  it('escalates normally once the delegate can actually receive it', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')

    const role = await db.execute(sql`
      SELECT role_id FROM crm_user_roles WHERE crm_user_id = ${deputyId}::uuid LIMIT 1`)
    await db.execute(sql`
      INSERT INTO crm_role_permissions (role_id, domain, action)
      VALUES (${String((role.rows[0] as { role_id: string }).role_id)}::uuid, 'crm.tasks', 'escalate')`)

    const taskId = await makeBreachingTask({ assigneeId: agentId })
    const res = await runEscalationSweep(TENANT)

    assert.ok(res.escalated >= 1)
    const told = await db.execute(sql`
      SELECT crm_user_id FROM crm_notifications
      WHERE tenant = ${TENANT} AND resource_id = ${taskId} AND kind = 'task_escalated'`)
    const ids = (told.rows as Array<{ crm_user_id: string }>).map((x) => x.crm_user_id)
    assert.ok(ids.includes(deputyId), 'the delegate stands in for the away supervisor')
    assert.ok(!ids.includes(supervisorId), 'and the away supervisor is not told directly')

    // Put the supervisor back for anything that runs after this.
    await db.execute(sql`
      UPDATE crm_users SET out_of_office_until = NULL, delegate_to = NULL
      WHERE id = ${supervisorId}::uuid`)
  })
})

describe('one task failing does not consume another task\'s rung', () => {
  it('isolates the failure per task, leaving the others escalated normally', async () => {
    // Finding #12: the claim is a single UPDATE over the whole due set that
    // commits at level+1 with next_escalation_at two hours out, and the
    // notification work then ran per task with no try/catch around it. An
    // exception on one task propagated out of the sweep, leaving every task
    // after it in the batch holding a rung it never climbed — no escalation
    // row, no notification, no event, and no retry for two hours.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { runEscalationSweep } = await import('@src/repos/crm/CrmEscalationRepo.js')

    // Clear anything the earlier blocks left breaching, so the counts below
    // describe only the two tasks this test creates.
    await db.execute(sql`
      UPDATE crm_tasks SET acknowledged_at = now()
      WHERE tenant = ${TENANT} AND acknowledged_at IS NULL`)

    // Two tasks in the same well-staffed book, so both would escalate on their
    // own. The failure is injected at the database rather than by mocking the
    // repository, because what has to be proved is that a real exception
    // raised mid-loop cannot reach the tasks that come after it.
    const failing = await makeBreachingTask({ assigneeId: agentId })
    const healthy = await makeBreachingTask({ assigneeId: agentId })

    // The id is interpolated rather than bound: CREATE FUNCTION takes no bind
    // parameters. It is a uuid this test just generated, so there is nothing
    // caller-controlled in it.
    await db.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION crm_test_fail_one_notification() RETURNS trigger AS $$
      BEGIN
        IF NEW.resource_id = '${failing}' THEN
          RAISE EXCEPTION 'injected failure for one task';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`)
    )
    await db.execute(sql`
      CREATE TRIGGER crm_test_fail_one
      BEFORE INSERT ON crm_notifications
      FOR EACH ROW EXECUTE FUNCTION crm_test_fail_one_notification()`)

    try {
      const res = await runEscalationSweep(TENANT)

      assert.equal(res.claimed, 2, 'both tasks were claimed in one statement')
      assert.equal(res.escalated, 1, 'the healthy one still escalated')
      assert.equal(res.failed, 1, 'the failing one is reported, not silent')
      assert.equal(await levelOf(failing), 0, 'the failing task gave its rung back')
      assert.equal(await levelOf(healthy), 1, 'and the healthy one kept the rung it earned')
      assert.ok(
        (await eventsFor(failing)).includes('escalation_failed'),
        'the failure is recorded where a supervisor can see it'
      )

      const told = await db.execute(sql`
        SELECT count(*)::int AS c FROM crm_notifications
        WHERE tenant = ${TENANT} AND resource_id = ${healthy} AND kind = 'task_escalated'`)
      assert.ok(
        Number((told.rows[0] as { c: number }).c) >= 1,
        'the healthy task reached somebody despite the other one throwing'
      )

      // And the one that threw reached nobody — its whole transaction rolled
      // back, so there is no half-written escalation claiming otherwise.
      const notTold = await db.execute(sql`
        SELECT count(*)::int AS c FROM crm_notifications
        WHERE tenant = ${TENANT} AND resource_id = ${failing} AND kind = 'task_escalated'`)
      assert.equal(Number((notTold.rows[0] as { c: number }).c), 0)
      const escRows = await db.execute(sql`
        SELECT count(*)::int AS c FROM crm_task_escalations WHERE task_id = ${failing}::uuid`)
      assert.equal(
        Number((escRows.rows[0] as { c: number }).c),
        0,
        'no escalation row survives a failed delivery'
      )
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS crm_test_fail_one ON crm_notifications`)
      await db.execute(sql`DROP FUNCTION IF EXISTS crm_test_fail_one_notification()`)
    }
  })
})
