/**
 * The drawer's "open" state is derived by comparing the navigation key it was
 * opened on against the current navigation key, gated by whether the
 * viewport is currently in drawer mode. This exercises both of those inputs
 * so a regression that reintroduces an effect-driven close (or that forgets
 * to reset state when the viewport leaves drawer mode) is caught.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { act, renderHook } from '@testing-library/react'
import { useNavDrawer } from './useNavDrawer'

describe('useNavDrawer', () => {
  test('a navigationKey change closes an open drawer', () => {
    const { result, rerender } = renderHook(
      ({ navigationKey }: { navigationKey: string }) => useNavDrawer({ isDrawer: true, navigationKey }),
      { initialProps: { navigationKey: 'nav-1' } },
    )

    act(() => {
      result.current.setOpen(true)
    })
    assert.equal(result.current.open, true)

    rerender({ navigationKey: 'nav-2' })
    assert.equal(result.current.open, false)
  })

  test('leaving drawer mode resets the open state, so re-entering drawer mode on the same page stays closed', () => {
    const { result, rerender } = renderHook(
      ({ isDrawer }: { isDrawer: boolean }) => useNavDrawer({ isDrawer, navigationKey: 'nav-1' }),
      { initialProps: { isDrawer: true } },
    )

    act(() => {
      result.current.setOpen(true)
    })
    assert.equal(result.current.open, true)

    rerender({ isDrawer: false })
    assert.equal(result.current.open, false)

    rerender({ isDrawer: true })
    assert.equal(
      result.current.open,
      false,
      'reopening drawer mode on the same navigationKey must not reopen the drawer',
    )
  })
})
