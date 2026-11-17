/**
 * createExportJob's format (F-REP-02, F-REP-15): the processor writes 'CSV' or 'XLSX' only, so the
 * mutation stores the caller's format upper-cased and refuses anything else before a job row exists.
 * The Agent Overview sent 'csv' / 'xlsx' and every one of its jobs failed in the processor; "NOPE"
 * was accepted and queued a job that could only fail.
 *
 * Unit, no database: a stand-in for db.insert records what would be written and stops there, so no
 * job row is ever created.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/createExportJobFormat.test.ts
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '@/db/client.js'
import { reportingResolvers } from '../resolvers/index.js'
import { normalizeExportFormat } from '../services/exportFormat.js'

const written: Array<Record<string, unknown>> = []
const realInsert = (db as any).insert
before(() => {
  (db as any).insert = () => ({
    values: (values: Record<string, unknown>) => {
      written.push(values)
      throw new Error('stop: the job row would be written here')
    },
  })
})
after(() => {
  (db as any).insert = realInsert
})

const adminCtx = {
  tenant: 'brand-a',
  whitelabel: { id: 'brand-a' },
  user: { sub: '42', type: 'admin', roles: [] },
  permissions: [{ domain: 'all', actions: ['*'] }],
}

async function create(exportFormat: unknown): Promise<unknown> {
  return (reportingResolvers.Mutation as any).createExportJob(
    undefined,
    { input: { reportType: 'deposits', filtersJson: {}, exportFormat } },
    adminCtx,
    undefined,
  )
}

describe('normalizeExportFormat', () => {
  it('upper-cases the two formats the processor writes', () => {
    assert.equal(normalizeExportFormat('csv'), 'CSV')
    assert.equal(normalizeExportFormat(' xlsx '), 'XLSX')
    assert.equal(normalizeExportFormat('CSV'), 'CSV')
  })
  it('refuses anything else', () => {
    for (const value of ['NOPE', '', 'pdf', null, undefined, 3]) {
      assert.throws(() => normalizeExportFormat(value), /Export format must be CSV or XLSX/, String(value))
    }
  })
})

describe('createExportJob', () => {
  it('refuses an unknown format before any job row', async () => {
    written.length = 0
    await assert.rejects(create('NOPE'), /Export format must be CSV or XLSX \(got "NOPE"\)/)
    assert.equal(written.length, 0, 'nothing reached the insert')
  })

  it('stores a lower-case format upper-cased, so the processor can write it', async () => {
    written.length = 0
    await assert.rejects(create('csv'), /stop: the job row would be written here/)
    assert.equal(written.length, 1)
    assert.equal(written[0].exportFormat, 'CSV')
    written.length = 0
    await assert.rejects(create('xlsx'), /stop: the job row would be written here/)
    assert.equal(written[0].exportFormat, 'XLSX')
  })
})
