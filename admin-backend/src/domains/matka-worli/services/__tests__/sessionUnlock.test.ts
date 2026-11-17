/**
 * The Unlock rule (owner, 2026-11-04) without a database: when a session stopped by Lock Now or Close Now may be
 * reopened, and which status it gets back. The resolver and the bet path are covered against the QA database in
 * domains/matka-worli/__tests__/worliSessions.integration.test.ts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canUnlockWorliSession, worliStatusBeforeStop, worliUnlockRefusal,
  UNLOCK_CLOSE_PASSED, UNLOCK_NOT_STOPPED, UNLOCK_RESULT_DECLARED, UNLOCK_RESULT_WAS_DECLARED,
} from '../sessionUnlock.js'

const NOW = new Date('2026-11-04T10:00:00Z')
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60000)
const locked = { status: 'LOCKED', scheduledOpenAtUtc: at(-120), scheduledCloseAtUtc: at(60), actualLockAtUtc: at(-5), actualCloseAtUtc: null, resultPublishedAtUtc: null, resultEverDeclared: false }
/** A Lock Now / Close Now log row as the resolvers write it: the status it found, and the moment it stopped the session. */
const stop = (action: string, previousStatus?: string, stoppedAt = locked.actualLockAtUtc) =>
  ({ action, metaJson: previousStatus ? JSON.stringify({ previousStatus, at: stoppedAt.toISOString() }) : null })

test('a session Lock Now or Close Now stopped can be unlocked until its result or its scheduled close', () => {
  assert.equal(worliUnlockRefusal(locked, NOW), null)
  assert.equal(canUnlockWorliSession(locked, NOW), true)
  // Close Now stamps both; an old Lock Now kept status OPEN and only stamped.
  assert.equal(worliUnlockRefusal({ ...locked, status: 'CLOSED', actualCloseAtUtc: at(-1) }, NOW), null)
  assert.equal(worliUnlockRefusal({ ...locked, status: 'OPEN' }, NOW), null)
  // Past the scheduled lock but before the close it may still be unlocked (Adjust Suspend Minutes can move the lock).
  assert.equal(worliUnlockRefusal({ ...locked, scheduledCloseAtUtc: at(1) }, NOW), null)
})

test('Unlock is refused once the result is declared, at or after the scheduled close, and for a session no operator stopped', () => {
  assert.equal(worliUnlockRefusal({ ...locked, resultPublishedAtUtc: at(-1) }, NOW), UNLOCK_RESULT_DECLARED)
  for (const status of ['SETTLING', 'SETTLED', 'VOIDED']) assert.equal(worliUnlockRefusal({ ...locked, status }, NOW), UNLOCK_RESULT_DECLARED, status)
  assert.equal(worliUnlockRefusal({ ...locked, scheduledCloseAtUtc: NOW }, NOW), UNLOCK_CLOSE_PASSED)
  assert.equal(worliUnlockRefusal({ ...locked, scheduledCloseAtUtc: at(-1) }, NOW), UNLOCK_CLOSE_PASSED)
  assert.equal(worliUnlockRefusal({ ...locked, scheduledCloseAtUtc: null }, NOW), UNLOCK_CLOSE_PASSED)
  // LOCKED left by a result rollback, or CLOSED for a side the market does not offer: no operator stamp, nothing to undo.
  for (const status of ['LOCKED', 'CLOSED', 'OPEN', 'PAUSED']) assert.equal(worliUnlockRefusal({ ...locked, status, actualLockAtUtc: null }, NOW), UNLOCK_NOT_STOPPED, status)
  assert.equal(canUnlockWorliSession({ ...locked, resultPublishedAtUtc: at(-1) }, NOW), false)
})

// H401 (owner, 2026-11-04): Lock Now, a result declared before the scheduled close, that result rolled back: the session is
// LOCKED again with the Lock Now's stamp and no published result, but players may have seen the result. It stays shut.
test('Unlock is refused for a session whose result was ever declared, though rolled back since, and canUnlock agrees', () => {
  const rolledBack = { ...locked, resultEverDeclared: true }
  assert.equal(worliUnlockRefusal(rolledBack, NOW), UNLOCK_RESULT_WAS_DECLARED)
  assert.equal(canUnlockWorliSession(rolledBack, NOW), false)
  // Whatever else is true of it: closed by Close Now, stamped only by an old Lock Now, or with the close still far ahead.
  for (const session of [{ ...rolledBack, status: 'CLOSED', actualCloseAtUtc: at(-1) }, { ...rolledBack, status: 'OPEN' }, { ...rolledBack, scheduledCloseAtUtc: at(600) }]) {
    assert.equal(worliUnlockRefusal(session, NOW), UNLOCK_RESULT_WAS_DECLARED, JSON.stringify(session))
  }
  // A result standing now is named as such; with no operator stamp the declared result is still the reason given.
  assert.equal(worliUnlockRefusal({ ...rolledBack, resultPublishedAtUtc: at(-1) }, NOW), UNLOCK_RESULT_DECLARED)
  assert.equal(worliUnlockRefusal({ ...rolledBack, actualLockAtUtc: null }, NOW), UNLOCK_RESULT_WAS_DECLARED)
  // Never declared: the session Lock Now stopped still unlocks.
  assert.equal(worliUnlockRefusal(locked, NOW), null)
  assert.equal(canUnlockWorliSession(locked, NOW), true)
})

test('Unlock puts back the status found by the stop that wrote the lock stamp, wherever it is in the log', () => {
  assert.equal(worliStatusBeforeStop(locked, [stop('LOCK_NOW', 'OPEN')], NOW), 'OPEN')
  assert.equal(worliStatusBeforeStop(locked, [stop('PAUSE'), stop('LOCK_NOW', 'PAUSED')], NOW), 'PAUSED')
  // Close Now after Lock Now found LOCKED and kept the Lock Now's stamp; the Lock Now holds the status before the stop.
  const closed = { ...locked, status: 'CLOSED', actualCloseAtUtc: at(-1) }
  assert.equal(worliStatusBeforeStop(closed, [stop('CLOSE_NOW', 'LOCKED', at(-1)), stop('SET_MESSAGE'), stop('LOCK_NOW', 'SCHEDULED')], NOW), 'SCHEDULED')
  assert.equal(worliStatusBeforeStop(closed, [stop('LOCK_NOW', 'SCHEDULED'), stop('CLOSE_NOW', 'LOCKED', at(-1))], NOW), 'SCHEDULED')
  // Close Now on its own stamps both at once.
  assert.equal(worliStatusBeforeStop({ ...closed, actualLockAtUtc: at(-1) }, [stop('CLOSE_NOW', 'PAUSED', at(-1))], NOW), 'PAUSED')
  // Stops of an earlier lock, undone since, wrote other stamps (rows of one transaction share created_at, so no order is used).
  assert.equal(worliStatusBeforeStop(locked, [stop('LOCK_NOW', 'OPEN', at(-50)), stop('UNLOCK'), stop('LOCK_NOW', 'PAUSED')], NOW), 'PAUSED')
  assert.equal(worliStatusBeforeStop(locked, [stop('LOCK_NOW', 'PAUSED'), stop('UNLOCK'), stop('LOCK_NOW', 'OPEN', at(-50))], NOW), 'PAUSED')
})

test('a stop logged without the status falls back to the clock, and a stamp-only stop keeps its status', () => {
  assert.equal(worliStatusBeforeStop(locked, [stop('LOCK_NOW')], NOW), 'OPEN')
  assert.equal(worliStatusBeforeStop(locked, [], NOW), 'OPEN')
  assert.equal(worliStatusBeforeStop({ ...locked, scheduledOpenAtUtc: at(30) }, [], NOW), 'SCHEDULED')
  assert.equal(worliStatusBeforeStop(locked, [{ action: 'LOCK_NOW', metaJson: '{not json' }], NOW), 'OPEN')
  // A stop of another moment, an old Close Now that stamped only the close, or a row that is no stop: the clock again.
  assert.equal(worliStatusBeforeStop(locked, [stop('LOCK_NOW', 'PAUSED', at(-50))], NOW), 'OPEN')
  assert.equal(worliStatusBeforeStop({ ...locked, status: 'CLOSED', actualLockAtUtc: null, actualCloseAtUtc: at(-5) }, [stop('CLOSE_NOW', 'PAUSED', at(-5))], NOW), 'OPEN')
  assert.equal(worliStatusBeforeStop(locked, [stop('PAUSE', 'PAUSED')], NOW), 'OPEN')
  // A status a stop cannot have come from is not put back.
  for (const status of ['CLOSED', 'SETTLED', 'VOIDED']) assert.equal(worliStatusBeforeStop(locked, [stop('CLOSE_NOW', status)], NOW), 'OPEN', status)
  // Close Now on a session a result rollback left LOCKED (no stamp of its own) wrote the lock stamp itself: Unlock undoes
  // only the Close Now, so the session stays LOCKED and does not reopen for bets (reviewer, G501).
  assert.equal(worliStatusBeforeStop({ ...locked, status: 'CLOSED', actualCloseAtUtc: locked.actualLockAtUtc }, [stop('CLOSE_NOW', 'LOCKED')], NOW), 'LOCKED')
  for (const status of ['OPEN', 'SCHEDULED', 'PAUSED']) assert.equal(worliStatusBeforeStop({ ...locked, status }, [stop('LOCK_NOW', 'OPEN')], NOW), status)
})
