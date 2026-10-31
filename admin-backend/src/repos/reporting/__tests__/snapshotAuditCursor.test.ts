import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decodeSnapshotEventCursor,
  decodeSnapshotRunCursor,
  encodeSnapshotEventCursor,
  encodeSnapshotRunCursor,
} from '../snapshotAuditCursorCodec.js'

describe('snapshot audit cursors', () => {
  it('round-trips run cursor', () => {
    const startedAt = new Date('2025-03-01T12:00:00.000Z')
    const id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    const c = encodeSnapshotRunCursor({ startedAt, id })
    const d = decodeSnapshotRunCursor(c)
    assert.equal(d.s, startedAt.toISOString())
    assert.equal(d.i, id)
  })

  it('round-trips event cursor', () => {
    const occurredAt = new Date('2025-03-02T08:30:00.000Z')
    const id = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'
    const c = encodeSnapshotEventCursor({ occurredAt, id })
    const d = decodeSnapshotEventCursor(c)
    assert.equal(d.s, occurredAt.toISOString())
    assert.equal(d.i, id)
  })

  it('rejects invalid run cursor', () => {
    assert.throws(() => decodeSnapshotRunCursor('not-json'))
  })
})
