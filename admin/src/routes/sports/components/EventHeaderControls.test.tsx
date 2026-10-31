import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { toast } from '@/ui/components/toast'
import { EventHeaderControls } from './EventHeaderControls'

vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDateTime: () => 'Oct 10, 14:00' }) }))
beforeEach(() => { useAuthStore.setState({ agent: undefined, user: undefined, roles: [], permissions: [] }); toast.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); toast.clear() })
function props() {
  return { eventName: 'India v Australia', eventSport: 'Cricket', eventCompetition: 'International', eventStartTime: '2026-10-10', eventCode: '34.1129', isLive: true, eventId: 'event-1', autoRefresh: true, setAutoRefresh: vi.fn(), handleRefresh: vi.fn(), autoRefreshNoteId: 'refresh-note', compactMode: false, setCompactMode: vi.fn(), pageContainerRef: { current: null as HTMLDivElement | null }, onRiskConfigClick: vi.fn(), onAutomationConfigClick: vi.fn() }
}
describe('event header controls', () => {
  test('preserves event identity/live state and exact refresh/configuration callbacks', () => {
    const values = props(); render(<EventHeaderControls {...values} />)
    assert.ok(screen.getByRole('heading', { name: /India v Australia/ }))
    assert.ok(screen.getByRole('button', { name: 'Back to Running Events' }))
    assert.ok(screen.getByText('International')); assert.ok(screen.getByText('In play')); assert.ok(screen.getByText('Oct 10, 14:00')); assert.ok(screen.getByText('Event 34.1129'))
    assert.equal(screen.getByRole('switch', { name: 'Auto-refresh' }).getAttribute('aria-describedby'), 'refresh-note')
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-refresh' })); assert.equal(values.setAutoRefresh.mock.calls[0][0], false)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' })); assert.equal(values.handleRefresh.mock.calls.length, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Risk Configuration' })); assert.equal(values.onRiskConfigClick.mock.calls.length, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Automation Configuration' })); assert.equal(values.onAutomationConfigClick.mock.calls.length, 1)
  })
  test('shows the event status in the head pill while the event is not live', () => {
    const { rerender } = render(<EventHeaderControls {...props()} isLive={false} eventStatus="suspended" />)
    assert.ok(screen.getByText('Suspended')); assert.equal(Boolean(screen.queryByText('In play')), false)
    rerender(<EventHeaderControls {...props()} isLive={false} eventStatus={undefined} />)
    assert.ok(screen.getByText('Upcoming'))
  })
  test('keeps risk and automation controls absent for agent logins', () => {
    useAuthStore.setState({ agent: { id: 'agent-1', tenantId: 'tenant-1', username: 'agent', phone: null, schemeType: 'COMMISSION', status: 'ACTIVE', allowedDomains: ['sports'], parentAgentId: null, levelIndex: 1, tallyEnabled: false, tallyDomains: [], createdAt: '2026-10-09' } })
    render(<EventHeaderControls {...props()} />)
    assert.equal(Boolean(screen.queryByRole('button', { name: 'Risk Configuration' })), false)
    assert.equal(Boolean(screen.queryByRole('button', { name: 'Automation Configuration' })), false)
    assert.ok(screen.getByRole('button', { name: 'Refresh now' }))
  })
  test('does not pretend fullscreen succeeded when unavailable or refused', async () => {
    const values = props(); const container = document.createElement('div'); values.pageContainerRef.current = container
    const { rerender } = render(<EventHeaderControls {...values} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' })))
    assert.equal(values.setCompactMode.mock.calls.length, 0)
    assert.ok(toast.peek().at(-1)?.message.includes('not available'))
    Object.defineProperty(container, 'requestFullscreen', { configurable: true, value: vi.fn(async () => { throw new Error('Permission denied') }) })
    rerender(<EventHeaderControls {...values} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' })))
    assert.equal(values.setCompactMode.mock.calls.length, 0)
    assert.equal(toast.peek().at(-1)?.message, 'Permission denied')
  })
  test('single-flights actual fullscreen requests, updates only on success and tracks native exit events', async () => {
    const values = props(); const container = document.createElement('div'); values.pageContainerRef.current = container
    let resolve!: () => void
    const request = vi.fn(() => new Promise<void>(done => { resolve = done }))
    Object.defineProperty(container, 'requestFullscreen', { configurable: true, value: request })
    render(<EventHeaderControls {...values} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' })); fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    assert.equal(request.mock.calls.length, 1)
    assert.equal(values.setCompactMode.mock.calls.length, 0)
    await act(async () => resolve())
    assert.equal(values.setCompactMode.mock.calls[0][0], true)
    fireEvent(document, new Event('fullscreenchange'))
    assert.equal(values.setCompactMode.mock.calls.at(-1)?.[0], false)
  })
})
