/**
 * useIstClock owns real lifecycle logic (interval setup/teardown) that formatIstClock's own
 * tests can't exercise. Fake timers stand in for the 30s refresh interval.
 */
import { test, describe, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { renderHook, act } from '@testing-library/react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { useIstClock } from './useIstClock'
import { IST_CLOCK_REFRESH_MS } from './istClock'

// main.tsx is not loaded by Vitest, so nowIST()'s dayjs.tz(...) call needs these extended here
// (same reason istClock.test.ts extends them itself).
dayjs.extend(utc)
dayjs.extend(timezone)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-04T11:49:30Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useIstClock', () => {
  test('starts with the current IST date and time', () => {
    const { result } = renderHook(() => useIstClock())
    assert.equal(result.current.date, 'Fri, 04 Sep 2026')
    assert.equal(result.current.time, '17:19 IST')
  })

  test('refreshes after one interval tick', () => {
    const { result } = renderHook(() => useIstClock())
    vi.setSystemTime(new Date('2026-09-04T18:31:00Z'))
    act(() => {
      vi.advanceTimersByTime(IST_CLOCK_REFRESH_MS)
    })
    assert.equal(result.current.date, 'Sat, 05 Sep 2026')
    assert.equal(result.current.time, '00:01 IST')
  })

  test('clears the interval on unmount', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval')
    const { unmount } = renderHook(() => useIstClock())
    unmount()
    assert.equal(clearSpy.mock.calls.length, 1)
  })
})
