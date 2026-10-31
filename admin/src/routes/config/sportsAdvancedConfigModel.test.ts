import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  ALERT_CHANNEL_OPTIONS,
  ALERT_RATE_LIMIT_FIELD,
  BACK_TO_BASIC_CONFIG,
  COMMISSION_FIELDS,
  DEFAULT_TIER_ID,
  DELAY_FIELDS,
  EXPOSURE_GROUPS,
  ODDS_FIELDS,
  RISK_LEVEL_OPTIONS,
  RISK_NUMBER_FIELDS,
  SETTINGS_FIELD_NAMES,
  STAKE_GROUPS,
  TAB_ITEMS,
  configuringLabel,
  fixFieldsText,
  leagueSaveOutcome,
  leagueSettingsVariables,
  pickerOptions,
  seedKey,
  settingsFormValues,
  settingsPayload,
  settingsSchema,
  sportSaveOutcome,
  sportSettingsVariables,
  thrownMessage,
  withRetainedOption,
  type NumberFieldSpec,
  type SettingsFormValues,
} from './sportsAdvancedConfigModel'

/** Every field the two settings queries select, minus the ids and the tier (the legacy form's 33 items). */
const QUERY_FIELDS = [
  'exchangeMinStake',
  'exchangeMaxStake',
  'bookmakerMinStake',
  'bookmakerMaxStake',
  'fancyMinStake',
  'fancyMaxStake',
  'exchangeDelay',
  'bookmakerDelay',
  'fancyDelay',
  'exchangeCooldown',
  'bookmakerCooldown',
  'fancyCooldown',
  'exchangeMinOdds',
  'exchangeMaxOdds',
  'exchangeCommission',
  'bookmakerCommission',
  'fancyCommission',
  'exchangeExposureDaily',
  'exchangeExposureWeekly',
  'exchangeExposureCap',
  'bookmakerExposureDaily',
  'bookmakerExposureWeekly',
  'bookmakerExposureCap',
  'fancyExposureDaily',
  'fancyExposureWeekly',
  'fancyExposureCap',
  'cashoutActive',
  'riskLevel',
  'riskThreshold',
  'volatilityThreshold',
  'alertOnBreach',
  'alertChannel',
  'alertRateLimit',
]

const spec = (field: NumberFieldSpec) => [
  field.name,
  field.label,
  field.placeholder,
  field.min,
  field.max ?? null,
  field.step,
  Boolean(field.percent),
  Boolean(field.currency),
]

async function issues(values: SettingsFormValues) {
  const result = await settingsSchema.safeParseAsync(values)
  if (result.success) return {}
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

describe('sportsAdvancedConfigModel', () => {
  test('the form holds exactly the queried settings, in the legacy form order', () => {
    assert.equal(SETTINGS_FIELD_NAMES.length, 33)
    assert.deepStrictEqual([...SETTINGS_FIELD_NAMES].sort(), [...QUERY_FIELDS].sort())
    assert.deepStrictEqual(SETTINGS_FIELD_NAMES.slice(0, 4), [
      'exchangeCommission',
      'bookmakerCommission',
      'fancyCommission',
      'exchangeMinStake',
    ])
    assert.deepStrictEqual(SETTINGS_FIELD_NAMES.slice(-4), ['cashoutActive', 'alertOnBreach', 'alertChannel', 'alertRateLimit'])
    assert.deepStrictEqual(Object.keys(settingsSchema.shape).sort(), [...QUERY_FIELDS].sort())
    assert.equal(DEFAULT_TIER_ID, 'default')
    assert.equal(BACK_TO_BASIC_CONFIG, '/config/app-configuration?tab=sports')
    assert.deepStrictEqual(
      TAB_ITEMS.map((item) => [item.value, item.label]),
      [
        ['sport', 'Sport-Level Settings'],
        ['league', 'League-Level Settings'],
      ],
    )
  })

  test('every field keeps its legacy label, placeholder, bounds, step and adornment', () => {
    assert.deepStrictEqual(COMMISSION_FIELDS.map(spec), [
      ['exchangeCommission', 'Exchange Commission', '5.0', 0, 100, 0.1, true, false],
      ['bookmakerCommission', 'Bookmaker Commission', '3.0', 0, 100, 0.1, true, false],
      ['fancyCommission', 'Fancy Commission', '2.0', 0, 100, 0.1, true, false],
    ])
    assert.deepStrictEqual(
      STAKE_GROUPS.map((group) => [group.title, group.fields.map(spec)]),
      [
        ['Exchange Markets', [
          ['exchangeMinStake', 'Minimum Stake', '10', 0, null, 1, false, true],
          ['exchangeMaxStake', 'Maximum Stake', '100000', 0, null, 100, false, true],
        ]],
        ['Bookmaker Markets', [
          ['bookmakerMinStake', 'Minimum Stake', '10', 0, null, 1, false, true],
          ['bookmakerMaxStake', 'Maximum Stake', '100000', 0, null, 100, false, true],
        ]],
        ['Fancy Markets', [
          ['fancyMinStake', 'Minimum Stake', '10', 0, null, 1, false, true],
          ['fancyMaxStake', 'Maximum Stake', '100000', 0, null, 100, false, true],
        ]],
      ],
    )
    assert.deepStrictEqual(
      EXPOSURE_GROUPS.map((group) => [group.title, group.fields.map(spec)]),
      ['exchange', 'bookmaker', 'fancy'].map((market, index) => [
        ['Exchange Markets', 'Bookmaker Markets', 'Fancy Markets'][index],
        [
          [`${market}ExposureDaily`, 'Daily Limit', '1000000', 0, null, 1000, false, true],
          [`${market}ExposureWeekly`, 'Weekly Limit', '5000000', 0, null, 1000, false, true],
          [`${market}ExposureCap`, 'Total Cap', '10000000', 0, null, 10000, false, true],
        ],
      ]),
    )
    assert.deepStrictEqual(
      DELAY_FIELDS.map((field) => [field.name, field.label, field.placeholder, field.min, field.step]),
      [
        ['exchangeDelay', 'Exchange Delay', '0', 0, 1],
        ['bookmakerDelay', 'Bookmaker Delay', '0', 0, 1],
        ['fancyDelay', 'Fancy Delay', '0', 0, 1],
        ['exchangeCooldown', 'Exchange Cooldown', '0', 0, 1],
        ['bookmakerCooldown', 'Bookmaker Cooldown', '0', 0, 1],
        ['fancyCooldown', 'Fancy Cooldown', '0', 0, 1],
      ],
    )
    assert.deepStrictEqual(ODDS_FIELDS.map(spec), [
      ['exchangeMinOdds', 'Exchange Minimum Odds', '1.01', 1, null, 0.01, false, false],
      ['exchangeMaxOdds', 'Exchange Maximum Odds', '1000', 1, null, 1, false, false],
    ])
    assert.deepStrictEqual(RISK_NUMBER_FIELDS.map(spec), [
      ['riskThreshold', 'Risk Threshold', '0.5', 0, null, 0.1, false, false],
      ['volatilityThreshold', 'Volatility Threshold', '0.3', 0, null, 0.1, false, false],
    ])
    assert.deepStrictEqual(spec(ALERT_RATE_LIMIT_FIELD), [
      'alertRateLimit',
      'Alert Rate Limit (per hour)',
      '10',
      1,
      null,
      1,
      false,
      false,
    ])
    assert.deepStrictEqual(RISK_LEVEL_OPTIONS.map((option) => option.label), ['Low', 'Medium', 'High'])
    assert.deepStrictEqual(ALERT_CHANNEL_OPTIONS.map((option) => option.value), ['email', 'sms', 'webhook'])
  })

  test('the legacy rules with antdâ€™s messages; empty fields and the unruled ones pass', async () => {
    assert.deepStrictEqual(await issues({}), {})
    assert.deepStrictEqual(await issues({ exchangeCommission: null, exchangeMinStake: null }), {})
    assert.deepStrictEqual(
      await issues({ exchangeCommission: 100.5, fancyCommission: -1, bookmakerCommission: 100 }),
      {
        exchangeCommission: 'Exchange Commission must be between 0-100',
        fancyCommission: 'Fancy Commission must be between 0-100',
      },
    )
    assert.deepStrictEqual(await issues({ bookmakerMaxStake: -1, fancyExposureCap: -0.5, exchangeExposureWeekly: 0 }), {
      bookmakerMaxStake: 'Maximum Stake must be minimum 0',
      fancyExposureCap: 'Total Cap must be minimum 0',
    })
    assert.deepStrictEqual(
      await issues({ exchangeDelay: -3, exchangeMinOdds: 0.5, alertRateLimit: 0, riskThreshold: -1 }),
      {},
      'the legacy InputNumber min only clamped these; no rule refused them',
    )
  })

  test('a loaded record seeds the form with its 33 fields, nulls included, and nothing else', () => {
    const record = {
      __typename: 'LeagueSettings',
      id: '7',
      leagueId: '21',
      tierId: 'default',
      exchangeCommission: 2.5,
      exchangeMaxStake: null,
      cashoutActive: true,
      riskLevel: 'medium',
    }
    assert.deepStrictEqual(settingsFormValues(record), {
      exchangeCommission: 2.5,
      exchangeMaxStake: null,
      cashoutActive: true,
      riskLevel: 'medium',
    })
    assert.deepStrictEqual(settingsFormValues(null), {})
    assert.deepStrictEqual(settingsFormValues(undefined), {})
    assert.equal(seedKey(settingsFormValues(record)), seedKey({ ...settingsFormValues(record) }))
    assert.notEqual(seedKey({ exchangeCommission: 2.5 }), seedKey({ exchangeCommission: 3 }))
    assert.equal(seedKey({}), seedKey({ exchangeCommission: null }), 'empty and null seed the same form')
  })

  test('the payload keeps nulls, drops never-set fields and follows the form order', () => {
    const values: SettingsFormValues = {
      alertRateLimit: 10,
      exchangeCommission: 2.5,
      bookmakerCommission: null,
      cashoutActive: false,
      riskLevel: undefined,
    }
    const payload = settingsPayload(values)
    assert.deepStrictEqual(payload, {
      exchangeCommission: 2.5,
      bookmakerCommission: null,
      cashoutActive: false,
      alertRateLimit: 10,
    })
    assert.deepStrictEqual(Object.keys(payload), ['exchangeCommission', 'bookmakerCommission', 'cashoutActive', 'alertRateLimit'])
  })

  test('the two upserts take the legacy shapes', () => {
    const values: SettingsFormValues = { exchangeCommission: 3, alertChannel: 'sms' }
    const sport = sportSettingsVariables('1', 'default', values)
    assert.deepStrictEqual(sport, {
      input: { sportIds: ['1'], tierId: 'default', mode: 'overwrite', exchangeCommission: 3, alertChannel: 'sms' },
    })
    assert.deepStrictEqual(Object.keys(sport.input), ['sportIds', 'tierId', 'mode', 'exchangeCommission', 'alertChannel'])
    assert.deepStrictEqual(sportSettingsVariables('2', 'default', {}), {
      input: { sportIds: ['2'], tierId: 'default', mode: 'overwrite' },
    })
    const league = leagueSettingsVariables('21', 'default', values)
    assert.deepStrictEqual(league, {
      leagueIds: ['21'],
      input: { tierId: 'default', exchangeCommission: 3, alertChannel: 'sms' },
    })
    assert.deepStrictEqual(Object.keys(league), ['leagueIds', 'input'])
  })

  test('pickers, the configuring tag, retained options and the save outcomes', () => {
    assert.deepStrictEqual(pickerOptions([{ id: '1', name: 'Cricket' }, { id: '2', name: null }]), [
      { value: '1', label: 'Cricket' },
      { value: '2', label: '' },
    ])
    assert.deepStrictEqual(pickerOptions(undefined), [])
    assert.equal(configuringLabel([{ id: '1', name: 'Cricket' }], '1'), 'Configuring: Cricket')
    assert.equal(configuringLabel([], '1'), 'Configuring: ')
    assert.deepStrictEqual(withRetainedOption(RISK_LEVEL_OPTIONS, 'medium'), [...RISK_LEVEL_OPTIONS])
    assert.deepStrictEqual(withRetainedOption(RISK_LEVEL_OPTIONS, null), [...RISK_LEVEL_OPTIONS])
    assert.deepStrictEqual(withRetainedOption(ALERT_CHANNEL_OPTIONS, 'telegram').at(-1), {
      value: 'telegram',
      label: 'telegram',
    })

    assert.deepStrictEqual(sportSaveOutcome({ success: true, message: 'Saved for 1 sport' }), {
      ok: true,
      message: 'Saved for 1 sport',
    })
    assert.deepStrictEqual(sportSaveOutcome({ success: true, message: null }), {
      ok: true,
      message: 'Sport settings saved successfully',
    })
    assert.deepStrictEqual(sportSaveOutcome({ success: false }), { ok: false, message: 'Failed to save sport settings' })
    assert.deepStrictEqual(sportSaveOutcome(undefined), { ok: false, message: 'Failed to save sport settings' })
    assert.deepStrictEqual(leagueSaveOutcome({ success: true }), {
      ok: true,
      message: 'League settings saved successfully',
    })
    assert.deepStrictEqual(leagueSaveOutcome({ success: false, message: 'Unknown league' }), {
      ok: false,
      message: 'Unknown league',
    })
    assert.equal(thrownMessage(new Error('Forbidden'), 'x'), 'Forbidden')
    assert.equal(thrownMessage(new Error(''), 'Failed to save league settings'), 'Failed to save league settings')
    assert.equal(thrownMessage(null, 'Failed to save sport settings'), 'Failed to save sport settings')
    assert.equal(fixFieldsText(1), 'Fix 1 highlighted field and save again.')
    assert.equal(fixFieldsText(3), 'Fix 3 highlighted fields and save again.')
  })
})

