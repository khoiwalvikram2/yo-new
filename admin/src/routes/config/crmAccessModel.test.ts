import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  EMPTY_FIRST_ADMIN,
  SEAT_LIMIT_MAX,
  SEAT_LIMIT_MIN,
  boundedSeatStep,
  canCreateFirstAdmin,
  clampSeatLimit,
  crmAddress,
  draftValue,
  enteredNumber,
  firstAdminIssues,
  firstAdminOutcome,
  firstAdminSchema,
  firstAdminTitle,
  firstAdminVariables,
  isDirty,
  saveVariables,
  savedMessage,
  seatLimitFromInput,
  seatUsage,
  stepDirection,
  withEdit,
  withSeatLimitClamped,
  withTypedSeatLimit,
  withoutDraft,
  type CrmAccessRow,
} from './crmAccessModel'

const ROW: CrmAccessRow = {
  tenant: 'floxi',
  name: 'Floxi Gaming',
  domain: 'https://floxi.example',
  enabled: true,
  seatLimit: 5,
  seatsUsed: 2,
}

describe('crmAccessModel', () => {
  test('drafts: the draft wins over the stored value, a row is dirty once edited, and a save drops only its draft', () => {
    assert.equal(draftValue(ROW, {}, 'enabled'), true)
    assert.equal(draftValue(ROW, {}, 'seatLimit'), 5)
    let drafts = withEdit({}, 'floxi', { enabled: false })
    drafts = withEdit(drafts, 'floxi', { seatLimit: 9 })
    drafts = withEdit(drafts, 'other', { seatLimit: 1 })
    assert.deepStrictEqual(drafts.floxi, { enabled: false, seatLimit: 9 })
    assert.equal(draftValue(ROW, drafts, 'enabled'), false)
    assert.equal(draftValue(ROW, drafts, 'seatLimit'), 9)
    // a draft equal to the stored value still counts as an edit (legacy `!!drafts[tenant]`)
    assert.equal(isDirty(withEdit({}, 'floxi', { seatLimit: 5 }), 'floxi'), true)
    assert.equal(isDirty({}, 'floxi'), false)
    const after = withoutDraft(drafts, 'floxi')
    assert.deepStrictEqual(Object.keys(after), ['other'])
    assert.ok(drafts.floxi, 'the previous drafts object is not mutated')
  })

  test('seat input: a cleared field means 0, and the draft is clamped to 0-500 only when out of range', () => {
    assert.equal(seatLimitFromInput(null), 0)
    assert.equal(seatLimitFromInput(12), 12)
    assert.equal(SEAT_LIMIT_MIN, 0)
    assert.equal(SEAT_LIMIT_MAX, 500)
    assert.equal(clampSeatLimit(-3), 0)
    assert.equal(clampSeatLimit(600), 500)
    assert.equal(clampSeatLimit(42), 42)
    const inRange = withEdit({}, 'floxi', { seatLimit: 40 })
    assert.equal(withSeatLimitClamped(inRange, 'floxi'), inRange, 'unchanged object when nothing to clamp')
    assert.deepStrictEqual(withSeatLimitClamped({}, 'floxi'), {}, 'no draft is created on blur')
    const enabledOnly = withEdit({}, 'floxi', { enabled: true })
    assert.equal(withSeatLimitClamped(enabledOnly, 'floxi'), enabledOnly)
    assert.deepStrictEqual(withSeatLimitClamped(withEdit({}, 'floxi', { enabled: true, seatLimit: 900 }), 'floxi').floxi, {
      enabled: true,
      seatLimit: 500,
    })
  })

  test('a typed seat count never leaves 0-500, and a clamp to the value shown edits nothing', () => {
    assert.deepStrictEqual(withTypedSeatLimit({}, ROW, 40).floxi, { seatLimit: 40 })
    assert.deepStrictEqual(withTypedSeatLimit({}, ROW, null).floxi, { seatLimit: 0 }, 'a cleared field means 0')
    assert.deepStrictEqual(withTypedSeatLimit({}, ROW, 600).floxi, { seatLimit: 500 }, 'clamped at once, not on blur')
    assert.deepStrictEqual(withTypedSeatLimit({}, ROW, -4).floxi, { seatLimit: 0 })
    const atMax = { ...ROW, seatLimit: 500 }
    assert.deepStrictEqual(withTypedSeatLimit({}, atMax, 600), {}, 'already 500: no draft, the row stays clean')
    const draftAtZero = withEdit({}, 'floxi', { enabled: true, seatLimit: 0 })
    assert.equal(withTypedSeatLimit(draftAtZero, ROW, -1), draftAtZero)
    assert.deepStrictEqual(withTypedSeatLimit({}, { ...ROW, seatLimit: 0 }, null).floxi, { seatLimit: 0 }, 'clearing still edits')
  })

  test('arrow steps: the kit steps inside 0-500; past a bound the page stops the step there', () => {
    assert.equal(stepDirection('ArrowUp'), 1)
    assert.equal(stepDirection('ArrowDown'), -1)
    assert.equal(stepDirection('Tab'), null)
    assert.equal(enteredNumber('42', 5), 42)
    assert.equal(enteredNumber('', 5), 5)
    assert.equal(enteredNumber('-', 5), 5)
    assert.equal(boundedSeatStep('5', 5, 1, 1), null, 'in range: the kit steps')
    assert.equal(boundedSeatStep('495', 495, 1, 5), null)
    assert.equal(boundedSeatStep('500', 500, 1, 1), 500, 'at the top: the step is taken and goes nowhere')
    assert.equal(boundedSeatStep('0', 0, -1, 1), 0, 'at the bottom too')
    assert.equal(boundedSeatStep('495', 495, 1, 10), 500, 'Shift+ArrowUp stops at 500')
    assert.equal(boundedSeatStep('6', 6, -1, 10), 0, 'Shift+ArrowDown stops at 0')
    assert.equal(boundedSeatStep('600', 500, -1, 1), 499, 'from a typed 600, the step starts at the draft')
  })

  test('save variables keep the legacy keys and order, with the draft values', () => {
    const variables = saveVariables(ROW, withEdit({}, 'floxi', { seatLimit: 12 }))
    assert.deepStrictEqual(variables, { tenant: 'floxi', enabled: true, seatLimit: 12 })
    assert.deepStrictEqual(Object.keys(variables), ['tenant', 'enabled', 'seatLimit'])
    assert.deepStrictEqual(saveVariables(ROW, withEdit({}, 'floxi', { enabled: false })), {
      tenant: 'floxi',
      enabled: false,
      seatLimit: 5,
    })
  })

  test('the saved toast text', () => {
    assert.equal(savedMessage({ tenant: 'floxi', enabled: true, seatLimit: 1 }), 'floxi may have up to 1 CRM user.')
    assert.equal(savedMessage({ tenant: 'floxi', enabled: true, seatLimit: 0 }), 'floxi may have up to 0 CRM users.')
    assert.equal(savedMessage({ tenant: 'floxi', enabled: true, seatLimit: 25 }), 'floxi may have up to 25 CRM users.')
    assert.equal(savedMessage({ tenant: 'floxi', enabled: false, seatLimit: 25 }), 'The CRM is switched off for floxi.')
  })

  test('the CRM address strips the scheme, and falls back to the tenant', () => {
    assert.equal(crmAddress({ domain: 'https://floxi.example', tenant: 'floxi' }), 'crm.floxi.example')
    assert.equal(crmAddress({ domain: 'http://a.example', tenant: 'a' }), 'crm.a.example')
    assert.equal(crmAddress({ domain: 'b.example', tenant: 'b' }), 'crm.b.example')
    assert.equal(crmAddress({ domain: null, tenant: 'c' }), 'c')
    assert.equal(crmAddress({ domain: '', tenant: 'd' }), 'd')
  })

  test('seat usage: the dash, then red at the limit, blue while used, grey otherwise', () => {
    assert.equal(seatUsage({ ...ROW, enabled: false, seatsUsed: 0 }, 5), null)
    assert.deepStrictEqual(seatUsage({ ...ROW, enabled: false, seatsUsed: 3 }, 5), { text: '3 of 5', tone: 'info' })
    assert.deepStrictEqual(seatUsage({ ...ROW, seatsUsed: 5 }, 5), { text: '5 of 5', tone: 'neg' })
    assert.deepStrictEqual(seatUsage({ ...ROW, seatsUsed: 6 }, 5), { text: '6 of 5', tone: 'neg' })
    assert.deepStrictEqual(seatUsage({ ...ROW, seatsUsed: 2 }, 5), { text: '2 of 5', tone: 'info' })
    assert.deepStrictEqual(seatUsage({ ...ROW, seatsUsed: 0 }, 5), { text: '0 of 5', tone: 'neutral' })
    // a zero limit is not "full"
    assert.deepStrictEqual(seatUsage({ ...ROW, seatsUsed: 0 }, 0), { text: '0 of 0', tone: 'neutral' })
    assert.deepStrictEqual(seatUsage({ ...ROW, seatsUsed: 2 }, 0), { text: '2 of 0', tone: 'info' })
  })

  test('the first administrator is offered only for a stored-on row with nobody on it', () => {
    assert.equal(canCreateFirstAdmin({ ...ROW, seatsUsed: 0 }), true)
    assert.equal(canCreateFirstAdmin({ ...ROW, seatsUsed: 1 }), false)
    assert.equal(canCreateFirstAdmin({ ...ROW, enabled: false, seatsUsed: 0 }), false)
    assert.equal(firstAdminTitle('Floxi Gaming'), 'First CRM administrator for Floxi Gaming')
    assert.equal(firstAdminTitle(undefined), 'First CRM administrator for ')
  })

  test('first-administrator rules: antd required messages, code-point minimum, whitespace counts, email free', () => {
    assert.deepStrictEqual(firstAdminIssues(EMPTY_FIRST_ADMIN), [
      { path: 'name', message: 'Please enter Full name' },
      { path: 'username', message: 'Please enter Username' },
      { path: 'password', message: 'Please enter Temporary password' },
    ])
    const filled = { name: 'Asha', username: 'asha', password: 'abcdefghij', email: 'not an email' }
    assert.deepStrictEqual(firstAdminIssues(filled), [])
    assert.deepStrictEqual(firstAdminIssues({ ...filled, password: 'abcdefghi' }), [
      { path: 'password', message: 'At least 10 characters' },
    ])
    // nine astral characters are nine code points, though eighteen UTF-16 units
    assert.deepStrictEqual(firstAdminIssues({ ...filled, password: '😀'.repeat(9) }), [
      { path: 'password', message: 'At least 10 characters' },
    ])
    assert.deepStrictEqual(firstAdminIssues({ ...filled, name: ' ', username: ' ', password: ' '.repeat(10) }), [])
    const parsed = firstAdminSchema.safeParse({ ...filled, password: 'short' })
    assert.equal(parsed.success, false)
    if (!parsed.success) {
      assert.deepStrictEqual(
        parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
        [['password', 'At least 10 characters']],
      )
    }
    assert.equal(firstAdminSchema.safeParse(filled).success, true)
  })

  test('first-administrator variables: tenant first, the legacy order, an empty email left out', () => {
    const values = { name: 'Asha Menon', username: 'asha', password: 'placeholder-pw', email: '' }
    const variables = firstAdminVariables('floxi', values)
    assert.deepStrictEqual(Object.keys(variables), ['tenant', 'name', 'username', 'password'])
    assert.equal(variables.tenant, 'floxi')
    const withEmail = firstAdminVariables('floxi', { ...values, email: 'asha@floxi.example' })
    assert.deepStrictEqual(Object.keys(withEmail), ['tenant', 'name', 'username', 'password', 'email'])
    assert.equal(withEmail.email, 'asha@floxi.example')
  })

  test('the outcome of crmCreateFirstAdmin', () => {
    assert.deepStrictEqual(firstAdminOutcome({ ok: true, error: null }), { ok: true })
    assert.deepStrictEqual(firstAdminOutcome({ ok: false, error: 'Username taken' }), { ok: false, error: 'Username taken' })
    assert.deepStrictEqual(firstAdminOutcome({ ok: false, error: null }), {
      ok: false,
      error: 'Could not create the administrator',
    })
    assert.deepStrictEqual(firstAdminOutcome(null), { ok: false, error: 'Could not create the administrator' })
  })
})
