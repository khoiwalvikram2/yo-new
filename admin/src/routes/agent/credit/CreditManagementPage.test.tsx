import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import AgentCreditManagementPage from './CreditManagementPage'

interface MockAgent { id: string; schemeType: string }
interface Call { operationName: string; variables: Record<string, unknown> }

const auth = vi.hoisted(() => ({ agent: undefined as MockAgent | undefined }))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: MockAgent }) => unknown) => selector({ agent: auth.agent }),
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({ formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDateTime: (value: string) => `shown:${value}` }),
}))

let calls: Call[]
let historyRows = 1

const credit = {
  __typename: 'AgentCreditInfo',
  creditLimit: 100000,
  creditUsed: 25000,
  creditAvailable: 75000,
  creditAlertThreshold: 80,
  settlementBalance: 0,
  settlementBalanceSports: 0,
  settlementBalanceCasino: 0,
  settlementBalanceMatka: 0,
  usagePercentage: 25,
  isNearLimit: false,
}

function transaction(index: number) {
  return {
    __typename: 'CreditTransaction',
    id: `tx-${index}`,
    transactionType: index % 2 ? 'DEPOSIT' : 'WITHDRAW',
    amount: index % 2 ? 500 : -250,
    balanceBefore: 1000,
    balanceAfter: index % 2 ? 1500 : 750,
    reason: index === 1 ? 'Opening allocation' : null,
    createdBy: null,
    createdByType: null,
    createdAt: '2026-10-01T10:00:00.000Z',
  }
}

function response(operation: Operation): FetchResult {
  calls.push({
    operationName: operation.operationName,
    variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown>,
  })
  if (operation.operationName === 'MyAgentCredit') return { data: { myAgentCredit: credit } }
  if (operation.operationName === 'MyAgentCreditHistory') {
    const offset = Number(operation.variables.offset || 0)
    return { data: { myAgentCreditHistory: Array.from({ length: historyRows }, (_, index) => transaction(offset + index + 1)) } }
  }
  if (operation.operationName === 'MyAgentSettlements') {
    return {
      data: {
        myAgentSettlements: {
          __typename: 'MyAgentSettlements',
          totalAgentSettled: 1200,
          totalCreditTransactions: 500,
          agentSettlements: [{
            __typename: 'AgentSettlement',
            id: 'settlement-1',
            tenant: 'tenant-1',
            agentId: 'agent-1',
            settlementType: 'WEEKLY',
            amount: 1200,
            direction: 'TO_AGENT',
            previousBalance: 0,
            newBalance: 1200,
            notes: 'Weekly settlement',
            settledBy: null,
            createdAt: '2026-10-02T10:00:00.000Z',
          }],
          creditTransactions: [transaction(50)],
        },
      },
    }
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

function renderPage(initialEntries = ['/agent/credit']) {
  return render(
    <MockedProvider link={serverLink()} cache={undefined}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
        <PageEyebrowProvider value="Analytics">
          <Routes>
            <Route path="/agent/credit" element={<AgentCreditManagementPage />} />
            <Route path="/agent" element={<p>Agent overview</p>} />
            <Route path="/previous" element={<p>Previous page</p>} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

beforeEach(() => {
  auth.agent = { id: 'agent-1', schemeType: 'CREDIT' }
  calls = []
  historyRows = 1
})

describe('/agent/credit', () => {
  test('shows the unauthenticated state beneath a stable page header', () => {
    auth.agent = undefined
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Credit Management' })).toBeTruthy()
    expect(screen.getByText('Not Authenticated')).toBeTruthy()
  })

  test('keeps the exact CREDIT access gate and overview destination', async () => {
    auth.agent = { id: 'agent-1', schemeType: 'SHARING' }
    renderPage()
    expect(screen.getByText('Access Denied')).toBeTruthy()
    expect(screen.getByText(/only available for CREDIT scheme agents/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Overview' }))
    expect(await screen.findByText('Agent overview')).toBeTruthy()
  })

  test('renders the overview from the unchanged query and status rules', async () => {
    renderPage()
    expect(await screen.findByText('Healthy')).toBeTruthy()
    expect(screen.getByText('Credit Limit')).toBeTruthy()
    expect(screen.getByText('Available Credit')).toBeTruthy()
    expect(calls.find((call) => call.operationName === 'MyAgentCredit')?.variables).toEqual({})
    expect(screen.getByRole('tab', { name: /Overview/ }).getAttribute('aria-selected')).toBe('true')
  })

  test('loads adjustments only after its tab with exact paging variables', async () => {
    renderPage()
    await screen.findByText('Healthy')
    expect(calls.some((call) => call.operationName === 'MyAgentCreditHistory')).toBe(false)
    fireEvent.click(screen.getByRole('tab', { name: /Adjustments/ }))
    expect(await screen.findByText('Opening allocation')).toBeTruthy()
    expect(calls.find((call) => call.operationName === 'MyAgentCreditHistory')?.variables).toEqual({ limit: 20, offset: 0 })
  })

  test('offers next-page navigation only for a full server page', async () => {
    historyRows = 20
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /Adjustments/ }))
    const next = await screen.findByRole('button', { name: 'Next' })
    expect(next.hasAttribute('disabled')).toBe(false)
    fireEvent.click(next)
    await waitFor(() => expect(calls.some((call) => call.operationName === 'MyAgentCreditHistory' && call.variables.offset === 20)).toBe(true))
  })

  test('loads both settlement tables and totals with the exact query variables', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /Settlements/ }))
    expect(await screen.findByText('Weekly settlement')).toBeTruthy()
    expect(screen.getByText('To Agent')).toBeTruthy()
    expect(calls.find((call) => call.operationName === 'MyAgentSettlements')?.variables).toEqual({ limit: 20, offset: 0 })
  })

  test('keeps the header back action', async () => {
    renderPage(['/previous', '/agent/credit'])
    await screen.findByText('Healthy')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Previous page')).toBeTruthy()
  })
})
