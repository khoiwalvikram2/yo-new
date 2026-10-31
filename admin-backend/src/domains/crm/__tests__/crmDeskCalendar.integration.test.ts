/**
 * The desk calendar, and the fact that changing it changes the SLA.
 *
 * The calendar has been readable since tasks shipped — `addWorkingMinutes`
 * computes every deadline from it and the escalation sweep refuses to climb
 * outside it — but nothing could write it, so every whitelabel sat on the
 * Asia/Kolkata default whatever market it served.
 *
 * The assertions that matter here are not the CRUD ones. They are:
 *
 *   - a saved calendar actually moves a task's `dueAt`, which is the only
 *     reason to have the screen at all;
 *   - every validation rule *refuses* rather than clamping, because each of the
 *     three failures it prevents is silent. A bad timezone throws inside
 *     `createTask`; an inverted or empty week stops escalation without saying
 *     anything.
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-cal-${randomUUID().slice(0, 8)}`
const OTHER = `crm-cal-other-${randomUUID().slice(0, 8)}`
/** Enabled CRM, but no settings row is written for this one until the last test. */
const NO_ROW = `crm-cal-norow-${randomUUID().slice(0, 8)}`

let actorId = ''
let bookId = ''

const VIEW_AND_MANAGE = [{ domain: 'crm.settings', actions: ['view', 'manage'] }]
const VIEW_ONLY = [{ domain: 'crm.settings', actions: ['view'] }]

function ctx(tenant: string, permissions: Array<{ domain: string; actions: string[] }>, status = 'ACTIVE') {
  return {
    crmUser: { id: actorId, name: 'Actor', tenant, status, requirePasswordReset: false },
    permissions,
  } as any
}
const actorCtx = () => ctx(TENANT, VIEW_AND_MANAGE)

/** The calendar as the database actually holds it, not as a resolver reports it. */
async function storedCalendar(tenant: string) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`
    SELECT timezone, desk_open_minute, desk_close_minute, desk_days
    FROM crm_whitelabel_settings WHERE tenant = ${tenant}`)
  const row = r.rows[0] as
    | { timezone: string; desk_open_minute: number; desk_close_minute: number; desk_days: number[] }
    | undefined
  if (!row) return null
  return {
    timezone: row.timezone,
    openMinute: Number(row.desk_open_minute),
    closeMinute: Number(row.desk_close_minute),
    days: (row.desk_days ?? []).map(Number),
  }
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  for (const t of [TENANT, OTHER]) {
    await db.execute(sql`
      INSERT INTO crm_whitelabel_settings (tenant, enabled, seat_limit)
      VALUES (${t}, true, 10)`)
  }

  // Usernames live in crm_user_credentials, not on the user row.
  const r = await db.execute(sql`
    INSERT INTO crm_users (tenant, name, status)
    VALUES (${TENANT}, 'Actor', 'ACTIVE') RETURNING id`)
  actorId = String((r.rows[0] as { id: string }).id)

  const b = await db.execute(sql`
    INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, 'Calendar Book') RETURNING id`)
  bookId = String((b.rows[0] as { id: string }).id)
})

after(async () => {
  // The audit assertion below waits for the fire-and-forget write to land,
  // which is long enough for `recordAuditDb` to reach its Redis emitter and
  // open a socket. Most CRM tests never see this because they exit before the
  // abandoned promise gets that far; this one does, and an open socket keeps
  // the process alive after the last assertion has passed.
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})

  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const t of [TENANT, OTHER, NO_ROW]) {
    await db.execute(sql`DELETE FROM crm_tasks WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_books WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM audit_logs WHERE tenant = ${t}`)
  }
})

describe('the permission gate', () => {
  it('refuses the read without crm.settings:view', async () => {
    const { crmSettingsQueries } = await import('@src/domains/crm/resolvers/deskCalendar.js')
    await assert.rejects(
      () => crmSettingsQueries.crmDeskCalendar(null, {}, ctx(TENANT, [])),
      /Forbidden/
    )
  })

  it('refuses the write with view alone — reading your hours is not changing them', async () => {
    const { crmSettingsMutations } = await import('@src/domains/crm/resolvers/deskCalendar.js')
    await assert.rejects(
      () =>
        crmSettingsMutations.crmSetDeskCalendar(
          null,
          { timezone: 'Europe/London', openMinute: 540, closeMinute: 1020, days: [1, 2, 3, 4, 5] },
          ctx(TENANT, VIEW_ONLY)
        ),
      /Forbidden/
    )
  })

  it('lets an INACTIVE user keep the read and lose the write', async () => {
    const { crmSettingsQueries, crmSettingsMutations } = await import(
      '@src/domains/crm/resolvers/deskCalendar.js'
    )
    const inactive = ctx(TENANT, VIEW_AND_MANAGE, 'INACTIVE')

    const read = await crmSettingsQueries.crmDeskCalendar(null, {}, inactive)
    assert.ok(read, 'an inactive user should still be able to read')

    await assert.rejects(
      () =>
        crmSettingsMutations.crmSetDeskCalendar(
          null,
          { timezone: 'Europe/London', openMinute: 540, closeMinute: 1020, days: [1] },
          inactive
        ),
      /inactive/i
    )
  })
})

describe('reading the calendar', () => {
  it('returns the defaults a tenant starts with, and whether the desk is open now', async () => {
    const { crmSettingsQueries } = await import('@src/domains/crm/resolvers/deskCalendar.js')
    const cal = await crmSettingsQueries.crmDeskCalendar(null, {}, actorCtx())
    assert.equal(cal.timezone, 'Asia/Kolkata')
    assert.equal(cal.openMinute, 540)
    assert.equal(cal.closeMinute, 1260)
    assert.deepEqual(cal.days, [1, 2, 3, 4, 5, 6])
    assert.equal(typeof cal.isOpenNow, 'boolean')
  })
})

describe('validation refuses rather than clamps', () => {
  const bad: Array<{ why: string; args: Record<string, unknown>; match: RegExp }> = [
    {
      why: 'a timezone that is not a real zone',
      args: { timezone: 'Mars/Olympus', openMinute: 540, closeMinute: 1020, days: [1] },
      match: /time zone/i,
    },
    {
      why: 'an empty string timezone',
      args: { timezone: '', openMinute: 540, closeMinute: 1020, days: [1] },
      match: /time zone/i,
    },
    {
      why: 'close before open',
      args: { timezone: 'Europe/London', openMinute: 1020, closeMinute: 540, days: [1] },
      match: /before/i,
    },
    {
      why: 'open equal to close, which is a desk that is never open',
      args: { timezone: 'Europe/London', openMinute: 540, closeMinute: 540, days: [1] },
      match: /before/i,
    },
    {
      why: 'a close past the end of the day',
      args: { timezone: 'Europe/London', openMinute: 540, closeMinute: 1441, days: [1] },
      match: /day/i,
    },
    {
      why: 'a negative open',
      args: { timezone: 'Europe/London', openMinute: -1, closeMinute: 1020, days: [1] },
      match: /day/i,
    },
    {
      why: 'no working days at all',
      args: { timezone: 'Europe/London', openMinute: 540, closeMinute: 1020, days: [] },
      match: /day/i,
    },
    {
      why: 'a weekday outside 1-7',
      args: { timezone: 'Europe/London', openMinute: 540, closeMinute: 1020, days: [0, 1] },
      match: /day/i,
    },
    {
      why: 'a weekday outside 1-7, on the high side',
      args: { timezone: 'Europe/London', openMinute: 540, closeMinute: 1020, days: [1, 8] },
      match: /day/i,
    },
  ]

  for (const c of bad) {
    it(`rejects ${c.why}, and leaves the stored calendar alone`, async () => {
      const { crmSettingsMutations } = await import('@src/domains/crm/resolvers/deskCalendar.js')
      const before = await storedCalendar(TENANT)
      const res = await crmSettingsMutations.crmSetDeskCalendar(null, c.args as any, actorCtx())
      assert.equal(res.ok, false, `${c.why} was accepted`)
      assert.match(String(res.error), c.match)
      assert.deepEqual(await storedCalendar(TENANT), before, 'the row changed despite the refusal')
    })
  }

  it('accepts a desk that runs to midnight, and one that never closes', async () => {
    const { crmSettingsMutations } = await import('@src/domains/crm/resolvers/deskCalendar.js')
    for (const [open, close] of [
      [540, 1440],
      [0, 1440],
    ]) {
      const res = await crmSettingsMutations.crmSetDeskCalendar(
        null,
        { timezone: 'Europe/London', openMinute: open, closeMinute: close, days: [1, 2, 3, 4, 5, 6, 7] },
        actorCtx()
      )
      assert.equal(res.ok, true, `rejected ${open}-${close}: ${res.error}`)
    }
  })

  it('stores a sorted, de-duplicated week rather than whatever was typed', async () => {
    const { crmSettingsMutations } = await import('@src/domains/crm/resolvers/deskCalendar.js')
    const res = await crmSettingsMutations.crmSetDeskCalendar(
      null,
      { timezone: 'Europe/London', openMinute: 540, closeMinute: 1020, days: [3, 1, 3, 2] },
      actorCtx()
    )
    assert.equal(res.ok, true, res.error)
    assert.deepEqual((await storedCalendar(TENANT))!.days, [1, 2, 3])
  })
})

describe('the tenant on the token decides', () => {
  it('does not reach another whitelabel, which has no argument to name it', async () => {
    const { crmSettingsMutations, crmSettingsQueries } = await import(
      '@src/domains/crm/resolvers/deskCalendar.js'
    )
    const otherBefore = await storedCalendar(OTHER)

    const res = await crmSettingsMutations.crmSetDeskCalendar(
      null,
      { timezone: 'America/New_York', openMinute: 600, closeMinute: 1200, days: [1, 2, 3] },
      actorCtx()
    )
    assert.equal(res.ok, true, res.error)

    assert.deepEqual(await storedCalendar(OTHER), otherBefore, "the other tenant's calendar moved")

    // And the other tenant reads its own, not this one's.
    const theirs = await crmSettingsQueries.crmDeskCalendar(null, {}, ctx(OTHER, VIEW_AND_MANAGE))
    assert.equal(theirs.timezone, 'Asia/Kolkata')
  })

  it('refuses a tenant with no settings row rather than creating one', async () => {
    const { crmSettingsMutations } = await import('@src/domains/crm/resolvers/deskCalendar.js')
    const res = await crmSettingsMutations.crmSetDeskCalendar(
      null,
      { timezone: 'Europe/London', openMinute: 540, closeMinute: 1020, days: [1] },
      ctx(NO_ROW, VIEW_AND_MANAGE)
    )
    assert.equal(res.ok, false)
    assert.equal(await storedCalendar(NO_ROW), null, 'a CRM was created through the settings screen')
  })
})

describe('the calendar is the SLA', () => {
  it("moves a task's deadline, which is the whole reason the screen exists", async () => {
    const { crmSettingsMutations } = await import('@src/domains/crm/resolvers/deskCalendar.js')
    const { createTask, getDeskHours, isDeskOpen } = await import('@src/repos/crm/CrmTasksRepo.js')

    // A desk open only on Mondays, 09:00-10:00 UTC. Almost every instant is
    // outside it, so a deadline computed against it lands a long way from one
    // computed against the default.
    const narrow = await crmSettingsMutations.crmSetDeskCalendar(
      null,
      { timezone: 'UTC', openMinute: 540, closeMinute: 600, days: [1] },
      actorCtx()
    )
    assert.equal(narrow.ok, true, narrow.error)

    const hours = await getDeskHours(TENANT)
    assert.equal(hours.timezone, 'UTC')
    assert.deepEqual(hours.days, [1])

    const created = await createTask({
      tenant: TENANT,
      bookId,
      createdBy: `crm:${actorId}`,
      title: 'Calendar-bound callback',
      // Deliberately not a whole number of windows. 120 minutes would exactly
      // fill two of this desk's one-hour Mondays and fall on the closing
      // instant, which `isDeskOpen` correctly reports as shut — a true but
      // uninteresting boundary. 90 lands mid-window, so the assertion below
      // says something about the calendar rather than about half-open ranges.
      slaMinutes: 90,
    })
    assert.equal(created.ok, true, 'the task should have been created')
    if (!created.ok) return

    // 90 working minutes on a desk open one hour a week is at least a week
    // out. Under the default calendar the same task would be due in 90 minutes.
    const due = created.task.dueAt as Date
    const from = created.task.createdAt as Date
    const elapsedHours = (due.getTime() - from.getTime()) / 3_600_000
    assert.ok(
      elapsedHours > 24,
      `the narrow calendar was ignored: due ${elapsedHours.toFixed(1)}h after creation`
    )

    // And the deadline lands inside the hours the desk actually works. This is
    // the property, rather than an equality against a recomputed value:
    // `createTask` measures from its own `new Date()` while `created_at` is the
    // database's `now()`, so the two differ by a round trip and an exact
    // comparison would fail on timing rather than on behaviour.
    assert.ok(
      isDeskOpen(due, hours),
      `the deadline ${due.toISOString()} falls outside the hours the desk works`
    )
    assert.equal(due.getUTCDay(), 1, 'the only working day is Monday')
  })
})

describe('the calendar maths cannot skip an open window', () => {
  it('gives every window width a deadline that responds to the SLA and lands in working hours', async () => {
    const { addWorkingMinutes, isDeskOpen } = await import('@src/repos/crm/CrmTasksRepo.js')

    // The loop used to advance a blind 15 minutes whenever the desk was shut,
    // so any window narrower than that could be strided clean over: the cursor
    // never landed inside it, no working minutes were ever consumed, and the
    // function returned wherever its iteration guard gave up. Measured on a
    // 09:00-09:10 desk that was 208 days out, outside working hours, and
    // IDENTICAL for a 5-minute and a 120-minute SLA — the sharpest symptom,
    // because a deadline that ignores its own SLA hides every breach.
    const from = new Date('2026-09-01T00:00:00Z') // a Tuesday, on the quarter hour

    for (const width of [1, 5, 10, 14, 15, 60]) {
      const hours = {
        timezone: 'UTC',
        openMinute: 540,
        closeMinute: 540 + width,
        days: [1, 2, 3, 4, 5],
      }
      const d30 = addWorkingMinutes(from, 30, hours)
      const d60 = addWorkingMinutes(from, 60, hours)

      assert.notEqual(
        d30.getTime(),
        d60.getTime(),
        `width ${width}: the SLA made no difference to the deadline`
      )
      assert.ok(
        d60.getTime() > d30.getTime(),
        `width ${width}: twice the work must not be due sooner`
      )
      // At the closing minute exactly is correct — the window is half-open, so
      // work that fills it ends as the desk shuts.
      const minuteOfDay = d30.getUTCHours() * 60 + d30.getUTCMinutes()
      assert.ok(
        isDeskOpen(d30, hours) || minuteOfDay === 540 + width,
        `width ${width}: deadline ${d30.toISOString()} falls outside the hours the desk works`
      )
    }
  })

  it('does not credit an hour the desk timezone skips, nor lose one it repeats', async () => {
    const { addWorkingMinutes, isDeskOpen } = await import('@src/repos/crm/CrmTasksRepo.js')
    // London 00:30–03:30 spans the DST transition. On 2026-03-29 that window is
    // only two real hours, because 01:00–01:59 local never happens; on
    // 2026-10-25 it is four. Treating the window's *local* span as elapsed
    // minutes credited the missing hour and put a 180-minute deadline at 04:30
    // London — an hour after the desk had shut.
    const hours = { timezone: 'Europe/London', openMinute: 30, closeMinute: 210, days: [1, 2, 3, 4, 5, 6, 7] }
    const local = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d)

    // Spring forward: only 120 working minutes exist that day, so 180 spills.
    const spring = addWorkingMinutes(new Date('2026-03-29T00:00:00Z'), 180, hours)
    assert.ok(
      isDeskOpen(spring, hours) || local(spring) === '03:30',
      `spring-forward deadline ${local(spring)} London falls outside the hours the desk works`
    )
    assert.equal(local(spring), '01:30', 'the remaining hour must carry to the next opening')

    // Fall back: 240 working minutes exist, so 180 lands inside the window.
    const autumn = addWorkingMinutes(new Date('2026-10-25T00:00:00Z'), 180, hours)
    assert.ok(isDeskOpen(autumn, hours), `autumn deadline ${local(autumn)} London is outside working hours`)
    assert.equal(local(autumn), '03:00')
  })

  it('counts from the moment the desk opens, not from the next step of a fixed grid', async () => {
    const { addWorkingMinutes } = await import('@src/repos/crm/CrmTasksRepo.js')
    // The same fixed step also started the count late for any task raised off
    // that grid — which is nearly every task. 120 working minutes from 00:07 on
    // a 09:00 desk was due at 11:07 rather than 11:00: every SLA in the product
    // was up to fourteen minutes wrong.
    const hours = { timezone: 'UTC', openMinute: 540, closeMinute: 1020, days: [1, 2, 3, 4, 5] }
    const due = addWorkingMinutes(new Date('2026-09-01T00:07:00Z'), 120, hours)
    assert.equal(due.toISOString(), '2026-09-01T11:00:00.000Z')
  })
})

describe('the audit trail', () => {
  it('records the change, like every other CRM write', async () => {
    const { crmSettingsMutations } = await import('@src/domains/crm/resolvers/deskCalendar.js')
    const res = await crmSettingsMutations.crmSetDeskCalendar(
      null,
      { timezone: 'Asia/Dubai', openMinute: 480, closeMinute: 1080, days: [7] },
      actorCtx()
    )
    assert.equal(res.ok, true, res.error)

    // The audit write is fire-and-forget, so give it a moment to land.
    await new Promise((r) => setTimeout(r, 300))

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute(sql`
      SELECT action, actor_id FROM audit_logs
      WHERE tenant = ${TENANT} AND action = 'set_desk_calendar'`)
    assert.ok(rows.rows.length > 0, 'the calendar change was not audited')
    assert.equal(String((rows.rows[0] as { actor_id: string }).actor_id), `crm:${actorId}`)
  })
})
