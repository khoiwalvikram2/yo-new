import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '@/db/client.js'
import { matkaResults, matkas, matkaWorliInstances } from '@shared/db/schema.js'
import type { WorliStatus } from '@/repos/matka-worli/worliInstancesRepo.js'

type WorliInstanceRow = typeof matkaWorliInstances.$inferSelect

/**
 * Whether a result was ever declared for a session's market, date and side (owner, 2026-11-04). matka_results keeps one
 * row per session under the market's whitelabel, and a rollback only stamps it (shared/src/matka/settlement.ts), so any
 * row counts, rolled back or not. Correlated to the session row of the statement it is used in. Players are refused on the
 * same rule, also for a session with no row (shared/src/matka/schedule.ts matkaSessionResults, user-backend betService.ts
 * and readService.ts): if the rule changes, change both.
 */
const resultEverDeclared = sql`EXISTS (SELECT 1 FROM ${matkaResults}
  INNER JOIN ${matkas} ON ${matkas.id} = ${matkaResults.matkaId} AND ${matkas.tenant} = ${matkaResults.tenant}
  WHERE ${matkaResults.matkaId} = ${matkaWorliInstances.marketId} AND ${matkaResults.date} = ${matkaWorliInstances.runDate}
    AND ${matkaResults.type}::text = lower(${matkaWorliInstances.side}::text))`

/** The sessions, of these ids, that ever had a result declared (Unlock refuses them, and their canUnlock is false). */
export async function worliSessionsEverDeclared(ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await db.select({ id: matkaWorliInstances.id }).from(matkaWorliInstances)
    .where(and(inArray(matkaWorliInstances.id, [...ids]), resultEverDeclared))
  return new Set(rows.map(row => row.id))
}

/** The stamp as Unlock read it. A Date holds milliseconds and drops the rest, so the stored value is cut to match. */
const sameStamp = (column: AnyPgColumn, read: Date | null | undefined) =>
  read ? sql`date_trunc('milliseconds', ${column}) = ${read.toISOString()}::timestamptz` : isNull(column)

/**
 * Unlock's write (owner, 2026-11-04): made only while the session is still as Unlock read it, with the same status, no
 * published result, the same Lock Now / Close Now stamps (the ones it clears), and still no result ever declared. Null
 * when no row matched: a result was declared, or another operator stopped, unlocked or changed the session, between the
 * read and this write.
 */
export async function unlockWorliSessionIfUnchanged(read: WorliInstanceRow, status: WorliStatus) {
  const i = matkaWorliInstances
  const [row] = await db.update(i)
    .set({ status, actualLockAtUtc: null, actualCloseAtUtc: null, updatedAt: new Date() })
    .where(and(eq(i.id, read.id), eq(i.status, read.status), isNull(i.resultPublishedAtUtc),
      sameStamp(i.actualLockAtUtc, read.actualLockAtUtc), sameStamp(i.actualCloseAtUtc, read.actualCloseAtUtc), sql`NOT ${resultEverDeclared}`))
    .returning()
  return row ?? null
}
