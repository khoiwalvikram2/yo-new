import { db } from '@src/db/client.js'
import { draws } from '@src/db/schema.js'
import { eq } from 'drizzle-orm'

export async function upsertDraw(draw: { id: string; type: string; openAt: string; cutoffAt: string; timezone: string; status: string }) {
  try {
    const existing = await db.select().from(draws).where(eq(draws.id, draw.id))
    if (existing.length) {
      const [row] = await db.update(draws).set({ type: draw.type, openAt: new Date(draw.openAt), cutoffAt: new Date(draw.cutoffAt), timezone: draw.timezone, status: draw.status }).where(eq(draws.id, draw.id)).returning()
      return row
    }
    const [row] = await db.insert(draws).values({ id: draw.id, type: draw.type, openAt: new Date(draw.openAt), cutoffAt: new Date(draw.cutoffAt), timezone: draw.timezone, status: draw.status }).returning()
    return row
  } catch {
    return null
  }
}

