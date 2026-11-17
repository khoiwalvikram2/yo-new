/**
 * Export files live in their job rows (owner decision 2026-11-04: Amazon S3 is gone).
 *  - ExportJobProcessor and processAuditExportJob store the file as a data URI in file_data, with its real mime
 *    type, and its bare name in file_url; neither imports anything from S3.
 *  - exportJobDownloadUrl and auditExportJobDownload hand out that data URI and still refuse another tenant,
 *    another whitelabel and another creator; a job uploaded to S3 before the change is refused by name.
 *  - A file over 40 MB of base64 fails its job with its size.
 *  - The job lists carry the file name, never the file.
 *
 * Against the isolated Matka QA database, inside a transaction that is rolled back.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/exportFilesInDatabase.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { ExportJobProcessor } = await import('../services/ExportJobProcessor.js')
const { reportingQueryResolvers } = await import('../resolvers/queries.js')
const { processAuditExportJob } = await import('../../audit/services/AuditExportJobProcessor.js')
const { auditQueryResolvers } = await import('../../audit/resolvers/queries.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

const CREATOR = 914_204
const PREDATES = 'This export was made before files moved into the database; run it again'
const decode = (uri: string) => Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').toString('utf-8')

/** A reporting admin of `tenant` (its whitelabel too), signed in as `sub`. */
const reportingCtx = (tenant: string, sub = String(CREATOR), whitelabelId = tenant) => ({
  tenant, whitelabelId, whitelabel: { id: whitelabelId },
  user: { sub, type: 'admin', roles: [] },
  permissions: [{ domain: 'reporting.exports', actions: ['view'] }],
})
const auditCtx = (tenant: string, sub = String(CREATOR), whitelabelId = tenant) => ({
  tenant, whitelabel: { id: whitelabelId },
  user: { sub, type: 'admin', roles: [] },
  permissions: [{ domain: 'audit.events', actions: ['view'] }],
})

test('both processors import nothing from S3', () => {
  for (const file of ['domains/reporting/services/ExportJobProcessor.ts', 'domains/audit/services/AuditExportJobProcessor.ts']) {
    const src = readFileSync(join('src', file), 'utf8')
    assert.doesNotMatch(src, /storage\/s3|uploadToS3|@aws-sdk/, file)
    assert.match(src, /exportFileDataUri\(/, `${file} stores a data URI`)
  }
})

test('an Export Center job stores its CSV as a data URI and its download hands it out, to its creator only', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    const [job] = await tx.insert(t.reportingExportJobs).values({
      tenant: f.tenant, whitelabelId: f.tenant, createdBy: CREATOR, reportType: 'PLAYERS', filtersJson: {}, exportFormat: 'CSV',
    }).returning()

    const processor = new ExportJobProcessor()
    mock.method(processor as any, 'fetchExportData', async () => [{ id: 7, name: 'vfyog Player, One', status: 'active' }])
    await processor.processJob(job.id, { tenant: f.tenant, whitelabelId: f.tenant })

    const [row] = await tx.select().from(t.reportingExportJobs).where(eq(t.reportingExportJobs.id, job.id))
    assert.equal(row.status, 'completed')
    assert.match(row.fileUrl, new RegExp(`^PLAYERS-${job.id}-\\d+\\.csv$`), 'file_url is the bare file name')
    assert.ok(row.fileData.startsWith('data:text/csv;base64,'), row.fileData.slice(0, 40))
    const [header, line] = decode(row.fileData).split('\n')
    assert.match(header, /ID,Name,Email,Phone,Balance,Status,Registered At/)
    assert.match(line, /7,"vfyog Player, One",,,0,active,/)

    // The download is the stored file; another tenant, whitelabel or creator finds no job.
    assert.equal(await reportingQueryResolvers.exportJobDownloadUrl(null, { jobId: job.id }, reportingCtx(f.tenant)), row.fileData)
    for (const ctx of [
      reportingCtx('vfyog-other-tenant', String(CREATOR), f.tenant),
      reportingCtx(f.tenant, String(CREATOR), 'vfyog-other-whitelabel'),
      reportingCtx(f.tenant, String(CREATOR + 1)),
    ]) {
      await assert.rejects(reportingQueryResolvers.exportJobDownloadUrl(null, { jobId: job.id }, ctx), { message: 'Export job not found' })
    }
    await assert.rejects(
      reportingQueryResolvers.exportJobDownloadUrl(null, { jobId: job.id }, { ...reportingCtx(f.tenant), permissions: [] }),
      /Forbidden/,
    )

    // The list names the file and never carries it.
    const page = await reportingQueryResolvers.exportJobsPage(null, {}, reportingCtx(f.tenant))
    const listed = page.items.find((item: any) => item.id === job.id)
    assert.equal(listed?.fileUrl, row.fileUrl)
    assert.ok(!JSON.stringify(page).includes('base64'), 'no data URI in the list')
  })
})

test('an S3-era Export Center job is refused by name, and a file too large to store fails its job', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    const [legacy] = await tx.insert(t.reportingExportJobs).values({
      tenant: f.tenant, whitelabelId: f.tenant, createdBy: CREATOR, reportType: 'PLAYERS', filtersJson: {}, exportFormat: 'CSV',
      status: 'completed', fileUrl: `exports/${f.tenant}/${f.tenant}/PLAYERS-x-1700000000000.csv`, completedAt: new Date(),
    }).returning()
    await assert.rejects(reportingQueryResolvers.exportJobDownloadUrl(null, { jobId: legacy.id }, reportingCtx(f.tenant)), { message: PREDATES })

    const [pending] = await tx.insert(t.reportingExportJobs).values({
      tenant: f.tenant, whitelabelId: f.tenant, createdBy: CREATOR, reportType: 'PLAYERS', filtersJson: {}, exportFormat: 'CSV',
    }).returning()
    await assert.rejects(reportingQueryResolvers.exportJobDownloadUrl(null, { jobId: pending.id }, reportingCtx(f.tenant)), { message: 'Export file is not available' })

    // 30 MB + 3 bytes of file is 40 MB + 4 of base64: refused before it is encoded.
    const processor = new ExportJobProcessor()
    mock.method(processor as any, 'fetchExportData', async () => [])
    mock.method((processor as any).exportService, 'generateCSV', async () => Buffer.alloc(30 * 1024 * 1024 + 3, 65))
    await assert.rejects(processor.processJob(pending.id, { tenant: f.tenant, whitelabelId: f.tenant }), /too large to store/)
    const [failed] = await tx.select().from(t.reportingExportJobs).where(eq(t.reportingExportJobs.id, pending.id))
    assert.equal(failed.status, 'failed')
    assert.equal(failed.errorMessage, 'The export is too large to store (40.1 MB); narrow the filters')
    assert.equal(failed.fileData, null)
  })
})

test('an audit export stores its file as a data URI and auditExportJobDownload hands it out, to its creator only', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    const insertJob = async (exportFormat: string, extra: Record<string, unknown> = {}) => (await tx.insert(t.auditExportJobs).values({
      tenant: f.tenant, whitelabelId: f.tenant, createdBy: CREATOR, filtersJson: {}, exportFormat, ...extra,
    }).returning())[0]

    const csvJob = await insertJob('CSV')
    const jsonJob = await insertJob('JSON')
    await processAuditExportJob(csvJob.id, f.tenant)
    await processAuditExportJob(jsonJob.id, f.tenant)

    const stored = async (id: string) => (await tx.select().from(t.auditExportJobs).where(eq(t.auditExportJobs.id, id)))[0]
    const csvRow = await stored(csvJob.id)
    assert.equal(csvRow.status, 'completed')
    assert.match(csvRow.fileUrl, new RegExp(`^audit-${csvJob.id}-\\d+\\.csv$`), 'file_url is the bare file name')
    assert.ok(csvRow.fileData.startsWith('data:text/csv;base64,'))
    // The fixture tenant's trail is empty: the file is its header line.
    assert.equal(decode(csvRow.fileData), 'id,tenant,actorId,domain,action,resourceType,resourceId,timestamp')
    const jsonRow = await stored(jsonJob.id)
    assert.match(jsonRow.fileUrl, /\.json$/)
    assert.ok(jsonRow.fileData.startsWith('data:application/json;base64,'))
    assert.deepEqual(JSON.parse(decode(jsonRow.fileData)), [])

    const download = (id: string, ctx: any) => auditQueryResolvers.auditExportJobDownload(null, { id }, ctx)
    assert.equal(await download(csvJob.id, auditCtx(f.tenant)), csvRow.fileData)
    assert.equal(await download(jsonJob.id, auditCtx(f.tenant)), jsonRow.fileData)
    for (const ctx of [
      auditCtx('vfyog-other-tenant', String(CREATOR), f.tenant),
      auditCtx(f.tenant, String(CREATOR), 'vfyog-other-whitelabel'),
      auditCtx(f.tenant, String(CREATOR + 1)),
      // An agent's sub is its uuid; parseInt would read these leading digits as the creator's id.
      { ...auditCtx(f.tenant, `${CREATOR}e-0000-4000-8000-000000000000`), user: { sub: `${CREATOR}e-0000-4000-8000-000000000000`, type: 'agent', agentId: 'a' } },
    ]) {
      await assert.rejects(download(csvJob.id, ctx), { message: 'Export job not found' })
    }
    await assert.rejects(download('not-a-uuid', auditCtx(f.tenant)), { message: 'Export job not found' })
    await assert.rejects(download(csvJob.id, { ...auditCtx(f.tenant), permissions: [] }), /Forbidden/)
    await assert.rejects(download(csvJob.id, { ...auditCtx(f.tenant), user: undefined }), /Unauthorized/)

    // An S3-era job is refused by name; one that has not finished has no file.
    const legacy = await insertJob('CSV', { status: 'completed', fileUrl: `exports/audit/${f.tenant}/${f.tenant}/audit-x.csv`, completedAt: new Date() })
    await assert.rejects(download(legacy.id, auditCtx(f.tenant)), { message: PREDATES })
    const pending = await insertJob('CSV')
    await assert.rejects(download(pending.id, auditCtx(f.tenant)), { message: 'Export file is not available' })

    // The list names the file and never carries it.
    const page = await auditQueryResolvers.auditExportJobsPage(null, {}, auditCtx(f.tenant))
    assert.equal(page.items.find((item: any) => item.id === csvJob.id)?.fileUrl, csvRow.fileUrl)
    assert.ok(!JSON.stringify(page).includes('base64'), 'no data URI in the list')
  })
})

test('an audit export that cannot be made ends failed with its reason instead of staying processing', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    const [job] = await tx.insert(t.auditExportJobs).values({
      tenant: f.tenant, whitelabelId: f.tenant, createdBy: CREATOR, filtersJson: {}, exportFormat: 'PDF',
    }).returning()
    await assert.rejects(processAuditExportJob(job.id, f.tenant), /Unsupported audit export format: PDF/)
    const [row] = await tx.select().from(t.auditExportJobs).where(eq(t.auditExportJobs.id, job.id))
    assert.equal(row.status, 'failed')
    assert.equal(row.errorMessage, 'Unsupported audit export format: PDF')
    assert.equal(row.fileData, null)
  })
})
