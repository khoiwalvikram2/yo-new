import { db } from '@src/db/client.js'
import { crmTasks, crmTaskEvents, crmTaskEscalations, crmNotifications } from '@shared/db/schema.js'
import { and, eq, sql } from 'drizzle-orm'
import { getDeskHours, isDeskOpen, MAX_ESCALATION_LEVEL } from '@src/repos/crm/CrmTasksRepo.js'

/**
 * The escalation sweep.
 *
 * Deliberately a repository module that takes a tenant and imports nothing from
 * `domains/crm/guards.ts`: it runs from a scheduler with no caller, so a guard
 * expecting `ctx.crmUser` would either throw or, worse, be quietly removed by
 * whoever hit that error.
 *
 * Three properties matter and each has a test:
 *
 *   1. Claiming is an UPDATE with the predicate in it, so two sweeps running at
 *      once produce one escalation per level rather than two.
 *   2. An empty recipient set does **not** advance the level. It writes an
 *      `escalation_failed` event and leaves the task breaching, so the next
 *      sweep tries again and a supervisor can see it never landed.
 *   3. The ladder does not climb outside desk hours. Waking someone at 02:00
 *      about a callback nobody could have made is how alerts get muted.
 */

const ESCALATION_INTERVAL_MINUTES = 120

export type SweepResult = {
  claimed: number
  escalated: number
  failed: number
  exhausted: number
  skippedClosed: boolean
}

/**
 * Who should hear about a breaching task.
 *
 * Members of the task's book who hold `crm.tasks:escalate`, minus the assignee
 * — telling someone their own task is late is not an escalation — and minus
 * anyone out of office, resolved to their delegate one hop.
 *
 * When that set is empty it widens to anyone in the tenant holding the same
 * permission, because a book with nobody watching it is exactly when a task
 * most needs to surface.
 */
export async function resolveEscalationTargets(
  tenant: string,
  bookId: string,
  assigneeId: string | null
): Promise<string[]> {
  const res = await db.execute(sql`
    WITH holders AS (
      SELECT DISTINCT u.id, u.out_of_office_until, u.delegate_to
      FROM crm_users u
      JOIN crm_user_roles ur ON ur.crm_user_id = u.id
      JOIN crm_role_permissions rp ON rp.role_id = ur.role_id
      JOIN crm_roles r ON r.id = ur.role_id AND r.tenant = ${tenant}
      WHERE u.tenant = ${tenant}
        AND u.status = 'ACTIVE'
        -- Matched literally, unlike hasPermission, which also honours the "all"
        -- domain and a "*" action. That is not a narrowing here: CRM role
        -- permissions are written through isValidCrmPermission, whose key set
        -- is the exact catalogue and contains no wildcard, so a CRM role cannot
        -- hold "all:*" or "crm.tasks:*" for this to miss.
        AND rp.domain = 'crm.tasks' AND rp.action = 'escalate'
    ),
    in_book AS (
      SELECT h.* FROM holders h
      JOIN crm_book_members bm ON bm.crm_user_id = h.id
      JOIN crm_books b ON b.id = bm.book_id AND b.tenant = ${tenant}
      WHERE bm.book_id = ${bookId}::uuid
    ),
    chosen AS (
      SELECT * FROM in_book
      UNION ALL
      SELECT * FROM holders WHERE NOT EXISTS (SELECT 1 FROM in_book)
    ),
    resolved AS (
      SELECT
        -- One hop to a delegate when someone is away; never a chain, because a
        -- delegation cycle is a way for work to disappear silently.
        CASE WHEN c.out_of_office_until IS NOT NULL AND c.out_of_office_until > now()
             THEN c.delegate_to ELSE c.id END AS target
      FROM chosen c
    )
    -- The delegate goes back through the same gate the holder came through.
    -- Substituting it after "holders" had already filtered meant a delegate who
    -- was suspended after being named, or who never held crm.tasks:escalate at
    -- all, still counted as a recipient: the sweep took the success branch,
    -- wrote "1 recipient(s)", advanced the rung — and nobody was told. Dropping
    -- them here empties the set instead, which is the case the existing
    -- escalation_failed path exists to make visible.
    SELECT DISTINCT r.target
    FROM resolved r
    JOIN holders h2 ON h2.id = r.target`)

  return (res.rows as Array<{ target: string | null }>)
    .map((r) => r.target)
    .filter((id): id is string => !!id && id !== assigneeId)
}

/**
 * Advances the ladder for every task whose next rung is due.
 *
 * Returns counts rather than throwing on a partial failure: one book with no
 * eligible recipient must not stop the rest of the tenant's tasks escalating.
 */
export async function runEscalationSweep(tenant: string, now = new Date()): Promise<SweepResult> {
  const hours = await getDeskHours(tenant)
  if (!isDeskOpen(now, hours)) {
    return { claimed: 0, escalated: 0, failed: 0, exhausted: 0, skippedClosed: true }
  }

  // Claim by UPDATE. The predicate is inside the statement, so a second sweep
  // running concurrently finds nothing left to claim rather than escalating the
  // same task again.
  const claimed = await db
    .update(crmTasks)
    .set({
      escalationLevel: sql`${crmTasks.escalationLevel} + 1`,
      nextEscalationAt: sql`now() + make_interval(mins => ${ESCALATION_INTERVAL_MINUTES})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(crmTasks.tenant, tenant),
        inStatuses(),
        sql`${crmTasks.acknowledgedAt} is null`,
        sql`${crmTasks.escalationLevel} < ${MAX_ESCALATION_LEVEL}`,
        sql`coalesce(${crmTasks.nextEscalationAt}, ${crmTasks.breachAt}) <= now()`
      )
    )
    .returning({
      id: crmTasks.id,
      bookId: crmTasks.bookId,
      assigneeId: crmTasks.assigneeId,
      level: crmTasks.escalationLevel,
      title: crmTasks.title,
    })

  let escalated = 0
  let failed = 0

  for (const task of claimed) {
    // One task's failure must not consume another's rung. The claim is a single
    // UPDATE over the whole due set that has already committed at level+1 with
    // next_escalation_at two hours out, so an exception escaping this loop used
    // to leave every task after it in that batch — in other books, with other
    // recipients — silently holding a rung it never actually climbed: no
    // escalation row, no notification, no event, and the exhausted pass below
    // skipped entirely.
    try {
      const targets = await resolveEscalationTargets(tenant, task.bookId, task.assigneeId)

      if (targets.length === 0) {
        await rollBackRung(tenant, task.id, 'No active user in this book holds crm.tasks:escalate')
        failed++
        continue
      }

      await db.transaction(async (tx) => {
        for (const target of targets) {
          await tx
            .insert(crmTaskEscalations)
            .values({ tenant, taskId: task.id, level: task.level, crmUserId: target })
            .onConflictDoNothing()
          await tx
            .insert(crmNotifications)
            .values({
              tenant,
              crmUserId: target,
              kind: 'task_escalated',
              title: task.title.slice(0, 160),
              body: `Overdue and unacknowledged — escalation level ${task.level}`,
              resourceType: 'task',
              resourceId: task.id,
              dedupeKey: `escalated:${task.id}:${task.level}`,
            })
            .onConflictDoNothing()
        }
        await tx.insert(crmTaskEvents).values({
          tenant,
          taskId: task.id,
          kind: 'escalated',
          actor: 'system',
          toValue: String(task.level),
          note: `${targets.length} recipient(s)`,
        })
      })
      escalated++
    } catch (err) {
      // Same compensation as an empty recipient set, for the same reason: the
      // rung was claimed and not delivered, so it is given back and the next
      // sweep retries. Recorded rather than swallowed — a task that keeps
      // failing here is a real fault somebody has to see.
      const reason = err instanceof Error ? err.message : String(err)
      console.error('[crm] escalation failed for task', { tenant, taskId: task.id, reason })
      await rollBackRung(tenant, task.id, `Escalation failed: ${reason}`.slice(0, 500)).catch(
        (compensationErr) => {
          // The compensation itself failing is the one case that cannot be
          // repaired from here; log loudly and leave the level advanced rather
          // than aborting the remaining tasks.
          console.error('[crm] escalation rollback also failed', {
            tenant,
            taskId: task.id,
            error: compensationErr instanceof Error ? compensationErr.message : compensationErr,
          })
        }
      )
      failed++
    }
  }

  // Tasks that have climbed as far as the ladder goes are recorded once, so
  // nobody is left assuming a higher rung is still coming.
  const exhausted = await db
    .update(crmTasks)
    .set({ nextEscalationAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(crmTasks.tenant, tenant),
        inStatuses(),
        sql`${crmTasks.acknowledgedAt} is null`,
        sql`${crmTasks.escalationLevel} >= ${MAX_ESCALATION_LEVEL}`,
        sql`${crmTasks.nextEscalationAt} is not null`
      )
    )
    .returning({ id: crmTasks.id })

  for (const t of exhausted) {
    await db.insert(crmTaskEvents).values({
      tenant,
      taskId: t.id,
      kind: 'escalation_exhausted',
      actor: 'system',
      note: `Reached level ${MAX_ESCALATION_LEVEL} without acknowledgement`,
    })
  }

  return { claimed: claimed.length, escalated, failed, exhausted: exhausted.length, skippedClosed: false }
}

function inStatuses() {
  return sql`${crmTasks.status} in ('OPEN','IN_PROGRESS')`
}

/**
 * Gives back a rung that was claimed but never delivered.
 *
 * "Escalated to nobody" must not be a representable state, so the level goes
 * back down and the task stays breaching for the next sweep to retry. The
 * `escalation_failed` event is what makes the attempt visible afterwards —
 * without it, a task that quietly never escalated is indistinguishable from one
 * that was never due.
 */
async function rollBackRung(tenant: string, taskId: string, note: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(crmTasks)
      .set({
        escalationLevel: sql`greatest(${crmTasks.escalationLevel} - 1, 0)`,
        nextEscalationAt: sql`now() + make_interval(mins => ${ESCALATION_INTERVAL_MINUTES})`,
      })
      .where(eq(crmTasks.id, taskId))
    await tx.insert(crmTaskEvents).values({
      tenant,
      taskId,
      kind: 'escalation_failed',
      actor: 'system',
      note,
    })
  })
}
