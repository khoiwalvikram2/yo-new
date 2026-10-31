/**
 * Decision 11: at 1280px and up the chevron's choice persists in uiStore; at 1024-1279px the panel starts
 * collapsed, a rail click opens it and any navigation (a new location.key, even for the same pathname,
 * deviation D5) closes it again; inside the drawer the panel is always expanded and nothing is persisted,
 * so a visit to a narrow viewport never overwrites the wide preference.
 */
import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, renderHook } from '@testing-library/react'
import { usePanelLayout } from './usePanelLayout'
import type { UsePanelLayoutOptions } from './usePanelLayout'

const WIDE = { isWide: true, isSmallScreen: false }
const MID = { isWide: false, isSmallScreen: false }
const DRAWER = { isWide: false, isSmallScreen: true }

function newSetter() {
  return vi.fn<(collapsed: boolean) => void>()
}

function options(overrides: Partial<UsePanelLayoutOptions>): UsePanelLayoutOptions {
  return {
    navigationKey: 'k1',
    isWide: true,
    isSmallScreen: false,
    panelCollapsed: false,
    setPanelCollapsed: newSetter(),
    ...overrides,
  }
}

function renderLayout(initialProps: UsePanelLayoutOptions) {
  return renderHook((props: UsePanelLayoutOptions) => usePanelLayout(props), { initialProps })
}

describe('usePanelLayout', () => {
  test('viewport comes from isWide and isSmallScreen; the chevron shows everywhere but the drawer', () => {
    const wide = renderLayout(options({ ...WIDE }))
    assert.equal(wide.result.current.viewport, 'wide')
    assert.equal(wide.result.current.showPanelToggle, true)
    const mid = renderLayout(options({ ...MID }))
    assert.equal(mid.result.current.viewport, 'mid')
    assert.equal(mid.result.current.showPanelToggle, true)
    const drawer = renderLayout(options({ ...DRAWER }))
    assert.equal(drawer.result.current.viewport, 'drawer')
    assert.equal(drawer.result.current.showPanelToggle, false)
  })

  test('wide: the panel follows panelCollapsed', () => {
    const setPanelCollapsed = newSetter()
    const props = options({ ...WIDE, panelCollapsed: false, setPanelCollapsed })
    const { result, rerender } = renderLayout(props)
    assert.equal(result.current.panelExpanded, true)
    rerender({ ...props, panelCollapsed: true })
    assert.equal(result.current.panelExpanded, false)
    assert.deepEqual(setPanelCollapsed.mock.calls, [])
  })

  test('wide: the chevron writes the flipped panelCollapsed', () => {
    const setPanelCollapsed = newSetter()
    const props = options({ ...WIDE, panelCollapsed: false, setPanelCollapsed })
    const { result, rerender } = renderLayout(props)
    act(() => result.current.togglePanel())
    assert.deepEqual(setPanelCollapsed.mock.calls, [[true]])
    rerender({ ...props, panelCollapsed: true })
    act(() => result.current.togglePanel())
    assert.deepEqual(setPanelCollapsed.mock.calls, [[true], [false]])
  })

  test('wide: a rail click on a collapsed panel writes false', () => {
    const setPanelCollapsed = newSetter()
    const { result } = renderLayout(options({ ...WIDE, panelCollapsed: true, setPanelCollapsed }))
    act(() => result.current.revealPanel())
    assert.deepEqual(setPanelCollapsed.mock.calls, [[false]])
  })

  test('wide: a rail click on an expanded panel writes nothing', () => {
    const setPanelCollapsed = newSetter()
    const { result } = renderLayout(options({ ...WIDE, panelCollapsed: false, setPanelCollapsed }))
    act(() => result.current.revealPanel())
    assert.deepEqual(setPanelCollapsed.mock.calls, [])
    assert.equal(result.current.panelExpanded, true)
  })

  test('wide: navigation leaves the collapse state alone', () => {
    const setPanelCollapsed = newSetter()
    const props = options({ ...WIDE, panelCollapsed: true, setPanelCollapsed })
    const { result, rerender } = renderLayout(props)
    rerender({ ...props, navigationKey: 'k2' })
    assert.equal(result.current.panelExpanded, false)
    assert.deepEqual(setPanelCollapsed.mock.calls, [])
  })

  test('mid: the panel starts collapsed and the chevron toggles it without writing', () => {
    const setPanelCollapsed = newSetter()
    const { result } = renderLayout(options({ ...MID, panelCollapsed: false, setPanelCollapsed }))
    assert.equal(result.current.panelExpanded, false)
    act(() => result.current.togglePanel())
    assert.equal(result.current.panelExpanded, true)
    act(() => result.current.togglePanel())
    assert.equal(result.current.panelExpanded, false)
    assert.deepEqual(setPanelCollapsed.mock.calls, [])
  })

  test('mid: a rail click opens the panel without writing, whatever panelCollapsed says', () => {
    const setPanelCollapsed = newSetter()
    const { result } = renderLayout(options({ ...MID, panelCollapsed: true, setPanelCollapsed }))
    act(() => result.current.revealPanel())
    assert.equal(result.current.panelExpanded, true)
    assert.deepEqual(setPanelCollapsed.mock.calls, [])
  })

  test('mid: a new navigationKey closes the panel, even for the same pathname', () => {
    const props = options({ ...MID, navigationKey: 'k1' })
    const { result, rerender } = renderLayout(props)
    act(() => result.current.revealPanel())
    assert.equal(result.current.panelExpanded, true)
    // A click on the already-current row: react-router replaces the entry with a fresh location.key.
    rerender({ ...props, navigationKey: 'k2' })
    assert.equal(result.current.panelExpanded, false)
  })

  test('mid: a re-render with the same navigationKey keeps the panel open', () => {
    const props = options({ ...MID, navigationKey: 'k1' })
    const { result, rerender } = renderLayout(props)
    act(() => result.current.revealPanel())
    rerender({ ...props })
    assert.equal(result.current.panelExpanded, true)
  })

  test('mid: going back to an earlier navigationKey does not reopen the panel', () => {
    const props = options({ ...MID, navigationKey: 'k1' })
    const { result, rerender } = renderLayout(props)
    act(() => result.current.revealPanel())
    rerender({ ...props, navigationKey: 'k2' })
    assert.equal(result.current.panelExpanded, false)
    rerender({ ...props, navigationKey: 'k1' })
    assert.equal(result.current.panelExpanded, false)
  })

  test('crossing into mid closes the panel, from wide and from the drawer', () => {
    const props = options({ ...MID, panelCollapsed: false })
    const { result, rerender } = renderLayout(props)
    act(() => result.current.revealPanel())
    assert.equal(result.current.panelExpanded, true)
    rerender({ ...props, ...WIDE })
    assert.equal(result.current.panelExpanded, true)
    rerender({ ...props, ...MID })
    assert.equal(result.current.panelExpanded, false)
    act(() => result.current.revealPanel())
    assert.equal(result.current.panelExpanded, true)
    rerender({ ...props, ...DRAWER })
    assert.equal(result.current.panelExpanded, true)
    rerender({ ...props, ...MID })
    assert.equal(result.current.panelExpanded, false)
  })

  test('crossing into wide follows the stored panelCollapsed without writing', () => {
    const setPanelCollapsed = newSetter()
    const props = options({ ...MID, panelCollapsed: true, setPanelCollapsed })
    const { result, rerender } = renderLayout(props)
    act(() => result.current.revealPanel())
    assert.equal(result.current.panelExpanded, true)
    rerender({ ...props, ...WIDE })
    assert.equal(result.current.viewport, 'wide')
    assert.equal(result.current.panelExpanded, false)
    assert.deepEqual(setPanelCollapsed.mock.calls, [])
  })

  test('drawer: the panel is always expanded and the chevron and rail click never write', () => {
    const setPanelCollapsed = newSetter()
    const { result } = renderLayout(options({ ...DRAWER, panelCollapsed: true, setPanelCollapsed }))
    assert.equal(result.current.panelExpanded, true)
    act(() => result.current.togglePanel())
    act(() => result.current.revealPanel())
    assert.equal(result.current.panelExpanded, true)
    assert.deepEqual(setPanelCollapsed.mock.calls, [])
  })

  test('drawer: a visit from a collapsed wide panel keeps the stored preference', () => {
    const setPanelCollapsed = newSetter()
    const props = options({ ...WIDE, panelCollapsed: true, setPanelCollapsed })
    const { result, rerender } = renderLayout(props)
    assert.equal(result.current.panelExpanded, false)
    rerender({ ...props, ...DRAWER })
    assert.equal(result.current.panelExpanded, true)
    rerender({ ...props, ...WIDE })
    assert.equal(result.current.panelExpanded, false)
    assert.deepEqual(setPanelCollapsed.mock.calls, [])
  })
})
