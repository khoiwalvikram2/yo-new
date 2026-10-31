import assert from 'node:assert/strict'
import { test } from 'vitest'
import { auditActiveFilters, auditCalendarRange, auditCalendarDay, auditGraphqlFilters, auditTimePreset, auditHasChanges, auditPrintDocument, auditResetFilters } from './auditPageModel'
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
