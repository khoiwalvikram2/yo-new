import { db } from '@/db/client.js'
import { sportsAutoConfigsTable } from '@shared/db/schema.js'
import { and, eq } from 'drizzle-orm'

export type SportsAutoConfig = typeof sportsAutoConfigsTable.$inferSelect

export async function markAutoConfigRunning(whitelabelId: string, sportId: string) {
  await db
    .update(sportsAutoConfigsTable)
    .set({ lastRunStatus: 'running', updatedAt: new Date() })
    .where(and(eq(sportsAutoConfigsTable.whitelabelId, whitelabelId), eq(sportsAutoConfigsTable.sportId, sportId)))
}

export async function markAutoConfigSuccess(whitelabelId: string, sportId: string) {
  await db
    .update(sportsAutoConfigsTable)
    .set({ lastRunAt: new Date(), lastRunStatus: 'success', updatedAt: new Date() })
    .where(and(eq(sportsAutoConfigsTable.whitelabelId, whitelabelId), eq(sportsAutoConfigsTable.sportId, sportId)))
}

export async function markAutoConfigFailure(whitelabelId: string, sportId: string) {
  await db
    .update(sportsAutoConfigsTable)
    .set({ lastRunAt: new Date(), lastRunStatus: 'failure', updatedAt: new Date() })
    .where(and(eq(sportsAutoConfigsTable.whitelabelId, whitelabelId), eq(sportsAutoConfigsTable.sportId, sportId)))
}

export async function getAutoConfig(whitelabelId: string, sportId: string): Promise<SportsAutoConfig | null> {
  const rows = await db
    .select()
    .from(sportsAutoConfigsTable)
    .where(and(eq(sportsAutoConfigsTable.whitelabelId, whitelabelId), eq(sportsAutoConfigsTable.sportId, sportId)))
  return rows[0] ?? null
}

export async function listActiveAutoConfigs(): Promise<SportsAutoConfig[]> {
  return db
    .select()
    .from(sportsAutoConfigsTable)
    .where(eq(sportsAutoConfigsTable.active, true))
}

