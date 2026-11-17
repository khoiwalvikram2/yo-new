/**
 * A deposit proof is a base64 screenshot in deposit_requests.proof_data (owner decision 2026-11-04: S3 is gone).
 * - createDepositRequest stores a screenshot data URI in proof_data with proof_key 'inline', as the player app's
 *   requests are (user-backend depositProof.ts), and keeps 'manual' / 'proof-missing' as sentinels.
 * - It refuses an S3 key, a link, a non-image and a screenshot past 2 MB before anything is read or written.
 * - The screenshot is written by the request's own insert (round 2, H103): it used to follow in a second UPDATE once
 *   the insert had committed, so a failed UPDATE left a PENDING 'inline' request with no screenshot and a retry
 *   duplicated it.
 * - adminDepositRequests says hasProof and carries no screenshot (proofUrl is null); depositRequestProof answers it.
 *   A legacy S3 key or a sentinel has none.
 *
 * Against the isolated Matka QA database, inside a transaction that is rolled back.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/deposits/__tests__/depositProofInline.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { getTableName } from 'drizzle-orm'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { depositsMutationResolvers } = await import('../resolvers/mutations.js')
const { depositsQueryResolvers } = await import('../resolvers/queries.js')
const { seedDefaultVipTiers } = await import('@shared/vip/defaultTiers.js')
test.before(() => guard(pool))
test.after(async () => {
  await pool.end()
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})
test.afterEach(() => mock.restoreAll())

const SCREENSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const ctxFor = (tenant: string, sub: string) => ({
  tenant, whitelabel: { id: tenant }, user: { sub, type: 'admin', roles: [] },
  permissions: [{ domain: 'payments.deposits', actions: ['view'] }],
})
const input = (proofKey: string) => ({
  input: { accountId: 'bank-public', amount: 500, currency: 'INR', method: 'BANK_TRANSFER', referenceId: 'vfyog-ref', proofKey },
})

/** A whitelabel whose VIP program runs and which takes bank deposits, and one of its players. */
async function depositingPlayer(tx: any) {
  const f = await fixture(tx)
  await tx.update(t.whitelabels).set({ vipStartedAt: new Date(Date.now() - 60_000) }).where(eq(t.whitelabels.id, f.tenant))
  await seedDefaultVipTiers(tx, f.tenant)
  await tx.insert(t.whitelabelPaymentMethods).values({
    tenant: f.tenant, enabledMethods: ['BANK_TRANSFER'], limits: { min: 10, max: 500000 }, upiDetails: [],
    bankDetails: [{ id: 'bank-public', enabled: true, accountName: 'Test Only', accountNumber: 'FIXTURE01', ifsc: 'TEST0000001', bankName: 'Fixture Bank', branch: 'Test' }],
  })
  return { f, player: await f.player() }
}

test('a screenshot is stored in proof_data with proof_key inline, and the list says it has one', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const { f, player } = await depositingPlayer(tx)
    const ctx = ctxFor(f.tenant, String(player.id))

    const made = await depositsMutationResolvers.createDepositRequest(null, input(SCREENSHOT), ctx)
    assert.equal(made.success, true)
    assert.equal(made.depositRequest.proofKey, 'inline')
    assert.equal(made.depositRequest.hasProof, true)
    assert.equal(made.depositRequest.proofUrl, null, 'the payload does not echo the screenshot')
    const [row] = await tx.select().from(t.depositRequests).where(eq(t.depositRequests.id, Number(made.depositRequest.id)))
    assert.equal(row.proofKey, 'inline')
    assert.equal(row.proofData, SCREENSHOT)

    const manual = await depositsMutationResolvers.createDepositRequest(null, input('manual'), ctx)
    const [manualRow] = await tx.select().from(t.depositRequests).where(eq(t.depositRequests.id, Number(manual.depositRequest.id)))
    assert.deepEqual([manualRow.proofKey, manualRow.proofData], ['manual', null])

    // A request from before the change still names its S3 key, which nothing can fetch.
    const [legacy] = await tx.insert(t.depositRequests).values({
      tenant: f.tenant, userId: player.id, amount: '100', method: 'BANK_TRANSFER', proofKey: 'deposits/1772039387176-a3333bb383159b53.jpg',
    }).returning()

    const listed = await depositsQueryResolvers.adminDepositRequests(null, { input: {} }, ctx)
    const listedAs = (id: number | string) => listed.items.find((item: any) => item.id === String(id))
    assert.deepEqual([listedAs(made.depositRequest.id)?.hasProof, listedAs(made.depositRequest.id)?.proofUrl], [true, null])
    assert.deepEqual([listedAs(manual.depositRequest.id)?.hasProof, listedAs(manual.depositRequest.id)?.proofUrl], [false, null])
    assert.deepEqual([listedAs(legacy.id)?.hasProof, listedAs(legacy.id)?.proofUrl], [false, null])
    assert.equal(listedAs(legacy.id)?.proofKey, 'deposits/1772039387176-a3333bb383159b53.jpg')

    // The screenshot itself is read for one request, when a reviewer opens it.
    const proofOf = (id: number | string) => depositsQueryResolvers.depositRequestProof(null, { id: String(id) }, ctx)
    assert.equal(await proofOf(made.depositRequest.id), SCREENSHOT)
    assert.equal(await proofOf(manual.depositRequest.id), null)
    assert.equal(await proofOf(legacy.id), null)
  })
})

test('the screenshot is written by the request\'s own insert, so a failed UPDATE can no longer strand it', async () => {
  await rollback(db, async tx => {
    // routeDbToTransaction, except that an UPDATE of deposit_requests fails, as a dropped connection would. The
    // second UPDATE the screenshot used to need would fail here after its request had been committed.
    let depositUpdates = 0
    for (const method of ['select', 'insert', 'delete', 'execute', 'transaction']) mock.method(db, method as never, (tx as any)[method].bind(tx))
    for (const key of Object.keys(db.query)) for (const method of ['findFirst', 'findMany']) {
      mock.method((db.query as any)[key], method, (tx as any).query[key][method].bind((tx as any).query[key]))
    }
    mock.method(db, 'update', (table: any) => {
      if (getTableName(table) === 'deposit_requests') {
        depositUpdates++
        throw new Error('vfyog2: the UPDATE of deposit_requests failed')
      }
      return tx.update(table)
    })
    const { f, player } = await depositingPlayer(tx)

    const made = await depositsMutationResolvers.createDepositRequest(null, input(SCREENSHOT), ctxFor(f.tenant, String(player.id)))
    assert.equal(made.success, true)
    assert.equal(depositUpdates, 0, 'the screenshot was written by an UPDATE after the insert')
    const rows = await tx.select().from(t.depositRequests).where(eq(t.depositRequests.userId, player.id))
    assert.equal(rows.length, 1, 'one request, made once')
    assert.deepEqual([rows[0].proofKey, rows[0].proofData, rows[0].status], ['inline', SCREENSHOT, 'PENDING'])
  })
})

test('an S3 key, a link, a non-image or a screenshot past 2 MB is refused before anything is read', async () => {
  const ctx = ctxFor('vfyog-no-such-brand', '987654321')
  const tooLarge = `data:image/jpeg;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`
  for (const [proofKey, message] of [
    ['deposits/1772039387176-a3333bb383159b53.jpg', "Payment proof must be a screenshot image, 'manual' or 'proof-missing'"],
    ['https://cdn.example.com/proof.png', "Payment proof must be a screenshot image, 'manual' or 'proof-missing'"],
    ['inline', "Payment proof must be a screenshot image, 'manual' or 'proof-missing'"],
    ['data:application/pdf;base64,JVBERi0=', 'Payment proof must be an image file'],
    [tooLarge, 'Payment proof is too large (2.1 MB); the limit is 2 MB'],
  ]) {
    await assert.rejects(depositsMutationResolvers.createDepositRequest(null, input(proofKey), ctx), { message }, proofKey.slice(0, 40))
  }
})
