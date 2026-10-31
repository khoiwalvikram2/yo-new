import { db } from '@src/db/client.js'
import { crmPlayerConsents, crmConsentEvents } from '@shared/db/schema.js'
import { and, eq, sql, desc, inArray } from 'drizzle-orm'

/**
 * Permission to contact a player, and every change to it.
 *
 * Two rules hold this together and neither is optional:
 *
 *   1. The state row is **derived from the event**, in one transaction. Never
 *      upsert the state on its own — a withdrawal that gets overwritten is
 *      indistinguishable from one that never happened, and that is the single
 *      row this table exists to protect.
 *   2. There is no "never asked" state. The absence of a row is that. A state
 *      meaning "no state" invites an upsert path that can destroy a WITHDRAWN
 *      suppression by treating it as blank.
 *
 * Purpose is part of the key because one channel carries several kinds of
 * message: SMS is a login code, a service notice and a marketing offer.
 * Withdrawing marketing must not stop the login code.
 */

export type ConsentChannel = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'PUSH' | 'CALL'
export type ConsentPurpose = 'MARKETING' | 'SERVICE'
export type ConsentState = 'GRANTED' | 'WITHDRAWN' | 'REFUSED'
export type ConsentSource =
  | 'SIGNUP_FORM'
  | 'PLAYER_PORTAL'
  | 'AGENT_VERBAL'
  | 'IMPORT'
  | 'ADMIN'
  | 'RG_AUTO'

export const CONSENT_CHANNELS: ConsentChannel[] = ['SMS', 'WHATSAPP', 'EMAIL', 'PUSH', 'CALL']

export type ConsentRow = typeof crmPlayerConsents.$inferSelect
export type ConsentEventRow = typeof crmConsentEvents.$inferSelect

export type RecordConsentInput = {
  tenant: string
  playerId: number
  channel: ConsentChannel
  purpose: ConsentPurpose
  toState: ConsentState
  source: ConsentSource
  consentTextVersion?: string | null
  evidenceRef?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  actorKind: 'crm' | 'admin' | 'player' | 'system'
  actorId?: string | null
  reason?: string | null
}

/**
 * Writes one transition and brings the state row with it.
 *
 * Both rows or neither. The event is the record; the state row exists so a
 * send path can ask one cheap question instead of replaying history.
 */
export async function recordConsent(
  input: RecordConsentInput,
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<{ from: ConsentState | null; to: ConsentState }> {
  const run = async (t: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    // Serialise every writer for this exact (tenant, player, channel, purpose)
    // before anything is read.
    //
    // `SELECT ... FOR UPDATE` cannot do this job: the first transition for a
    // key has no row to lock, so two concurrent writers both read "no row",
    // both stamp `from_state = null`, and the one that loses the insert race
    // overwrites the winner's state through the DO UPDATE — leaving a state row
    // and an event chain that disagree about what the player actually asked
    // for. An advisory lock is held on the key itself, which exists whether or
    // not the row does, and is released when the transaction ends.
    await t.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm_consent:${input.tenant}:${input.playerId}:${input.channel}:${input.purpose}`}, 0))`
    )

    const [current] = await t
      .select()
      .from(crmPlayerConsents)
      .where(
        and(
          eq(crmPlayerConsents.tenant, input.tenant),
          eq(crmPlayerConsents.playerId, input.playerId),
          eq(crmPlayerConsents.channel, input.channel),
          eq(crmPlayerConsents.purpose, input.purpose)
        )
      )
      .limit(1)

    const from = (current?.state as ConsentState | undefined) ?? null
    const now = new Date()

    await t.insert(crmConsentEvents).values({
      tenant: input.tenant,
      playerId: input.playerId,
      channel: input.channel,
      purpose: input.purpose,
      fromState: from,
      toState: input.toState,
      source: input.source,
      consentTextVersion: input.consentTextVersion ?? null,
      evidenceRef: input.evidenceRef ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      actorKind: input.actorKind,
      actorId: input.actorId ?? null,
      reason: input.reason ?? null,
    })

    await t
      .insert(crmPlayerConsents)
      .values({
        tenant: input.tenant,
        playerId: input.playerId,
        channel: input.channel,
        purpose: input.purpose,
        state: input.toState,
        stateSince: now,
        grantedAt: input.toState === 'GRANTED' ? now : (current?.grantedAt ?? null),
        source: input.source,
        consentTextVersion: input.consentTextVersion ?? null,
        evidenceRef: input.evidenceRef ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          crmPlayerConsents.tenant,
          crmPlayerConsents.playerId,
          crmPlayerConsents.channel,
          crmPlayerConsents.purpose,
        ],
        set: {
          state: input.toState,
          stateSince: now,
          // The first grant is kept, so "since when have they been contactable"
          // survives a withdrawal and a later re-grant.
          //
          // Resolved against the live row rather than the `current` read above.
          // The advisory lock already makes those agree; writing it in SQL means
          // this cannot quietly become wrong again if the lock is ever moved or
          // an external `tx` skips it — a JS literal here would write NULL over
          // a real first-grant date it never saw.
          grantedAt:
            input.toState === 'GRANTED'
              ? sql`coalesce(${crmPlayerConsents.grantedAt}, ${now})`
              : sql`${crmPlayerConsents.grantedAt}`,
          source: input.source,
          consentTextVersion: input.consentTextVersion ?? null,
          evidenceRef: input.evidenceRef ?? null,
          updatedAt: now,
        },
      })

    return { from, to: input.toState }
  }

  return tx ? run(tx) : db.transaction(run)
}

/** Current consent for one player, across every channel and purpose. */
export async function getPlayerConsents(tenant: string, playerId: number): Promise<ConsentRow[]> {
  return db
    .select()
    .from(crmPlayerConsents)
    .where(and(eq(crmPlayerConsents.tenant, tenant), eq(crmPlayerConsents.playerId, playerId)))
    .orderBy(crmPlayerConsents.channel, crmPlayerConsents.purpose)
}

export async function getPlayerConsentHistory(
  tenant: string,
  playerId: number,
  limit = 100
): Promise<ConsentEventRow[]> {
  return db
    .select()
    .from(crmConsentEvents)
    .where(and(eq(crmConsentEvents.tenant, tenant), eq(crmConsentEvents.playerId, playerId)))
    // By insertion order, so the history reads in the order things actually
    // happened rather than in the order transactions happened to start.
    .orderBy(desc(crmConsentEvents.seq))
    .limit(Math.min(Math.max(limit, 1), 500))
}

/**
 * Withdraws marketing consent on every channel at once.
 *
 * Used when a responsible-gambling block goes on: a player who has excluded
 * themselves has not merely stopped playing, they have asked not to be pulled
 * back. Recording it as consent rather than relying on the block means it
 * survives the block being lifted.
 */
export async function withdrawAllMarketingConsent(
  input: {
    tenant: string
    playerId: number
    actorKind: 'crm' | 'admin' | 'system'
    actorId?: string | null
    reason?: string | null
  },
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<number> {
  let n = 0
  for (const channel of CONSENT_CHANNELS) {
    await recordConsent(
      {
        tenant: input.tenant,
        playerId: input.playerId,
        channel,
        purpose: 'MARKETING',
        toState: 'WITHDRAWN',
        source: 'RG_AUTO',
        actorKind: input.actorKind,
        actorId: input.actorId ?? null,
        reason: input.reason ?? 'Responsible gambling block applied',
      },
      tx
    )
    n++
  }
  return n
}

/**
 * Whether this player may be contacted on this channel for this purpose.
 *
 * **Nothing calls this yet, and that is deliberate.** The platform has no
 * player-messaging path from this process — no SMS, no WhatsApp, no player
 * email — so there is no send boundary to install it in. It ships now, with
 * tests, so that when a sender is built the check already exists and the
 * ordering below is already settled rather than being decided under deadline.
 *
 * One-time codes and transactional notices must **not** consult this. They are
 * not marketing, and an opted-out player still has to be able to sign in.
 *
 * A responsible-gambling block outranks consent: a player who granted marketing
 * consent last year and self-excluded last week is not contactable, and asking
 * consent alone would say otherwise.
 */
export async function canContact(
  tenant: string,
  playerId: number,
  channel: ConsentChannel,
  purpose: ConsentPurpose
): Promise<{ allowed: boolean; reason: string | null }> {
  if (purpose === 'MARKETING') {
    const { getRgBlockState } = await import('@shared/services/rgEnforcement.js')
    const rg = await getRgBlockState(tenant, playerId)
    if (rg.blocked) return { allowed: false, reason: 'rg_blocked' }
  }

  const [row] = await db
    .select({ state: crmPlayerConsents.state })
    .from(crmPlayerConsents)
    .where(
      and(
        eq(crmPlayerConsents.tenant, tenant),
        eq(crmPlayerConsents.playerId, playerId),
        eq(crmPlayerConsents.channel, channel),
        eq(crmPlayerConsents.purpose, purpose)
      )
    )
    .limit(1)

  // No row means never asked, which is not permission.
  if (!row) return { allowed: false, reason: 'never_asked' }
  if (row.state !== 'GRANTED') return { allowed: false, reason: row.state.toLowerCase() }
  return { allowed: true, reason: null }
}

/**
 * The inverse: players who must not be contacted for a purpose on a channel.
 *
 * This is the list a campaign is checked against, and the one an auditor asks
 * for. It is a query rather than a stored list so it cannot drift from the
 * consent rows it describes.
 */
export async function listSuppressed(
  tenant: string,
  channel: ConsentChannel,
  purpose: ConsentPurpose,
  playerIds: number[]
): Promise<Set<number>> {
  if (playerIds.length === 0) return new Set()

  const granted = await db
    .select({ playerId: crmPlayerConsents.playerId })
    .from(crmPlayerConsents)
    .where(
      and(
        eq(crmPlayerConsents.tenant, tenant),
        eq(crmPlayerConsents.channel, channel),
        eq(crmPlayerConsents.purpose, purpose),
        eq(crmPlayerConsents.state, 'GRANTED'),
        inArray(crmPlayerConsents.playerId, playerIds)
      )
    )
  const ok = new Set(granted.map((r) => r.playerId))

  const suppressed = new Set(playerIds.filter((id) => !ok.has(id)))
  if (purpose !== 'MARKETING') return suppressed

  // A block suppresses marketing regardless of what consent says.
  const { findBlockedPlayers } = await import('@shared/services/rgEnforcement.js')
  for (const id of await findBlockedPlayers(tenant, playerIds)) suppressed.add(id)
  return suppressed
}

/**
 * Checks that every state row agrees with the newest event for its key.
 *
 * Exported for the reconciliation test. If these ever disagree, something wrote
 * a state row outside `recordConsent`, and the state is no longer evidence of
 * anything.
 */
export async function findConsentDisagreements(
  tenant: string
): Promise<Array<{ playerId: number; channel: string; purpose: string; state: string; latest: string }>> {
  const res = await db.execute(sql`
    SELECT c.player_id, c.channel, c.purpose, c.state, e.to_state AS latest
    FROM crm_player_consents c
    JOIN LATERAL (
      SELECT to_state FROM crm_consent_events ev
      WHERE ev.tenant = c.tenant AND ev.player_id = c.player_id
        AND ev.channel = c.channel AND ev.purpose = c.purpose
      -- Insertion order. Ordering by created_at with a random-uuid tiebreak
      -- could pick the older of two events written in the same instant and
      -- report a disagreement that never happened.
      ORDER BY ev.seq DESC
      LIMIT 1
    ) e ON true
    WHERE c.tenant = ${tenant} AND c.state <> e.to_state
  `)
  return res.rows as Array<{
    playerId: number
    channel: string
    purpose: string
    state: string
    latest: string
  }>
}
