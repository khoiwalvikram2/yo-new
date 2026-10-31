import { describe, expect, test } from 'vitest'
import {
  isMissingReferralError,
  qrCodeUrl,
  referralAccess,
  referralQrFilename,
  referralUrl,
  userFrontendUrl,
} from './agentReferralModel'

describe('agentReferralModel', () => {
  test('keeps the exact agent scheme access rule', () => {
    expect(referralAccess(undefined)).toBe('unauthenticated')
    expect(referralAccess({ schemeType: 'SHARING' })).toBe('allowed')
    expect(referralAccess({ schemeType: 'COMMISSION' })).toBe('allowed')
    expect(referralAccess({ schemeType: 'CREDIT' })).toBe('denied')
    expect(referralAccess({ schemeType: 'sharing' })).toBe('denied')
  })

  test('prefers and normalizes the configured user frontend', () => {
    expect(userFrontendUrl(' https://play.example.com/// ', 'https://admin.example.com')).toBe(
      'https://play.example.com',
    )
  })

  test('derives a public host from an admin origin when config is absent', () => {
    expect(userFrontendUrl(undefined, 'https://admin.example.com')).toBe('https://example.com')
    expect(userFrontendUrl('', 'https://example.test/')).toBe('https://example.test')
  })

  test('builds the referral URL only when a code exists', () => {
    expect(referralUrl({ code: 'ABC 123' }, undefined, 'https://admin.example.com')).toBe(
      'https://example.com/r?ref=ABC%20123',
    )
    expect(referralUrl({ code: '  ' }, undefined, 'https://admin.example.com')).toBe('')
    expect(referralUrl(null, undefined, 'https://admin.example.com')).toBe('')
  })

  test('encodes the entire public URL for the QR service', () => {
    expect(qrCodeUrl('https://example.com/r?ref=A B')).toBe(
      'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https%3A%2F%2Fexample.com%2Fr%3Fref%3DA%20B',
    )
  })

  test('makes a safe, stable QR filename', () => {
    expect(referralQrFilename(' VIP / 2026 ')).toBe('referral-qr-VIP-2026.png')
    expect(referralQrFilename('   ')).toBe('referral-qr-code.png')
  })

  test('recognizes only the legacy not-found error family', () => {
    expect(isMissingReferralError('Referral link not found')).toBe(true)
    expect(isMissingReferralError('NOT FOUND')).toBe(true)
    expect(isMissingReferralError('Network failed')).toBe(false)
    expect(isMissingReferralError(undefined)).toBe(false)
  })
})
