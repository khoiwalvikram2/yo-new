/**
 * AgentSharingWalletView (R2 §4.3, R8-popover-content §2.5): the wallet stays hidden while the signed-in
 * agent is not eligible, shows a loading placeholder before the first payload arrives, and once loaded
 * opens a popover with the current-period total and one card per domain -- no tabs and no footer, unlike
 * the other wallet widgets -- and its subtitle names the agent's own scheme.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { AgentSharingWalletView } from './AgentSharingWalletView'
import type { AgentSharingState } from './useAgentSharing'

const formatAmount = (n: number, c?: string) => `${c ?? 'X'}${n.toFixed(2)}`

const loadedState: AgentSharingState = {
  visible: true,
  loading: false,
  subtitle: 'Agent Sharing',
  sharing: {
    currency: 'INR',
    currentPeriodTotal: 2100,
    rows: [
      { domain: 'sports', rate: 5, allTime: 20000, currentPeriod: 1500 },
      { domain: 'casino', rate: 3.25, allTime: 5000, currentPeriod: 600 },
      { domain: 'matka', rate: 0, allTime: 800, currentPeriod: 0 },
    ],
  },
}

describe('AgentSharingWalletView', () => {
  test('renders nothing when the agent is not eligible', () => {
    const state: AgentSharingState = { visible: false, loading: false, sharing: null, subtitle: 'Agent Sharing' }
    const { container } = render(<AgentSharingWalletView state={state} compact={false} formatAmount={formatAmount} />)
    assert.equal(container.innerHTML, '')
  })

  test('shows a loading placeholder and no trigger button before the first payload arrives', () => {
    const state: AgentSharingState = { visible: true, loading: true, sharing: null, subtitle: 'Agent Sharing' }
    render(<AgentSharingWalletView state={state} compact={false} formatAmount={formatAmount} />)
    assert.equal(screen.queryByRole('button'), null)
    assert.equal(screen.queryByRole('dialog'), null)
  })

  test('compact trigger carries the amount only in its accessible label', () => {
    render(<AgentSharingWalletView state={loadedState} compact formatAmount={formatAmount} />)
    const trigger = screen.getByRole('button')
    assert.match(trigger.getAttribute('aria-label') ?? '', /INR2100\.00/)
  })

  test('opens a popover with the header, the current-period total and per-domain figures, no tabs or footer', () => {
    render(<AgentSharingWalletView state={loadedState} compact={false} formatAmount={formatAmount} />)
    fireEvent.click(screen.getByRole('button'))
    const dialog = screen.getByRole('dialog')
    assert.ok(dialog)
    assert.equal(screen.queryAllByRole('tab').length, 0)
    assert.ok(screen.getByText('Sharing Wallet'))
    assert.ok(screen.getByText('Agent Sharing'))
    assert.ok(screen.getByText('Current Period Total'))
    // scoped to the dialog: with compact=false the trigger also shows this same amount text
    assert.ok(within(dialog).getByText('INR2100.00'))
    assert.ok(screen.getByText('Sports'))
    assert.ok(screen.getByText('5.00%'))
    assert.ok(screen.getByText('INR20000.00'))
    assert.ok(screen.getByText('INR1500.00'))
    assert.ok(screen.getByText('Casino'))
    assert.ok(screen.getByText('3.25%'))
    assert.ok(screen.getByText('INR5000.00'))
    assert.ok(screen.getByText('INR600.00'))
    assert.ok(screen.getByText('Matka'))
    assert.ok(screen.getByText('INR800.00'))
    assert.ok(screen.getByText('INR0.00'))
    assert.equal(screen.getAllByText('All-Time').length, 3)
    assert.equal(screen.getAllByText('Current Period').length, 3)
  })

  test('subtitle names a CREDIT-scheme agent as the sharing wallet owner', () => {
    const state: AgentSharingState = { ...loadedState, subtitle: 'Credit Agent Sharing' }
    render(<AgentSharingWalletView state={state} compact={false} formatAmount={formatAmount} />)
    fireEvent.click(screen.getByRole('button'))
    assert.ok(screen.getByText('Credit Agent Sharing'))
  })
})
