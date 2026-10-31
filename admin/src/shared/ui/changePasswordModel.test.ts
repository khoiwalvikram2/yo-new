/**
 * The Change Password rules, React-free: the minimum length per audience, the advisory checklist, the
 * three legacy rule sets and their exact messages, the zod schema the dialog's useForm runs, the
 * mutation variables, the admin/agent payload shapes and the toast copy. Every password here is an
 * obviously fake placeholder typed for the test.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  CHANGE_PASSWORD_INITIAL_VALUES,
  changePasswordIssues,
  changePasswordSummary,
  changePasswordVariables,
  createChangePasswordSchema,
  graphQLErrorMessage,
  newPasswordPlaceholder,
  passwordChangedMessage,
  passwordMinLength,
  passwordRequirements,
  readChangePasswordResult,
  type ChangePasswordValues,
} from './changePasswordModel'

const values = (patch: Partial<ChangePasswordValues> = {}): ChangePasswordValues => ({
  ...CHANGE_PASSWORD_INITIAL_VALUES,
  ...patch,
})

describe('changePasswordModel', () => {
  test('agents need 6 characters, admins 8, and the placeholder says which', () => {
    assert.equal(passwordMinLength(true), 6)
    assert.equal(passwordMinLength(false), 8)
    assert.equal(newPasswordPlaceholder(8), 'Enter new password (min 8 characters)')
    assert.equal(newPasswordPlaceholder(6), 'Enter new password (min 6 characters)')
  })

  test('the checklist reports each requirement with the legacy copy and order', () => {
    assert.deepEqual(passwordRequirements('', 8), [
      { key: 'length', met: false, text: 'At least 8 characters' },
      { key: 'upper', met: false, text: 'One uppercase letter' },
      { key: 'lower', met: false, text: 'One lowercase letter' },
      { key: 'number', met: false, text: 'One number' },
    ])
    assert.deepEqual(
      passwordRequirements('Fake-pw1', 8).map((requirement) => requirement.met),
      [true, true, true, true],
    )
    assert.deepEqual(
      passwordRequirements('fake-p1', 8).map((requirement) => requirement.met),
      [false, false, true, true],
    )
    assert.deepEqual(
      passwordRequirements('FAKEPASS', 6).map((requirement) => requirement.met),
      [true, true, false, false],
    )
  })

  test('the checklist length is the legacy UTF-16 length; the enforced rule counts code points', () => {
    const sevenEmoji = '😀'.repeat(7) // 14 UTF-16 units, 7 code points
    assert.equal(passwordRequirements(sevenEmoji, 8)[0].met, true)
    assert.deepEqual(changePasswordIssues(values({ currentPassword: 'x', newPassword: sevenEmoji, confirmPassword: sevenEmoji }), 8), [
      { path: 'newPassword', message: 'Password must be at least 8 characters' },
    ])
    const eightEmoji = '😀'.repeat(8)
    assert.deepEqual(changePasswordIssues(values({ currentPassword: 'x', newPassword: eightEmoji, confirmPassword: eightEmoji }), 8), [])
  })

  test('an empty form fails all three required rules, in field order, with the legacy messages', () => {
    assert.deepEqual(changePasswordIssues(values(), 8), [
      { path: 'currentPassword', message: 'Please enter your current password' },
      { path: 'newPassword', message: 'Please enter a new password' },
      { path: 'confirmPassword', message: 'Please confirm your new password' },
    ])
  })

  test('required means non-empty: whitespace counts as entered, as antd had it', () => {
    assert.deepEqual(
      changePasswordIssues(values({ currentPassword: '   ', newPassword: '        ', confirmPassword: '        ' }), 8),
      [],
    )
  })

  test('the minimum length is checked only once New Password holds something, at the boundary', () => {
    assert.deepEqual(changePasswordIssues(values({ currentPassword: 'old-pass-1', newPassword: 'abcdefg', confirmPassword: 'abcdefg' }), 8), [
      { path: 'newPassword', message: 'Password must be at least 8 characters' },
    ])
    assert.deepEqual(changePasswordIssues(values({ currentPassword: 'old-pass-1', newPassword: 'abcdefgh', confirmPassword: 'abcdefgh' }), 8), [])
    assert.deepEqual(changePasswordIssues(values({ currentPassword: 'old-pass-1', newPassword: 'abcde', confirmPassword: 'abcde' }), 6), [
      { path: 'newPassword', message: 'Password must be at least 6 characters' },
    ])
    assert.deepEqual(changePasswordIssues(values({ currentPassword: 'old-pass-1', newPassword: 'abcdef', confirmPassword: 'abcdef' }), 6), [])
  })

  test('once Confirm holds anything it must equal New Password exactly', () => {
    assert.deepEqual(changePasswordIssues(values({ currentPassword: 'a', newPassword: 'New-pass-22', confirmPassword: 'New-pass-23' }), 8), [
      { path: 'confirmPassword', message: 'Passwords do not match' },
    ])
    assert.deepEqual(changePasswordIssues(values({ currentPassword: 'a', newPassword: 'New-pass-22', confirmPassword: 'new-pass-22' }), 8), [
      { path: 'confirmPassword', message: 'Passwords do not match' },
    ])
    // A confirmation typed before New Password is a mismatch, as getFieldValue('newPassword') was undefined.
    assert.deepEqual(changePasswordIssues(values({ currentPassword: 'a', confirmPassword: 'New-pass-22' }), 8), [
      { path: 'newPassword', message: 'Please enter a new password' },
      { path: 'confirmPassword', message: 'Passwords do not match' },
    ])
  })

  test('the zod schema reports the same issues at the same paths, cross-field checks included', async () => {
    const schema = createChangePasswordSchema(8)
    const empty = await schema.safeParseAsync(values())
    assert.equal(empty.success, false)
    assert.deepEqual(
      empty.error?.issues.map((issue) => [issue.path.join('.'), issue.message]),
      [
        ['currentPassword', 'Please enter your current password'],
        ['newPassword', 'Please enter a new password'],
        ['confirmPassword', 'Please confirm your new password'],
      ],
    )

    const mismatch = await schema.safeParseAsync(values({ newPassword: 'New-pass-22', confirmPassword: 'Other-pass-9' }))
    assert.deepEqual(
      mismatch.error?.issues.map((issue) => [issue.path.join('.'), issue.message]),
      [
        ['currentPassword', 'Please enter your current password'],
        ['confirmPassword', 'Passwords do not match'],
      ],
    )

    const valid = await schema.safeParseAsync(values({ currentPassword: 'old-pass-1', newPassword: 'New-pass-22', confirmPassword: 'New-pass-22' }))
    assert.equal(valid.success, true)
    assert.deepEqual(valid.data, { currentPassword: 'old-pass-1', newPassword: 'New-pass-22', confirmPassword: 'New-pass-22' })
    assert.equal((await createChangePasswordSchema(6).safeParseAsync(values({ currentPassword: 'a', newPassword: 'abcdef', confirmPassword: 'abcdef' }))).success, true)
  })

  test('the mutation receives the current and the new password only', () => {
    assert.deepEqual(
      changePasswordVariables({ currentPassword: 'old-pass-1', newPassword: 'New-pass-22', confirmPassword: 'New-pass-22' }),
      { currentPassword: 'old-pass-1', newPassword: 'New-pass-22' },
    )
    assert.deepEqual(Object.keys(changePasswordVariables(values())), ['currentPassword', 'newPassword'])
  })

  test('an admin result is top level, an agent result is nested under agents', () => {
    const admin = { changeAdminPassword: { success: true, message: 'Password updated' } }
    const agent = { agents: { changeAgentPassword: { success: true, message: 'Agent password updated' } } }
    assert.deepEqual(readChangePasswordResult(admin, false), { success: true, message: 'Password updated' })
    assert.deepEqual(readChangePasswordResult(agent, true), { success: true, message: 'Agent password updated' })
    assert.deepEqual(readChangePasswordResult(admin, true), { success: false, message: undefined })
    assert.deepEqual(readChangePasswordResult(agent, false), { success: false, message: undefined })
    assert.deepEqual(readChangePasswordResult({ changeAdminPassword: { success: false, message: 'Wrong current password' } }, false), {
      success: false,
      message: 'Wrong current password',
    })
    assert.deepEqual(readChangePasswordResult(null, false), { success: false, message: undefined })
    assert.deepEqual(readChangePasswordResult(undefined, true), { success: false, message: undefined })
  })

  test('the success copy falls back when the server sends no message', () => {
    assert.equal(passwordChangedMessage('Password updated'), 'Password updated')
    assert.equal(passwordChangedMessage(''), 'Your password has been updated successfully')
    assert.equal(passwordChangedMessage(null), 'Your password has been updated successfully')
    assert.equal(passwordChangedMessage(undefined), 'Your password has been updated successfully')
  })

  test('only the first GraphQL error message is reported; anything else stays silent', () => {
    assert.equal(graphQLErrorMessage({ graphQLErrors: [{ message: 'Current password is incorrect' }, { message: 'second' }] }), 'Current password is incorrect')
    assert.equal(graphQLErrorMessage({ graphQLErrors: [{ message: '' }] }), null)
    assert.equal(graphQLErrorMessage({ graphQLErrors: [] }), null)
    assert.equal(graphQLErrorMessage({ networkError: new Error('Failed to fetch'), graphQLErrors: [] }), null)
    assert.equal(graphQLErrorMessage(new Error('plain')), null)
    assert.equal(graphQLErrorMessage(null), null)
    assert.equal(graphQLErrorMessage('boom'), null)
  })

  test('the failed-submit summary counts the fields', () => {
    assert.equal(changePasswordSummary(1), 'Fix 1 highlighted field and submit again.')
    assert.equal(changePasswordSummary(3), 'Fix 3 highlighted fields and submit again.')
  })
})
