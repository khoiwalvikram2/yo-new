/**
 * A payout account the player deleted, as the admin side sees it (FIN-05, owner 2026-11-04).
 *
 * The player's delete is a soft delete: the row keeps its details and gets deleted_at, so it still counts toward the
 * "first two accounts are approved without review" rule. Everywhere accounts are reviewed or counted (Payout Account
 * Approvals, its cards, the dashboard's pending figure and drill-down) a deleted account is left out, and it can be
 * neither approved nor rejected. A withdrawal still shows its own account, marked deleted, and is never paid to one.
 *
 * On an isolated vfyog tenant in the main database, removed in after(). Read paths and refused writes only: nothing
 * here writes an audit row.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/payments/__tests__/payoutAccountSoftDelete.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { appConfigs, userPayoutAccounts, users, wallets, whitelabels, withdrawalRequests } from '@shared/db/schema.js'
import { paymentsQueryResolvers } from '../resolvers/queries.js'
import { paymentsMutationResolvers } from '../resolvers/mutations.js'
import { applyWithdrawalStatusAdmin } from '@/repos/payments/withdrawalRequestsRepo.js'
import { getDashboardOperations } from '@src/services/dashboardOperationsService.js'
import { getDashboardDrilldown } from '@src/services/dashboardDrilldownService.js'

const tenant = `vfyog-payout-${randomUUID().slice(0, 12)}`
const ctx = { tenant, permissions: [{ domain: 'payments.withdrawals', actions: ['view', 'approve', 'reject'] }], user: { type: 'admin', roles: ['Admin'] } }

let playerId = 0
let walletId = 0
const ids: Record<'live' | 'deletedPending' | 'deletedApproved', number> = { live: 0, deletedPending: 0, deletedApproved: 0 }
let withdrawalId = 0

async function account(accountNumber: string, approvalStatus: 'PENDING' | 'APPROVED', deleted: boolean) {
  const [row] = await db.insert(userPayoutAccounts).values({ tenant, userId: playerId, method: 'BANK', accountNumber, ifscCode: 'SBIN0000001',
    bankName: 'vfyog Bank', accountHolderName: 'vfyog Holder', approvalStatus, deletedAt: deleted ? new Date() : null }).returning()
  return row.id
}

before(async () => {
  await db.insert(whitelabels).values({ id: tenant, name: 'vfyog payout soft delete', domain: `${tenant}.invalid`, creditLimit: '100000', creditAvailable: '100000' })
  await db.insert(appConfigs).values({ whitelabelId: tenant, timeZone: 'Asia/Kolkata' })
  const [player] = await db.insert(users).values({ tenant, name: 'vfyog Player', username: `vfyog-${randomUUID().slice(0, 8)}`, phone: '9800000001',
    passwordHash: 'test-not-login', playerType: 'REGULAR' }).returning()
  playerId = player.id
  const [wallet] = await db.insert(wallets).values({ tenant, userId: player.id, currency: 'INR', cash: '5000' }).returning()
  walletId = wallet.id
  ids.live = await account('555111000001', 'PENDING', false)
  ids.deletedPending = await account('555111000002', 'PENDING', true)
  ids.deletedApproved = await account('555111000003', 'APPROVED', true)
  // A request to an account deleted since (the player can no longer delete one while a request is live; older data can).
  const [request] = await db.insert(withdrawalRequests).values({ tenant, userId: playerId, walletId, payoutAccountId: ids.deletedApproved,
    amount: '100', currency: 'INR', status: 'PENDING' }).returning()
  withdrawalId = request.id
})

after(async () => {
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM withdrawal_requests WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM user_payout_accounts WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM wallets WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM users WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM app_configs WHERE whitelabel_id=${tenant}`)
    await tx.execute(sql`DELETE FROM whitelabels WHERE id=${tenant}`)
  })
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('a payout account the player deleted', () => {
  it('is left out of Payout Account Approvals and its cards', async () => {
    const list = await paymentsQueryResolvers.adminPayoutAccounts(null, { input: {} }, ctx)
    assert.deepEqual(list.items.map((item: any) => Number(item.id)), [ids.live])
    assert.equal(list.total, 1)
    const pending = await paymentsQueryResolvers.adminPayoutAccounts(null, { input: { status: 'PENDING' } }, ctx)
    assert.deepEqual(pending.items.map((item: any) => Number(item.id)), [ids.live])
    const stats = await paymentsQueryResolvers.adminPayoutAccountStats(null, null, ctx)
    assert.deepEqual([stats.total, stats.pending, stats.approved], [1, 1, 0])
  })

  it('can be neither approved nor rejected', async () => {
    const approved = await paymentsMutationResolvers.approvePayoutAccount(null, { input: { id: String(ids.deletedPending) } }, ctx)
    assert.deepEqual([approved.success, approved.message], [false, 'Payout account not found'])
    const rejected = await paymentsMutationResolvers.rejectPayoutAccount(null, { input: { id: String(ids.deletedPending), reason: 'vfyog' } }, ctx)
    assert.deepEqual([rejected.success, rejected.message], [false, 'Payout account not found'])
    const [row] = await db.select().from(userPayoutAccounts).where(eq(userPayoutAccounts.id, ids.deletedPending))
    assert.deepEqual([row.approvalStatus, row.approvedAt], ['PENDING', null], 'nothing was written')
  })

  it('still shows on its withdrawal, marked deleted', async () => {
    const page = await paymentsQueryResolvers.adminWithdrawalRequests(null, { input: { id: String(withdrawalId) } }, ctx)
    const shown = page.items[0]?.account
    assert.equal(shown?.id, String(ids.deletedApproved))
    assert.equal(shown?.accountNumber, '555111000003')
    assert.match(String(shown?.deletedAt), /^\d{4}-\d{2}-\d{2}T/)
    const pendingList = await getDashboardDrilldown({ tenant }, { kind: 'pending_withdrawals', limit: 50, offset: 0 })
    const payTo = pendingList.columns.findIndex((column) => column.key === 'account')
    assert.match(String(pendingList.rows[0]?.cells[payTo]), / · Deleted$/)
  })

  it('is never paid to (a refund by cancelling is not checked, as before)', async () => {
    const [walletBefore] = await db.select().from(wallets).where(eq(wallets.id, walletId))
    for (const status of ['PROCESSING', 'COMPLETED']) {
      await assert.rejects(applyWithdrawalStatusAdmin(withdrawalId, tenant, status, undefined, 'vfyog'), /payout account was deleted by the player/)
    }
    const [row] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawalId))
    assert.equal(row.status, 'PENDING', 'a refused payout writes nothing')
    const [walletAfter] = await db.select().from(wallets).where(eq(wallets.id, walletId))
    assert.equal(walletAfter.cash, walletBefore.cash)
  })

  it('is left out of the dashboard pending figure and its drill-down', async () => {
    const operations = await getDashboardOperations({ tenant }, {})
    assert.equal(operations.pendingPayoutAccounts, 1)
    const drill = await getDashboardDrilldown({ tenant }, { kind: 'pending_payout_accounts', limit: 50, offset: 0 })
    assert.deepEqual(drill.rows.map((r) => Number(r.id)), [ids.live])
    assert.equal(drill.total, 1)
  })
})
