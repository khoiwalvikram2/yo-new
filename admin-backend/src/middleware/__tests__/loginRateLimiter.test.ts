/**
 * The login rate limiter guards every sign-in in this backend.
 *
 * Two properties matter and neither is obvious from reading the happy path:
 *   - spraying one password across many usernames must be caught, which the
 *     per-identifier budget alone cannot do;
 *   - the map must not grow without bound, because the traffic that fills it is
 *     exactly the unauthenticated traffic this file exists to survive.
 */
import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  clearLoginAttempts,
  loginRateLimiterSize,
  resetLoginRateLimiter,
  LOGIN_RATE_LIMITS,
} from '../loginRateLimiter.js'

const IP = '203.0.113.7'

/** Runs the check and reports whether it refused. */
function refused(ip: string, identifier: string): boolean {
  try {
    checkLoginRateLimit(ip, identifier)
    return false
  } catch {
    return true
  }
}

beforeEach(() => resetLoginRateLimiter())

describe('one account, one address', () => {
  it('allows attempts up to the limit and refuses the next', () => {
    for (let i = 0; i < LOGIN_RATE_LIMITS.maxPerIdentifier; i++) {
      assert.equal(refused(IP, 'alice'), false, `attempt ${i + 1} should be allowed`)
      recordFailedLoginAttempt(IP, 'alice')
    }
    assert.equal(refused(IP, 'alice'), true, 'the attempt after the limit must be refused')
  })

  it('says how long to wait', () => {
    for (let i = 0; i < LOGIN_RATE_LIMITS.maxPerIdentifier; i++) recordFailedLoginAttempt(IP, 'alice')
    try {
      checkLoginRateLimit(IP, 'alice')
      assert.fail('should have been refused')
    } catch (e) {
      assert.match(String(e), /Try again in \d+ minutes/)
    }
  })

  it('forgets the account budget after a success', () => {
    for (let i = 0; i < LOGIN_RATE_LIMITS.maxPerIdentifier; i++) recordFailedLoginAttempt(IP, 'alice')
    assert.equal(refused(IP, 'alice'), true)
    clearLoginAttempts(IP, 'alice')
    assert.equal(refused(IP, 'alice'), false)
  })

  it('does not let one account\'s failures block another', () => {
    for (let i = 0; i < LOGIN_RATE_LIMITS.maxPerIdentifier; i++) recordFailedLoginAttempt(IP, 'alice')
    assert.equal(refused(IP, 'alice'), true)
    assert.equal(refused(IP, 'bob'), false, 'a different account has its own budget')
  })
})

describe('password spraying across accounts', () => {
  it('is caught by the per-address budget', () => {
    // Four tries each against many different usernames: never enough to trip
    // the per-account budget, which is exactly what makes spraying work.
    let blockedAt = -1
    for (let n = 0; n < 200; n++) {
      const user = `victim${n}`
      if (refused(IP, user)) {
        blockedAt = n
        break
      }
      for (let i = 0; i < 4; i++) recordFailedLoginAttempt(IP, user)
    }
    assert.notEqual(blockedAt, -1, 'spraying must eventually be refused')
    assert.ok(
      blockedAt <= Math.ceil(LOGIN_RATE_LIMITS.maxPerAddress / 4) + 1,
      `expected the address budget to bite early, but it took ${blockedAt} accounts`
    )
  })

  it('is not reset by signing in to an account the attacker does hold', () => {
    for (let i = 0; i < LOGIN_RATE_LIMITS.maxPerAddress; i++) {
      recordFailedLoginAttempt(IP, `victim${i}`)
    }
    assert.equal(refused(IP, 'anyone'), true)
    // A success on one account clears only that account.
    clearLoginAttempts(IP, 'attacker-own-account')
    assert.equal(refused(IP, 'anyone'), true, 'the address budget must survive an unrelated success')
  })

  it('does not punish a different address', () => {
    for (let i = 0; i < LOGIN_RATE_LIMITS.maxPerAddress; i++) {
      recordFailedLoginAttempt(IP, `victim${i}`)
    }
    assert.equal(refused(IP, 'alice'), true)
    assert.equal(refused('198.51.100.4', 'alice'), false)
  })
})

describe('the map does not grow without bound', () => {
  it('sweeps entries whose window has closed', () => {
    const realNow = Date.now
    try {
      let clock = 1_000_000
      Date.now = () => clock

      // Each username is tried once from a fresh address: no key is ever
      // checked twice, which is what defeated the previous lazy expiry.
      for (let n = 0; n < 500; n++) recordFailedLoginAttempt(`10.0.${n >> 8}.${n & 255}`, `user${n}`)
      const grown = loginRateLimiterSize()
      assert.ok(grown >= 500, `expected the map to hold the attempts, saw ${grown}`)

      // Move past the window, then let one more attempt trigger the sweep.
      clock += LOGIN_RATE_LIMITS.windowMs + LOGIN_RATE_LIMITS.sweepIntervalMs + 1
      recordFailedLoginAttempt('192.0.2.1', 'someone')

      const after = loginRateLimiterSize()
      assert.ok(after < 10, `expected the expired entries to be swept, ${after} remain`)
    } finally {
      Date.now = realNow
    }
  })

  it('lets an attempt through again once the window has passed', () => {
    const realNow = Date.now
    try {
      let clock = 2_000_000
      Date.now = () => clock
      for (let i = 0; i < LOGIN_RATE_LIMITS.maxPerIdentifier; i++) recordFailedLoginAttempt(IP, 'alice')
      assert.equal(refused(IP, 'alice'), true)
      clock += LOGIN_RATE_LIMITS.windowMs + 1
      assert.equal(refused(IP, 'alice'), false, 'a lockout is a delay, not a ban')
    } finally {
      Date.now = realNow
    }
  })
})
