import assert from 'node:assert/strict'
import { test } from 'vitest'
import { auditActiveFilters, auditCalendarRange, auditCalendarDay, auditExportFilename, auditGraphqlFilters, auditTimePreset, auditHasChanges, auditPrintDocument, auditResetFilters, exportJobDate, exportJobError } from './auditPageModel'
import { auditFixtureEvent } from '../../../test/auditEventsPreviewData'
test('audit variables preserve paging/sort and only non-empty supported filters', () => {
  const filters = { page: 3, limit: 50, sort: 'actorId:asc', id: 'event', domain: ['sports'], action: [], actorId: '', resourceId: 'player', resourceType: ['player'], from: 'start', to: 'end', search: 'needle' }
  assert.deepEqual(auditGraphqlFilters(filters), { page: 3, limit: 50, sort: 'actorId:asc', id: 'event', domain: ['sports'], resourceId: 'player', resourceType: ['player'], from: 'start', to: 'end', search: 'needle' })
  assert.equal(auditActiveFilters(filters), 6)
})
test('audit presets retain inclusive IST end and the old seven-day subtraction', () => {
  const now = new Date('2026-10-09T02:00:00Z')
  assert.deepEqual(auditTimePreset('today', now), { from: '2026-10-08T18:30:00.000Z', to: '2026-10-09T18:29:59.999Z', page: 1 })
  assert.deepEqual(auditTimePreset('last7days', now), { from: '2026-10-01T18:30:00.000Z', to: '2026-10-09T18:29:59.999Z', page: 1 })
  assert.equal(auditTimePreset('custom', now), null); assert.deepEqual(auditTimePreset('', now), { from: undefined, to: undefined, page: 1 })
  assert.deepEqual(auditCalendarRange('2026-10-02', '2026-10-09'), { from: '2026-10-01T18:30:00.000Z', to: '2026-10-09T18:29:59.999Z', page: 1 })
  assert.equal(auditCalendarDay('2026-10-01T18:30:00Z'), '2026-10-02')
})
test('change expansion still requires an object with keys', () => {
  assert.equal(auditHasChanges(auditFixtureEvent), true)
  assert.equal(auditHasChanges({ ...auditFixtureEvent, before: {}, after: null }), false)
})
test('empty-table Clear All really clears a merging store, not only pagination defaults', () => {
  const active = { page: 4, limit: 50, sort: 'actorId:asc', id: 'event', domain: ['sports'], action: ['update'], actorId: 'admin', resourceType: ['player'], resourceId: 'player', from: '2026-10-01', to: '2026-10-09', search: 'needle' }
  const merged = { ...active, ...auditResetFilters() }
  assert.equal(auditActiveFilters(merged), 0)
  assert.deepEqual(auditGraphqlFilters(merged), { page: 1, limit: 100, sort: 'timestamp:desc' })
})
test('print retains the current page, total, dates and six columns without interpreting stored HTML', () => {
  const html = auditPrintDocument([{ ...auditFixtureEvent, id: '<script>bad</script>', actor: { ...auditFixtureEvent.actor!, name: '<img src=x onerror=bad()>' } }], 230, { page: 1, limit: 100, sort: 'timestamp:desc', from: '2026-10-02', to: '2026-10-09' }, (date) => date, (date) => date)
  assert.ok(html.includes('Total Events: 230')); assert.ok(html.includes('Date Range: 2026-10-02 - 2026-10-09'))
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;')); assert.ok(html.includes('&lt;img src=x onerror=bad()&gt;'))
  assert.equal(html.includes('<script>bad</script>'), false)
  assert.equal((html.match(/<th>/g) ?? []).length, 6)
})
test('export job dates read in either shape the server has sent', () => {
  assert.equal(exportJobDate('1793645111717'), '2026-11-02T18:45:11.717Z')
  assert.equal(exportJobDate('2026-11-02T18:45:11.717Z'), '2026-11-02T18:45:11.717Z')
  assert.equal(exportJobDate(null), null)
})
test('a job that failed in the retired file storage says to run it again, other failures are kept as sent', () => {
  // Since 2026-11-04 exports are kept in the job row: "Upload failed: …" only comes from the old storage.
  const retired = 'This export failed in the old file storage, which is no longer used. Create a new export job.'
  assert.equal(exportJobError('Upload failed: The AWS Access Key Id you provided does not exist in our records.'), retired)
  assert.equal(exportJobError('Upload failed: socket hang up'), retired)
  assert.equal(exportJobError('No events match these filters'), 'No events match these filters')
  assert.equal(exportJobError('The export is too large to store (52 MB); narrow the filters'), 'The export is too large to store (52 MB); narrow the filters')
})
test('an audit export downloads as "Audit Trail-<IST day>-<id>.<extension of its type>"', () => {
  const job = { id: '3f2a9c1e-7b1d-4c55-9a8e-000000000001', exportFormat: 'CSV', createdAt: '2026-11-03T20:00:00.000Z' }
  // 20:00 UTC is 01:30 the next day in IST.
  assert.equal(auditExportFilename(job, 'text/csv'), 'Audit Trail-2026-11-04-3f2a9c1e.csv')
  assert.equal(auditExportFilename({ ...job, exportFormat: 'XLSX' }, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'Audit Trail-2026-11-04-3f2a9c1e.xlsx')
  // A type this list does not know takes the job's format; the epoch-milliseconds date the server once sent is read too.
  assert.equal(auditExportFilename({ ...job, exportFormat: 'JSON', createdAt: '1793645111717' }, 'application/x-unknown'), 'Audit Trail-2026-11-03-3f2a9c1e.json')
  assert.equal(auditExportFilename({ ...job, createdAt: null }), 'Audit Trail-export-3f2a9c1e.csv')
})
