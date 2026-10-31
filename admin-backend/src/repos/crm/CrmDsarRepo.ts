import { db } from '@src/db/client.js'
import { sql } from 'drizzle-orm'

/**
 * Data subject requests, as the CRM can honour them.
 *
 * The design doc named this a cross-cutting requirement from the start — "a
 * player's right to export or erasure has to reach CRM notes, communication
 * history and consent records" — and nothing was ever built. This module is
 * that requirement, with the boundary drawn where a gambling operator's law
 * actually draws it:
 *
 * **Export** returns everything the CRM surface holds about one player, as one
 * document. It exports the CRM's own view: notes the admin panel marked
 * `admin_only` are excluded, because this surface may not read them and a DSAR
 * run from the CRM must not become the way around that wall. The admin panel
 * owes those rows its own answer.
 *
 * **Erasure pseudonymises free text and touches nothing else.** What goes:
 * note bodies and labels, the notes typed on contact attempts, the title and
 * body of tasks about the player, and the copies of those titles that
 * assignment and escalation put in the desk's own inboxes — the places staff
 * wrote prose about a person. What stays, deliberately:
 *
 *   - the **exclusion register**: it holds salted hashes precisely so a
 *     self-excluded player stays excluded after their account is gone. Erasing
 *     it would let the person it protects re-register;
 *   - **RG episodes**: "how many times has this player self-excluded" is the
 *     question a regulator asks, and the answer must survive the request;
 *   - **consent rows and their history**: they are the proof of the lawful
 *     basis for every message ever sent, structured fields rather than prose;
 *   - **row skeletons, authors and timestamps**: that work happened is a
 *     processing record; what was written about the person is the personal
 *     data. The row stays, the prose goes;
 *   - everything financial, which is not the CRM's to touch and sits under
 *     AML retention anyway.
 */

const REDACTED = '[removed under data subject request]'

export type DsarExport = {
  generatedAt: string
  player: Record<string, unknown> | null
  notes: unknown[]
  contactAttempts: unknown[]
  consents: unknown[]
  consentHistory: unknown[]
  rgFlags: unknown[]
  tags: unknown[]
  tasks: unknown[]
  /** Who at the operator opened this player's record, and when. */
  accessLog: unknown[]
}

/** The player, if they are this tenant's and not a staff account. */
export async function findDsarSubject(
  tenant: string,
  playerId: number
): Promise<{ id: number; name: string } | null> {
  const res = await db.execute(sql`
    SELECT u.id, u.name FROM users u
    WHERE u.id = ${playerId} AND u.tenant = ${tenant}
      AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
    LIMIT 1`)
  const row = res.rows[0] as { id: number; name: string } | undefined
  return row ? { id: Number(row.id), name: String(row.name) } : null
}

export async function buildDsarExport(tenant: string, playerId: number): Promise<DsarExport> {
  const [player, notes, contacts, consents, consentHistory, rgFlags, tags, tasks, accessLog] =
    await Promise.all([
      db.execute(sql`
        SELECT id, name, username, phone, email, status::text AS status,
               player_type::text AS player_type, created_at, last_login_at
        FROM users WHERE id = ${playerId} AND tenant = ${tenant}`),
      // The CRM's view only: an admin_only note is invisible to this surface
      // and must stay invisible to its export.
      db.execute(sql`
        SELECT body, category, labels, visibility, author_name, created_at, deleted_at
        FROM crm_player_notes
        WHERE tenant = ${tenant} AND player_id = ${playerId} AND visibility <> 'admin_only'
        ORDER BY created_at`),
      db.execute(sql`
        SELECT channel, direction, outcome, notes, by_name, occurred_at
        FROM crm_contact_attempts
        WHERE tenant = ${tenant} AND player_id = ${playerId}
        ORDER BY occurred_at`),
      db.execute(sql`
        SELECT channel, purpose, state, state_since, granted_at, source,
               consent_text_version, evidence_ref
        FROM crm_player_consents
        WHERE tenant = ${tenant} AND player_id = ${playerId}
        ORDER BY channel, purpose`),
      db.execute(sql`
        SELECT channel, purpose, from_state, to_state, source, reason, created_at
        FROM crm_consent_events
        WHERE tenant = ${tenant} AND player_id = ${playerId}
        ORDER BY created_at`),
      db.execute(sql`
        SELECT flag_type, status, initiated_by, blocks_play, starts_at,
               min_term_ends_at, ends_at, reason, raised_at, lifted_at, lift_reason
        FROM crm_player_rg_flags
        WHERE tenant = ${tenant} AND player_id = ${playerId}
        ORDER BY raised_at`),
      db.execute(sql`
        SELECT t.name, pt.tagged_at
        FROM crm_player_tags pt JOIN crm_tags t ON t.id = pt.tag_id
        WHERE pt.tenant = ${tenant} AND pt.player_id = ${playerId}
        ORDER BY pt.tagged_at`),
      db.execute(sql`
        SELECT title, body, status, outcome, priority, created_at, completed_at
        FROM crm_tasks
        WHERE tenant = ${tenant} AND player_id = ${playerId}
        ORDER BY created_at`),
      db.execute(sql`
        SELECT l.action, l.fields, l.created_at, u.name AS by_name
        FROM crm_pii_access_log l LEFT JOIN crm_users u ON u.id = l.crm_user_id
        WHERE l.tenant = ${tenant} AND l.resource_type = 'player'
          AND l.resource_id = ${String(playerId)}
        ORDER BY l.created_at`),
    ])

  return {
    generatedAt: new Date().toISOString(),
    player: (player.rows[0] as Record<string, unknown>) ?? null,
    notes: notes.rows,
    contactAttempts: contacts.rows,
    consents: consents.rows,
    consentHistory: consentHistory.rows,
    rgFlags: rgFlags.rows,
    tags: tags.rows,
    tasks: tasks.rows,
    accessLog: accessLog.rows,
  }
}

export type DsarEraseResult = {
  notesRedacted: number
  contactNotesCleared: number
  tasksRedacted: number
  /** Copies of a task's title sitting in the desk's own inboxes. */
  notificationsRedacted: number
}

/**
 * Removes the prose, keeps the record.
 *
 * Idempotent: rows already redacted match the same predicates and are simply
 * written again with the same values, so re-running a request cannot fail or
 * double-count in any way that matters.
 */
export async function eraseDsarFreeText(
  tenant: string,
  playerId: number
): Promise<DsarEraseResult> {
  return db.transaction(async (tx) => {
    const notes = await tx.execute(sql`
      UPDATE crm_player_notes
      SET body = ${REDACTED}, labels = '{}', category = NULL
      WHERE tenant = ${tenant} AND player_id = ${playerId} AND body <> ${REDACTED}
      RETURNING id`)

    const contacts = await tx.execute(sql`
      UPDATE crm_contact_attempts
      SET notes = NULL
      WHERE tenant = ${tenant} AND player_id = ${playerId} AND notes IS NOT NULL
      RETURNING id`)

    const tasks = await tx.execute(sql`
      UPDATE crm_tasks
      SET title = ${REDACTED}, body = NULL
      WHERE tenant = ${tenant} AND player_id = ${playerId} AND title <> ${REDACTED}
      RETURNING id`)

    // Assigning or escalating a task copies its title into the assignee's
    // inbox, so redacting only `crm_tasks` left the prose intact and still on
    // screen in the notification bell. Matched through the task rather than by
    // text, so a title that happens to name the player elsewhere is untouched.
    const notifications = await tx.execute(sql`
      UPDATE crm_notifications n
      SET title = ${REDACTED}, body = NULL
      WHERE n.tenant = ${tenant}
        AND n.resource_type = 'task'
        AND n.title <> ${REDACTED}
        AND EXISTS (
          SELECT 1 FROM crm_tasks t
          WHERE t.tenant = ${tenant} AND t.player_id = ${playerId}
            AND t.id::text = n.resource_id
        )
      RETURNING n.id`)

    return {
      notesRedacted: notes.rows.length,
      contactNotesCleared: contacts.rows.length,
      tasksRedacted: tasks.rows.length,
      notificationsRedacted: notifications.rows.length,
    }
  })
}
