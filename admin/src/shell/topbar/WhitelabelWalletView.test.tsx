/**
 * The whitelabel wallet is how a Whitelabel Admin sees how much credit is left before players can no longer
 * be credited, and what the whitelabel has earned from sharing. The rebuild must keep today's behaviour:
 * a placeholder until credit data exists (also after a credit error), the available amount on the trigger
 * (only in its name when compact below 1024px), Credit and Sharing tabs, the status pill and the
 * "View Credit Details" footer on the Credit tab only, sharing amounts in the sharing payload's currency, and
 * "No sharing data available" once sharing has finished loading with nothing. The trigger had no accessible
 * name before; it now names the wallet and the amount. The view takes everything as props, so it needs no mocks.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { CreditFigures, SharingSummary } from './walletData'
import type { WhitelabelCreditState } from './useWhitelabelCredit'
import { WhitelabelWalletView } from './WhitelabelWalletView'

const formatAmount = (n: number, c?: string) => `${c ?? 'X'}${n.toFixed(2)}`

const healthyCredit: CreditFigures = {
  creditAvailable: 6000,
  creditLimit: 10000,
  creditUsed: 4000,
  usagePercentage: 40,
  isNearLimit: false,
  isCritical: false,
  status: 'healthy',
}

const warningCredit: CreditFigures = {
  creditAvailable: 1500,
  creditLimit: 10000,
  creditUsed: 8500,
  usagePercentage: 85,
  isNearLimit: true,
  isCritical: false,
  status: 'warning',
}

const sharing: SharingSummary = {
  currency: 'INR',
  currentPeriodTotal: 300,
  rows: [{ domain: 'sports', rate: 10, allTime: 1000, currentPeriod: 300 }],
}

function makeState(overrides: Partial<WhitelabelCreditState> = {}): WhitelabelCreditState {
  return { loading: false, credit: healthyCredit, sharing, sharingLoading: false, ...overrides }
}

async function openWallet(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: /^Whitelabel wallet, / }))
  return screen.findByRole('dialog', { name: 'Whitelabel Wallet' })
}

describe('WhitelabelWalletView', () => {
  test('shows the loading placeholder, not a trigger, while loading and when credit is missing', () => {
    const { rerender, container } = render(
      <WhitelabelWalletView
        state={makeState({ loading: true, credit: null })}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />,
    )
    assert.equal(screen.queryByRole('button'), null)
    assert.ok(container.firstChild, 'the placeholder renders something')

    rerender(
      <WhitelabelWalletView
        state={makeState({ loading: false, credit: null })}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />,
    )
    assert.equal(screen.queryByRole('button'), null)
    assert.equal(screen.queryByText('X6000.00'), null)
  })

  test('the full trigger names the wallet and shows the available amount without a currency argument', () => {
    render(
      <WhitelabelWalletView state={makeState()} compact={false} formatAmount={formatAmount} onViewDetails={() => {}} />,
    )
    const trigger = screen.getByRole('button', { name: 'Whitelabel wallet, X6000.00 available' })
    assert.ok(trigger.textContent?.includes('X6000.00'))
    assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog')
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  })

  test('the compact trigger keeps the amount in its name but not on screen', () => {
    render(<WhitelabelWalletView state={makeState()} compact formatAmount={formatAmount} onViewDetails={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Whitelabel wallet, X6000.00 available' })
    assert.equal(trigger.textContent?.includes('X6000.00'), false)
  })

  test('opens on the Credit tab with title, subtitle, two tabs, status pill, credit figures and footer', async () => {
    render(
      <WhitelabelWalletView state={makeState()} compact={false} formatAmount={formatAmount} onViewDetails={() => {}} />,
    )
    const dialog = await openWallet()
    const text = dialog.textContent ?? ''

    assert.ok(text.includes('Whitelabel Wallet'))
    assert.ok(text.includes('Credit & Sharing'))

    assert.ok(screen.getByRole('tablist'))
    const tabs = screen.getAllByRole('tab')
    assert.deepEqual(
      tabs.map((tab) => tab.textContent?.trim()),
      ['Credit', 'Sharing'],
    )
    assert.equal(screen.getByRole('tab', { name: 'Credit' }).getAttribute('aria-selected'), 'true')
    assert.equal(screen.getByRole('tab', { name: 'Sharing' }).getAttribute('aria-selected'), 'false')
    assert.equal(screen.queryByRole('tab', { name: 'Settlement' }), null)

    const panel = screen.getByRole('tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), screen.getByRole('tab', { name: 'Credit' }).id)

    assert.ok(text.includes('Healthy'), 'status pill on the Credit tab')
    assert.ok(text.includes('Available Credit'))
    assert.ok(text.includes('X10000.00'), 'limit, no currency argument')
    assert.ok(text.includes('X4000.00'), 'used, no currency argument')
    assert.ok(screen.getByRole('button', { name: 'View Credit Details' }))
  })

  test('the Sharing tab shows sharing figures in the payload currency and hides the pill and footer', async () => {
    render(
      <WhitelabelWalletView state={makeState()} compact={false} formatAmount={formatAmount} onViewDetails={() => {}} />,
    )
    const dialog = await openWallet()

    fireEvent.click(screen.getByRole('tab', { name: 'Sharing' }))

    assert.equal(screen.getByRole('tab', { name: 'Sharing' }).getAttribute('aria-selected'), 'true')
    assert.equal(screen.getByRole('tab', { name: 'Credit' }).getAttribute('aria-selected'), 'false')
    assert.equal(
      screen.getByRole('tabpanel').getAttribute('aria-labelledby'),
      screen.getByRole('tab', { name: 'Sharing' }).id,
    )

    const text = dialog.textContent ?? ''
    assert.ok(text.includes('Current Period Total'))
    assert.ok(text.includes('INR300.00'), 'period total in the sharing currency')
    assert.ok(text.includes('INR1000.00'), 'all-time row amount in the sharing currency')
    assert.equal(text.includes('Available Credit'), false)
    assert.equal(text.includes('Healthy'), false, 'no status pill on the Sharing tab')
    assert.equal(screen.queryByRole('button', { name: 'View Credit Details' }), null)
  })

  test('the Sharing tab without data shows no message while loading and the message after', async () => {
    const view = (sharingLoading: boolean) => (
      <WhitelabelWalletView
        state={makeState({ sharing: null, sharingLoading })}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />
    )
    const { rerender } = render(view(true))
    const dialog = await openWallet()
    fireEvent.click(screen.getByRole('tab', { name: 'Sharing' }))

    assert.equal((dialog.textContent ?? '').includes('No sharing data available'), false)

    rerender(view(false))

    const reopened = screen.getByRole('dialog', { name: 'Whitelabel Wallet' })
    assert.ok((reopened.textContent ?? '').includes('No sharing data available'))
  })

  test('View Credit Details closes the popover and calls onViewDetails once', async () => {
    const onViewDetails = vi.fn()
    render(
      <WhitelabelWalletView state={makeState()} compact={false} formatAmount={formatAmount} onViewDetails={onViewDetails} />,
    )
    await openWallet()

    fireEvent.click(screen.getByRole('button', { name: 'View Credit Details' }))

    assert.equal(onViewDetails.mock.calls.length, 1)
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.equal(
      screen.getByRole('button', { name: /^Whitelabel wallet, / }).getAttribute('aria-expanded'),
      'false',
    )
  })

  test('near the limit shows the Warning pill and the usage alert', async () => {
    render(
      <WhitelabelWalletView
        state={makeState({ credit: warningCredit })}
        compact={false}
        formatAmount={formatAmount}
        onViewDetails={() => {}}
      />,
    )
    assert.ok(screen.getByRole('button', { name: 'Whitelabel wallet, X1500.00 available' }))

    const dialog = await openWallet()
    const text = dialog.textContent ?? ''
    assert.ok(text.includes('Warning'))
    assert.ok(text.includes('85% of limit reached'))
    assert.equal(text.includes('Healthy'), false)
  })
})
