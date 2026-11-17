/**
 * AgentCreditWalletView renders from state alone. A CREDIT agent's wallet is on Deposit/Withdraw chips
 * (spec 2026-11-02 §8): the trigger shows its balance, the panel its balance, downline balance, credit
 * reference and Ref P/L with the "Open Chips" footer. The credit-limit figures, the status pill, the
 * Settlement tab and the Sharing tab are gone (CREDIT has no partnership split).
 */
import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentCreditWalletView } from './AgentCreditWalletView'
import type { AgentCreditState } from './useAgentCredit'

const formatAmount = (n: number, c?: string) => `${c ?? 'X'}${n.toFixed(2)}`

const readyState: AgentCreditState = {
  visible: true,
  loading: false,
  chips: { currency: 'INR', balance: 95000, downlineBalance: 9700, creditReference: 100000, refPnl: 4700 },
}

async function openPopover(state: AgentCreditState = readyState, onViewDetails = () => {}) {
  render(<AgentCreditWalletView state={state} compact={false} formatAmount={formatAmount} onViewDetails={onViewDetails} />)
  fireEvent.click(screen.getByRole('button', { name: /chips wallet/i }))
  await waitFor(() => assert.ok(screen.getByRole('dialog', { name: 'Chips Wallet' })))
}

describe('AgentCreditWalletView', () => {
  test('renders nothing when state.visible is false', () => {
    const { container } = render(
      <AgentCreditWalletView state={{ ...readyState, visible: false }} compact={false} formatAmount={formatAmount} onViewDetails={() => {}} />,
    )
    assert.equal(container.innerHTML, '')
  })

  test('renders a loading placeholder while state.loading is true', () => {
    const { container } = render(
      <AgentCreditWalletView
        state={{ ...readyState, loading: true, chips: null }}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />,
    )
    assert.notEqual(container.innerHTML, '')
    assert.equal(screen.queryByRole('button', { name: /chips wallet/i }), null)
  })

  test('the trigger shows the balance in the account currency and carries no credit-limit dot', () => {
    render(<AgentCreditWalletView state={readyState} compact={false} formatAmount={formatAmount} onViewDetails={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Chips wallet, balance INR95000.00' })
    assert.ok(trigger.textContent?.includes('INR95000.00'))
    assert.equal(trigger.querySelector('span[aria-hidden="true"]')?.children.length, 1, 'wallet icon only, no alert dot')
  })

  test('balance, downline balance, credit reference and Ref P/L; no limit, used or usage', async () => {
    const onViewDetails = vi.fn()
    await openPopover(readyState, onViewDetails)
    for (const text of ['Balance', 'Downline balance', 'INR9700.00', 'Credit reference', 'INR100000.00', '+INR4700.00', 'Upline owes you']) {
      assert.ok(screen.getByText(text), text)
    }
    for (const text of ['Limit', 'Used', 'Usage', 'Available Credit', 'Healthy', 'Settlement Balance']) {
      assert.equal(screen.queryByText(text), null, text)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Open Chips' }))
    assert.equal(onViewDetails.mock.calls.length, 1)
  })

  test('CREDIT has no partnership split: no tabs, no Sharing tab and no share figures', async () => {
    await openPopover()
    assert.equal(screen.queryByRole('tablist'), null)
    assert.equal(screen.queryByRole('tab', { name: 'Sharing' }), null)
    assert.equal(screen.queryByText('Current Period Total'), null)
    assert.ok(screen.getByText('Deposit & Withdraw'))
  })
})
