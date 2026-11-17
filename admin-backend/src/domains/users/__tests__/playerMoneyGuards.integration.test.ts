/**
 * Money guards on the admin player mutations, through the real resolvers on the isolated QA database
 * (tmp/domain-visibility-integration-fixtures.ts). Every test runs in a transaction that is rolled back, audit
 * rows included, so nothing persists.
 *
 *   - adjustWallet refuses a withdrawal above the available balance (cash less exposure) before any pool credit
 *     is released, and moves pool and wallet together when it is within it (players/PLA-02);
 *   - an id outside the tenant, or a player without a wallet, moves no pool credit in either direction (PLA-04);
 *   - the admin's reason reaches both ledger rows and an audit row naming the admin (PLA-14);
 *   - a zero amount and a missing reason are refused (PLA-20);
 *   - createPlayer's opening balance is a deposit out of the pool with its ledger rows, or the creation is
 *     refused (PLA-03), a blank name is refused (PLA-20) and a username is unique per tenant, ignoring case (PLA-06).
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/users/__tests__/playerMoneyGuards.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { and, asc } from 'drizzle-orm'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { usersMutationResolvers } = await import('../resolvers/mutations.js')
const { createPlayerDb, createCreditPlayerDb } = await import('../../../repos/users/usersRepo.js')
const { closeRedisEmitter } = await import('../../../realtime/redisPubsub.js')
test.before(() => guard(pool))
test.after(async () => { await closeRedisEmitter(); await pool.end() })
test.afterEach(() => mock.restoreAll())

const admin = (tenant: string) => ({ tenant, whitelabel: { id: tenant }, user: { sub: '1', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'all', actions: ['*'] }] })
const adjust = (tenant: string, userId: number, amount: number, reason: string | undefined = 'vfyfix adjustment') =>
  (usersMutationResolvers as any).adjustWallet(null, { userId: String(userId), amount, reason }, admin(tenant))
const create = (tenant: string, input: Record<string, unknown>) =>
  (usersMutationResolvers as any).createPlayer(null, { input: { password: 'vfyfix-Passw0rd', playerType: 'REGULAR', status: 'ACTIVE', currency: 'INR', ...input } }, admin(tenant))
/** The resolvers write their audit rows without awaiting them: let those land on the test transaction first. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

async function poolOf(tx: any, tenant: string) {
  const [w] = await tx.select().from(t.whitelabels).where(eq(t.whitelabels.id, tenant))
  return { used: Number(w.creditUsed), available: Number(w.creditAvailable) }
}
async function walletOf(tx: any, userId: number) {
  const [w] = await tx.select().from(t.wallets).where(eq(t.wallets.userId, userId)).orderBy(asc(t.wallets.id)).limit(1)
  return w
}
const poolRows = (tx: any, tenant: string) => tx.select().from(t.agentCreditLedger).where(eq(t.agentCreditLedger.tenantId, tenant)).orderBy(asc(t.agentCreditLedger.createdAt))

test('adjustWallet: a withdrawal above the available balance releases nothing; within it, pool and wallet move together with the reason recorded', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), player = await f.player()
    await tx.update(t.wallets).set({ cash: '0' }).where(eq(t.wallets.userId, player.id))
    routeDbToTransaction(mock, db, tx)
    const start = await poolOf(tx, f.tenant)

    // From a zero balance: refused, and the pool is not credited with money that never existed.
    await assert.rejects(adjust(f.tenant, player.id, -50), { message: 'Insufficient available balance. Available: 0.00, Requested: 50.00' })
    assert.equal(Number((await walletOf(tx, player.id)).cash), 0)
    assert.deepEqual(await poolOf(tx, f.tenant), start, 'no pool credit was released')
    assert.equal((await poolRows(tx, f.tenant)).length, 0)

    const deposit = await adjust(f.tenant, player.id, 100, 'vfyfix opening deposit')
    assert.equal(deposit.balance, 100)
    assert.equal((await poolOf(tx, f.tenant)).used, start.used + 100)

    // Exposure held against the cash is not available: 100 cash, 30 exposure leaves 70.
    await tx.update(t.wallets).set({ exposure: '30' }).where(eq(t.wallets.userId, player.id))
    await assert.rejects(adjust(f.tenant, player.id, -80), { message: 'Insufficient available balance. Available: 70.00 (Cash: 100.00, Exposure: 30.00), Requested: 80.00' })
    assert.equal((await poolOf(tx, f.tenant)).used, start.used + 100, 'the refused withdrawal released nothing')

    const withdrawal = await adjust(f.tenant, player.id, -70, 'vfyfix chargeback')
    assert.equal(withdrawal.balance, 30)
    assert.equal((await poolOf(tx, f.tenant)).used, start.used + 30)
    assert.deepEqual((await poolRows(tx, f.tenant)).map((r: any) => [r.transactionType, Number(r.amount)]), [['DEPOSIT', 100], ['RELEASE', 70]])

    // The reason the admin typed is on both ledgers and on an audit row that names the admin.
    const wallet = await walletOf(tx, player.id)
    const entries = await tx.select().from(t.ledgerEntries).where(eq(t.ledgerEntries.walletId, wallet.id)).orderBy(asc(t.ledgerEntries.id))
    assert.deepEqual(entries.map((e: any) => [e.type, e.meta.type, e.meta.reason]), [['credit', 'admin_adjustment', 'vfyfix opening deposit'], ['debit', 'admin_adjustment', 'vfyfix chargeback']])
    const statement = await tx.select().from(t.walletLedger).where(eq(t.walletLedger.userId, player.id)).orderBy(asc(t.walletLedger.id))
    assert.deepEqual(statement.map((e: any) => [e.direction, e.category, e.meta.reason]), [['credit', 'admin_adjustment', 'vfyfix opening deposit'], ['debit', 'admin_adjustment', 'vfyfix chargeback']])
    await settle()
    const audits = await tx.select().from(t.auditLogs).where(and(eq(t.auditLogs.tenant, f.tenant), eq(t.auditLogs.resourceId, String(player.id)))).orderBy(asc(t.auditLogs.id))
    assert.deepEqual(audits.map((a: any) => [a.action, a.actorId, a.after.amount, a.after.reason, a.after.balance, a.before.balance]), [
      ['manual_deposit', '1', 100, 'vfyfix opening deposit', 100, 0],
      ['manual_withdrawal', '1', -70, 'vfyfix chargeback', 30, 100],
    ])
    mock.restoreAll()
  })
})

test('adjustWallet: an id outside the tenant, or a player with no wallet, moves no pool credit in either direction', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), other = await fixture(tx)
    const mine = await f.player(), foreign = await other.player()
    routeDbToTransaction(mock, db, tx)
    const start = await poolOf(tx, f.tenant), otherStart = await poolOf(tx, other.tenant)
    for (const amount of [1, -1]) {
      await assert.rejects(adjust(f.tenant, 987654321, amount), { message: 'Player not found' })
      await assert.rejects(adjust(f.tenant, foreign.id, amount), { message: 'Player not found' })
    }
    await tx.delete(t.wallets).where(eq(t.wallets.userId, mine.id))
    for (const amount of [1, -1]) await assert.rejects(adjust(f.tenant, mine.id, amount), { message: 'Wallet not found' })
    assert.deepEqual(await poolOf(tx, f.tenant), start, 'the pool is where it started')
    assert.deepEqual(await poolOf(tx, other.tenant), otherStart)
    assert.equal((await poolRows(tx, f.tenant)).length, 0, 'no pool ledger row survived')
    assert.equal(Number((await walletOf(tx, foreign.id)).cash), 10000, "the other tenant's wallet is untouched")
    mock.restoreAll()
  })
})

test('adjustWallet: a zero amount and a missing reason are refused before anything is written', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), player = await f.player()
    routeDbToTransaction(mock, db, tx)
    await assert.rejects(adjust(f.tenant, player.id, 0), { message: 'Amount must not be zero' })
    const missingReason = (usersMutationResolvers as any).adjustWallet(null, { userId: String(player.id), amount: 10 }, admin(f.tenant))
    await assert.rejects(missingReason, { message: 'A reason is required for a balance adjustment' })
    await assert.rejects(adjust(f.tenant, player.id, 10, '   '), { message: 'A reason is required for a balance adjustment' })
    const wallet = await walletOf(tx, player.id)
    assert.equal((await tx.select().from(t.ledgerEntries).where(eq(t.ledgerEntries.walletId, wallet.id))).length, 0)
    assert.equal(Number(wallet.cash), 10000)
    mock.restoreAll()
  })
})

test("createPlayer: the opening balance is a deposit out of the pool with its ledger rows, or the creation is refused", async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx)
    routeDbToTransaction(mock, db, tx)
    const start = await poolOf(tx, f.tenant)

    const created = await create(f.tenant, { name: 'vfyfix Opening', username: 'vfyfix_open', phone: '7419990001', initialBalance: 25 })
    const id = Number(created.user.id)
    assert.equal(created.message, 'Regular player created successfully')
    assert.equal(Number((await walletOf(tx, id)).cash), 25)
    assert.equal((await poolOf(tx, f.tenant)).used, start.used + 25, 'the opening balance came out of the pool')
    assert.deepEqual((await poolRows(tx, f.tenant)).map((r: any) => [r.transactionType, Number(r.amount), r.reason]), [['DEPOSIT', 25, `Direct wallet deposit for player ${id}`]])
    const wallet = await walletOf(tx, id)
    const entries = await tx.select().from(t.ledgerEntries).where(eq(t.ledgerEntries.walletId, wallet.id))
    // ledger_entries.amount is in the base currency; the wallet's own figure is meta.originalAmount.
    assert.deepEqual(entries.map((e: any) => [e.type, e.meta.originalAmount, e.meta.type, e.meta.reason]), [['credit', 25, 'admin_adjustment', 'Opening balance at player creation']])
    assert.equal((await tx.select().from(t.walletLedger).where(eq(t.walletLedger.userId, id))).length, 1)

    // A player without an opening balance starts at 0 and moves nothing.
    const plain = await create(f.tenant, { name: 'vfyfix Plain', username: 'vfyfix_plain', phone: '7419990002' })
    assert.equal(Number((await walletOf(tx, Number(plain.user.id))).cash), 0)
    assert.equal((await poolOf(tx, f.tenant)).used, start.used + 25)

    // More than the pool holds: refused, and no player is left behind.
    await assert.rejects(create(f.tenant, { name: 'vfyfix Too Much', username: 'vfyfix_toomuch', phone: '7419990003', initialBalance: 1_000_000 }), /Insufficient whitelabel credit/)
    assert.equal((await tx.select().from(t.users).where(and(eq(t.users.tenant, f.tenant), eq(t.users.username, 'vfyfix_toomuch')))).length, 0)
    await assert.rejects(create(f.tenant, { name: 'vfyfix Negative', username: 'vfyfix_negative', phone: '7419990004', initialBalance: -5 }), { message: 'Initial balance must be zero or a positive amount' })
    await assert.rejects(create(f.tenant, { name: '   ', username: 'vfyfix_noname', phone: '7419990005' }), { message: 'Name is required' })
    assert.equal((await poolOf(tx, f.tenant)).used, start.used + 25)
    await settle()
    mock.restoreAll()
  })
})

test('createPlayer: a username is unique per tenant, ignoring case and surrounding spaces, on the admin and the agent path', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), other = await fixture(tx)
    routeDbToTransaction(mock, db, tx)
    await create(f.tenant, { name: 'vfyfix Dup One', username: 'vfyfix_dup', phone: '7419990011' })
    await assert.rejects(create(f.tenant, { name: 'vfyfix Dup Two', username: ' VFYFIX_Dup ', phone: '7419990012' }), { message: 'Username VFYFIX_Dup is already taken' })
    // createPlayerForAgent writes through the same createPlayerDb.
    const agentPathInput = { tenant: f.tenant, name: 'vfyfix Dup Three', phone: '7419990013', email: null, username: 'Vfyfix_DUP', password: 'vfyfix-Passw0rd', status: 'active' as const, bonusAllowed: true, requirePasswordReset: false, sportsVisible: true, sportsBetAllowed: true, casinoVisible: true, casinoBetAllowed: true, matkaVisible: false, matkaBetAllowed: false }
    await assert.rejects(createPlayerDb(agentPathInput, tx), { message: 'Username Vfyfix_DUP is already taken' })
    // The credit-player writer applies the same rule.
    await assert.rejects(createCreditPlayerDb({ tenant: f.tenant, name: 'vfyfix Dup Credit', phone: '7419990015', email: null, username: 'VFYFIX_DUP', playerType: 'WHITELABEL_CREDIT', creditLimit: 0 }, tx), { message: 'Username VFYFIX_DUP is already taken' })
    assert.equal((await tx.select().from(t.users).where(eq(t.users.tenant, f.tenant))).filter((u: any) => String(u.username).toLowerCase() === 'vfyfix_dup').length, 1)
    // Another tenant may use the same username.
    const elsewhere = await create(other.tenant, { name: 'vfyfix Dup Elsewhere', username: 'vfyfix_dup', phone: '7419990014' })
    assert.equal(elsewhere.success, true)
    await settle()
    mock.restoreAll()
  })
})
