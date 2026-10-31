import { describe, expect, test } from 'vitest'
import {
  INITIAL_WHITELABEL_VALUES,
  WIZARD_STEPS,
  buildCreateWhitelabelPayload,
  categoryOutcome,
  firstValidationIssue,
  hasRequiredCreateValues,
  isImageFile,
  isSafeImageSource,
  rateReviews,
  statusReview,
  stepFields,
  stepForField,
  thrownMessage,
  whitelabelIdFromDomain,
  whitelabelWizardSchema,
  type WhitelabelWizardValues,
} from './whitelabelWizardModel'

const validValues = (): WhitelabelWizardValues => ({
  ...INITIAL_WHITELABEL_VALUES,
  name: 'Partner Gaming',
  domain: 'partner.example.com',
  adminEmail: 'admin@example.com',
  adminName: 'Partner Admin',
  adminPassword: 'safe-pass-123',
  confirmPassword: 'safe-pass-123',
  adminPhone: '+919999999999',
  sharingRates: { sports: 15, casino: 27.5, matka: 2 },
  logoUrl: 'data:image/png;base64,logo',
  faviconUrl: 'https://cdn.example.com/favicon.png',
  creditLimit: 100000,
})

describe('whitelabel wizard model', () => {
  test('keeps the four legacy step labels and scoped Next fields', () => {
    expect(WIZARD_STEPS).toEqual([
      { title: 'Basic Info', description: 'Name & domains', short: 'Basic' },
      { title: 'Account', description: 'Login & sharing', short: 'Account' },
      { title: 'Branding', description: 'Logo & favicon', short: 'Branding' },
      { title: 'Review', description: 'Confirm changes', short: 'Review' },
    ])
    expect(stepFields(0)).toEqual(['name', 'domain'])
    expect(stepFields(1)).toEqual(['status', 'adminEmail', 'adminName', 'adminPassword', 'confirmPassword'])
    expect(stepFields(2)).toEqual([])
    expect(stepFields(3)).toEqual([])
  })

  test('starts active with the three sharing domains at zero and no assets or credit', () => {
    expect(INITIAL_WHITELABEL_VALUES).toMatchObject({
      status: 'active',
      sharingRates: { sports: 0, casino: 0, matka: 0 },
      logoUrl: null,
      faviconUrl: null,
      creditLimit: null,
    })
    expect(INITIAL_WHITELABEL_VALUES.adminPassword).toBe('')
  })

  test('accepts a fully valid create form', () => {
    expect(whitelabelWizardSchema.safeParse(validValues()).success).toBe(true)
  })

  test.each([
    ['name', '', 'Please enter whitelabel name'],
    ['name', 'A', 'Name must be at least 2 characters'],
    ['domain', '', 'Please enter primary domain'],
    ['domain', 'not-a-domain', 'Enter a valid domain'],
    ['adminEmail', '', 'Please enter admin email'],
    ['adminEmail', 'wrong', 'Please enter a valid email'],
    ['adminName', '', 'Please enter admin name'],
    ['adminName', 'A', 'Name must be at least 2 characters'],
    ['adminPassword', '', 'Please enter password'],
    ['adminPassword', 'short', 'Password must be at least 8 characters'],
    ['confirmPassword', '', 'Please confirm password'],
    ['adminPhone', 'has space', 'Please enter a valid phone number'],
  ] as const)('preserves %s validation copy for %j', (field, value, message) => {
    const values = validValues()
    Object.assign(values, { [field]: value })
    if (field === 'adminPassword' && value !== '') values.confirmPassword = value
    expect(firstValidationIssue(values)?.message).toBe(message)
  })

  test('requires matching confirmation without exposing the password in an error', () => {
    const values = validValues()
    values.confirmPassword = 'different-pass'
    expect(firstValidationIssue(values)).toEqual({ path: 'confirmPassword', message: 'Passwords do not match' })
  })

  test('applies the legacy 0-100 share and non-negative credit rules', () => {
    const high = validValues()
    high.sharingRates.casino = 100.01
    expect(firstValidationIssue(high)).toEqual({ path: 'sharingRates.casino', message: 'Share must be 0-100%' })

    const low = validValues()
    low.sharingRates.sports = -1
    expect(firstValidationIssue(low)).toEqual({ path: 'sharingRates.sports', message: 'Share must be 0-100%' })

    const credit = validValues()
    credit.creditLimit = -1
    expect(firstValidationIssue(credit)).toEqual({ path: 'creditLimit', message: 'Credit limit must be positive' })
  })

  test('maps every field to the step that owns its control', () => {
    expect(stepForField('domain')).toBe(0)
    expect(stepForField('sharingRates.matka')).toBe(1)
    expect(stepForField('adminPhone')).toBe(1)
    expect(stepForField('creditLimit')).toBe(1)
    expect(stepForField('logoUrl')).toBe(2)
    expect(stepForField('_form')).toBe(3)
  })

  test('generates the legacy id exactly from a domain-like string', () => {
    expect(whitelabelIdFromDomain('HTTPS://WWW.Partner.Example.com/path')).toBe('partner-example-com-path')
    expect(whitelabelIdFromDomain('---')).toBe('')
  })

  test('builds the exact create payload, trimming only the legacy text fields', () => {
    const values = validValues()
    values.name = '  Partner Gaming  '
    values.domain = 'partner.example.com'
    values.adminName = '  Partner Admin  '
    values.adminEmail = '  admin@example.com  '
    values.adminPassword = '  keep spaces  '

    expect(buildCreateWhitelabelPayload(values)).toEqual({
      id: 'partner-example-com',
      name: 'Partner Gaming',
      domain: 'partner.example.com',
      sharingRates: [
        { domain: 'sports', shareRate: 15 },
        { domain: 'casino', shareRate: 27.5 },
        { domain: 'matka', shareRate: 2 },
      ],
      partnerAdminName: 'Partner Admin',
      partnerAdminEmail: 'admin@example.com',
      partnerAdminPassword: '  keep spaces  ',
      logoUrl: 'data:image/png;base64,logo',
      faviconUrl: 'https://cdn.example.com/favicon.png',
      creditLimit: 100000,
    })
  })

  test('omits empty rates, zero credit and retired form-only fields from the payload', () => {
    const values = validValues()
    values.sharingRates.sports = null
    values.creditLimit = 0
    values.logoUrl = ''
    values.faviconUrl = ''
    const payload = buildCreateWhitelabelPayload(values)

    expect(payload.sharingRates).toEqual([
      { domain: 'casino', shareRate: 27.5 },
      { domain: 'matka', shareRate: 2 },
    ])
    expect(payload).toMatchObject({ creditLimit: undefined, logoUrl: null, faviconUrl: null })
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('adminPhone')
    expect(payload).not.toHaveProperty('confirmPassword')
    expect(payload).not.toHaveProperty('sharePercent')
  })

  test('retains the legacy defensive required-value check', () => {
    expect(hasRequiredCreateValues(validValues())).toBe(true)
    expect(hasRequiredCreateValues({ ...validValues(), adminName: '' })).toBe(false)
  })

  test('formats review rates and classifications at both boundaries', () => {
    expect(rateReviews(validValues())).toEqual([
      { domain: 'sports', label: 'Sports Share', value: '15.00%', status: 'Standard Share', tone: 'info' },
      { domain: 'casino', label: 'Casino Share', value: '27.50%', status: 'High Share', tone: 'neg' },
      { domain: 'matka', label: 'Matka Share', value: '2.00%', status: 'Low Share', tone: 'ok' },
    ])
    expect(rateReviews({ ...validValues(), sharingRates: { sports: 5, casino: 25, matka: 0 } })[0]?.status).toBe('Standard Share')
  })

  test('keeps all account status labels and descriptions', () => {
    expect(statusReview('active')).toEqual({ label: 'Active', description: 'Full access enabled', tone: 'ok' })
    expect(statusReview('inactive')).toEqual({ label: 'Inactive', description: 'Limited access', tone: 'warn' })
    expect(statusReview('suspend')).toEqual({ label: 'Suspended', description: 'Access blocked', tone: 'neg' })
  })

  test('accepts only the review image source families and image MIME files', () => {
    expect(isSafeImageSource('data:image/png;base64,x')).toBe(true)
    expect(isSafeImageSource('https://cdn.example.com/x.png')).toBe(true)
    expect(isSafeImageSource('javascript:alert(1)')).toBe(false)
    expect(isImageFile({ type: 'image/png' } as File)).toBe(true)
    expect(isImageFile({ type: 'text/plain' } as File)).toBe(false)
  })

  test('maps category generation success, no-work and refusal copy exactly', () => {
    expect(categoryOutcome({ success: true, categoriesCreated: 2, gamesAssigned: 8 })).toEqual({
      tone: 'ok', message: 'Casino categories generated.',
    })
    expect(categoryOutcome({ success: true, categoriesCreated: 0, gamesAssigned: 0 })).toEqual({
      tone: 'info',
      message: 'No categories created. Enable at least one casino provider (Gap or GMAG) for this whitelabel.',
    })
    expect(categoryOutcome({ success: false })).toEqual({ tone: 'error', message: 'Failed to generate categories.' })
    expect(categoryOutcome({ success: false, message: 'Provider disabled' })).toEqual({
      tone: 'error', message: 'Provider disabled',
    })
  })

  test('uses direct, GraphQL and fallback thrown messages in order', () => {
    expect(thrownMessage(new Error('Network down'), 'Fallback')).toBe('Network down')
    expect(thrownMessage({ graphQLErrors: [{ message: 'GraphQL failed' }] }, 'Fallback')).toBe('GraphQL failed')
    expect(thrownMessage({}, 'Fallback')).toBe('Fallback')
  })
})
