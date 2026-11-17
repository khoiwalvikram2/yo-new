/**
 * The drill-down modal: a DrillButton opens it with the figure's own title, pages through the rows 25 at a
 * time, sends a search to the server, and outside a DrilldownProvider (an agent's dashboard) the figure
 * stays plain text.
 */
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { DrillButton, DrilldownProvider } from './DrilldownDialog'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount,
    formatAmount: (amount: number) => `INR ${amount}`,
  }),
}))

afterEach(cleanup)

let asks: Array<Record<string, unknown>>

function reply(offset: number) {
  return {
    __typename: 'DashboardDrilldown', kind: 'bettors', title: 'Players who bet', subtitle: 'In the selected period',
    columns: [
      { __typename: 'DashboardDrillColumn', key: 'username', label: 'Player', kind: 'player' },
      { __typename: 'DashboardDrillColumn', key: 'agent', label: 'Agent', kind: 'agent' },
      { __typename: 'DashboardDrillColumn', key: 'staked', label: 'Staked', kind: 'money' },
      { __typename: 'DashboardDrillColumn', key: 'status', label: 'Status', kind: 'status' },
    ],
    rows: [{ __typename: 'DashboardDrillRow', id: `r${offset}`, cells: [`player${offset}`, 'neha', '-250', 'active'], playerId: 10 + offset, agentId: 'agent-9' }],
    total: 60,
    page: null,
  }
}

function mount(withProvider = true) {
  asks = []
  const link = new ApolloLink((operation) => new Observable((observer) => {
    asks.push(operation.variables)
    const timer = setTimeout(() => { observer.next({ data: { dashboardDrilldown: reply(Number(operation.variables.offset ?? 0)) } }); observer.complete() }, 1)
    return () => clearTimeout(timer)
  }))
  const button = <DrillButton drill={{ kind: 'bettors', title: 'Players Who Bet' }}>42</DrillButton>
  return render(
    <MemoryRouter>
      <ApolloProvider client={new ApolloClient({ link, cache: new InMemoryCache() })}>
        {withProvider ? <DrilldownProvider>{button}</DrilldownProvider> : button}
      </ApolloProvider>
    </MemoryRouter>,
  )
}

describe('DrilldownDialog', () => {
  test('opens with the figure title, links players and agents, and pages 25 at a time', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '42' }))
    const dialog = await screen.findByRole('dialog', { name: 'Players Who Bet' })
    assert.equal((await within(dialog).findByRole('link', { name: 'player0' })).getAttribute('href'), '/players/profile/10')
    assert.equal(within(dialog).getByRole('link', { name: 'neha' }).getAttribute('href'), '/agents/agent-9')
    assert.ok(within(dialog).getByText('-INR 250'))
    assert.ok(screen.getByText('1–25 of 60'))
    assert.equal(asks[0].limit, 25)
    assert.equal(asks[0].offset, 0)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('link', { name: 'player25' })
    assert.equal(asks[asks.length - 1].offset, 25)
    assert.ok(screen.getByText('26–50 of 60'))
  })

  test('a search goes to the server and starts again from the first page', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '42' }))
    await screen.findByRole('dialog', { name: 'Players Who Bet' })
    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'rakesh' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => assert.equal(asks[asks.length - 1].search, 'rakesh'))
    assert.equal(asks[asks.length - 1].offset, 0)
  })

  test('a Super Admin in core mode sees the players without profile links core mode cannot open (PLA-05)', async () => {
    // Core mode's drill-downs span every whitelabel; its profile page reads the platform's own site ("Player not found").
    const ui = useUIStore.getState(); const roles = useAuthStore.getState().roles
    useAuthStore.setState({ roles: ['Super Admin'] }); useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    try {
      const core = mount()
      fireEvent.click(screen.getByRole('button', { name: '42' }))
      const dialog = await screen.findByRole('dialog', { name: 'Players Who Bet' })
      assert.ok(await within(dialog).findByText('player0'))
      assert.ok(!within(dialog).queryByRole('link', { name: 'player0' }), 'no profile link in core mode')
      core.unmount()
      // With a whitelabel selected the profile opens in that site, so the name links again.
      useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'grandwinn-com' })
      mount()
      fireEvent.click(screen.getByRole('button', { name: '42' }))
      const linked = await screen.findByRole('dialog', { name: 'Players Who Bet' })
      assert.equal((await within(linked).findByRole('link', { name: 'player0' })).getAttribute('href'), '/players/profile/10')
    } finally {
      useAuthStore.setState({ roles }); useUIStore.setState({ directorMode: ui.directorMode, selectedWhitelabelId: ui.selectedWhitelabelId })
    }
  })

  test('outside a provider the figure stays plain text', () => {
    mount(false)
    assert.equal(screen.queryByRole('button'), null)
    assert.ok(screen.getByText('42'))
  })
})
