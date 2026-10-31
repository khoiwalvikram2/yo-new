import { db } from '@src/db/client.js'
import { crmPlayerNotes } from '@shared/db/schema.js'
import { and, eq, isNull, sql, desc, inArray, or } from 'drizzle-orm'

/**
 * Notes are read from two applications with different scope rules, so nothing
 * here decides who may see a *player* — that check belongs to the caller, and
 * the two callers answer it differently. What this file does decide is which
 * notes each surface may see once the player is allowed, because that is a
 * property of the note rather than of the caller's scope.
 */

export type CrmNoteRow = typeof crmPlayerNotes.$inferSelect

/** Which application is asking. Visibility is resolved against it. */
export type NoteSurface = 'crm' | 'admin'

export type NoteAuthor =
  | { kind: 'crm'; crmUserId: string; name: string }
  | { kind: 'admin'; adminUserId: number; name: string }

export type CrmNote = {
  id: string
  playerId: number
  body: string
  category: string | null
  labels: string[]
  isPinned: boolean
  visibility: string
  authorKind: 'crm' | 'admin'
  authorName: string
  createdAt: Date
}

function toNote(r: CrmNoteRow): CrmNote {
  return {
    id: r.id,
    playerId: r.playerId,
    body: r.body,
    category: r.category,
    labels: r.labels ?? [],
    isPinned: r.isPinned,
    visibility: r.visibility,
    // Derived rather than stored: the typed author columns are the single
    // source of truth, and a third column agreeing with them is a third column
    // that can disagree with them.
    // Keyed on the admin column, not the CRM one. A CRM author's id is nulled
    // when their account goes (the name is snapshotted separately), while an
    // admin author is a plain integer with no foreign key and so is never
    // nulled — which makes "no admin id" the reliable test for a CRM note, and
    // stops an orphaned one being mis-attributed to the admin panel.
    authorKind: r.authorAdminUserId ? 'admin' : 'crm',
    authorName: r.authorName,
    createdAt: r.createdAt,
  }
}

/**
 * Notes this surface is allowed to read.
 *
 * `crm_only` exists so an operator can record "suspected bonus abuse, do not
 * disclose" without it appearing on the screen the player's account manager
 * shares in a review; `admin_only` is the mirror. A surface always sees `all`.
 */
function visibleTo(surface: NoteSurface) {
  return or(
    eq(crmPlayerNotes.visibility, 'all'),
    eq(crmPlayerNotes.visibility, surface === 'crm' ? 'crm_only' : 'admin_only')
  )
}

/**
 * A player's notes, pinned first and newest first.
 *
 * Deleted notes are excluded and kept: a note someone thought better of is
 * still part of what the desk did about that player.
 */
export async function listPlayerNotes(
  tenant: string,
  playerId: number,
  surface: NoteSurface
): Promise<CrmNote[]> {
  const rows = await db
    .select()
    .from(crmPlayerNotes)
    .where(
      and(
        eq(crmPlayerNotes.tenant, tenant),
        eq(crmPlayerNotes.playerId, playerId),
        isNull(crmPlayerNotes.deletedAt),
        visibleTo(surface)
      )
    )
    .orderBy(desc(crmPlayerNotes.isPinned), desc(crmPlayerNotes.createdAt))
  return rows.map(toNote)
}

/**
 * Writes a note.
 *
 * The author's name is snapshotted, not joined, so the note still says who
 * wrote it after that account is gone — which is the whole reason notes exist.
 */
export async function createPlayerNote(input: {
  tenant: string
  playerId: number
  body: string
  category?: string | null
  labels?: string[] | null
  isPinned?: boolean
  visibility?: string | null
  author: NoteAuthor
}): Promise<CrmNote> {
  const [row] = await db
    .insert(crmPlayerNotes)
    .values({
      tenant: input.tenant,
      playerId: input.playerId,
      body: input.body,
      category: input.category ?? null,
      labels: input.labels ?? [],
      isPinned: input.isPinned ?? false,
      visibility: input.visibility ?? 'all',
      authorCrmUserId: input.author.kind === 'crm' ? input.author.crmUserId : null,
      authorAdminUserId: input.author.kind === 'admin' ? input.author.adminUserId : null,
      authorName: input.author.name,
    })
    .returning()
  return toNote(row)
}

/**
 * The player and visibility a caller would need to already have cleared before
 * touching this note — read once up front so the resolver can check reachability
 * *before* writing anything, rather than after.
 *
 * Without this, pinning and deleting used to be checked (or not checked at all)
 * on the write itself: pin re-checked reachability only after the row had
 * already changed, and delete never checked it. Both let a note id outlive the
 * access that legitimately produced it — a player moved to another book, or the
 * caller dropped from the book — and still be actionable.
 */
export async function getNoteForCheck(
  tenant: string,
  id: string,
  surface: NoteSurface
): Promise<{ id: string; playerId: number } | null> {
  const [row] = await db
    .select({ id: crmPlayerNotes.id, playerId: crmPlayerNotes.playerId })
    .from(crmPlayerNotes)
    .where(
      and(
        eq(crmPlayerNotes.tenant, tenant),
        eq(crmPlayerNotes.id, id),
        isNull(crmPlayerNotes.deletedAt),
        visibleTo(surface)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Pins or unpins. This is the only mutation a note has after it is written.
 *
 * There is deliberately no edit path in Phase 2: a note that can be rewritten
 * without a revision history is a record that can be made to say something else
 * after the fact, which is worse than no record.
 *
 * Callers are expected to have already resolved the note through
 * `getNoteForCheck` and checked reachability; `surface` here is defence in
 * depth so this can never touch a note the caller's surface cannot see, even if
 * that check is skipped upstream.
 */
export async function setNotePinned(
  tenant: string,
  id: string,
  isPinned: boolean,
  surface: NoteSurface
): Promise<CrmNote | null> {
  const [row] = await db
    .update(crmPlayerNotes)
    .set({ isPinned })
    .where(
      and(
        eq(crmPlayerNotes.tenant, tenant),
        eq(crmPlayerNotes.id, id),
        isNull(crmPlayerNotes.deletedAt),
        visibleTo(surface)
      )
    )
    .returning()
  return row ? toNote(row) : null
}

/**
 * Soft delete. The row stays so the trail keeps what was written and by whom.
 * See `setNotePinned` above for why `surface` is required here too.
 */
export async function deletePlayerNote(
  tenant: string,
  id: string,
  deletedBy: string,
  surface: NoteSurface
): Promise<boolean> {
  const rows = await db
    .update(crmPlayerNotes)
    .set({ deletedAt: new Date(), deletedBy })
    .where(
      and(
        eq(crmPlayerNotes.tenant, tenant),
        eq(crmPlayerNotes.id, id),
        isNull(crmPlayerNotes.deletedAt),
        visibleTo(surface)
      )
    )
    .returning({ id: crmPlayerNotes.id })
  return rows.length > 0
}

/** Note counts for a set of players, so a list can show them without N queries. */
export async function countNotesForPlayers(
  tenant: string,
  playerIds: number[],
  surface: NoteSurface
): Promise<Map<number, number>> {
  if (playerIds.length === 0) return new Map()
  const rows = await db
    .select({ playerId: crmPlayerNotes.playerId, n: sql<number>`count(*)::int` })
    .from(crmPlayerNotes)
    .where(
      and(
        eq(crmPlayerNotes.tenant, tenant),
        isNull(crmPlayerNotes.deletedAt),
        inArray(crmPlayerNotes.playerId, playerIds),
        visibleTo(surface)
      )
    )
    .groupBy(crmPlayerNotes.playerId)
  return new Map(rows.map((r) => [r.playerId, Number(r.n) || 0]))
}
