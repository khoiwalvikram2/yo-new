import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  EMPTY_PG_VALUES,
  buildPgSettingsInput,
  mutationErrorMessage,
  pgFormValues,
  pgSettingsSchema,
  secretKeyHelp,
  secretKeyPlaceholder,
  type PgSettings,
  type PgSettingsFormValues,
} from './pgSettingsModel'

function values(overrides: Partial<PgSettingsFormValues> = {}): PgSettingsFormValues {
  return { ...EMPTY_PG_VALUES, displayName: 'UPI (Instant)', ...overrides }
}

function issues(input: PgSettingsFormValues): Record<string, string> {
  const result = pgSettingsSchema.safeParse(input)
  if (result.success) return {}
  const found: Record<string, string> = {}
  for (const issue of result.error.issues) found[issue.path.join('.')] ??= issue.message
  return found
}

const SETTINGS: PgSettings = {
  id: 'pg-1',
  tenant: 'floxi',
  provider: 'WELIVEPAY',
  enabled: true,
  displayName: 'UPI (Instant)',
  secretSiteKeyMasked: 'sk••••23',
  hasSecretSiteKey: true,
  webhookUrl: 'https://api.example.test/webhooks/welivepay/abc123',
  minDeposit: 100,
  maxDeposit: null,
  redirectSuccessUrl: null,
  redirectFailureUrl: 'https://floxi.example.test/payment-failed',
  updatedAt: '2026-10-01T10:00:00.000Z',
}

describe('rules', () => {
  test('Display Name is required as entered, as antd required it', () => {
    assert.deepStrictEqual(issues(values({ displayName: '' })), { displayName: 'Required' })
    assert.deepStrictEqual(issues(values({ displayName: '  ' })), {})
  })

  test('a deposit limit below 10 is named; none or 10 and up pass', () => {
    assert.deepStrictEqual(issues(values({ minDeposit: 5, maxDeposit: 9.5 })), {
      minDeposit: 'Value must be at least 10',
      maxDeposit: 'Value must be at least 10',
    })
    assert.deepStrictEqual(issues(values({ minDeposit: 10, maxDeposit: null })), {})
  })
})

describe('form values and input', () => {
  test('fills the form from the stored settings with an empty secret', () => {
    assert.deepStrictEqual(pgFormValues(SETTINGS), {
      enabled: true,
      displayName: 'UPI (Instant)',
      secretSiteKey: '',
      minDeposit: 100,
      maxDeposit: null,
      redirectSuccessUrl: '',
      redirectFailureUrl: 'https://floxi.example.test/payment-failed',
    })
  })

  test('sends the legacy input in its key order, empty URLs as null and no secret when none is typed', () => {
    const input = buildPgSettingsInput(values({ enabled: true, minDeposit: 100, redirectFailureUrl: 'https://x.test/f' }))
    assert.deepStrictEqual(Object.keys(input), [
      'enabled', 'displayName', 'minDeposit', 'maxDeposit', 'redirectSuccessUrl', 'redirectFailureUrl',
    ])
    assert.deepStrictEqual(input, {
      enabled: true,
      displayName: 'UPI (Instant)',
      minDeposit: 100,
      maxDeposit: null,
      redirectSuccessUrl: null,
      redirectFailureUrl: 'https://x.test/f',
    })
    assert.equal('secretSiteKey' in buildPgSettingsInput(values({ secretSiteKey: '   ' })), false)
  })

  test('a typed secret is trimmed and sent last', () => {
    const input = buildPgSettingsInput(values({ secretSiteKey: '  sk_live_123  ' }))
    assert.equal(Object.keys(input).at(-1), 'secretSiteKey')
    assert.equal(input.secretSiteKey, 'sk_live_123')
  })
})

describe('copy', () => {
  test('describes the stored secret, or says none is set', () => {
    assert.equal(secretKeyHelp(SETTINGS), 'Current: sk••••23. Leave blank to keep unchanged.')
    assert.equal(secretKeyPlaceholder(SETTINGS), '•••• (unchanged)')
    assert.equal(secretKeyHelp({ hasSecretSiteKey: false, secretSiteKeyMasked: null }), 'Not set yet.')
    assert.equal(secretKeyPlaceholder({ hasSecretSiteKey: false }), 'Paste secret_site_key')
    assert.equal(secretKeyHelp(undefined), 'Not set yet.')
  })

  test('uses a mutation message, else the legacy fallback', () => {
    assert.equal(mutationErrorMessage(new Error('Invalid key'), 'Failed to save'), 'Invalid key')
    assert.equal(mutationErrorMessage(new Error(''), 'Failed to save'), 'Failed to save')
    assert.equal(mutationErrorMessage(undefined, 'Failed to regenerate'), 'Failed to regenerate')
  })
})
