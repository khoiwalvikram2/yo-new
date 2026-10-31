import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  CHAT_LIMIT_MIN,
  PERIODS,
  allowanceFromInput,
  boundedAllowanceStep,
  draftValue,
  enteredNumber,
  isDirty,
  loadErrorText,
  saveVariables,
  savedMessage,
  settingsRows,
  stepDirection,
  storedState,
  usage,
  withAllowanceClamped,
  withEdit,
  withTypedAllowance,
  withoutDraft,
  type AiSettingsRow,
} from './aiAssistantSettingsModel'

const FLOXI: AiSettingsRow = {
  tenant: 'floxi',
  enabled: true,
  chatLimit: 500,
  limitPeriod: 'monthly',
  used: 120,
  remaining: 380,
  updatedBy: 'superadmin',
  updatedAt: '2026-10-01T10:00:00.000Z',
}

describe('aiAssistantSettingsModel', () => {
  test('the periods and their labels keep the legacy keys and order', () => {
    assert.deepStrictEqual(PERIODS, [
      { value: 'monthly', label: 'Per month' },
      { value: 'daily', label: 'Per day' },
      { value: 'total', label: 'One-off total' },
    ])
    assert.equal(CHAT_LIMIT_MIN, 0)
  })

  test('unconfigured whitelabels get a closed row, and every row is sorted by tenant', () => {
    const rows = settingsRows([FLOXI, { ...FLOXI, tenant: 'acme', updatedBy: null }], [
      { id: 'floxi', name: 'Floxi Gaming' },
      { id: 'nova', name: 'Nova Play' },
      { id: 'beta', name: 'Beta' },
    ])
    assert.deepStrictEqual(rows.map((row) => row.tenant), ['acme', 'beta', 'floxi', 'nova'])
    assert.deepStrictEqual(rows[1], { tenant: 'beta', enabled: false, chatLimit: 0, limitPeriod: 'monthly', used: 0, remaining: 0 })
    assert.equal(rows[2], FLOXI, 'a configured row is kept as the server sent it')
    assert.deepStrictEqual(settingsRows(undefined, undefined), [])
    assert.deepStrictEqual(settingsRows(undefined, [{ id: 'z' }]).map((row) => row.tenant), ['z'])
  })

  test('drafts: the draft wins, a row is dirty once edited, and Undo or a save drops only its draft', () => {
    assert.equal(draftValue(FLOXI, {}, 'chatLimit'), 500)
    let drafts = withEdit({}, 'floxi', { chatLimit: 20 })
    drafts = withEdit(drafts, 'floxi', { limitPeriod: 'daily' })
    drafts = withEdit(drafts, 'nova', { enabled: true })
    assert.equal(draftValue(FLOXI, drafts, 'chatLimit'), 20)
    assert.equal(draftValue(FLOXI, drafts, 'limitPeriod'), 'daily')
    assert.equal(draftValue(FLOXI, drafts, 'enabled'), true)
    assert.equal(isDirty(drafts, 'floxi'), true)
    assert.equal(isDirty(withEdit({}, 'floxi', { chatLimit: 500 }), 'floxi'), true, 'an edit back to the stored value still counts')
    assert.equal(isDirty({}, 'floxi'), false)
    assert.deepStrictEqual(Object.keys(withoutDraft(drafts, 'floxi')), ['nova'])
  })

  test('allowance input: a cleared field means 0; a negative draft is raised to 0 on blur, nothing else changes', () => {
    assert.equal(allowanceFromInput(null), 0)
    assert.equal(allowanceFromInput(42), 42)
    const negative = withEdit({}, 'floxi', { chatLimit: -5, enabled: false })
    assert.deepStrictEqual(withAllowanceClamped(negative, 'floxi').floxi, { chatLimit: 0, enabled: false })
    const fine = withEdit({}, 'floxi', { chatLimit: 3 })
    assert.equal(withAllowanceClamped(fine, 'floxi'), fine)
    assert.deepStrictEqual(withAllowanceClamped({}, 'floxi'), {}, 'a blur without an edit creates no draft')
  })

  test('a typed allowance never leaves a negative draft, and a raise to the value shown edits nothing', () => {
    assert.deepStrictEqual(withTypedAllowance({}, FLOXI, 20).floxi, { chatLimit: 20 })
    assert.deepStrictEqual(withTypedAllowance({}, FLOXI, null).floxi, { chatLimit: 0 }, 'a cleared field means 0')
    assert.deepStrictEqual(withTypedAllowance({}, FLOXI, -5).floxi, { chatLimit: 0 }, 'raised to 0 at once')
    const zero = { ...FLOXI, chatLimit: 0 }
    assert.deepStrictEqual(withTypedAllowance({}, zero, -5), {}, 'already 0: no draft, the row stays clean')
    const atZero = withEdit({}, 'floxi', { chatLimit: 0, enabled: false })
    assert.equal(withTypedAllowance(atZero, FLOXI, -1), atZero)
    assert.deepStrictEqual(withTypedAllowance({}, zero, null).floxi, { chatLimit: 0 }, 'clearing still edits, as antd did')
    assert.deepStrictEqual(withTypedAllowance({}, FLOXI, 2.5).floxi, { chatLimit: 2.5 }, 'the kit rounds on blur')
  })

  test('arrow steps: the kit steps at 0 or above; below 0 the page stops the step at 0', () => {
    assert.equal(stepDirection('ArrowUp'), 1)
    assert.equal(stepDirection('ArrowDown'), -1)
    assert.equal(stepDirection('Enter'), null)
    assert.equal(enteredNumber('12', 3), 12)
    assert.equal(enteredNumber(' ', 3), 3)
    assert.equal(enteredNumber('-', 3), 3)
    assert.equal(enteredNumber('-.', 3), 3)
    assert.equal(enteredNumber('2.', 3), 2)
    assert.equal(boundedAllowanceStep('5', 5, -1, 1), null, 'in range: the kit steps')
    assert.equal(boundedAllowanceStep('5', 5, 1, 10), null)
    assert.equal(boundedAllowanceStep('0', 0, -1, 1), 0, 'at the floor: the step is taken and goes nowhere')
    assert.equal(boundedAllowanceStep('5', 5, -1, 10), 0, 'Shift+ArrowDown stops at 0')
    assert.equal(boundedAllowanceStep('-5', 0, 1, 1), 1, 'from a typed negative, the step starts at the draft')
    assert.equal(boundedAllowanceStep('', 0, -1, 1), 0)
  })

  test('save variables are the legacy commit: the four keys, in order, from the drafts', () => {
    const variables = saveVariables(FLOXI, withEdit({}, 'floxi', { chatLimit: 20, limitPeriod: 'total' }))
    assert.deepStrictEqual(variables, { tenant: 'floxi', enabled: true, chatLimit: 20, limitPeriod: 'total' })
    assert.deepStrictEqual(Object.keys(variables), ['tenant', 'enabled', 'chatLimit', 'limitPeriod'])
    const unconfigured = settingsRows([], [{ id: 'nova' }])[0] as AiSettingsRow
    assert.deepStrictEqual(saveVariables(unconfigured, withEdit({}, 'nova', { enabled: true })), {
      tenant: 'nova',
      enabled: true,
      chatLimit: 0,
      limitPeriod: 'monthly',
    })
    assert.equal(saveVariables(FLOXI, withEdit({}, 'floxi', { chatLimit: Number.NaN })).chatLimit, 0)
  })

  test('the saved toast text', () => {
    assert.equal(savedMessage({ tenant: 'floxi', enabled: true, chatLimit: 1, limitPeriod: 'daily' }), 'floxi can send 1 message per dai.')
    assert.equal(savedMessage({ tenant: 'floxi', enabled: true, chatLimit: 500, limitPeriod: 'monthly' }), 'floxi can send 500 messages per month.')
    assert.equal(savedMessage({ tenant: 'floxi', enabled: true, chatLimit: 50, limitPeriod: 'total' }), 'floxi can send 50 messages in total.')
    assert.equal(savedMessage({ tenant: 'floxi', enabled: false, chatLimit: 50, limitPeriod: 'total' }), 'The assistant is switched off for floxi.')
  })

  test('a Super Admin refusal reads as who manages the settings; anything else is shown as sent', () => {
    assert.equal(loadErrorText('Only a super admin may read this'), 'These settings are managed by a Super Admin.')
    assert.equal(loadErrorText('Network error'), 'Network error')
  })

  test('usage: the dash with no allowance, the colour steps at 80% and 100%, and the caption', () => {
    assert.equal(usage({ ...FLOXI, chatLimit: 0 }), null)
    assert.deepStrictEqual(usage(FLOXI), { percent: 24, tone: 'acc', text: '120 of 500 · 380 left' })
    assert.equal(usage({ ...FLOXI, used: 399 })?.tone, 'acc')
    assert.equal(usage({ ...FLOXI, used: 400 })?.tone, 'warn')
    assert.deepStrictEqual(usage({ ...FLOXI, used: 600, remaining: 0 }), { percent: 100, tone: 'neg', text: '600 of 500 · 0 left' })
  })

  test('the Status column: Active only when stored on with an allowance, read from the stored row', () => {
    assert.equal(storedState(FLOXI), 'active')
    assert.equal(storedState({ ...FLOXI, chatLimit: 0 }), 'off')
    assert.equal(storedState({ ...FLOXI, enabled: false }), 'off')
    assert.equal(isDirty(withEdit({}, 'floxi', { enabled: false }), 'floxi'), true, 'Save and Undo follow the draft')
  })
})
