/**
 * formatBadgeCount is the single rule for turning a raw count into badge text: nothing at 0 (or
 * negative / NaN / non-finite), the plain number below max, and `${max}+` above it. Every badge
 * consumer (Rail, ContextPanel rows, the notification bell) calls this instead of re-deriving the
 * rule, so a wrong case here would show a wrong count everywhere they render.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { formatBadgeCount } from './badgeCount'

describe('formatBadgeCount', () => {
  test('returns null at zero', () => {
    assert.equal(formatBadgeCount(0), null)
  })

  test('returns null for a negative count', () => {
    assert.equal(formatBadgeCount(-3), null)
  })

  test('returns null for NaN', () => {
    assert.equal(formatBadgeCount(Number.NaN), null)
  })

  test('returns null for a non-finite count', () => {
    assert.equal(formatBadgeCount(Infinity), null)
  })

  test('floors a fractional count below 1 to null', () => {
    assert.equal(formatBadgeCount(0.4), null)
  })

  test('returns the plain number below max', () => {
    assert.equal(formatBadgeCount(1), '1')
    assert.equal(formatBadgeCount(99), '99')
  })

  test('returns "99+" above the default max of 99', () => {
    assert.equal(formatBadgeCount(100), '99+')
  })

  test('uses a custom max', () => {
    assert.equal(formatBadgeCount(12, 9), '9+')
  })
})
