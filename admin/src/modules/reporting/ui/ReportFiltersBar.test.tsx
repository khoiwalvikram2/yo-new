import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useReportingStore } from '@/state/reportingStore'
import { AGENTS_SEARCH_QUERY, BONUS_CAMPAIGNS_QUERY } from '../drillDownQueries'
import { ReportFiltersBar } from './ReportFiltersBar'

interface QueryOptions {
  variables: Record<string, unknown>
  skip: boolean
  fetchPolicy: string
}

const hooks = vi.hoisted(() => ({ useQuery: vi.fn() }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return { ...actual, useQuery: hooks.useQuery }
})

let calls: Array<{ document: unknown; options: QueryOptions }>
let agentsLoading = false

const AGENTS = { agents: { agentsPage: { items: [{ id: 7, username: 'raj', phone: '98' }, { id: 'a2', username: 'lee', phone: null }], total: 2 } } }
const CAMPAIGNS = { bonusCampaigns: [{ id: 'c1', name: 'Diwali', status: 'active' }] }

function lastOptions(document: unknown): QueryOptions {
  const found = calls.filter((call) => call.document === document).at(-1)
  assert.ok(found, 'the query was called')
  return found.options
}

function filters() {
  return useReportingStore.getState().filters
}

function optionLabels(select: HTMLElement): string[] {
  return Array.from((select as HTMLSelectElement).options).map((option) => option.textContent ?? '')
}

beforeEach(() => {
  calls = []
  agentsLoading = false
  useReportingStore.setState({ filters: { dateFrom: '2000-01-01', dateTo: '2026-10-07', currency: undefined } })
  hooks.useQuery.mockImplementation((document: unknown, options: QueryOptions) => {
    calls.push({ document, options })
    if (document === AGENTS_SEARCH_QUERY) return { data: options.skip ? undefined : AGENTS, loading: agentsLoading }
    if (document === BONUS_CAMPAIGNS_QUERY) return { data: options.skip ? undefined : CAMPAIGNS, loading: false }
    return { data: undefined, loading: false }
  })
})

describe('ReportFiltersBar', () => {
  test('by default: the date range only, both option queries skipped, one filter applied', () => {
    render(<ReportFiltersBar />)
    const bar = screen.getByRole('search', { name: 'Filters' })
    assert.ok(within(bar).getByRole('button', { name: 'Date range: 2000-01-01 – 2026-10-07' }))
    assert.equal(within(bar).queryAllByRole('combobox').length, 0)
    assert.equal(within(bar).getByRole('status').textContent, '1 filter applied')
    assert.ok(within(bar).getByRole('button', { name: 'Clear all' }))
    assert.equal(screen.queryByRole('button', { name: 'Refresh' }), null)

    assert.deepEqual(lastOptions(AGENTS_SEARCH_QUERY), {
      variables: { query: undefined, offset: 0, limit: 50 },
      skip: true,
      fetchPolicy: 'cache-and-network',
    })
    assert.deepEqual(lastOptions(BONUS_CAMPAIGNS_QUERY), {
      variables: { search: undefined },
      skip: true,
      fetchPolicy: 'cache-and-network',
    })
  })

  test('the agent list searches from two characters and writes the chosen agent', () => {
    render(<ReportFiltersBar showAgentFilter />)
    assert.equal(lastOptions(AGENTS_SEARCH_QUERY).skip, false)
    const select = screen.getByRole('combobox', { name: 'Agent' })
    assert.deepEqual(optionLabels(select), ['All agents', 'raj (98)', 'lee'])

    const search = screen.getByRole('searchbox', { name: 'Search agents' })
    fireEvent.change(search, { target: { value: 'r' } })
    assert.equal(lastOptions(AGENTS_SEARCH_QUERY).skip, true)
    fireEvent.change(search, { target: { value: ' ra ' } })
    assert.deepEqual(lastOptions(AGENTS_SEARCH_QUERY).variables, { query: 'ra', offset: 0, limit: 50 })
    assert.equal(lastOptions(AGENTS_SEARCH_QUERY).skip, false)

    fireEvent.change(screen.getByRole('combobox', { name: 'Agent' }), { target: { value: '7' } })
    assert.equal(filters().agentId, '7')
    assert.equal(screen.getByRole('status').textContent, '2 filters applied')
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent' }), { target: { value: '' } })
    assert.equal(filters().agentId, undefined)
  })

  test('a one-character agent search says why the list is empty', () => {
    render(<ReportFiltersBar showAgentFilter />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search agents' }), { target: { value: 'r' } })
    const select = screen.getByRole('combobox', { name: 'Agent' })
    assert.deepEqual(optionLabels(select), ['All agents', 'Type at least 2 characters'])
    const hint = Array.from((select as HTMLSelectElement).options).at(-1)
    assert.equal(hint?.disabled, true)
  })

  test('the agent select is busy while its list loads', () => {
    agentsLoading = true
    render(<ReportFiltersBar showAgentFilter />)
    const select = screen.getByRole('combobox', { name: 'Agent' })
    assert.equal(select.getAttribute('aria-busy'), 'true')
    assert.equal((select as HTMLSelectElement).disabled, true)
  })

  test('the campaign list searches from one character and writes the chosen campaign', () => {
    render(<ReportFiltersBar showCampaignFilter />)
    assert.equal(lastOptions(BONUS_CAMPAIGNS_QUERY).skip, false)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search campaigns' }), { target: { value: ' d ' } })
    assert.deepEqual(lastOptions(BONUS_CAMPAIGNS_QUERY).variables, { search: 'd' })
    const select = screen.getByRole('combobox', { name: 'Campaign' })
    assert.deepEqual(optionLabels(select), ['All campaigns', 'Diwali (active)'])
    fireEvent.change(select, { target: { value: 'c1' } })
    assert.equal(filters().campaignId, 'c1')
  })

  test('currency shows USD until chosen; domain clears through All domains', () => {
    render(<ReportFiltersBar showCurrencyFilter showDomainFilter />)
    const currency = screen.getByRole('combobox', { name: 'Currency' }) as HTMLSelectElement
    assert.equal(currency.value, 'USD')
    assert.deepEqual(optionLabels(currency), ['USD', 'INR', 'EUR'])
    fireEvent.change(currency, { target: { value: 'INR' } })
    assert.equal(filters().currency, 'INR')

    const domain = screen.getByRole('combobox', { name: 'Domain' })
    assert.deepEqual(optionLabels(domain), ['All domains', 'Sports', 'Casino', 'Matka', 'Global'])
    fireEvent.change(domain, { target: { value: 'casino' } })
    assert.equal(filters().domain, 'casino')
    assert.equal(screen.getByRole('status').textContent, '3 filters applied')
    fireEvent.change(domain, { target: { value: '' } })
    assert.equal(filters().domain, undefined)
  })

  test('Clear all clears every filter but keeps a currency the bar does not show', () => {
    act(() => {
      useReportingStore.setState({
        filters: { dateFrom: '2026-01-01', dateTo: '2026-01-31', currency: 'INR', domain: 'casino', agentId: '7', campaignId: 'c1' },
      })
    })
    render(<ReportFiltersBar showAgentFilter showDomainFilter />)
    assert.equal(screen.getByRole('status').textContent, '3 filters applied')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.deepEqual(
      { ...filters() },
      { dateFrom: undefined, dateTo: undefined, currency: 'INR', domain: undefined, agentId: undefined, campaignId: undefined },
    )
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)
  })

  test('a custom range applies as calendar days; All dates clears the range', () => {
    render(<ReportFiltersBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Date range: 2000-01-01 – 2026-10-07' }))
    const presets = screen.getByRole('group', { name: 'Period presets' })
    assert.equal(within(presets).getByRole('button', { name: 'Custom range' }).getAttribute('aria-pressed'), 'true')
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.equal(filters().dateFrom, '2026-09-01')
    assert.equal(filters().dateTo, '2026-09-30')

    fireEvent.click(screen.getByRole('button', { name: 'Date range: 2026-09-01 – 2026-09-30' }))
    fireEvent.click(screen.getByRole('button', { name: 'All dates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.equal(filters().dateFrom, undefined)
    assert.equal(filters().dateTo, undefined)
    assert.ok(screen.getByRole('button', { name: 'Date range: All dates' }))
    assert.equal(screen.getByRole('status').textContent, '0 filters applied')
  })

  test('Refresh is a labelled button beside the bar; a page date control replaces the built-in one', () => {
    const onRefresh = vi.fn()
    render(<ReportFiltersBar onRefresh={onRefresh} dateFilter={<button type="button">Period: Today</button>} surface="bare" />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    assert.equal(onRefresh.mock.calls.length, 1)
    assert.equal(screen.getByRole('search', { name: 'Filters' }).contains(screen.getByRole('button', { name: 'Refresh' })), false)
    assert.ok(screen.getByRole('button', { name: 'Period: Today' }))
    assert.equal(screen.queryByRole('button', { name: /^Date range/ }), null)
  })
})
