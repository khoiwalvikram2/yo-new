import { and, eq, or, sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../db/client.js'
import { userOtps } from '../db/schema.js'
import { normalizePhoneForLookup } from '../utils/phoneUtils.js'

export type OtpPurpose = 'login' | 'register' | 'reset'

/**
 * Normalize phone number for OTP storage/verification
 * Handles +91 prefix and ensures consistent format
 */
function normalizePhoneForOtp(phone: string): string {
  if (!phone || typeof phone !== 'string') return phone.trim()
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')
  // If starts with 91 and length is 12, remove 91 prefix (store as 10 digits)
  if (digits.startsWith('91') && digits.length === 12) {
    return digits.substring(2)
  }
  // If starts with 0 and length is 11, remove leading 0
  if (digits.startsWith('0') && digits.length === 11) {
    return digits.substring(1)
  }
  return digits
}

export async function upsertOtp(params: { phone: string; code: string; purpose: OtpPurpose; expiresAt: Date; tenant?: string }) {
  const tenant = params.tenant ?? 'default'
  const normalizedPhone = normalizePhoneForOtp(params.phone)
  const codeHash = await bcrypt.hash(params.code, 10)
  const now = new Date()
  await db.insert(userOtps).values({
    tenant,
    phone: normalizedPhone,
    purpose: params.purpose,
    codeHash,
    expiresAt: params.expiresAt,
    attempts: 0,
    consumed: false,
    lastSentAt: now,
    sendsInWindow: 1,
    windowStartedAt: now,
  }).onConflictDoUpdate({
    target: [userOtps.phone, userOtps.purpose, userOtps.tenant],
    set: {
      codeHash,
      expiresAt: params.expiresAt,
      attempts: 0,
      consumed: false,
      lastSentAt: now,
      // Roll the window over when the old one has expired, otherwise keep counting.
      windowStartedAt: sql`case when ${userOtps.windowStartedAt} is null
          or ${userOtps.windowStartedAt} < now() - interval '1 hour'
        then ${now} else ${userOtps.windowStartedAt} end`,
      sendsInWindow: sql`case when ${userOtps.windowStartedAt} is null
          or ${userOtps.windowStartedAt} < now() - interval '1 hour'
        then 1 else ${userOtps.sendsInWindow} + 1 end`,
    },
  })
}

/**
 * How many OTPs have been sent to this phone in the current window, and when
 * the last one went out. Used to refuse a send before it bills an SMS.
 */
export async function getOtpSendState(
  phone: string,
  purpose: OtpPurpose,
  tenant = 'default'
): Promise<{ sendsInWindow: number; lastSentAt: Date | null; windowStartedAt: Date | null }> {
  const normalizedPhone = normalizePhoneForOtp(phone)
  const [row] = await db
    .select({
      sendsInWindow: userOtps.sendsInWindow,
      lastSentAt: userOtps.lastSentAt,
      windowStartedAt: userOtps.windowStartedAt,
    })
    .from(userOtps)
    .where(and(eq(userOtps.phone, normalizedPhone), eq(userOtps.purpose, purpose), eq(userOtps.tenant, tenant)))
    .limit(1)
  if (!row) return { sendsInWindow: 0, lastSentAt: null, windowStartedAt: null }
  // A stale window counts as zero: it will be reset by the next send.
  const windowExpired =
    !row.windowStartedAt || Date.now() - new Date(row.windowStartedAt).getTime() > 60 * 60 * 1000
  return {
    sendsInWindow: windowExpired ? 0 : row.sendsInWindow,
    lastSentAt: row.lastSentAt ? new Date(row.lastSentAt) : null,
    windowStartedAt: row.windowStartedAt ? new Date(row.windowStartedAt) : null,
  }
}


export async function verifyOtp(params: { phone: string; otp: string; purpose: OtpPurpose; maxAttempts: number; tenant?: string }) {
  // OTP is tenant-scoped: only accept OTPs requested for the current site (login isolation)
  const tenant = params.tenant ?? 'default'
  const normalizedPhone = normalizePhoneForOtp(params.phone)
  const phoneFormats = normalizePhoneForLookup(params.phone)

  let rows
  if (phoneFormats.length === 0) {
    rows = await db.select().from(userOtps).where(and(eq(userOtps.phone, normalizedPhone), eq(userOtps.purpose, params.purpose), eq(userOtps.tenant, tenant)))
  } else if (phoneFormats.length === 1) {
    rows = await db.select().from(userOtps).where(and(eq(userOtps.phone, phoneFormats[0]), eq(userOtps.purpose, params.purpose), eq(userOtps.tenant, tenant)))
  } else {
    const conditions = phoneFormats.map(format => eq(userOtps.phone, format))
    rows = await db.select().from(userOtps).where(and(or(...conditions), eq(userOtps.purpose, params.purpose), eq(userOtps.tenant, tenant)))
  }
  
  const otpRow = rows[0]
  
  if (!otpRow) {
    // Log for debugging
    return { valid: false, reason: 'NOT_FOUND' as const }
  }
  if (otpRow.consumed) return { valid: false, reason: 'CONSUMED' as const }
  if (otpRow.attempts >= params.maxAttempts) return { valid: false, reason: 'TOO_MANY_ATTEMPTS' as const }
  if (otpRow.expiresAt && otpRow.expiresAt.getTime() < Date.now()) return { valid: false, reason: 'EXPIRED' as const }

  const match = await bcrypt.compare(params.otp, otpRow.codeHash)
  if (!match) {
    await db.update(userOtps).set({ attempts: otpRow.attempts + 1 }).where(eq(userOtps.id, otpRow.id))
    return { valid: false, reason: 'INVALID' as const }
  }

  await db.update(userOtps).set({ consumed: true, attempts: otpRow.attempts + 1 }).where(eq(userOtps.id, otpRow.id))
  return { valid: true, reason: null as null }
}

