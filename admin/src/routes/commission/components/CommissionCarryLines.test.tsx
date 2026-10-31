import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { CommissionCarryLines } from './CommissionCarryLines'

const format = (value: number) => `INR ${value.toFixed(2)}`
afterEach(cleanup)

describe('CommissionCarryLines', () => {
  test('a week: the loss carried in, the part not recovered, and this week\'s loss that carries on', () => {
    render(<CommissionCarryLines figures={{ carriedLoss: 200, carryApplied: 100, lossThisCycle: 30 }} format={format} />)
    const lines = screen.getByLabelText('Loss carry-forward')
    assert.ok(within(lines).getByText('Loss carried from last week'))
    assert.ok(within(lines).getByText('\u2212INR 200.00'))
    assert.ok(within(lines).getByText('Not recovered (forgiven)'))
    assert.ok(within(lines).getByText('INR 100.00'))
    assert.ok(within(lines).getByText("This week's loss (carries to next week)"))
    assert.ok(within(lines).getByText('\u2212INR 30.00'))
  })
  test('a fully recovered loss has no forgiven line; a week with only its own loss shows just that', () => {
    const view = render(<CommissionCarryLines figures={{ carriedLoss: 50, carryApplied: 50, lossThisCycle: 0 }} format={format} />)
    assert.equal(screen.queryByText('Not recovered (forgiven)'), null)
    assert.equal(screen.queryByText("This week's loss (carries to next week)"), null)
    view.unmount()
    render(<CommissionCarryLines figures={{ carriedLoss: 0, carryApplied: 0, lossThisCycle: 12 }} format={format} />)
    assert.equal(screen.queryByText('Loss carried from last week'), null)
    assert.ok(screen.getByText('\u2212INR 12.00'))
  })
  test('several weeks: one line with the losses taken off between them, no "this week" line', () => {
    render(<CommissionCarryLines figures={{ carriedLoss: 300, carryApplied: 120, lossThisCycle: 40 }} format={format} multiWeek />)
    const lines = screen.getByLabelText('Loss carry-forward')
    assert.ok(within(lines).getByText('Losses carried between weeks'))
    assert.ok(within(lines).getByText('\u2212INR 120.00'))
    assert.equal(within(lines).queryByText("This week's loss (carries to next week)"), null)
  })
  test('nothing to show renders nothing (no loss either way, or an older backend)', () => {
    const empty = render(<CommissionCarryLines figures={{ carriedLoss: 0, carryApplied: 0, lossThisCycle: 0 }} format={format} />)
    assert.equal(empty.container.innerHTML, '')
    empty.unmount()
    const legacy = render(<CommissionCarryLines figures={null} format={format} />)
    assert.equal(legacy.container.innerHTML, '')
  })
})
