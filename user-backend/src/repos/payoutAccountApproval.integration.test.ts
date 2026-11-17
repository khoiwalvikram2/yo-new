/**
 * A payout account's admin approval covers the destination it was given (finance/FIN-05).
 *
 * Editing an approved account to a different method, number, IFSC, bank or holder sends it back to PENDING (with
 * approved_by / approved_at / rejection_reason cleared), so a withdrawal to it is refused until an admin
 * approves the new details. Re-saving the same details, ignoring case and spaces, keeps the approval. While a
 * withdrawal to the account is still being paid, its destination cannot be changed at all, nor the account deleted.
 *
 * A player's delete is a soft delete (owner 2026-11-04): the account leaves every list and can no longer be used,
 * but it still counts toward the "first two accounts skip review" rule, so delete-and-re-add waits for an admin.
 *
 * Runs against the isolated QA database (tmp/domain-visibility-integration-fixtures.ts), inside a transaction
 * that is always rolled back.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/payoutAccountApproval.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../db/client.js')
const { createOrUpdatePayoutAccount, createWithdrawalRequest, deletePayoutAccount, listPayoutAccounts, setPrimaryPayoutAccount } = await import('./userAppRepo.js')
test.before(() => guard(pool))
test.after(() => pool.end())
test.afterEach(() => mock.restoreAll())

const NOT_APPROVED = 'This account is not yet approved for withdrawals. Please wait for admin approval.'
const details = { method: 'BANK' as const, accountNumber: '555000111', ifscCode: 'SBIN0000001', bankName: 'vfyfix Bank', accountHolderName: 'vfyfix Holder' }

async function approvedAccount(tx: any, tenant: string, userId: number, status: 'APPROVED' | 'REJECTED' = 'APPROVED') {
  const [row] = await tx.insert(t.userPayoutAccounts).values({
    tenant, userId, ...details, isPrimary: true, approvalStatus: status,
    approvedBy: status === 'APPROVED' ? userId : null, approvedAt: status === 'APPROVED' ? new Date() : null,
    rejectionReason: status === 'REJECTED' ? 'vfyfix wrong holder' : null,
  }).returning()
  return row
}
const accountRow = async (tx: any, id: number) => (await tx.select().from(t.userPayoutAccounts).where(eq(t.userPayoutAccounts.id, id)))[0]

test('an approved account edited to a new destination goes back to review, and no withdrawal is paid to it meanwhile', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), player = await f.player('REGULAR')
    const account = await approvedAccount(tx, f.tenant, player.id)
    routeDbToTransaction(mock, db, tx)

    // Same details, other case and spaces: not a change, the approval stays.
    await createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, accountId: account.id, ...details, bankName: ' VFYFIX BANK ', setPrimary: true })
    assert.equal((await accountRow(tx, account.id)).approvalStatus, 'APPROVED')

    await createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, accountId: account.id, ...details, accountNumber: '555077770066', accountHolderName: 'vfyfix Someone Else', setPrimary: true })
    const edited = await accountRow(tx, account.id)
    assert.deepEqual([edited.approvalStatus, edited.approvedBy, edited.approvedAt, edited.accountNumber], ['PENDING', null, null, '555077770066'])

    await assert.rejects(createWithdrawalRequest({ userId: player.id, tenant: f.tenant, amount: 200, accountId: String(account.id) }), { message: NOT_APPROVED })
    assert.equal((await tx.select().from(t.withdrawalRequests).where(eq(t.withdrawalRequests.userId, player.id))).length, 0)
    const [wallet] = await tx.select().from(t.wallets).where(eq(t.wallets.userId, player.id))
    assert.equal(Number(wallet.cash), 10000, 'nothing was debited')
    mock.restoreAll()
  })
})

test('each destination field counts as a change; a rejected account edited is resubmitted for review', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), player = await f.player('REGULAR')
    routeDbToTransaction(mock, db, tx)
    for (const change of [{ method: 'UPI' as const }, { accountNumber: '999' }, { ifscCode: 'HDFC0000002' }, { bankName: 'vfyfix Other Bank' }, { accountHolderName: 'vfyfix Other' }]) {
      const account = await approvedAccount(tx, f.tenant, player.id)
      await createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, accountId: account.id, ...details, ...change })
      assert.equal((await accountRow(tx, account.id)).approvalStatus, 'PENDING', `${Object.keys(change)[0]} sends it back to review`)
      await tx.delete(t.userPayoutAccounts).where(eq(t.userPayoutAccounts.id, account.id))
    }
    const rejected = await approvedAccount(tx, f.tenant, player.id, 'REJECTED')
    await createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, accountId: rejected.id, ...details, accountHolderName: 'vfyfix Right Holder' })
    const resubmitted = await accountRow(tx, rejected.id)
    assert.deepEqual([resubmitted.approvalStatus, resubmitted.rejectionReason], ['PENDING', null])
    mock.restoreAll()
  })
})

test('the destination of an account with a withdrawal still being paid cannot be changed', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), player = await f.player('REGULAR')
    const account = await approvedAccount(tx, f.tenant, player.id)
    routeDbToTransaction(mock, db, tx)
    await createWithdrawalRequest({ userId: player.id, tenant: f.tenant, amount: 200, accountId: String(account.id) })
    await assert.rejects(
      createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, accountId: account.id, ...details, accountNumber: '555088880077' }),
      { message: 'This account has a withdrawal in progress. It can be changed once that withdrawal is completed or cancelled.' },
    )
    const unchanged = await accountRow(tx, account.id)
    assert.deepEqual([unchanged.approvalStatus, unchanged.accountNumber], ['APPROVED', details.accountNumber])
    mock.restoreAll()
  })
})

// Deleting the account used to drop it for good and set the request's payout_account_id to NULL (ON DELETE SET NULL),
// leaving the admin a withdrawal with no destination. Races with a withdrawal: payoutAccountRace.integration.test.ts.
test('an account with a withdrawal still being paid cannot be deleted; once that withdrawal is settled it can', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), player = await f.player('REGULAR')
    const account = await approvedAccount(tx, f.tenant, player.id)
    routeDbToTransaction(mock, db, tx)
    await createWithdrawalRequest({ userId: player.id, tenant: f.tenant, amount: 200, accountId: String(account.id) })
    const refusal = { message: 'This account has a withdrawal in progress. It can be deleted once that withdrawal is completed or cancelled.' }
    for (const status of ['PENDING', 'PROCESSING'] as const) {
      await tx.update(t.withdrawalRequests).set({ status }).where(eq(t.withdrawalRequests.payoutAccountId, account.id))
      await assert.rejects(deletePayoutAccount(account.id, player.id, f.tenant), refusal, status)
      assert.ok(await accountRow(tx, account.id), `kept while ${status}`)
    }
    await tx.update(t.withdrawalRequests).set({ status: 'COMPLETED' }).where(eq(t.withdrawalRequests.payoutAccountId, account.id))
    await deletePayoutAccount(account.id, player.id, f.tenant)
    // A soft delete (owner 2026-11-04): the row stays for the auto-approval count and the withdrawal keeps its account.
    const deleted = await accountRow(tx, account.id)
    assert.ok(deleted.deletedAt instanceof Date, 'deleted once nothing is in flight')
    assert.equal(deleted.isPrimary, false)
    const [paid] = await tx.select().from(t.withdrawalRequests).where(eq(t.withdrawalRequests.userId, player.id))
    assert.equal(paid.payoutAccountId, account.id, 'the settled withdrawal still names its account')
    mock.restoreAll()
  })
})

// FIN-05, owner 2026-11-04: the first two accounts a player ever adds are approved without review, deleted ones included.
test('deleting an account and adding a new destination does not skip review', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), player = await f.player('REGULAR')
    routeDbToTransaction(mock, db, tx)
    const first = await createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, ...details, setPrimary: true })
    const second = await createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, ...details, accountNumber: '555000112' })
    assert.deepEqual([first.approvalStatus, second.approvalStatus], ['APPROVED', 'APPROVED'], 'the first two skip review')

    await deletePayoutAccount(second.id, player.id, f.tenant)
    const third = await createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, ...details, accountNumber: '555000999', accountHolderName: 'vfyfix Someone Else' })
    assert.equal(third.approvalStatus, 'PENDING', 'a new destination after a delete waits for an admin')
    await assert.rejects(createWithdrawalRequest({ userId: player.id, tenant: f.tenant, amount: 200, accountId: String(third.id) }), { message: NOT_APPROVED })

    // Deleting both and adding again still counts the deleted ones.
    await deletePayoutAccount(first.id, player.id, f.tenant)
    await deletePayoutAccount(third.id, player.id, f.tenant)
    const fourth = await createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, ...details, accountNumber: '555000888', setPrimary: true })
    assert.equal(fourth.approvalStatus, 'PENDING')
    mock.restoreAll()
  })
})

test('a deleted account leaves every list and cannot be used, edited or made primary', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), player = await f.player('REGULAR')
    const account = await approvedAccount(tx, f.tenant, player.id)
    const [other] = await tx.insert(t.userPayoutAccounts).values({ tenant: f.tenant, userId: player.id, ...details, accountNumber: '555000333', approvalStatus: 'APPROVED' }).returning()
    routeDbToTransaction(mock, db, tx)
    await deletePayoutAccount(account.id, player.id, f.tenant)
    assert.deepEqual((await listPayoutAccounts(player.id, f.tenant)).map((row) => row.id), [other.id], 'the list hides the deleted account')

    await assert.rejects(createWithdrawalRequest({ userId: player.id, tenant: f.tenant, amount: 200, accountId: String(account.id) }), { message: 'Payout account not found' })
    await assert.rejects(setPrimaryPayoutAccount(account.id, player.id, f.tenant), { message: 'Payout account not found' })
    await assert.rejects(
      createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, accountId: account.id, ...details, accountNumber: '555000444' }),
      { message: 'Payout account not found' },
    )
    const kept = await accountRow(tx, account.id)
    assert.deepEqual([kept.accountNumber, kept.isPrimary], [details.accountNumber, false], 'the deleted row is left as it was')
    // A second delete of the same account changes nothing.
    await deletePayoutAccount(account.id, player.id, f.tenant)
    assert.equal((await accountRow(tx, account.id)).deletedAt?.getTime(), kept.deletedAt?.getTime())
    const [wallet] = await tx.select().from(t.wallets).where(eq(t.wallets.userId, player.id))
    assert.equal(Number(wallet.cash), 10000, 'nothing was debited')
    mock.restoreAll()
  })
})

test('deleting the primary account clears it, so a new primary keeps the one-primary index', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), player = await f.player('REGULAR')
    const primary = await approvedAccount(tx, f.tenant, player.id)
    routeDbToTransaction(mock, db, tx)
    await deletePayoutAccount(primary.id, player.id, f.tenant)
    // Without the cleared flag this insert would break user_payout_accounts_primary_unique.
    const next = await createOrUpdatePayoutAccount({ userId: player.id, tenant: f.tenant, ...details, accountNumber: '555000555', setPrimary: true })
    const rows = await tx.select().from(t.userPayoutAccounts).where(eq(t.userPayoutAccounts.userId, player.id))
    assert.deepEqual(rows.filter((row: any) => row.isPrimary).map((row: any) => row.id), [next.id])
    // The index itself still refuses a second primary.
    await assert.rejects(
      tx.transaction(async (savepoint: any) => savepoint.update(t.userPayoutAccounts).set({ isPrimary: true }).where(eq(t.userPayoutAccounts.id, primary.id))),
      (error: any) => (error?.cause?.code ?? error?.code) === '23505',
    )
    mock.restoreAll()
  })
})
