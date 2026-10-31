/**
 * The role editor's permission picker on its own: the loading state, the category tablist and its keyboard
 * model, each action checkbox, a resource's Grant All / Revoke, the category's tri-state select-all, Grant
 * All / Revoke All, the search, and that every emitted list is built exactly as the legacy handlers built it.
 */
import { beforeEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { Permission } from '@/state/rbacStore'
import { PermissionsSelector } from './PermissionsSelector'

const BY_DOMAIN: Record<string, string[]> = {
  'overview.dashboard': ['view'],
  'players.list': ['view', 'export'],
  'players.notes': ['view', 'create', 'delete'],
  roles: ['read'],
  'security.roles': ['view', 'create', 'update', 'delete'],
  'security.support-admins': ['view', 'view-secret'],
}

let emitted: Permission[][]
let submits: number

function Harness({
  initial = [],
  byDomain = BY_DOMAIN,
  loading = false,
}: {
  initial?: Permission[]
  byDomain?: Record<string, string[]>
  loading?: boolean
}) {
  const [value, setValue] = useState<Permission[]>(initial)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submits += 1
      }}
    >
      <PermissionsSelector
        permissionsByDomain={byDomain}
        loading={loading}
        value={value}
        onChange={(next) => {
          emitted.push(next)
          setValue(next)
        }}
      />
      <button type="submit">Save</button>
    </form>
  )
}

function lastEmitted(): Permission[] {
  const last = emitted.at(-1)
  assert.ok(last, 'expected an emitted permission list')
  return last
}

function tabNames(): string[] {
  return within(screen.getByRole('tablist', { name: 'Permission categories' }))
    .getAllByRole('tab')
    .map((tab) => tab.textContent ?? '')
}

function group(name: string): HTMLElement {
  return screen.getByRole('group', { name })
}

beforeEach(() => {
  emitted = []
  submits = 0
})

describe('PermissionsSelector', () => {
  test('shows the legacy loading copy while the permission list loads', () => {
    render(<Harness loading />)
    const status = screen.getByRole('status')
    assert.match(status.textContent ?? '', /Loading permissions/)
    assert.match(status.textContent ?? '', /Fetching available actions\.\.\./)
    assert.equal(screen.queryByRole('tablist'), null)
  })

  test('lists the categories in taxonomy order with their figures, the first one shown', () => {
    render(<Harness />)
    assert.deepEqual(tabNames(), ['Overview, 0 of 1 selected', 'Players, 0 of 5 selected', 'Security, 0 of 6 selected'])
    const overview = screen.getByRole('tab', { name: 'Overview, 0 of 1 selected' })
    assert.equal(overview.getAttribute('aria-selected'), 'true')
    assert.equal(overview.getAttribute('tabindex'), '0')
    assert.equal(screen.getByRole('tab', { name: /^Players/ }).getAttribute('tabindex'), '-1')

    const panel = screen.getByRole('tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), overview.id)
    assert.ok(within(panel).getByRole('heading', { level: 3, name: 'Overview' }))
    assert.match(within(panel).getByText(/Dashboard & Analytics/).textContent ?? '', /Dashboard & Analytics•1 resources/)
    assert.ok(within(panel).getByText('Access the main analytics dashboard'))

    assert.ok(screen.getByText('0%'))
    assert.match(screen.getByText('Permissions').parentElement?.textContent ?? '', /Permissions0\/12/)
    assert.match(screen.getByText('Categories').parentElement?.textContent ?? '', /Categories0\/3/)
  })

  test('each action is a checkbox; a grant is appended to its entry, as before', () => {
    render(<Harness initial={[{ domain: 'roles', actions: ['read'] }]} />)
    fireEvent.click(screen.getByRole('tab', { name: /^Players/ }))
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Players' }))

    fireEvent.click(within(group('List')).getByRole('checkbox', { name: 'export' }))
    assert.deepEqual(lastEmitted(), [
      { domain: 'roles', actions: ['read'] },
      { domain: 'players.list', actions: ['export'] },
    ])
    fireEvent.click(within(group('List')).getByRole('checkbox', { name: 'view' }))
    assert.deepEqual(lastEmitted(), [
      { domain: 'roles', actions: ['read'] },
      { domain: 'players.list', actions: ['export', 'view'] },
    ])
    assert.equal((within(group('List')).getByRole('checkbox', { name: 'view' }) as HTMLInputElement).checked, true)
    assert.ok(within(group('List')).getByText('2/2'))
    assert.ok(screen.getByRole('tab', { name: 'Players, 2 of 5 selected' }))
    assert.ok(screen.getByText('17%'))

    fireEvent.click(within(group('List')).getByRole('checkbox', { name: 'export' }))
    fireEvent.click(within(group('List')).getByRole('checkbox', { name: 'view' }))
    assert.deepEqual(lastEmitted(), [{ domain: 'roles', actions: ['read'] }])
  })

  test("a resource's Grant All grants every action at the end of the list; Revoke removes the entry", () => {
    render(<Harness initial={[{ domain: 'players.notes', actions: ['view'] }, { domain: 'roles', actions: ['read'] }]} />)
    fireEvent.click(screen.getByRole('tab', { name: /^Players/ }))

    fireEvent.click(within(group('Notes')).getByRole('button', { name: 'Grant All Notes' }))
    assert.deepEqual(lastEmitted(), [
      { domain: 'roles', actions: ['read'] },
      { domain: 'players.notes', actions: ['view', 'create', 'delete'] },
    ])
    fireEvent.click(within(group('Notes')).getByRole('button', { name: 'Revoke Notes' }))
    assert.deepEqual(lastEmitted(), [{ domain: 'roles', actions: ['read'] }])
  })

  test("the category's select-all is tri-state: partial grants all, full revokes the category only", () => {
    render(<Harness initial={[{ domain: 'security.roles', actions: ['view'] }, { domain: 'players.notes', actions: ['view'] }]} />)
    fireEvent.click(screen.getByRole('tab', { name: /^Players/ }))
    const selectAll = screen.getByRole('checkbox', { name: 'All Players permissions' }) as HTMLInputElement
    assert.equal(selectAll.checked, false)
    assert.equal(selectAll.indeterminate, true)

    fireEvent.click(selectAll)
    assert.deepEqual(lastEmitted(), [
      { domain: 'security.roles', actions: ['view'] },
      { domain: 'players.list', actions: ['view', 'export'] },
      { domain: 'players.notes', actions: ['view', 'create', 'delete'] },
    ])
    assert.equal(selectAll.checked, true)
    assert.equal(selectAll.indeterminate, false)

    fireEvent.click(selectAll)
    assert.deepEqual(lastEmitted(), [{ domain: 'security.roles', actions: ['view'] }])
    assert.equal(selectAll.checked, false)
    assert.equal(selectAll.indeterminate, false)
  })

  test('Grant All takes every nested domain and drops flat entries; Revoke All clears the list', () => {
    render(<Harness initial={[{ domain: 'roles', actions: ['read'] }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Grant All' }))
    assert.deepEqual(lastEmitted(), [
      { domain: 'overview.dashboard', actions: ['view'] },
      { domain: 'players.list', actions: ['view', 'export'] },
      { domain: 'players.notes', actions: ['view', 'create', 'delete'] },
      { domain: 'security.roles', actions: ['view', 'create', 'update', 'delete'] },
      { domain: 'security.support-admins', actions: ['view', 'view-secret'] },
    ])
    assert.ok(screen.getByText('100%'))
    assert.match(screen.getByText('Categories').parentElement?.textContent ?? '', /Categories3\/3/)

    fireEvent.click(screen.getByRole('button', { name: 'Revoke All' }))
    assert.deepEqual(lastEmitted(), [])
  })

  test('the category list is one tab stop: arrows, Home and End move the selection and the focus', () => {
    render(<Harness />)
    const overview = screen.getByRole('tab', { name: /^Overview/ })
    overview.focus()
    fireEvent.keyDown(overview, { key: 'ArrowDown' })
    const players = screen.getByRole('tab', { name: /^Players/ })
    assert.equal(document.activeElement, players)
    assert.equal(players.getAttribute('aria-selected'), 'true')
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Players' }))

    fireEvent.keyDown(players, { key: 'End' })
    assert.equal(document.activeElement, screen.getByRole('tab', { name: /^Security/ }))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    assert.equal(document.activeElement, screen.getByRole('tab', { name: /^Overview/ }))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' })
    assert.equal(document.activeElement, screen.getByRole('tab', { name: /^Security/ }))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' })
    assert.equal(document.activeElement, screen.getByRole('tab', { name: /^Overview/ }))
  })

  test('search narrows the categories and resources, moves to the first match and keeps it when cleared', () => {
    render(<Harness />)
    const search = screen.getByRole('searchbox', { name: 'Search permissions' })
    assert.equal(search.getAttribute('placeholder'), 'Search permissions, categories, or actions...')

    fireEvent.change(search, { target: { value: 'SECRET' } })
    assert.ok(screen.getByText('1 category matched'))
    assert.deepEqual(tabNames(), ['Security, 0 of 6 selected'])
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Security' }))
    assert.equal(screen.queryByRole('group', { name: 'Roles' }), null)
    assert.ok(within(group('Support Admins')).getByRole('checkbox', { name: 'view secret' }))

    fireEvent.change(search, { target: { value: '' } })
    assert.equal(screen.queryByText(/matched$/), null)
    assert.equal(tabNames().length, 3)
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Security' }))
    assert.ok(screen.getByRole('group', { name: 'Roles' }))
  })

  test('a search matching nothing says so in both columns; Enter in it never submits the form', () => {
    render(<Harness />)
    const search = screen.getByRole('searchbox', { name: 'Search permissions' })
    fireEvent.change(search, { target: { value: 'zzz' } })
    assert.ok(screen.getByText('0 categories matched'))
    assert.ok(screen.getByText('No categories match'))
    assert.ok(screen.getByText('No matching permissions'))
    assert.ok(screen.getByText('Try adjusting your search terms'))
    assert.equal(screen.queryByRole('tablist'), null)
    // the shown category stays, still named, though its tab is filtered out
    assert.ok(screen.getByRole('region', { name: 'Overview' }))

    const allowed = fireEvent.keyDown(search, { key: 'Enter' })
    assert.equal(allowed, false, 'Enter is cancelled')
    assert.equal(submits, 0)
  })

  test('no categories at all asks for one, as before', () => {
    render(<Harness byDomain={{ roles: ['read'] }} />)
    assert.ok(screen.getByText('Select a category'))
    assert.ok(screen.getByText('Choose a category from the sidebar to manage permissions'))
    assert.ok(screen.getByText('0%'))
    assert.equal(screen.queryByRole('tabpanel'), null)
  })
})

