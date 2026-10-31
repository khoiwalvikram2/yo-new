import test from 'node:test'
import assert from 'node:assert/strict'
import { inCycleRange } from '../cycleRange.js'
test('Monday 00:00 boundary belongs to exactly one cycle (half-open)', () => {
  const from = new Date('2026-06-08T00:00:00.000+05:30')
  const to   = new Date('2026-06-15T00:00:00.000+05:30')
  assert.equal(inCycleRange(from, from, to), true)
  assert.equal(inCycleRange(to, from, to), false)
  assert.equal(inCycleRange(new Date('2026-06-10T12:00:00+05:30'), from, to), true)
})
