/**
 * The toast queue is what every feedback path in the app now ends in, so its rules are pinned here:
 * the mockup's cap of three (M:2868), its timings (M:2871), and the two defaults a caller relies on —
 * an action buys more time, and work in progress stays until it is dismissed.
 */
import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import {
  subscribeToasts,
  toast,
  TOAST_ACTION_DURATION_MS,
  TOAST_DURATION_MS,
  TOAST_LIMIT,
} from './toast'

beforeEach(() => {
  toast.clear()
})

describe('toast queue', () => {
  test('queues a toast and gives back its id', () => {
    const id = toast({ message: 'Saved' })
    const queued = toast.peek()
    assert.equal(queued.length, 1)
    assert.equal(queued[0].id, id)
    assert.equal(queued[0].message, 'Saved')
    assert.equal(queued[0].tone, 'neutral')
  })

  test('keeps at most three, dropping the oldest', () => {
    const first = toast({ message: 'one' })
    toast({ message: 'two' })
    toast({ message: 'three' })
    toast({ message: 'four' })

    const queued = toast.peek()
    assert.equal(queued.length, TOAST_LIMIT)
    assert.deepEqual(
      queued.map((t) => t.message),
      ['two', 'three', 'four']
    )
    assert.equal(
      queued.some((t) => t.id === first),
      false
    )
  })

  test('an action doubles the time on screen, and work in progress stays', () => {
    toast({ message: 'Deleted' })
    toast({ message: 'Deleted', action: { label: 'Undo', onClick: () => {} } })
    toast({ message: 'Exporting', busy: true })

    const [plain, withAction, busy] = toast.peek()
    assert.equal(plain.duration, TOAST_DURATION_MS)
    assert.equal(withAction.duration, TOAST_ACTION_DURATION_MS)
    assert.equal(busy.duration, 0)
  })

  test('a caller duration wins, and 0 means until dismissed', () => {
    toast({ message: 'Session ended', duration: 5000 })
    toast({ message: 'Uploading', duration: 0 })
    const [first, second] = toast.peek()
    assert.equal(first.duration, 5000)
    assert.equal(second.duration, 0)
  })

  test('dismiss removes one and leaves the rest', () => {
    const a = toast({ message: 'a' })
    toast({ message: 'b' })
    toast.dismiss(a)
    assert.deepEqual(
      toast.peek().map((t) => t.message),
      ['b']
    )
    // dismissing something already gone is a no-op
    toast.dismiss(a)
    assert.equal(toast.peek().length, 1)
  })

  test('tells its subscribers on every change, and stops when they leave', () => {
    const seen: number[] = []
    const stop = subscribeToasts((toasts) => seen.push(toasts.length))
    const id = toast({ message: 'x' })
    toast.dismiss(id)
    stop()
    toast({ message: 'y' })
    assert.deepEqual(seen, [1, 0])
  })
})
