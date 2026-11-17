import dayjs from 'dayjs'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import { agentSession, chipAccountFixture } from '@/modules/chips/chipTestKit'
import { HierarchyPageContent } from './HierarchyPage'

interface Call {
  operationName: string
  variables: Record<string, unknown>
}

// The real session store (the chips actions read the signed-in agent from it): a level-1 CREDIT agent by default.
const signIn = (levelIndex: number | null = 1) =>
  useAuthStore.setState({ agent: { ...agentSession({ id: 'root-agent' }), levelIndex }, user: undefined, permissions: [], agentPermissions: [], isReadOnly: false })

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

// The CREDIT sub-agent's chips (spec 2026-11-02 §7 AgentAccount.chips); its parent is the signed-in agent.
const creditChips = chipAccountFixture({
  id: 'sub-credit', username: 'Credit Partner', parentAgentId: 'root-agent', creditReference: 100000,
  balance: 65000, exposure: 1500, available: 65000, downlineBalance: 12000, refPnl: -23000, downlineCount: 2,
})

const nodes = [
  {
    __typename: 'Agent', id: 'sub-credit', username: 'Credit Partner', schemeType: 'CREDIT',
    status: 'ACTIVE', levelIndex: 2, parentAgentId: 'root-agent', chips: creditChips,
  },
  {
    __typename: 'Agent', id: 'sub-sharing', username: 'Sharing Partner', schemeType: 'SHARING',
    status: 'SUSPENDED', levelIndex: 3, parentAgentId: 'root-agent', chips: null,
  },
]

const details = {
  __typename: 'Agent', id: 'sub-credit', username: 'Credit Partner', schemeType: 'CREDIT',
  allowedDomains: ['sports', 'casino'], status: 'ACTIVE', phone: '9999999999',
  parentAgentId: 'root-agent', levelIndex: 2, chips: creditChips,
}

let calls: Call[]
let failTree = false
// The tree the server answers; a test may swap it (a sub-agent always has its parent's scheme).
let treeNodes: Array<Record<string, unknown>> = nodes

function response(operation: Operation): FetchResult {
  calls.push({
    operationName: operation.operationName,
    variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown>,
  })
  if (operation.operationName === 'AgentTree') {
    if (failTree) throw new Error('Hierarchy service unavailable')
    return { data: { agents: { __typename: 'AgentQueries', agentTree: treeNodes } } }
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
  signIn()
  calls = []
  failTree = false
  treeNodes = nodes
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

  test("names the scheme figure after the signed-in agent's scheme, not credit vs sharing (AGE-17)", async () => {
    // A COMMISSION root with one COMMISSION sub-agent read "CREDIT ACCOUNTS 0 — 1 sharing accounts".
    useAuthStore.setState({ agent: { ...agentSession({ id: 'root-agent', schemeType: 'COMMISSION' }), levelIndex: 1 } })
    treeNodes = [{ __typename: 'Agent', id: 'sub-commission', username: 'Commission Partner', schemeType: 'COMMISSION', status: 'ACTIVE', levelIndex: 2, parentAgentId: 'root-agent', chips: null }]
    renderPage()
    expect(await screen.findByText('Commission Partner')).toBeTruthy()
    const summary = within(screen.getByLabelText('Hierarchy summary'))
    expect(summary.getByText('Commission accounts')).toBeTruthy()
    expect(summary.getByText('All on your scheme')).toBeTruthy()
    expect(summary.queryByText(/credit accounts|sharing account/i)).toBeNull()
    // B001: the tree's row called every non-CREDIT sub-agent a "Revenue-sharing account" as well.
    const tree = within(screen.getByRole('tree', { name: 'Agent hierarchy' }))
    expect(tree.getByText('Commission account')).toBeTruthy()
    expect(tree.queryByText(/sharing/i)).toBeNull()
  })

  test('each row without chips names its own scheme (B001)', async () => {
    treeNodes = [
      ...nodes,
      { __typename: 'Agent', id: 'sub-credit-2', username: 'Unread Credit', schemeType: 'CREDIT', status: 'ACTIVE', levelIndex: 2, parentAgentId: 'root-agent', chips: null },
    ]
    renderPage()
    expect(await screen.findByText('Sharing Partner')).toBeTruthy()
    const row = (name: string) => within(screen.getByRole('button', { name: `View ${name} details` }))
    expect(row('Sharing Partner').getByText('Revenue-sharing account')).toBeTruthy()
    expect(row('Unread Credit').getByText('Chips not available')).toBeTruthy()
  })

  test('skips queries and presents the explicit agent-auth state without an agent', async () => {
    useAuthStore.setState({ agent: undefined })
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
    signIn(4)
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
    const dialog = await screen.findByRole('dialog', { name: 'Credit Partner' })
    await within(dialog).findByText('INR 12000.00')
    expect(calls.find((call) => call.operationName === 'AgentDetails')?.variables).toEqual({
      agentId: 'sub-credit', periodFrom: '2026-09-07', periodTo: '2026-10-07',
    })
    expect(screen.getByText('sports')).toBeTruthy()
    expect(screen.getByText('INR 12500.00')).toBeTruthy()
  })

  test('a CREDIT row shows its chips with D / W / CR for its direct parent; there is no Adjust credit', async () => {
    renderPage()
    const row = (await screen.findByText('Credit Partner')).closest('li') as HTMLElement
    expect(within(row).getByText('INR 65000.00')).toBeTruthy()
    const refPnl = within(row).getByText('−INR 23000.00')
    expect(refPnl.className).toContain('loss')
    expect(within(row).getByRole('button', { name: 'Deposit chips to Credit Partner' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Withdraw chips from Credit Partner' })).toBeTruthy()
    for (const gone of [/% used/, /available/]) expect(within(row).queryByText(gone)).toBeNull()
    const sharing = screen.getByText('Sharing Partner').closest('li') as HTMLElement
    expect(within(sharing).queryByRole('button', { name: /Deposit chips/ })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Credit Partner' }))
    expect(await screen.findByRole('menuitem', { name: 'Edit agent' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Adjust credit' })).toBeNull()
  })

  test('the drawer shows the agent\'s chips and moves them; the full profile stays one click away', async () => {
    renderPage()
    await screen.findByText('Credit Partner')
    fireEvent.click(screen.getByRole('button', { name: 'View Credit Partner details' }))
    const dialog = await screen.findByRole('dialog', { name: 'Credit Partner' })
    const chips = (await within(dialog).findByRole('heading', { name: 'Chips' })).closest('section') as HTMLElement
    for (const text of ['INR 100000.00', 'Balance', 'INR 65000.00', 'Downline balance', 'Exposure', 'INR 1500.00', '−INR 23000.00', 'Owes upline']) {
      expect(within(chips).getByText(text)).toBeTruthy()
    }
    // The term, and the worded Credit reference action beside Deposit and Withdraw.
    expect(within(chips).getAllByText('Credit reference')).toHaveLength(2)
    for (const gone of ['Credit limit', 'Credit used', 'Adjust credit']) expect(within(dialog).queryByText(gone)).toBeNull()
    expect(within(chips).getByRole('button', { name: 'Deposit chips to Credit Partner' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open full agent profile' }))
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
