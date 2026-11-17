/**
 * Deposit lists stay light; a reviewer's proof is read on demand (owner decision 2026-11-04: S3 is gone, so each
 * screenshot is a base64 data URI of up to 2 MB in deposit_requests.proof_data).
 * - adminDepositRequests counts in SQL and reads every column but proof_data. A row says hasProof; proofUrl is null.
 * - hasProof is the SQL twin of depositProofUrl: true exactly when depositRequestProof answers an image or a link.
 * - depositRequestProof(id) answers one request's screenshot, gated and scoped as the list: payments.deposits:view,
 *   no commission agent (nor any agent, who holds no deposit permission), the caller's tenant with director mode;
 *   another tenant's request reads as null, and so does an id that cannot be a request id.
 * - The live feed, getDepositRequestById, approve, reject and both deposit exports never read proof_data.
 *
 * Against the isolated Matka QA database, inside transactions that are rolled back.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/deposits/__tests__/depositProofReads.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { getTableName } from 'drizzle-orm'
import { isolateDatabase, rollback, fixture, t } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { depositsQueryResolvers } = await import('../resolvers/queries.js')
const { depositsSubscriptionResolvers } = await import('../resolvers/subscriptions.js')
const { depositProofUrl } = await import('../resolvers/proofUrl.js')
const repo = await import('../../../repos/deposits/depositRequestsRepo.js')
const { agentDepositsQuery } = await import('../../../repos/reporting/agentExportQueries.js')
const { ExportJobProcessor } = await import('../../reporting/services/ExportJobProcessor.js')
const { deriveAgentPermissions } = await import('../../agents/services/AgentPermissionsService.js')
test.before(() => guard(pool))
test.after(async () => {
  await pool.end()
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})
test.afterEach(() => mock.restoreAll())

const SCREENSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
/** A screenshot of about 2 MB of base64, the size the player app may send. */
const BIG = `data:image/jpeg;base64,${Buffer.alloc(1_500_000, 7).toString('base64')}`

const DEPOSITS_VIEW = [{ domain: 'payments.deposits', actions: ['view'] }]
const admin = (tenant: string, permissions: unknown = DEPOSITS_VIEW) => ({
  tenant, whitelabel: { id: tenant }, user: { sub: '987001', type: 'admin', roles: [] }, permissions,
})

type Read = { table: string; fields: string[] | null }

/**
 * Routes the db client to the test's transaction, as the fixtures' routeDbToTransaction does, and records every
 * select: its table and the fields it names (null for a whole-row select).
 */
function routeRecordingReads(tx: any): Read[] {
  const reads: Read[] = []
  for (const method of ['insert', 'update', 'delete', 'execute', 'transaction']) mock.method(db, method as never, tx[method].bind(tx))
  for (const key of Object.keys(db.query)) for (const method of ['findFirst', 'findMany']) {
    mock.method((db.query as any)[key], method, tx.query[key][method].bind(tx.query[key]))
  }
  mock.method(db, 'select', (fields?: Record<string, unknown>) => {
    const builder = fields ? tx.select(fields) : tx.select()
    const from = builder.from.bind(builder)
    builder.from = (table: any, ...rest: unknown[]) => {
      reads.push({ table: getTableName(table), fields: fields ? Object.keys(fields) : null })
      return from(table, ...rest)
    }
    return builder
  })
  return reads
}

/** Every read of deposit_requests named its fields and left the screenshot out. */
function assertNoScreenshotRead(reads: Read[], when: string) {
  const deposits = reads.filter((r) => r.table === 'deposit_requests')
  assert.ok(deposits.length > 0, `${when}: deposit_requests was not read through db.select`)
  for (const r of deposits) {
    assert.ok(r.fields !== null, `${when}: a whole-row select of deposit_requests`)
    assert.ok(!r.fields.includes('proofData'), `${when}: proof_data was selected`)
  }
}

async function insertRequest(tx: any, tenant: string, userId: number, proofKey: string, proofData: string | null, status = 'PENDING') {
  const [row] = await tx.insert(t.depositRequests).values({
    tenant, userId, amount: '100', method: 'UPI', utr: 'vfyog2-utr', referenceId: 'vfyog2-ref', proofKey, proofData, status,
  }).returning({ id: t.depositRequests.id })
  return Number(row.id)
}

// What proof_key and proof_data can hold, and whether the request has a proof a page can show.
const STORED: Array<[string, string | null]> = [
  ['inline', BIG],
  ['inline', SCREENSHOT],
  ['manual', SCREENSHOT], // an image is shown whatever proof_key says
  ['manual', null],
  ['proof-missing', null],
  ['welivepay', null],
  ['deposits/1772039387176-a3333bb383159b53.jpg', null], // a legacy S3 key
  ['https://cdn.example.com/proofs/p.png', null], // a link
  ['https://gd-bucket-s3.s3.ap-south-1.amazonaws.com/deposits/a.png', null], // a legacy S3 URL
  [SCREENSHOT, null], // a small image held in proof_key itself
  ['inline', ''], // marked inline with nothing stored
  ['inline', 'deposits/old.png'], // proof_data holding a key nothing can fetch
]

test('the list counts in SQL and carries hasProof, never a screenshot; hasProof is exactly depositProofUrl', async () => {
  await rollback(db, async tx => {
    const reads = routeRecordingReads(tx)
    const f = await fixture(tx)
    const player = await f.player()
    const ids: number[] = []
    for (const [proofKey, proofData] of STORED) ids.push(await insertRequest(tx, f.tenant, player.id, proofKey, proofData))
    reads.length = 0

    const page = await depositsQueryResolvers.adminDepositRequests(null, { input: { offset: 0, limit: 5 } }, admin(f.tenant))
    assert.equal(page.total, STORED.length, 'the total is every matching request, counted in SQL')
    assert.equal(page.items.length, 5)
    const deposits = reads.filter((r) => r.table === 'deposit_requests')
    assert.deepEqual(deposits.map((r) => r.fields?.join(',')).filter((f) => f === 'value'), ['value'], 'one count(*)')
    assert.equal(deposits.length, 2, 'a count and one page, no read of every row')
    assertNoScreenshotRead(reads, 'adminDepositRequests')

    const all = await depositsQueryResolvers.adminDepositRequests(null, { input: { offset: 0, limit: 100 } }, admin(f.tenant))
    assert.ok(JSON.stringify(all).length < 40_000, 'a page of requests carries no screenshot')
    const byId = new Map(all.items.map((item: any) => [item.id, item]))
    for (const [i, [proofKey, proofData]] of STORED.entries()) {
      const item: any = byId.get(String(ids[i]))
      const expected = depositProofUrl({ proofKey, proofData })
      const label = `${proofKey.slice(0, 40)} / ${String(proofData).slice(0, 30)}`
      assert.equal(item.proofUrl, null, label)
      assert.equal(item.hasProof, expected !== null, label)
      assert.equal(item.proofKey, proofKey, label)
      // The one request's proof, read when a reviewer opens it: the same answer as the list's flag.
      assert.equal(await depositsQueryResolvers.depositRequestProof(null, { id: String(ids[i]) }, admin(f.tenant)), expected, label)
    }
    assert.equal(byId.get(String(ids[0]))?.hasProof, true)
    assert.equal(await depositsQueryResolvers.depositRequestProof(null, { id: String(ids[0]) }, admin(f.tenant)), BIG)
  })
})

test("depositRequestProof is gated and scoped as the list: another tenant's request, an agent, no permission", async () => {
  await rollback(db, async tx => {
    const reads = routeRecordingReads(tx)
    const a = await fixture(tx)
    const b = await fixture(tx)
    const id = await insertRequest(tx, a.tenant, (await a.player()).id, 'inline', SCREENSHOT)
    const ask = (ctx: unknown, requestId: string = String(id)) => depositsQueryResolvers.depositRequestProof(null, { id: requestId }, ctx)

    assert.equal(await ask(admin(a.tenant)), SCREENSHOT)
    assert.equal(await ask({ whitelabel: { id: a.tenant }, user: { sub: '987001', type: 'admin', roles: [] }, permissions: DEPOSITS_VIEW }), SCREENSHOT, 'the whitelabel names the tenant')
    assert.equal(await ask(admin(b.tenant)), null, "another tenant's request reads as no proof")
    assert.equal(await ask({ whitelabel: { id: b.tenant }, user: { sub: '987001', type: 'admin', roles: [] }, permissions: DEPOSITS_VIEW }), null)

    // A Super Admin reaches a whitelabel through director mode only, as the list does.
    const director = (wl: string, tenant: string) => ({
      tenant, whitelabel: { id: tenant }, user: { sub: '1', type: 'admin', roles: ['Super Admin'] },
      permissions: [{ domain: 'all', actions: ['*'] }], directorMode: 'whitelabel', directorWhitelabelId: wl,
    })
    assert.equal(await ask(director(a.tenant, b.tenant)), SCREENSHOT)
    assert.equal(await ask(director(b.tenant, a.tenant)), null)

    for (const bad of ['abc', '0', '-5', '1.5', '99999999999', `GW-${id}`, '']) assert.equal(await ask(admin(a.tenant), bad), null, `id ${bad}`)

    reads.length = 0
    await assert.rejects(ask(admin(a.tenant, [])), /^Error: Forbidden: insufficient permissions for deposit requests$/)
    await assert.rejects(ask(admin(a.tenant, [{ domain: 'payments.withdrawals', actions: ['view'] }])), /Forbidden/)
    await assert.rejects(ask({ tenant: a.tenant, whitelabel: { id: a.tenant } }), /Forbidden/, 'no session')

    // Agents: a commission agent is refused even when it holds the permission; an agent's derived grants hold none.
    const commission = await a.agent('COMMISSION')
    await assert.rejects(
      ask({ tenant: a.tenant, whitelabel: { id: a.tenant }, user: { sub: commission.id, type: 'agent', agentId: commission.id }, permissions: DEPOSITS_VIEW }),
      /Commission agents cannot access payment requests/,
    )
    const credit = await a.agent('CREDIT')
    await assert.rejects(
      ask({ tenant: a.tenant, whitelabel: { id: a.tenant }, user: { sub: credit.id, type: 'agent', agentId: credit.id }, permissions: deriveAgentPermissions(['sports', 'casino', 'matka'] as never, 'CREDIT') }),
      /Forbidden: insufficient permissions for deposit requests/,
    )
    assert.ok(!reads.some((r) => r.table === 'deposit_requests'), 'a refused caller read no request')

    // Through the guarded Query map the server mounts: an admin gets the proof, a CRM session is refused.
    const { domainResolvers } = await import('@src/domains/index.js')
    const Query = (domainResolvers as any).Query
    const info = { parentType: { name: 'Query' }, fieldName: 'depositRequestProof' }
    assert.equal(await Query.depositRequestProof(undefined, { id: String(id) }, admin(a.tenant), info), SCREENSHOT)
    await assert.rejects(
      async () => Query.depositRequestProof(undefined, { id: String(id) }, { ...admin(a.tenant), crmUser: { id: 'vfyog2-crm' } }, info),
      /admin-panel operation/,
    )
  })
})

test('the live feed, the review paths and both deposit exports never read a screenshot', async () => {
  await rollback(db, async tx => {
    const reads = routeRecordingReads(tx)
    const f = await fixture(tx)
    // A SHARING agent's player: approval refuses a CREDIT agent's, and the agent export lists this agent's players.
    const agent = await f.agent('SHARING')
    const player = await f.player('REGULAR', agent)
    const inline = await insertRequest(tx, f.tenant, player.id, 'inline', BIG)
    const manual = await insertRequest(tx, f.tenant, player.id, 'manual', null)
    const toReject = await insertRequest(tx, f.tenant, player.id, 'inline', SCREENSHOT)
    const other = await fixture(tx)
    reads.length = 0

    // The live feed (depositRequestUpdated): whether there is a proof, from the row, never the image.
    const event = (id: number, proofKey: string, tenant = f.tenant) => depositsSubscriptionResolvers.depositRequestUpdated.resolve({
      depositRequestUpdated: { id, tenant, userId: player.id, amount: '100', currency: 'INR', method: 'UPI', proofKey, status: 'PENDING' },
    })
    const fed: any = await event(inline, 'inline')
    assert.equal(fed.proofUrl, null)
    assert.equal(fed.hasProof, true)
    assert.equal(((await event(manual, 'manual')) as any).hasProof, false)
    assert.equal(((await event(inline, 'inline', other.tenant)) as any).hasProof, false, "another tenant's row is not this request")
    assert.ok(JSON.stringify(fed).length < 2_000)

    const byId = await repo.getDepositRequestById(inline, f.tenant)
    assert.equal(byId?.hasProof, true)
    assert.ok(byId && !('proofData' in byId), 'getDepositRequestById carried the screenshot')

    const rejected = await repo.rejectDepositRequest(toReject, f.tenant, 987001, 'vfyog2 reject')
    assert.deepEqual([rejected.status, rejected.hasProof, 'proofData' in rejected], ['REJECTED', true, false])

    const approved = await repo.approveDepositRequest(inline, f.tenant, 987001, 'vfyog2 approve')
    assert.deepEqual([approved.status, approved.hasProof, 'proofData' in approved], ['APPROVED', true, false])
    assertNoScreenshotRead(reads.filter((r) => r.table === 'deposit_requests'), 'the feed, getDepositRequestById and approval')

    // The admin deposits export (listDepositRequests, up to 10,000 rows) and an agent's (agentDepositsQuery).
    reads.length = 0
    const exported = await (new ExportJobProcessor() as any).fetchExportData('DEPOSITS', {}, { tenant: f.tenant, whitelabelId: f.tenant }, undefined)
    assert.equal(exported.length, 3)
    assert.ok(JSON.stringify(exported).length < 10_000, 'the export rows carry no screenshot')
    assertNoScreenshotRead(reads, 'the admin deposits export')

    reads.length = 0
    const agentRows = await agentDepositsQuery({ agentId: agent.id, tenant: f.tenant, whitelabelId: f.tenant }, {})
    assert.deepEqual(agentRows.map((r: any) => Number(r.id)).sort((x: number, y: number) => x - y), [inline, manual, toReject].sort((x, y) => x - y))
    assert.ok(agentRows.every((r: any) => !('proofData' in r)), "an agent's deposit export carried the screenshots")
    assertNoScreenshotRead(reads, "an agent's deposits export")
  })
})
