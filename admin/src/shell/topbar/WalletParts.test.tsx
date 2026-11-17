/**
 * The wallet parts are shared by all four topbar wallets, so a defect here reaches every Whitelabel Admin and
 * agent. What is tested matters to users:
 * - below 1024px the trigger is compact (decision 2): icon only, but its accessible name still carries the
 *   amount, because nothing else announces it;
 * - the trigger works as a kit Popover trigger (forwardRef + ...rest), or the wallet cannot open;
 * - the tabs are real tabs (decision 4): arrow keys move selection and focus, and the body is the tabpanel
 *   named by the selected tab;
 * - the bodies show the figures with their currency arguments: none for the whitelabel credit pool, the
 *   payload currency for sharing, the account currency for a CREDIT agent's chips.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { createRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Popover } from '@/ui/components/Popover'
import {
  ChipBody,
  CreditBody,
  SharingBody,
  WalletPanel,
  WalletTabs,
  WalletTrigger,
  WalletTriggerLoading,
} from './WalletParts'
import type { WalletTab } from './WalletParts'
import type { ChipWalletFigures, CreditFigures, SharingSummary } from './walletData'
import type { FormatAmount } from './formatAmount'
import s from './WalletIndicator.module.css'

const formatAmount: FormatAmount = (n, c) => `${c ?? 'X'}${n.toFixed(2)}`

const healthy: CreditFigures = {
  creditAvailable: 7500,
  creditLimit: 10000,
  creditUsed: 2500,
  usagePercentage: 25,
  isNearLimit: false,
  isCritical: false,
  status: 'healthy',
}

function TabsHarness({
  tabs,
  initial,
  onChange,
}: {
  tabs: readonly WalletTab[]
  initial: WalletTab
  onChange: (tab: WalletTab) => void
}) {
  const [value, setValue] = useState<WalletTab>(initial)
  return (
    <WalletTabs
      tabs={tabs}
      value={value}
      idPrefix="w"
      onChange={(tab) => {
        setValue(tab)
        onChange(tab)
      }}
    />
  )
}

describe('WalletTrigger', () => {
  test('full trigger: named by its label, shows the amount and the chevron', () => {
    render(
      <WalletTrigger
        label="Credit wallet, X7500.00 available"
        amountText="X7500.00"
        compact={false}
        tone="healthy"
        showDot={false}
      />,
    )
    const button = screen.getByRole('button', { name: 'Credit wallet, X7500.00 available' })
    assert.equal(button.getAttribute('type'), 'button')
    assert.ok(button.textContent?.includes('X7500.00'))
    assert.equal(button.querySelectorAll('svg').length, 2, 'wallet icon and chevron')
  })

  test('compact trigger keeps the label but renders no amount and no chevron', () => {
    render(
      <WalletTrigger
        label="Credit wallet, X7500.00 available"
        amountText="X7500.00"
        compact
        tone="healthy"
        showDot={false}
      />,
    )
    const button = screen.getByRole('button', { name: 'Credit wallet, X7500.00 available' })
    assert.equal(button.textContent?.includes('X7500.00'), false)
    assert.equal(screen.queryByText('X7500.00'), null)
    assert.equal(button.querySelectorAll('svg').length, 1, 'wallet icon only')
  })

  test('showDot adds the warning dot inside the hidden icon wrapper', () => {
    const { rerender } = render(
      <WalletTrigger label="Wallet" amountText="X1.00" compact tone="warning" showDot={false} />,
    )
    const iconWrapper = () => screen.getByRole('button', { name: 'Wallet' }).querySelector('span[aria-hidden="true"]')
    assert.equal(iconWrapper()?.children.length, 1)

    rerender(<WalletTrigger label="Wallet" amountText="X1.00" compact tone="warning" showDot />)
    assert.equal(iconWrapper()?.children.length, 2)
  })

  test('forwards its ref to the button', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<WalletTrigger ref={ref} label="Wallet" amountText="X1.00" compact={false} tone={null} showDot={false} />)
    assert.equal(ref.current, screen.getByRole('button', { name: 'Wallet' }))
  })

  test('works as a kit Popover trigger: a click opens the dialog named by the panel title', async () => {
    render(
      <Popover
        labelledBy="wallet-title"
        trigger={
          <WalletTrigger label="Credit wallet, X7500.00 available" amountText="X7500.00" compact={false} tone="healthy" showDot={false} />
        }
      >
        <span id="wallet-title">Credit Wallet</span>
      </Popover>,
    )
    const trigger = screen.getByRole('button', { name: 'Credit wallet, X7500.00 available' })
    assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog')

    fireEvent.click(trigger)

    assert.ok(await screen.findByRole('dialog', { name: 'Credit Wallet' }))
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  })

  test('WalletTriggerLoading renders a named loading spinner', () => {
    render(<WalletTriggerLoading />)
    assert.ok(screen.getByRole('img', { name: 'Loading' }))
  })
})

describe('WalletTabs', () => {
  test('renders a tablist with ids, aria-controls and a roving tabIndex', () => {
    render(<TabsHarness tabs={['credit', 'chips', 'sharing']} initial="credit" onChange={() => {}} />)
    assert.ok(screen.getByRole('tablist'))
    const tabs = screen.getAllByRole('tab')
    assert.deepEqual(
      tabs.map((tab) => tab.textContent),
      ['Credit', 'Chips', 'Sharing'],
    )
    assert.deepEqual(
      tabs.map((tab) => tab.id),
      ['w-tab-credit', 'w-tab-chips', 'w-tab-sharing'],
    )
    for (const tab of tabs) {
      assert.equal(tab.getAttribute('aria-controls'), 'w-panel')
      assert.equal(tab.getAttribute('type'), 'button')
    }
    assert.deepEqual(
      tabs.map((tab) => tab.getAttribute('aria-selected')),
      ['true', 'false', 'false'],
    )
    assert.deepEqual(
      tabs.map((tab) => tab.getAttribute('tabindex')),
      ['0', '-1', '-1'],
    )
  })

  test('a click selects the tab and calls onChange', () => {
    const onChange = vi.fn()
    render(<TabsHarness tabs={['credit', 'sharing']} initial="credit" onChange={onChange} />)
    assert.equal(screen.getAllByRole('tab').length, 2)

    fireEvent.click(screen.getByRole('tab', { name: 'Sharing' }))

    assert.deepEqual(onChange.mock.calls, [['sharing']])
    assert.equal(screen.getByRole('tab', { name: 'Sharing' }).getAttribute('aria-selected'), 'true')
    assert.equal(screen.getByRole('tab', { name: 'Sharing' }).getAttribute('tabindex'), '0')
    assert.equal(screen.getByRole('tab', { name: 'Credit' }).getAttribute('aria-selected'), 'false')
    assert.equal(screen.getByRole('tab', { name: 'Credit' }).getAttribute('tabindex'), '-1')
  })

  test('ArrowRight and ArrowLeft move selection and focus, wrapping at both ends', () => {
    const onChange = vi.fn()
    render(<TabsHarness tabs={['credit', 'chips', 'sharing']} initial="credit" onChange={onChange} />)
    const tab = (name: string) => screen.getByRole('tab', { name })

    act(() => {
      tab('Credit').focus()
    })
    fireEvent.keyDown(tab('Credit'), { key: 'ArrowRight' })
    assert.equal(tab('Chips').getAttribute('aria-selected'), 'true')
    assert.equal(document.activeElement, tab('Chips'))

    fireEvent.keyDown(tab('Chips'), { key: 'ArrowRight' })
    assert.equal(tab('Sharing').getAttribute('aria-selected'), 'true')
    assert.equal(document.activeElement, tab('Sharing'))

    fireEvent.keyDown(tab('Sharing'), { key: 'ArrowRight' })
    assert.equal(tab('Credit').getAttribute('aria-selected'), 'true')
    assert.equal(document.activeElement, tab('Credit'))

    fireEvent.keyDown(tab('Credit'), { key: 'ArrowLeft' })
    assert.equal(tab('Sharing').getAttribute('aria-selected'), 'true')
    assert.equal(document.activeElement, tab('Sharing'))

    assert.deepEqual(onChange.mock.calls, [['chips'], ['sharing'], ['credit'], ['sharing']])
  })

  test('other keys do not change the selection', () => {
    const onChange = vi.fn()
    render(<TabsHarness tabs={['credit', 'chips', 'sharing']} initial="sharing" onChange={onChange} />)
    const sharing = screen.getByRole('tab', { name: 'Sharing' })

    fireEvent.keyDown(sharing, { key: 'Home' })
    fireEvent.keyDown(sharing, { key: 'ArrowDown' })

    assert.equal(onChange.mock.calls.length, 0)
    assert.equal(sharing.getAttribute('aria-selected'), 'true')
  })
})

describe('WalletPanel', () => {
  test('head shows the titled heading, subtitle and status pill; the footer action runs its handler', () => {
    const onClick = vi.fn()
    render(
      <WalletPanel
        titleId="wallet-title"
        title="Credit Wallet"
        subtitle="Credit & Sharing"
        tone="warning"
        statusLabel="Warning"
        footer={{ label: 'View Credit Details', onClick }}
      >
        <p>Body content</p>
      </WalletPanel>,
    )
    const title = screen.getByText('Credit Wallet')
    assert.equal(title.id, 'wallet-title')
    assert.ok(screen.getByText('Credit & Sharing'))
    assert.ok(screen.getByText('Warning'))
    assert.ok(screen.getByText('Body content'))
    assert.equal(screen.queryByRole('tabpanel'), null)

    fireEvent.click(screen.getByRole('button', { name: 'View Credit Details' }))
    assert.equal(onClick.mock.calls.length, 1)
  })

  test('renders no status pill and no footer when both are null', () => {
    render(
      <WalletPanel titleId="t" title="Sharing Wallet" subtitle="Agent Sharing" tone={null} statusLabel={null} footer={null}>
        <p>Body content</p>
      </WalletPanel>,
    )
    assert.ok(screen.getByText('Sharing Wallet'))
    assert.equal(screen.queryByText('Healthy'), null)
    assert.equal(screen.queryByText('Warning'), null)
    assert.equal(screen.queryByText('Critical'), null)
    assert.equal(screen.queryByRole('button'), null)
  })

  test('with tabs, the body is the tabpanel named by the selected tab', () => {
    render(
      <WalletPanel
        titleId="t"
        title="Credit Wallet"
        subtitle="Credit & Sharing"
        tone="healthy"
        statusLabel="Healthy"
        tabs={<WalletTabs tabs={['credit', 'chips', 'sharing']} value="credit" idPrefix="w" onChange={() => {}} />}
        tabPanelId="w-panel"
        tabLabelledBy="w-tab-credit"
        footer={null}
      >
        <p>Credit content</p>
      </WalletPanel>,
    )
    const panel = screen.getByRole('tabpanel', { name: 'Credit' })
    assert.equal(panel.id, 'w-panel')
    assert.equal(panel.getAttribute('aria-labelledby'), 'w-tab-credit')
    assert.equal(panel.getAttribute('tabindex'), '0')
    assert.ok(panel.textContent?.includes('Credit content'))
    assert.equal(screen.getByRole('tab', { name: 'Credit' }).getAttribute('aria-controls'), panel.id)
  })

  test('without tabs, tabPanelId and tabLabelledBy are not applied', () => {
    render(
      <WalletPanel
        titleId="t"
        title="Commission Wallet"
        subtitle="Agent Commission"
        tone={null}
        statusLabel={null}
        tabPanelId="w-panel"
        tabLabelledBy="w-tab-credit"
        footer={null}
      >
        <p>Commission content</p>
      </WalletPanel>,
    )
    assert.equal(screen.queryByRole('tabpanel'), null)
    assert.equal(document.getElementById('w-panel'), null)
    const body = screen.getByText('Commission content').parentElement
    assert.equal(body?.getAttribute('tabindex'), null)
  })
})

describe('CreditBody', () => {
  test('healthy: available credit, usage meter and limit/used with no currency argument and no alert', () => {
    render(<CreditBody credit={healthy} formatAmount={formatAmount} />)
    assert.ok(screen.getByText('Available Credit'))
    assert.ok(screen.getByText('X7500.00'))
    assert.ok(screen.getByText('Usage'))
    assert.ok(screen.getByText('25.0%'))
    const bar = screen.getByRole('progressbar', { name: 'Credit usage' })
    assert.equal(bar.getAttribute('aria-valuemin'), '0')
    assert.equal(bar.getAttribute('aria-valuemax'), '100')
    assert.equal(bar.getAttribute('aria-valuenow'), '25')
    assert.ok(screen.getByText('Limit'))
    assert.ok(screen.getByText('X10000.00'))
    assert.ok(screen.getByText('Used'))
    assert.ok(screen.getByText('X2500.00'))
    assert.equal(screen.queryByText(/of limit reached/), null)
    assert.equal(screen.queryByText('Credit limit nearly exhausted'), null)
  })

  test('warning: shows the rounded percentage alert', () => {
    render(
      <CreditBody
        credit={{ ...healthy, creditAvailable: 1760, creditUsed: 8240, usagePercentage: 82.4, isNearLimit: true, status: 'warning' }}
        formatAmount={formatAmount}
      />,
    )
    assert.ok(screen.getByText('82.4%'))
    assert.ok(screen.getByText('82% of limit reached'))
  })

  test('critical: shows the exhausted alert and caps the meter at 100', () => {
    render(
      <CreditBody
        credit={{ ...healthy, creditAvailable: -2000, creditUsed: 12000, usagePercentage: 120, isNearLimit: true, isCritical: true, status: 'critical' }}
        formatAmount={formatAmount}
      />,
    )
    assert.ok(screen.getByText('X-2000.00'))
    assert.ok(screen.getByText('120.0%'))
    assert.equal(screen.getByRole('progressbar', { name: 'Credit usage' }).getAttribute('aria-valuenow'), '100')
    assert.ok(screen.getByText('Credit limit nearly exhausted'))
    assert.equal(screen.queryByText(/of limit reached/), null)
  })
})

describe('SharingBody', () => {
  const sharing: SharingSummary = {
    currency: 'INR',
    currentPeriodTotal: 1234.5,
    rows: [
      { domain: 'sports', rate: 2.5, allTime: 1000, currentPeriod: 200 },
      { domain: 'casino', rate: 0, allTime: 50, currentPeriod: 0 },
    ],
  }

  test('shows the total and one row per domain in the payload currency, rate only when above zero', () => {
    render(<SharingBody sharing={sharing} loading={false} formatAmount={formatAmount} periodLabel="Period" capped />)
    assert.ok(screen.getByText('Current Period Total'))
    assert.ok(screen.getByText('INR1234.50'))
    assert.ok(screen.getByText('Sports'))
    assert.ok(screen.getByText('Casino'))
    assert.ok(screen.getByText('2.50%'))
    assert.equal(screen.queryByText('0.00%'), null)
    assert.equal(screen.getAllByText('All-Time').length, 2)
    assert.equal(screen.getAllByText('Period').length, 2)
    assert.ok(screen.getByText('INR1000.00'))
    assert.ok(screen.getByText('INR200.00'))
    assert.ok(screen.getByText('INR50.00'))
    assert.ok(screen.getByText('INR0.00'))
    assert.equal(screen.queryByText(/^X/), null, 'no amount is formatted without the currency')
  })

  test('uses the given period label', () => {
    render(<SharingBody sharing={sharing} loading={false} formatAmount={formatAmount} periodLabel="Current Period" capped={false} />)
    assert.equal(screen.getAllByText('Current Period').length, 2)
    assert.equal(screen.queryByText('Period'), null)
  })

  test('capped adds the scroll-cap class to the domain list, capped=false omits it', () => {
    const { container: cappedContainer } = render(
      <SharingBody sharing={sharing} loading={false} formatAmount={formatAmount} periodLabel="Period" capped />,
    )
    const cappedDomains = cappedContainer.getElementsByClassName(s.domains)[0]
    assert.ok(cappedDomains?.classList.contains(s.domainsCapped))

    const { container: uncappedContainer } = render(
      <SharingBody sharing={sharing} loading={false} formatAmount={formatAmount} periodLabel="Period" capped={false} />,
    )
    const uncappedDomains = uncappedContainer.getElementsByClassName(s.domains)[0]
    assert.equal(uncappedDomains?.classList.contains(s.domainsCapped), false)
  })

  test('hides the domain block when there are no rows', () => {
    render(
      <SharingBody sharing={{ ...sharing, rows: [] }} loading={false} formatAmount={formatAmount} periodLabel="Period" capped />,
    )
    assert.ok(screen.getByText('INR1234.50'))
    assert.equal(screen.queryByText('All-Time'), null)
  })

  test('no payload while loading shows a spinner, not the empty note', () => {
    render(<SharingBody sharing={null} loading formatAmount={formatAmount} periodLabel="Period" capped />)
    assert.ok(screen.getByRole('img', { name: 'Loading' }))
    assert.equal(screen.queryByText('No sharing data available'), null)
  })

  test('no payload and not loading shows the empty note', () => {
    render(<SharingBody sharing={null} loading={false} formatAmount={formatAmount} periodLabel="Period" capped />)
    assert.ok(screen.getByText('No sharing data available'))
    assert.equal(screen.queryByRole('img', { name: 'Loading' }), null)
  })
})

describe('ChipBody', () => {
  const chips: ChipWalletFigures = { currency: 'INR', balance: 95000, downlineBalance: 9700.004, creditReference: 100000, refPnl: 4700 }

  test('balance, downline balance and credit reference in the account currency, kept to 2 decimals', () => {
    render(<ChipBody chips={chips} formatAmount={formatAmount} />)
    assert.ok(screen.getByText('Balance'))
    assert.ok(screen.getByText('INR95000.00'))
    assert.ok(screen.getByText('Downline balance'))
    assert.ok(screen.getByText('INR9700.00'))
    assert.ok(screen.getByText('Credit reference'))
    assert.ok(screen.getByText('INR100000.00'))
    assert.equal(screen.queryByRole('progressbar'), null, 'no usage meter on chips')
    assert.equal(screen.queryByText(/^X/), null, 'every figure carries the account currency')
  })

  test('Ref P/L is signed and coloured as text, in words to the agent: green when the upline owes, rose when the agent owes', () => {
    const { rerender } = render(<ChipBody chips={chips} formatAmount={formatAmount} />)
    const owed = screen.getByText('+INR4700.00')
    assert.ok(owed.classList.contains(s.gain))
    assert.ok(screen.getByText('Upline owes you'))

    rerender(<ChipBody chips={{ ...chips, refPnl: -300.5 }} formatAmount={formatAmount} />)
    const owes = screen.getByText('−INR300.50')
    assert.ok(owes.classList.contains(s.loss))
    assert.ok(screen.getByText('You owe upline'))

    rerender(<ChipBody chips={{ ...chips, refPnl: 0 }} formatAmount={formatAmount} />)
    const even = screen.getByText('INR0.00')
    assert.equal(even.classList.contains(s.gain) || even.classList.contains(s.loss), false)
    assert.ok(screen.getByText('Nothing owed'))
  })
})
