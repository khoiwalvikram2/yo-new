/** Read-only regression against an explicitly selected local/fixture tenant.
 * Set BET_PAGINATION_TEST_TENANT, with optional BET_PAGINATION_TEST_FROM/TO.
 * No bets, balances or settlement records are created or modified.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '@src/db/client.js'
import { getBetPageKeys, type BetPageKey } from '@src/repos/bets/betsPageRepo.js'
import { betsQueryResolvers } from '@src/domains/bets/resolvers/queries.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'

const tenant = process.env.BET_PAGINATION_TEST_TENANT
describe('complete Bet List pagination', { skip: !tenant }, () => {
  const filters = { dateFrom: process.env.BET_PAGINATION_TEST_FROM, dateTo: process.env.BET_PAGINATION_TEST_TO }
  const ctx = { tenant, whitelabel: { id: tenant }, user: { sub: 'read-only-pagination-test', roles: [] }, permissions: [{ domain: 'all', actions: ['*'] }] }
  let expected: BetPageKey[]
  let source: { tenant: string; whitelabelId: string; dateFrom?: string; dateTo?: string }
  before(async () => {
    // Set before opening any pooled connection; enforce read-only at the database boundary.
    ;(pool as any).options.options += ' -c default_transaction_read_only=on'
    const tz = await getWhitelabelTimezone(tenant!)
    const from = filters.dateFrom ? parseDateFrom(filters.dateFrom, tz).toISOString() : undefined
    const to = filters.dateTo ? parseDateTo(filters.dateTo, tz).toISOString() : undefined
    source = { tenant: tenant!, whitelabelId: tenant!, dateFrom: from, dateTo: to }
    // Independent reference: no production page builder, limit or merge-size cap.
    const result = await pool.query<BetPageKey>(`
      SELECT domain, id FROM (
        SELECT 'SPORTS' AS domain, id, created_at FROM sports_bets
        WHERE tenant=$1 AND whitelabel_id=$1
          AND (exclude_from_admin_running=false OR status NOT IN ('matched','unmatched'))
        UNION ALL
        SELECT 'CASINO' AS domain, id, created_at FROM casino_bets
        WHERE tenant=$1 AND whitelabel_id=$1
          AND (exclude_from_admin_running=false OR status NOT IN ('pending','active'))
        UNION ALL
        SELECT 'MATKA' AS domain, id, created_at FROM matka_bets WHERE tenant=$1 AND whitelabel_id=$1
      ) bets WHERE ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz)
      ORDER BY created_at DESC, id DESC, domain ASC
    `, [tenant, from ?? null, to ?? null])
    expected = result.rows
    assert.ok(expected.length > 0, 'Select a fixture tenant/date range containing bets')
  })
  after(async () => { await pool.end() })
  const keyFilters = () => ({ sports: { ...source, omitOpenAdminToolBets: true }, casino: { ...source, omitOpenAdminToolBets: true }, matka: source })

  it('returns exact ordered windows at deep offsets for every supported page size', async () => {
    for (const limit of [20, 50, 100, 500]) {
      for (const offset of new Set([0, 5000, 10000, 24650, 100050, Math.floor((expected.length - 1) / limit) * limit, expected.length])) {
        assert.deepEqual(await getBetPageKeys(keyFilters(), offset, limit), expected.slice(offset, offset + limit), `offset=${offset}, limit=${limit}`)
      }
    }
  })

  it('exports all 500-row windows without gaps, duplicates or the old 5000-row cap', async () => {
    const actual: BetPageKey[] = []
    for (let offset = 0; offset < expected.length; offset += 500) actual.push(...await getBetPageKeys(keyFilters(), offset, 500))
    assert.deepEqual(actual, expected)
  })

  it('hydrates the last page and reports the same complete total for every domain', async () => {
    for (const domain of ['ALL', 'SPORTS', 'CASINO', 'MATKA'] as const) {
      const reference = expected.filter(key => domain === 'ALL' || key.domain === domain)
      const offset = reference.length ? Math.floor((reference.length - 1) / 50) * 50 : 0
      const result = await betsQueryResolvers.betsPage(null, { domain, filters, offset, limit: 50 }, ctx)
      assert.equal(result.total, reference.length)
      const types: Record<string, string> = { SportsBet: 'SPORTS', CasinoBet: 'CASINO', MatkaBet: 'MATKA' }
      assert.deepEqual(result.items.map((row: any) => ({ domain: types[row.__typename], id: row.id })), reference.slice(offset, offset + 50))
    }
  })

  it('keeps ALL restricted to the caller’s permitted bet domains', async () => {
    const restrictedCtx = { ...ctx, permissions: [{ domain: 'casino.bets', actions: ['view'] }] }
    const result = await betsQueryResolvers.betsPage(null, { domain: 'ALL', filters, offset: 0, limit: 50 }, restrictedCtx)
    const reference = expected.filter(key => key.domain === 'CASINO')
    assert.equal(result.total, reference.length)
    assert.deepEqual(result.items.map((row: any) => ({ domain: row.__typename === 'CasinoBet' ? 'CASINO' : row.__typename, id: row.id })), reference.slice(0, 50))
  })
})
