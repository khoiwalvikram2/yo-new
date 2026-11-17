import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { useAuthStore } from '@/shared/core/authStore'
import type { Player } from '@/shared/types/player'
import { BalanceAdjustmentModal } from './BalanceAdjustmentModal'

vi.mock('@/shared/services/notification', () => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ getCurrencySymbol: () => '₹', formatAmount: (value: number) => '₹' + Number(value).toFixed(2) }) }))

let sent: Array<Record<string, unknown>>
beforeEach(() => { sent = []; useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'players.wallet', actions: ['view', 'update'] }] }) })

// Cash 0.30 with 0.10 held as exposure: 0.20 may be withdrawn. In floats 0.30 - 0.10 is 0.19999999999999998, which
// showed "Available balance: ₹0.20" and then warned about, and refused, a withdrawal of exactly 0.20.
const player: Player = {
  id: 'p1', name: 'vfyfix Player', phone: '9000000001', status: 'ACTIVE', bonusAllowed: true,
  wallet: { userId: 'p1', currency: 'INR', balance: 0.3, bonus: 0, exposure: 0.1, updatedAt: '2026-11-03T00:00:00Z' },
}

test('the whole available balance, cash less exposure to the cent, can be withdrawn', async () => {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    sent.push(JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown>)
    queueMicrotask(() => {
      observer.next({ data: { adjustWallet: { __typename: 'Wallet', userId: 'p1', balance: 0.1, bonus: 0, currency: 'INR', exposure: 0.1, updatedAt: '2026-11-03T00:00:00Z' } } })
      observer.complete()
    })
  }))
  render(<MockedProvider cache={new InMemoryCache()} link={link}><BalanceAdjustmentModal open player={player} onClose={() => {}} onSuccess={() => {}} /></MockedProvider>)
  const d = await screen.findByRole('dialog', { name: 'Adjust Balance' })
  fireEvent.click(within(d).getByRole('tab', { name: 'Withdrawal' }))
  assert.ok(within(d).getByText('Available balance: ₹0.20'))
  fireEvent.change(within(d).getByRole('textbox', { name: 'Withdrawal Amount' }), { target: { value: '0.20' } })
  fireEvent.change(within(d).getByRole('textbox', { name: 'Reason' }), { target: { value: 'vfyfix full withdrawal' } })
  assert.equal(within(d).queryAllByText('Withdrawal amount exceeds available balance').length, 0, 'no warning at exactly the available balance')
  await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Withdraw' })) })
  assert.deepEqual(sent, [{ userId: 'p1', amount: -0.2, reason: 'vfyfix full withdrawal' }])
})

// PLA-15 follow-up: above the available balance the dialog warned and refused while its preview still read "New balance
// will be: ₹0.00", as if the withdrawal would go through. The warning now stands alone.
test('a withdrawal above the available balance shows the warning and no new-balance figure', async () => {
  render(<MockedProvider cache={new InMemoryCache()}><BalanceAdjustmentModal open player={player} onClose={() => {}} onSuccess={() => {}} /></MockedProvider>)
  const d = await screen.findByRole('dialog', { name: 'Adjust Balance' })
  fireEvent.click(within(d).getByRole('tab', { name: 'Withdrawal' }))
  const amount = within(d).getByRole('textbox', { name: 'Withdrawal Amount' })

  // Above the cash itself (the old preview clamped this to ₹0.00) and between the available 0.20 and the cash 0.30.
  for (const typed of ['50', '0.25']) {
    fireEvent.change(amount, { target: { value: typed } })
    assert.equal(within(d).queryAllByText('Withdrawal amount exceeds available balance').length, 1, `${typed}: the warning shows`)
    assert.equal(within(d).queryByText(/New balance will be/), null, `${typed}: no new-balance figure beside the warning`)
  }

  // Within the available balance the preview is back, with the balance the withdrawal leaves.
  fireEvent.change(amount, { target: { value: '0.15' } })
  assert.ok(within(d).getByText('New balance will be: ₹0.15'))
  assert.equal(within(d).queryAllByText('Withdrawal amount exceeds available balance').length, 0)

  // A deposit is never held back by the balance.
  fireEvent.click(within(d).getByRole('tab', { name: 'Deposit' }))
  fireEvent.change(within(d).getByRole('textbox', { name: 'Deposit Amount' }), { target: { value: '50' } })
  assert.ok(within(d).getByText('New balance will be: ₹50.30'))
})
