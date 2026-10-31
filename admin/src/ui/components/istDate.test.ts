/**
 * Day strings are what the kit's date fields carry, and IST is where the admin's days begin and end,
 * whatever the browser's zone. These instants must be the ones the antd pickers sent, or a migrated
 * page would silently query a different window. The tests run the boundary cases in several zones,
 * because a browser in UTC or in Kiritimati is a different day from a browser in India.
 */
import { test, describe, afterEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  isDateTimeString,
  isWholeMinuteStep,
  isDayString,
  istDateTimeToIso,
  istDayEnd,
  istDayOf,
  istDayStart,
  istToday,
} from './istDate'

afterEach(() => {
  vi.useRealTimers()
})

describe('isDayString', () => {
  test('accepts a real day and rejects anything else', () => {
    assert.equal(isDayString('2026-09-22'), true)
    assert.equal(isDayString('2024-02-29'), true, 'a leap day is a real day')
    assert.equal(isDayString('2026-02-30'), false)
    assert.equal(isDayString('2026-13-01'), false)
    assert.equal(isDayString('22-09-2026'), false)
    assert.equal(isDayString('2026-09-22T00:00:00Z'), false)
    assert.equal(isDayString(''), false)
    assert.equal(isDayString(undefined), false)
    assert.equal(isDayString(20260922), false)
  })
})

describe('IST day boundaries', () => {
  test('a day starts and ends at the instants the old pickers sent', () => {
    assert.equal(istDayStart('2026-09-22'), '2026-09-21T18:30:00.000Z')
    assert.equal(istDayEnd('2026-09-22'), '2026-09-22T18:29:59.999Z')
  })

  test('the boundaries hold across a year end', () => {
    assert.equal(istDayStart('2027-01-01'), '2026-12-31T18:30:00.000Z')
    assert.equal(istDayEnd('2026-12-31'), '2026-12-31T18:29:59.999Z')
  })

  test('they refuse anything that is not a day', () => {
    assert.throws(() => istDayStart('2026-09-32'), /not a yyyy-MM-dd day/)
    assert.throws(() => istDayEnd(''), /not a yyyy-MM-dd day/)
  })
})

describe('IST local date-times', () => {
  test('accepts only positive whole-minute datetime steps', () => {
    for (const value of [60, 120, 300, 3600]) assert.equal(isWholeMinuteStep(value), true)
    for (const value of [30, 90, 0, -60, 60.5, Number.NaN, Number.POSITIVE_INFINITY, '60']) {
      assert.equal(isWholeMinuteStep(value), false)
    }
  })

  test('accepts only real, minute-precision calendar values', () => {
    assert.equal(isDateTimeString('2026-09-22T14:30'), true)
    assert.equal(isDateTimeString('2024-02-29T00:00'), true)
    assert.equal(isDateTimeString('2026-02-29T12:00'), false)
    assert.equal(isDateTimeString('2026-04-31T12:00'), false)
    assert.equal(isDateTimeString('2026-09-22T24:00'), false)
    assert.equal(isDateTimeString('2026-09-22T23:60'), false)
    assert.equal(isDateTimeString('2026-09-22T14:30:00'), false)
    assert.equal(isDateTimeString('2026-09-22 14:30'), false)
    assert.equal(isDateTimeString(''), false)
    assert.equal(isDateTimeString(undefined), false)
  })

  test('converts an IST calendar value without using the browser timezone', () => {
    assert.equal(istDateTimeToIso('2026-09-22T14:30'), '2026-09-22T09:00:00.000Z')
    assert.equal(istDateTimeToIso('2027-01-01T00:00'), '2026-12-31T18:30:00.000Z')
  })

  test('refuses malformed dates and times instead of letting them roll over', () => {
    for (const value of [
      '2026-02-29T10:00',
      '2026-13-01T10:00',
      '2026-09-22T25:00',
      '2026-09-22T14:60',
      '2026-09-22T14:30Z',
    ]) {
      assert.throws(() => istDateTimeToIso(value), /not a yyyy-MM-ddTHH:mm date-time/)
    }
  })
})

describe('istDayOf', () => {
  test('reads an instant as the IST day it falls in', () => {
    // 18:29Z is still the 22nd in IST; 18:30Z is already the 23rd
    assert.equal(istDayOf('2026-09-22T18:29:59.999Z'), '2026-09-22')
    assert.equal(istDayOf('2026-09-22T18:30:00.000Z'), '2026-09-23')
    assert.equal(istDayOf(new Date('2026-09-21T18:30:00.000Z')), '2026-09-22')
  })

  test('gives an empty string for an unusable input', () => {
    assert.equal(istDayOf('not a date'), '')
    assert.equal(istDayOf(Number.NaN), '')
  })

  test('round-trips a day through its own start and end', () => {
    for (const day of ['2026-01-01', '2026-03-29', '2026-09-22', '2026-12-31']) {
      assert.equal(istDayOf(istDayStart(day)), day)
      assert.equal(istDayOf(istDayEnd(day)), day)
    }
  })
})

describe('istToday', () => {
  test('is the IST day, not the browser day', () => {
    // 20:00 UTC on the 22nd is already the 23rd in IST
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-22T20:00:00.000Z'))
    assert.equal(istToday(), '2026-09-23')

    vi.setSystemTime(new Date('2026-09-22T18:29:00.000Z'))
    assert.equal(istToday(), '2026-09-22')
  })
})
