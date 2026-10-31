/**
 * Menu is the shell's only role="menu" widget (the profile menu, T48). These tests pin
 * the accessibility contract floating-ui gives for free: menu/menuitem roles, arrow-key
 * navigation, Esc closing with focus returned to the trigger, and onSelect firing once a
 * click on an item has closed the menu.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu'

function renderMenu(onSelectFirst: () => void = () => {}) {
  return render(
    <Menu trigger={<button type="button">Open menu</button>}>
      <MenuItem onSelect={onSelectFirst}>First</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => {}}>Second</MenuItem>
    </Menu>,
  )
}

describe('Menu', () => {
  test('opens a role="menu" with role="menuitem" children', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Open menu' })
    fireEvent.click(trigger)

    const menu = await waitFor(() => screen.getByRole('menu'))
    assert.ok(menu)
    const items = screen.getAllByRole('menuitem')
    assert.equal(items.length, 2)
    assert.equal(items[0].textContent, 'First')
    assert.equal(items[1].textContent, 'Second')
  })

  test('ArrowDown moves focus through the items', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Open menu' })
    // detail: 1 marks this as a real mouse click. fireEvent.click()'s default MouseEvent has
    // detail: 0, which floating-ui's useListNavigation treats as a "virtual" (keyboard-like)
    // click and auto-focuses the first item on open — racing with the ArrowDown below and
    // leaving focus one item ahead of what this test expects.
    fireEvent.click(trigger, { detail: 1 })
    const menu = await waitFor(() => screen.getByRole('menu'))
    const items = screen.getAllByRole('menuitem')

    // Dispatched on the menu surface itself, not document.activeElement: no item is
    // tabbable until activeIndex is set (all start at tabIndex=-1), so which node
    // FloatingFocusManager focuses first in jsdom is not asserted here. The composited
    // keydown handler useListNavigation attaches through getFloatingProps() lives on
    // this element regardless, and the event bubbles the same way either way.
    // assert.ok, not assert.equal: node:assert's AssertionError eagerly builds a diff of both
    // operands on failure, and diffing a live jsdom Element is pathologically expensive — under
    // waitFor's retries this turns a cheap boolean check into a multi-second-or-worse operation
    // (confirmed: a single failing assert.equal here took 30+ seconds and OOM-crashed the worker
    // after a couple more), up to a full test timeout under real parallel test load.
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await waitFor(() => assert.ok(document.activeElement === items[0]))

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await waitFor(() => assert.ok(document.activeElement === items[1]))
  })

  test('Esc closes the menu and returns focus to the trigger', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Open menu' })
    fireEvent.click(trigger)
    await waitFor(() => screen.getByRole('menu'))

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => assert.ok(!screen.queryByRole('menu')))
    await waitFor(() => assert.ok(document.activeElement === trigger))
  })

  test('clicking an item closes the menu and calls onSelect', async () => {
    let selected = false
    renderMenu(() => {
      selected = true
    })
    const trigger = screen.getByRole('button', { name: 'Open menu' })
    fireEvent.click(trigger)
    await waitFor(() => screen.getByRole('menu'))
    const [first] = screen.getAllByRole('menuitem')

    fireEvent.click(first)
    await waitFor(() => assert.ok(!screen.queryByRole('menu')))
    assert.equal(selected, true)
  })

  test('radio and checkbox items expose their selection state and keep plain items unchanged', async () => {
    render(
      <Menu trigger={<button type="button">Choose columns</button>}>
        <MenuItem type="radio" checked onSelect={() => {}}>Newest first</MenuItem>
        <MenuItem type="checkbox" checked={false} onSelect={() => {}}>Reference ID</MenuItem>
        <MenuItem onSelect={() => {}}>Refresh</MenuItem>
      </Menu>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose columns' }))
    const radio = await screen.findByRole('menuitemradio', { name: 'Newest first' })
    const checkbox = screen.getByRole('menuitemcheckbox', { name: 'Reference ID' })
    const plain = screen.getByRole('menuitem', { name: 'Refresh' })

    assert.equal(radio.getAttribute('aria-checked'), 'true')
    assert.equal(checkbox.getAttribute('aria-checked'), 'false')
    assert.equal(plain.getAttribute('aria-checked'), null)
    assert.ok(radio.textContent?.includes('✓'))
  })

  test('composite items retain arrow-key navigation and selection closes the menu once', async () => {
    let selected = 0
    render(
      <Menu trigger={<button type="button">Display</button>}>
        <MenuItem type="checkbox" checked={false} onSelect={() => { selected += 1 }}>Compact rows</MenuItem>
        <MenuItem type="radio" checked onSelect={() => {}}>Comfortable rows</MenuItem>
      </Menu>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Display' }), { detail: 1 })
    const menu = await screen.findByRole('menu')
    const checkbox = screen.getByRole('menuitemcheckbox', { name: 'Compact rows' })

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await waitFor(() => assert.equal(document.activeElement, checkbox))
    fireEvent.click(checkbox)

    await waitFor(() => assert.equal(screen.queryByRole('menu'), null))
    assert.equal(selected, 1)
  })

  test('a group label is presentational and keyboard navigation passes over it', async () => {
    render(
      <Menu trigger={<button type="button">Export</button>}>
        <MenuLabel>Export as</MenuLabel>
        <MenuItem onSelect={() => {}}>CSV</MenuItem>
        <MenuSeparator />
        <MenuLabel>Send to</MenuLabel>
        <MenuItem onSelect={() => {}}>Email</MenuItem>
      </Menu>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export' }), { detail: 1 })
    const menu = await screen.findByRole('menu')
    const label = screen.getByText('Export as')
    assert.equal(label.getAttribute('role'), 'presentation')
    assert.equal(label.getAttribute('tabindex'), null)
    // the headings are not items
    assert.deepEqual(screen.getAllByRole('menuitem').map((item) => item.textContent), ['CSV', 'Email'])

    const [csv, email] = screen.getAllByRole('menuitem')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await waitFor(() => assert.ok(document.activeElement === csv))
    // straight past "Send to" to the next item, then wrapping past "Export as"
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await waitFor(() => assert.ok(document.activeElement === email))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await waitFor(() => assert.ok(document.activeElement === csv))
  })

  test('danger tone is a visual modifier without changing the accessible role', async () => {
    render(
      <Menu trigger={<button type="button">Account actions</button>}>
        <MenuItem tone="danger" onSelect={() => {}}>Delete account</MenuItem>
      </Menu>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account actions' }))
    const item = await screen.findByRole('menuitem', { name: 'Delete account' })
    assert.ok(item.className.includes('danger'))
  })
})
