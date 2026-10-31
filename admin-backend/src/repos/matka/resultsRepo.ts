import { db } from '@src/db/client.js'
import { results } from '@src/db/schema.js'
import { and, eq } from 'drizzle-orm'

export async function listResultsByDraw(drawId: string, tenant = 'default') {
  try {
    const rows = await db.select().from(results).where(and(eq(results.drawId, drawId), eq(results.tenant, tenant))).orderBy(results.enteredAt)
    return rows
  } catch { return [] }
}

export async function insertResult(drawId: string, value: string, enteredBy: string, tenant = 'default') {
  try {
    const [row] = await db.insert(results).values({ drawId, value, enteredBy, tenant }).returning()
    return row
  } catch { return null }
}

