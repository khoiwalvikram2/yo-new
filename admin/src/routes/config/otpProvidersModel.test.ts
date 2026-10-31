/**
 * The OTP providers page logic: the provider field tables, the create/edit defaults, the provider-change
 * clearing, the drawer rules, the exact upsert input (the leave-blank-to-keep rule above all) and the copy.
 * Every credential value below is an obvious placeholder.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  META_FIELD_NAMES,
  PROVIDER_META_FIELDS,
  PROVIDER_SECRET_FIELDS,
  SECRET_FIELD_NAMES,
  buildOtpProviderInput,
  cleanString,
  configChips,
  createFormValues,
  credentialPlaceholder,
  detailRows,
  drawerHint,
  drawerSub,
  drawerTitle,
  editFormValues,
  exportTitle,
  filledStars,
  getMaskedValue,
  messageOr,
  metaFieldsFor,
  metaPlaceholder,
  otpExportColumns,
  otpProviderSchema,
  pageSlice,
  priorityLabel,
  providerCountLabel,
  providerLabel,
  secretFieldsFor,
  submitLabel,
  thrownMessage,
  toggleInput,
  toggleSucceededMessage,
  withProvider,
  type OtpFormValues,
  type OtpProviderRow,
} from './otpProvidersModel'

function row(overrides: Partial<OtpProviderRow> = {}): OtpProviderRow {
  return {
    id: 1,
    provider: 'TWILIO',
    region: null,
    senderId: null,
    templateId: null,
    baseUrl: null,
    active: false,
    priority: 1,
    accountSidMasked: null,
    authTokenMasked: null,
    accessKeyMasked: null,
    secretKeyMasked: null,
    apiKeyMasked: null,
    apiSecretMasked: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function issues(mode: 'create' | 'edit', values: OtpFormValues): Record<string, string> {
  const parsed = otpProviderSchema(mode).safeParse(values)
  const found: Record<string, string> = {}
  if (!parsed.success) {
    for (const issue of parsed.error.issues) found[issue.path.join('.')] ??= issue.message
  }
  return found
}

describe('provider field tables', () => {
  test('keep the legacy labels, placeholders, variable names and types per provider', () => {
    assert.deepStrictEqual(
      PROVIDER_META_FIELDS.TWILIO.map((field) => [field.name, field.label, field.placeholder, field.description]),
      [['senderId', 'Sender ID / From Number', '+1XXXXXXXXXX', undefined]],
    )
    assert.deepStrictEqual(
      PROVIDER_META_FIELDS.AWS_SNS.map((field) => [field.name, field.label, field.placeholder, field.description]),
      [
        ['senderId', 'Sender ID', 'OTPMSG', undefined],
        ['region', 'Region', 'ap-south-1', 'AWS_SNS_REGION'],
      ],
    )
    assert.deepStrictEqual(PROVIDER_META_FIELDS.MSG91.map((field) => field.description), ['MSG91_SENDER_ID', 'MSG91_TEMPLATE_ID'])
    assert.deepStrictEqual(PROVIDER_META_FIELDS.TWO_FACTOR.map((field) => field.description), ['DLT / HEADER', 'FACTOR_TEMPLATE_ID'])
    assert.deepStrictEqual(
      Object.fromEntries(
        Object.entries(PROVIDER_SECRET_FIELDS).map(([code, fields]) => [
          code,
          fields.map((field) => `${field.name}:${field.label}:${field.type}:${field.description}`),
        ]),
      ),
      {
        TWILIO: ['accountSid:Account SID:password:TWILIO_ACCOUNT_SID', 'authToken:Auth Token:password:TWILIO_AUTH_TOKEN'],
        AWS_SNS: [
          'accessKey:Access Key ID:password:AWS_SNS_ACCESS_KEY',
          'secretKey:Secret Access Key:password:AWS_SNS_SECRET_KEY',
        ],
        MSG91: ['apiKey:API Key:password:MSG91_API_KEY'],
        TWO_FACTOR: ['apiKey:2Factor API Key:password:FACTOR_API_KEY', 'apiSecret:2Factor Number:text:FACTOR_NUMBER'],
      },
    )
    assert.deepStrictEqual(META_FIELD_NAMES, ['senderId', 'templateId', 'region', 'baseUrl'])
    assert.deepStrictEqual(SECRET_FIELD_NAMES, ['accountSid', 'authToken', 'accessKey', 'secretKey', 'apiKey', 'apiSecret'])
    // An unknown provider code has no fields instead of throwing.
    assert.deepStrictEqual(metaFieldsFor('SOMETHING'), [])
    assert.deepStrictEqual(secretFieldsFor(''), [])
  })

  test('the masked lookup and the string cleaner', () => {
    assert.equal(getMaskedValue(null, 'accountSid'), null)
    assert.equal(getMaskedValue(row({ accountSidMasked: '' }), 'accountSid'), null)
    assert.equal(getMaskedValue(row({ accountSidMasked: 'AC••••42' }), 'accountSid'), 'AC••••42')
    assert.equal(getMaskedValue(row({ apiSecretMasked: '98••••10' }), 'apiSecret'), '98••••10')
    assert.equal(cleanString(undefined), undefined)
    assert.equal(cleanString(''), null)
    assert.equal(cleanString('   '), null)
    assert.equal(cleanString('  OTPMSG '), 'OTPMSG')
  })
})

describe('drawer values', () => {
  test('create starts on Twilio, after the highest priority, active only while nothing is active', () => {
    const empty = createFormValues([])
    assert.equal(empty.provider, 'TWILIO')
    assert.equal(empty.priority, 1)
    assert.equal(empty.active, true)
    for (const name of [...META_FIELD_NAMES, ...SECRET_FIELD_NAMES]) assert.equal(empty[name], undefined, name)

    const withActive = createFormValues([row({ priority: 3, active: true }), row({ id: 2, priority: 0 })])
    assert.equal(withActive.priority, 4)
    assert.equal(withActive.active, false)
    // A negative or missing priority counts as 0.
    assert.equal(createFormValues([row({ priority: -4 })]).priority, 1)
  })

  test('edit takes the stored delivery fields, priority and status, and never a credential', () => {
    const values = editFormValues(
      row({
        provider: 'AWS_SNS',
        senderId: 'OTPMSG',
        region: 'ap-south-1',
        templateId: null,
        baseUrl: 'https://sns.example.test',
        priority: 2,
        active: true,
        accessKeyMasked: 'AK••••QX',
      }),
    )
    assert.equal(values.provider, 'AWS_SNS')
    assert.equal(values.senderId, 'OTPMSG')
    assert.equal(values.region, 'ap-south-1')
    assert.equal(values.templateId, undefined)
    assert.equal(values.baseUrl, 'https://sns.example.test')
    assert.equal(values.priority, 2)
    assert.equal(values.active, true)
    for (const name of SECRET_FIELD_NAMES) assert.equal(values[name], undefined, name)
    assert.equal(editFormValues(row({ priority: null as unknown as number })).priority, 0)
  })

  test('a provider change clears every field the new provider does not use, and keeps the shared ones', () => {
    const twilio: OtpFormValues = {
      ...createFormValues([]),
      senderId: '+14155550123',
      accountSid: 'placeholder-sid',
      authToken: 'placeholder-token',
      baseUrl: 'https://kept.example.test',
    }
    const msg91 = withProvider(twilio, 'MSG91')
    assert.equal(msg91.provider, 'MSG91')
    assert.equal(msg91.senderId, '+14155550123')
    assert.equal(msg91.accountSid, undefined)
    assert.equal(msg91.authToken, undefined)
    assert.equal(msg91.baseUrl, undefined)

    const twoFactor = withProvider({ ...msg91, apiKey: 'placeholder-key', templateId: 'TPL-1' }, 'TWO_FACTOR')
    assert.equal(twoFactor.apiKey, 'placeholder-key')
    assert.equal(twoFactor.templateId, 'TPL-1')
    const back = withProvider(twoFactor, 'TWILIO')
    assert.equal(back.apiKey, undefined)
    assert.equal(back.templateId, undefined)
    assert.equal(back.senderId, '+14155550123')
  })
})

describe('drawer rules', () => {
  test('create requires every delivery field and credential of the chosen provider, as antd judged it', () => {
    assert.deepStrictEqual(issues('create', createFormValues([])), {
      senderId: 'Enter Sender ID / From Number',
      accountSid: 'Enter Account SID',
      authToken: 'Enter Auth Token',
    })
    assert.deepStrictEqual(issues('create', withProvider(createFormValues([]), 'TWO_FACTOR')), {
      senderId: 'Enter Sender ID',
      templateId: 'Enter Template ID',
      apiKey: 'Enter 2Factor API Key',
      apiSecret: 'Enter 2Factor Number',
    })
    // An empty string fails; spaces pass (antd's `required` without `whitespace`).
    assert.deepStrictEqual(
      issues('create', { ...createFormValues([]), senderId: '', accountSid: ' ', authToken: 'placeholder-token' }),
      { senderId: 'Enter Sender ID / From Number' },
    )
  })

  test('edit requires nothing but a provider; priority is a whole number of at least 0 when given', () => {
    assert.deepStrictEqual(issues('edit', editFormValues(row())), {})
    assert.deepStrictEqual(issues('edit', { ...editFormValues(row()), priority: null }), {})
    assert.deepStrictEqual(issues('edit', { ...editFormValues(row()), priority: 1.5 }), { priority: 'Enter a whole number' })
    assert.deepStrictEqual(issues('edit', { ...editFormValues(row()), priority: -1 }), {
      priority: 'Value must be at least 0',
    })
    assert.deepStrictEqual(issues('edit', { ...editFormValues(row()), provider: '' }), { provider: 'Select a provider' })
  })
})

describe('the upsert input', () => {
  test('create: provider, active, priority, then the trimmed delivery fields and the credentials as typed', () => {
    const input = buildOtpProviderInput({
      ...createFormValues([row({ priority: 3, active: true })]),
      senderId: '  +14155550123 ',
      accountSid: ' placeholder-sid',
      authToken: 'placeholder-token',
    })
    assert.deepStrictEqual(Object.keys(input), ['provider', 'active', 'priority', 'senderId', 'accountSid', 'authToken'])
    assert.deepStrictEqual(input, {
      provider: 'TWILIO',
      active: false,
      priority: 4,
      senderId: '+14155550123',
      accountSid: ' placeholder-sid',
      authToken: 'placeholder-token',
    })
  })

  test('edit: untouched fields are left out, an emptied delivery field is null, a blank credential is kept', () => {
    const stored = editFormValues(
      row({ provider: 'MSG91', senderId: 'FLOXIP', templateId: 'TPL-1', priority: 2, apiKeyMasked: 'k1••••9z' }),
    )
    // Nothing touched: the stored delivery fields go back as they were, no credential is sent.
    assert.deepStrictEqual(buildOtpProviderInput(stored), {
      provider: 'MSG91',
      active: false,
      priority: 2,
      senderId: 'FLOXIP',
      templateId: 'TPL-1',
    })
    // An emptied delivery field clears it (legacy), and a credential typed and then emptied, or holding only
    // spaces, is left out, so the stored key is kept as the copy promises (named change: legacy sent '').
    assert.deepStrictEqual(buildOtpProviderInput({ ...stored, templateId: '', apiKey: '' }), {
      provider: 'MSG91',
      active: false,
      priority: 2,
      senderId: 'FLOXIP',
      templateId: null,
    })
    assert.equal('apiKey' in buildOtpProviderInput({ ...stored, apiKey: '   ' }), false)
    assert.equal(buildOtpProviderInput({ ...stored, apiKey: 'placeholder-new-key' }).apiKey, 'placeholder-new-key')
  })

  test('an emptied priority is left out; another provider’s fields and the base URL are never sent', () => {
    const values: OtpFormValues = {
      ...editFormValues(row({ provider: 'AWS_SNS', senderId: 'OTPMSG', region: 'ap-south-1', baseUrl: 'https://x.test' })),
      priority: null,
      accountSid: 'placeholder-sid',
      templateId: 'TPL-1',
    }
    assert.deepStrictEqual(buildOtpProviderInput(values), {
      provider: 'AWS_SNS',
      active: false,
      senderId: 'OTPMSG',
      region: 'ap-south-1',
    })
  })

  test('the row toggle sends the provider and the next state only', () => {
    assert.deepStrictEqual(toggleInput(row({ provider: 'MSG91' }), true), { input: { provider: 'MSG91', active: true } })
    assert.deepStrictEqual(toggleInput(row(), false), { input: { provider: 'TWILIO', active: false } })
  })
})

describe('copy', () => {
  test('toast copy keeps the server message first and the legacy fallbacks', () => {
    assert.equal(toggleSucceededMessage('OTP provider saved', true), 'OTP provider saved')
    assert.equal(toggleSucceededMessage(null, true), 'Provider activated')
    assert.equal(toggleSucceededMessage('', false), 'Provider deactivated')
    assert.equal(messageOr(undefined, 'Failed to save provider'), 'Failed to save provider')
    assert.equal(messageOr('Forbidden', 'Failed to save provider'), 'Forbidden')
    assert.equal(thrownMessage(new Error('Network down'), 'Failed to update provider'), 'Network down')
    assert.equal(thrownMessage(new Error(''), 'Failed to update provider'), 'Failed to update provider')
    assert.equal(thrownMessage('nope', 'Failed to save provider'), 'Failed to save provider')
  })

  test('drawer copy follows the mode and the chosen provider', () => {
    assert.equal(drawerTitle('create', 'MSG91'), 'Add OTP Provider: MSG91')
    assert.equal(drawerTitle('create', ''), 'Add OTP Provider')
    assert.equal(drawerTitle('edit', 'AWS_SNS'), 'Edit OTP Provider: AWS SNS')
    assert.equal(drawerSub('create', 'TWO_FACTOR'), 'Configure 2Factor provider')
    assert.equal(drawerSub('create', ''), 'Configure a new OTP provider')
    assert.equal(drawerSub('edit', 'TWILIO'), 'Update provider configuration')
    assert.equal(drawerHint('create'), 'Configure provider credentials and settings')
    assert.equal(drawerHint('edit'), 'Update credentials to rotate keys; leave blank to keep existing values')
    assert.equal(submitLabel('create'), 'Add Provider')
    assert.equal(submitLabel('edit'), 'Save Changes')
    assert.equal(metaPlaceholder(PROVIDER_META_FIELDS.MSG91[0]), 'Enter Sender ID')
    assert.equal(metaPlaceholder(PROVIDER_META_FIELDS.TWILIO[0]), '+1XXXXXXXXXX')
    const [apiKey, apiSecret] = PROVIDER_SECRET_FIELDS.TWO_FACTOR
    assert.equal(credentialPlaceholder(apiKey, '98••••10'), '••••••••')
    assert.equal(credentialPlaceholder(apiKey, null), 'Enter 2Factor API Key')
    // The 2Factor Number is a plain text field: it never shows the dots.
    assert.equal(credentialPlaceholder(apiSecret, '98••••10'), 'Enter 2Factor Number')
  })

  test('table copy: detail lines, chips, stars, labels and counts', () => {
    const full = row({ senderId: 'OTPMSG', templateId: 'TPL-1', region: 'ap-south-1' })
    assert.deepStrictEqual(detailRows(full), [
      { label: 'Sender ID', value: 'OTPMSG' },
      { label: 'Template ID', value: 'TPL-1' },
      { label: 'Region', value: 'ap-south-1' },
    ])
    assert.deepStrictEqual(detailRows(row({ templateId: 'TPL-1' })), [{ label: 'Template ID', value: 'TPL-1' }])
    assert.deepStrictEqual(configChips(full).map((chip) => `${chip.label}=${chip.value}`), [
      'Sender=OTPMSG',
      'Template=TPL-1',
      'Region=ap-south-1',
    ])
    assert.deepStrictEqual(configChips(row()), [])
    assert.equal(filledStars(3), 3)
    assert.equal(filledStars(9), 5)
    assert.equal(filledStars(0), 0)
    assert.equal(filledStars(null), 0)
    assert.equal(priorityLabel(0), 'Priority: 0')
    assert.equal(priorityLabel(null), 'Priority: 0')
    assert.equal(priorityLabel(7), 'Priority: 7')
    assert.equal(providerCountLabel(0), '0 providers')
    assert.equal(providerCountLabel(1), '1 provider')
    assert.equal(providerCountLabel(12), '12 providers')
    assert.equal(providerLabel('TWO_FACTOR'), '2Factor')
    assert.equal(providerLabel('SOMETHING'), 'SOMETHING')
  })

  test('client paging clamps a page past the end; the export keeps its columns and title', () => {
    const rows = Array.from({ length: 12 }, (_, index) => index + 1)
    assert.deepStrictEqual(pageSlice(rows, 2, 10), [11, 12])
    assert.deepStrictEqual(pageSlice(rows, 5, 10), [11, 12])
    assert.deepStrictEqual(pageSlice(rows, 1, 20), rows)
    assert.deepStrictEqual(pageSlice([], 3, 10), [])

    const columns = otpExportColumns()
    assert.deepStrictEqual(columns.map((column) => [column.header, column.key, column.width]), [
      ['Provider', 'provider', 14],
      ['Region', 'region', 14],
      ['Sender ID', 'senderId', 18],
      ['Template ID', 'templateId', 16],
      ['Priority', 'priority', 8],
      ['Active', 'active', 8],
    ])
    const sample = row({ provider: 'AWS_SNS', region: 'ap-south-1', senderId: 'OTPMSG', priority: 2, active: true })
    assert.deepStrictEqual(columns.map((column) => column.getter?.(sample)), ['AWS SNS', 'ap-south-1', 'OTPMSG', '', 2, 'Yes'])
    assert.deepStrictEqual(columns.map((column) => column.getter?.(row())), ['Twilio', '', '', '', 1, 'No'])
    assert.equal(exportTitle(4), 'OTP Providers — 4 provider(s)')
  })
})

