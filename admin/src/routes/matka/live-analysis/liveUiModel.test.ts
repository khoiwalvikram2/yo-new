import assert from 'node:assert/strict'
import { test } from 'vitest'
import { appendMatkaEvent, isGoodMatkaSnapshot, type MatkaDashboard, type MatkaPlayerEvent } from './liveUiModel'
const snapshot: MatkaDashboard = { kpis: { at: '', betsPerMin: 0, wagered: 0, payouts: 0, activePlayers: 0, ggr: 0, rtp: 0 } }
test('snapshot guard retains original finite-value criteria including legitimate zeros', () => {
  assert.equal(isGoodMatkaSnapshot(snapshot), true); assert.equal(isGoodMatkaSnapshot(null), false); assert.equal(isGoodMatkaSnapshot({}), false)
  for (const key of ['betsPerMin', 'wagered', 'payouts', 'activePlayers'] as const) assert.equal(isGoodMatkaSnapshot({ kpis: { ...snapshot.kpis!, [key]: Infinity } }), false)
})
test('activity stream ignores exact replay but preserves changed events and its 200-event bound', () => {
  const event: MatkaPlayerEvent = { id: 'bet-1', at: '2026-10-10T00:00:00Z', userId: '1', userName: 'Preview', marketName: 'OPEN', bidType: 'single', betAmount: 100, potentialWin: 900, status: 'pending' }
  const original = [event]
  assert.equal(appendMatkaEvent(original, { ...event }), original)
  assert.equal(appendMatkaEvent(original, { ...event, status: 'won' }).length, 2)
  assert.equal(appendMatkaEvent(original, { ...event, at: '2026-10-10T00:01:00Z' }).length, 2)
  assert.equal(appendMatkaEvent(Array.from({ length: 200 }, (_, i) => ({ ...event, id: `bet-${i + 2}` })), event).length, 200)
})
