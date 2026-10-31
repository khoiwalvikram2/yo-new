import { db } from '@src/db/client.js'
import { crmTags, crmPlayerTags } from '@shared/db/schema.js'
import { and, eq, sql, asc, isNull, inArray } from 'drizzle-orm'

export type CrmTagRow = typeof crmTags.$inferSelect
export type CrmTagWithCount = CrmTagRow & { playerCount: number }

/**
 * A whitelabel may hold this many live tags.
 *
 * Not arbitrary: a vocabulary exists so two agents pick the same label, and a
 * list nobody can read stops being a vocabulary. Archiving is the pressure
 * valve — nothing is lost, it just stops being offered.
 */
export const MAX_LIVE_TAGS_PER_TENANT = 100

export async function listCrmTags(
  tenant: string,
  opts: { includeArchived?: boolean } = {}
): Promise<CrmTagWithCount[]> {
  const where = opts.includeArchived
    ? eq(crmTags.tenant, tenant)
    : and(eq(crmTags.tenant, tenant), isNull(crmTags.archivedAt))

  const tags = await db.select().from(crmTags).where(where).orderBy(asc(crmTags.name))
  if (tags.length === 0) return []

  const counts = await db
    .select({ tagId: crmPlayerTags.tagId, n: sql<number>`count(*)::int` })
    .from(crmPlayerTags)
    .where(
      and(
        eq(crmPlayerTags.tenant, tenant),
        inArray(
          crmPlayerTags.tagId,
          tags.map((t) => t.id)
        )
      )
    )
    .groupBy(crmPlayerTags.tagId)

  const byTag = new Map(counts.map((c) => [c.tagId, Number(c.n) || 0]))
  return tags.map((t) => ({ ...t, playerCount: byTag.get(t.id) ?? 0 }))
}

export async function countLiveCrmTags(tenant: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(crmTags)
    .where(and(eq(crmTags.tenant, tenant), isNull(crmTags.archivedAt)))
  return Number(n) || 0
}

export async function createCrmTag(input: {
  tenant: string
  name: string
  colour?: string | null
  description?: string | null
  createdBy?: string | null
}): Promise<CrmTagRow> {
  const [row] = await db
    .insert(crmTags)
    .values({
      tenant: input.tenant,
      name: input.name.trim(),
      colour: input.colour ?? '#6b7280',
      description: input.description ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning()
  return row
}

export async function updateCrmTag(
  tenant: string,
  id: string,
  patch: { name?: string; colour?: string; description?: string | null }
): Promise<CrmTagRow | null> {
  const [row] = await db
    .update(crmTags)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.colour !== undefined ? { colour: patch.colour } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    })
    .where(and(eq(crmTags.tenant, tenant), eq(crmTags.id, id)))
    .returning()
  return row ?? null
}

/**
 * Retires a tag without losing what it meant.
 *
 * Deleting would take the label off every player who carried it, and the
 * question "why was this player flagged in March" would stop having an answer.
 * Archiving stops it being offered and leaves the history intact.
 */
export async function archiveCrmTag(tenant: string, id: string): Promise<boolean> {
  const rows = await db
    .update(crmTags)
    .set({ archivedAt: new Date() })
    .where(and(eq(crmTags.tenant, tenant), eq(crmTags.id, id), isNull(crmTags.archivedAt)))
    .returning({ id: crmTags.id })
  return rows.length > 0
}

export async function unarchiveCrmTag(tenant: string, id: string): Promise<boolean> {
  const rows = await db
    .update(crmTags)
    .set({ archivedAt: null, mergedIntoId: null })
    .where(and(eq(crmTags.tenant, tenant), eq(crmTags.id, id)))
    .returning({ id: crmTags.id })
  return rows.length > 0
}

/**
 * Folds one tag into another.
 *
 * Six months of a desk creating tags produces near-duplicates — "highvalue",
 * "high-value", "HighValue" — and the only safe way to tidy them is to move
 * every player across and point the old tag at the new one, so a reference to
 * the old id still resolves to something meaningful.
 *
 * Both tags must belong to this tenant, and a tag cannot be merged into itself.
 */
export async function mergeCrmTags(
  tenant: string,
  fromId: string,
  intoId: string
): Promise<{ ok: boolean; reason?: 'not_found' | 'same_tag'; moved?: number }> {
  if (fromId === intoId) return { ok: false, reason: 'same_tag' }

  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: crmTags.id })
      .from(crmTags)
      .where(and(eq(crmTags.tenant, tenant), inArray(crmTags.id, [fromId, intoId])))
    if (found.length !== 2) return { ok: false, reason: 'not_found' as const }

    // Move the players in one statement, not two. The copy and the delete used
    // to be separate round-trips, each against its own snapshot: a tag applied
    // to a player by a concurrent request, landing between them, was removed by
    // the delete without ever having been in what the copy saw — dropping that
    // player from both the old tag and the new one. A DELETE...RETURNING
    // feeding an INSERT through one CTE has no such gap: the rows it removes
    // are exactly the rows it captured, because both happen against the same
    // statement snapshot.
    //
    // A player already carrying the destination tag keeps one row, not two —
    // the primary key would refuse the duplicate anyway, so the conflict is
    // expected rather than exceptional.
    const moved = await tx.execute(sql`
      WITH taken AS (
        DELETE FROM crm_player_tags
        WHERE tenant = ${tenant} AND tag_id = ${fromId}::uuid
        RETURNING tenant, player_id, tagged_by, tagged_at
      )
      INSERT INTO crm_player_tags (tenant, player_id, tag_id, tagged_by, tagged_at)
      SELECT tenant, player_id, ${intoId}::uuid, tagged_by, tagged_at
      FROM taken
      ON CONFLICT (player_id, tag_id) DO NOTHING
      RETURNING player_id
    `)

    await tx
      .update(crmTags)
      .set({ archivedAt: new Date(), mergedIntoId: intoId })
      .where(eq(crmTags.id, fromId))

    return { ok: true, moved: moved.rows.length }
  })
}

/** Applies tags to players. Re-applying an existing tag is a no-op, not a duplicate. */
export async function applyTagsToPlayers(input: {
  tenant: string
  playerIds: number[]
  tagIds: string[]
  taggedBy: string
}): Promise<number> {
  if (input.playerIds.length === 0 || input.tagIds.length === 0) return 0

  // Only this tenant's live tags. An id from elsewhere is dropped rather than
  // trusted, so a crafted request cannot borrow another whitelabel's vocabulary
  // or resurrect an archived label.
  const valid = await db
    .select({ id: crmTags.id })
    .from(crmTags)
    .where(
      and(
        eq(crmTags.tenant, input.tenant),
        inArray(crmTags.id, input.tagIds),
        isNull(crmTags.archivedAt)
      )
    )
  if (valid.length === 0) return 0

  const values = input.playerIds.flatMap((playerId) =>
    valid.map((t) => ({
      tenant: input.tenant,
      playerId,
      tagId: t.id,
      taggedBy: input.taggedBy,
    }))
  )
  const rows = await db
    .insert(crmPlayerTags)
    .values(values)
    .onConflictDoNothing()
    .returning({ tagId: crmPlayerTags.tagId })
  return rows.length
}

export async function removeTagsFromPlayers(input: {
  tenant: string
  playerIds: number[]
  tagIds: string[]
}): Promise<number> {
  if (input.playerIds.length === 0 || input.tagIds.length === 0) return 0
  const rows = await db
    .delete(crmPlayerTags)
    .where(
      and(
        eq(crmPlayerTags.tenant, input.tenant),
        inArray(crmPlayerTags.playerId, input.playerIds),
        inArray(crmPlayerTags.tagId, input.tagIds)
      )
    )
    .returning({ tagId: crmPlayerTags.tagId })
  return rows.length
}

/** The tags on a set of players, so a list can render them without N queries. */
export async function getTagsForPlayers(
  tenant: string,
  playerIds: number[]
): Promise<Map<number, CrmTagRow[]>> {
  const out = new Map<number, CrmTagRow[]>()
  if (playerIds.length === 0) return out
  const rows = await db
    .select({ playerId: crmPlayerTags.playerId, tag: crmTags })
    .from(crmPlayerTags)
    .innerJoin(crmTags, eq(crmTags.id, crmPlayerTags.tagId))
    .where(and(eq(crmPlayerTags.tenant, tenant), inArray(crmPlayerTags.playerId, playerIds)))
    .orderBy(asc(crmTags.name))
  for (const r of rows) {
    const list = out.get(r.playerId) ?? []
    list.push(r.tag)
    out.set(r.playerId, list)
  }
  return out
}
