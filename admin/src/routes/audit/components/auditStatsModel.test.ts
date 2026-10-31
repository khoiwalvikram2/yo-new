import assert from 'node:assert/strict'
import { test } from 'vitest'
import { auditSampleBuckets, auditChartHue } from './auditStatsModel'
const event = (timestamp: string) => ({ id: timestamp, timestamp, domain: 'users', action: 'update' })
test('audit sample preserves 24 rolling-hour buckets and excludes older events', () => {
  const now = new Date('2026-10-09T12:30:00Z')
  const rows = [event(now.toISOString()), event('2026-10-09T12:00:00Z'), event('2026-10-09T11:00:00Z'), event('2026-10-08T13:00:00Z'), event('2026-10-08T12:00:00Z')]
  const { timeline, hourly } = auditSampleBuckets(rows, now)
  assert.equal(timeline.length, 24); assert.equal(hourly.length, 24)
  assert.equal(timeline[23].count, 2); assert.equal(timeline[22].count, 1); assert.equal(timeline[0].count, 1)
  assert.equal(timeline.reduce((sum, row) => sum + row.count, 0), 4)
  assert.equal(hourly.reduce((sum, row) => sum + row.count, 0), 5)
  assert.equal(hourly[new Date(rows[0].timestamp).getHours()].count >= 2, true)
  assert.equal(timeline[0].timestamp, '2026-10-08T13:30:00.000Z')
})
test('invalid timestamps cannot become a fabricated current-hour event', () => {
  const result = auditSampleBuckets([event('invalid')], new Date('2026-10-09T12:30:00Z'))
  assert.equal(result.timeline.reduce((sum, row) => sum + row.count, 0), 0)
  assert.equal(result.hourly.reduce((sum, row) => sum + row.count, 0), 0)
})
test('audit chart hues preserve meaningful action categories with a safe unknown fallback', () => {
  assert.equal(auditChartHue('delete'), 'red'); assert.equal(auditChartHue('approve'), 'grn')
  assert.equal(auditChartHue('sports'), 'blu'); assert.equal(auditChartHue('casino'), 'vio'); assert.equal(auditChartHue('unknown'), 'ind')
})
