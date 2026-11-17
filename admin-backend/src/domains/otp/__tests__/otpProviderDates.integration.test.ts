/**
 * OtpProvider.createdAt and updatedAt are ISO 8601 strings (system/SYS-19 side note). The rows carry Date objects,
 * which the String scalar serialised as epoch milliseconds ("1793645111717"), and /config/otp-providers showed
 * "Updated: Invalid Date". Through the real resolver, on the isolated QA database, inside a transaction that is
 * rolled back (tmp/domain-visibility-integration-fixtures.ts). No provider is called: the row is only read.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/otp/__tests__/otpProviderDates.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { buildSchema, graphql } from 'graphql'
import { isolateDatabase, rollback, routeDbToTransaction, t } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { otpResolvers } = await import('../resolvers/index.js')
const { typeDefs } = await import('../../../types/graphql.js')
test.before(() => guard(pool))
test.after(async () => { await pool.end() })
test.afterEach(() => mock.restoreAll())

test('otpProviders states createdAt and updatedAt as ISO 8601, in the caller tenant only', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const tenant = 'vfyho-otp-' + randomUUID().slice(0, 8), other = 'vfyho-otp-' + randomUUID().slice(0, 8)
    const createdAt = '2026-10-01T10:00:00.000Z', updatedAt = '2026-11-02T18:45:11.717Z'
    await tx.insert(t.otpProviders).values([
      { tenant, provider: 'TWO_FACTOR', active: true, priority: 1, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) },
      { tenant: other, provider: 'MSG91', active: true, priority: 1 },
    ])
    const ctx = { tenant, whitelabel: { id: tenant }, user: { sub: '7', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'config.otp-providers', actions: ['view'] }] }
    const rows = await otpResolvers.Query.otpProviders(null, {}, ctx)
    assert.deepEqual(rows.map((row: any) => [row.provider, row.createdAt, row.updatedAt]), [['TWO_FACTOR', createdAt, updatedAt]])
    // What the page receives through the schema's String scalar: the same strings, which Date parses.
    const result = await graphql({ schema: buildSchema(typeDefs), source: '{ otpProviders { provider createdAt updatedAt } }', rootValue: { otpProviders: () => rows } })
    assert.equal(result.errors, undefined)
    const [served] = (result.data as any).otpProviders
    assert.deepEqual([served.createdAt, served.updatedAt], [createdAt, updatedAt])
    assert.equal(new Date(served.updatedAt).toISOString(), updatedAt, 'parses as a date (it was "1793645111717")')
  })
})
