import DataLoader from 'dataloader'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { users } from '@shared/db/schema.js'
import { getEffectiveTenant } from '@src/domains/common/directorModeUtils.js'
import { playerAccess, type PlayerAccessSource } from './playerAccess.js'

/** Every users column the access rule reads (PlayerAccessSource). */
export const PLAYER_ACCESS_FIELDS = ['status', 'withdrawalLock', 'bonusAllowed', 'sportsVisible', 'sportsBetAllowed',
  'casinoVisible', 'casinoBetAllowed', 'matkaVisible', 'matkaBetAllowed'] as const

/** Whether a User object carries every field the access rule reads. A users-row mapper does; a lookup row may not. */
export function carriesPlayerAccess(user: unknown): boolean {
  return !!user && typeof user === 'object' && PLAYER_ACCESS_FIELDS.every((field) => (user as Record<string, unknown>)[field] !== undefined)
}

/** The access fields of the given players, read in one tenant only, keyed by id. A player not found there is left out. */
export type PlayerAccessReader = (tenant: string, ids: readonly number[]) => Promise<Map<number, PlayerAccessSource>>

export const readPlayerAccessSources: PlayerAccessReader = async (tenant, ids) => {
  if (!ids.length) return new Map()
  const rows = await db
    .select({
      id: users.id, status: users.status, withdrawalLock: users.withdrawalLock, bonusAllowed: users.bonusAllowed,
      sportsVisible: users.sportsVisible, sportsBetAllowed: users.sportsBetAllowed, casinoVisible: users.casinoVisible,
      casinoBetAllowed: users.casinoBetAllowed, matkaVisible: users.matkaVisible, matkaBetAllowed: users.matkaBetAllowed,
    })
    .from(users)
    .where(and(eq(users.tenant, tenant), inArray(users.id, [...ids])))
  return new Map(rows.map(({ id, ...source }) => [id, source]))
}

const PLAYER_ID_MAX = 2147483647
function playerIdOf(user: any): number | null {
  const id = Number(user?.id)
  return Number.isSafeInteger(id) && id >= 1 && id <= PLAYER_ID_MAX ? id : null
}

/** The access fields the User object states itself. They win over the stored ones, so access agrees with the object. */
function statedFields(user: Record<string, unknown>): PlayerAccessSource {
  return Object.fromEntries(PLAYER_ACCESS_FIELDS.filter((field) => user[field] !== undefined).map((field) => [field, user[field]])) as PlayerAccessSource
}

/**
 * User.access for every source of a User (players/PLA-09, reverify E102). A users-row mapper (usersPage, user(id),
 * setUserStatus's reply) carries the fields the rule reads, and access is worked out from them at once. Other sources
 * build a User from a lookup: referralReferees and ReferrerProfile.referees rows (id, name, phone, username),
 * Deposit.user (id, name, email, phone) and SportsPlayerProfile.user (status, no switches). Their access said an active
 * player could not log in, deposit or withdraw. Such a row now has its missing fields read by id, the rows resolved
 * together in one batch (one query however many rows), in the caller's own tenant (the tenant those sources read their
 * rows from). The fields the row states itself win, and a player not found there is granted nothing, as before.
 */
export function createUserAccessField(read: PlayerAccessReader = readPlayerAccessSources) {
  const loadersByRequest = new WeakMap<object, DataLoader<number, PlayerAccessSource | null>>()
  const loaderFor = (ctx: object) => {
    let loader = loadersByRequest.get(ctx)
    if (!loader) {
      const tenant = getEffectiveTenant(ctx) ?? 'default'
      // No cache: a subscription keeps its context for as long as it runs, and a remembered status would go stale. The
      // rows resolved together (a list's) still share one read, each id once.
      loader = new DataLoader<number, PlayerAccessSource | null>(async (ids) => {
        const found = await read(tenant, [...new Set(ids)])
        return ids.map((id) => found.get(id) ?? null)
      }, { cache: false })
      loadersByRequest.set(ctx, loader)
    }
    return loader
  }
  return function userAccess(user: any, _args?: unknown, ctx?: unknown) {
    if (carriesPlayerAccess(user)) return playerAccess(user)
    const id = playerIdOf(user)
    if (id === null || !ctx || typeof ctx !== 'object') return playerAccess(user ?? {})
    return loaderFor(ctx).load(id).then((stored) => playerAccess(stored ? { ...stored, ...statedFields(user) } : user))
  }
}

/** The User.access field resolver both User maps use (commonResolvers.User wins in domains/index.ts). */
export const userAccessField = createUserAccessField()
