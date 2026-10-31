/**
 * Every panel row, saved-view row and footer row calls this one helper so a client-side navigation off a
 * live sports-event page (module-level odds socket, never disconnected on unmount) still gets the full
 * reload the old sidebar gave it (decision 6, R7-gap-2 §6). One copy means one place to get it right.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { hardNavigateIfLeavingSportsEvent } from './navClick'

function fakeEvent() {
  let prevented = false
  return {
    event: { preventDefault: () => { prevented = true } },
    wasPrevented: () => prevented,
  }
}

describe('hardNavigateIfLeavingSportsEvent', () => {
  test('prevents default, calls assign and returns true when leaving a sports event page for another path', () => {
    const { event, wasPrevented } = fakeEvent()
    const calls: string[] = []
    const handled = hardNavigateIfLeavingSportsEvent(event, '/sports/event/12', '/bets', (url) => calls.push(url))
    assert.equal(handled, true)
    assert.equal(wasPrevented(), true)
    assert.deepEqual(calls, ['/bets'])
  })

  test('returns false and does not call assign when the target is the current path', () => {
    const { event, wasPrevented } = fakeEvent()
    const calls: string[] = []
    const handled = hardNavigateIfLeavingSportsEvent(
      event,
      '/sports/event/12',
      '/sports/event/12',
      (url) => calls.push(url),
    )
    assert.equal(handled, false)
    assert.equal(wasPrevented(), false)
    assert.deepEqual(calls, [])
  })

  test('returns false when the current path is not a sports event detail page', () => {
    const { event, wasPrevented } = fakeEvent()
    const calls: string[] = []
    const handled = hardNavigateIfLeavingSportsEvent(event, '/sports/events', '/bets', (url) => calls.push(url))
    assert.equal(handled, false)
    assert.equal(wasPrevented(), false)
    assert.deepEqual(calls, [])
  })

  test('defaults to window.location.assign when no assign function is given', () => {
    // jsdom 27 defines location.assign as a non-configurable, non-writable own property, so
    // vi.spyOn(window.location, 'assign') throws "Cannot redefine property: assign" no matter what
    // the implementation does. window's own `location` accessor is configurable, though, so swap the
    // whole object out for the duration of this test instead of spying on the method directly.
    const assign = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign },
    })
    try {
      const { event } = fakeEvent()
      const handled = hardNavigateIfLeavingSportsEvent(event, '/sports/event/12', '/bets')
      assert.equal(handled, true)
      assert.equal(assign.mock.calls.length, 1)
      assert.equal(assign.mock.calls[0][0], '/bets')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })
})
