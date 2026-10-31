/**
 * The bonus-awards filter bar on the kit: every legacy control and placeholder, the filter state each one
 * writes, the badge count, the date presets and custom range, and the two server lookups (agent, player)
 * with their exact variables. The lookups are private to the component module, so their mocks are built
 * with graphql's parse() from the same text; a changed document stops matching and fails these tests.
 *
 * DOM elements are compared by identity, never by a node:assert diff (that exhausts the worker).
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { parse } from 'graphql'
import { useState } from 'react'
import { BonusAwardsFiltersBar } from './BonusAwardsFiltersBar'
import {
  bonusAwardsToday,
  getBonusAwardsRangeForPreset,
  initialBonusAwardsFilters,
  type BonusAwardsListFiltersState,
} from '../bonusAwardsModel'

const AGENTS_DOCUMENT = parse(`
  query AgentsForBonusAwardsFilter($query: String, $limit: Int) {
    agents {
      agentsPage(query: $query, limit: $limit, offset: 0) {
        items {
          id
          username
        }
        total
      }
    }
  }
`)

const PLAYERS_DOCUMENT = parse(`
  query PlayersForBonusAwardsFilter($query: String, $limit: Int, $agentId: ID) {
    usersPage(query: $query, limit: $limit, offset: 0, agentId: $agentId) {
      items {
        id
        username
        name
        phone
      }
      total
    }
  }
`)

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>

let lookups: { agents: Array<Record<string, unknown>>; players: Array<Record<string, unknown>> }
let latest: BonusAwardsListFiltersState
const onClear = vi.fn()

function lookupMocks(): MockedResponse[] {
  return [
    {
      request: { query: AGENTS_DOCUMENT },
      variableMatcher: () => true,
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: (variables: Record<string, unknown>) => {
        lookups.agents.push(plain(variables))
        return {
          data: {
            agents: {
              __typename: 'AgentQueries',
              agentsPage: {
                __typename: 'AgentsPage',
                items: [
                  { __typename: 'Agent', id: '7', username: 'agent7' },
                  { __typename: 'Agent', id: '9', username: 'agent9' },
                ],
                total: 2,
              },
            },
          },
        }
      },
    },
    {
      request: { query: PLAYERS_DOCUMENT },
      variableMatcher: () => true,
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: (variables: Record<string, unknown>) => {
        lookups.players.push(plain(variables))
        const items = variables.query === 'zz'
          ? []
          : [
              { __typename: 'User', id: 4411, username: 'rk_sharma', name: 'Ravi', phone: '9876500001' },
              { __typename: 'User', id: 4412, username: null, name: 'Rk Kumar', phone: null },
            ]
        return { data: { usersPage: { __typename: 'UsersPage', items, total: items.length } } }
      },
    },
  ]
}

function Harness({ isAgent = false }: { isAgent?: boolean }) {
  const [filters, setFilters] = useState<BonusAwardsListFiltersState>(() => initialBonusAwardsFilters())
  latest = filters
  return (
    <BonusAwardsFiltersBar
      filters={filters}
      onFiltersChange={setFilters}
      onClear={() => {
        onClear()
        setFilters(initialBonusAwardsFilters())
      }}
      isAgent={isAgent}
      campaignOptions={[
        { value: '12', label: 'Diwali Reload (#12)' },
        { value: '14', label: 'Weekend Boost (#14)' },
      ]}
    />
  )
}

function renderBar(isAgent = false) {
  return render(
    <MockedProvider mocks={lookupMocks()}>
      <Harness isAgent={isAgent} />
    </MockedProvider>,
  )
}

const field = (name: string) => screen.getByRole('combobox', { name }) as HTMLInputElement

/** The open list's options (the Domain select's native options are left out). */
function optionLabels(): string[] {
  const listbox = screen.queryByRole('listbox')
  return listbox ? within(listbox).queryAllByRole('option').map((option) => option.textContent ?? '') : []
}

/** An empty-list text is shown in the list and announced in the field's live region. */
async function shown(text: string) {
  await waitFor(() => assert.ok(screen.queryAllByText(text).length > 0, text))
}

beforeEach(() => {
  lookups = { agents: [], players: [] }
  onClear.mockReset()
})

describe('BonusAwardsFiltersBar controls', () => {
  test('shows every legacy control with its placeholder, and no admin-only control for an agent', () => {
    const view = renderBar()
    const bar = screen.getByRole('search', { name: 'Filters' })
    assert.equal(field('Player').getAttribute('placeholder'), 'Player')
    assert.equal(field('Status').getAttribute('placeholder'), 'Status')
    assert.equal(field('Campaign').getAttribute('placeholder'), 'Campaign')
    assert.equal(field('Agent').getAttribute('placeholder'), 'Agent')
    assert.deepStrictEqual(
      within(field('Domain')).getAllByRole('option').map((option) => option.textContent),
      ['All domains', 'Global', 'Sports', 'Casino', 'Matka'],
    )
    assert.ok(within(bar).getByRole('button', { name: 'Date range: Today' }))
    assert.ok(within(bar).getByText('0 filters applied'))
    assert.ok(screen.queryByRole('button', { name: 'Clear all' }) === null, 'nothing to clear')
    view.unmount()

    renderBar(true)
    assert.ok(screen.queryByRole('combobox', { name: 'Campaign' }) === null, 'no campaign filter')
    assert.ok(screen.queryByRole('combobox', { name: 'Agent' }) === null, 'no agent filter')
    assert.ok(field('Player'))
  })

  test('status, domain and campaign write the filter state, and every status counts', async () => {
    renderBar()
    fireEvent.click(field('Status'), { detail: 1 })
    await screen.findByRole('listbox')
    assert.deepStrictEqual(optionLabels(), ['pending', 'active', 'completed', 'expired', 'cancelled'])
    fireEvent.click(screen.getByRole('option', { name: 'pending' }))
    fireEvent.click(screen.getByRole('option', { name: 'active' }))
    await waitFor(() => assert.deepStrictEqual(latest.status, ['pending', 'active']))
    assert.ok(screen.getByText('2 filters applied'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear Status' }))
    await waitFor(() => assert.equal(latest.status, undefined))

    fireEvent.change(field('Domain'), { target: { value: 'matka' } })
    assert.equal(latest.domain, 'matka')
    fireEvent.change(field('Domain'), { target: { value: '' } })
    assert.equal(latest.domain, '')

    fireEvent.change(field('Campaign'), { target: { value: 'diw' } })
    await waitFor(() => assert.deepStrictEqual(optionLabels(), ['Diwali Reload (#12)']))
    fireEvent.click(screen.getByRole('option', { name: 'Diwali Reload (#12)' }))
    await waitFor(() => assert.equal(latest.campaignId, 12))
    assert.equal(field('Campaign').value, 'Diwali Reload (#12)')
    assert.ok(screen.getByText('1 filter applied'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear Campaign' }))
    await waitFor(() => assert.equal(latest.campaignId, undefined))
  })

  test('date presets apply the legacy IST windows, a custom range its two days, and Reset today', async () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Last 7 Days' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const week = getBonusAwardsRangeForPreset('last7days')
    await waitFor(() => assert.deepStrictEqual([latest.dateFrom, latest.dateTo], [week?.from, week?.to]))
    assert.ok(await screen.findByRole('button', { name: 'Date range: Last 7 Days' }))
    assert.ok(screen.getByText('1 filter applied'))

    fireEvent.click(screen.getByRole('button', { name: 'Date range: Last 7 Days' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Custom Range' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.deepStrictEqual([latest.dateFrom, latest.dateTo], ['2026-09-01', '2026-09-15']))
    assert.ok(await screen.findByRole('button', { name: 'Date range: 2026-09-01 – 2026-09-15' }))

    fireEvent.click(screen.getByRole('button', { name: 'Date range: 2026-09-01 – 2026-09-15' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }))
    const today = bonusAwardsToday()
    await waitFor(() => assert.deepStrictEqual([latest.dateFrom, latest.dateTo], [today, today]))

    fireEvent.change(field('Domain'), { target: { value: 'sports' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal(onClear.mock.calls.length, 1)
    await waitFor(() => assert.equal(latest.domain, ''))
  })
})

describe('BonusAwardsFiltersBar lookups', () => {
  test('player search filters as you type, keeps a pick, and an abandoned search clears it', async () => {
    renderBar()
    const player = field('Player')

    fireEvent.change(player, { target: { value: 'r' } })
    assert.equal(latest.playerSearch, 'r', 'the typed text filters at once, as before')
    await shown('Type 2+ letters')
    assert.equal(lookups.players.length, 0, 'no lookup under two letters')

    fireEvent.change(player, { target: { value: 'rk' } })
    assert.equal(latest.playerSearch, 'rk')
    await waitFor(() => assert.deepStrictEqual(optionLabels(), ['rk_sharma (9876500001)', 'Rk Kumar']))
    assert.deepStrictEqual(lookups.players[0], { query: 'rk', limit: 50 })

    fireEvent.click(screen.getByRole('option', { name: 'rk_sharma (9876500001)' }))
    await waitFor(() => assert.equal(latest.playerSearch, 'rk_sharma'))
    assert.equal(player.value, 'rk_sharma (9876500001)')
    fireEvent.blur(player)
    assert.equal(latest.playerSearch, 'rk_sharma', 'the pick survives the search ending')
    assert.ok(screen.getByText('1 filter applied'))

    fireEvent.change(player, { target: { value: 'zz' } })
    assert.equal(latest.playerSearch, 'zz')
    await shown('No players')
    fireEvent.keyDown(player, { key: 'Escape' })
    await waitFor(() => assert.equal(latest.playerSearch, undefined))
    assert.equal(player.value, '')
  })

  test('agent search looks up from two letters; a pick sets the agent and Clear removes it', async () => {
    renderBar()
    const agent = field('Agent')
    fireEvent.change(agent, { target: { value: 'a' } })
    await shown('Type 2+ letters')
    assert.equal(latest.agentUsername, undefined, 'typing alone does not filter by agent')

    fireEvent.change(agent, { target: { value: 'ag' } })
    await waitFor(() => assert.deepStrictEqual(optionLabels(), ['agent7', 'agent9']))
    assert.deepStrictEqual(lookups.agents[0], { query: 'ag', limit: 50 })
    fireEvent.click(screen.getByRole('option', { name: 'agent7' }))
    await waitFor(() => assert.equal(latest.agentUsername, 'agent7'))
    assert.equal(agent.value, 'agent7')

    fireEvent.click(screen.getByRole('button', { name: 'Clear Agent' }))
    await waitFor(() => assert.equal(latest.agentUsername, undefined))
  })
})
