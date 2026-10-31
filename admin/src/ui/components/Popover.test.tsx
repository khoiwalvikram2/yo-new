/**
 * Popover is the surface behind the topbar bells, the wallet indicators and the Filters popover below 1024px.
 * Keyboard and screen-reader users depend on what is tested here:
 * - the trigger announces a dialog and whether it is expanded, and the dialog has a name;
 * - Esc closes it and puts focus back on the trigger, so keyboard users are not dropped on <body>;
 * - a press outside closes it, a press inside does not;
 * - a parent that owns the open state (bells, wallets) stays in control, and content can close the popover itself;
 * - the portaled surface takes the theme of the region its trigger sits in, not the theme of <html>.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { Popover } from './Popover'

describe('Popover', () => {
  test('an open root-themed popover inherits root palette changes live and keeps focus and dialog protocol', async () => {
    document.documentElement.dataset.theme = 'light'
    render(<Popover label="Live root filters" trigger={<button type="button">Open live filters</button>}><button type="button">Apply filters</button></Popover>)
    const trigger = screen.getByRole('button', { name: 'Open live filters' })
    trigger.focus(); fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Live root filters' })
    await waitFor(() => assert.ok(dialog.contains(document.activeElement)))
    const focused = document.activeElement
    assert.equal(dialog.getAttribute('data-theme'), null)
    assert.equal(dialog.closest('[data-theme]'), document.documentElement)
    document.documentElement.dataset.theme = 'dark'
    assert.equal(dialog.closest('[data-theme]')?.getAttribute('data-theme'), 'dark')
    assert.equal(screen.getByRole('dialog', { name: 'Live root filters' }), dialog)
    assert.equal(document.activeElement, focused)
    document.documentElement.dataset.theme = 'light'
    assert.equal(dialog.closest('[data-theme]')?.getAttribute('data-theme'), 'light')
    fireEvent.keyDown(focused ?? document.body, { key: 'Escape' })
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.equal(document.activeElement, trigger))
  })

  test('starts closed and the trigger announces a dialog', () => {
    render(
      <Popover label="Filters" trigger={<button type="button">Open filters</button>}>
        <p>Tenant and currency</p>
      </Popover>,
    )

    const trigger = screen.getByRole('button', { name: 'Open filters' })
    assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog')
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    assert.equal(screen.queryByRole('dialog'), null)
    assert.equal(screen.queryByText('Tenant and currency'), null)
  })

  test('a click opens a dialog named by label with the extra class on the surface; a second click closes it', async () => {
    render(
      <Popover label="Filters" className="extra" trigger={<button type="button">Open filters</button>}>
        <p>Tenant and currency</p>
      </Popover>,
    )
    const trigger = screen.getByRole('button', { name: 'Open filters' })

    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')
    assert.ok(dialog.id)
    assert.equal(trigger.getAttribute('aria-controls'), dialog.id)
    assert.ok(dialog.classList.contains('extra'))
    assert.ok(dialog.textContent?.includes('Tenant and currency'))

    fireEvent.click(trigger)

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  })

  test('labelledBy names the dialog from a heading inside it and wins over label', async () => {
    render(
      <Popover label="Ignored" labelledBy="wallet-title" trigger={<button type="button">Wallet</button>}>
        <span id="wallet-title">Credit Wallet</span>
      </Popover>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Wallet' }))

    const dialog = await screen.findByRole('dialog', { name: 'Credit Wallet' })
    assert.equal(dialog.getAttribute('aria-labelledby'), 'wallet-title')
    assert.equal(dialog.getAttribute('aria-label'), null)
  })

  test('Escape closes the dialog and returns focus to the trigger', async () => {
    render(
      <Popover label="Filters" trigger={<button type="button">Open filters</button>}>
        <button type="button">Apply</button>
      </Popover>,
    )
    const trigger = screen.getByRole('button', { name: 'Open filters' })
    act(() => {
      trigger.focus()
    })

    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    await waitFor(() => assert.ok(dialog.contains(document.activeElement), 'focus moves into the dialog'))

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.equal(document.activeElement, trigger))
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  })

  test('a pointerdown outside closes the dialog; a pointerdown inside does not', async () => {
    render(
      <div>
        <p>Page text</p>
        <Popover label="Filters" trigger={<button type="button">Open filters</button>}>
          <p>Inside text</p>
        </Popover>
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }))
    await screen.findByRole('dialog', { name: 'Filters' })

    fireEvent.pointerDown(screen.getByText('Inside text'))
    assert.ok(screen.getByRole('dialog', { name: 'Filters' }))

    fireEvent.pointerDown(screen.getByText('Page text'))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
  })

  test('controlled: open follows the prop and every request goes through onOpenChange', async () => {
    const onOpenChange = vi.fn()
    const trigger = <button type="button">Bell</button>
    const { rerender } = render(
      <Popover open={false} onOpenChange={onOpenChange} label="Notifications" trigger={trigger}>
        <p>No new notifications</p>
      </Popover>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bell' }))

    assert.deepEqual(onOpenChange.mock.calls, [[true]])
    assert.equal(screen.queryByRole('dialog'), null)

    rerender(
      <Popover open onOpenChange={onOpenChange} label="Notifications" trigger={trigger}>
        <p>No new notifications</p>
      </Popover>,
    )
    await screen.findByRole('dialog', { name: 'Notifications' })

    fireEvent.keyDown(document.body, { key: 'Escape' })

    assert.deepEqual(onOpenChange.mock.calls.at(-1), [false])
    assert.ok(screen.getByRole('dialog', { name: 'Notifications' }), 'the parent still owns open')

    rerender(
      <Popover open={false} onOpenChange={onOpenChange} label="Notifications" trigger={trigger}>
        <p>No new notifications</p>
      </Popover>,
    )
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
  })

  test('a function child receives close, which closes the dialog and reports false', async () => {
    const onOpenChange = vi.fn()
    render(
      <Popover label="Credit Wallet" onOpenChange={onOpenChange} trigger={<button type="button">Wallet</button>}>
        {({ close }) => (
          <button type="button" onClick={close}>
            View Credit Details
          </button>
        )}
      </Popover>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Wallet' }))
    await screen.findByRole('dialog', { name: 'Credit Wallet' })

    fireEvent.click(screen.getByRole('button', { name: 'View Credit Details' }))

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.deepEqual(onOpenChange.mock.calls, [[true], [false]])
  })

  test('the portaled surface copies the theme of the region its trigger sits in', async () => {
    document.documentElement.dataset.theme = 'dark'
    render(
      <div data-theme="light">
        <Popover label="Filters" trigger={<button type="button">Open filters</button>}>
          <p>Tenant and currency</p>
        </Popover>
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }))

    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    assert.equal(dialog.getAttribute('data-theme'), 'light')
    assert.equal(dialog.parentElement?.closest('[data-theme="light"]') ?? null, null, 'the surface is portaled out of the region')
  })
})
