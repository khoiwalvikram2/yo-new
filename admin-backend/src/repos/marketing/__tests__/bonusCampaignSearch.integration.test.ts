/**
 * DAS-SEARCH-CATEGORIES: the Bonuses page search and global search's Bonuses category find a
 * campaign whatever the case of the name and the search ('wednesday' finds 'WEDNESDAY 10%'); the
 * name was matched with LIKE. Against the isolated Matka QA database, inside a transaction that is
 * rolled back, so nothing is written.
 *   node --env-file-if-exists=.env --test --import tsx src/repos/marketing/__tests__/bonusCampaignSearch.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { listBonusCampaignsDb } = await import('../bonusesRepo.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

test('a campaign name matches the search whatever its case', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), other = await fixture(tx)
    await tx.insert(t.bonusCampaigns).values([
      { tenant: f.tenant, name: 'vfyho WEDNESDAY 10%', type: 'deposit' },
      { tenant: f.tenant, name: 'vfyho Friday cashback', type: 'deposit' },
      { tenant: other.tenant, name: 'vfyho wednesday elsewhere', type: 'deposit' },
    ])
    const names = async (search: string) => (await listBonusCampaignsDb(f.tenant, { search })).map((c: any) => c.name).sort()
    assert.deepEqual(await names('wednesday'), ['vfyho WEDNESDAY 10%'])
    assert.deepEqual(await names('WedNesDay 10'), ['vfyho WEDNESDAY 10%'])
    assert.deepEqual(await names('FRIDAY'), ['vfyho Friday cashback'])
    assert.deepEqual(await names('VFYHO'), ['vfyho Friday cashback', 'vfyho WEDNESDAY 10%'], 'only its own whitelabel')
    assert.deepEqual(await names('monday'), [])
  })
})
