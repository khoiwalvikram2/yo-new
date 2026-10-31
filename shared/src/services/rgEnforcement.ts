import { eq, and, sql, inArray } from 'drizzle-orm'
import { users } from '../db/schema.js'
import { resolveDb } from '../db/registry.js'
import type { SharedDb } from '../db/registry.js'

/**
 * The responsible-gambling block, at the points where it has to bite.
 *
 * Two rules, and the second is the one that is easy to get wrong:
 *
 *   1. A blocked player may not stake and may not put money in.
 *   2. A blocked player **may** sign in, see their balance, and take their
 *      money out.
 *
 * Blocking the login is the intuitive move and it is wrong: a player who has
 * excluded themselves still owns their balance, and the only route they have to
 * ask for it is the account you just closed. Stranding it is the failure with
 * no defence. So nothing here is ever called from a login, a withdrawal, a
 * settlement pay-out or a provider rollback — money out must keep working.
 *
 * The state is read from `users.rg_blocked_until`, deliberately not
 * `users.status`: that column is written by several mutations that know nothing
 * about responsible gambling, its enum has no value meaning "excluded", and
 * settlement contribution filters on it. See the column's own comment.
 *
 * A cooling-off period ends by itself, because the block is a timestamp. No job
 * has to run for the player to be freed, which means a missed sweep can never
 * trap someone.
 */

/** What the block permits. Money out is deliberately absent — it is never gated. */
export type RgGuardedAction = 'stake' | 'fund'

export class RgBlockedError extends Error {
  readonly code = 'RG_BLOCKED'
  readonly action: RgGuardedAction
  readonly reason: string | null
  readonly blockedUntil: Date | null

  constructor(action: RgGuardedAction, reason: string | null, blockedUntil: Date | null) {
    super(
      action === 'fund'
        ? 'This account cannot add funds because a responsible gambling block is in place.'
        : 'This account cannot place bets because a responsible gambling block is in place.'
    )
    this.name = 'RgBlockedError'
    this.action = action
    this.reason = reason
    this.blockedUntil = blockedUntil
  }
}

export type RgBlockState = {
  blocked: boolean
  reason: string | null
  blockedUntil: Date | null
}

/**
 * Reads the block for one player.
 *
 * The comparison happens in SQL against `now()` so a cooling-off that lapsed a
 * second ago is already over, without depending on the caller's clock. An
 * indefinite block is stored as `'infinity'`, which compares correctly without
 * a special case.
 */
export async function getRgBlockState(
  tenant: string,
  playerId: number,
  tx?: SharedDb
): Promise<RgBlockState> {
  const db = resolveDb(tx)
  if (!db) throw new Error('rgEnforcement: no database handle registered')

  const rows = await db
    .select({
      reason: users.rgBlockReason,
      blockedUntil: users.rgBlockedUntil,
      live: sql<boolean>`${users.rgBlockedUntil} is not null and ${users.rgBlockedUntil} > now()`,
    })
    .from(users)
    .where(and(eq(users.id, playerId), eq(users.tenant, tenant)))
    .limit(1)

  const row = rows[0]
  // A player who is not in this tenant is not this tenant's to judge. Reporting
  // "not blocked" is right: the caller's own tenant check is what should have
  // refused them, and inventing a block here would hide that gap.
  if (!row) return { blocked: false, reason: null, blockedUntil: null }

  return {
    blocked: row.live === true,
    reason: row.reason ?? null,
    blockedUntil: row.blockedUntil ?? null,
  }
}

/** Throws `RgBlockedError` if this player may not place a bet. */
export async function assertPlayerCanStake(
  tenant: string,
  playerId: number,
  tx?: SharedDb
): Promise<void> {
  const state = await getRgBlockState(tenant, playerId, tx)
  if (state.blocked) throw new RgBlockedError('stake', state.reason, state.blockedUntil)
}

/**
 * Throws `RgBlockedError` if money may not be added to this account.
 *
 * Covers a deposit the player starts, a gateway callback crediting one, an
 * admin adjustment that adds funds, and a bonus award — all of them are money
 * arriving in an account that asked not to receive it.
 */
export async function assertPlayerCanFund(
  tenant: string,
  playerId: number,
  tx?: SharedDb
): Promise<void> {
  const state = await getRgBlockState(tenant, playerId, tx)
  if (state.blocked) throw new RgBlockedError('fund', state.reason, state.blockedUntil)
}

/**
 * The same check for many players at once, for a bonus distribution or an
 * import. Returns the ids that are blocked, so the caller can exclude them and
 * report how many rather than failing the whole run.
 */
export async function findBlockedPlayers(
  tenant: string,
  playerIds: number[],
  tx?: SharedDb
): Promise<Set<number>> {
  if (playerIds.length === 0) return new Set()
  const db = resolveDb(tx)
  if (!db) throw new Error('rgEnforcement: no database handle registered')

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenant, tenant),
        inArray(users.id, playerIds),
        sql`${users.rgBlockedUntil} is not null and ${users.rgBlockedUntil} > now()`
      )
    )
  return new Set(rows.map((r: { id: number }) => r.id))
}
