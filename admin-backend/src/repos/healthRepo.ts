import { db } from '@src/db/client.js'
import { users } from '@src/db/schema.js'
import { sql } from 'drizzle-orm'

export async function pingDb(): Promise<boolean> {
  try {
    await db
      .select({ ok: sql<number>`1` })
      .from(users)
      .limit(1)
    return true
  } catch {
    return false
  }
}

