/**
 * The analytics drawer against a mocked GraphQL server: the provider and vendor queries with the IST range
 * they send, the Today / 7D / 30D presets and a custom range through the kit range field (and Reset), the
 * provider and vendor figures with the legacy badges, the vendor breakdown, the empty and loading states, the
 * titles, and the range surviving a close and reopen.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { istDayEnd, istDayStart, istToday } from '@/ui/components/istDate'
import { addDays, formatRangeDay, type AnalyticsMode } from '../providersPageModel'
import { AnalyticsDrawer } from './AnalyticsDrawer'

// A Stat delta reads "Up 12.5%" across the arrow's hidden direction word and the visible figure, so the
// innermost element with that whole text is the delta chip.
const deltaText = (text: string) => (_: string, element: Element | null) =>
  !!element && element.textContent === text && ![...element.children].some((child) => child.textContent === text)

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
}

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `INR ${Number(amount).toFixed(2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount,
  }),
}))

let server: {
  calls: ServerCall[]
  breakdown: Array<Record<string, unknown>>
  vendor: { ggr: number; shareAmount: number; transactionCount: number }
}

function handle(operation: Operation): FetchResult {
  const variables = operation.variables as Record<string, unknown>
  switch (operation.operationName) {
    case 'ProviderAnalytics':
      return {
        data: {
          providerAnalytics: {
            __typename: 'ProviderAnalytics',
            providerId: variables.providerId,
            totalGGR: 1500,
            vendorBreakdown: server.breakdown.map((v) => ({ __typename: 'VendorBreakdown', ...v })),
          },
        },
      }
    case 'VendorAnalytics':
      return {
        data: {
          vendorAnalytics: {
            __typename: 'VendorAnalytics',
            vendorId: variables.vendorId,
            vendorName: 'Evolution',
            ...server.vendor,
          },
        },
      }
    default:
      throw new Error(`unexpected operation ${operation.operationName}`)
  }
}

function serverLink() {
  return new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
    server.calls.push({ operationName: operation.operationName, variables: { ...operation.variables } })
    Promise.resolve()
      .then(() => handle(operation))
      .then(
        (result) => {
          observer.next(result)
          observer.complete()
        },
        (error: unknown) => observer.error(error),
      )
  }))
}

function lastSent(operationName: string) {
  return server.calls.filter((call) => call.operationName === operationName).at(-1)?.variables
}

const PROVIDER_MODE: AnalyticsMode = { type: 'provider', providerId: 'p1', title: 'Analytics • QTech' }
const VENDOR_MODE: AnalyticsMode = { type: 'vendor', providerId: 'p1', vendorId: 'v1', title: 'Analytics • Evolution' }

function drawer(mode: AnalyticsMode | null, open = true, onClose = vi.fn()) {
  return <AnalyticsDrawer open={open} onClose={onClose} mode={mode} />
}

function renderDrawer(mode: AnalyticsMode | null, onClose = vi.fn()) {
  const link = serverLink()
  const view = render(<MockedProvider link={link}>{drawer(mode, true, onClose)}</MockedProvider>)
  return {
    ...view,
    reopen: (open: boolean) => view.rerender(<MockedProvider link={link}>{drawer(mode, open, onClose)}</MockedProvider>),
  }
}

const today = () => istToday()

function rangeTrigger(): HTMLElement {
  return screen.getByRole('button', { name: /^Date Range: / })
}

/** The figure rows: label, sub and value as their text. */
function figureRows(): string[] {
  const dialog = screen.getByRole('dialog')
  const list = dialog.querySelector('ul')
  assert.ok(list)
  return [...list.querySelectorAll('li')].map((li) => li.textContent ?? '')
}

beforeEach(() => {
  server = {
    calls: [],
    breakdown: [
      { vendorId: 'v1', vendorName: 'Evolution', ggr: 1000, shareAmount: 100, transactionCount: 8 },
      { vendorId: 'v2', vendorName: 'Ezugi', ggr: 500, shareAmount: 50, transactionCount: 4 },
    ],
    vendor: { ggr: 1000, shareAmount: 100, transactionCount: 8 },
  }
})

describe('AnalyticsDrawer', () => {
  test('without a mode it asks for a provider or vendor and queries nothing', async () => {
    const onClose = vi.fn()
    renderDrawer(null, onClose)

    assert.ok(screen.getByRole('dialog', { name: 'Provider Analytics' }))
    assert.ok(screen.getByText('Select a provider or vendor to view analytics'))
    assert.equal(rangeTrigger().textContent, `Today · ${formatRangeDay(today())}`)
    assert.ok(screen.getByText('View real-time performance metrics and analytics'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(server.calls.length, 0)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    assert.equal(onClose.mock.calls.length, 1)
  })

  test('a provider: today in IST, the headline figures with the legacy badges, and the vendor breakdown', async () => {
    renderDrawer(PROVIDER_MODE)

    assert.ok(screen.getByRole('dialog', { name: 'Analytics • QTech' }))
    assert.ok(screen.getByText('Loading analytics...'))
    await screen.findByText('Total GGR')
    assert.deepEqual(lastSent('ProviderAnalytics'), {
      providerId: 'p1',
      start: istDayStart(today()),
      end: istDayEnd(today()),
    })

    const dialog = screen.getByRole('dialog')
    for (const text of ['INR 1500.00', 'Up 12.5%', 'Gross Gaming Revenue', 'Total Share Amount', 'INR 150.00', 'Up 8.3%', 'Your commission']) {
      assert.ok(within(dialog).getByText(/^(Up|Down|No change) /.test(text) ? deltaText(text) : text), text)
    }
    assert.deepEqual(figureRows(), [
      'Active Vendorsof 2 total2',
      'Transactionstoday12',
      'Avg/Vendorper vendorINR 750.00',
    ])

    assert.ok(screen.getByRole('heading', { level: 3, name: 'Vendor Performance Breakdown' }))
    const evolution = screen.getByText('Evolution').closest('li') as HTMLElement
    assert.ok(within(evolution).getByText('8 transactions'))
    assert.ok(within(evolution).getByText('Up'))
    assert.ok(within(evolution).getByText('Contribution'))
    assert.ok(within(evolution).getByText('66.7%'))
    assert.deepEqual([...evolution.querySelectorAll('dd')].map((dd) => dd.textContent), ['INR 1000.00', 'INR 100.00'])
  })

  test('the presets and a custom range change the instants sent; Reset returns to today', async () => {
    renderDrawer(PROVIDER_MODE)
    await screen.findByText('Total GGR')

    fireEvent.click(rangeTrigger())
    fireEvent.click(await screen.findByRole('button', { name: '7D' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      assert.deepEqual(lastSent('ProviderAnalytics'), {
        providerId: 'p1',
        start: istDayStart(addDays(today(), -6)),
        end: istDayEnd(today()),
      }),
    )
    assert.equal(
      rangeTrigger().textContent,
      `7D · ${formatRangeDay(addDays(today(), -6))} – ${formatRangeDay(today())}`,
    )

    fireEvent.click(rangeTrigger())
    fireEvent.click(await screen.findByRole('button', { name: '30D' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.equal(lastSent('ProviderAnalytics')?.start, istDayStart(addDays(today(), -29))))

    fireEvent.click(rangeTrigger())
    fireEvent.click(await screen.findByRole('button', { name: 'Custom range' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      assert.deepEqual(lastSent('ProviderAnalytics'), {
        providerId: 'p1',
        start: '2026-08-31T18:30:00.000Z',
        end: '2026-09-15T18:29:59.999Z',
      }),
    )
    assert.equal(rangeTrigger().textContent, 'Sep 01, 2026 – Sep 15, 2026')

    fireEvent.click(rangeTrigger())
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }))
    await waitFor(() => assert.equal(rangeTrigger().textContent, `Today · ${formatRangeDay(today())}`))
  })

  test('the range survives closing and reopening the drawer', async () => {
    const view = renderDrawer(PROVIDER_MODE)
    await screen.findByText('Total GGR')
    fireEvent.click(rangeTrigger())
    fireEvent.click(await screen.findByRole('button', { name: '7D' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.ok(rangeTrigger().textContent?.startsWith('7D · ')))

    view.reopen(false)
    assert.equal(screen.queryByRole('dialog'), null)
    view.reopen(true)
    await screen.findByRole('dialog', { name: 'Analytics • QTech' })
    assert.ok(rangeTrigger().textContent?.startsWith('7D · '))
  })

  test('a provider with no vendor data says so', async () => {
    server.breakdown = []
    renderDrawer(PROVIDER_MODE)
    assert.ok(await screen.findByText('No vendor data available'))
    assert.deepEqual(figureRows(), [
      'Active Vendorsof 0 total0',
      'Transactionstoday0',
      'Avg/Vendorper vendorINR 0.00',
    ])
  })

  test('a vendor: its query, the figures with the legacy badges, and the tracking note', async () => {
    renderDrawer(VENDOR_MODE)
    assert.ok(screen.getByRole('dialog', { name: 'Analytics • Evolution' }))
    await screen.findByText('Your Share')
    assert.deepEqual(lastSent('VendorAnalytics'), {
      providerId: 'p1',
      vendorId: 'v1',
      start: istDayStart(today()),
      end: istDayEnd(today()),
    })
    const dialog = screen.getByRole('dialog')
    for (const text of ['GGR', 'INR 1000.00', 'Up 15.2%', 'INR 100.00', 'Up 10.8%', 'Commission amount']) {
      assert.ok(within(dialog).getByText(/^(Up|Down|No change) /.test(text) ? deltaText(text) : text), text)
    }
    assert.deepEqual(figureRows(), [
      'Transactionstoday8',
      'Avg Betper transactionINR 125.00',
      'Playersdistinct players not tracked—',
    ])
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Performance Details' }))
    assert.ok(screen.getByText('Win rate, retention and uptime require additional tracking; show when available.'))
  })

  test('a vendor with nothing today keeps the legacy fixed badges and shows 0 players', async () => {
    server.vendor = { ggr: 0, shareAmount: 0, transactionCount: 0 }
    renderDrawer({ type: 'vendor', providerId: 'p1', vendorId: 'v1' })
    assert.ok(screen.getByRole('dialog', { name: 'Vendor Analytics' }))
    await screen.findByText('Your Share')
    const dialog = screen.getByRole('dialog')
    assert.ok(within(dialog).getByText(deltaText('Down 15.2%')))
    assert.ok(within(dialog).getByText(deltaText('No change 10.8%')))
    assert.deepEqual(figureRows(), [
      'Transactionstoday0',
      'Avg Betper transactionINR 0.00',
      'Playersdistinct players not tracked0',
    ])
  })
})
