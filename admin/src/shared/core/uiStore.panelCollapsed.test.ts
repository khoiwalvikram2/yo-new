/**
 * panelCollapsed is the ≥1280px "chevron collapses the panel" choice (decision 11). It must persist
 * into the same `ui-storage` key as tenant, with no version bump, so a reload keeps the panel state.
 */
import assert from 'node:assert/strict'
import { test, describe, beforeEach, vi } from 'vitest'

vi.mock('@/shared/core/api', () => ({
  apolloClient: { mutate: vi.fn(), query: vi.fn(), clearStore: vi.fn(), resetStore: vi.fn() },
}))

import { useUIStore } from './uiStore'

describe('uiStore panelCollapsed', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('defaults to false', () => {
    assert.equal(useUIStore.getState().panelCollapsed, false)
  })

  test('setPanelCollapsed(true) persists it into ui-storage and keeps tenant', () => {
    useUIStore.getState().setPanelCollapsed(true)
    assert.equal(useUIStore.getState().panelCollapsed, true)
    const raw = window.localStorage.getItem('ui-storage')
    assert.ok(raw, 'ui-storage should be written to localStorage')
    const parsed = JSON.parse(raw as string)
    assert.equal(parsed.state.panelCollapsed, true)
    assert.equal(parsed.state.tenant, 'default')
  })
})
