import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { whitelabelPgSettings } from '@shared/db/schema.js'

/**
 * Resolve tenant from a webhook token. Any configured merchant counts, enabled or not: switching new
 * collections or payouts off must not strand orders and payouts that are already in flight.
 */
export async function findTenantByWebhookToken(token: string): Promise<string | null> {
  if (!token) return null
  const [row] = await db.select().from(whitelabelPgSettings)
    .where(eq(whitelabelPgSettings.webhookToken, token)).limit(1)
  if (!row || !row.secretSiteKeyEncrypted) return null
  return row.tenant
}
