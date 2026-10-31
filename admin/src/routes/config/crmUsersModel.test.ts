import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  EMPTY_CREATE_USER,
  REMOVE_CONFIRM,
  assignRoleOptions,
  createRoleOptions,
  createUserIssues,
  createUserSchema,
  createUserVariables,
  editTitle,
  editUserInitialValues,
  editUserIssues,
  editUserVariables,
  nextStatus,
  removeVariables,
  resetPasswordIssues,
  resetPasswordVariables,
  resetTitle,
  rolesInitialValues,
  rolesSchema,
  rolesTitle,
  rolesVariables,
  seatSummary,
  settleResult,
  statusActionLabel,
  statusTone,
  statusVariables,
  tenantVariable,
  when,
  whitelabelOptions,
  type CrmRoleRow,
  type CrmUserRow,
} from './crmUsersModel'

const USER: CrmUserRow = {
  id: 'u1',
  name: 'Asha Menon',
  username: 'asha',
  email: null,
  phone: '9876543210',
  status: 'ACTIVE',
  requirePasswordReset: false,
  lastLoginAt: null,
  lastSeenAt: '2026-10-04T09:48:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
  roleNames: ['Retention'],
  roleIds: ['r2'],
}

const ROLES: CrmRoleRow[] = [
  { id: 'r1', name: 'Administrator', description: null, isSystem: true },
  { id: 'r2', name: 'Retention', description: 'Works the retention book', isSystem: false },
]

describe('crmUsersModel', () => {
  test('the tenant selector is sent as null until a Super Admin picks one', () => {
    assert.equal(tenantVariable(undefined), null)
    assert.equal(tenantVariable('floxi'), 'floxi')
  })

  test('dates use the legacy en-IN medium date and short time, or a dash', () => {
    assert.equal(when(null), '—')
    assert.equal(when(''), '—')
    assert.equal(
      when('2026-10-04T09:48:00.000Z'),
      new Date('2026-10-04T09:48:00.000Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    )
  })

  test('status tones, the next status and the action label', () => {
    assert.equal(statusTone('ACTIVE'), 'ok')
    assert.equal(statusTone('INACTIVE'), 'warn')
    assert.equal(statusTone('SUSPENDED'), 'neg')
    assert.equal(statusTone('PENDING'), 'neutral')
    assert.equal(statusTone('active'), 'neutral', 'the legacy map was case-sensitive')
    assert.equal(nextStatus('ACTIVE'), 'SUSPENDED')
    assert.equal(nextStatus('SUSPENDED'), 'ACTIVE')
    assert.equal(nextStatus('INACTIVE'), 'ACTIVE')
    assert.equal(statusActionLabel('ACTIVE'), 'Suspend')
    assert.equal(statusActionLabel('INACTIVE'), 'Reinstate')
  })

  test('the seat summary: off and empty before the answer, full at the limit, a rounded percent', () => {
    assert.deepStrictEqual(seatSummary(undefined), {
      enabled: false,
      seatLimit: 0,
      seatsUsed: 0,
      full: false,
      percent: 0,
      text: '0 of 0 seats used',
    })
    assert.deepStrictEqual(seatSummary({ enabled: true, seatLimit: 3, seatsUsed: 1 }), {
      enabled: true,
      seatLimit: 3,
      seatsUsed: 1,
      full: false,
      percent: 33,
      text: '1 of 3 seats used',
    })
    const full = seatSummary({ enabled: true, seatLimit: 3, seatsUsed: 3 })
    assert.equal(full.full, true)
    assert.equal(full.percent, 100)
    assert.equal(seatSummary({ enabled: true, seatLimit: 0, seatsUsed: 2 }).full, false, 'no limit is never full')
    assert.equal(seatSummary({ enabled: true, seatLimit: 2, seatsUsed: 5 }).percent, 250)
  })

  test('options: whitelabels by name, roles by name, and the system role marked full access', () => {
    assert.deepStrictEqual(whitelabelOptions([{ tenant: 'floxi', name: 'Floxi Gaming' }]), [
      { value: 'floxi', label: 'Floxi Gaming' },
    ])
    assert.deepStrictEqual(whitelabelOptions(undefined), [])
    assert.deepStrictEqual(createRoleOptions(ROLES), [
      { value: 'r1', label: 'Administrator' },
      { value: 'r2', label: 'Retention' },
    ])
    assert.deepStrictEqual(assignRoleOptions(ROLES), [
      { value: 'r1', label: 'Administrator (full access)' },
      { value: 'r2', label: 'Retention' },
    ])
  })

  test('settle reads { ok, error } with the legacy fallback', () => {
    assert.deepStrictEqual(settleResult({ ok: true, error: null }), { ok: true })
    assert.deepStrictEqual(settleResult({ ok: false, error: 'No seats left' }), { ok: false, error: 'No seats left' })
    assert.deepStrictEqual(settleResult({ ok: false, error: null }), { ok: false, error: 'Something went wrong' })
    assert.deepStrictEqual(settleResult(undefined), { ok: false, error: 'Something went wrong' })
  })

  test('new-user rules: antd required messages; one message for an empty or short password, in code points', () => {
    assert.deepStrictEqual(createUserIssues(EMPTY_CREATE_USER), [
      { path: 'name', message: 'Please enter Name' },
      { path: 'username', message: 'Please enter Username' },
      { path: 'password', message: 'At least 10 characters' },
    ])
    const filled = { name: 'Asha', username: 'asha', password: 'abcdefghij', email: '', roleIds: [] }
    assert.deepStrictEqual(createUserIssues(filled), [])
    assert.deepStrictEqual(createUserIssues({ ...filled, password: '😀'.repeat(9) }), [
      { path: 'password', message: 'At least 10 characters' },
    ])
    assert.deepStrictEqual(createUserIssues({ ...filled, name: ' ', username: ' ' }), [], 'whitespace counts as entered')
    assert.equal(createUserSchema.safeParse(filled).success, true)
    assert.equal(createUserSchema.safeParse({ ...filled, password: 'short' }).success, false)
  })

  test('new-user variables: the legacy order, roles always a list, an empty email left out', () => {
    const values = { name: 'Asha Menon', username: 'asha', password: 'placeholder-pw', email: '', roleIds: ['r2'] }
    const sent = createUserVariables(undefined, values)
    assert.equal(sent.tenant, null)
    assert.deepStrictEqual(Object.keys(sent.input), ['name', 'username', 'password', 'roleIds'])
    assert.deepStrictEqual(sent.input.roleIds, ['r2'])
    const withEmail = createUserVariables('floxi', { ...values, email: 'asha@floxi.example', roleIds: [] })
    assert.equal(withEmail.tenant, 'floxi')
    assert.deepStrictEqual(Object.keys(withEmail.input), ['name', 'username', 'password', 'email', 'roleIds'])
    assert.equal(withEmail.input.email, 'asha@floxi.example')
    assert.deepStrictEqual(withEmail.input.roleIds, [])
  })

  test('edit: the record seeds the form; empties whose record value was missing go back as null', () => {
    assert.deepStrictEqual(editUserInitialValues(USER), { name: 'Asha Menon', email: '', phone: '9876543210' })
    assert.deepStrictEqual(editUserIssues({ name: '', email: '', phone: '' }), [{ path: 'name', message: 'Please enter Name' }])
    assert.deepStrictEqual(editUserIssues({ name: 'A', email: '', phone: '' }), [])
    const untouched = editUserVariables('floxi', USER, editUserInitialValues(USER))
    assert.deepStrictEqual(untouched, {
      tenant: 'floxi',
      input: { id: 'u1', name: 'Asha Menon', email: null, phone: '9876543210' },
    })
    assert.deepStrictEqual(Object.keys(untouched.input), ['id', 'name', 'email', 'phone'])
    // a value the record had and the admin cleared is sent as '', as antd sent a cleared input
    assert.deepStrictEqual(editUserVariables(undefined, USER, { name: 'Asha', email: 'a@b.example', phone: '' }).input, {
      id: 'u1',
      name: 'Asha',
      email: 'a@b.example',
      phone: '',
    })
    assert.equal(editTitle('Asha Menon'), 'Edit Asha Menon')
  })

  test('reset password: one message for empty or short, and the exact variables', () => {
    assert.deepStrictEqual(resetPasswordIssues({ newPassword: '' }), [
      { path: 'newPassword', message: 'At least 10 characters' },
    ])
    assert.deepStrictEqual(resetPasswordIssues({ newPassword: 'abcdefghi' }), [
      { path: 'newPassword', message: 'At least 10 characters' },
    ])
    assert.deepStrictEqual(resetPasswordIssues({ newPassword: 'abcdefghij' }), [])
    const sent = resetPasswordVariables(undefined, USER, { newPassword: 'placeholder-pw' })
    assert.deepStrictEqual(Object.keys(sent), ['tenant', 'id', 'newPassword'])
    assert.equal(sent.tenant, null)
    assert.equal(sent.id, 'u1')
    assert.equal(resetTitle('Asha Menon'), 'Reset password for Asha Menon')
  })

  test('roles, status and remove variables', () => {
    const initial = rolesInitialValues(USER)
    assert.deepStrictEqual(initial, { roleIds: ['r2'] })
    assert.ok(initial.roleIds !== USER.roleIds, 'the form gets its own copy of the record list')
    assert.equal(rolesSchema.safeParse({ roleIds: [] }).success, true)
    assert.deepStrictEqual(rolesVariables('floxi', USER, { roleIds: ['r1', 'r2'] }), { tenant: 'floxi', id: 'u1', roleIds: ['r1', 'r2'] })
    assert.deepStrictEqual(rolesVariables(undefined, USER, { roleIds: [] }), { tenant: null, id: 'u1', roleIds: [] })
    assert.deepStrictEqual(statusVariables(undefined, USER), { tenant: null, id: 'u1', status: 'SUSPENDED' })
    assert.deepStrictEqual(statusVariables('floxi', { ...USER, status: 'SUSPENDED' }), { tenant: 'floxi', id: 'u1', status: 'ACTIVE' })
    assert.deepStrictEqual(removeVariables(undefined, USER), { tenant: null, id: 'u1' })
    assert.equal(rolesTitle('Asha Menon'), 'Roles for Asha Menon')
    assert.equal(rolesTitle(undefined), 'Roles for ')
  })

  test('the remove confirmation keeps the legacy copy', () => {
    assert.deepStrictEqual({ ...REMOVE_CONFIRM }, {
      title: 'Remove this CRM user?',
      description:
        'Suspending is usually what you want. Removing takes their name off the record of every player whose contact details they read — that trail cannot be restored.',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
  })
})
