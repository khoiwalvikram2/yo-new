/**
 * formatIstClock must convert to Asia/Kolkata before formatting, and label the IST day
 * boundary correctly. main.tsx is not loaded by Vitest, so this file extends dayjs's utc
 * and timezone plugins itself (contracts §10.4) rather than relying on app bootstrap.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { formatIstClock } from './istClock'

dayjs.extend(utc)
dayjs.extend(timezone)

describe('formatIstClock', () => {
  test('converts a UTC instant to its IST date and time', () => {
    const result = formatIstClock(dayjs.utc('2026-09-04T11:49:30Z'))
    assert.equal(result.date, 'Fri, 04 Sep 2026')
    assert.equal(result.time, '17:19 IST')
  })

  test('rolls the date over at the IST day boundary', () => {
    const result = formatIstClock(dayjs.utc('2026-09-04T18:31:00Z'))
    assert.equal(result.date, 'Sat, 05 Sep 2026')
    assert.equal(result.time, '00:01 IST')
  })
})
