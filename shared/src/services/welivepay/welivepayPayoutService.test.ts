import test from 'node:test'
import assert from 'node:assert/strict'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { ledgerEntries, userPayoutAccounts, users, welivepayPayouts, whitelabelPgSettings, withdrawalRequests } from '../../db/schema.js'
import { WelivepayPayoutService } from './welivepayPayoutService.js'

// A WeLivePay payout is never sent to a deleted payout account: prepare() reads the account with deleted_at IS NULL
// beside its id, tenant and owner (deleting one is already refused while a withdrawal is pending or processing).
// No database and no provider: the transaction is a stand-in that answers each table's read and records its WHERE,
// which is rendered as Postgres SQL; fetch refuses every call.

const TENANT = 'vfyog2-tenant'
const withdrawal = { id: 7, tenant: TENANT, userId: 5, walletId: 9, payoutAccountId: 11, status: 'PENDING', currency: 'INR', amount: '1000', ledgerTxnId: null }
const settings = { tenant: TENANT, payoutEnabled: true, secretSiteKeyEncrypted: 'not-a-real-key', payoutGateway: 'AUTO', minPayout: null, maxPayout: null }
const liveAccount = { id: 11, tenant: TENANT, userId: 5, method: 'BANK', approvalStatus: 'APPROVED', accountNumber: '012345678901', ifscCode: 'SBIN0001234', accountHolderName: 'Test Person', deletedAt: null }

/** A transaction stand-in: each read answers from `rows` by table; every WHERE is kept; any write fails the test. */
function standIn(rows: Map<unknown, unknown[]>) {
  const conditions = new Map<unknown, SQL>()
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        const query = {
          where: (condition: SQL) => (conditions.set(table, condition), query),
          for: () => query,
          limit: async () => rows.get(table) ?? [],
        }
        return query
      },
    }),
    insert: () => { throw new Error('nothing may be written') },
    update: () => { throw new Error('nothing may be written') },
  }
  return { db: { transaction: async (run: (tx: unknown) => unknown) => run(tx) }, conditions }
}

const reads = (account: unknown[]) => new Map<unknown, unknown[]>([
  [withdrawalRequests, [withdrawal]],
  [welivepayPayouts, []],
  [whitelabelPgSettings, [settings]],
  [userPayoutAccounts, account],
  [users, [{ id: 5, tenant: TENANT, phone: '9876543210' }]],
  [ledgerEntries, []],
])

test('the payout account is read with deleted_at IS NULL, beside its id, tenant and owner', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('the provider must not be called') })
  const { db, conditions } = standIn(reads([]))
  // The database finds no live account (a deleted one is filtered out), so nothing is reserved or sent.
  await assert.rejects(new WelivepayPayoutService(db, 'https://welivepay.invalid').submit(7, TENANT, 1), { message: 'An approved bank account is required for WeLivePay IMPS payout' })
  const where = new PgDialect().sqlToQuery(conditions.get(userPayoutAccounts)!)
  assert.match(where.sql, /"user_payout_accounts"\."id" = \$1/)
  assert.match(where.sql, /"user_payout_accounts"\."tenant" = \$2/)
  assert.match(where.sql, /"user_payout_accounts"\."user_id" = \$3/)
  assert.match(where.sql, /"user_payout_accounts"\."deleted_at" is null/)
  assert.deepEqual(where.params, [11, TENANT, 5])
})

test('a live approved bank account still passes the account check', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('the provider must not be called') })
  const { db } = standIn(reads([liveAccount]))
  // The next check is the reservation, which this stand-in withdrawal lacks: the account was accepted.
  await assert.rejects(new WelivepayPayoutService(db, 'https://welivepay.invalid').submit(7, TENANT, 1), { message: 'Withdrawal funds have not been reserved' })
})
