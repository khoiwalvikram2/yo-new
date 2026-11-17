/**
 * G601 (owner, 2026-11-04): the classic admin look is gone. Before, <html data-skin="classic"> (set by
 * index.html from localStorage 'admin-skin') kept the tools in the topbar at every width; now only the
 * viewport decides. A stale data-skin attribute is set here on purpose to prove nothing reads it.
 */
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { renderHook } from '@testing-library/react'
import { useToolRailShown } from './toolRailShown'

const viewport = vi.hoisted(() => ({ isSmallScreen: false }))
vi.mock('@/shared/hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isSmallScreen: viewport.isSmallScreen }) }))

afterEach(() => {
  document.documentElement.removeAttribute('data-skin')
  viewport.isSmallScreen = false
})

describe('useToolRailShown', () => {
  test('shows the tool rail from 1024px', () => {
    const { result } = renderHook(() => useToolRailShown())
    assert.equal(result.current, true)
  })

  test('a leftover <html data-skin="classic"> no longer hides the rail', () => {
    document.documentElement.setAttribute('data-skin', 'classic')
    const { result } = renderHook(() => useToolRailShown())
    assert.equal(result.current, true)
  })

  test('keeps the tools in the topbar below 1024px', () => {
    viewport.isSmallScreen = true
    const { result } = renderHook(() => useToolRailShown())
    assert.equal(result.current, false)
  })
})
