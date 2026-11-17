/**
 * Payout accounts and withdrawals racing each other (finance/FIN-05 review follow-ups).
 *
 * A withdrawal stores only its payout account's id, and the admin pays that account as it is at payout. So the
 * account a withdrawal points at must stay a reviewed destination, also when the player edits or deletes it at the
 * moment a withdrawal is being created:
 *   - a withdrawal created while an edit of its account is in progress waits for the edit, then sees the account
 *     back in review and is refused, with nothing debited;
 *   - an edit or a delete started while a withdrawal to the account is being stored waits for it, then sees it and
 *     is refused;
 *   - a withdrawal created while a (soft) delete of its account is in progress waits for it, then finds no account;
 *   - parallel new accounts cannot each count fewer than two accounts and all be approved without review, and the
 *     accounts deleted meanwhile still count (owner 2026-11-04).
 *
 * The interleaving is forced, not left to timing: a separate connection holds the account row the way the other
 * side does, the test waits until the call under test is blocked by that connection, and only then commits. Two
 * connections must see each other's commits, so the fixture rows are committed on the isolated QA database under
 * a vfyho- tenant and deleted in after(). Nothing here writes an audit row.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/payoutAccountRace.integration.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and } from 'drizzle-orm'
import { isolateDatabase, t, eq } from '../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../db/client.js')
const { createOrUpdatePayoutAccount, createWithdrawalRequest, deletePayoutAccount } = await import('./userAppRepo.js')

const tenant = 'vfyho-' + randomUUID().slice(0, 12)
const details = { method: 'BANK' as const, accountNumber: '555000222', ifscCode: 'SBIN0000002', bankName: 'vfyho Bank', accountHolderName: 'vfyho Holder' }
const NOT_APPROVED = 'This account is not yet approved for withdrawals. Please wait for admin approval.'
let playerId = 0

async function newPlayer(): Promise<number> {
  const [player] = await db.insert(t.users).values({ tenant, name: 'vfyho payout race', phone: '0000000000', passwordHash: 'not-a-real-login', playerType: 'REGULAR', status: 'active' }).returning()
  await db.insert(t.wallets).values({ tenant, userId: player.id, cash: '10000', currency: 'INR' })
  return player.id
}
async function approvedAccount(userId: number) {
  const [row] = await db.insert(t.userPayoutAccounts).values({ tenant, userId, ...details, approvalStatus: 'APPROVED', approvedBy: userId, approvedAt: new Date() }).returning()
  return row
}
const accountRow = async (id: number) => (await db.select().from(t.userPayoutAccounts).where(eq(t.userPayoutAccounts.id, id)))[0]
const withdrawalsTo = (accountId: number) => db.select().from(t.withdrawalRequests).where(eq(t.withdrawalRequests.payoutAccountId, accountId))
const cash = async (userId: number) => Number((await db.select().from(t.wallets).where(eq(t.wallets.userId, userId)))[0].cash)

test.before(async () => {
  await guard(pool)
  // Warm connections first: cold ones stagger parallel calls, and a race test then passes on luck.
  await Promise.all(Array.from({ length: 8 }, () => pool.query('SELECT pg_sleep(0.05)')))
  await db.insert(t.whitelabels).values({ id: tenant, name: 'vfyho payout race', domain: tenant + '.invalid', creditLimit: '100000', creditAvailable: '100000' })
  await db.insert(t.appConfigs).values({ whitelabelId: tenant, maintenance: false, baseCurrency: 'INR' })
  playerId = await newPlayer()
})

test.after(async () => {
  try {
    for (const table of ['notifications', 'wallet_ledger', 'withdrawal_requests', 'ledger_entries', 'user_payout_accounts', 'wallets', 'users']) {
      await pool.query(`DELETE FROM ${table} WHERE tenant = $1`, [tenant])
    }
    await pool.query('DELETE FROM app_configs WHERE whitelabel_id = $1', [tenant])
    await pool.query('DELETE FROM whitelabels WHERE id = $1', [tenant])
  } finally {
    await pool.end()
  }
})

async function blockedBy(pid: number): Promise<boolean> {
  for (let i = 0; i < 250; i++) {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])
    if (rows[0].n > 0) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: Error }

/** Opens a transaction on its own connection, runs `hold` in it, starts `call`, waits until `call` is blocked by that
 *  connection, then commits and returns how `call` ended. */
async function whileHeld(hold: (client: any) => Promise<void>, call: () => Promise<unknown>): Promise<Outcome> {
  const client = await pool.connect()
  let outcome: Promise<Outcome> | undefined
  try {
    await client.query('BEGIN')
    await hold(client)
    const { rows: [{ pid }] } = await client.query('SELECT pg_backend_pid() AS pid')
    outcome = call().then((value) => ({ ok: true as const, value }), (error: Error) => ({ ok: false as const, error }))
    const blocked = await blockedBy(pid)
    await client.query('COMMIT')
    assert.ok(blocked, 'the call never waited for the held account row')
    return await outcome
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (outcome) await outcome
    throw error
  } finally {
    client.release()
  }
}

/** The withdrawal's side: its account row held FOR SHARE and its request stored, not yet committed. */
const withdrawalBeingStored = (accountId: number) => async (client: any) => {
  await client.query('SELECT id FROM user_payout_accounts WHERE id = $1 FOR SHARE', [accountId])
  await client.query(`INSERT INTO withdrawal_requests (tenant, user_id, payout_account_id, amount, status, currency) VALUES ($1, $2, $3, 200, 'PENDING', 'INR')`, [tenant, playerId, accountId])
}

test('a withdrawal created while an edit of its account is in progress is refused once the edit lands, with nothing debited', async () => {
  const account = await approvedAccount(playerId)
  const cashBefore = await cash(playerId)
  const outcome = await whileHeld(async (client) => {
    // The edit's side: the account row locked, its destination changed and sent back to review, not yet committed.
    await client.query('SELECT id FROM user_payout_accounts WHERE id = $1 FOR UPDATE', [account.id])
    await client.query(`UPDATE user_payout_accounts SET account_number = '555099990001', approval_status = 'PENDING', approved_by = NULL, approved_at = NULL WHERE id = $1`, [account.id])
  }, () => createWithdrawalRequest({ userId: playerId, tenant, amount: 200, accountId: String(account.id) }))
  assert.equal(outcome.ok, false, 'the withdrawal was accepted to an account whose new destination nobody reviewed')
  assert.equal(!outcome.ok && outcome.error.message, NOT_APPROVED)
  assert.equal((await withdrawalsTo(account.id)).length, 0, 'no request points at the unreviewed destination')
  assert.equal(await cash(playerId), cashBefore, 'nothing was debited')
})

test('an edit started while a withdrawal to the account is being stored waits for it and is refused', async () => {
  const account = await approvedAccount(playerId)
  const outcome = await whileHeld(withdrawalBeingStored(account.id), () =>
    createOrUpdatePayoutAccount({ userId: playerId, tenant, accountId: account.id, ...details, accountNumber: '555099990002' }))
  assert.equal(outcome.ok, false, 'the edit rewrote the destination of a withdrawal still being paid')
  assert.equal(!outcome.ok && outcome.error.message, 'This account has a withdrawal in progress. It can be changed once that withdrawal is completed or cancelled.')
  const after = await accountRow(account.id)
  assert.deepEqual([after.approvalStatus, after.accountNumber], ['APPROVED', details.accountNumber])
})

test('a delete started while a withdrawal to the account is being stored waits for it and is refused', async () => {
  const account = await approvedAccount(playerId)
  const outcome = await whileHeld(withdrawalBeingStored(account.id), () => deletePayoutAccount(account.id, playerId, tenant))
  assert.equal(outcome.ok, false, 'the account of a withdrawal still being paid was deleted')
  assert.equal(!outcome.ok && outcome.error.message, 'This account has a withdrawal in progress. It can be deleted once that withdrawal is completed or cancelled.')
  assert.ok(await accountRow(account.id), 'the account is still there')
  assert.equal((await withdrawalsTo(account.id)).length, 1, 'the withdrawal still points at its account')
})

test('a withdrawal created while a delete of its account is in progress finds the account gone, with nothing debited', async () => {
  const account = await approvedAccount(playerId)
  const cashBefore = await cash(playerId)
  const outcome = await whileHeld(async (client) => {
    // The delete's side: the account row locked and marked deleted (a soft delete), not yet committed.
    await client.query('SELECT id FROM user_payout_accounts WHERE id = $1 FOR UPDATE', [account.id])
    await client.query('UPDATE user_payout_accounts SET deleted_at = now(), is_primary = false WHERE id = $1', [account.id])
  }, () => createWithdrawalRequest({ userId: playerId, tenant, amount: 200, accountId: String(account.id) }))
  assert.equal(outcome.ok, false, 'a withdrawal was accepted to a deleted account')
  assert.equal(!outcome.ok && outcome.error.message, 'Payout account not found')
  assert.equal((await withdrawalsTo(account.id)).length, 0)
  assert.equal(await cash(playerId), cashBefore, 'nothing was debited')
})

test('parallel new accounts: only the first two skip review', async () => {
  const fresh = await newPlayer()
  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
    createOrUpdatePayoutAccount({ userId: fresh, tenant, ...details, accountNumber: `55500033${i}` })))
  assert.deepEqual(outcomes.filter((o) => o.status === 'rejected'), [])
  const rows = await db.select().from(t.userPayoutAccounts).where(and(eq(t.userPayoutAccounts.userId, fresh), eq(t.userPayoutAccounts.tenant, tenant)))
  assert.equal(rows.length, 6)
  assert.equal(rows.filter((r) => r.approvalStatus === 'APPROVED').length, 2, 'more than two accounts were approved without review')
})

test('parallel delete-and-re-add: deleted accounts still count, so none of the new ones skips review', async () => {
  const fresh = await newPlayer()
  const first = await createOrUpdatePayoutAccount({ userId: fresh, tenant, ...details, accountNumber: '555000440' })
  const second = await createOrUpdatePayoutAccount({ userId: fresh, tenant, ...details, accountNumber: '555000441' })
  const outcomes = await Promise.allSettled([
    deletePayoutAccount(first.id, fresh, tenant),
    deletePayoutAccount(second.id, fresh, tenant),
    ...Array.from({ length: 4 }, (_, i) => createOrUpdatePayoutAccount({ userId: fresh, tenant, ...details, accountNumber: `55500045${i}` })),
  ])
  assert.deepEqual(outcomes.filter((o) => o.status === 'rejected'), [])
  const rows = await db.select().from(t.userPayoutAccounts).where(and(eq(t.userPayoutAccounts.userId, fresh), eq(t.userPayoutAccounts.tenant, tenant)))
  assert.equal(rows.length, 6, 'the deleted accounts are kept')
  assert.deepEqual(rows.filter((r) => r.deletedAt != null).map((r) => r.id).sort(), [first.id, second.id].sort())
  assert.equal(rows.filter((r) => r.approvalStatus === 'APPROVED').length, 2, 'only the first two ever added were approved without review')
})
