import dayjs from 'dayjs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import CommissionHistoryPage from './CommissionHistoryPage'

interface MockAgent { id: string; schemeType: string }
interface Call { operationName: string; variables: Record<string, unknown> }

const auth = vi.hoisted(() => ({ agent: undefined as MockAgent | undefined }))
vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: MockAgent }) => unknown) => selector({ agent: auth.agent }),
}))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount,
    formatAmount: (amount: number) => `INR ${amount.toFixed(2)}`,
  }),
}))
vi.mock('@/shared/utils/date', () => ({
  nowIST: () => dayjs.tz('2026-10-07T12:00:00', 'Asia/Kolkata'),
}))

let calls: Call[]
let empty = false

const myRow = {
  __typename: 'CommissionPayout', id: 'my-1', agentId: 'agent-1', agent: null, amount: 12500,
  periodFrom: '2026-09-28T00:00:00.000Z', periodTo: '2026-10-05T00:00:00.000Z',
  notes: 'Weekly payout received', paidBy: 'admin-1', createdAt: '2026-10-05T10:00:00.000Z',
}
const downlineRow = {
  ...myRow, id: 'downline-1', agentId: 'sub-1', amount: 5000, notes: 'Paid to partner',
  agent: { __typename: 'Agent', id: 'sub-1', username: 'Partner One', schemeType: 'COMMISSION' },
}

function response(operation: Operation): FetchResult {
  calls.push({ operationName: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
  if (operation.operationName === 'MyCommissionSettlementHistory') {
    return { data: { myCommissionSettlementHistory: { __typename: 'CommissionHistoryPage', items: empty ? [] : [myRow], total: empty ? 0 : 120 } } }
  }
  if (operation.operationName === 'SubAgentCommissionSummaries') {
    return { data: { subAgentCommissionSummaries: [{ __typename: 'SubAgentCommissionSummary', agentId: 'sub-1', username: 'Partner One' }] } }
  }
  if (operation.operationName === 'DownlineCommissionSettlementHistory') {
    return { data: { downlineCommissionSettlementHistory: { __typename: 'CommissionHistoryPage', items: empty ? [] : [downlineRow], total: empty ? 0 : 1 } } }
  }
  if (operation.operationName === 'CommissionAdjustmentsPage') {
    return { data: { commissionAdjustmentsPage: { total: 1, items: [{
      __typename: 'CommissionAdjustment', id: 'adj-1', agentId: 'agent-1', amount: -25.5,
      sourceCycleFrom: '2026-09-27T18:30:00.000Z', sourceCycleTo: '2026-10-04T18:30:00.000Z', targetCycleFrom: null, targetCycleTo: null,
      reason: 'Void', status: 'PENDING', createdAt: '2026-10-06T05:00:00.000Z', appliedAt: null,
    }] } } }
  }
  throw new Error(`Unexpected operation ${operation.operationName}`)
}

function serverLink() {
  return new ApolloLink((operation) => new Observable((observer) => {
    queueMicrotask(() => {
      try {
        observer.next(response(operation))
        observer.complete()
      } catch (error) {
        observer.error(error)
      }
    })
  }))
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current location">{location.pathname}{location.search}</output>
}

function renderPage(entry = '/commission/history') {
  return render(
    <MockedProvider link={serverLink()} cache={undefined}>
      <MemoryRouter initialEntries={[entry]}>
        <PageEyebrowProvider value="Analytics">
          <Routes>
            <Route path="/commission/history" element={<><CommissionHistoryPage /><LocationProbe /></>} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

beforeEach(() => {
  auth.agent = { id: 'agent-1', schemeType: 'COMMISSION' }
  calls = []
  empty = false
})

describe('/commission/history', () => {
  test('loads my settlements with exact initial range and paging variables', async () => {
    renderPage()
    expect(await screen.findByText('Weekly payout received')).toBeTruthy()
    expect(screen.getByText('28 Sep – 05 Oct 2026 (IST)')).toBeTruthy()
    expect(calls.find((call) => call.operationName === 'MyCommissionSettlementHistory')?.variables).toEqual({
      limit: 50, offset: 0, fromDate: '2026-09-07', toDate: '2026-10-07',
    })
    expect(calls.some((call) => call.operationName === 'DownlineCommissionSettlementHistory')).toBe(false)
  })

  test('switches to the downline tab, URL and exact unfiltered query', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /Sub-agent Settlements/ }))
    expect(await screen.findByText('Paid to partner')).toBeTruthy()
    expect(screen.getByLabelText('Current location').textContent).toBe('/commission/history?tab=subAgent')
    expect(calls.find((call) => call.operationName === 'DownlineCommissionSettlementHistory')?.variables).toEqual({
      subAgentId: null, limit: 50, offset: 0, fromDate: '2026-09-07', toDate: '2026-10-07',
    })
    expect(calls.some((call) => call.operationName === 'SubAgentCommissionSummaries')).toBe(true)
  })

  test('hydrates a sub-agent URL and sends the selected ID', async () => {
    renderPage('/commission/history?subAgentId=sub-1')
    expect(await screen.findByText('Paid to partner')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Sub-agent Settlements/ }).getAttribute('aria-selected')).toBe('true')
    expect(calls.find((call) => call.operationName === 'DownlineCommissionSettlementHistory')?.variables.subAgentId).toBe('sub-1')
  })

  test('updates and clears the sub-agent filter in state and URL', async () => {
    renderPage('/commission/history?tab=subAgent')
    await screen.findByText('Paid to partner')
    const select = await screen.findByLabelText('Sub-agent')
    fireEvent.change(select, { target: { value: 'sub-1' } })
    await waitFor(() => expect(calls.some((call) => call.operationName === 'DownlineCommissionSettlementHistory' && call.variables.subAgentId === 'sub-1')).toBe(true))
    expect(screen.getByLabelText('Current location').textContent).toContain('subAgentId=sub-1')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(screen.getByLabelText('Current location').textContent).not.toContain('subAgentId'))
  })

  test('pages and changes page size through the kit pagination', async () => {
    renderPage()
    await screen.findByText('Weekly payout received')
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => expect(calls.some((call) => call.operationName === 'MyCommissionSettlementHistory' && call.variables.offset === 50)).toBe(true))
    // Scoped: the Adjustments card below has its own pagination.
    fireEvent.change(within(screen.getByRole('region', { name: 'My Settlements' })).getByLabelText('Rows per page:'), { target: { value: '20' } })
    await waitFor(() => expect(calls.some((call) => call.operationName === 'MyCommissionSettlementHistory' && call.variables.limit === 20 && call.variables.offset === 0)).toBe(true))
  })

  test('refreshes the active tab only', async () => {
    renderPage()
    await screen.findByText('Weekly payout received')
    const before = calls.filter((call) => call.operationName === 'MyCommissionSettlementHistory').length
    // Scoped: the Adjustments card has its own Refresh.
    fireEvent.click(within(screen.getByRole('search', { name: 'Commission history filters' })).getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(calls.filter((call) => call.operationName === 'MyCommissionSettlementHistory').length).toBeGreaterThan(before))
  })

  test('renders the truthful empty state', async () => {
    empty = true
    renderPage()
    expect(await screen.findByText('No settlements received for the selected period')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'My Settlements' })).queryByRole('navigation', { name: 'Pagination' })).toBeNull()
  })

  test('lists my adjustments read-only under My Settlements', async () => {
    renderPage()
    const section = await screen.findByRole('region', { name: 'Adjustments' })
    expect(await within(section).findByText('-INR 25.50')).toBeTruthy()
    expect(within(section).getByText('Pending')).toBeTruthy()
    expect(calls.find((call) => call.operationName === 'CommissionAdjustmentsPage')?.variables).toEqual({ agentId: 'agent-1', limit: 20, offset: 0 })
    expect(within(section).queryByRole('button', { name: 'New adjustment' })).toBeNull()
    expect(within(section).queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(within(section).queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  test('skips every history query outside the COMMISSION scheme', async () => {
    auth.agent = { id: 'agent-1', schemeType: 'CREDIT' }
    renderPage()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toHaveLength(0)
  })
})
