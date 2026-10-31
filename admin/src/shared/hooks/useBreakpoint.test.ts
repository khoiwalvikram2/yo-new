/**
 * useBreakpoint gains isWide (viewport >= 1280px) as its own piece of state,
 * independent of the mobile/tablet/desktop breakpoint, because usePanelLayout
 * (a later task) only persists panelCollapsed at wide viewports (decision 11).
 * This proves the initial value comes from window.innerWidth, the existing
 * breakpoint flags are unaffected, and isWide updates when the 1280px
 * matchMedia query changes — the shared vitest.setup.ts matchMedia stub never
 * fires 'change' (its addEventListener is a no-op), so the resize case installs
 * its own tracked stub whose listeners the test can invoke directly.
 */
import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { act, renderHook } from '@testing-library/react'
import { useBreakpoint } from './useBreakpoint'

const ORIGINAL_INNER_WIDTH = window.innerWidth
const ORIGINAL_MATCH_MEDIA = window.matchMedia

type ChangeListener = () => void

function setInnerWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
}

function installTrackedMatchMedia() {
  const listenersByQuery = new Map<string, Set<ChangeListener>>()
  window.matchMedia = ((query: string) => {
    let listeners = listenersByQuery.get(query)
    if (!listeners) {
      listeners = new Set<ChangeListener>()
      listenersByQuery.set(query, listeners)
    }
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: ChangeListener) => {
        listeners!.add(listener)
      },
      removeEventListener: (_type: string, listener: ChangeListener) => {
        listeners!.delete(listener)
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList
  }) as typeof window.matchMedia
  return {
    fireChange(query: string): void {
      const listeners = listenersByQuery.get(query)
      if (!listeners) return
      for (const listener of listeners) listener()
    },
  }
}

describe('useBreakpoint', () => {
  afterEach(() => {
    setInnerWidth(ORIGINAL_INNER_WIDTH)
    window.matchMedia = ORIGINAL_MATCH_MEDIA
  })

  test('1440px reports isWide and isDesktop, no other flag set', () => {
    setInnerWidth(1440)
    const { result } = renderHook(() => useBreakpoint())
    assert.equal(result.current.isWide, true)
    assert.equal(result.current.isDesktop, true)
    assert.equal(result.current.isSmallScreen, false)
    assert.equal(result.current.isMobile, false)
    assert.equal(result.current.isTablet, false)
  })

  test('1024px is desktop but not wide', () => {
    setInnerWidth(1024)
    const { result } = renderHook(() => useBreakpoint())
    assert.equal(result.current.isWide, false)
    assert.equal(result.current.isDesktop, true)
  })

  test('900px is a small screen and not wide', () => {
    setInnerWidth(900)
    const { result } = renderHook(() => useBreakpoint())
    assert.equal(result.current.isSmallScreen, true)
    assert.equal(result.current.isWide, false)
  })

  test('crossing below 1280px flips isWide to false on the matchMedia change event', () => {
    const tracked = installTrackedMatchMedia()
    setInnerWidth(1440)
    const { result } = renderHook(() => useBreakpoint())
    assert.equal(result.current.isWide, true)

    setInnerWidth(1100)
    act(() => {
      tracked.fireChange('(min-width: 1280px)')
    })
    assert.equal(result.current.isWide, false)
  })
})
