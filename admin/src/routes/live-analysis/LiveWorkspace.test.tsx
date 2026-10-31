import { useRef, useState } from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LiveWorkspaceHeader, type LiveFeature } from './LiveWorkspace'
import { LiveWorkspaceNavigation } from './LiveWorkspaceNavigation'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Workspace({ feature = 'casino', requestFullscreen }: {
  feature?: LiveFeature
  requestFullscreen?: () => Promise<void>
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [compactMode, setCompactMode] = useState(false)
  const [windowMins, setWindowMins] = useState(10)
  const [refreshCount, setRefreshCount] = useState(0)
  const [activeTab, setActiveTab] = useState(feature === 'sports' ? 'running-events' : 'overview')
  return (
    <MemoryRouter>
      <div ref={(node) => {
        ref.current = node
        if (node && requestFullscreen) node.requestFullscreen = requestFullscreen
      }}>
        <LiveWorkspaceHeader feature={feature} pageContainerRef={ref}
          autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh}
          handleRefresh={() => setRefreshCount((value) => value + 1)}
          compactMode={compactMode} setCompactMode={setCompactMode}
          windowMins={windowMins} setWindowMins={setWindowMins} />
        <LiveWorkspaceNavigation feature={feature} activeTab={activeTab} setActiveTab={setActiveTab}
          hasDashData={false} isUpdating={false} cubeRotation={0} />
        <output aria-label="Refresh count">{refreshCount}</output>
        <div role="tabpanel" id={`${feature}-live-panel-${activeTab}`}
          aria-labelledby={`${feature}-live-tab-${activeTab}`}>{activeTab}</div>
      </div>
    </MemoryRouter>
  )
}

describe('live workspace controls', () => {
  test('keeps casino time windows, refresh and auto-refresh controls connected to their state', () => {
    render(<Workspace />)
    const select = screen.getByRole('combobox', { name: 'Time window' }) as HTMLSelectElement
    assert.deepEqual(Array.from(select.options).map((option) => option.value), ['10', '15', '30', '60', '120', '180', '360'])
    fireEvent.change(select, { target: { value: '120' } })
    assert.equal(select.value, '120')
    assert.ok(screen.getByText('120m'))
    const toggle = screen.getByRole('switch', { name: 'Auto-refresh' })
    fireEvent.click(toggle)
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }))
    assert.equal(screen.getByLabelText('Refresh count').textContent, '1')
  })

  test.each(['sports', 'matka'] as const)('%s keeps its title and live status without descriptive heading copy', (feature) => {
    render(<Workspace feature={feature} />)
    assert.ok(screen.getByRole('heading', { level: 1, name: feature === 'sports' ? 'Live Sports Intelligence' : 'Live Matka Intelligence' }))
    assert.ok(screen.queryByText(feature === 'sports' ? 'Running Markets' : 'Open bets only') === null)
    assert.ok(screen.getByText('Live'))
    assert.equal(screen.queryByRole('combobox', { name: 'Time window' }), null)
  })

  test('sports navigation preserves the available views and links keyboard selection to the current panel', () => {
    render(<Workspace feature="sports" />)
    assert.deepEqual(screen.getAllByRole('tab').map((tab) => tab.textContent), [
      'Running Events', 'Overview', 'Analytics', 'Performance', 'Exposure', 'Bet List', 'Compare', 'Players', 'Markets',
    ])
    const first = screen.getByRole('tab', { name: 'Running Events' })
    fireEvent.keyDown(first, { key: 'End' })
    const markets = screen.getByRole('tab', { name: 'Markets' })
    assert.equal(document.activeElement, markets)
    assert.equal(markets.getAttribute('aria-controls'), screen.getByRole('tabpanel').id)
    assert.equal(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0).length, 1)
    fireEvent.keyDown(markets, { key: 'Home' })
    for (const name of ['Running Events', 'Overview', 'Analytics', 'Performance']) {
      fireEvent.keyDown(screen.getByRole('tab', { name }), { key: 'ArrowRight' })
    }
    const exposure = screen.getByRole('tab', { name: 'Exposure' })
    const exposurePanel = screen.getByRole('tabpanel')
    assert.equal(document.activeElement, exposure)
    assert.equal(exposure.getAttribute('aria-selected'), 'true')
    assert.equal(exposure.getAttribute('aria-controls'), exposurePanel.id)
    assert.equal(exposurePanel.getAttribute('aria-labelledby'), exposure.id)
    assert.equal(exposurePanel.textContent, 'exposure')
    assert.equal(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0).length, 1)
  })

  test('enters and exits fullscreen after the browser completes the request', async () => {
    const enter = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true })
    render(<Workspace requestFullscreen={enter} />)
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    await screen.findByRole('button', { name: 'Exit fullscreen' })
    assert.equal(enter.mock.calls.length, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }))
    await screen.findByRole('button', { name: 'Enter fullscreen' })
    assert.equal(exit.mock.calls.length, 1)
    Reflect.deleteProperty(document, 'exitFullscreen')
  })

  test('reports rejected fullscreen requests and keeps the current mode', async () => {
    const enter = vi.fn().mockRejectedValue(new Error('Fullscreen was refused'))
    render(<Workspace requestFullscreen={enter} />)
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    await waitFor(() => assert.ok(screen.getByText('Fullscreen was refused')))
    assert.ok(screen.getByRole('button', { name: 'Enter fullscreen' }))
    assert.equal(screen.queryByRole('button', { name: 'Exit fullscreen' }), null)
  })
})
