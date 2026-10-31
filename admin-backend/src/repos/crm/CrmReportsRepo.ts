import { db } from '@src/db/client.js'
import { sql, type SQL } from 'drizzle-orm'

/**
 * The desk's numbers over a date range.
 *
 * Desk health answers "what is going wrong right now"; this answers "how did
 * the period go" — throughput, deadlines, whether calls connected, and who did
 * the work. Different question, different audience, and the one the platform
 * had no answer to at all: nothing aggregated CRM activity over time.
 *
 * Everything is computed live against the operational tables. That is a
 * deliberate choice over nightly snapshots: tasks, contact attempts and notes
 * are desk-sized — hundreds to low thousands of rows per tenant per month, not
 * the bet tables' millions — and every query here walks an existing index.
 * A snapshot pipeline would add a table, a scheduler and a backfill for data
 * that a single indexed pass already serves, and its numbers would be a day
 * old. If a tenant ever outgrows this, the seam to add caching is this module.
 *
 * Scoped exactly like desk health: the caller's books, or the whole whitelabel
 * with `crm.players:view_all`, and the empty case is SQL `false` — never an
 * omitted clause.
 */

export type ReportScope = {
  tenant: string
  viewAll: boolean
  bookIds: string[]
}

export type DeskReport = {
  tasks: {
    created: number
    completed: number
    /** Went past their deadline unacknowledged during the period. */
    breached: number
    openNow: number
    /** Creation to completion, for tasks completed in the period. */
    avgMinutesToClose: number | null
    /** Deadline to acknowledgement, for escalations picked up in the period. */
    avgMinutesToAcknowledge: number | null
    byDay: Array<{ date: string; created: number; completed: number }>
  }
  contacts: {
    attempts: number
    connected: number
    byChannel: Array<{ channel: string; attempts: number; connected: number }>
  }
  agents: Array<{
    crmUserId: string
    name: string
    tasksCompleted: number
    tasksBreached: number
    contactAttempts: number
    contactsConnected: number
    notesWritten: number
  }>
  rg: {
    flagsRaised: number
    flagsLifted: number
    /** Blocking episodes standing right now — not range-bound. */
    blocksActiveNow: number
  }
}

/** The task-table predicate, identical in shape to desk health's. */
function taskScope(scope: ReportScope): SQL {
  if (scope.viewAll) return sql`true`
  if (scope.bookIds.length === 0) return sql`false`
  return sql`t.book_id IN (${sql.join(
    scope.bookIds.map((id) => sql`${id}::uuid`),
    sql`, `
  )})`
}

/**
 * The player-table predicate, for facts keyed on a player rather than a book
 * (contacts, notes, RG episodes). Reaches the book through the player's
 * assignment, the same route the player list itself takes.
 */
function playerScope(scope: ReportScope, playerColumn: SQL): SQL {
  if (scope.viewAll) return sql`true`
  if (scope.bookIds.length === 0) return sql`false`
  return sql`EXISTS (
    SELECT 1 FROM crm_player_assignments pa
    WHERE pa.player_id = ${playerColumn}
      AND pa.tenant = ${scope.tenant}
      AND pa.book_id IN (${sql.join(
        scope.bookIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})
  )`
}

/**
 * "Breached": the deadline has actually passed, and the work was neither picked
 * up nor finished before it.
 *
 * All four clauses earn their place, and the first version had only the third.
 * Measured against a fixture of three tasks — one completed on time, one whose
 * deadline is tomorrow, one genuinely late — it reported three breaches:
 *
 *   - `breach_at <= now()` — the screen's date range ends at *the end of today*,
 *     so without this every task due later today is already a breach;
 *   - `completed_at` — finishing a task does not write `acknowledged_at` (only
 *     the escalation ladder does), so work delivered early counted as late;
 *   - `acknowledged_at` — someone took it before the deadline;
 *   - `CANCELLED` — work that was called off was not missed.
 *
 * Desk health draws the same line by restricting its buckets to open statuses;
 * this is the reporting equivalent, and the two must not drift.
 */
const BREACHED = sql`t.breach_at IS NOT NULL
  AND t.breach_at <= now()
  AND t.status <> 'CANCELLED'
  AND (t.acknowledged_at IS NULL OR t.acknowledged_at > t.breach_at)
  AND (t.completed_at IS NULL OR t.completed_at > t.breach_at)`

const n = (v: unknown): number => Number(v ?? 0)
const maybe = (v: unknown): number | null => (v == null ? null : Math.round(Number(v)))

export async function getDeskReport(
  scope: ReportScope,
  from: Date,
  to: Date
): Promise<DeskReport> {
  const tScope = taskScope(scope)
  const range = (col: SQL) => sql`${col} >= ${from} AND ${col} < ${to}`

  const [taskTotals, taskByDay, contactRows, agentRows, rgRow] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE ${range(sql`t.created_at`)})::int AS created,
        count(*) FILTER (WHERE t.status = 'DONE' AND ${range(sql`t.completed_at`)})::int AS completed,
        count(*) FILTER (WHERE ${BREACHED} AND ${range(sql`t.breach_at`)})::int AS breached,
        count(*) FILTER (WHERE t.status IN ('OPEN','IN_PROGRESS','BLOCKED'))::int AS open_now,
        avg(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 60)
          FILTER (WHERE t.status = 'DONE' AND ${range(sql`t.completed_at`)}) AS avg_close,
        avg(EXTRACT(EPOCH FROM (t.acknowledged_at - t.breach_at)) / 60)
          FILTER (WHERE t.acknowledged_at IS NOT NULL AND t.breach_at IS NOT NULL
                  AND t.acknowledged_at > t.breach_at AND ${range(sql`t.acknowledged_at`)}) AS avg_ack
      FROM crm_tasks t
      WHERE t.tenant = ${scope.tenant} AND ${tScope}`),

    db.execute(sql`
      SELECT d.day::date AS date,
        (SELECT count(*)::int FROM crm_tasks t
          WHERE t.tenant = ${scope.tenant} AND ${tScope}
            AND t.created_at >= d.day AND t.created_at < d.day + interval '1 day') AS created,
        (SELECT count(*)::int FROM crm_tasks t
          WHERE t.tenant = ${scope.tenant} AND ${tScope} AND t.status = 'DONE'
            AND t.completed_at >= d.day AND t.completed_at < d.day + interval '1 day') AS completed
      FROM generate_series(${from}::timestamptz, ${to}::timestamptz - interval '1 second', interval '1 day') AS d(day)
      ORDER BY d.day`),

    db.execute(sql`
      SELECT c.channel,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE c.outcome = 'connected')::int AS connected
      FROM crm_contact_attempts c
      WHERE c.tenant = ${scope.tenant}
        AND ${range(sql`c.occurred_at`)}
        AND ${playerScope(scope, sql`c.player_id`)}
      GROUP BY c.channel
      ORDER BY attempts DESC`),

    // One row per person with any activity in the period. Each column counts
    // only facts inside the caller's scope, so an agent-level report never
    // discloses work done on books the reader cannot see.
    db.execute(sql`
      WITH task_work AS (
        SELECT t.assignee_id AS crm_user_id,
          count(*) FILTER (WHERE t.status = 'DONE' AND ${range(sql`t.completed_at`)})::int AS tasks_completed,
          count(*) FILTER (WHERE ${BREACHED} AND ${range(sql`t.breach_at`)})::int AS tasks_breached
        FROM crm_tasks t
        WHERE t.tenant = ${scope.tenant} AND ${tScope} AND t.assignee_id IS NOT NULL
        GROUP BY t.assignee_id
      ),
      contact_work AS (
        SELECT c.by_crm_user_id AS crm_user_id,
          count(*)::int AS contact_attempts,
          count(*) FILTER (WHERE c.outcome = 'connected')::int AS contacts_connected
        FROM crm_contact_attempts c
        WHERE c.tenant = ${scope.tenant} AND ${range(sql`c.occurred_at`)}
          AND c.by_crm_user_id IS NOT NULL
          AND ${playerScope(scope, sql`c.player_id`)}
        GROUP BY c.by_crm_user_id
      ),
      note_work AS (
        SELECT nt.author_crm_user_id AS crm_user_id, count(*)::int AS notes_written
        FROM crm_player_notes nt
        WHERE nt.tenant = ${scope.tenant} AND ${range(sql`nt.created_at`)}
          AND nt.author_crm_user_id IS NOT NULL
          AND ${playerScope(scope, sql`nt.player_id`)}
        GROUP BY nt.author_crm_user_id
      ),
      merged AS (
        SELECT COALESCE(tw.crm_user_id, cw.crm_user_id, nw.crm_user_id) AS crm_user_id,
          COALESCE(tw.tasks_completed, 0) AS tasks_completed,
          COALESCE(tw.tasks_breached, 0) AS tasks_breached,
          COALESCE(cw.contact_attempts, 0) AS contact_attempts,
          COALESCE(cw.contacts_connected, 0) AS contacts_connected,
          COALESCE(nw.notes_written, 0) AS notes_written
        FROM task_work tw
        FULL OUTER JOIN contact_work cw ON cw.crm_user_id = tw.crm_user_id
        FULL OUTER JOIN note_work nw ON nw.crm_user_id = COALESCE(tw.crm_user_id, cw.crm_user_id)
      )
      SELECT m.*, u.name
      FROM merged m
      JOIN crm_users u ON u.id = m.crm_user_id AND u.tenant = ${scope.tenant}
      WHERE m.tasks_completed + m.tasks_breached + m.contact_attempts + m.notes_written > 0
      ORDER BY m.tasks_completed DESC, m.contact_attempts DESC`),

    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE ${range(sql`f.raised_at`)})::int AS flags_raised,
        count(*) FILTER (WHERE f.lifted_at IS NOT NULL AND ${range(sql`f.lifted_at`)})::int AS flags_lifted,
        count(*) FILTER (WHERE f.status = 'ACTIVE' AND f.blocks_play)::int AS blocks_active_now
      FROM crm_player_rg_flags f
      WHERE f.tenant = ${scope.tenant} AND ${playerScope(scope, sql`f.player_id`)}`),
  ])

  const t = taskTotals.rows[0] as Record<string, unknown>
  const rg = rgRow.rows[0] as Record<string, unknown>

  const contacts = (contactRows.rows as Array<Record<string, unknown>>).map((r) => ({
    channel: String(r.channel),
    attempts: n(r.attempts),
    connected: n(r.connected),
  }))

  return {
    tasks: {
      created: n(t.created),
      completed: n(t.completed),
      breached: n(t.breached),
      openNow: n(t.open_now),
      avgMinutesToClose: maybe(t.avg_close),
      avgMinutesToAcknowledge: maybe(t.avg_ack),
      byDay: (taskByDay.rows as Array<Record<string, unknown>>).map((r) => ({
        date: String(r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date),
        created: n(r.created),
        completed: n(r.completed),
      })),
    },
    contacts: {
      attempts: contacts.reduce((s, c) => s + c.attempts, 0),
      connected: contacts.reduce((s, c) => s + c.connected, 0),
      byChannel: contacts,
    },
    agents: (agentRows.rows as Array<Record<string, unknown>>).map((r) => ({
      crmUserId: String(r.crm_user_id),
      name: String(r.name ?? ''),
      tasksCompleted: n(r.tasks_completed),
      tasksBreached: n(r.tasks_breached),
      contactAttempts: n(r.contact_attempts),
      contactsConnected: n(r.contacts_connected),
      notesWritten: n(r.notes_written),
    })),
    rg: {
      flagsRaised: n(rg.flags_raised),
      flagsLifted: n(rg.flags_lifted),
      blocksActiveNow: n(rg.blocks_active_now),
    },
  }
}
