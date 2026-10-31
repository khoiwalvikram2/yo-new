import { db } from '@src/db/client.js'
import { crmSegments } from '@shared/db/schema.js'
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import { normaliseCrmPlayerFilter, type CrmPlayerFilter } from '@src/repos/crm/CrmPlayersRepo.js'

/**
 * Saved player filters.
 *
 * A segment is a filter, never a set of players: the rows it yields are
 * resolved through the reader's own book scope every time it is opened. That is
 * what makes sharing one safe, and what stops a saved segment from quietly
 * going stale.
 */

export type CrmSegmentRow = {
  id: string
  name: string
  description: string | null
  filter: CrmPlayerFilter
  ownerId: string | null
  ownerName: string | null
  isShared: boolean
  /**
   * A Date from a typed select, a string from the raw SQL the list uses. Typed
   * honestly so the resolver has to handle both rather than discovering it.
   */
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * What a segment may store, which is exactly what the player query may run.
 *
 * Delegated to `normaliseCrmPlayerFilter` rather than reimplemented here. This
 * module used to keep its own copy that filtered by key but not by *value*, so
 * it happily stored `tagIds: ['garbage']` — and the player query, which casts
 * that field to uuid, then threw for everyone who opened the segment. Two
 * sanitisers for one contract is how the storage side and the query side drift
 * apart; there is now one.
 *
 * Anything unrecognised is dropped rather than stored. Without that a segment
 * is an arbitrary JSON blob later spread into the query's filter argument, so a
 * key the query ignores today becomes one it might honour tomorrow — a stored
 * value quietly acquiring meaning is how a saved filter turns into a way to
 * widen scope.
 */
export const sanitiseFilter = normaliseCrmPlayerFilter

/**
 * The segments this user may open: their own, plus everything shared.
 *
 * A shared segment with no owner is kept — its author may have left, and the
 * work it describes did not leave with them. A personal one with no owner is
 * unreachable by construction, and `deleteCrmSegmentsOwnedBy` removes those
 * when the account goes.
 */
export async function listCrmSegments(tenant: string, crmUserId: string): Promise<CrmSegmentRow[]> {
  const res = await db.execute(sql`
    SELECT s.id, s.name, s.description, s.filter, s.owner_id, s.is_shared,
           s.created_at, s.updated_at, u.name AS owner_name
    FROM crm_segments s
    LEFT JOIN crm_users u ON u.id = s.owner_id
    WHERE s.tenant = ${tenant}
      AND (s.owner_id = ${crmUserId}::uuid OR s.is_shared = true)
    ORDER BY s.is_shared ASC, s.name ASC`)

  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    description: (r.description as string | null) ?? null,
    filter: sanitiseFilter(r.filter),
    ownerId: (r.owner_id as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    isShared: r.is_shared === true,
    createdAt: r.created_at as Date | string,
    updatedAt: r.updated_at as Date | string,
  }))
}

export async function createCrmSegment(input: {
  tenant: string
  name: string
  description: string | null
  filter: unknown
  ownerId: string
  isShared: boolean
}): Promise<{ ok: true; id: string } | { ok: false; reason: 'duplicate_name' }> {
  try {
    const [row] = await db
      .insert(crmSegments)
      .values({
        tenant: input.tenant,
        name: input.name,
        description: input.description,
        filter: sanitiseFilter(input.filter),
        ownerId: input.ownerId,
        isShared: input.isShared,
      })
      .returning({ id: crmSegments.id })
    return { ok: true, id: row.id }
  } catch (e) {
    const code = String((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code)
    if (code === '23505') return { ok: false, reason: 'duplicate_name' }
    throw e
  }
}

/**
 * Changes a segment.
 *
 * Predicated on ownership as well as tenant. A shared segment is readable by
 * the whole whitelabel, and without the owner predicate every reader could
 * rewrite what the desk is working from.
 */
export async function updateCrmSegment(
  tenant: string,
  id: string,
  ownerId: string,
  patch: { name?: string; description?: string | null; filter?: unknown; isShared?: boolean },
  /**
   * Lets a supervisor adopt a shared segment whose author has left.
   *
   * `owner_id` is `set null` on delete so a shared segment outlives its author,
   * but the ownership predicate then matched nobody: the segment stayed in
   * everyone's picker permanently, un-editable and un-deletable. The same
   * permission that gates *sharing* gates cleaning up after a leaver, and it
   * only ever applies to a shared segment with no owner — a colleague's own
   * segment stays theirs.
   */
  mayAdoptOrphans = false
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'duplicate_name' }> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.description !== undefined) set.description = patch.description
  if (patch.filter !== undefined) set.filter = sanitiseFilter(patch.filter)
  if (patch.isShared !== undefined) set.isShared = patch.isShared

  try {
    const rows = await db
      .update(crmSegments)
      .set(set)
      .where(and(eq(crmSegments.tenant, tenant), eq(crmSegments.id, id), ownership(ownerId, mayAdoptOrphans)))
      .returning({ id: crmSegments.id })
    return rows.length > 0 ? { ok: true } : { ok: false, reason: 'not_found' }
  } catch (e) {
    const code = String((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code)
    if (code === '23505') return { ok: false, reason: 'duplicate_name' }
    throw e
  }
}

/**
 * Who may change a segment: its author, plus — for a *shared* segment whose
 * author is gone — anyone the caller passes `mayAdoptOrphans` for.
 *
 * Written once and used by both the update and the delete, so the two cannot
 * disagree about who owns what.
 */
function ownership(ownerId: string, mayAdoptOrphans: boolean): SQL {
  const mine = eq(crmSegments.ownerId, ownerId)
  if (!mayAdoptOrphans) return mine as SQL
  return or(mine, and(isNull(crmSegments.ownerId), eq(crmSegments.isShared, true))) as SQL
}

/** Same ownership rule as the update: only its author, or an adopted orphan. */
export async function deleteCrmSegment(
  tenant: string,
  id: string,
  ownerId: string,
  mayAdoptOrphans = false
): Promise<boolean> {
  const rows = await db
    .delete(crmSegments)
    .where(and(eq(crmSegments.tenant, tenant), eq(crmSegments.id, id), ownership(ownerId, mayAdoptOrphans)))
    .returning({ id: crmSegments.id })
  return rows.length > 0
}

/**
 * Removes the personal segments of an account being deleted.
 *
 * The foreign key is `set null`, which is what lets a shared segment outlive
 * its author. A *personal* orphan is visible to nobody, so it is deleted here
 * rather than accumulating.
 */
export async function deleteCrmSegmentsOwnedBy(tenant: string, ownerId: string): Promise<number> {
  const rows = await db
    .delete(crmSegments)
    .where(
      and(
        eq(crmSegments.tenant, tenant),
        eq(crmSegments.ownerId, ownerId),
        eq(crmSegments.isShared, false)
      )
    )
    .returning({ id: crmSegments.id })
  return rows.length
}
