/**
 * OTP send throttling.
 *
 * requestOtp is reachable without any credential and bills a real SMS on every
 * call, so it previously let one client run up the messaging bill and flood a
 * victim's phone. The counters live on the user_otps row because the row is
 * upserted per (phone, purpose, tenant) and createdAt is not refreshed.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `otp-itest-${randomUUID().slice(0, 8)}`
const PHONE = '+919999000222'
const EXPIRES = () => new Date(Date.now() + 10 * 60 * 1000)

async function clean() {
  const { db } = await import('../../db/client.js')
  const { userOtps } = await import('../../db/schema.js')
  const { eq } = await import('drizzle-orm')
  await db.delete(userOtps).where(eq(userOtps.tenant, TENANT))
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  await clean()
})
after(clean)

describe('OTP send throttling', () => {
  it('reports no sends for a number that has never been used', async () => {
    const { getOtpSendState } = await import('../otpRepo.js')
    const state = await getOtpSendState(PHONE, 'login', TENANT)
    assert.equal(state.sendsInWindow, 0)
    assert.equal(state.lastSentAt, null)
  })

  it('counts each send and records when it happened', async () => {
    const { upsertOtp, getOtpSendState } = await import('../otpRepo.js')
    await upsertOtp({ phone: PHONE, code: '111111', purpose: 'login', expiresAt: EXPIRES(), tenant: TENANT })
    const first = await getOtpSendState(PHONE, 'login', TENANT)
    assert.equal(first.sendsInWindow, 1)
    assert.ok(first.lastSentAt instanceof Date, 'lastSentAt drives the minimum gap between sends')

    await upsertOtp({ phone: PHONE, code: '222222', purpose: 'login', expiresAt: EXPIRES(), tenant: TENANT })
    const second = await getOtpSendState(PHONE, 'login', TENANT)
    assert.equal(second.sendsInWindow, 2, 'the upsert must accumulate, not reset')
  })

  it('keeps counting past the default hourly cap so the caller can refuse', async () => {
    const { upsertOtp, getOtpSendState } = await import('../otpRepo.js')
    for (let i = 0; i < 4; i++) {
      await upsertOtp({ phone: PHONE, code: '333333', purpose: 'login', expiresAt: EXPIRES(), tenant: TENANT })
    }
    const state = await getOtpSendState(PHONE, 'login', TENANT)
    assert.ok(state.sendsInWindow >= 5, `expected at least 5 sends, got ${state.sendsInWindow}`)
  })

  it('tracks each purpose separately', async () => {
    const { upsertOtp, getOtpSendState } = await import('../otpRepo.js')
    await upsertOtp({ phone: PHONE, code: '444444', purpose: 'reset', expiresAt: EXPIRES(), tenant: TENANT })
    const reset = await getOtpSendState(PHONE, 'reset', TENANT)
    assert.equal(reset.sendsInWindow, 1, 'a reset OTP must not inherit the login counter')
  })

  it('treats a stale window as spent, so an old burst does not block forever', async () => {
    const { upsertOtp, getOtpSendState } = await import('../otpRepo.js')
    const { db } = await import('../../db/client.js')
    const { userOtps } = await import('../../db/schema.js')
    const { and, eq } = await import('drizzle-orm')

    await upsertOtp({ phone: PHONE, code: '555555', purpose: 'register', expiresAt: EXPIRES(), tenant: TENANT })
    // Backdate the window past its one-hour life. Match on tenant + purpose:
    // the stored phone is normalised (a +91 prefix is stripped), so the raw
    // value used above would not match the row.
    await db
      .update(userOtps)
      .set({ windowStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), sendsInWindow: 99 })
      .where(and(eq(userOtps.purpose, 'register'), eq(userOtps.tenant, TENANT)))

    const state = await getOtpSendState(PHONE, 'register', TENANT)
    assert.equal(state.sendsInWindow, 0, 'an expired window must not keep the number locked out')
  })
})
