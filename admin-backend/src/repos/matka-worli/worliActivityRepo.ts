import { db } from '@/db/client.js'
import { and, desc, eq } from 'drizzle-orm'
import { matkaActivityLogs } from '@shared/db/schema.js'

export interface WorliActivityInput {
  instanceId: string
  actorId: string
  action: string
  reason?: string | null
  metaJson?: any
}

export async function addWorliActivity(input: WorliActivityInput) {
  const [row] = await db.insert(matkaActivityLogs).values({
    instanceId: input.instanceId,
    actorId: input.actorId,
    action: input.action,
    reason: input.reason ?? null,
    metaJson: input.metaJson ? JSON.stringify(input.metaJson) : null,
  }).returning()
  return row
}

export async function listWorliActivity(instanceId: string) {
  return db.select().from(matkaActivityLogs).where(eq(matkaActivityLogs.instanceId, instanceId)).orderBy(desc(matkaActivityLogs.createdAt))
}

