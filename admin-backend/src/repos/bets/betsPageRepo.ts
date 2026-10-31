import { sql, type SQL } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { buildSportsBetsQuery, type SportsBetFilter } from '@src/repos/sports/sportsBetsRepo.js'
import { buildCasinoBetsQuery, type CasinoBetFilter } from '@src/repos/casino/casinoBetsRepo.js'
import { buildMatkaBetsQuery, type MatkaBetFilter } from '@src/repos/matka/matkaBetsRepo.js'

export type BetPageKey = { domain: 'SPORTS' | 'CASINO' | 'MATKA'; id: string }

/** Page the complete filtered union in PostgreSQL; only one page of IDs reaches the app.
 * The source builders also serve each domain's list, retaining tenant/player/search restrictions.
 * Callers pass only domains for which the current user has permission.
 */
export async function getBetPageKeys(
  filters: { sports?: SportsBetFilter; casino?: CasinoBetFilter; matka?: MatkaBetFilter },
  offset: number,
  limit: number,
): Promise<BetPageKey[]> {
  const branches: SQL[] = []
  if (filters.sports) {
    const source = (await buildSportsBetsQuery(filters.sports)).query.as('sports_page_source')
    branches.push(sql`select 'SPORTS'::text as domain, ${source.id} as id, ${source.createdAt} as created_at from ${source}`)
  }
  if (filters.casino) {
    const source = (await buildCasinoBetsQuery(filters.casino)).query.as('casino_page_source')
    branches.push(sql`select 'CASINO'::text as domain, ${source.id} as id, ${source.createdAt} as created_at from ${source}`)
  }
  if (filters.matka) {
    const source = (await buildMatkaBetsQuery(filters.matka)).query.as('matka_page_source')
    branches.push(sql`select 'MATKA'::text as domain, ${source.id} as id, ${source.createdAt} as created_at from ${source}`)
  }
  if (!branches.length) return []
  const result = await db.execute<BetPageKey>(sql`
    select domain, id from (${sql.join(branches, sql` union all `)}) as filtered_bets
    order by created_at desc, id desc, domain asc
    limit ${limit} offset ${offset}
  `)
  return result.rows
}
