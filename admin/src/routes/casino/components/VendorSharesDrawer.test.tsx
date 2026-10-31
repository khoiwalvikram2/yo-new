/**
 * The Manage Vendor Shares drawer against a mocked GraphQL server: the share and analytics queries and their
 * variables, the summary figures, the per-vendor fields with the projected share, the unsaved and over-100%
 * notices, Reset, the save (one upsert per vendor, the refetch and the single toast that follows it), a failed
 * save, Cancel, and the empty and closed states.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import type { ProviderWithVendors } from '@/modules/casino/types'
import { istDayStart, istToday } from '@/ui/components/istDate'
import { VendorSharesDrawer } from './VendorSharesDrawer'

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
}

const feedback = vi.hoisted(() => ({ toast: vi.fn(), dismiss: vi.fn() }))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `INR ${Number(amount).toFixed(2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount,
  }),
}))

vi.mock('@/ui/components/toast', () => ({
  toast: Object.assign((options: unknown) => feedback.toast(options), {
    dismiss: (id: unknown) => feedback.dismiss(id),
  }),
}))

const PROVIDER: ProviderWithVendors = {
  id: 'p1',
  key: 'qtech',
  name: 'QTech',
  status: 'ACTIVE',
  vendors: [
    { id: 'v1', name: 'Evolution', slug: 'evolution' },
    { id: 'v2', name: 'Ezugi', slug: 'ezugi' },
    { id: 'v3', name: 'Gamma', slug: 'gamma' },
  ],
}

let server: { calls: ServerCall[]; shares: Record<string, number>; upsertError: string | null }

function handle(operation: Operation): FetchResult {
  const variables = operation.variables as Record<string, unknown>
  switch (operation.operationName) {
    case 'ProviderVendorShares':
      return {
        data: {
          providerVendorShares: Object.entries(server.shares).map(([vendorId, sharePercentage]) => ({
            __typename: 'ProviderVendorShare',
            vendorId,
            vendorName: vendorId,
            sharePercentage,
            updatedAt: '2026-10-01T00:00:00Z',
          })),
        },
      }
    case 'ProviderAnalytics':
      return {
        data: {
          providerAnalytics: {
            __typename: 'ProviderAnalytics',
            providerId: variables.providerId,
            totalGGR: 1000,
            vendorBreakdown: [
              { __typename: 'VendorBreakdown', vendorId: 'v1', vendorName: 'Evolution', ggr: 1000, shareAmount: 100, transactionCount: 8 },
            ],
          },
        },
      }
    case 'UpsertProviderVendorShare':
      if (server.upsertError) return { errors: [{ message: server.upsertError }] }
      server.shares = { ...server.shares, [String(variables.vendorId)]: Number(variables.sharePercentage) }
      return {
        data: {
          upsertProviderVendorShare: {
            __typename: 'ProviderVendorShare',
            vendorId: variables.vendorId,
            sharePercentage: variables.sharePercentage,
            updatedAt: '2026-10-07T00:00:00Z',
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

function calls(operationName: string) {
  return server.calls.filter((call) => call.operationName === operationName)
}

function renderDrawer(props: { open?: boolean; provider?: ProviderWithVendors | null } = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const view = render(
    <MockedProvider link={serverLink()}>
      <VendorSharesDrawer
        open={props.open ?? true}
        onClose={onClose}
        provider={props.provider === undefined ? PROVIDER : props.provider}
        onSaved={onSaved}
      />
    </MockedProvider>,
  )
  return { ...view, onClose, onSaved }
}

function field(vendor: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: `Share Percentage for ${vendor}` }) as HTMLInputElement
}

function summaryValue(term: string): string {
  const dt = screen.getByText(term, { selector: 'dt' })
  return dt.nextElementSibling?.textContent ?? ''
}

async function renderLoaded() {
  const view = renderDrawer()
  await screen.findByRole('dialog', { name: 'Manage Vendor Shares' })
  await waitFor(() => assert.equal(field('Evolution').value, '10'))
  await waitFor(() => assert.equal(screen.queryByText('Loading vendor shares…'), null))
  return view
}

beforeEach(() => {
  feedback.toast.mockReset()
  feedback.toast.mockReturnValue(7)
  feedback.dismiss.mockReset()
  server = { calls: [], shares: { v1: 10 }, upsertError: null }
})

describe('VendorSharesDrawer', () => {
  test('loads the provider\'s shares and today\'s analytics, and lays out the summary and the vendors', async () => {
    await renderLoaded()

    assert.deepEqual(calls('ProviderVendorShares')[0].variables, { providerId: 'p1' })
    const analytics = calls('ProviderAnalytics')[0].variables
    assert.equal(analytics.providerId, 'p1')
    assert.equal(analytics.start, istDayStart(istToday()))

    assert.ok(screen.getByRole('heading', { level: 3, name: 'Vendor Share Summary' }))
    assert.ok(screen.getByText('Total vendors, share percentage, and configuration status'))
    assert.equal(summaryValue('Vendors'), '3')
    assert.equal(summaryValue('Total Share'), '10.0%')
    assert.equal(summaryValue('Configured'), '1/3')
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Vendor Share Configuration' }))

    assert.equal(field('Ezugi').value, '0')
    assert.equal(field('Gamma').value, '0')
    const evolution = field('Evolution').closest('li') as HTMLElement
    assert.ok(within(evolution).getByText('Share Percentage'))
    assert.ok(within(evolution).getByText(/Commission rate for this vendor/))
    assert.deepEqual(
      [...evolution.querySelectorAll('dd')].map((dd) => dd.textContent),
      ['INR 1000.00', 'INR 100.00', '8'],
    )
    // the bar shows only for a vendor with a share
    assert.equal(evolution.querySelectorAll('[class*="_track_"]').length, 1)
    assert.equal((field('Ezugi').closest('li') as HTMLElement).querySelectorAll('[class*="_track_"]').length, 0)

    assert.ok(screen.getByText('Configure vendor revenue share percentages for this provider'))
    assert.equal((screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled, true)
    assert.equal(screen.queryByText('You have unsaved changes'), null)
  })

  test('edits update the totals and the notices; Reset returns to the saved shares', async () => {
    await renderLoaded()

    fireEvent.change(field('Ezugi'), { target: { value: '25' } })
    assert.equal(summaryValue('Total Share'), '35.0%')
    assert.equal(summaryValue('Configured'), '2/3')
    assert.ok(screen.getByText('You have unsaved changes'))
    assert.ok(screen.getByText("Click 'Save Changes' to apply your modifications."))
    assert.equal((screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled, false)

    fireEvent.change(field('Gamma'), { target: { value: '80' } })
    assert.equal(summaryValue('Total Share'), '115.0%')
    assert.ok(screen.getByText('Total share exceeds 100%'))
    assert.ok(screen.getByText("Your vendor shares total more than 100%. This is allowed but please verify it's intentional."))

    // a cleared field counts as 0, as the legacy `Number(val || 0)` did
    fireEvent.change(field('Gamma'), { target: { value: '' } })
    assert.equal(summaryValue('Total Share'), '35.0%')
    assert.equal(screen.queryByText('Total share exceeds 100%'), null)

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.equal(field('Ezugi').value, '0')
    assert.equal(summaryValue('Total Share'), '10.0%')
    assert.equal(screen.queryByText('You have unsaved changes'), null)
  })

  test('Save upserts every vendor, refetches, replaces the busy toast with the outcome and closes', async () => {
    const { onClose, onSaved } = await renderLoaded()
    const sharesBefore = calls('ProviderVendorShares').length

    fireEvent.change(field('Ezugi'), { target: { value: '12.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    assert.deepEqual(feedback.toast.mock.calls[0][0], { message: 'Saving vendor shares...', busy: true })

    await waitFor(() => assert.equal(onClose.mock.calls.length, 1))
    assert.deepEqual(
      calls('UpsertProviderVendorShare').map((call) => call.variables),
      [
        { providerId: 'p1', vendorId: 'v1', sharePercentage: 10 },
        { providerId: 'p1', vendorId: 'v2', sharePercentage: 12.5 },
        { providerId: 'p1', vendorId: 'v3', sharePercentage: 0 },
      ],
    )
    assert.ok(calls('ProviderVendorShares').length > sharesBefore)
    assert.deepEqual(feedback.dismiss.mock.calls, [[7]])
    assert.deepEqual(feedback.toast.mock.calls[1][0], { message: 'Vendor shares saved', tone: 'ok', duration: 1200 })
    assert.equal(onSaved.mock.calls.length, 1)
  })

  test('a failed save keeps the drawer open and says so', async () => {
    const { onClose } = await renderLoaded()
    server.upsertError = 'Share out of range'

    fireEvent.change(field('Gamma'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 2))
    assert.deepEqual(feedback.dismiss.mock.calls, [[7]])
    assert.deepEqual(feedback.toast.mock.calls[1][0], { message: 'Failed to save vendor shares', tone: 'error', duration: 2500 })
    assert.equal(onClose.mock.calls.length, 0)
    assert.ok(screen.getByRole('dialog', { name: 'Manage Vendor Shares' }))
  })

  test('Cancel and the close button ask the page to close', async () => {
    const { onClose } = await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    assert.equal(onClose.mock.calls.length, 2)
  })

  test('a provider without vendors says so', async () => {
    renderDrawer({ provider: { ...PROVIDER, vendors: [] } })
    assert.ok(await screen.findByText('No vendors found for this provider'))
    assert.equal(summaryValue('Vendors'), '0')
    assert.equal(summaryValue('Configured'), '0/0')
  })

  test('closed, nothing renders but the provider\'s queries still run (legacy); without a provider none run', async () => {
    renderDrawer({ open: false })
    await waitFor(() => assert.equal(calls('ProviderVendorShares').length, 1))
    assert.equal(screen.queryByRole('dialog'), null)

    server.calls = []
    renderDrawer({ open: true, provider: null })
    assert.ok(screen.getAllByRole('dialog', { name: 'Manage Vendor Shares' }).length > 0)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(server.calls.length, 0)
    assert.equal(screen.queryByText('Vendor Share Summary'), null)
  })
})
