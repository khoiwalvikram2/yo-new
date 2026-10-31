import { createHash } from 'node:crypto'
import { db } from '@src/db/client.js'
import {
  crmTasks,
  crmTaskEvents,
  crmTaskEscalations,
  crmNotifications,
  crmBooks,
  crmBookMembers,
  crmUsers,
  crmUserRoles,
  crmRolePermissions,
  crmWhitelabelSettings,
} from '@shared/db/schema.js'
import { and, eq, sql, desc, asc, inArray, isNull, or } from 'drizzle-orm'

/**
 * The work a desk owes a player, and the ladder that runs when it is late.
 *
 * Two decisions carry this file:
 *
 *   1. A task belongs to a *book*, and the book is kept current. Reassigning a
 *      player moves their open work with them, rather than stranding it with
 *      whoever used to hold them.
 *   2. Escalating to nobody is not a success. When the recipient set is empty
 *      the level does not advance and an `escalation_failed` event is written,
 *      so the task stays breaching and the next sweep tries again. A silent
 *      stamp saying "escalated" would hide exactly the case that matters.
 */

export type TaskRow = typeof crmTasks.$inferSelect
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'

/** How long the ladder waits before trying the next rung. */
const ESCALATION_INTERVAL_MINUTES = 120
/** After this many rungs the ladder stops climbing and says so. */
export const MAX_ESCALATION_LEVEL = 3

// ---------------------------------------------------------------------------
// The desk calendar
// ---------------------------------------------------------------------------

export type DeskHours = {
  timezone: string
  openMinute: number
  closeMinute: number
  days: number[]
}

export async function getDeskHours(tenant: string): Promise<DeskHours> {
  const [s] = await db
    .select({
      timezone: crmWhitelabelSettings.timezone,
      openMinute: crmWhitelabelSettings.deskOpenMinute,
      closeMinute: crmWhitelabelSettings.deskCloseMinute,
      days: crmWhitelabelSettings.deskDays,
    })
    .from(crmWhitelabelSettings)
    .where(eq(crmWhitelabelSettings.tenant, tenant))
    .limit(1)
  return {
    timezone: s?.timezone ?? 'Asia/Kolkata',
    openMinute: s?.openMinute ?? 540,
    closeMinute: s?.closeMinute ?? 1260,
    days: (s?.days as number[] | null) ?? [1, 2, 3, 4, 5, 6],
  }
}

/** Minutes past midnight, and the ISO weekday, for an instant in a timezone. */
function localParts(at: Date, timezone: string): { minute: number; isoDay: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]))
  const minute = Number(parts.hour) * 60 + Number(parts.minute)
  const isoDay = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[
    String(parts.weekday)
  ] as number
  return { minute, isoDay }
}

export function isDeskOpen(at: Date, hours: DeskHours): boolean {
  const { minute, isoDay } = localParts(at, hours.timezone)
  return hours.days.includes(isoDay) && minute >= hours.openMinute && minute < hours.closeMinute
}

/**
 * How many boundary hops one deadline may take before we call the calendar
 * impossible. Each hop lands on an opening or a midnight, so a desk open one
 * day a week still resolves a year's worth of work in ~100 hops.
 */
const MAX_CALENDAR_HOPS = 5_000

/**
 * Drops the seconds from an instant that has just been moved to a calendar
 * boundary.
 *
 * A task is created at some instant with seconds on it. Jumping "to the opening
 * minute" by whole minutes would otherwise land at 09:00:47 rather than 09:00,
 * carrying that remainder through every later step — so a deadline that exactly
 * fills the window lands 47 seconds *past* closing, and reads as falling outside
 * the hours the desk works. Only jumps are snapped: when the desk is already
 * open the count starts at the real instant, because that is when the work
 * genuinely started.
 */
function toMinuteBoundary(epochMs: number): Date {
  return new Date(epochMs - (epochMs % 60_000))
}

/**
 * Advances `from` by `localMinutes` **as the desk's clock reads them**, which on
 * a DST transition day is not the same as that many real minutes.
 *
 * Adds the nominal amount, then measures where that actually landed on the
 * desk's clock and corrects the difference. The correction is at most an hour
 * either way, so a reading more than half a day out is a midnight crossing
 * rather than a DST shift and is unwrapped as such.
 */
function atLocalMinute(from: Date, localMinutes: number, hours: DeskHours): Date {
  const target = (localParts(from, hours.timezone).minute + localMinutes) % 1440
  let at = new Date(from.getTime() + localMinutes * 60_000)
  let drift = localParts(at, hours.timezone).minute - target
  if (drift > 720) drift -= 1440
  if (drift < -720) drift += 1440
  if (drift !== 0) at = new Date(at.getTime() - drift * 60_000)
  return at
}

/**
 * Adds working minutes to an instant, skipping closed hours.
 *
 * A callback raised at 17:55 with a two-hour SLA is not late at 19:55 — the
 * desk shut at 21:00 and nobody could have made the call. Computing the
 * deadline against the calendar is what stops the queue filling with breaches
 * that were never anybody's fault.
 *
 * **Closed stretches are jumped to their exact end, never stepped over.** This
 * loop used to advance a blind 15 minutes whenever the desk was shut, which
 * meant any open window narrower than 15 minutes could be strided clean over:
 * the cursor never landed inside it, no working minutes were ever consumed, and
 * the loop span until its iteration guard gave up — then returned wherever the
 * cursor happened to stop. Measured, a desk open 09:00–09:10 produced deadlines
 * 208 days out, identical for a 5-minute and a 120-minute SLA, at a second of
 * CPU each. Silent, and wrong in the direction that hides every breach.
 *
 * Landing on the boundary instead makes the result exact for any legal calendar
 * and drops the iteration count by three orders of magnitude.
 */
export function addWorkingMinutes(from: Date, minutes: number, hours: DeskHours): Date {
  let cursor = new Date(from.getTime())
  let remaining = minutes
  let hops = 0

  while (remaining > 0) {
    if (hops++ > MAX_CALENDAR_HOPS) {
      // Unreachable for any calendar the validator admits. Throwing rather than
      // returning `cursor` is deliberate: a deadline that is merely where the
      // loop stopped reads as real, and every SLA built on it would be a lie.
      throw new Error(
        `addWorkingMinutes: cannot place a ${minutes}-minute deadline on desk calendar ` +
          `${hours.timezone} ${hours.openMinute}-${hours.closeMinute} days=${hours.days.join(',')}`
      )
    }

    const { minute, isoDay } = localParts(cursor, hours.timezone)

    // Shut for the rest of this local day — jump to the next one and re-test.
    // Across a DST boundary this may land at 23:00 or 01:00 rather than
    // midnight; the re-test absorbs that at the cost of one extra hop.
    if (!hours.days.includes(isoDay) || minute >= hours.closeMinute) {
      cursor = toMinuteBoundary(cursor.getTime() + (1440 - minute) * 60_000)
      continue
    }

    // Open later today — jump exactly to the opening minute.
    if (minute < hours.openMinute) {
      cursor = toMinuteBoundary(cursor.getTime() + (hours.openMinute - minute) * 60_000)
      continue
    }

    // Open now. Consume real elapsed minutes, bounded by the real instant at
    // which today's window shuts — not by the *local* span of that window.
    //
    // The two differ on a DST transition day, in both directions. London's
    // 00:30–03:30 desk spans only two real hours on the spring-forward day
    // because 01:00–01:59 local never happens; treating the span as 180 minutes
    // credited an hour that did not exist and put the deadline at 04:30, an
    // hour after the desk had shut. On the autumn day the same window is four
    // real hours, and a 180-minute SLA is genuinely satisfied inside it.
    const closeAt = atLocalMinute(cursor, hours.closeMinute - minute, hours)
    const available = Math.round((closeAt.getTime() - cursor.getTime()) / 60_000)
    const step = Math.min(remaining, Math.max(available, 1))
    cursor = new Date(cursor.getTime() + step * 60_000)
    remaining -= step
  }

  return cursor
}

// ---------------------------------------------------------------------------
// Creating and changing tasks
// ---------------------------------------------------------------------------

export type CreateTaskInput = {
  tenant: string
  playerId?: number | null
  bookId: string
  assigneeId?: string | null
  createdBy: string
  source?: string
  dedupeKey?: string | null
  title: string
  body?: string | null
  priority?: TaskPriority
  slaMinutes: number
}

export async function createTask(
  input: CreateTaskInput
): Promise<
  | { ok: true; task: TaskRow }
  | { ok: false; reason: 'duplicate' | 'book_not_found' | 'assignee_not_found' }
> {
  const hours = await getDeskHours(input.tenant)
  const now = new Date()
  const dueAt = addWorkingMinutes(now, input.slaMinutes, hours)
  // breach_at is constrained to equal due_at + sla, so it is derived here
  // rather than invented.
  const breachAt = new Date(dueAt.getTime() + input.slaMinutes * 60_000)

  return db.transaction(async (tx) => {
    const [book] = await tx
      .select({ id: crmBooks.id })
      .from(crmBooks)
      .where(and(eq(crmBooks.tenant, input.tenant), eq(crmBooks.id, input.bookId)))
      .limit(1)
    if (!book) return { ok: false, reason: 'book_not_found' as const }

    if (input.assigneeId) {
      // The book was checked against the tenant above; the assignee named in
      // the same call was not. `crm_users.id` has no tenant component, so a
      // well-formed id from another tenant would otherwise pass straight
      // through into this tenant's task and notification.
      const [assignee] = await tx
        .select({ id: crmUsers.id })
        .from(crmUsers)
        .where(and(eq(crmUsers.tenant, input.tenant), eq(crmUsers.id, input.assigneeId)))
        .limit(1)
      if (!assignee) return { ok: false, reason: 'assignee_not_found' as const }
    }

    let task: TaskRow
    try {
      task = await tx.transaction(async (sp) => {
        const rows = await sp
          .insert(crmTasks)
          .values({
            tenant: input.tenant,
            playerId: input.playerId ?? null,
            bookId: input.bookId,
            assigneeId: input.assigneeId ?? null,
            createdBy: input.createdBy,
            source: input.source ?? 'manual',
            dedupeKey: input.dedupeKey ?? null,
            title: input.title,
            body: input.body ?? null,
            priority: input.priority ?? 'NORMAL',
            dueAt,
            slaMinutes: input.slaMinutes,
            breachAt,
            nextEscalationAt: breachAt,
          })
          .returning()
        return rows[0]
      })
    } catch (e) {
      const code = String((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code)
      // An automatic source raising the same task every sweep is expected, not
      // exceptional.
      if (code === '23505') return { ok: false, reason: 'duplicate' as const }
      throw e
    }

    await tx.insert(crmTaskEvents).values({
      tenant: input.tenant,
      taskId: task.id,
      kind: 'created',
      actor: input.createdBy,
      toValue: input.assigneeId ?? null,
    })

    if (task.assigneeId) {
      await notify(tx, {
        tenant: input.tenant,
        crmUserId: task.assigneeId,
        kind: 'task_assigned',
        title: input.title,
        body: 'A task was assigned to you',
        resourceType: 'task',
        resourceId: task.id,
        dedupeKey: `assigned:${task.id}`,
      })
    }
    return { ok: true, task }
  })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function notify(
  tx: Tx | typeof db,
  n: {
    tenant: string
    crmUserId: string
    kind: string
    title: string
    body?: string | null
    resourceType?: string | null
    resourceId?: string | null
    dedupeKey?: string | null
  }
): Promise<void> {
  await tx
    .insert(crmNotifications)
    .values({
      tenant: n.tenant,
      crmUserId: n.crmUserId,
      kind: n.kind,
      title: n.title.slice(0, 160),
      body: n.body?.slice(0, 500) ?? null,
      resourceType: n.resourceType ?? null,
      resourceId: n.resourceId ?? null,
      dedupeKey: n.dedupeKey ?? null,
    })
    .onConflictDoNothing()
}

export async function setTaskStatus(input: {
  tenant: string
  taskId: string
  status: TaskStatus
  outcome?: string | null
  actor: string
}): Promise<{ ok: boolean; reason?: 'not_found' | 'outcome_required' }> {
  // A task closed with no outcome tells the next person nothing, and the
  // database refuses it — checked here so the message is usable.
  if (input.status === 'DONE' && !input.outcome) {
    return { ok: false, reason: 'outcome_required' }
  }

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: crmTasks.status })
      .from(crmTasks)
      .where(and(eq(crmTasks.tenant, input.tenant), eq(crmTasks.id, input.taskId)))
      .limit(1)
    if (!before) return { ok: false, reason: 'not_found' as const }

    const done = input.status === 'DONE'
    await tx
      .update(crmTasks)
      .set({
        status: input.status,
        outcome: input.outcome ?? null,
        completedAt: done ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(crmTasks.tenant, input.tenant), eq(crmTasks.id, input.taskId)))

    await tx.insert(crmTaskEvents).values({
      tenant: input.tenant,
      taskId: input.taskId,
      kind: 'status',
      actor: input.actor,
      fromValue: before.status,
      toValue: input.status,
      note: input.outcome ?? null,
    })
    return { ok: true }
  })
}

/** Acknowledging stops the ladder. Escalating forever is noise, not urgency. */
export async function acknowledgeTask(input: {
  tenant: string
  taskId: string
  crmUserId: string
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(crmTasks)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: input.crmUserId, updatedAt: new Date() })
      .where(
        and(
          eq(crmTasks.tenant, input.tenant),
          eq(crmTasks.id, input.taskId),
          isNull(crmTasks.acknowledgedAt)
        )
      )
      .returning({ id: crmTasks.id })
    if (rows.length === 0) return false
    await tx.insert(crmTaskEvents).values({
      tenant: input.tenant,
      taskId: input.taskId,
      kind: 'acknowledged',
      actor: `crm:${input.crmUserId}`,
    })
    return true
  })
}

export async function assignTask(input: {
  tenant: string
  taskId: string
  assigneeId: string | null
  actor: string
}): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'assignee_not_found' }> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ assigneeId: crmTasks.assigneeId, title: crmTasks.title })
      .from(crmTasks)
      .where(and(eq(crmTasks.tenant, input.tenant), eq(crmTasks.id, input.taskId)))
      .limit(1)
    if (!before) return { ok: false, reason: 'not_found' as const }

    if (input.assigneeId) {
      // `crm_users.id` carries no tenant component, so an id from another
      // tenant validates as a well-formed uuid with nothing else to catch it.
      // Unvalidated, this wrote a notification into a foreign tenant's inbox
      // and rendered its holder's name in this tenant's queue.
      const [assignee] = await tx
        .select({ id: crmUsers.id })
        .from(crmUsers)
        .where(and(eq(crmUsers.tenant, input.tenant), eq(crmUsers.id, input.assigneeId)))
        .limit(1)
      if (!assignee) return { ok: false, reason: 'assignee_not_found' as const }
    }

    await tx
      .update(crmTasks)
      .set({ assigneeId: input.assigneeId, updatedAt: new Date() })
      .where(and(eq(crmTasks.tenant, input.tenant), eq(crmTasks.id, input.taskId)))

    await tx.insert(crmTaskEvents).values({
      tenant: input.tenant,
      taskId: input.taskId,
      kind: 'assigned',
      actor: input.actor,
      fromValue: before.assigneeId,
      toValue: input.assigneeId,
    })

    // Only on an actual change of hands, and keyed on the transition rather
    // than on the destination. `crm_notifications` dedupes on
    // (crm_user_id, dedupe_key) permanently — unlike the task dedupe, which is
    // restricted to open statuses — so a key of assigned:<task>:<assignee>
    // meant a task handed A → B → A never told A the second time. They got the
    // work back and heard nothing. Including the previous holder makes a real
    // reassignment a distinct event while a double-clicked Assign still
    // collapses to one.
    if (input.assigneeId && input.assigneeId !== before.assigneeId) {
      await notify(tx, {
        tenant: input.tenant,
        crmUserId: input.assigneeId,
        kind: 'task_assigned',
        title: before.title,
        body: 'A task was assigned to you',
        resourceType: 'task',
        resourceId: input.taskId,
        dedupeKey: `assigned:${input.taskId}:${input.assigneeId}:${before.assigneeId ?? 'none'}`,
      })
    }
    return { ok: true }
  })
}

/**
 * One task per player, for work a desk takes on as a batch.
 *
 * Built on `createTask` rather than a bulk INSERT so that every task gets the
 * same calendar-aware deadline, the same `created` event and the same assignee
 * notification a single one does — a batch that skipped those would produce
 * tasks the queue treats differently from every other task in it.
 *
 * **Every task carries a dedupe key.** `crm_tasks` has a partial unique index on
 * `(tenant, dedupe_key)` restricted to open statuses, so a double-clicked batch
 * of two hundred creates two hundred tasks once and reports the rest as already
 * open. The key is per player and per title, which means the same work can be
 * raised again for a player once the previous one is closed — a monthly chase
 * is not a duplicate of last month's.
 *
 * Returns counts rather than throwing on the first refusal: one player already
 * carrying the task must not stop the other hundred and ninety-nine.
 */
export async function createTasksForPlayers(input: {
  tenant: string
  playerIds: number[]
  bookId: string
  assigneeId?: string | null
  createdBy: string
  title: string
  body?: string | null
  priority?: TaskPriority
  slaMinutes: number
}): Promise<{ created: number; skippedDuplicate: number; failed: number }> {
  // A stable, short key for "this work, for this player". Truncated to fit
  // dedupe_key's 120 characters with room for the player id.
  const titleKey = createHash('sha1').update(input.title.trim().toLowerCase()).digest('hex').slice(0, 16)

  let created = 0
  let skippedDuplicate = 0
  let failed = 0

  for (const playerId of input.playerIds) {
    // `createTask` reports the refusals it anticipates, but it can also throw —
    // an oversized title, a constraint nobody predicted, a calendar the SLA
    // maths refuses. Without this catch the first such player aborted the whole
    // loop, so the tasks already written stayed written and the counts telling
    // the caller about them were thrown away with the exception. Counting it as
    // a failure keeps the batch's arithmetic true: created + duplicate + failed
    // always equals the number of players asked for.
    try {
      const res = await createTask({
        tenant: input.tenant,
        playerId,
        bookId: input.bookId,
        assigneeId: input.assigneeId ?? null,
        createdBy: input.createdBy,
        source: 'bulk',
        dedupeKey: `bulk:${playerId}:${titleKey}`,
        title: input.title,
        body: input.body ?? null,
        priority: input.priority ?? 'NORMAL',
        slaMinutes: input.slaMinutes,
      })
      if (res.ok) created++
      else if (res.reason === 'duplicate') skippedDuplicate++
      else failed++
    } catch (err) {
      failed++
      console.error('[crm] bulk task creation failed for one player', {
        tenant: input.tenant,
        playerId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { created, skippedDuplicate, failed }
}

/**
 * Moves a player's open tasks when they change book.
 *
 * Without this the work stays with a desk that no longer holds the player, and
 * the new desk has no idea it exists.
 */
export async function movePlayerTasksToBook(input: {
  tenant: string
  playerId: number
  bookId: string
  actor: string
}): Promise<number> {
  return db.transaction(async (tx) => {
    const moved = await tx
      .update(crmTasks)
      .set({ bookId: input.bookId, updatedAt: new Date() })
      .where(
        and(
          eq(crmTasks.tenant, input.tenant),
          eq(crmTasks.playerId, input.playerId),
          inArray(crmTasks.status, ['OPEN', 'IN_PROGRESS', 'BLOCKED'])
        )
      )
      .returning({ id: crmTasks.id })

    for (const t of moved) {
      await tx.insert(crmTaskEvents).values({
        tenant: input.tenant,
        taskId: t.id,
        kind: 'book_moved',
        actor: input.actor,
        toValue: input.bookId,
      })
    }
    return moved.length
  })
}

// ---------------------------------------------------------------------------
// Reading the queue
// ---------------------------------------------------------------------------

export type TaskFilter = {
  assignedToMe?: boolean
  unassigned?: boolean
  status?: TaskStatus[] | null
  playerId?: number | null
  breachingOnly?: boolean
}

export async function listTasks(
  tenant: string,
  crmUserId: string,
  bookIds: string[],
  viewAll: boolean,
  filter: TaskFilter
): Promise<Array<TaskRow & { bookName: string; assigneeName: string | null; isBreaching: boolean }>> {
  const clauses = [sql`t.tenant = ${tenant}`]

  // The same rule as players: without view_all a caller sees their books, and
  // no books means nothing rather than everything.
  if (!viewAll) {
    if (bookIds.length === 0) return []
    clauses.push(
      sql`t.book_id IN (${sql.join(
        bookIds.map((b) => sql`${b}::uuid`),
        sql`, `
      )})`
    )
  }
  if (filter.assignedToMe) clauses.push(sql`t.assignee_id = ${crmUserId}::uuid`)
  if (filter.unassigned) clauses.push(sql`t.assignee_id is null`)
  if (filter.playerId) clauses.push(sql`t.player_id = ${filter.playerId}`)
  if (filter.breachingOnly) clauses.push(sql`t.breach_at <= now() and t.acknowledged_at is null`)
  clauses.push(
    filter.status?.length
      ? sql`t.status IN (${sql.join(
          filter.status.map((s) => sql`${s}`),
          sql`, `
        )})`
      : sql`t.status IN ('OPEN','IN_PROGRESS','BLOCKED')`
  )

  const res = await db.execute(sql`
    SELECT t.*, b.name AS book_name, u.name AS assignee_name,
           (t.breach_at <= now() AND t.acknowledged_at IS NULL) AS is_breaching
    FROM crm_tasks t
    JOIN crm_books b ON b.id = t.book_id
    -- assignee_id carries no tenant component of its own; now that createTask
    -- and assignTask both refuse a cross-tenant id at the write, this join
    -- condition is defence in depth rather than the only thing standing
    -- between a bad row and rendering a foreign tenant's user name.
    LEFT JOIN crm_users u ON u.id = t.assignee_id AND u.tenant = t.tenant
    WHERE ${sql.join(clauses, sql` AND `)}
    ORDER BY (t.breach_at <= now() AND t.acknowledged_at IS NULL) DESC,
             t.priority = 'URGENT' DESC, t.due_at ASC
    LIMIT 200`)

  return res.rows as never
}

export async function listTaskEvents(tenant: string, taskId: string) {
  return db
    .select()
    .from(crmTaskEvents)
    .where(and(eq(crmTaskEvents.tenant, tenant), eq(crmTaskEvents.taskId, taskId)))
    .orderBy(asc(crmTaskEvents.createdAt))
}

/**
 * The book a task currently belongs to, for scope checks on every by-id path.
 *
 * `listTasks` filters by book; nothing that reaches a task through its id did,
 * because a task id survives the player it names moving to another book. Every
 * caller resolving `?? null` and refusing on a miss reports the same "Task not
 * found" whether the id was never real or just out of reach — a bookId is
 * never revealed to someone who cannot already see it.
 */
export async function getTaskBookId(tenant: string, taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ bookId: crmTasks.bookId })
    .from(crmTasks)
    .where(and(eq(crmTasks.tenant, tenant), eq(crmTasks.id, taskId)))
    .limit(1)
  return row?.bookId ?? null
}
