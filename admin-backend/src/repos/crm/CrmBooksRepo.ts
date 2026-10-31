import { db } from '@src/db/client.js'
import { crmBooks, crmBookMembers, crmPlayerAssignments, crmUsers } from '@shared/db/schema.js'
import { and, eq, sql, asc, inArray } from 'drizzle-orm'

export type CrmBookRow = typeof crmBooks.$inferSelect
export type CrmBookWithCounts = CrmBookRow & { memberCount: number; playerCount: number }

export async function listCrmBooks(tenant: string): Promise<CrmBookWithCounts[]> {
  const books = await db
    .select()
    .from(crmBooks)
    .where(eq(crmBooks.tenant, tenant))
    .orderBy(asc(crmBooks.name))
  if (books.length === 0) return []

  const ids = books.map((b) => b.id)
  const [members, players] = await Promise.all([
    db
      .select({ bookId: crmBookMembers.bookId, n: sql<number>`count(*)::int` })
      .from(crmBookMembers)
      .where(inArray(crmBookMembers.bookId, ids))
      .groupBy(crmBookMembers.bookId),
    db
      .select({ bookId: crmPlayerAssignments.bookId, n: sql<number>`count(*)::int` })
      .from(crmPlayerAssignments)
      .where(inArray(crmPlayerAssignments.bookId, ids))
      .groupBy(crmPlayerAssignments.bookId),
  ])

  const m = new Map(members.map((r) => [r.bookId, Number(r.n) || 0]))
  const p = new Map(players.map((r) => [r.bookId, Number(r.n) || 0]))
  return books.map((b) => ({ ...b, memberCount: m.get(b.id) ?? 0, playerCount: p.get(b.id) ?? 0 }))
}

export async function getCrmBookMembers(
  tenant: string,
  bookId: string
): Promise<Array<{ id: string; name: string; status: string }>> {
  return db
    .select({ id: crmUsers.id, name: crmUsers.name, status: crmUsers.status })
    .from(crmBookMembers)
    .innerJoin(crmUsers, eq(crmUsers.id, crmBookMembers.crmUserId))
    .innerJoin(crmBooks, eq(crmBooks.id, crmBookMembers.bookId))
    .where(and(eq(crmBooks.tenant, tenant), eq(crmBookMembers.bookId, bookId)))
    .orderBy(asc(crmUsers.name))
}

/**
 * The books a CRM user works, which is the whole basis of what players they can
 * reach. Returns ids only — callers turn it into a filter, never into a list
 * they then filter in memory.
 */
export async function getBookIdsForCrmUser(tenant: string, crmUserId: string): Promise<string[]> {
  const rows = await db
    .select({ bookId: crmBookMembers.bookId })
    .from(crmBookMembers)
    .innerJoin(crmBooks, eq(crmBooks.id, crmBookMembers.bookId))
    .where(and(eq(crmBooks.tenant, tenant), eq(crmBookMembers.crmUserId, crmUserId)))
  return rows.map((r) => r.bookId)
}

export async function createCrmBook(input: {
  tenant: string
  name: string
  description?: string | null
}): Promise<CrmBookRow> {
  const [row] = await db
    .insert(crmBooks)
    .values({ tenant: input.tenant, name: input.name.trim(), description: input.description ?? null })
    .returning()
  return row
}

export async function updateCrmBook(
  tenant: string,
  id: string,
  patch: { name?: string; description?: string | null }
): Promise<CrmBookRow | null> {
  const [row] = await db
    .update(crmBooks)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(crmBooks.tenant, tenant), eq(crmBooks.id, id)))
    .returning()
  return row ?? null
}

/**
 * Deleting a book would orphan the players assigned to it, so it is refused
 * while any remain. Reassigning them first is a deliberate act; cascading them
 * into nowhere is not.
 */
export async function deleteCrmBook(
  tenant: string,
  id: string
): Promise<{ ok: boolean; reason?: 'not_found' | 'has_players'; playerCount?: number }> {
  return db.transaction(async (tx) => {
    const [book] = await tx
      .select({ id: crmBooks.id })
      .from(crmBooks)
      .where(and(eq(crmBooks.tenant, tenant), eq(crmBooks.id, id)))
      .limit(1)
    if (!book) return { ok: false, reason: 'not_found' as const }

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(crmPlayerAssignments)
      .where(eq(crmPlayerAssignments.bookId, id))
    const playerCount = Number(n) || 0
    if (playerCount > 0) return { ok: false, reason: 'has_players' as const, playerCount }

    await tx.delete(crmBooks).where(eq(crmBooks.id, id))
    return { ok: true }
  })
}

/** Replaces a book's membership with exactly the users given, ignoring any from another tenant. */
export async function setCrmBookMembers(
  tenant: string,
  bookId: string,
  crmUserIds: string[]
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [book] = await tx
      .select({ id: crmBooks.id })
      .from(crmBooks)
      .where(and(eq(crmBooks.tenant, tenant), eq(crmBooks.id, bookId)))
      .limit(1)
    if (!book) return false

    const valid =
      crmUserIds.length > 0
        ? await tx
            .select({ id: crmUsers.id })
            .from(crmUsers)
            .where(and(eq(crmUsers.tenant, tenant), inArray(crmUsers.id, crmUserIds)))
        : []

    await tx.delete(crmBookMembers).where(eq(crmBookMembers.bookId, bookId))
    if (valid.length > 0) {
      await tx.insert(crmBookMembers).values(valid.map((u) => ({ bookId, crmUserId: u.id })))
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Player assignment
// ---------------------------------------------------------------------------

/**
 * Puts players in a book, moving any that were in another one.
 *
 * The unique key on (tenant, player) is what makes a player belong to exactly
 * one book; the upsert turns a re-assignment into a move rather than a conflict.
 */
export async function assignPlayersToBook(input: {
  tenant: string
  playerIds: number[]
  bookId: string
  ownerId?: string | null
  assignedBy?: string | null
}): Promise<number> {
  if (input.playerIds.length === 0) return 0
  const rows = await db
    .insert(crmPlayerAssignments)
    .values(
      input.playerIds.map((playerId) => ({
        tenant: input.tenant,
        playerId,
        bookId: input.bookId,
        ownerId: input.ownerId ?? null,
        assignedBy: input.assignedBy ?? null,
      }))
    )
    .onConflictDoUpdate({
      target: [crmPlayerAssignments.tenant, crmPlayerAssignments.playerId],
      set: {
        bookId: input.bookId,
        ownerId: input.ownerId ?? null,
        assignedBy: input.assignedBy ?? null,
        assignedAt: new Date(),
      },
    })
    .returning({ id: crmPlayerAssignments.id })
  return rows.length
}

export async function unassignPlayers(tenant: string, playerIds: number[]): Promise<number> {
  if (playerIds.length === 0) return 0
  const rows = await db
    .delete(crmPlayerAssignments)
    .where(
      and(eq(crmPlayerAssignments.tenant, tenant), inArray(crmPlayerAssignments.playerId, playerIds))
    )
    .returning({ id: crmPlayerAssignments.id })
  return rows.length
}
