import { db } from '@src/db/client.js'
import { crmContactAttempts } from '@shared/db/schema.js'
import { and, eq, desc, sql, inArray } from 'drizzle-orm'

/**
 * Every time someone tried to reach a player.
 *
 * A record of *attempts*, not of sends. That distinction is the honest one:
 * this platform has no player-messaging path from the process the CRM runs in,
 * so the contact that actually happens today is an agent picking up the phone.
 * Recording it is what turns "we called them twice, nobody answered" from
 * hearsay into something the next agent can read.
 *
 * This also gives `playerCommLog` — a stub returning an empty list since before
 * the CRM was rebuilt — something real to show.
 */

export type ContactChannel = 'CALL' | 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_PERSON'
export type ContactOutcome =
  | 'connected'
  | 'no_answer'
  | 'wrong_number'
  | 'refused'
  | 'voicemail'
  | 'busy'

export const CONTACT_CHANNELS: ContactChannel[] = ['CALL', 'SMS', 'WHATSAPP', 'EMAIL', 'IN_PERSON']
export const CONTACT_OUTCOMES: ContactOutcome[] = [
  'connected',
  'no_answer',
  'wrong_number',
  'refused',
  'voicemail',
  'busy',
]

export type ContactAttemptRow = typeof crmContactAttempts.$inferSelect

export async function recordContactAttempt(input: {
  tenant: string
  playerId: number
  taskId?: string | null
  channel: ContactChannel
  direction?: 'out' | 'in'
  outcome: ContactOutcome
  notes?: string | null
  byCrmUserId?: string | null
  byName: string
}): Promise<ContactAttemptRow> {
  const [row] = await db
    .insert(crmContactAttempts)
    .values({
      tenant: input.tenant,
      playerId: input.playerId,
      taskId: input.taskId ?? null,
      channel: input.channel,
      direction: input.direction ?? 'out',
      outcome: input.outcome,
      notes: input.notes?.slice(0, 500) ?? null,
      byCrmUserId: input.byCrmUserId ?? null,
      byName: input.byName,
    })
    .returning()
  return row
}

export async function listContactAttempts(
  tenant: string,
  playerId: number,
  limit = 50
): Promise<ContactAttemptRow[]> {
  return db
    .select()
    .from(crmContactAttempts)
    .where(and(eq(crmContactAttempts.tenant, tenant), eq(crmContactAttempts.playerId, playerId)))
    .orderBy(desc(crmContactAttempts.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 200))
}

/**
 * How many times, and how recently, a player has been chased.
 *
 * The count that matters on a desk is not "how many calls" but "how many
 * without getting through" — that is the number that tells an agent to stop
 * calling and try something else.
 */
export async function getContactSummary(
  tenant: string,
  playerIds: number[]
): Promise<Map<number, { attempts: number; unanswered: number; lastAt: Date | null }>> {
  const out = new Map<number, { attempts: number; unanswered: number; lastAt: Date | null }>()
  if (playerIds.length === 0) return out

  const rows = await db
    .select({
      playerId: crmContactAttempts.playerId,
      attempts: sql<number>`count(*)::int`,
      unanswered: sql<number>`count(*) FILTER (WHERE ${crmContactAttempts.outcome} <> 'connected')::int`,
      lastAt: sql<Date>`max(${crmContactAttempts.occurredAt})`,
    })
    .from(crmContactAttempts)
    .where(
      and(eq(crmContactAttempts.tenant, tenant), inArray(crmContactAttempts.playerId, playerIds))
    )
    .groupBy(crmContactAttempts.playerId)

  for (const r of rows) {
    out.set(r.playerId, {
      attempts: Number(r.attempts) || 0,
      unanswered: Number(r.unanswered) || 0,
      lastAt: r.lastAt ?? null,
    })
  }
  return out
}
