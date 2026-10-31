/**
 * Ctrl/Cmd+K is the keyboard way to open GlobalSearch, and this hook is the only thing that toggles it:
 * GlobalSearch's own useSearchShortcut swallows the key without toggling (R1 §f.2), so if this hook
 * breaks, the shortcut silently dies. The rules move verbatim from the old Topbar.tsx:86-109. The key
 * toggles, it matches a lowercase "k" with Ctrl or Meta, and it stays out of the way while someone types
 * in an input or textarea. The exception is when search is already open: then the same shortcut has to
 * close it from inside the search box.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, renderHook, act, fireEvent } from '@testing-library/react'
import { useSearchHotkey } from './useSearchHotkey'

describe('useSearchHotkey', () => {
  test('starts closed', () => {
    const { result } = renderHook(() => useSearchHotkey())
    assert.equal(result.current.open, false)
  })

  test('Ctrl+K opens, a second Ctrl+K closes, and the browser default is prevented each time', () => {
    const { result } = renderHook(() => useSearchHotkey())

    const firstNotPrevented = fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    assert.equal(firstNotPrevented, false)
    assert.equal(result.current.open, true)

    const secondNotPrevented = fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    assert.equal(secondNotPrevented, false)
    assert.equal(result.current.open, false)
  })

  test('Cmd+K (metaKey) toggles too', () => {
    const { result } = renderHook(() => useSearchHotkey())

    assert.equal(fireEvent.keyDown(document.body, { key: 'k', metaKey: true }), false)
    assert.equal(result.current.open, true)

    assert.equal(fireEvent.keyDown(document.body, { key: 'k', metaKey: true }), false)
    assert.equal(result.current.open, false)
  })

  test('ignores K without a modifier, and an uppercase K even with Ctrl', () => {
    const { result } = renderHook(() => useSearchHotkey())

    assert.equal(fireEvent.keyDown(document.body, { key: 'k' }), true)
    assert.equal(result.current.open, false)

    assert.equal(fireEvent.keyDown(document.body, { key: 'K', ctrlKey: true, shiftKey: true }), true)
    assert.equal(result.current.open, false)
  })

  test('does nothing, and leaves the browser default alone, in an input or textarea while search is closed', () => {
    const { result } = renderHook(() => useSearchHotkey())
    render(
      <>
        <input aria-label="Player name" />
        <textarea aria-label="Note" />
      </>,
    )

    const input = screen.getByRole('textbox', { name: 'Player name' })
    assert.equal(fireEvent.keyDown(input, { key: 'k', ctrlKey: true }), true)
    assert.equal(result.current.open, false)

    const textarea = screen.getByRole('textbox', { name: 'Note' })
    assert.equal(fireEvent.keyDown(textarea, { key: 'k', metaKey: true }), true)
    assert.equal(result.current.open, false)
  })

  test('closes from inside an input while search is open (the GlobalSearch box)', () => {
    const { result } = renderHook(() => useSearchHotkey())
    render(<input aria-label="Search" />)

    act(() => {
      result.current.setOpen(true)
    })
    assert.equal(result.current.open, true)

    const input = screen.getByRole('textbox', { name: 'Search' })
    assert.equal(fireEvent.keyDown(input, { key: 'k', ctrlKey: true }), false)
    assert.equal(result.current.open, false)
  })

  test('setOpen opens and closes it directly (trigger click, GlobalSearch onClose)', () => {
    const { result } = renderHook(() => useSearchHotkey())
    const setOpenType: (open: boolean) => void = result.current.setOpen
    assert.equal(typeof setOpenType, 'function')

    act(() => {
      result.current.setOpen(true)
    })
    assert.equal(result.current.open, true)

    act(() => {
      result.current.setOpen(false)
    })
    assert.equal(result.current.open, false)
  })

  test('removes its document listener on unmount', () => {
    const { result, unmount } = renderHook(() => useSearchHotkey())

    assert.equal(fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true }), false)
    assert.equal(result.current.open, true)

    // Spy only now: the effect re-ran when `open` changed, and that cleanup must not count as the unmount.
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    unmount()

    assert.ok(removeSpy.mock.calls.some(([type]) => type === 'keydown'))
    assert.equal(fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true }), true)
  })
})
