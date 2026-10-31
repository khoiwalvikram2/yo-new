import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { Permission } from '@/state/rbacStore'
import {
  EMPTY_ROLE_VALUES,
  NAME_REQUIRED,
  NAME_TOO_LONG,
  NAME_TOO_SHORT,
  buildCreateRoleInput,
  buildUpdateRoleInput,
  groupPermissionsByDomain,
  pageSub,
  pageTitle,
  roleFormSchema,
  roleFormValues,
  submitLabel,
} from './roleFormModel'

function nameErrors(name: string): string[] {
  const result = roleFormSchema.safeParse({ name, permissions: [] })
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('roleFormSchema', () => {
  test('the legacy name rules and messages, one at a time', () => {
    assert.deepEqual(nameErrors(''), [NAME_REQUIRED])
    assert.equal(NAME_REQUIRED, 'Please enter role name')
    assert.deepEqual(nameErrors('a'), [NAME_TOO_SHORT])
    assert.equal(NAME_TOO_SHORT, 'Role name must be at least 2 characters')
    assert.deepEqual(nameErrors('ab'), [])
    assert.deepEqual(nameErrors('x'.repeat(64)), [])
    assert.deepEqual(nameErrors('x'.repeat(65)), [NAME_TOO_LONG])
    assert.equal(NAME_TOO_LONG, 'Role name must not exceed 64 characters')
  })

  test('the name is not trimmed, and an emoji counts as one character, as antd counted', () => {
    assert.deepEqual(nameErrors('   '), [])
    assert.deepEqual(nameErrors('\u{1F600}'), [NAME_TOO_SHORT])
    assert.deepEqual(nameErrors('\u{1F600}a'), [])
    assert.deepEqual(nameErrors('\u{1F600}'.repeat(64)), [])
    assert.deepEqual(nameErrors('\u{1F600}'.repeat(65)), [NAME_TOO_LONG])
  })

  test('permissions carry no rule and pass through untouched', () => {
    const permissions = [
      { __typename: 'Permission', domain: 'players.list', actions: ['view'] },
      { domain: 'roles', actions: ['read'] },
    ] as Permission[]
    const result = roleFormSchema.safeParse({ name: 'Support', permissions })
    assert.equal(result.success, true)
    assert.deepEqual(result.success ? result.data.permissions : null, permissions)
  })
})

describe('form values and input', () => {
  test('empty values and the stored role as the first values', () => {
    assert.deepEqual(EMPTY_ROLE_VALUES, { name: '', permissions: [] })
    const permissions = [{ domain: 'players.list', actions: ['view'] }]
    assert.deepEqual(roleFormValues({ name: 'Support', permissions }), { name: 'Support', permissions })
    assert.deepEqual(roleFormValues({ name: 'Support', permissions: null }), { name: 'Support', permissions: [] })
  })

  test('groups the server permissions by domain, each action once, in arrival order', () => {
    assert.deepEqual(
      groupPermissionsByDomain([
        { domain: 'players.list', actions: ['view', 'export'] },
        { domain: 'roles', actions: ['read'] },
        { domain: 'players.list', actions: ['export', 'delete'] },
      ]),
      { 'players.list': ['view', 'export', 'delete'], roles: ['read'] },
    )
    assert.deepEqual(groupPermissionsByDomain([]), {})
  })

  test('the create and update inputs keep the legacy keys and order, without typenames, the name as typed', () => {
    const values = {
      name: '  Support Admin ',
      permissions: [
        { __typename: 'Permission', domain: 'players.list', actions: ['view'] },
        { domain: 'roles', actions: ['read'] },
      ] as Permission[],
    }
    const create = buildCreateRoleInput(values)
    assert.deepEqual(create, {
      name: '  Support Admin ',
      permissions: [
        { domain: 'players.list', actions: ['view'] },
        { domain: 'roles', actions: ['read'] },
      ],
    })
    assert.deepEqual(Object.keys(create), ['name', 'permissions'])
    assert.deepEqual(Object.keys(create.permissions[0]), ['domain', 'actions'])

    const update = buildUpdateRoleInput('r7', values)
    assert.deepEqual(Object.keys(update), ['id', 'name', 'permissions'])
    assert.equal(update.id, 'r7')
    assert.deepEqual(update.permissions, create.permissions)
    assert.deepEqual(buildCreateRoleInput({ name: 'X', permissions: [] }), { name: 'X', permissions: [] })
  })

  test('the legacy titles and labels', () => {
    assert.deepEqual([pageTitle(false), pageTitle(true)], ['Create Role', 'Edit Role'])
    assert.deepEqual(
      [pageSub(false), pageSub(true)],
      ['Set up a new role with comprehensive permissions', 'Update role permissions and settings'],
    )
    assert.deepEqual([submitLabel(false), submitLabel(true)], ['Create Role', 'Update Role'])
  })
})

