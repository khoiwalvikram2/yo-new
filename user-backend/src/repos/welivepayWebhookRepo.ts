import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { whitelabelPgSettings } from '@shared/db/schema.js'

/** Resolve tenant from a webhook token; only enabled settings count. */
export async function findTenantByWebhookToken(token: string): Promise<string | null> {
  if (!token) return null
  const [row] = await db.select().from(whitelabelPgSettings)
    .where(eq(whitelabelPgSettings.webhookToken, token)).limit(1)
  if (!row || !row.enabled) return null
  return row.tenant
}
