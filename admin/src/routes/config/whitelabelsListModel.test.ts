import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  CREDIT_FIELD_ORDER,
  EMPTY_RESET_PASSWORD,
  RESET_PASSWORD_FIELD_ORDER,
  adjustCreditVariables,
  appConfigurationPath,
  clampPage,
  codePointLength,
  countLabel,
  creditFormSchema,
  creditInitialValues,
  creditStanding,
  creditUsageHue,
  filterWhitelabels,
  firstValidationError,
  isSuperAdminRole,
  pageSlice,
  rateBand,
  resetPasswordSchema,
  resetPasswordVariables,
  shareChipText,
  shareRatesExportText,
  shareRatesFor,
  themeSwatches,
  whitelabelStats,
  whitelabelStatusLabel,
  whitelabelStatusTone,
  type Whitelabel,
} from './whitelabelsListModel'

const ALPHA: Whitelabel = {
  id: 'wl-alpha',
  name: 'Alpha Partner',
  domain: 'alpha.example',
  status: 'active',
  sharingRates: [
    { domain: 'sports', rate: 12.5 },
    { domain: 'casino', rate: 4 },
  ],
  creditLimit: 1000,
  creditUsed: 750,
  creditAvailable: 250,
  creditAlertThreshold: 70,
  theme: {
    primary: 'primary-value',
    success: 'success-value',
    warning: 'warning-value',
    danger: 'danger-value',
    bgPage: 'background-value',
    textPrimary: 'text-primary-value',
    textSecondary: 'text-secondary-value',
    border: 'border-value',
  },
}

const BETA: Whitelabel = {
  id: 'wl-beta',
  name: 'Beta Network',
  domain: 'beta.example',
  status: 'inactive',
  sharingRates: [{ domain: 'matka', rate: 30 }],
  creditLimit: 500,
  creditUsed: 100,
  creditAvailable: 400,
}

describe('whitelabel list model', () => {
  test('keeps the legacy role spellings and the local name/domain/id search', () => {
    assert.equal(isSuperAdminRole(['Super Admin']), true)
    assert.equal(isSuperAdminRole(['super_admin']), true)
    assert.equal(isSuperAdminRole(['Platform SUPER support ADMIN']), true)
    assert.equal(isSuperAdminRole(['Support Admin']), false)
    assert.equal(isSuperAdminRole(undefined), false)
    assert.deepEqual(filterWhitelabels([ALPHA, BETA], ''), [ALPHA, BETA])
    assert.deepEqual(filterWhitelabels([ALPHA, BETA], ' ALPHA '), [ALPHA])
    assert.deepEqual(filterWhitelabels([ALPHA, BETA], 'BETA.EXAMPLE'), [BETA])
    assert.deepEqual(filterWhitelabels([ALPHA, BETA], 'wl-alpha'), [ALPHA])
  })

  test('clamps stale pages and slices the clamped page', () => {
    const rows = Array.from({ length: 23 }, (_, index) => index + 1)
    assert.equal(clampPage(0, rows.length, 10), 1)
    assert.equal(clampPage(99, rows.length, 10), 3)
    assert.equal(clampPage(Number.NaN, rows.length, 10), 1)
    assert.equal(clampPage(3, 0, 10), 1)
    assert.deepEqual(pageSlice(rows, 1, 10), rows.slice(0, 10))
    assert.deepEqual(pageSlice(rows, 99, 10), [21, 22, 23])
    assert.equal(countLabel(1), '1 whitelabel')
    assert.equal(countLabel(2), '2 whitelabels')
  })

  test('normalises the three share chips and preserves export copy', () => {
    assert.deepEqual(shareRatesFor(ALPHA), [
      { domain: 'sports', rate: 12.5 },
      { domain: 'casino', rate: 4 },
      { domain: 'matka', rate: 0 },
    ])
    assert.equal(shareChipText({ domain: 'sports', rate: 12.5 }), 'Sports: 12.50%')
    assert.equal(shareRatesExportText(ALPHA), 'sports: 12.50%, casino: 4.00%, matka: 0.00%')
    assert.equal(appConfigurationPath(ALPHA.id), '/config/app-configuration?whitelabelId=wl-alpha')
  })

  test('keeps status vocabulary and credit threshold rules', () => {
    assert.equal(whitelabelStatusLabel('active'), 'Active')
    assert.equal(whitelabelStatusLabel('inactive'), 'Inactive')
    assert.equal(whitelabelStatusLabel('ACTIVE'), 'Suspended')
    assert.equal(whitelabelStatusTone('active'), 'ok')
    assert.equal(whitelabelStatusTone('inactive'), 'warn')
    assert.equal(whitelabelStatusTone(null), 'neg')
    assert.deepEqual(creditStanding(ALPHA), { available: 250, usageText: '75.0% used', tone: 'warn' })
    assert.deepEqual(creditStanding({ creditAvailable: -1, creditLimit: 10 }), {
      available: -1,
      usageText: '110.0% used',
      tone: 'neg',
    })
    assert.deepEqual(creditStanding({ creditAvailable: 80, creditLimit: 100 }), {
      available: 80,
      usageText: '20.0% used',
      tone: 'ok',
    })
  })

  test('keeps drawer rate bands and theme order', () => {
    assert.deepEqual(rateBand(26), { label: 'High', tone: 'neg', meterTone: 'neg' })
    assert.deepEqual(rateBand(4.99), { label: 'Low', tone: 'ok', meterTone: 'acc' })
    assert.deepEqual(rateBand(5), { label: 'Standard', tone: 'info', meterTone: 'acc' })
    assert.deepEqual(themeSwatches(ALPHA.theme!), [
      { label: 'Primary', value: 'primary-value' },
      { label: 'Success', value: 'success-value' },
      { label: 'Warning', value: 'warning-value' },
      { label: 'Danger', value: 'danger-value' },
      { label: 'Background', value: 'background-value' },
      { label: 'Text Primary', value: 'text-primary-value' },
      { label: 'Text Secondary', value: 'text-secondary-value' },
      { label: 'Border', value: 'border-value' },
    ])
  })
})

describe('whitelabel statistics', () => {
  test('calculates all four cards with the legacy active and domain rules', () => {
    assert.deepEqual(whitelabelStats([ALPHA, { ...BETA, status: 'ACTIVE' }]), {
      totalWhitelabels: 2,
      activeWhitelabels: 2,
      inactiveWhitelabels: 0,
      totalDomains: 5,
      primaryDomains: 2,
      extraDomains: 3,
      totalCreditLimit: 1500,
      totalCreditUsed: 850,
      creditUtilization: 57,
      activeRate: 100,
    })
    assert.deepEqual(whitelabelStats([]), {
      totalWhitelabels: 0,
      activeWhitelabels: 0,
      inactiveWhitelabels: 0,
      totalDomains: 0,
      primaryDomains: 0,
      extraDomains: 0,
      totalCreditLimit: 0,
      totalCreditUsed: 0,
      creditUtilization: 0,
      activeRate: 0,
    })
    assert.equal(creditUsageHue(60), 'ind')
    assert.equal(creditUsageHue(61), 'red')
  })
})

describe('whitelabel mutation forms', () => {
  test('validates credit exactly and builds the default-reason variables', () => {
    assert.deepEqual(creditInitialValues({ creditLimit: null }), { creditLimit: 0, reason: '' })
    assert.equal(firstValidationError(creditFormSchema, { creditLimit: null, reason: '' }, CREDIT_FIELD_ORDER), 'Please enter credit limit')
    assert.equal(firstValidationError(creditFormSchema, { creditLimit: -1, reason: '' }, CREDIT_FIELD_ORDER), 'Credit limit must be positive')
    assert.equal(firstValidationError(creditFormSchema, { creditLimit: 0, reason: '' }, CREDIT_FIELD_ORDER), null)
    assert.deepEqual(adjustCreditVariables(ALPHA.id, { creditLimit: 2000, reason: '' }), {
      input: {
        whitelabelId: ALPHA.id,
        creditLimit: 2000,
        reason: 'Credit adjustment by Super Admin',
      },
    })
  })

  test('validates password order, matching and Unicode length', () => {
    assert.deepEqual(EMPTY_RESET_PASSWORD, { adminEmail: '', newPassword: '', confirmPassword: '', adminPassword: '' })
    assert.equal(codePointLength('😀😀😀😀😀😀'), 6)
    assert.equal(firstValidationError(resetPasswordSchema, EMPTY_RESET_PASSWORD, RESET_PASSWORD_FIELD_ORDER), 'Please enter a new password')
    assert.equal(firstValidationError(resetPasswordSchema, {
      adminEmail: '', newPassword: '12345', confirmPassword: 'other', adminPassword: '',
    }, RESET_PASSWORD_FIELD_ORDER), 'Password must be at least 6 characters')
    assert.equal(firstValidationError(resetPasswordSchema, {
      adminEmail: '', newPassword: 'secret1', confirmPassword: 'secret2', adminPassword: 'owner',
    }, RESET_PASSWORD_FIELD_ORDER), 'Passwords do not match')
    assert.equal(firstValidationError(resetPasswordSchema, {
      adminEmail: '', newPassword: 'secret1', confirmPassword: 'secret1', adminPassword: 'owner',
    }, RESET_PASSWORD_FIELD_ORDER), null)
  })

  test('trims only the optional admin email and keeps the exact reset variables', () => {
    assert.deepEqual(resetPasswordVariables(ALPHA.id, {
      adminEmail: ' admin@alpha.example ',
      newPassword: ' secret1 ',
      confirmPassword: ' secret1 ',
      adminPassword: ' owner ',
    }), {
      whitelabelId: ALPHA.id,
      adminEmail: 'admin@alpha.example',
      newPassword: ' secret1 ',
      adminPassword: ' owner ',
    })
    assert.equal(resetPasswordVariables(ALPHA.id, {
      adminEmail: '   ', newPassword: 'secret1', confirmPassword: 'secret1', adminPassword: 'owner',
    }).adminEmail, null)
  })
})
