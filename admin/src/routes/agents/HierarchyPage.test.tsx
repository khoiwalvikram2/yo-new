import dayjs from 'dayjs'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { HierarchyPageContent } from './HierarchyPage'

interface MockAgent {
  id: string
  schemeType: string
  levelIndex: number | null
}

interface Call {
  operationName: string
  variables: Record<string, unknown>
}

const auth = vi.hoisted(() => ({ agent: undefined as MockAgent | undefined }))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: MockAgent }) => unknown) => selector({ agent: auth.agent }),
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (value: number) => value,
    formatAmount: (value: number) => `INR ${value.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/utils/date', () => ({
  nowIST: () => dayjs('2026-10-07T12:00:00'),
  todayISTString: () => '2026-10-07',
}))

const nodes = [
  {
    __typename: 'Agent', id: 'sub-credit', username: 'Credit Partner', schemeType: 'CREDIT',
    status: 'ACTIVE', levelIndex: 2, creditLimit: 100000, creditUsed: 35000,
    creditAvailable: 65000, parentAgentId: 'root-agent',
  },
  {
    __typename: 'Agent', id: 'sub-sharing', username: 'Sharing Partner', schemeType: 'SHARING',
    status: 'SUSPENDED', levelIndex: 3, creditLimit: 0, creditUsed: 0,
    creditAvailable: 0, parentAgentId: 'root-agent',
  },
]

const details = {
  __typename: 'Agent', id: 'sub-credit', username: 'Credit Partner', schemeType: 'CREDIT',
  allowedDomains: ['sports', 'casino'], status: 'ACTIVE', phone: '9999999999',
  creditLimit: 100000, creditUsed: 35000, creditAvailable: 65000,
  parentAgentId: 'root-agent', levelIndex: 2,
}

let calls: Call[]
let failTree = false

function response(operation: Operation): FetchResult {
  calls.push({
    operationName: operation.operationName,
    variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown>,
  })
  if (operation.operationName === 'AgentTree') {
    if (failTree) throw new Error('Hierarchy service unavailable')
    return { data: { agents: { __typename: 'AgentQueries', agentTree: nodes } } }
  }
  if (operation.operationName === 'AgentDetails') {
    return {
      data: {
        agents: {
          __typename: 'AgentQueries',
          agentProfile: details,
          agentKPIs: {
            __typename: 'AgentKPIs', totalGGR: 12500, sportsGGR: 7000,
            casinoGGR: 4500, matkaGGR: 1000,
          },
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

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current location">{location.pathname}</output>
}

function renderPage() {
  return render(
    <MockedProvider link={serverLink()} cache={undefined}>
      <MemoryRouter initialEntries={['/agents/hierarchy']}>
        <PageEyebrowProvider value="Users">
          <Routes>
            <Route path="/agents/hierarchy" element={<><HierarchyPageContent /><LocationProbe /></>} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

beforeEach(() => {
  auth.agent = { id: 'root-agent', schemeType: 'CREDIT', levelIndex: 1 }
  calls = []
  failTree = false
})

describe('/agents/hierarchy', () => {
  test('loads the exact root and renders the kit summary and hierarchy rows', async () => {
    renderPage()
    expect(await screen.findByText('Credit Partner')).toBeTruthy()
    expect(calls.find((call) => call.operationName === 'AgentTree')?.variables).toEqual({ rootId: 'root-agent' })
    expect(screen.getByRole('heading', { level: 1, name: 'Agent Hierarchy' })).toBeTruthy()
    expect(screen.queryByText('Users')).toBeNull()
    const summary = screen.getByLabelText('Hierarchy summary')
    expect(within(summary).getByText('Total sub-agents')).toBeTruthy()
    expect(within(summary).getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getByRole('tree', { name: 'Agent hierarchy' })).toBeTruthy()
  })

  test('skips queries and presents the explicit agent-auth state without an agent', async () => {
    auth.agent = undefined
    renderPage()
    expect(screen.getByText('Agent sign-in required')).toBeTruthy()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual([])
  })

  test('keeps the sub-agent depth gate and navigates to creation', async () => {
    renderPage()
    await screen.findByText('Credit Partner')
    fireEvent.click(screen.getByRole('button', { name: 'Create sub-agent' }))
    expect(screen.getByLabelText('Current location').textContent).toBe('/agent/create')
  })

  test('hides creation at maximum depth', async () => {
    auth.agent = { id: 'root-agent', schemeType: 'CREDIT', levelIndex: 4 }
    renderPage()
    await screen.findByText('Credit Partner')
    expect(screen.queryByRole('button', { name: 'Create sub-agent' })).toBeNull()
  })

  test('searches by status and restores all rows after clearing', async () => {
    renderPage()
    await screen.findByText('Credit Partner')
    const search = screen.getByRole('searchbox', { name: 'Search hierarchy' })
    fireEvent.change(search, { target: { value: 'suspended' } })
    expect(screen.queryByText('Credit Partner')).toBeNull()
    expect(screen.getByText('Sharing Partner')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'missing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByText('Credit Partner')).toBeTruthy()
  })

  test('selects an agent and requests exact last-30-day detail variables', async () => {
    renderPage()
    await screen.findByText('Credit Partner')
    fireEvent.click(screen.getByRole('button', { name: 'View Credit Partner details' }))
    expect(await screen.findByRole('dialog', { name: 'Credit Partner' })).toBeTruthy()
    await screen.findByText('INR 65000.00')
    expect(calls.find((call) => call.operationName === 'AgentDetails')?.variables).toEqual({
      agentId: 'sub-credit', periodFrom: '2026-09-07', periodTo: '2026-10-07',
    })
    expect(screen.getByText('sports')).toBeTruthy()
    expect(screen.getByText('INR 12500.00')).toBeTruthy()
  })

  test('opens the full profile from the credit action', async () => {
    renderPage()
    await screen.findByText('Credit Partner')
    fireEvent.click(screen.getByRole('button', { name: 'View Credit Partner details' }))
    await screen.findByRole('dialog', { name: 'Credit Partner' })
    fireEvent.click(screen.getByRole('button', { name: 'Adjust credit' }))
    expect(screen.getByLabelText('Current location').textContent).toBe('/agents/sub-credit')
  })

  test('shows a retryable hierarchy failure', async () => {
    failTree = true
    renderPage()
    expect(await screen.findByText('Could not load the hierarchy')).toBeTruthy()
    expect(screen.getByText('Hierarchy service unavailable')).toBeTruthy()
    const before = calls.filter((call) => call.operationName === 'AgentTree').length
    failTree = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls.filter((call) => call.operationName === 'AgentTree').length).toBeGreaterThan(before))
    expect(await screen.findByText('Credit Partner')).toBeTruthy()
  })
})
