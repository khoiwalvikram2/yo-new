/**
 * The Growth Metrics card is the one /overview chart whose three figures sat outside its plot helper, so its
 * expand dialog showed the bars alone and the figures only one at a time in the tooltip, on hover. Every other
 * chart dialog shows what its card shows. This mounts the card, opens the dialog and checks that the dialog
 * carries the same three rows as the card (name, signed value, up or down arrow) above a 490px plot, 10px under
 * the old modal's 500 so the dialog fits a 781px-tall viewport without scrolling. jsdom draws no bars
 * (ResponsiveContainer measures 0 wide), so the plot is checked by its container alone.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GrowthMetricsChart } from './GrowthMetricsChart'

const KPIS = { revenueGrowth: 12.34, playerGrowth: -3.1, depositGrowth: 0 }

const EXPECTED = [
  ['Revenue Growth', '+12.34%', 'up'],
  ['Player Growth', '-3.10%', 'down'],
  // zero is not a fall, so it takes the up arrow and the plus sign, as the bar colour does
  ['Deposit Growth', '+0.00%', 'up'],
]

/** Each row as [name, value, arrow], read from the label, the value and the tile's tabler glyph. */
function readRows(root: HTMLElement): string[][] {
  return EXPECTED.map(([name]) => {
    const label = within(root).getByText(name)
    const row = label.parentElement
    assert.ok(row, `${name} sits in a row`)
    const spans = Array.from(row.children)
    assert.equal(spans.length, 3, `${name}: tile, label, value`)
    const [tile, , value] = spans
    assert.equal(tile.getAttribute('aria-hidden'), 'true', `${name}: the tile is decoration`)
    const glyph = tile.querySelector('svg')?.getAttribute('class') ?? ''
    const arrow = /tabler-icon-arrow-up\b/.test(glyph) ? 'up' : /tabler-icon-arrow-down\b/.test(glyph) ? 'down' : glyph
    return [label.textContent ?? '', value.textContent ?? '', arrow]
  })
}

describe('GrowthMetricsChart', () => {
  test('the card shows the three figures above its plot', () => {
    render(<GrowthMetricsChart kpis={KPIS} />)
    const card = screen.getByRole('region', { name: 'Growth Metrics' })
    assert.deepStrictEqual(readRows(card), EXPECTED)
    assert.equal(screen.queryByRole('dialog'), null)
  })

  test('the expand dialog repeats the figures, contains focus and restores its opener on close', async () => {
    render(<GrowthMetricsChart kpis={KPIS} />)
    const card = screen.getByRole('region', { name: 'Growth Metrics' })
    const opener = screen.getByRole('button', { name: 'Expand Growth Metrics' })
    opener.focus()
    fireEvent.click(opener)

    const dialog = await screen.findByRole('dialog', { name: 'Growth Metrics' })
    // the dialog portals to document.body, so none of its rows are the card's own
    assert.equal(card.contains(dialog), false)
    assert.deepStrictEqual(readRows(dialog), readRows(card))

    const plots = dialog.querySelectorAll<HTMLElement>('.recharts-responsive-container')
    assert.equal(plots.length, 1)
    assert.equal(plots[0].style.height, '490px')
    // rows first, then the plot, as on the card
    const firstRow = within(dialog).getByText('Revenue Growth')
    assert.ok(firstRow.compareDocumentPosition(plots[0]) & Node.DOCUMENT_POSITION_FOLLOWING)

    // Nothing in the rows takes focus, so the kit header close control is the first stop.
    const closeControl = within(dialog).getByRole('button', { name: 'Close dialog' })
    await waitFor(() => assert.ok(document.activeElement === closeControl))
    assert.equal(document.body.style.overflow, 'hidden')

    fireEvent.click(closeControl)
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
    await waitFor(() => assert.ok(document.activeElement === opener))
    assert.equal(document.body.style.overflow, '')
  })

  test('Escape dismisses the shared dialog and returns focus to the trigger', async () => {
    render(<GrowthMetricsChart kpis={KPIS} />)
    const opener = screen.getByRole('button', { name: 'Expand Growth Metrics' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Growth Metrics' })

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
    await waitFor(() => assert.ok(document.activeElement === opener))
  })

  test('the scrim dismisses the shared dialog without leaking the body lock', async () => {
    render(<GrowthMetricsChart kpis={KPIS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Growth Metrics' }))
    const dialog = await screen.findByRole('dialog', { name: 'Growth Metrics' })
    assert.equal(document.body.style.overflow, 'hidden')

    fireEvent.pointerDown(dialog.parentElement as HTMLElement)
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
    assert.equal(document.body.style.overflow, '')
  })
})
