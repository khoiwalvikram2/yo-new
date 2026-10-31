import {
  crmPlayerScope,
  crmCanViewAllPlayers,
  requireCrmPermission,
  requireCrmUser,
  requireCrmWrite,
  type CrmContext,
} from '@src/domains/crm/guards.js'
import { canCrmUserSeePlayer } from '@src/repos/crm/CrmPlayersRepo.js'
import { getBookIdsForCrmUser } from '@src/repos/crm/CrmBooksRepo.js'
import {
  createTask,
  setTaskStatus,
  assignTask,
  acknowledgeTask,
  listTasks,
  listTaskEvents,
  getTaskBookId,
  type TaskStatus,
  type TaskPriority,
} from '@src/repos/crm/CrmTasksRepo.js'
import { db } from '@src/db/client.js'
import { crmNotifications, crmTasks } from '@shared/db/schema.js'
import { and, eq, desc, isNull, sql } from 'drizzle-orm'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'
import {
  recordContactAttempt,
  listContactAttempts,
  CONTACT_CHANNELS,
  CONTACT_OUTCOMES,
  type ContactChannel,
  type ContactOutcome,
} from '@src/repos/crm/CrmContactRepo.js'

/**
 * Timestamps reach this file two ways: as Date objects from drizzle's typed
 * selects, and as whatever the driver hands back from the raw SQL the queue
 * query uses. Accepting both is not laziness — assuming Date threw on the first
 * real queue read.
 */
const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

const STATUSES: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']
const PRIORITIES: TaskPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const OUTCOMES = ['contacted', 'no_answer', 'wrong_number', 'refused', 'resolved', 'not_required']

/**
 * The most players one bulk create may cover.
 *
 * Matched to the player export's cap for the same reason: a screenful of
 * selected rows is the intended input, and a number far past that is someone
 * automating rather than working. Each task is a real row with a deadline and a
 * notification, so the cap is a bound on what one click can set in motion.
 */
const BULK_TASK_CAP = 200

/**
 * The column is `varchar(160)`, and Postgres does not truncate — it raises
 * 22001, which escaped `createTask` as an unhandled error and reached the
 * operator as nothing at all. Checked here so the refusal names the limit.
 */
const MAX_TASK_TITLE = 160
/** `crm_tasks.body` is text, but a task body is a note, not a document. */
const MAX_TASK_BODY = 2_000

function checkTaskText(title: string, body?: string | null): string | null {
  if (!title.trim()) return 'A task needs a title'
  if (title.trim().length > MAX_TASK_TITLE) {
    return `Keep the title under ${MAX_TASK_TITLE} characters`
  }
  if (body && body.length > MAX_TASK_BODY) {
    return `Keep the notes under ${MAX_TASK_BODY} characters`
  }
  return null
}

function presentTask(t: Record<string, any>) {
  return {
    id: t.id,
    playerId: t.player_id ?? t.playerId ?? null,
    bookId: t.book_id ?? t.bookId,
    bookName: t.book_name ?? null,
    assigneeId: t.assignee_id ?? t.assigneeId ?? null,
    assigneeName: t.assignee_name ?? null,
    title: t.title,
    body: t.body,
    priority: t.priority,
    status: t.status,
    outcome: t.outcome,
    source: t.source,
    dueAt: iso(t.due_at ?? t.dueAt),
    slaMinutes: t.sla_minutes ?? t.slaMinutes,
    breachAt: iso(t.breach_at ?? t.breachAt),
    isBreaching: t.is_breaching ?? false,
    escalationLevel: t.escalation_level ?? t.escalationLevel ?? 0,
    acknowledgedAt: iso(t.acknowledged_at ?? t.acknowledgedAt),
    completedAt: iso(t.completed_at ?? t.completedAt),
    createdAt: iso(t.created_at ?? t.createdAt),
  }
}

/** Whether this caller may act on the given book, by the same rule `crmTasks` lists by. */
async function bookReachable(ctx: CrmContext, bookId: string): Promise<boolean> {
  if (crmCanViewAllPlayers(ctx)) return true
  const user = requireCrmUser(ctx)
  const bookIds = await getBookIdsForCrmUser(user.tenant, user.id)
  return bookIds.includes(bookId)
}

/**
 * Whether this caller may reach a task by its id.
 *
 * `crmTasks` scopes the list by book; nothing that reaches a task through its
 * id alone did, because the id survives the player it names moving to another
 * book. Every by-id path below refuses with the same "Task not found" an
 * unknown id gets, so out-of-scope is indistinguishable from missing.
 *
 * Deliberately not applied to `crmAcknowledgeTask`: the escalation ladder's own
 * fallback (`CrmEscalationRepo.resolveEscalationTargets`) notifies a tenant-wide
 * `crm.tasks:escalate` holder precisely when nobody *in* the book holds it, so
 * the person the system told to handle a breach can be outside its book by
 * design. That path stays gated by the escalate permission alone, which is
 * already the same permission the ladder's recipient set is built from.
 */
async function taskReachable(ctx: CrmContext, taskId: string): Promise<boolean> {
  const user = requireCrmUser(ctx)
  const bookId = await getTaskBookId(user.tenant, taskId)
  if (!bookId) return false
  return bookReachable(ctx, bookId)
}

export const crmTaskQueries = {
  crmTasks: async (
    _: unknown,
    args: {
      filter?: {
        assignedToMe?: boolean
        unassigned?: boolean
        status?: string[]
        playerId?: string
        breachingOnly?: boolean
      } | null
    },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.tasks', 'view')
    const user = requireCrmUser(ctx)
    const viewAll = crmCanViewAllPlayers(ctx)
    const bookIds = viewAll ? [] : await getBookIdsForCrmUser(user.tenant, user.id)

    const rows = await listTasks(user.tenant, user.id, bookIds, viewAll, {
      assignedToMe: args.filter?.assignedToMe,
      unassigned: args.filter?.unassigned,
      status: (args.filter?.status as TaskStatus[] | undefined) ?? null,
      playerId: args.filter?.playerId ? Number(args.filter.playerId) : null,
      breachingOnly: args.filter?.breachingOnly,
    })
    return rows.map(presentTask)
  },

  /**
   * What was tried, and what came of it.
   *
   * A record of attempts rather than sends: nothing in this process can message
   * a player, so what actually happens is an agent picking up the phone.
   */
  crmContactAttempts: async (_: unknown, args: { playerId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.players', 'view')
    const user = requireCrmUser(ctx)
    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId)) return []

    const scope = await crmPlayerScope(ctx)
    if (!(await canCrmUserSeePlayer(scope, playerId))) return []

    const rows = await listContactAttempts(user.tenant, playerId)
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      direction: r.direction,
      outcome: r.outcome,
      notes: r.notes,
      byName: r.byName,
      occurredAt: iso(r.occurredAt),
    }))
  },

  crmTaskEvents: async (_: unknown, args: { taskId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.tasks', 'view')
    const user = requireCrmUser(ctx)
    if (!(await taskReachable(ctx, args.taskId))) return []
    const rows = await listTaskEvents(user.tenant, args.taskId)
    return rows.map((e) => ({
      id: e.id,
      kind: e.kind,
      actor: e.actor,
      fromValue: e.fromValue,
      toValue: e.toValue,
      note: e.note,
      createdAt: iso(e.createdAt),
    }))
  },

  /**
   * The caller's own inbox.
   *
   * Takes no user argument on purpose: reading someone else's notifications is
   * not expressible rather than merely refused.
   */
  crmMyNotifications: async (_: unknown, args: { unreadOnly?: boolean }, ctx: CrmContext) => {
    const user = requireCrmUser(ctx)
    const rows = await db
      .select()
      .from(crmNotifications)
      .where(
        args.unreadOnly
          ? and(eq(crmNotifications.crmUserId, user.id), isNull(crmNotifications.readAt))
          : eq(crmNotifications.crmUserId, user.id)
      )
      .orderBy(desc(crmNotifications.createdAt))
      .limit(100)
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      resourceType: n.resourceType,
      resourceId: n.resourceId,
      readAt: iso(n.readAt),
      createdAt: iso(n.createdAt),
    }))
  },
}

export const crmTaskMutations = {
  crmCreateTask: async (
    _: unknown,
    args: {
      bookId: string
      title: string
      slaMinutes: number
      playerId?: string
      assigneeId?: string
      body?: string
      priority?: string
    },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.tasks', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const badText = checkTaskText(String(args.title ?? ''), args.body)
    if (badText) return { ok: false, error: badText }
    const sla = Number(args.slaMinutes)
    if (!Number.isFinite(sla) || sla < 5) return { ok: false, error: 'The SLA must be at least 5 minutes' }
    if (args.priority && !PRIORITIES.includes(args.priority as TaskPriority)) {
      return { ok: false, error: 'Unknown priority' }
    }

    // Previously validated only that the book existed in the tenant, so a
    // `manage` holder with no membership in it could inject a task into any
    // other desk's queue.
    if (!(await bookReachable(ctx, args.bookId))) {
      return { ok: false, error: 'That book is not in your books' }
    }

    let playerId: number | null = null
    if (args.playerId) {
      playerId = Number(args.playerId)
      if (!Number.isFinite(playerId)) return { ok: false, error: 'Unknown player' }
      const scope = await crmPlayerScope(ctx)
      if (!(await canCrmUserSeePlayer(scope, playerId))) {
        return { ok: false, error: 'That player is not in your books' }
      }
    }

    const res = await createTask({
      tenant: user.tenant,
      playerId,
      bookId: args.bookId,
      assigneeId: args.assigneeId ?? null,
      createdBy: `crm:${user.id}`,
      title: args.title.trim(),
      body: args.body ?? null,
      priority: (args.priority as TaskPriority) ?? 'NORMAL',
      slaMinutes: sla,
    })

    if (!res.ok) {
      return {
        ok: false,
        error:
          res.reason === 'duplicate'
            ? 'That task is already open'
            : res.reason === 'assignee_not_found'
              ? 'Unknown assignee'
              : 'Book not found',
      }
    }
    return { ok: true, error: null }
  },

  /**
   * The same task for a set of players, raised in one go.
   *
   * Every guard the single-task path applies is applied here too, per player —
   * the book must be one the caller works, and each player must be reachable —
   * so a crafted id list can only shrink the batch, never widen it.
   *
   * Two deliberate choices:
   *
   *   - **Explicit ids, not a filter.** "Create a task for everyone matching
   *     this segment" is one click away from forty thousand tasks, and what the
   *     caller saw on screen is not what a re-run filter would return. The
   *     selection is the instruction.
   *   - **Counts, not a boolean.** A batch where nine of two hundred were
   *     already open has to say so; silently creating 191 and reporting success
   *     is how people stop trusting the number.
   */
  crmCreateTasksForPlayers: async (
    _: unknown,
    args: {
      playerIds: string[]
      bookId: string
      title: string
      slaMinutes: number
      assigneeId?: string
      body?: string
      priority?: string
    },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.tasks', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const badBulkText = checkTaskText(String(args.title ?? ''), args.body)
    if (badBulkText) {
      return { ok: false, error: badBulkText, created: 0, skippedDuplicate: 0, skippedUnreachable: 0 }
    }
    const sla = Number(args.slaMinutes)
    if (!Number.isFinite(sla) || sla < 5) {
      return { ok: false, error: 'The SLA must be at least 5 minutes', created: 0, skippedDuplicate: 0, skippedUnreachable: 0 }
    }
    if (args.priority && !PRIORITIES.includes(args.priority as TaskPriority)) {
      return { ok: false, error: 'Unknown priority', created: 0, skippedDuplicate: 0, skippedUnreachable: 0 }
    }
    if (!(await bookReachable(ctx, args.bookId))) {
      return { ok: false, error: 'That book is not in your books', created: 0, skippedDuplicate: 0, skippedUnreachable: 0 }
    }

    const ids = Array.from(
      new Set((args.playerIds ?? []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))
    )
    if (ids.length === 0) {
      return { ok: false, error: 'No players selected', created: 0, skippedDuplicate: 0, skippedUnreachable: 0 }
    }
    if (ids.length > BULK_TASK_CAP) {
      return {
        ok: false,
        error: `Select at most ${BULK_TASK_CAP} players at a time`,
        created: 0,
        skippedDuplicate: 0,
        skippedUnreachable: 0,
      }
    }

    // Each player is checked with the same call the single-task path uses, so
    // there is no second definition of "reachable" to drift from the first.
    const scope = await crmPlayerScope(ctx)
    const reachable: number[] = []
    for (const id of ids) {
      if (await canCrmUserSeePlayer(scope, id)) reachable.push(id)
    }
    const skippedUnreachable = ids.length - reachable.length
    if (reachable.length === 0) {
      return {
        ok: false,
        error: 'None of those players are in your books',
        created: 0,
        skippedDuplicate: 0,
        skippedUnreachable,
      }
    }

    const { createTasksForPlayers } = await import('@src/repos/crm/CrmTasksRepo.js')
    const res = await createTasksForPlayers({
      tenant: user.tenant,
      playerIds: reachable,
      bookId: args.bookId,
      assigneeId: args.assigneeId ?? null,
      createdBy: `crm:${user.id}`,
      title: args.title.trim(),
      body: args.body ?? null,
      priority: (args.priority as TaskPriority) ?? 'NORMAL',
      slaMinutes: sla,
    })

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'create_tasks_bulk',
      resourceType: 'crm_book',
      resourceId: args.bookId,
      before: { title: args.title.trim(), ...res, skippedUnreachable },
    }).catch(() => {})

    // `failed` was previously dropped on the floor and `ok` hard-coded true, so
    // a batch where every task was refused reported success with created=0 and
    // no reason — the exact shape this operation returns counts to avoid.
    return {
      ok: res.failed === 0,
      error:
        res.failed > 0
          ? `${res.failed} of ${reachable.length} could not be created — check the server log`
          : null,
      created: res.created,
      skippedDuplicate: res.skippedDuplicate,
      skippedUnreachable,
    }
  },

  crmSetTaskStatus: async (
    _: unknown,
    args: { taskId: string; status: string; outcome?: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.tasks', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    if (!STATUSES.includes(args.status as TaskStatus)) return { ok: false, error: 'Unknown status' }
    if (args.outcome && !OUTCOMES.includes(args.outcome)) return { ok: false, error: 'Unknown outcome' }

    // A task id survives the player it names moving to another book — checked
    // here so a `manage` holder cannot cancel or close another desk's work by
    // replaying an id kept from before the move.
    if (!(await taskReachable(ctx, args.taskId))) return { ok: false, error: 'Task not found' }

    const res = await setTaskStatus({
      tenant: user.tenant,
      taskId: args.taskId,
      status: args.status as TaskStatus,
      outcome: args.outcome ?? null,
      actor: `crm:${user.id}`,
    })
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.reason === 'outcome_required'
            ? 'Say what happened before closing this'
            : 'Task not found',
      }
    }
    return { ok: true, error: null }
  },

  crmAssignTask: async (
    _: unknown,
    args: { taskId: string; assigneeId?: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.tasks', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    // Same reasoning as crmSetTaskStatus: a task id outlives the player's move
    // to another book, and reassigning is the direction that also fires a
    // notification carrying the task's title into the new assignee's inbox.
    if (!(await taskReachable(ctx, args.taskId))) return { ok: false, error: 'Task not found' }

    const res = await assignTask({
      tenant: user.tenant,
      taskId: args.taskId,
      assigneeId: args.assigneeId ?? null,
      actor: `crm:${user.id}`,
    })
    if (!res.ok) {
      return {
        ok: false,
        error: res.reason === 'assignee_not_found' ? 'Unknown assignee' : 'Task not found',
      }
    }
    return { ok: true, error: null }
  },

  /** Stops the ladder. Whoever picks it up is saying they have it. */
  crmAcknowledgeTask: async (_: unknown, args: { taskId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.tasks', 'escalate')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)
    const done = await acknowledgeTask({
      tenant: user.tenant,
      taskId: args.taskId,
      crmUserId: user.id,
    })
    if (!done) return { ok: false, error: 'Task not found, or already acknowledged' }
    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'acknowledge_task',
      resourceType: 'crm_task',
      resourceId: args.taskId,
      before: null,
    }).catch(() => {})
    return { ok: true, error: null }
  },

  crmRecordContactAttempt: async (
    _: unknown,
    args: {
      playerId: string
      channel: string
      outcome: string
      taskId?: string
      notes?: string
      direction?: string
    },
    ctx: CrmContext
  ) => {
    // `crm.players:view` is a read permission; this writes to the player's
    // record (a timestamped, attributed row, with up to 500 characters of free
    // text) and there was previously nothing that could withhold it — a
    // deliberately read-only role could still attach notes to a player through
    // this path. Contact work is task work, so it takes the same permission
    // task mutations do.
    requireCrmPermission(ctx, 'crm.tasks', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId)) return { ok: false, error: 'Unknown player' }
    if (!CONTACT_CHANNELS.includes(args.channel as ContactChannel)) {
      return { ok: false, error: 'Unknown channel' }
    }
    if (!CONTACT_OUTCOMES.includes(args.outcome as ContactOutcome)) {
      return { ok: false, error: 'Unknown outcome' }
    }

    const scope = await crmPlayerScope(ctx)
    if (!(await canCrmUserSeePlayer(scope, playerId))) {
      return { ok: false, error: 'That player is not in your books' }
    }

    await recordContactAttempt({
      tenant: user.tenant,
      playerId,
      taskId: args.taskId ?? null,
      channel: args.channel as ContactChannel,
      direction: args.direction === 'in' ? 'in' : 'out',
      outcome: args.outcome as ContactOutcome,
      notes: args.notes ?? null,
      byCrmUserId: user.id,
      byName: user.name,
    })
    return { ok: true, error: null }
  },

  crmMarkNotificationsRead: async (_: unknown, args: { ids?: string[] }, ctx: CrmContext) => {
    const user = requireCrmUser(ctx)
    // Predicated on the caller's own id, so a crafted id list cannot touch
    // anyone else's inbox.
    const where = args.ids?.length
      ? and(
          eq(crmNotifications.crmUserId, user.id),
          sql`${crmNotifications.id} IN (${sql.join(
            args.ids.map((id) => sql`${id}::uuid`),
            sql`, `
          )})`
        )
      : eq(crmNotifications.crmUserId, user.id)

    await db.update(crmNotifications).set({ readAt: new Date(), updatedAt: new Date() }).where(where)
    return { ok: true, error: null }
  },
}
