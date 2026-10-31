/**
 * shellWhitelabelName and brandInitials implement decisions 8 and 14: which name the rail brand tile and
 * environment card show, and how its two-letter initials are derived. Getting either wrong shows a real
 * tenant's name as "GameDash", or the wrong tile, on the whitelabel Admin's own screen.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { DEFAULT_BRAND_INITIALS, DEFAULT_BRAND_NAME, brandInitials, shellWhitelabelName } from './whitelabelName'

describe('shellWhitelabelName', () => {
  test('returns null when the whitelabel is missing', () => {
    assert.equal(shellWhitelabelName(null), null)
    assert.equal(shellWhitelabelName(undefined), null)
  })

  test('returns null for the default sentinel id, even when named "Default"', () => {
    assert.equal(shellWhitelabelName({ id: 'default', name: 'Default' }), null)
  })

  test('returns null when the name is blank or absent', () => {
    assert.equal(shellWhitelabelName({ id: 'wl1', name: '  ' }), null)
    assert.equal(shellWhitelabelName({ id: 'wl1' }), null)
  })

  test('returns the trimmed name for a real tenant', () => {
    assert.equal(shellWhitelabelName({ id: 'wl1', name: ' GoldBet77 ' }), 'GoldBet77')
  })

  test('does not special-case a real tenant literally named "Default"', () => {
    assert.equal(shellWhitelabelName({ id: 'wl2', name: 'Default' }), 'Default')
  })
})

describe('brandInitials', () => {
  test('follows decision 14 (digit-ending, single-character and fallback rules)', () => {
    assert.equal(brandInitials(null), DEFAULT_BRAND_INITIALS)
    assert.equal(brandInitials('GoldBet77'), 'G7')
    assert.equal(brandInitials('Royal Casino'), 'RC')
    assert.equal(brandInitials('Winzo'), 'WI')
    assert.equal(brandInitials('X'), 'X')
    assert.equal(brandInitials('Win-99'), 'W9')
    assert.equal(brandInitials('--'), DEFAULT_BRAND_INITIALS)
    assert.equal(DEFAULT_BRAND_NAME, 'GameDash')
    assert.equal(DEFAULT_BRAND_INITIALS, 'GD')
  })
})
