/**
 * The screenshot of a manual deposit, stored as a base64 data URI (owner 2026-11-04: no S3).
 *
 * createAdminDeposit takes the screenshot as an image data URI in `proofKey` (the argument that carried the S3 key),
 * checks it (depositProof.ts) and stores it in deposit_requests.proof_data, with proof_key 'inline'. Without one,
 * proof_key keeps the server's sentinels: 'manual' with a reference, 'proof-missing' with neither. Anything that is
 * not a PNG, JPEG or WebP data URI of at most 2 MB is refused and nothing is stored; a player can no longer write a
 * sentinel such as 'welivepay' (a gateway deposit) or an S3 key.
 *
 * Runs against the isolated QA database (tmp/domain-visibility-integration-fixtures.ts), inside a transaction that is
 * always rolled back.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/depositProof.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../db/client.js')
const { userAppMutationResolvers } = await import('../domains/userApp/resolvers/mutations.js')
const { listUserDepositHistory } = await import('./userAppRepo.js')
const { seedDefaultVipTiers } = await import('@shared/vip/defaultTiers.js')
test.before(() => guard(pool))
test.after(() => pool.end())
test.afterEach(() => mock.restoreAll())

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(4096, 3)])
const screenshot = `data:image/jpeg;base64,${JPEG.toString('base64')}`

/** A REGULAR player who may deposit to one bank account of a fresh whitelabel. */
async function depositor(tx: any) {
  const f = await fixture(tx)
  await tx.update(t.whitelabels).set({ vipStartedAt: new Date(Date.now() - 60_000) }).where(eq(t.whitelabels.id, f.tenant))
  await seedDefaultVipTiers(tx, f.tenant)
  await tx.insert(t.whitelabelPaymentMethods).values({ tenant: f.tenant, limits: { min: 10, max: 500000 }, upiDetails: [], bankDetails: [
    { id: 'bank-vfyog', enabled: true, accountName: 'vfyog Only', accountNumber: 'VFYOG01', ifsc: 'TEST0000001', bankName: 'vfyog Bank', branch: 'Test' },
  ] })
  const player = await f.player('REGULAR')
  return { tenant: f.tenant, player }
}
const deposit = (ctx: any, args: Record<string, unknown>) =>
  userAppMutationResolvers.createAdminDeposit(null, { accountId: 'bank-vfyog', amount: 1000, type: 'bank', ...args } as any, ctx)
const requests = (tx: any, userId: number) => tx.select().from(t.depositRequests).where(eq(t.depositRequests.userId, userId)).orderBy(t.depositRequests.id)

test('the screenshot is stored inline; without one the server sentinels stand', async () => {
  await rollback(db, async (tx) => {
    const { tenant, player } = await depositor(tx)
    routeDbToTransaction(mock, db, tx)
    const ctx = { auth: { userId: player.id, tenant, requestTenant: tenant } }

    const withProof = await deposit(ctx, { proofKey: screenshot })
    assert.equal(withProof.meta.code, 200)
    await deposit(ctx, { txnRef: ' UTR-vfyog-1 ' })
    await deposit(ctx, {})

    const rows = await requests(tx, player.id)
    assert.deepEqual(rows.map((row: any) => [row.proofKey, row.proofData]), [
      ['inline', screenshot],
      ['manual', null],
      ['proof-missing', null],
    ])
    assert.equal(rows[1].utr, 'UTR-vfyog-1')
    // The history never carries the stored screenshots.
    const history = await listUserDepositHistory({ userId: player.id, tenant })
    assert.equal(history.length, 3)
    assert.ok(history.every((item: any) => !('proofData' in item) && !('proofKey' in item)))
    mock.restoreAll()
  })
})

test('anything but a PNG, JPEG or WebP data URI of at most 2 MB is refused, and nothing is stored', async () => {
  await rollback(db, async (tx) => {
    const { tenant, player } = await depositor(tx)
    routeDbToTransaction(mock, db, tx)
    const ctx = { auth: { userId: player.id, tenant, requestTenant: tenant } }
    const refusals: Array<[string, RegExp]> = [
      ['welivepay', /must be a PNG, JPEG or WebP image/],
      ['deposits/1772039387176-a3333bb383159b53.jpg', /must be a PNG, JPEG or WebP image/],
      [`data:application/pdf;base64,${Buffer.from('%PDF-1.7').toString('base64')}`, /must be a PNG, JPEG or WebP image/],
      [`data:image/jpeg;base64,${Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]).toString('base64')}`, /too large .* The limit is 2 MB/],
    ]
    for (const [proofKey, message] of refusals) {
      await assert.rejects(deposit(ctx, { proofKey, txnRef: 'UTR-vfyog-2' }), message, proofKey.slice(0, 40))
    }
    assert.equal((await requests(tx, player.id)).length, 0)
    mock.restoreAll()
  })
})
