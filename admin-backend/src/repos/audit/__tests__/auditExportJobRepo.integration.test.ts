/**
 * The audit export job statements never read the stored file. Since S3 went (owner decision 2026-11-04) file_data
 * holds each finished export as a data URI of up to 40 MB, and the Export Jobs list polls every 5 s for up to 100
 * jobs: a select of every column read each listed job's file into memory only to drop it. The list, the by-id read
 * and the returning() of the insert and the update name their columns; auditExportJobDownload alone reads file_data,
 * for the one job it hands out.
 *
 * Against the isolated Matka QA database, inside a transaction that is rolled back. Every statement sent to Postgres
 * is read back from the pg client.
 *   node --env-file-if-exists=.env --test --import tsx src/repos/audit/__tests__/auditExportJobRepo.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const repo = await import('../auditExportJobRepo.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

const CREATOR = 914_201
const FILE = `data:text/csv;base64,${Buffer.from('id,tenant\n1,vfyog2').toString('base64')}`
const ROW_KEYS = ['completedAt', 'createdAt', 'createdBy', 'errorMessage', 'exportFormat', 'fileUrl', 'filtersJson', 'id', 'scheduledAt', 'status', 'tenant', 'whitelabelId']

/** What a statement reads back: a select's column list, or what an insert or update returns. */
function columnsRead(text: string): string {
  const select = /^select (.*?) from /is.exec(text)
  if (select) return select[1]
  return / returning (.*)$/is.exec(text)?.[1] ?? ''
}

/** The text of every statement the pg client sends while `run` runs. */
async function statementsOf(run: () => Promise<void>): Promise<string[]> {
  const sent: string[] = []
  const send = pg.Client.prototype.query as (...args: any[]) => any
  const spy = mock.method(pg.Client.prototype, 'query', function (this: unknown, ...args: any[]) {
    sent.push(typeof args[0] === 'string' ? args[0] : String(args[0]?.text ?? ''))
    return send.apply(this, args)
  })
  try {
    await run()
  } finally {
    spy.mock.restore()
  }
  return sent
}

test('the list, the by-id read, the insert and the update never read file_data; the file stays in its row', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    const [done] = await tx.insert(t.auditExportJobs).values({
      tenant: f.tenant, whitelabelId: f.tenant, createdBy: CREATOR, filtersJson: { domain: 'vfyog2' }, exportFormat: 'CSV',
      status: 'completed', fileUrl: 'audit-vfyog2.csv', fileData: FILE, completedAt: new Date(),
    }).returning()

    const rows: Record<string, unknown>[] = []
    const sent = await statementsOf(async () => {
      const page = await repo.getAuditExportJobsPage({ tenant: f.tenant, whitelabelId: f.tenant, createdBy: CREATOR, limit: 100 })
      assert.equal(page.total, 1)
      assert.deepEqual(page.items.map(job => [job.id, job.status, job.fileUrl]), [[done.id, 'completed', 'audit-vfyog2.csv']])
      assert.deepEqual((await repo.getAuditExportJobs({ tenant: f.tenant, createdBy: CREATOR })).map(job => job.id), [done.id])

      const one = await repo.getAuditExportJobById(done.id, f.tenant)
      assert.equal(one?.fileUrl, 'audit-vfyog2.csv')
      assert.deepEqual(one?.filtersJson, { domain: 'vfyog2' })
      assert.equal(await repo.getAuditExportJobById(done.id, 'vfyog2-other-tenant'), null)

      const created = await repo.createAuditExportJob({ tenant: f.tenant, whitelabelId: f.tenant, createdBy: CREATOR, filtersJson: {}, exportFormat: 'JSON' })
      assert.equal(created.status, 'pending')
      const failed = await repo.updateAuditExportJob({ id: created.id, tenant: f.tenant, status: 'failed', errorMessage: 'vfyog2 failure' })
      assert.deepEqual([failed.status, failed.errorMessage, failed.fileUrl], ['failed', 'vfyog2 failure', null])
      rows.push(page.items[0], one!, created, failed)
    })

    // Each statement names the columns it reads back (the two list counts read none), and file_data is never one.
    // (The insert still lists file_data among the columns it writes, as default.)
    assert.equal(sent.length, 8, sent.join('\n'))
    for (const text of sent) assert.doesNotMatch(columnsRead(text), /file_data/, text)
    assert.equal(sent.filter(text => /"file_url"/.test(columnsRead(text))).length, 6, 'every statement but the counts lists its columns')
    // The callers still get every field of AuditExportJobRow, and nothing else.
    for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ROW_KEYS)

    // The file itself is untouched, for auditExportJobDownload to read.
    const [stored] = await tx.select({ fileData: t.auditExportJobs.fileData }).from(t.auditExportJobs).where(eq(t.auditExportJobs.id, done.id))
    assert.equal(stored.fileData, FILE)
  })
})
