import { db } from '@src/db/client.js'
import {
  crmPlayerRgFlags,
  crmExclusionRegister,
  users,
  wallets,
  userCasinoSessions,
} from '@shared/db/schema.js'
import { and, eq, sql, desc } from 'drizzle-orm'
import { withdrawAllMarketingConsent } from '@src/repos/crm/CrmConsentRepo.js'

/**
 * Responsible-gambling episodes, and the enforcement that makes them real.
 *
 * The table is an episode log, not a state machine with one slot per player. A
 * player can exclude themselves, be reinstated, and exclude themselves again;
 * a current-state row would update over the first and lose when it started, who
 * raised it and who lifted it. "How many times has this player self-excluded"
 * is the question a regulator actually asks.
 *
 * Enforcement lives on `users.rg_blocked_until`, never on `users.status` —
 * see that column's comment for why. Only two flag types block; the rest are
 * annotations that create work.
 */

export type RgFlagType =
  | 'SELF_EXCLUSION'
  | 'COOLING_OFF'
  | 'DEPOSIT_ESCALATION'
  | 'LOSS_CHASING'
  | 'SESSION_LENGTH'
  | 'AFFORDABILITY_CONCERN'

/** The two that stop play. The others are signals for the desk to act on. */
export const BLOCKING_FLAG_TYPES: RgFlagType[] = ['SELF_EXCLUSION', 'COOLING_OFF']

export function isBlockingFlag(t: string): boolean {
  return (BLOCKING_FLAG_TYPES as string[]).includes(t)
}

export type RgFlagRow = typeof crmPlayerRgFlags.$inferSelect

export type RaiseFlagInput = {
  tenant: string
  playerId: number
  flagType: RgFlagType
  initiatedBy: 'player' | 'operator'
  reason?: string | null
  /** Required for SELF_EXCLUSION: the earliest it may be lifted. */
  minTermEndsAt?: Date | null
  /** For COOLING_OFF: when the block lapses by itself. */
  endsAt?: Date | null
  raisedBy: string
}

export type RaiseFlagResult =
  | { ok: true; flag: RgFlagRow; blocked: boolean; balanceAtBlock: string | null }
  | {
      ok: false
      reason: 'already_active' | 'player_not_found' | 'min_term_required' | 'ends_at_required'
    }

type RgTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Derives `users.rg_blocked_until` from the episodes that are actually in force.
 *
 * The column is a property of the whole live set, not of whichever flag was
 * touched last. Assigning it from the flag in hand is what let a week-long
 * cooling-off raised over an indefinite self-exclusion overwrite `infinity`
 * with next week — freeing the player the moment the cooling-off lapsed, while
 * the self-exclusion was still ACTIVE — and what let lifting one of two
 * blocking episodes leave the other's end date standing.
 *
 * Fail-safe in both directions: a blocking flag with no end date counts as
 * indefinite rather than as no block at all, so a malformed row over-blocks
 * instead of quietly freeing someone.
 */
async function recomputeRgBlock(tx: RgTx, tenant: string, playerId: number): Promise<void> {
  await tx.execute(sql`
    WITH in_force AS (
      SELECT
        flag_type,
        CASE WHEN flag_type = 'SELF_EXCLUSION' OR ends_at IS NULL
             THEN 'infinity'::timestamptz
             ELSE ends_at END AS until
      FROM crm_player_rg_flags
      WHERE tenant = ${tenant}
        AND player_id = ${playerId}
        AND status = 'ACTIVE'
        AND blocks_play
        AND (ends_at IS NULL OR ends_at > now())
      ORDER BY 2 DESC
      LIMIT 1
    )
    UPDATE users u
    SET rg_blocked_until = (SELECT until FROM in_force),
        rg_block_reason  = (SELECT flag_type FROM in_force)
    WHERE u.id = ${playerId} AND u.tenant = ${tenant}
  `)
}

/**
 * The register bars opening a *second account*, so it stands exactly as long as
 * a self-exclusion does — no more, no less.
 *
 * Releasing used to be nested inside "no other blocking episode remains", which
 * is a different question entirely. A cooling-off standing alongside a lifted
 * self-exclusion left the register row live with nothing that could ever
 * release it, and `registerUser` refuses that phone number permanently.
 *
 * Register rows carry no player, only the flag that wrote them, so the player
 * is reached through the flag.
 */
async function syncExclusionRegister(tx: RgTx, tenant: string, playerId: number): Promise<void> {
  await tx.execute(sql`
    UPDATE crm_exclusion_register r
    SET released_at = now()
    WHERE r.tenant = ${tenant}
      AND r.released_at IS NULL
      AND r.source_flag_id IN (
        SELECT f.id FROM crm_player_rg_flags f
        WHERE f.tenant = ${tenant}
          AND f.player_id = ${playerId}
          AND f.flag_type = 'SELF_EXCLUSION'
      )
      AND NOT EXISTS (
        SELECT 1 FROM crm_player_rg_flags a
        WHERE a.tenant = ${tenant}
          AND a.player_id = ${playerId}
          AND a.flag_type = 'SELF_EXCLUSION'
          AND a.status = 'ACTIVE'
      )
  `)
}

/**
 * Re-exported from shared.
 *
 * The definition lives there because registration — the one place the register
 * has to be consulted — runs in user-backend, which cannot import from here.
 * Two copies of a normalisation rule is two ways to disagree about whether
 * +91 98765 43210 and 9876543210 are the same person.
 */
export { hashIdentifier, isIdentifierExcluded } from '@shared/services/exclusionRegister.js'

import { hashIdentifier } from '@shared/services/exclusionRegister.js'

/**
 * Raises a flag, and enforces it if it blocks.
 *
 * Everything happens in one transaction. A recorded exclusion whose enforcement
 * failed is worse than no record: it reads as protection and is not.
 */
export async function raiseRgFlag(input: RaiseFlagInput): Promise<RaiseFlagResult> {
  if (input.flagType === 'SELF_EXCLUSION' && !input.minTermEndsAt) {
    return { ok: false, reason: 'min_term_required' }
  }
  // This refusal belongs here rather than inside the transaction. Returning a
  // failure from a transaction callback *commits* it, so a cooling-off with no
  // end date used to leave behind an ACTIVE blocking flag that nothing
  // enforced, that `expireLapsedRgFlags` could never clear (its predicate needs
  // an end date), and that made every later cooling-off for that player collide
  // with the partial unique and report "already active".
  if (input.flagType === 'COOLING_OFF' && !input.endsAt) {
    return { ok: false, reason: 'ends_at_required' }
  }

  const blocks = isBlockingFlag(input.flagType)

  return db.transaction(async (tx) => {
    // Locked, not merely read. `users.rg_blocked_until` is the row both this
    // and `liftRgFlag` end up writing, and both decide what to write from the
    // set of live episodes. Taking the same lock first in both is what makes
    // them serialise: without it a lift running alongside this raise counts the
    // episodes before this one is visible, concludes none remain, and clears a
    // block that is about to exist.
    const [player] = await tx
      .select({ id: users.id, phone: users.phone, email: users.email })
      .from(users)
      .where(and(eq(users.id, input.playerId), eq(users.tenant, input.tenant)))
      .for('update')
      .limit(1)
    if (!player) return { ok: false, reason: 'player_not_found' as const }

    // 1. The episode. The partial unique on (tenant, player, type) WHERE ACTIVE
    //    is what makes a concurrent double-raise fail loudly instead of one
    //    silently overwriting the other.
    let flag: RgFlagRow
    try {
      // Inside a savepoint. A unique violation aborts the *whole* transaction in
      // Postgres, so catching it and continuing is only possible if the failed
      // statement can be rolled back on its own — otherwise the block, the
      // consent withdrawal and everything after it would fail at COMMIT with a
      // confusing "current transaction is aborted".
      flag = await tx.transaction(async (sp) => {
        const rows = await sp
          .insert(crmPlayerRgFlags)
          .values({
            tenant: input.tenant,
            playerId: input.playerId,
            flagType: input.flagType,
            status: 'ACTIVE',
            initiatedBy: input.initiatedBy,
            blocksPlay: blocks,
            minTermEndsAt: input.minTermEndsAt ?? null,
            endsAt: input.endsAt ?? null,
            reason: input.reason ?? null,
            raisedBy: input.raisedBy,
          })
          .returning()
        return rows[0]
      })
    } catch (e) {
      const code = String((e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code)
      if (code === '23505') {
        return { ok: false, reason: 'already_active' as const }
      }
      throw e
    }

    if (!blocks) {
      // A non-blocking flag is an annotation. It touches no users column.
      return { ok: true, flag, blocked: false, balanceAtBlock: null }
    }

    // 2. The block itself — derived from every live episode, never from the one
    //    just raised. The end date still does the enforcing on its own, so a
    //    missed sweep can delay a status label but cannot free anybody.
    const updated = await tx
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(and(eq(users.id, input.playerId), eq(users.tenant, input.tenant)))
      .returning({ id: users.id })
    // The tenant predicate is what stops this reaching another whitelabel's
    // player; zero rows means it would have, so the whole thing aborts.
    if (updated.length === 0) throw new Error('rg: refused to block a player outside this tenant')
    await recomputeRgBlock(tx, input.tenant, input.playerId)

    // 3. Casino sessions are a separate token space that token_version does not
    //    reach, so they are ended explicitly.
    await tx.delete(userCasinoSessions).where(eq(userCasinoSessions.userId, input.playerId))

    // 4. A player who excluded themselves has not merely stopped playing — they
    //    have asked not to be pulled back. Recorded as consent so it survives
    //    the block being lifted.
    await withdrawAllMarketingConsent(
      {
        tenant: input.tenant,
        playerId: input.playerId,
        actorKind: 'system',
        actorId: input.raisedBy,
        reason: `${input.flagType} applied`,
      },
      tx
    )

    // 5. The register, so a second account cannot be opened with the same
    //    identifiers. Only for an indefinite exclusion — a cooling-off is a
    //    pause, not a bar.
    if (input.flagType === 'SELF_EXCLUSION') {
      for (const [kind, value] of [
        ['phone', player.phone],
        ['email', player.email],
      ] as const) {
        if (!value) continue
        await tx
          .insert(crmExclusionRegister)
          .values({
            tenant: input.tenant,
            identifierKind: kind,
            identifierHash: hashIdentifier(input.tenant, kind, value),
            sourceFlagId: flag.id,
          })
          .onConflictDoNothing()
      }
    }

    // 6. What they were holding, so nobody has to reconstruct it later.
    const [wallet] = await tx
      .select({ cash: wallets.cash })
      .from(wallets)
      .where(and(eq(wallets.userId, input.playerId), eq(wallets.tenant, input.tenant)))
      .limit(1)
    const balance = wallet?.cash ?? null
    if (balance !== null) {
      await tx
        .update(crmPlayerRgFlags)
        .set({ balanceAtBlock: balance })
        .where(eq(crmPlayerRgFlags.id, flag.id))
      flag = { ...flag, balanceAtBlock: balance }
    }

    return { ok: true, flag, blocked: true, balanceAtBlock: balance }
  })
}

export type LiftFlagResult =
  | { ok: true; playerId: number }
  | {
      ok: false
      reason: 'not_found' | 'not_active' | 'same_principal' | 'before_min_term' | 'reason_required'
    }

/**
 * Lifts an episode.
 *
 * Three refusals, all deliberate:
 *   - the principal who raised it cannot lift it, because a single account
 *     being able to exclude and un-exclude is not a control;
 *   - a self-exclusion cannot be lifted before its minimum term, whatever
 *     anyone asks;
 *   - a reason is required, because "why was this lifted" is the question that
 *     gets asked afterwards.
 *
 * The block is only cleared if no other blocking episode is still active.
 */
export async function liftRgFlag(input: {
  tenant: string
  flagId: string
  liftedBy: string
  reason: string
  /**
   * Book scope, as a predicate rather than a pre-check by the caller: a flag id
   * outlives the player moving to another desk, and this is the direction that
   * lets a player be reached and take money again. Refusing reports
   * `not_found`, so out of scope is indistinguishable from missing.
   */
  canReach?: (playerId: number) => Promise<boolean>
}): Promise<LiftFlagResult> {
  if (!input.reason?.trim()) return { ok: false, reason: 'reason_required' }

  // Resolved before the transaction opens, because `canReach` runs its own
  // queries and must not do so while holding a row lock taken from the same
  // pool. A flag's `player_id` never changes after insert, so checking scope
  // against this read and locking against it below cannot disagree.
  const [peek] = await db
    .select({ playerId: crmPlayerRgFlags.playerId })
    .from(crmPlayerRgFlags)
    .where(and(eq(crmPlayerRgFlags.tenant, input.tenant), eq(crmPlayerRgFlags.id, input.flagId)))
    .limit(1)
  if (!peek) return { ok: false, reason: 'not_found' }
  if (input.canReach && !(await input.canReach(peek.playerId))) {
    return { ok: false, reason: 'not_found' }
  }

  return db.transaction(async (tx) => {
    // The users row first, in the same order `raiseRgFlag` takes it. Two lifts
    // of two different flags touch two different flag rows and so never
    // collide on their own — both could read "another blocking episode still
    // stands", both skip the clear, and the player stays blocked with no live
    // episode at all.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, peek.playerId), eq(users.tenant, input.tenant)))
      .for('update')
      .limit(1)

    const [flag] = await tx
      .select()
      .from(crmPlayerRgFlags)
      .where(and(eq(crmPlayerRgFlags.tenant, input.tenant), eq(crmPlayerRgFlags.id, input.flagId)))
      .for('update')
      .limit(1)
    if (!flag) return { ok: false, reason: 'not_found' as const }
    if (flag.status !== 'ACTIVE') return { ok: false, reason: 'not_active' as const }
    if (flag.raisedBy === input.liftedBy) return { ok: false, reason: 'same_principal' as const }
    if (flag.minTermEndsAt && flag.minTermEndsAt.getTime() > Date.now()) {
      return { ok: false, reason: 'before_min_term' as const }
    }

    await tx
      .update(crmPlayerRgFlags)
      .set({
        status: 'LIFTED',
        liftedAt: new Date(),
        liftedBy: input.liftedBy,
        liftReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(crmPlayerRgFlags.id, input.flagId))

    // Both unconditional, and both derived. Each answers its own question from
    // the live set — "what should the block be now" and "should the register
    // still stand" — and the two have different answers, which is why nesting
    // the register release inside the block's condition was wrong: a
    // self-exclusion lifted while a cooling-off stood released neither, and
    // nothing afterwards could.
    await recomputeRgBlock(tx, input.tenant, flag.playerId)
    await syncExclusionRegister(tx, input.tenant, flag.playerId)

    return { ok: true, playerId: flag.playerId }
  })
}

export async function listPlayerRgFlags(tenant: string, playerId: number): Promise<RgFlagRow[]> {
  return db
    .select()
    .from(crmPlayerRgFlags)
    .where(and(eq(crmPlayerRgFlags.tenant, tenant), eq(crmPlayerRgFlags.playerId, playerId)))
    .orderBy(desc(crmPlayerRgFlags.startsAt))
}

/**
 * Marks episodes whose end date has passed as EXPIRED.
 *
 * For reporting only. The block itself is a timestamp and lapses without this
 * running — which is the point: a missed sweep can delay a status label, never
 * trap a player.
 */
export async function expireLapsedRgFlags(tenant: string): Promise<number> {
  const rows = await db
    .update(crmPlayerRgFlags)
    .set({ status: 'EXPIRED', updatedAt: new Date() })
    .where(
      and(
        eq(crmPlayerRgFlags.tenant, tenant),
        eq(crmPlayerRgFlags.status, 'ACTIVE'),
        sql`${crmPlayerRgFlags.endsAt} is not null and ${crmPlayerRgFlags.endsAt} <= now()`
      )
    )
    .returning({ id: crmPlayerRgFlags.id, playerId: crmPlayerRgFlags.playerId })

  // The status relabel implies neither of these. An expiring self-exclusion has
  // to release its register rows or the identifiers stay barred forever, and a
  // player who still has another live episode has to keep the right block
  // rather than the one that just ended.
  for (const playerId of new Set(rows.map((r) => r.playerId))) {
    await db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, playerId), eq(users.tenant, tenant)))
        .for('update')
        .limit(1)
      await recomputeRgBlock(tx, tenant, playerId)
      await syncExclusionRegister(tx, tenant, playerId)
    })
  }
  return rows.length
}
