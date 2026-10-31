/**
 * A COMMISSION agent's only view of what they have earned this period is this wallet. The rebuild moves
 * its data into a hook and must keep what the old antd indicator showed: nothing for the wrong scheme or
 * on error, a placeholder while loading, the current-period total in the trigger (hidden when compact
 * below 1024px), and a popover titled "Commission Wallet" / "Agent Commission" with per-domain All-Time /
 * Current Period figures in the payload's currency, plus a "View Commission Details" footer that closes
 * the popover and navigates. Unlike the credit wallets it has no tabs and no status pill. The view takes
 * props only, so this test needs no Apollo, auth or currency mocks.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import type { FormatAmount } from './formatAmount'
import type { AgentCommissionState } from './useAgentCommission'
import type { SharingSummary } from './walletData'
import { AgentCommissionWalletView } from './AgentCommissionWalletView'

const formatAmount: FormatAmount = (n, c) => `${c ?? 'X'}${n.toFixed(2)}`

const commission: SharingSummary = {
  currency: 'INR',
  currentPeriodTotal: 300,
  rows: [
    { domain: 'sports', rate: 2.5, allTime: 1000, currentPeriod: 200 },
    { domain: 'casino', rate: 0, allTime: 500, currentPeriod: 100 },
  ],
}

function makeState(overrides: Partial<AgentCommissionState> = {}): AgentCommissionState {
  return { visible: true, loading: false, commission, ...overrides }
}

const TRIGGER_NAME = 'Commission wallet, INR300.00 current period total'

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: TRIGGER_NAME }))
  return screen.findByRole('dialog', { name: 'Commission Wallet' })
}

describe('AgentCommissionWalletView', () => {
  test('renders nothing when the widget is not visible (wrong scheme, no agent, error or invalid payload)', () => {
    const { container } = render(
      <AgentCommissionWalletView
        state={makeState({ visible: false, loading: true, commission: null })}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />,
    )
    assert.equal(container.childElementCount, 0)
    assert.equal(screen.queryByRole('button'), null)
  })

  test('shows a loading placeholder, not a trigger, while loading or before the payload arrives', () => {
    const loading = render(
      <AgentCommissionWalletView
        state={makeState({ loading: true, commission: null })}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />,
    )
    assert.ok(loading.container.childElementCount > 0, 'a placeholder is rendered')
    assert.equal(screen.queryByRole('button'), null)
    loading.unmount()

    const noPayload = render(
      <AgentCommissionWalletView
        state={makeState({ commission: null })}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />,
    )
    assert.ok(noPayload.container.childElementCount > 0, 'a placeholder is rendered')
    assert.equal(screen.queryByRole('button'), null)
  })

  test('full trigger names and shows the current-period total in the payload currency; the popover starts closed', () => {
    render(
      <AgentCommissionWalletView state={makeState()} compact={false} formatAmount={formatAmount} onViewDetails={() => {}} />,
    )
    const trigger = screen.getByRole('button', { name: TRIGGER_NAME })
    assert.ok(trigger.textContent?.includes('INR300.00'), 'the amount is visible beside the icon')
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    assert.equal(screen.queryByRole('dialog'), null)
  })

  test('compact trigger keeps the amount in its name but does not show it', () => {
    render(
      <AgentCommissionWalletView state={makeState()} compact formatAmount={formatAmount} onViewDetails={() => {}} />,
    )
    const trigger = screen.getByRole('button', { name: TRIGGER_NAME })
    assert.equal(trigger.textContent?.includes('INR300.00'), false)
  })

  test('a click opens "Commission Wallet" with the subtitle, the total, per-domain figures and the footer', async () => {
    render(
      <AgentCommissionWalletView state={makeState()} compact={false} formatAmount={formatAmount} onViewDetails={() => {}} />,
    )
    const dialog = await openDialog()

    assert.equal(screen.getByRole('button', { name: TRIGGER_NAME }).getAttribute('aria-expanded'), 'true')
    assert.ok(within(dialog).getByText('Agent Commission'))
    assert.ok(within(dialog).getByText('Current Period Total'))
    assert.ok(within(dialog).getByText('INR300.00'))

    assert.equal(within(dialog).getAllByText('All-Time').length, 2)
    assert.equal(within(dialog).getAllByText('Current Period').length, 2)
    assert.equal(within(dialog).queryByText('Period'), null, 'the commission widget labels the column "Current Period"')

    assert.ok(within(dialog).getByText('INR1000.00'))
    assert.ok(within(dialog).getByText('INR200.00'))
    assert.ok(within(dialog).getByText('INR500.00'))
    assert.ok(within(dialog).getByText('INR100.00'))

    assert.ok(within(dialog).getByText('2.50%'))
    assert.equal(within(dialog).queryAllByText(/%$/).length, 1, 'a zero rate shows no rate')

    assert.ok(within(dialog).getByRole('button', { name: 'View Commission Details' }))
  })

  test('the popover has no tabs and no status pill; the only button inside is the footer action', async () => {
    render(
      <AgentCommissionWalletView state={makeState()} compact={false} formatAmount={formatAmount} onViewDetails={() => {}} />,
    )
    const dialog = await openDialog()

    assert.equal(within(dialog).queryByRole('tablist'), null)
    assert.equal(screen.queryByRole('tab'), null)
    assert.equal(screen.queryByRole('tabpanel'), null)
    assert.equal(within(dialog).queryByText(/^(Healthy|Warning|Critical)$/), null)
    assert.deepEqual(
      within(dialog).getAllByRole('button').map((button) => button.textContent?.trim()),
      ['View Commission Details'],
    )
  })

  test('View Commission Details closes the popover and calls onViewDetails once', async () => {
    const onViewDetails = vi.fn()
    render(
      <AgentCommissionWalletView
        state={makeState()}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={onViewDetails}
      />,
    )
    await openDialog()

    fireEvent.click(screen.getByRole('button', { name: 'View Commission Details' }))

    assert.equal(onViewDetails.mock.calls.length, 1)
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.equal(screen.getByRole('button', { name: TRIGGER_NAME }).getAttribute('aria-expanded'), 'false')
  })
})
