import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { HeatmapStrip } from './HeatmapStrip'

describe('casino activity heatmap', () => {
  test('provides activity and signed margins with touch/keyboard detail access', async () => {
    render(<HeatmapStrip title="Game activity" empty="Nothing yet" items={[{ id: 'a', name: 'Roulette', bets: 10, intensity: 100, margin: -12.5, detail: <span>Payouts: 125</span> }]} />)
    assert.ok(screen.getByRole('meter', { name: 'Roulette intensity' }))
    fireEvent.click(screen.getByRole('button', { name: /Roulette/ }))
    const detail = await screen.findByRole('dialog', { name: 'Roulette activity details' })
    assert.ok(within(detail).getByText('Payouts: 125'))
    fireEvent.keyDown(detail, { key: 'Escape' })
    await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false))
  })
  test('owns only an internal scroll rail, enabling directional controls when content overflows', async () => {
    render(<HeatmapStrip title="Vendor activity" empty="Nothing yet" items={[{ id: 'a', name: 'Provider', bets: 1, intensity: 50, detail: 'Detail' }]} />)
    const rail = screen.getByRole('region', { name: 'Vendor activity scrollable activity' })
    Object.defineProperties(rail, { scrollWidth: { configurable: true, value: 900 }, clientWidth: { configurable: true, value: 300 }, scrollLeft: { configurable: true, value: 0, writable: true } })
    const scroll = vi.fn()
    rail.scrollBy = scroll
    fireEvent.scroll(rail)
    const next = screen.getByRole('button', { name: 'Scroll Vendor activity right' }) as HTMLButtonElement
    await waitFor(() => assert.equal(next.disabled, false))
    fireEvent.click(next)
    assert.deepEqual(scroll.mock.calls[0][0], { left: 250, behavior: 'smooth' })
  })
  test('reports the original no-data state without a fake activity tile', () => {
    render(<HeatmapStrip title="Player activity" items={[]} empty="No activity data" />)
    assert.ok(screen.getByText('No activity data'))
    assert.equal(Boolean(screen.queryByRole('meter')), false)
  })
})
