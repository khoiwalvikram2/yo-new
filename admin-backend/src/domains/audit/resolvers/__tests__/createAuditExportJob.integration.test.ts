/**
 * Who may create an audit export job. A job records created_by, the admin user id that the job list and
 * auditExportJobDownload match the caller against. The old export check let every agent through, and parseInt cut an
 * agent's uuid to its leading digits, so an agent whose uuid starts with digits recorded them as an admin's id. The
 * gate is now the list's: an admin holding audit.events:view, plus audit.events:export. An agent is refused whatever
 * it holds, and a session id that is not all digits is never read as one.
 *
 * Every refusal happens before the database is reached. The allowed admin's job is created in the isolated Matka QA
 * database, inside a transaction that is rolled back once the job's background export has finished.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/audit/resolvers/__tests__/createAuditExportJob.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../../db/client.js')
const { auditMutationResolvers } = await import('../mutations.js')
const { auditQueryResolvers } = await import('../queries.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

const CREATOR = 914_202
// A session carries one entry per domain (aggregatePermissionPairs), so holding both is one entry.
const VIEW = { domain: 'audit.events', actions: ['view'] }
const EXPORT = { domain: 'audit.events', actions: ['export'] }
const BOTH = { domain: 'audit.events', actions: ['view', 'export'] }
const input = { exportFormat: 'CSV', filtersJson: { domain: 'vfyog2' } }
const admin = (tenant: string, permissions: unknown[], sub = String(CREATOR), roles: string[] = []) => ({
  tenant, whitelabel: { id: tenant }, user: { sub, type: 'admin', roles }, permissions,
})
const create = (ctx: unknown) => auditMutationResolvers.createAuditExportJob(null, { input }, ctx)

/** Fails the test if anything is written. */
function refuseWrites() {
  for (const method of ['insert', 'update', 'delete', 'transaction'] as const) {
    mock.method(db, method, () => { throw new Error(`nothing may be written (db.${method})`) })
  }
}

test('an agent is refused, whatever it holds, before anything is written', async () => {
  refuseWrites()
  // An agent's sub is its uuid; this one starts with digits that parseInt read as an admin user id.
  const uuid = `${CREATOR}e-0000-4000-8000-000000000000`
  for (const permissions of [[BOTH], [{ domain: 'all', actions: ['*'] }], [{ domain: 'audit', actions: ['read', 'export'] }]]) {
    const agent = { tenant: 'vfyog2-tenant', whitelabel: { id: 'vfyog2-tenant' }, user: { sub: uuid, type: 'agent', agentId: uuid, roles: [] }, permissions }
    await assert.rejects(create(agent), { message: 'Forbidden: audit exports are not available to agents' })
  }
})

test("an admin needs the list's audit.events:view and audit.events:export, and an all-digit session id", async () => {
  refuseWrites()
  await assert.rejects(create({ tenant: 'vfyog2-tenant', whitelabel: { id: 'vfyog2-tenant' } }), /Unauthorized: authentication required/)
  await assert.rejects(create(admin('vfyog2-tenant', [EXPORT])), { message: 'Forbidden: insufficient permissions for audit.events:view' })
  await assert.rejects(create(admin('vfyog2-tenant', [VIEW])), { message: 'Forbidden: insufficient permissions for audit export' })
  // A whitelabel's own admin is held to the same two permissions (it was asked for export only).
  await assert.rejects(create(admin('vfyog2-tenant', [EXPORT], String(CREATOR), ['Whitelabel Admin'])), /audit\.events:view/)
  for (const sub of [`${CREATOR}abc`, '0', '', ' 914202']) {
    await assert.rejects(create(admin('vfyog2-tenant', [BOTH], sub)), { message: 'Invalid user ID' }, JSON.stringify(sub))
  }
})

test('an admin holding both creates the job under its own id; the list shows it and the export completes', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    for (const permissions of [[BOTH], [{ domain: 'audit', actions: ['read', 'export'] }]]) {
      const ctx = admin(f.tenant, permissions)
      const job = await create(ctx)
      assert.deepEqual([job.tenant, job.whitelabelId, job.createdBy, job.status, job.exportFormat], [f.tenant, f.tenant, String(CREATOR), 'pending', 'CSV'])

      // The export runs in the background; let it finish inside this transaction.
      let status = 'pending'
      for (let i = 0; i < 100 && (status === 'pending' || status === 'processing'); i++) {
        await new Promise(resolve => setTimeout(resolve, 50))
        status = (await tx.select({ status: t.auditExportJobs.status }).from(t.auditExportJobs).where(eq(t.auditExportJobs.id, job.id)))[0].status
      }
      assert.equal(status, 'completed')

      const [row] = await tx.select({ createdBy: t.auditExportJobs.createdBy }).from(t.auditExportJobs).where(eq(t.auditExportJobs.id, job.id))
      assert.equal(row.createdBy, CREATOR)
      const page = await auditQueryResolvers.auditExportJobsPage(null, {}, ctx)
      assert.ok(page.items.some((item: any) => item.id === job.id && item.status === 'completed'), 'listed for its creator')
    }
  })
})
