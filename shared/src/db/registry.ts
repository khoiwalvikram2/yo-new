/**
 * Database handle registry for the shared layer.
 *
 * `shared` is the bottom layer of the monorepo: it must never import from
 * admin-backend or user-backend. Each application registers its own Drizzle
 * handle once during bootstrap, and shared services resolve it from here.
 *
 * This replaces the previous pattern of probing for a connection with
 * try/catch dynamic imports into the consuming applications, which created a
 * circular dependency and made the resolved database non-deterministic.
 */

/** Drizzle database handle or transaction. Structurally typed to avoid a
 *  hard dependency on a specific drizzle driver generic in shared. */
export type SharedDb = any

let registered: SharedDb | null = null

/** Register the application's database handle. Call once during bootstrap. */
export function setSharedDb(db: SharedDb): void {
  registered = db
}

/** Resolve a database handle, preferring an explicit transaction.
 *  Returns null when nothing has been registered. */
export function resolveDb(tx?: SharedDb): SharedDb | null {
  return tx ?? registered
}

/** Resolve a database handle or throw. Use where a missing handle is a bug. */
export function requireDb(tx?: SharedDb): SharedDb {
  const db = resolveDb(tx)
  if (!db) {
    throw new Error(
      'shared: no database handle registered. Call setSharedDb(db) during application bootstrap.'
    )
  }
  return db
}

/** True once an application has registered a handle. */
export function hasSharedDb(): boolean {
  return registered !== null
}
