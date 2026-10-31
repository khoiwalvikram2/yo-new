import { useRef, useState } from 'react'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { Overlay } from './Overlay'
import { Dialog } from './Dialog'
import { startSystemThemeSync, useThemeStore } from '@/ui/theme/themeStore'

let originalTheme: string | null

beforeEach(() => {
  originalTheme = document.documentElement.getAttribute('data-theme')
})

afterEach(() => {
  if (originalTheme === null) document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', originalTheme)
})

function OverlayHarness({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false)
  const first = useRef<HTMLButtonElement>(null)

  return (
    <div data-theme="light" data-testid="page">
      <button type="button" onClick={() => setOpen(true)}>
        Open details
      </button>
      <Overlay
        open={open}
        onOpenChange={setOpen}
        labelledBy="overlay-title"
        initialFocus={first}
        dismissible={dismissible}
        overlayClassName="test-scrim"
        className="test-surface"
      >
        <h2 id="overlay-title">Request details</h2>
        <button ref={first} type="button">
          First action
        </button>
      </Overlay>
    </div>
  )
}

describe('Overlay', () => {
  test('an open root-themed Dialog follows System OS light/dark changes without remounting, losing focus or unlocking scroll', async () => {
    function RootDialogHarness() {
      const [open, setOpen] = useState(false)
      const first = useRef<HTMLInputElement>(null)
      return <><button type="button" onClick={() => setOpen(true)}>Open root dialog</button><Dialog open={open} onOpenChange={setOpen} title="Root theme dialog" initialFocus={first}><input ref={first} aria-label="Dialog notes" /></Dialog></>
    }
    const originalMedia = window.matchMedia
    const originalMode = useThemeStore.getState().mode
    let dark = false
    const listeners = new Set<() => void>()
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: () => ({
      get matches() { return dark },
      addEventListener: (event: string, listener: () => void) => { assert.equal(event, 'change'); listeners.add(listener) },
      removeEventListener: (event: string, listener: () => void) => { assert.equal(event, 'change'); listeners.delete(listener) },
    }) })
    const stop = startSystemThemeSync()
    try {
      useThemeStore.getState().setMode('system')
      render(<RootDialogHarness />)
      const opener = screen.getByRole('button', { name: 'Open root dialog' })
      opener.focus(); fireEvent.click(opener)
      const dialog = await screen.findByRole('dialog', { name: 'Root theme dialog' })
      const scrim = dialog.parentElement!
      await waitFor(() => assert.ok(document.activeElement === screen.getByRole('textbox', { name: 'Dialog notes' }), 'initial focus is inside the dialog notes field'))
      const focused = document.activeElement
      assert.equal(scrim.getAttribute('data-theme'), null)
      assert.ok(scrim.closest('[data-theme]') === document.documentElement, 'the portal inherits the root region')
      assert.equal(document.documentElement.dataset.theme, 'light')
      dark = true; await act(async () => { listeners.forEach(listener => listener()) })
      assert.equal(document.documentElement.dataset.theme, 'dark')
      assert.equal(scrim.closest('[data-theme]')?.getAttribute('data-theme'), 'dark')
      assert.ok(screen.getByRole('dialog', { name: 'Root theme dialog' }) === dialog, 'OS change keeps the same dialog mounted')
      assert.ok(document.activeElement === focused, 'OS change keeps the same focused element')
      assert.equal(document.body.style.overflow, 'hidden')
      dark = false; await act(async () => { listeners.forEach(listener => listener()) })
      assert.equal(scrim.closest('[data-theme]')?.getAttribute('data-theme'), 'light')
      assert.ok(document.activeElement === focused, 'switching back keeps the same focused element')
      fireEvent.keyDown(focused ?? document.body, { key: 'Escape' })
      await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'Escape closes the root dialog'))
      await waitFor(() => assert.ok(document.activeElement === opener, 'Escape returns focus to the connected opener'))
      await waitFor(() => assert.equal(document.body.style.overflow, ''))
    } finally {
      stop()
      Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMedia })
      useThemeStore.getState().setMode(originalMode)
    }
  })

  test('portals with the opener theme, locks scroll, marks the page inert, and focuses inside', async () => {
    document.documentElement.dataset.theme = 'dark'
    render(<OverlayHarness />)
    const opener = screen.getByRole('button', { name: 'Open details' })
    opener.focus()

    fireEvent.click(opener)

    const dialog = await screen.findByRole('dialog', { name: 'Request details' })
    const scrim = dialog.parentElement
    assert.equal(scrim?.dataset.theme, 'light')
    assert.ok(scrim?.classList.contains('test-scrim'))
    assert.ok(dialog.classList.contains('test-surface'))
    assert.equal(dialog.getAttribute('aria-modal'), 'true')
    await waitFor(() => assert.ok(document.activeElement === screen.getByRole('button', { name: 'First action' })))
    await waitFor(() => assert.equal(document.body.style.overflow, 'hidden'))
    await waitFor(() =>
      assert.equal(
        screen.getByTestId('page').closest('[data-floating-ui-inert]')?.getAttribute('aria-hidden'),
        'true',
      ),
    )
  })

  test('Escape and the scrim close it, clean inert/scroll state, and return focus to a connected opener', async () => {
    const { rerender } = render(<OverlayHarness />)
    const opener = screen.getByRole('button', { name: 'Open details' })
    opener.focus()
    fireEvent.click(opener)
    await screen.findByRole('dialog', { name: 'Request details' })
    const focusSpy = vi.spyOn(opener, 'focus')
    focusSpy.mockClear()

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.ok(document.activeElement === opener))
    assert.deepEqual(focusSpy.mock.calls.at(-1), [{ preventScroll: true }])
    await waitFor(() => assert.equal(document.body.style.overflow, ''))
    assert.equal(screen.getByTestId('page').closest('[data-floating-ui-inert]'), null)

    rerender(<OverlayHarness />)
    const nextOpener = screen.getByRole('button', { name: 'Open details' })
    nextOpener.focus()
    fireEvent.click(nextOpener)
    const dialog = await screen.findByRole('dialog', { name: 'Request details' })
    fireEvent.pointerDown(dialog.parentElement as HTMLElement)
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
  })

  test('uses themeFrom only for theme inheritance and still returns focus to the real opener', async () => {
    function ThemedHarness() {
      const [open, setOpen] = useState(false)
      const themeSource = useRef<HTMLDivElement>(null)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open themed dialog</button>
          <div ref={themeSource} data-theme="light">Theme source</div>
          <Overlay
            open={open}
            onOpenChange={setOpen}
            labelledBy="themed-title"
            themeFrom={themeSource}
          >
            <h2 id="themed-title">Themed dialog</h2>
          </Overlay>
        </>
      )
    }

    document.documentElement.dataset.theme = 'dark'
    render(<ThemedHarness />)
    const opener = screen.getByRole('button', { name: 'Open themed dialog' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Themed dialog' })
    assert.equal(dialog.parentElement?.dataset.theme, 'light')
    document.documentElement.dataset.theme = 'light'
    assert.equal(dialog.parentElement?.dataset.theme, 'light')
    screen.getByText('Theme source').setAttribute('data-theme', 'dark')
    document.documentElement.dataset.theme = 'dark'
    assert.equal(dialog.parentElement?.dataset.theme, 'light', 'explicit local theme remains captured for this opening')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => assert.ok(document.activeElement === opener))
  })

  test('dismissible=false ignores Escape and outside presses', async () => {
    render(<OverlayHarness dismissible={false} />)
    const opener = screen.getByRole('button', { name: 'Open details' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Request details' })

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.pointerDown(dialog.parentElement as HTMLElement)

    assert.ok(screen.getByRole('dialog', { name: 'Request details' }))
  })

  test('FloatingOverlay scroll lock stays active until the last nested overlay closes', async () => {
    const onChange = vi.fn()
    const view = render(
      <>
        <Overlay open onOpenChange={onChange} labelledBy="one-title">
          <h2 id="one-title">One</h2>
        </Overlay>
        <Overlay open onOpenChange={onChange} labelledBy="two-title">
          <h2 id="two-title">Two</h2>
        </Overlay>
      </>,
    )

    await waitFor(() => assert.ok(document.querySelector('[role="dialog"][aria-labelledby="two-title"]')))
    await waitFor(() => assert.equal(document.body.style.overflow, 'hidden'))

    view.rerender(
      <Overlay open onOpenChange={onChange} labelledBy="two-title">
        <h2 id="two-title">Two</h2>
      </Overlay>,
    )
    await waitFor(() => assert.equal(document.body.style.overflow, 'hidden'))

    view.rerender(<></>)
    await waitFor(() => assert.equal(document.body.style.overflow, ''))
  })

  test('a backdrop press requests exactly one close', async () => {
    const onOpenChange = vi.fn()
    render(
      <Overlay open onOpenChange={onOpenChange} labelledBy="single-close-title">
        <h2 id="single-close-title">Single close</h2>
      </Overlay>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Single close' })

    fireEvent.pointerDown(dialog.parentElement as HTMLElement)

    assert.deepEqual(onOpenChange.mock.calls, [[false]])
  })

  test('does not focus an opener that was disconnected before close', async () => {
    function DisconnectedHarness() {
      const [open, setOpen] = useState(false)
      const [showOpener, setShowOpener] = useState(true)
      return (
        <>
          {showOpener && (
            <button type="button" onClick={() => setOpen(true)}>
              Open disposable
            </button>
          )}
          <Overlay open={open} onOpenChange={setOpen} labelledBy="disconnected-title">
            <h2 id="disconnected-title">Disposable</h2>
            <button
              type="button"
              onClick={() => {
                setShowOpener(false)
                setOpen(false)
              }}
            >
              Remove opener and close
            </button>
          </Overlay>
        </>
      )
    }

    render(<DisconnectedHarness />)
    const opener = screen.getByRole('button', { name: 'Open disposable' })
    opener.focus()
    const focusSpy = vi.spyOn(opener, 'focus')
    fireEvent.click(opener)
    await screen.findByRole('dialog', { name: 'Disposable' })
    focusSpy.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove opener and close' }))
    })

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.equal(opener.isConnected, false)
    assert.equal(focusSpy.mock.calls.length, 0)
  })
})
