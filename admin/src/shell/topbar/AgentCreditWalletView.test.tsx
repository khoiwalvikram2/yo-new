/**
 * AgentCreditWalletView renders each tab from state alone. The old AgentCreditIndicator wrote
 * `const settlementTabContent = (` as JSX text and always rendered `activeTab === 'credit' ?
 * creditTabContent : sharingTabContent`, so choosing Settlement showed the Sharing content
 * (R7-gap-2 §4, decision 4). This test locks in the fix: Credit, Sharing and Settlement each
 * show only their own content, and the status pill / "View Credit Details" footer stay on the
 * Credit tab only.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentCreditWalletView } from './AgentCreditWalletView'
import type { AgentCreditState } from './useAgentCredit'

const formatAmount = (n: number, c?: string) => `${c ?? 'X'}${n.toFixed(2)}`

const readyState: AgentCreditState = {
  visible: true,
  loading: false,
  credit: {
    creditAvailable: 4000,
    creditLimit: 10000,
    creditUsed: 6000,
    usagePercentage: 60,
    isNearLimit: false,
    isCritical: false,
    status: 'healthy',
  },
  settlement: {
    balance: 250,
    rows: [
      { domain: 'Sports', amount: 100 },
      { domain: 'Casino', amount: -50 },
      { domain: 'Matka', amount: 200 },
    ],
  },
  sharing: {
    currency: 'INR',
    currentPeriodTotal: 300,
    rows: [{ domain: 'sports', rate: 5, allTime: 1000, currentPeriod: 300 }],
  },
  sharingLoading: false,
}

async function openPopover() {
  render(
    <AgentCreditWalletView state={readyState} compact={false} formatAmount={formatAmount} onViewDetails={() => {}} />
  )
  fireEvent.click(screen.getByRole('button', { name: /credit wallet/i }))
  await waitFor(() => assert.ok(screen.getByRole('tab', { name: 'Credit' })))
}

describe('AgentCreditWalletView', () => {
  test('renders nothing when state.visible is false', () => {
    const { container } = render(
      <AgentCreditWalletView
        state={{ ...readyState, visible: false }}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />
    )
    assert.equal(container.innerHTML, '')
  })

  test('renders a loading placeholder while state.loading is true', () => {
    const { container } = render(
      <AgentCreditWalletView
        state={{ ...readyState, loading: true, credit: null, settlement: null, sharing: null, sharingLoading: true }}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />
    )
    assert.notEqual(container.innerHTML, '')
  })

  test('Credit tab shows the status pill, credit figures and footer, never the Settlement rows', async () => {
    await openPopover()
    assert.ok(screen.getByText('Healthy'))
    assert.ok(screen.getByText('View Credit Details'))
    assert.equal(screen.queryByText('Settlement Balance'), null)
    assert.equal(screen.queryByText('Casino'), null)
  })

  test('Sharing tab hides the status pill, the footer and the Settlement rows', async () => {
    await openPopover()
    fireEvent.click(screen.getByRole('tab', { name: 'Sharing' }))
    await waitFor(() => assert.ok(screen.getByText('Current Period Total')))
    assert.equal(screen.queryByText('Healthy'), null)
    assert.equal(screen.queryByText('View Credit Details'), null)
    assert.equal(screen.queryByText('Settlement Balance'), null)
  })

  test('Settlement tab shows the balance and Sports/Casino/Matka only there', async () => {
    await openPopover()
    fireEvent.click(screen.getByRole('tab', { name: 'Settlement' }))
    await waitFor(() => assert.ok(screen.getByText('Settlement Balance')))
    assert.ok(screen.getByText('Sports'))
    assert.ok(screen.getByText('Casino'))
    assert.ok(screen.getByText('Matka'))
    assert.equal(screen.queryByText('Healthy'), null)
    assert.equal(screen.queryByText('View Credit Details'), null)
    assert.equal(screen.queryByText('Available Credit'), null)
  })
})
