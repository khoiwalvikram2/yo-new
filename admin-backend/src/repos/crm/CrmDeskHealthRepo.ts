/**
 * What is falling through on a desk, right now.
 *
 * The queue answers "what is on my list"; this answers "what is going wrong",
 * which is a different question with a different audience and a different
 * ordering. Severity first, oldest first within that.
 *
 * The sharpest item is one the system already detects and then keeps to itself.
 * When the escalation ladder finds no eligible recipient it writes an
 * `escalation_failed` event, gives the rung back and leaves the task breaching
 * so the next sweep retries. Correct — and invisible, because nothing reads
 * those events. A task can reach nobody every two hours indefinitely and the
 * only trace is a row in `crm_task_events`.
 *
 * Two decisions shape this file:
 *
 *   1. **Everything drives from `crm_tasks`.** `crm_task_events` is indexed on
 *      `(task_id, created_at)` and nothing else, so scanning it by `kind` across
 *      a tenant is a sequential scan. `crm_tasks` carries partial indexes for
 *      open, breaching, per-book and per-assignee access; events are reached
 *      through the task id. No new index, no migration.
 *
 *   2. **"Uncovered" is asked of the sweep, never re-implemented.** See
 *      `findUncoveredBooks`.
 */
import { db } from '@src/db/client.js'
import { sql } from 'drizzle-orm'
import { listCrmBooks } from '@src/repos/crm/CrmBooksRepo.js'
import { resolveEscalationTargets } from '@src/repos/crm/CrmEscalationRepo.js'
import { MAX_ESCALATION_LEVEL } from '@src/repos/crm/CrmTasksRepo.js'

/** How far back a run of unanswered contact attempts still counts. */
const CONTACT_WINDOW_DAYS = 30
/** Attempts on one player, none of them connected, before the desk should look. */
const UNREACHED_ATTEMPT_THRESHOLD = 3
/** Rows returned per bucket. The count is separate, so the page is bounded however bad it gets. */
const ROWS_PER_BUCKET = 5

export type DeskScope = {
  tenant: string
  viewAll: boolean
  bookIds: string[]
}

export type TaskRow = {
  id: string
  title: string
  bookId: string
  bookName: string
  playerId: number | null
  assigneeName: string | null
  breachAt: string | null
  minutesOverdue: number
  escalationLevel: number
  /** Bucket 1 only: how many times the ladder has failed to reach anybody. */
  failedAttempts?: number
  /** Bucket 1 only: when it first failed. */
  firstFailedAt?: string | null
}

export type UncoveredBook = { bookId: string; bookName: string; openTasks: number }

export type UnreachedPlayer = {
  playerId: number
  playerName: string | null
  attempts: number
  lastAttemptAt: string | null
  lastOutcome: string | null
}

export type Bucket<T> = { total: number; rows: T[] }

export type DeskHealth = {
  reachedNobody: Bucket<TaskRow>
  uncoveredBooks: Bucket<UncoveredBook>
  ladderExhausted: Bucket<TaskRow>
  breaching: Bucket<TaskRow>
  unassigned: Bucket<TaskRow>
  neverReached: Bucket<UnreachedPlayer>
  /** True when every bucket is empty — the page says so rather than looking broken. */
  allClear: boolean
}

/**
 * The book predicate, written once.
 *
 * A caller without `view_all` and without books matches nothing, expressed as
 * `false` rather than by omitting the clause. Every scope bug this codebase has
 * had was that inversion.
 */
function bookScope(scope: DeskScope): ReturnType<typeof sql> {
  if (scope.viewAll) return sql`true`
  if (scope.bookIds.length === 0) return sql`false`
  return sql`t.book_id IN (${sql.join(
    scope.bookIds.map((id) => sql`${id}::uuid`),
    sql`, `
  )})`
}

const OPEN_STATUSES = sql`t.status IN ('OPEN','IN_PROGRESS','BLOCKED')`

/** Shared projection so every task bucket returns the same shape. */
const TASK_SELECT = sql`
  t.id, t.title, t.book_id, b.name AS book_name, t.player_id,
  u.name AS assignee_name, t.breach_at, t.escalation_level,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - t.breach_at)) / 60)::int AS minutes_overdue`

function toTaskRow(r: any): TaskRow {
  return {
    id: String(r.id),
    title: r.title,
    bookId: String(r.book_id),
    bookName: r.book_name,
    playerId: r.player_id ?? null,
    assigneeName: r.assignee_name ?? null,
    breachAt: r.breach_at ? new Date(r.breach_at).toISOString() : null,
    minutesOverdue: Number(r.minutes_overdue ?? 0),
    escalationLevel: Number(r.escalation_level ?? 0),
    ...(r.failed_attempts !== undefined ? { failedAttempts: Number(r.failed_attempts) } : {}),
    ...(r.first_failed_at !== undefined
      ? { firstFailedAt: r.first_failed_at ? new Date(r.first_failed_at).toISOString() : null }
      : {}),
  }
}

/**
 * Tasks the escalation ladder could not deliver to anybody.
 *
 * Grouped to distinct tasks, because the sweep rewrites `escalation_failed`
 * every two hours for as long as the problem lasts — counting events would show
 * one task over and over. The repeat count is not noise, it is the severity:
 * failing twelve times over a day is a different problem from failing once.
 *
 * Restricted to tasks that are still open and unacknowledged, or the list fills
 * with the history of problems already dealt with.
 */
async function findReachedNobody(scope: DeskScope): Promise<Bucket<TaskRow>> {
  const where = sql`
    t.tenant = ${scope.tenant}
    AND ${OPEN_STATUSES}
    AND t.acknowledged_at IS NULL
    AND ${bookScope(scope)}
    AND EXISTS (
      SELECT 1 FROM crm_task_events e
      WHERE e.task_id = t.id AND e.kind = 'escalation_failed'
    )`

  const [rows, total] = await Promise.all([
    db.execute(sql`
      SELECT ${TASK_SELECT},
             (SELECT count(*)::int FROM crm_task_events e
                WHERE e.task_id = t.id AND e.kind = 'escalation_failed') AS failed_attempts,
             (SELECT min(e.created_at) FROM crm_task_events e
                WHERE e.task_id = t.id AND e.kind = 'escalation_failed') AS first_failed_at
      FROM crm_tasks t
      JOIN crm_books b ON b.id = t.book_id
      LEFT JOIN crm_users u ON u.id = t.assignee_id AND u.tenant = t.tenant
      WHERE ${where}
      ORDER BY failed_attempts DESC, t.breach_at ASC
      LIMIT ${ROWS_PER_BUCKET}`),
    db.execute(sql`SELECT count(*)::int AS n FROM crm_tasks t WHERE ${where}`),
  ])
  return { total: Number((total.rows[0] as any)?.n ?? 0), rows: (rows.rows as any[]).map(toTaskRow) }
}

/**
 * Books for which the ladder would find nobody.
 *
 * Asked of `resolveEscalationTargets` — the function the sweep itself calls —
 * rather than answered here. A book whose members hold no `crm.tasks:escalate`
 * is *not* automatically broken: the ladder widens to any escalate-holder in the
 * tenant when the book has none, and that fallback may well cover it.
 *
 * Re-implementing the rule would eventually disagree with the sweep, and the
 * failure mode is the worst available: the screen reporting a healthy desk while
 * the sweep keeps reaching nobody.
 *
 * `assigneeId` is null because this asks whether the book has cover at all, not
 * whether one particular task can escalate past its assignee.
 */
async function findUncoveredBooks(scope: DeskScope): Promise<Bucket<UncoveredBook>> {
  const books = await listCrmBooks(scope.tenant)
  const inScope = scope.viewAll ? books : books.filter((b) => scope.bookIds.includes(b.id))
  if (inScope.length === 0) return { total: 0, rows: [] }

  const uncovered: UncoveredBook[] = []
  for (const book of inScope) {
    const targets = await resolveEscalationTargets(scope.tenant, book.id, null)
    if (targets.length > 0) continue
    const open = await db.execute(sql`
      SELECT count(*)::int AS n FROM crm_tasks t
      WHERE t.tenant = ${scope.tenant} AND t.book_id = ${book.id}::uuid AND ${OPEN_STATUSES}`)
    uncovered.push({
      bookId: book.id,
      bookName: book.name,
      openTasks: Number((open.rows[0] as any)?.n ?? 0),
    })
  }
  // Most open work first: an uncovered book with nothing in it is a latent
  // problem, one with forty tasks is a live one.
  uncovered.sort((a, b) => b.openTasks - a.openTasks)
  return { total: uncovered.length, rows: uncovered.slice(0, ROWS_PER_BUCKET) }
}

/** One shape for the three plain task buckets, so their scoping cannot drift apart. */
async function taskBucket(scope: DeskScope, extra: ReturnType<typeof sql>): Promise<Bucket<TaskRow>> {
  const where = sql`
    t.tenant = ${scope.tenant}
    AND ${OPEN_STATUSES}
    AND ${bookScope(scope)}
    AND ${extra}`

  const [rows, total] = await Promise.all([
    db.execute(sql`
      SELECT ${TASK_SELECT}
      FROM crm_tasks t
      JOIN crm_books b ON b.id = t.book_id
      LEFT JOIN crm_users u ON u.id = t.assignee_id AND u.tenant = t.tenant
      WHERE ${where}
      ORDER BY t.breach_at ASC NULLS LAST
      LIMIT ${ROWS_PER_BUCKET}`),
    db.execute(sql`SELECT count(*)::int AS n FROM crm_tasks t WHERE ${where}`),
  ])
  return { total: Number((total.rows[0] as any)?.n ?? 0), rows: (rows.rows as any[]).map(toTaskRow) }
}

/**
 * Players the desk has tried to reach and never got through to.
 *
 * Bounded to a window, or a player contacted unsuccessfully once a year ago
 * stays on the list forever. A single `connected` clears them: the point is
 * runs of failure, not a tally of every call.
 */
async function findNeverReached(scope: DeskScope): Promise<Bucket<UnreachedPlayer>> {
  // Contact attempts carry no book, so scope is applied through the player's
  // assignment — the same route `canCrmUserSeePlayer` uses.
  const playerScope = scope.viewAll
    ? sql`true`
    : scope.bookIds.length === 0
      ? sql`false`
      : sql`EXISTS (
          SELECT 1 FROM crm_player_assignments a
          WHERE a.player_id = ca.player_id AND a.tenant = ${scope.tenant}
            AND a.book_id IN (${sql.join(
              scope.bookIds.map((id) => sql`${id}::uuid`),
              sql`, `
            )})
        )`

  const grouped = sql`
    SELECT ca.player_id,
           count(*)::int AS attempts,
           max(ca.occurred_at) AS last_attempt_at
    FROM crm_contact_attempts ca
    WHERE ca.tenant = ${scope.tenant}
      AND ca.occurred_at >= now() - make_interval(days => ${CONTACT_WINDOW_DAYS})
      AND ${playerScope}
    GROUP BY ca.player_id
    HAVING count(*) >= ${UNREACHED_ATTEMPT_THRESHOLD}
       AND count(*) FILTER (WHERE ca.outcome = 'connected') = 0`

  const [rows, total] = await Promise.all([
    db.execute(sql`
      WITH runs AS (${grouped})
      SELECT r.player_id, r.attempts, r.last_attempt_at, u.name AS player_name,
             (SELECT ca2.outcome FROM crm_contact_attempts ca2
               WHERE ca2.player_id = r.player_id AND ca2.tenant = ${scope.tenant}
               ORDER BY ca2.occurred_at DESC LIMIT 1) AS last_outcome
      FROM runs r
      LEFT JOIN users u ON u.id = r.player_id AND u.tenant = ${scope.tenant}
      ORDER BY r.attempts DESC, r.last_attempt_at DESC
      LIMIT ${ROWS_PER_BUCKET}`),
    db.execute(sql`WITH runs AS (${grouped}) SELECT count(*)::int AS n FROM runs`),
  ])

  return {
    total: Number((total.rows[0] as any)?.n ?? 0),
    rows: (rows.rows as any[]).map((r) => ({
      playerId: Number(r.player_id),
      playerName: r.player_name ?? null,
      attempts: Number(r.attempts),
      lastAttemptAt: r.last_attempt_at ? new Date(r.last_attempt_at).toISOString() : null,
      lastOutcome: r.last_outcome ?? null,
    })),
  }
}

export async function getDeskHealth(scope: DeskScope): Promise<DeskHealth> {
  const [reachedNobody, uncoveredBooks, ladderExhausted, breaching, unassigned, neverReached] =
    await Promise.all([
      findReachedNobody(scope),
      findUncoveredBooks(scope),
      taskBucket(
        scope,
        sql`t.acknowledged_at IS NULL AND t.escalation_level >= ${MAX_ESCALATION_LEVEL}`
      ),
      taskBucket(scope, sql`t.acknowledged_at IS NULL AND t.breach_at <= now()`),
      taskBucket(scope, sql`t.assignee_id IS NULL`),
      findNeverReached(scope),
    ])

  return {
    reachedNobody,
    uncoveredBooks,
    ladderExhausted,
    breaching,
    unassigned,
    neverReached,
    allClear:
      reachedNobody.total === 0 &&
      uncoveredBooks.total === 0 &&
      ladderExhausted.total === 0 &&
      breaching.total === 0 &&
      unassigned.total === 0 &&
      neverReached.total === 0,
  }
}
