import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LiveWorkspaceNavigation, LiveWorkspaceTitle } from './LiveWorkspaceNavigation'

afterEach(cleanup)
const state = { hasDashData: true, isUpdating: false, cubeRotation: 0 }
describe('live workspace navigation contracts', () => {
  test('makes the existing guarded Sports Exposure panel reachable with matching tab and title IDs', () => {
    const change = vi.fn()
    const { rerender } = render(<><LiveWorkspaceNavigation {...state} feature="sports" activeTab="running-events" setActiveTab={change} /><LiveWorkspaceTitle feature="sports" activeTab="running-events" /></>)
    assert.deepEqual(screen.getAllByRole('tab').map(tab => tab.textContent), ['Running Events', 'Overview', 'Analytics', 'Performance', 'Exposure', 'Bet List', 'Compare', 'Players', 'Markets'])
    fireEvent.click(screen.getByRole('tab', { name: 'Exposure' }))
    assert.equal(change.mock.calls[0][0], 'exposure')
    rerender(<><LiveWorkspaceNavigation {...state} feature="sports" activeTab="exposure" setActiveTab={change} /><LiveWorkspaceTitle feature="sports" activeTab="exposure" /></>)
    const exposure = screen.getByRole('tab', { name: 'Exposure' })
    assert.equal(exposure.getAttribute('aria-selected'), 'true')
    assert.equal(exposure.getAttribute('aria-controls'), 'sports-live-panel-exposure')
    assert.equal(screen.getByRole('heading', { name: 'Exposure' }).id, 'sports-live-tab-exposure-heading')
  })
  test('keeps the existing eight Casino and Matka views unchanged', () => {
    const { rerender } = render(<LiveWorkspaceNavigation {...state} feature="casino" activeTab="overview" setActiveTab={() => {}} />)
    const labels = ['Overview', 'Analytics', 'Performance', 'Heatmap', 'Bet List', 'Compare', 'Players', 'Testing']
    assert.deepEqual(screen.getAllByRole('tab').map(tab => tab.textContent), labels)
    rerender(<LiveWorkspaceNavigation {...state} feature="matka" activeTab="overview" setActiveTab={() => {}} />)
    assert.deepEqual(screen.getAllByRole('tab').map(tab => tab.textContent), labels)
  })
  test('preserves native tab keyboard navigation and connection status', () => {
    const change = vi.fn()
    render(<LiveWorkspaceNavigation {...state} hasDashData={false} feature="sports" activeTab="performance" setActiveTab={change} />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Performance' }), { key: 'ArrowRight' })
    assert.equal(change.mock.calls[0][0], 'exposure')
    assert.ok(screen.getByText('Waiting for data'))
  })
})
