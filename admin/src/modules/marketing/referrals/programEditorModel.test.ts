import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  PROGRAM_FORM_DEFAULTS,
  RULE_TYPES,
  VISIBLE_REWARD_TYPES,
  VISIBLE_REWARD_VALUES,
  buildProgramInput,
  nextEnabledModes,
  programErrorToast,
  programFormValues,
  programSaveToast,
  programSchema,
  withoutRevenueShare,
  type ProgramFormValues,
} from './programEditorModel'

/** The first message per field, as useForm shows them. */
function firstErrors(values: ProgramFormValues): Record<string, string> {
  const result = programSchema.safeParse(values)
  if (result.success) return {}
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const path = issue.path.join('.')
    errors[path] ??= issue.message
  }
  return errors
}

const valid: ProgramFormValues = {
  name: 'Default Referral Program',
  enabledModes: ['SIGNUP_CPA'],
  maxDepth: 4,
  minReferralBalanceForCashTransfer: 0,
}

describe('programEditorModel — reward types', () => {
  test('the legacy rule types and the three the settings offer, word for word', () => {
    assert.deepEqual(RULE_TYPES.map((type) => type.value), [
      'SIGNUP_CPA',
      'FIRST_DEPOSIT_PCT',
      'RELOAD_DEPOSITS_PCT',
      'LOSS_SHARE',
      'TURNOVER_MILESTONE',
    ])
    assert.deepEqual(
      VISIBLE_REWARD_TYPES.map((type) => [type.label, type.description]),
      [
        ['Signup CPA', 'Fixed bonus on verified signup (direct only)'],
        ['First Deposit %', 'Percentage of first deposit (direct only)'],
        ['Reload Deposits %', 'Percentage of last N deposits (1-30, direct only)'],
      ],
    )
    assert.deepEqual([...VISIBLE_REWARD_VALUES], ['SIGNUP_CPA', 'FIRST_DEPOSIT_PCT', 'RELOAD_DEPOSITS_PCT'])
  })

  test('a change keeps the earlier order, appends a new type and drops the types without a checkbox', () => {
    const stored = ['FIRST_DEPOSIT_PCT', 'SIGNUP_CPA', 'LOSS_SHARE']
    // The kit group reports option order; antd kept the stored order and appended.
    assert.deepEqual(
      nextEnabledModes(stored, ['SIGNUP_CPA', 'FIRST_DEPOSIT_PCT', 'RELOAD_DEPOSITS_PCT']),
      ['FIRST_DEPOSIT_PCT', 'SIGNUP_CPA', 'RELOAD_DEPOSITS_PCT'],
    )
    assert.deepEqual(nextEnabledModes(stored, ['SIGNUP_CPA']), ['SIGNUP_CPA'])
    assert.deepEqual(nextEnabledModes(['LOSS_SHARE'], []), [])
    assert.deepEqual(nextEnabledModes([], ['RELOAD_DEPOSITS_PCT', 'RELOAD_DEPOSITS_PCT']), ['RELOAD_DEPOSITS_PCT'])
    assert.deepEqual(nextEnabledModes([], ['NOT_OFFERED']), [])
  })
})

describe('programEditorModel — values', () => {
  test('no stored program reads as the legacy initial values', () => {
    assert.deepEqual(PROGRAM_FORM_DEFAULTS, { name: '', enabledModes: [], maxDepth: 4, minReferralBalanceForCashTransfer: 0 })
    assert.deepEqual(programFormValues(null), PROGRAM_FORM_DEFAULTS)
    assert.deepEqual(programFormValues(undefined), PROGRAM_FORM_DEFAULTS)
  })

  test('the stored program: revenue share out, hidden types kept, depth 0 or missing as 4, minimum missing as 0', () => {
    assert.deepEqual(programFormValues({
      id: 'p1',
      name: 'Diwali Referrals',
      enabledModes: ['REVSHARE', 'SIGNUP_CPA', 'LOSS_SHARE'],
      maxDepth: 0,
      minReferralBalanceForCashTransfer: null,
    }), {
      name: 'Diwali Referrals',
      enabledModes: ['SIGNUP_CPA', 'LOSS_SHARE'],
      maxDepth: 4,
      minReferralBalanceForCashTransfer: 0,
    })
    assert.deepEqual(programFormValues({ name: null, enabledModes: null, maxDepth: 2, minReferralBalanceForCashTransfer: 250 }), {
      name: '',
      enabledModes: [],
      maxDepth: 2,
      minReferralBalanceForCashTransfer: 250,
    })
    assert.deepEqual(withoutRevenueShare(['REVSHARE']), [])
  })
})

describe('programEditorModel — validation', () => {
  test('the name: required when empty, else at least three characters (whitespace counts, as antd)', () => {
    assert.deepEqual(firstErrors(valid), {})
    assert.equal(firstErrors({ ...valid, name: '' }).name, 'Program name is required')
    assert.equal(firstErrors({ ...valid, name: 'ab' }).name, 'At least 3 characters')
    assert.equal(firstErrors({ ...valid, name: '   ' }).name, undefined)
  })

  test('the depth: required, whole, from 1 to 4', () => {
    assert.equal(firstErrors({ ...valid, maxDepth: null }).maxDepth, 'Max depth is required')
    assert.equal(firstErrors({ ...valid, maxDepth: 2.5 }).maxDepth, 'Enter a whole number')
    assert.equal(firstErrors({ ...valid, maxDepth: 0 }).maxDepth, 'Must be between 1 and 4')
    assert.equal(firstErrors({ ...valid, maxDepth: 5 }).maxDepth, 'Must be between 1 and 4')
    assert.equal(firstErrors({ ...valid, maxDepth: 1 }).maxDepth, undefined)
  })

  test('the minimum: optional, 0 or more', () => {
    assert.equal(firstErrors({ ...valid, minReferralBalanceForCashTransfer: null }).minReferralBalanceForCashTransfer, undefined)
    assert.equal(firstErrors({ ...valid, minReferralBalanceForCashTransfer: 0 }).minReferralBalanceForCashTransfer, undefined)
    assert.equal(
      firstErrors({ ...valid, minReferralBalanceForCashTransfer: -1 }).minReferralBalanceForCashTransfer,
      'Must be 0 or greater',
    )
  })

  test('at least one reward type, and a hidden stored type counts', () => {
    assert.equal(firstErrors({ ...valid, enabledModes: [] }).enabledModes, 'At least one reward type must be enabled')
    assert.equal(firstErrors({ ...valid, enabledModes: ['LOSS_SHARE'] }).enabledModes, undefined)
  })
})

describe('programEditorModel — the save', () => {
  test('the input in the legacy key order: the name as typed, no revenue share, depth and minimum defaults', () => {
    const input = buildProgramInput({
      name: '  Program  ',
      enabledModes: ['SIGNUP_CPA', 'REVSHARE', 'LOSS_SHARE'],
      maxDepth: null,
      minReferralBalanceForCashTransfer: null,
    })
    assert.deepEqual(Object.keys(input), ['name', 'enabledModes', 'maxDepth', 'minReferralBalanceForCashTransfer'])
    assert.deepEqual(input, {
      name: '  Program  ',
      enabledModes: ['SIGNUP_CPA', 'LOSS_SHARE'],
      maxDepth: 4,
      minReferralBalanceForCashTransfer: 0,
    })
    assert.deepEqual(buildProgramInput(valid), valid)
  })

  test('the legacy notifications: 3 seconds on success, 5 on failure, with their fallbacks', () => {
    assert.deepEqual(programSaveToast({ success: true, message: 'Saved' }), { message: 'Saved', tone: 'ok', duration: 3000 })
    assert.deepEqual(programSaveToast({ success: true, message: '' }), {
      message: 'Program updated successfully',
      tone: 'ok',
      duration: 3000,
    })
    assert.deepEqual(programSaveToast({ success: false, message: 'Name taken' }), { message: 'Name taken', tone: 'error', duration: 5000 })
    assert.deepEqual(programSaveToast({ success: false, message: null }), {
      message: 'Failed to update program',
      tone: 'error',
      duration: 5000,
    })
    assert.deepEqual(programErrorToast(new Error('Network down')), { message: 'Network down', tone: 'error', duration: 5000 })
    assert.deepEqual(programErrorToast({ message: '' }), { message: 'Failed to update program', tone: 'error', duration: 5000 })
  })
})
