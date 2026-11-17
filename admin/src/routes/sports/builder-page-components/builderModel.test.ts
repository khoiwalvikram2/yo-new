import assert from 'node:assert/strict'
import { test } from 'vitest'
import { builderAuditChange, builderAuditCut, builderAuditRows, builderAutoActions, builderEventPayload, builderMutationActions, builderRequireSuccess } from './builderModel'
import type { BuilderAuditRow, Event, League, Sport } from './types'
test('the per-action audit answers merge into one history: builder rows once, newest first', () => {
  const row = (id: string, action: string, timestamp: string): BuilderAuditRow => ({ id, action, timestamp, actorId: '1', domain: 'sports', resourceType: 'events', resourceId: 'bulk' })
  const rows = builderAuditRows({
    persistSportsSelections: [row('a', 'persistSportsSelections', '2026-10-30T12:05:00Z'), row('b', 'persistSportsSelections', '2026-10-01T00:00:00Z')],
    runAutoSportsIngestion: [row('c', 'runAutoSportsIngestion', '2026-10-15T00:00:00Z'), row('a', 'persistSportsSelections', '2026-10-30T12:05:00Z')],
    other: [row('d', 'setMarketStatus', '2026-11-01T00:00:00Z')],
    deleteAutoRuns: null,
  })
  assert.deepEqual(rows.map(item => item.id), ['a', 'c', 'b'])
  assert.deepEqual(builderAuditRows(undefined), [])
})
test('a read is cut short when any action answered as many rows as were asked for (B003)', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, index): BuilderAuditRow => ({ id: String(index), action: 'persistSportsSelections', timestamp: '2026-10-30T12:05:00Z', actorId: '1', domain: 'sports', resourceType: 'selection', resourceId: String(index) }))
  assert.equal(builderAuditCut({ persistSportsSelections: rows(200), deleteAutoRuns: rows(3) }, 200), true)
  assert.equal(builderAuditCut({ persistSportsSelections: rows(199), deleteAutoRuns: null }, 200), false)
  assert.equal(builderAuditCut({ persistSportsSelections: rows(213) }, 400), false, 'the wider read holds them all')
  assert.equal(builderAuditCut(undefined, 200), false)
})
test('persist payload includes only visible selected sports/leagues/events and preserves provider fields', () => {
  const sports: Sport[] = [{ key: 'cricket', name: 'Cricket', selected: true, icon: '', colorClass: '', subtitle: '' }]
  const leagues: League[] = [{ id: 'provider-ipl', key: 'ipl', sportKey: 'cricket', name: 'IPL', selected: true }, { id: 'provider-bbl', key: 'bbl', sportKey: 'cricket', name: 'BBL', selected: false }, { id: 'provider-epl', key: 'epl', sportKey: 'football', name: 'EPL', selected: true }]
  const events: Event[] = [{ id: 'event-1', key: 'one', leagueKey: 'ipl', sportKey: 'cricket', name: 'India v Australia', selected: true }, { id: 'event-2', key: 'two', leagueKey: 'bbl', sportKey: 'cricket', name: 'Unselected league', selected: true }, { id: 'event-3', key: 'three', leagueKey: 'epl', sportKey: 'football', name: 'Hidden sport', selected: true }]
  assert.deepEqual(builderEventPayload(sports, leagues, events, { cricket: 'sport-1' }), [{ sportId: 'sport-1', sportCode: '', leagueCode: 'provider-ipl', leagueName: 'IPL', eventCode: 'event-1', eventName: 'India v Australia', startTime: null }])
})
test('false or missing server success cannot erase a draft or claim a completed action', () => {
  assert.doesNotThrow(() => builderRequireSuccess({ data: { save: { success: true } } }, 'save'))
  assert.throws(() => builderRequireSuccess({ data: { save: { success: false, message: 'Permission refused' } } }, 'save'), /Permission refused/)
  assert.throws(() => builderRequireSuccess({ data: {} }, 'save'), /did not confirm/)
})
test('audit classification omits query activity and keeps original mutation categories', () => {
  assert.equal(builderMutationActions.has('listSports'), false); assert.equal(builderMutationActions.has('seedSportsFromProvider'), true)
  assert.equal(builderAutoActions.has('persistSportsSelections'), false); assert.equal(builderAutoActions.has('deleteAutoRuns'), true)
})
test('audit change summary retains zero values and skipped-market detail', () => {
  const row: BuilderAuditRow = { id: 'audit', actorId: 'admin', action: 'persistSportsSelections', domain: 'sports', resourceType: 'selection', resourceId: 's', timestamp: '2026-10-09T00:00:00Z', after: { eventsUpserted: 2, skippedMarketsCount: 3 } }
  assert.equal(builderAuditChange(row), '0 leagues · 2 events · 0 markets · 0 runners · skipped events 0 · markets skipped (not in allowlist) 3')
  assert.equal(builderAuditChange({ ...row, action: 'upsertAutoSportsConfig', after: { frequencyHours: 0, leagueCodes: [], active: false } }), 'every 0h · 0 leagues · inactive')
})
