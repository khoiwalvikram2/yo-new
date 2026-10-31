import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { FancyBookTable } from './FancyBookTable'
import styles from './MarketBook.module.css'

vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value * 2 }) }))
beforeEach(() => useAuthStore.setState({ agent: undefined, user: undefined, roles: [], permissions: [] }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const bets = [
  { id: 'a', userId: 'alice', userName: 'Alice', userFlags: { manual: ['REVIEW'], pattern: ['AUTOMATIC'] }, marketId: 'fancy-1', selectionId: 'runs', side: 'back', price: 10, oddsSize: 100, stake: 100, liability: 100, status: 'matched', agentInfo: { agentId: 'agent-1', agentName: 'Agent One', schemeType: 'SHARING', rate: 10 } },
  { id: 'b', userId: 'bob', userName: 'Bob', marketId: 'fancy-1', selectionId: 'runs', side: 'lay', price: 12, oddsSize: 100, stake: 50, liability: 50, status: 'matched' },
  { id: 'e', userId: 'eve', userName: 'Eve', marketId: 'fancy-1', selectionId: 'runs', side: 'back', price: 10, oddsSize: 100, stake: 25, liability: 25, status: 'matched', agentInfo: { agentId: 'agent-2', agentName: 'Other Agent', schemeType: 'COMMISSION', rate: 5 } },
]
function agentLogin() { useAuthStore.setState({ agent: { id: 'agent-1', tenantId: 'tenant-1', username: 'agent', phone: null, schemeType: 'SHARING', allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: null, levelIndex: 1, tallyEnabled: false, tallyDomains: [], createdAt: '2026-10-09' } }) }
const TITLE = /^Player position by final score/
function strip() { return within(screen.getByRole('list', { name: TITLE })).getAllByRole('listitem') }

describe('fancy book player table', () => {
  test('preserves summary/full range, position/name search, global totals, player indicators and market resets', () => {
    const toggle = vi.fn()
    const { rerender } = render(<FancyBookTable market={{ id: 'fancy-1' }} bets={bets} isExpanded onToggle={toggle} selectionId="runs" />)
    const table = screen.getByRole('table', { name: 'Fancy book player positions' })
    assert.equal(within(table).getAllByRole('row').length, 11)
    assert.ok(within(table).getAllByText('₹350.00').length > 0)
    assert.ok(within(table).getAllByText('AL', { exact: true }).length > 0)
    assert.ok(within(table).getAllByText('EV', { exact: true }).length > 0)
    assert.ok(within(table).getAllByLabelText('Active Flags: REVIEW, AUTOMATIC').length > 0)
    fireEvent.change(screen.getByLabelText('Search position or player'), { target: { value: '10' } })
    assert.equal(within(table).getAllByRole('row').length, 2)
    fireEvent.change(screen.getByLabelText('Search position or player'), { target: { value: 'Bob' } })
    assert.equal(within(table).getAllByRole('row').length, 11)
    assert.ok(within(table).getAllByText('AL', { exact: true }).length > 0) // name search filters positions, not other players at that position
    fireEvent.click(screen.getByRole('button', { name: 'Full Range' }))
    assert.equal(within(table).getAllByRole('row').length, 14)
    fireEvent.change(screen.getByLabelText('Search position or player'), { target: { value: 'missing' } })
    assert.ok(screen.getByText('No positions found'))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Fancy Book' }))
    assert.equal(toggle.mock.calls.length, 1)
    rerender(<FancyBookTable market={{ id: 'fancy-2' }} bets={bets.map(bet => ({ ...bet, marketId: 'fancy-2' }))} isExpanded onToggle={toggle} selectionId="runs" />)
    assert.equal((screen.getByLabelText('Search position or player') as HTMLInputElement).value, '')
    assert.equal(screen.getByRole('button', { name: 'Summary' }).getAttribute('aria-pressed'), 'true')
    assert.equal(screen.getByRole('button', { name: 'Full Range' }).getAttribute('aria-pressed'), 'false')
  })
  test('retains agent-only/direct-player avatars without changing aggregate book P/L', () => {
    agentLogin()
    render(<FancyBookTable market={{ id: 'fancy-1' }} bets={bets} isExpanded onToggle={() => {}} selectionId="runs" />)
    const table = screen.getByRole('table', { name: 'Fancy book player positions' })
    assert.ok(within(table).getAllByText('AL', { exact: true }).length > 0)
    assert.ok(within(table).getAllByText('BO', { exact: true }).length > 0)
    assert.equal(Boolean(within(table).queryByText('EV', { exact: true })), false)
    assert.ok(within(table).getAllByText('₹350.00').length > 0)
  })
  test('preserves direct-child descendant scoping and explicit zero sharing metadata', () => {
    const descendants = vi.fn((id: string) => id === 'root-agent' ? ['root-agent', 'agent-1'] : [])
    const info = vi.fn((id: string) => ({ username: id === 'root-agent' ? 'Root Agent' : 'Unknown Agent', schemeType: 'SHARING', rate: 0 }))
    render(<FancyBookTable market={{ id: 'fancy-1' }} bets={bets} isExpanded onToggle={() => {}} selectionId="runs" viewContext={{ directChildAgentIds: ['root-agent'], getDescendantsOf: descendants, getAgentInfo: info }} />)
    const table = screen.getByRole('table', { name: 'Fancy book player positions' })
    assert.ok(within(table).getAllByText('AL', { exact: true }).length > 0)
    assert.ok(within(table).getAllByText('BO', { exact: true }).length > 0)
    assert.equal(Boolean(within(table).queryByText('EV', { exact: true })), false)
    assert.equal(descendants.mock.calls[0][0], 'root-agent')
    assert.equal(info.mock.calls[0][0], 'root-agent')
  })
  test('does not invent a book for empty/irrelevant bets and keeps collapsed content hidden', () => {
    const { rerender } = render(<FancyBookTable market={{ id: 'other' }} bets={bets} isExpanded onToggle={() => {}} />)
    assert.equal(Boolean(screen.queryByRole('heading', { name: TITLE })), false)
    rerender(<FancyBookTable market={{ id: 'fancy-1' }} bets={bets} isExpanded={false} onToggle={() => {}} />)
    assert.ok(screen.getByRole('button', { name: 'Expand Fancy Book' }))
    assert.equal(Boolean(screen.queryByRole('table')), false)
    assert.equal(Boolean(screen.queryByRole('list', { name: TITLE })), false)
    assert.equal(Boolean(screen.queryByLabelText('Search position or player')), false)
  })
})

describe('fancy position strip', () => {
  test('draws one bar per position the table shows, up for player profit and down for loss', () => {
    render(<FancyBookTable market={{ id: 'fancy-1' }} bets={bets} isExpanded onToggle={() => {}} selectionId="runs" selectionName="Runs line" />)
    assert.ok(screen.getByRole('heading', { name: 'Player position by final score · Runs line' }))
    const table = screen.getByRole('table', { name: 'Fancy book player positions' })
    const rows = within(table).getAllByRole('row').slice(1)
    const items = strip()
    assert.equal(items.length, rows.length)
    items.forEach((item, index) => {
      const position = rows[index].querySelector('td')!.textContent!.replace('Break Even', '')
      const pnl = rows[index].querySelectorAll('td')[1].textContent!
      assert.equal(item.textContent!.endsWith(`At ${position}: ${pnl}`), true)
      const sign = pnl.startsWith('₹-') ? 'loss' : pnl === '₹0.00' ? 'flat' : 'profit'
      assert.equal(item.classList.contains(styles.profit), sign === 'profit')
      assert.equal(item.classList.contains(styles.loss), sign === 'loss')
      assert.equal(Boolean(item.querySelector(`.${styles.above} .${styles.fill}`)), sign === 'profit')
      assert.equal(Boolean(item.querySelector(`.${styles.below} .${styles.fill}`)), sign === 'loss')
      assert.equal(item.classList.contains(styles.breakEven), rows[index].textContent!.includes('Break Even'))
    })
    fireEvent.change(screen.getByLabelText('Search position or player'), { target: { value: '10' } })
    assert.equal(strip().length, 1)
    fireEvent.change(screen.getByLabelText('Search position or player'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Full Range' }))
    assert.equal(strip().length, within(table).getAllByRole('row').length - 1)
  })
  test('keeps a long Full Range strip to 25 positions around the break-even', () => {
    // positions 5..75: the players lose below 40 and win from 40 on
    const wide = [
      { id: 'w1', userId: 'alice', userName: 'Alice', marketId: 'fancy-1', selectionId: 'runs', side: 'back', price: 40, oddsSize: 100, stake: 100, liability: 100, status: 'matched' },
      { id: 'w2', userId: 'bob', userName: 'Bob', marketId: 'fancy-1', selectionId: 'runs', side: 'back', price: 10, oddsSize: 100, stake: 1, liability: 1, status: 'matched' },
      { id: 'w3', userId: 'carol', userName: 'Carol', marketId: 'fancy-1', selectionId: 'runs', side: 'lay', price: 70, oddsSize: 100, stake: 1, liability: 1, status: 'matched' },
    ]
    render(<FancyBookTable market={{ id: 'fancy-1' }} bets={wide} isExpanded onToggle={() => {}} selectionId="runs" />)
    assert.equal(strip().length, 10)
    fireEvent.click(screen.getByRole('button', { name: 'Full Range' }))
    const table = screen.getByRole('table', { name: 'Fancy book player positions' })
    assert.equal(within(table).getAllByRole('row').length - 1, 71)
    const items = strip()
    assert.equal(items.length, 25)
    assert.ok(items[0].textContent!.endsWith('At 28: ₹-196.00'))
    assert.ok(items[12].textContent!.endsWith('At 40: ₹204.00'))
    assert.deepEqual(items.map(item => item.classList.contains(styles.breakEven)), items.map((_item, index) => index === 12))
    assert.ok(screen.getByText('The bars show 25 of 71 positions, around the break-even.'))
  })
})
