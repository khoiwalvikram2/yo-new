/**
 * The desk report — the numbers a supervisor reviews a period by.
 *
 * A report's failure mode is different from a queue's: nothing errors, the
 * number is simply wrong, and people either act on a wrong number or learn to
 * ignore the page. So these tests build a small, fully-known period of work and
 * assert the exact counts — including the two that are easiest to get subtly
 * wrong:
 *
 *   - "breached" must mean *went past its deadline unacknowledged*, not
 *     "breach_at fell in the window". A task acknowledged before its deadline
 *     never breached, however the timestamps land;
 *   - a book-bound reader's per-agent rows must count only work inside their
 *     books. An agent-level report that quietly aggregates the whole whitelabel
 *     is a disclosure, not a bug ticket.
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-rep-${randomUUID().slice(0, 8)}`
const OTHER = `crm-rep-other-${randomUUID().slice(0, 8)}`
/** Its own tenant so the breach edge cases cannot shift the counts asserted above. */
const BREACH = `crm-rep-breach-${randomUUID().slice(0, 8)}`

const DAY = 86_400_000
const NOW = Date.now()
/** A 7-day window ending tomorrow, so "today's" rows are inside it. */
const FROM = new Date(NOW - 6 * DAY)
const TO = new Date(NOW + 1 * DAY)

let asha = ''
let bruno = ''
let ashaBook = ''
let brunoBook = ''
let ashaPlayer = 0
let brunoPlayer = 0

const REPORT_ONLY = [{ domain: 'crm.reports', actions: ['view'] }]
const REPORT_ALL = [
  { domain: 'crm.reports', actions: ['view'] },
  { domain: 'crm.players', actions: ['view', 'view_all'] },
]

function ctx(userId: string, permissions = REPORT_ONLY, tenant = TENANT) {
  return {
    crmUser: { id: userId, name: 'Actor', tenant, status: 'ACTIVE', requirePasswordReset: false },
    permissions,
  } as any
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

  const mkUser = async (tenant: string, name: string) => {
    const r = await db.execute(sql`
      INSERT INTO crm_users (tenant, name, status) VALUES (${tenant}, ${name}, 'ACTIVE') RETURNING id`)
    return String((r.rows[0] as { id: string }).id)
  }
  asha = await mkUser(TENANT, 'Asha')
  bruno = await mkUser(TENANT, 'Bruno')

  const mkBook = async (name: string, member: string) => {
    const b = await db.execute(sql`
      INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, ${name}) RETURNING id`)
    const id = String((b.rows[0] as { id: string }).id)
    await db.execute(sql`
      INSERT INTO crm_book_members (book_id, crm_user_id) VALUES (${id}::uuid, ${member}::uuid)`)
    return id
  }
  ashaBook = await mkBook('Asha Book', asha)
  brunoBook = await mkBook('Bruno Book', bruno)

  const mkPlayer = async (bookId: string) => {
    const p = await db.execute(sql`
      INSERT INTO users (tenant, name, username, status, password_hash)
      VALUES (${TENANT}, 'Player', ${`p-${randomUUID().slice(0, 10)}`}, 'active', 'x') RETURNING id`)
    const id = Number((p.rows[0] as { id: number }).id)
    await db.execute(sql`
      INSERT INTO crm_player_assignments (tenant, player_id, book_id)
      VALUES (${TENANT}, ${id}, ${bookId}::uuid)`)
    return id
  }
  ashaPlayer = await mkPlayer(ashaBook)
  brunoPlayer = await mkPlayer(brunoBook)

  const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY)

  /**
   * The period's known facts, all inside FROM..TO:
   *
   * Asha's book —
   *   task A1 created d-3, DONE d-1        (completed, 2 days to close)
   *   task A2 created d-5, breached d-2, acknowledged d-2 +30m  (a real breach)
   *   task A3 created d-2, breach tomorrow, acknowledged *before* the deadline
   *          — must NOT count as breached
   *   contact: connected (call) by Asha; no_answer (sms) by Asha
   *   note by Asha
   *
   * Bruno's book —
   *   task B1 created d-4, DONE d-3 by Bruno
   *   contact: connected by Bruno
   *   RG flag raised d-2, still active and blocking
   */
  const mkTask = async (input: {
    book: string
    assignee: string | null
    created: Date
    status: string
    completed?: Date | null
    breach?: Date | null
    acked?: Date | null
    title: string
  }) => {
    // Honour the table's own consistency checks: breach_at is constrained to
    // due_at + sla, and DONE demands an outcome and a completion time.
    const breach = input.breach ?? new Date(NOW + 7 * DAY)
    const due = new Date(breach.getTime() - 60 * 60_000)
    const outcome = input.status === 'DONE' ? 'resolved' : null
    await db.execute(sql`
      INSERT INTO crm_tasks (tenant, book_id, assignee_id, created_by, title, status, outcome,
                             sla_minutes, due_at, breach_at, next_escalation_at,
                             created_at, completed_at, acknowledged_at)
      VALUES (${TENANT}, ${input.book}::uuid, ${input.assignee}::uuid, 'test', ${input.title},
              ${input.status}, ${outcome}, 60,
              ${due}, ${breach}, ${breach},
              ${input.created}, ${input.completed ?? null}, ${input.acked ?? null})`)
  }

  await mkTask({ book: ashaBook, assignee: asha, created: at(3), status: 'DONE', completed: at(1), title: 'A1' })
  await mkTask({
    book: ashaBook, assignee: asha, created: at(5), status: 'OPEN',
    breach: at(2), acked: new Date(at(2).getTime() + 30 * 60_000), title: 'A2',
  })
  await mkTask({
    book: ashaBook, assignee: asha, created: at(2), status: 'OPEN',
    breach: new Date(NOW + 12 * 60 * 60_000), acked: at(1), title: 'A3',
  })
  await mkTask({ book: brunoBook, assignee: bruno, created: at(4), status: 'DONE', completed: at(3), title: 'B1' })

  const mkContact = async (player: number, by: string, outcome: string, channel: string) => {
    await db.execute(sql`
      INSERT INTO crm_contact_attempts (tenant, player_id, channel, direction, outcome, by_crm_user_id, by_name, occurred_at)
      VALUES (${TENANT}, ${player}, ${channel}, 'out', ${outcome}, ${by}::uuid, 'x', ${at(1)})`)
  }
  await mkContact(ashaPlayer, asha, 'connected', 'call')
  await mkContact(ashaPlayer, asha, 'no_answer', 'sms')
  await mkContact(brunoPlayer, bruno, 'connected', 'call')

  await db.execute(sql`
    INSERT INTO crm_player_notes (tenant, player_id, body, author_crm_user_id, author_name, created_at)
    VALUES (${TENANT}, ${ashaPlayer}, 'note', ${asha}::uuid, 'Asha', ${at(1)})`)

  // A self-exclusion must carry its minimum term — the table enforces it.
  await db.execute(sql`
    INSERT INTO crm_player_rg_flags (tenant, player_id, flag_type, status, initiated_by, blocks_play,
                                     starts_at, min_term_ends_at, raised_by, raised_at)
    VALUES (${TENANT}, ${brunoPlayer}, 'SELF_EXCLUSION', 'ACTIVE', 'player', true,
            ${at(2)}, ${new Date(NOW + 180 * DAY)}, 'crm:test', ${at(2)})`)
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const t of [TENANT, OTHER, BREACH]) {
    await db.execute(sql`DELETE FROM crm_contact_attempts WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_player_notes WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_player_rg_flags WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_task_events WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_tasks WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_player_assignments WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_books WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${t}`)
  }
})

const runReport = async (userId: string, permissions?: Array<{ domain: string; actions: string[] }>) => {
  const { crmReportQueries } = await import('@src/domains/crm/resolvers/reports.js')
  return crmReportQueries.crmDeskReport(
    null,
    { from: FROM.toISOString(), to: TO.toISOString() },
    ctx(userId, permissions)
  )
}

describe('the gate and the range', () => {
  it('refuses without crm.reports:view', async () => {
    const { crmReportQueries } = await import('@src/domains/crm/resolvers/reports.js')
    await assert.rejects(
      () =>
        crmReportQueries.crmDeskReport(
          null,
          { from: FROM.toISOString(), to: TO.toISOString() },
          ctx(asha, [{ domain: 'crm.tasks', actions: ['view'] }])
        ),
      /Forbidden/
    )
  })

  it('refuses a backwards period and one longer than a quarter', async () => {
    const { crmReportQueries } = await import('@src/domains/crm/resolvers/reports.js')
    await assert.rejects(
      () =>
        crmReportQueries.crmDeskReport(
          null,
          { from: TO.toISOString(), to: FROM.toISOString() },
          ctx(asha)
        ),
      /start before it ends/i
    )
    await assert.rejects(
      () =>
        crmReportQueries.crmDeskReport(
          null,
          { from: new Date(NOW - 200 * DAY).toISOString(), to: TO.toISOString() },
          ctx(asha)
        ),
      /92 days/i
    )
    await assert.rejects(
      () =>
        crmReportQueries.crmDeskReport(null, { from: 'not a date', to: TO.toISOString() }, ctx(asha)),
      /two dates/i
    )
  })
})

describe('the whitelabel-wide numbers, for a view_all reader', () => {
  it('counts the period exactly', async () => {
    const r = await runReport(asha, REPORT_ALL)

    assert.equal(r.tasks.created, 4, 'created')
    assert.equal(r.tasks.completed, 2, 'completed')
    // A2 breached. A3's deadline is tomorrow and it was acknowledged early —
    // counting it would report a breach that never happened.
    assert.equal(r.tasks.breached, 1, 'breached')
    assert.equal(r.tasks.openNow, 2, 'openNow')
    assert.ok((r.tasks.avgMinutesToClose ?? 0) > 0, 'avgMinutesToClose should be positive')
    // A2 was picked up 30 minutes after its deadline.
    assert.equal(r.tasks.avgMinutesToAcknowledge, 30, 'avgMinutesToAcknowledge')

    assert.equal(r.contacts.attempts, 3)
    assert.equal(r.contacts.connected, 2)
    const call = r.contacts.byChannel.find((c: { channel: string }) => c.channel === 'call')
    assert.deepEqual({ attempts: call.attempts, connected: call.connected }, { attempts: 2, connected: 2 })

    assert.equal(r.rg.flagsRaised, 1)
    assert.equal(r.rg.flagsLifted, 0)
    assert.equal(r.rg.blocksActiveNow, 1)

    // The by-day series covers every day of the period and sums to the totals.
    assert.equal(r.tasks.byDay.length, 7)
    const created = r.tasks.byDay.reduce((s: number, d: { created: number }) => s + d.created, 0)
    const completed = r.tasks.byDay.reduce((s: number, d: { completed: number }) => s + d.completed, 0)
    assert.equal(created, r.tasks.created, 'byDay.created must sum to the total')
    assert.equal(completed, r.tasks.completed, 'byDay.completed must sum to the total')
  })

  it('names who did what, one row per person', async () => {
    const r = await runReport(asha, REPORT_ALL)
    const rows = Object.fromEntries(r.agents.map((a: { name: string }) => [a.name, a]))

    assert.deepEqual(
      {
        tasksCompleted: rows.Asha.tasksCompleted,
        tasksBreached: rows.Asha.tasksBreached,
        contactAttempts: rows.Asha.contactAttempts,
        contactsConnected: rows.Asha.contactsConnected,
        notesWritten: rows.Asha.notesWritten,
      },
      { tasksCompleted: 1, tasksBreached: 1, contactAttempts: 2, contactsConnected: 1, notesWritten: 1 }
    )
    assert.deepEqual(
      {
        tasksCompleted: rows.Bruno.tasksCompleted,
        contactAttempts: rows.Bruno.contactAttempts,
      },
      { tasksCompleted: 1, contactAttempts: 1 }
    )
  })
})

describe('what counts as a breach', () => {
  /**
   * The number a supervisor acts on, and the one easiest to get subtly wrong.
   * The first version of this predicate asked only "was the task unacknowledged
   * at its deadline", which counted three of these six as breaches: work
   * finished on time (completion never writes `acknowledged_at` — only the
   * escalation ladder does), work whose deadline is still in the future (the
   * screen's range ends at the end of *today*), and work that was called off.
   */
  it('counts only work whose deadline passed with the work still outstanding', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    await db.execute(sql`
      INSERT INTO crm_whitelabel_settings (tenant, enabled, seat_limit, timezone, desk_open_minute, desk_close_minute, desk_days)
      VALUES (${BREACH}, true, 20, 'UTC', 0, 1440, '{1,2,3,4,5,6,7}')`)
    const u = await db.execute(sql`
      INSERT INTO crm_users (tenant, name, status) VALUES (${BREACH}, 'Solo', 'ACTIVE') RETURNING id`)
    const solo = String((u.rows[0] as { id: string }).id)
    const b = await db.execute(sql`
      INSERT INTO crm_books (tenant, name) VALUES (${BREACH}, 'Book') RETURNING id`)
    const bookId = String((b.rows[0] as { id: string }).id)

    const task = async (
      title: string,
      status: string,
      breachOffsetDays: number,
      completed: Date | null,
      acknowledged: Date | null
    ) => {
      const breach = new Date(NOW + breachOffsetDays * DAY)
      const due = new Date(breach.getTime() - 3_600_000)
      await db.execute(sql`
        INSERT INTO crm_tasks (tenant, book_id, assignee_id, created_by, title, status, outcome,
                               sla_minutes, due_at, breach_at, next_escalation_at, created_at,
                               completed_at, acknowledged_at)
        VALUES (${BREACH}, ${bookId}::uuid, ${solo}::uuid, 't', ${title}, ${status},
                ${status === 'DONE' ? 'resolved' : null}, 60,
                ${due}, ${breach}, ${breach}, ${new Date(NOW - 2 * DAY)},
                ${completed}, ${acknowledged})`)
    }

    await task('done on time', 'DONE', -1, new Date(NOW - 2 * DAY), null)
    await task('not due until tomorrow', 'OPEN', 1, null, null)
    await task('called off', 'CANCELLED', -1, null, null)
    await task('picked up before the deadline', 'OPEN', -1, null, new Date(NOW - 2 * DAY))
    await task('genuinely late', 'OPEN', -1, null, null)
    await task('finished, but late', 'DONE', -1, new Date(NOW), null)

    const { getDeskReport } = await import('@src/repos/crm/CrmReportsRepo.js')
    const r = await getDeskReport(
      { tenant: BREACH, viewAll: true, bookIds: [] },
      new Date(NOW - 3 * DAY),
      new Date(NOW + 2 * DAY)
    )

    assert.equal(r.tasks.created, 6, 'the fixture did not land')
    assert.equal(r.tasks.breached, 2, 'only "genuinely late" and "finished, but late" are breaches')
    assert.equal(
      r.agents.find((a: { name: string }) => a.name === 'Solo')?.tasksBreached,
      2,
      'the per-person column must draw the same line as the total'
    )
  })
})

describe('a book-bound reader', () => {
  it("sees their desk's numbers and nobody else's", async () => {
    const r = await runReport(asha)

    // Asha's book has 3 of the 4 tasks and 2 of the 3 contacts.
    assert.equal(r.tasks.created, 3)
    assert.equal(r.tasks.completed, 1)
    assert.equal(r.contacts.attempts, 2)
    assert.equal(r.contacts.connected, 1)

    // Bruno's work happened entirely in a book Asha is not in. A row for him
    // here would be the agent-level disclosure the scoping exists to prevent.
    assert.equal(r.agents.length, 1)
    assert.equal(r.agents[0].name, 'Asha')

    // The RG episode is on Bruno's player.
    assert.equal(r.rg.flagsRaised, 0)
    assert.equal(r.rg.blocksActiveNow, 0)
  })

  it('a reader with no books gets an empty report, not the tenant', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const r0 = await db.execute(sql`
      INSERT INTO crm_users (tenant, name, status) VALUES (${TENANT}, 'Bookless', 'ACTIVE') RETURNING id`)
    const bookless = String((r0.rows[0] as { id: string }).id)

    const r = await runReport(bookless)
    assert.equal(r.tasks.created, 0)
    assert.equal(r.contacts.attempts, 0)
    assert.equal(r.agents.length, 0)
    assert.equal(r.rg.flagsRaised, 0)
  })

  it("another whitelabel's report is empty of this one's work", async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const r0 = await db.execute(sql`
      INSERT INTO crm_users (tenant, name, status) VALUES (${OTHER}, 'Elsewhere', 'ACTIVE') RETURNING id`)
    const elsewhere = String((r0.rows[0] as { id: string }).id)

    // view_all in their own tenant still reaches none of TENANT's rows.
    const { crmReportQueries } = await import('@src/domains/crm/resolvers/reports.js')
    const rOther = await crmReportQueries.crmDeskReport(
      null,
      { from: FROM.toISOString(), to: TO.toISOString() },
      ctx(elsewhere, REPORT_ALL, OTHER)
    )
    assert.equal(rOther.tasks.created, 0)
    assert.equal(rOther.contacts.attempts, 0)
    assert.equal(rOther.agents.length, 0)
  })
})
