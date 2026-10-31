import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { casinoCategories } from '../db/schema/casino.js'

export const CASINO_LOUNGE_DEFAULT_CATEGORIES = (['live_casino', 'casino', 'slots'] as const).map(mainCategory => ({
  mainCategory, type: 'lounge' as const, name: 'Casino lounge', slug: 'casino-lounge', order: 90,
}))

/** A newly created tenant starts with empty collections; no game is auto-assigned. */
export async function seedEmptyCasinoLounge(database: Pick<NodePgDatabase<any>, 'insert'>, tenantId: string) {
  await database.insert(casinoCategories).values(CASINO_LOUNGE_DEFAULT_CATEGORIES.map(category => ({
    ...category, tenantId, isActive: true,
  }))).onConflictDoNothing()
}
