import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, within } from '@testing-library/react'
import { ChipFigures, ChipPoolFigures } from './ChipFigures'
import { chipAccountFixture, chipPoolFixture, chipServer, chipTotalsFixture, renderWithChips } from './chipTestKit'
import styles from './Chips.module.css'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${Number(amount).toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))

function figure(name: string): HTMLElement {
  const group = screen.getByRole('group', { name: 'Chip figures' })
  const card = group.querySelector<HTMLElement>(`[data-figure="${name}"]`)
  assert.ok(card, `the ${name} card renders`)
  return card
}

describe('ChipFigures', () => {
  test('an agent: the five figures in order, its downline under the balance, a positive Ref P/L in green', () => {
    render(<ChipFigures account={chipAccountFixture({ balance: 8000, available: 8000, exposure: 300, downlineBalance: 4000, creditReference: 10000, refPnl: 2000 })} />)
    const group = screen.getByRole('group', { name: 'Chip figures' })
    assert.deepEqual(
      Array.from(group.querySelectorAll('[data-figure]')).map((card) => card.getAttribute('data-figure')),
      ['creditReference', 'balance', 'exposure', 'available', 'refPnl'],
    )
    assert.ok(within(figure('creditReference')).getByText('Credit Reference'))
    assert.ok(within(figure('creditReference')).getByText('INR 10000.00'))
    assert.ok(within(figure('balance')).getByText('INR 8000.00'))
    assert.ok(within(figure('balance')).getByText('Downline holds INR 4000.00'))
    assert.ok(within(figure('exposure')).getByText('INR 300.00'))
    assert.ok(within(figure('available')).getByText('Free to deposit'))
    const refPnl = within(figure('refPnl')).getByText('+INR 2000.00')
    assert.ok(refPnl.classList.contains(styles.gain), 'a positive Ref P/L is green text')
    assert.equal(refPnl.classList.contains(styles.loss), false)
    assert.ok(within(figure('refPnl')).getByText('Upline owes'))
  })

  test('a player that owes its upline: Ref P/L in rose, with the words', () => {
    render(<ChipFigures account={chipAccountFixture({ accountType: 'PLAYER', id: 'player-1', username: 'player1', balance: 700, exposure: 200, available: 500, creditReference: 1000, refPnl: -300 })} />)
    assert.ok(within(figure('balance')).getByText('Chips in the wallet'))
    assert.ok(within(figure('available')).getByText('INR 500.00'))
    assert.ok(within(figure('available')).getByText('Balance − exposure'))
    const refPnl = within(figure('refPnl')).getByText('−INR 300.00')
    assert.ok(refPnl.classList.contains(styles.loss), 'a negative Ref P/L is rose text')
    assert.ok(within(figure('refPnl')).getByText('Owes upline'))
  })

  test('the signed-in agent\'s own figures speak to it: "Upline owes you" in green, "You owe upline" in rose', () => {
    const { rerender } = render(<ChipFigures self account={chipAccountFixture({ refPnl: 2000 })} />)
    assert.ok(within(figure('refPnl')).getByText('+INR 2000.00').classList.contains(styles.gain))
    assert.ok(within(figure('refPnl')).getByText('Upline owes you'))
    rerender(<ChipFigures self account={chipAccountFixture({ refPnl: -300 })} />)
    assert.ok(within(figure('refPnl')).getByText('−INR 300.00').classList.contains(styles.loss))
    assert.ok(within(figure('refPnl')).getByText('You owe upline'))
  })

  test('nothing owed is not coloured', () => {
    render(<ChipFigures account={chipAccountFixture({ refPnl: 0 })} />)
    const refPnl = within(figure('refPnl')).getByText('INR 0.00')
    assert.equal(refPnl.classList.contains(styles.gain) || refPnl.classList.contains(styles.loss), false)
    assert.ok(within(figure('refPnl')).getByText('Nothing owed'))
  })

  test('before the first answer every card keeps its label and holds its place', () => {
    render(<ChipFigures loading />)
    const group = screen.getByRole('group', { name: 'Chip figures' })
    assert.equal(group.getAttribute('aria-busy'), 'true')
    assert.equal(within(group).getAllByText('Loading').length, 5)
    for (const label of ['Credit Reference', 'Balance', 'Exposure', 'Available', 'Ref P/L']) assert.ok(within(group).getByText(label))
  })

  test('a refetch keeps the figures on screen', () => {
    render(<ChipFigures loading account={chipAccountFixture()} />)
    const group = screen.getByRole('group', { name: 'Chip figures' })
    assert.equal(group.getAttribute('aria-busy'), null)
    assert.equal(within(group).queryAllByText('Loading').length, 0)
    assert.equal(within(group).getAllByText('INR 95000.00').length, 2, 'the balance and the available figure')
  })
})

describe('ChipPoolFigures', () => {
  const rootDownline = (totals: Parameters<typeof chipTotalsFixture>[0]) => () => ({
    chipDownline: { __typename: 'ChipDownline', parent: null, pool: null, items: [], total: 7, totals: chipTotalsFixture(totals) },
  })

  test('the whitelabel pool: limit, pool used and available add up, and given out is the chips root accounts hold (T103)', async () => {
    const server = chipServer({ ChipDownline: rootDownline({ balance: 228000, downlineBalance: 38000 }) })
    // The pool's whole use (credit_used) also moves with player deposits, withdrawals and bonus cash: its own figure.
    const pool = chipPoolFixture({ creditLimit: 6000000, used: 5346602.39, available: 653397.61 })
    renderWithChips(<ChipPoolFigures pool={pool} />, server)
    const group = screen.getByRole('group', { name: 'Whitelabel pool' })
    await waitFor(() => assert.deepEqual(
      Array.from(group.querySelectorAll('[data-figure]')).map((card) => card.textContent),
      [
        'Pool limitINR 6000000.00The whitelabel credit pool',
        'Pool usedINR 5346602.39Player deposits and withdrawals, bonus cash and chips out',
        'AvailableINR 653397.61Free to deposit: pool limit − pool used',
        'Given outINR 266000.00Chips held by root accounts and their downline',
      ],
    ))
    assert.equal(group.getAttribute('data-count'), '4')
    // Limit − pool used = available, to the paisa.
    assert.equal(Math.round((pool.creditLimit - pool.used) * 100), Math.round(pool.available * 100))
    // The Root accounts table's own first request, so one answer serves both.
    assert.deepEqual(server.callsOf('ChipDownline')[0]?.variables, { parentAgentId: null, query: null, accountType: null, offset: 0, limit: 20 })
  })

  test('the four pool figures keep their places while the pool loads (no layout jump)', () => {
    const server = chipServer({ ChipDownline: rootDownline({ balance: 0, downlineBalance: 0 }) })
    renderWithChips(<ChipPoolFigures pool={null} loading />, server)
    const group = screen.getByRole('group', { name: 'Whitelabel pool' })
    assert.deepEqual(Array.from(group.querySelectorAll('[data-figure]')).map((card) => card.getAttribute('data-figure')), ['limit', 'used', 'available', 'givenOut'])
    assert.equal(group.getAttribute('aria-busy'), 'true')
    assert.ok(within(group).getAllByText('Loading').length >= 3)
  })

  test('given out holds its place while the root accounts load, and reads "—" when they cannot be read', async () => {
    const server = chipServer({ ChipDownline: () => new Error('Forbidden') })
    renderWithChips(<ChipPoolFigures pool={chipPoolFixture()} />, server)
    const card = () => screen.getByRole('group', { name: 'Whitelabel pool' }).querySelector<HTMLElement>('[data-figure="givenOut"]')!
    assert.ok(within(card()).getByText('Loading'))
    await waitFor(() => assert.ok(within(card()).getByText('—')))
  })
})
