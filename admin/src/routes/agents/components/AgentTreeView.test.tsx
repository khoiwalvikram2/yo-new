import { afterEach, beforeEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MemoryRouter } from 'react-router-dom'
import { agentsSearchResponse, agentsSearchRow, agentListStatsFixture } from '../../../../test/agentsSearchPreviewData'
import type { AgentListRow, AgentListStats } from './agentsSearchModel'
import { AgentTreeView } from './AgentTreeView'

type Page = { rows: AgentListRow[]; total?: number }
let calls: Array<{ name: string; parent: string; offset: number; limit: number }>
let pages: Record<string, Page>
let server: (operation: Operation) => Promise<FetchResult>
let stats: AgentListStats
const row = (id: string, username: string, parentAgentId: string | null = null): AgentListRow => ({ ...agentsSearchRow('COMMISSION', id), username, parentAgentId, parentAgent: parentAgentId ? { id: parentAgentId, username: parentAgentId } : null })

function response(operation: Operation): FetchResult {
  const base = agentsSearchResponse(operation).data as { agents: { agentsPage: { items: AgentListRow[]; itemsWithStats: Array<{ agent: { id: string }; stats: AgentListStats }> } } }
  const page = pages[String(operation.variables.parentAgentId)] ?? { rows: [] }
  const offset = Number(operation.variables.offset)
  const items = page.rows.slice(offset, offset + Number(operation.variables.limit))
  const template = base.agents.agentsPage
  if (operation.operationName === 'AgentsPage') return { data: { agents: { agentsPage: { items: items.map(item => ({ ...template.items[0], ...item })), total: page.total ?? page.rows.length } } } }
  return { data: { agents: { agentsPage: { itemsWithStats: items.map(item => ({ ...template.itemsWithStats[0], agent: { ...template.itemsWithStats[0].agent, id: item.id }, stats })) } } } }
}
function deferred() {
  let resolve!: (value: FetchResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<FetchResult>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function mount(roots: AgentListRow[] = [row('a', 'Alpha')], schemeType = 'COMMISSION', viewKey = 'initial') {
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, parent: String(operation.variables.parentAgentId), offset: Number(operation.variables.offset), limit: Number(operation.variables.limit) })
    let cancelled = false
    void server(operation).then(result => { if (!cancelled) { observer.next(result); observer.complete() } }, error => { if (!cancelled) observer.error(error) })
    return () => { cancelled = true }
  })) })
  const element = (key: string, scheme: string) => <ApolloProvider client={client}><MemoryRouter><AgentTreeView key={key} roots={roots} schemeType={scheme} status="" formatAmount={amount => amount == null ? '—' : `INR ${amount}`} pending={item => <>{item.stats?.pendingSettlement ?? '—'}</>} lastLogin={value => value ?? '—'} /></MemoryRouter></ApolloProvider>
  const view = render(element(viewKey, schemeType))
  return { ...view, changeScheme: (scheme: string) => view.rerender(element(scheme, scheme)) }
}
beforeEach(() => { calls = []; pages = {}; stats = { ...agentListStatsFixture }; server = async operation => response(operation) })
afterEach(cleanup)

test('out-of-order sibling responses stay in their own branches; a collapsed branch reopens from its cache', async () => {
  pages = { a: { rows: [row('a1', 'Alpha child', 'a')] }, b: { rows: [row('b1', 'Beta child', 'b')] } }
  const alpha = deferred(), beta = deferred()
  let alphaOperation!: Operation, betaOperation!: Operation
  server = async operation => {
    if (operation.operationName === 'AgentsStats') return response(operation)
    if (operation.variables.parentAgentId === 'a') { alphaOperation = operation; return alpha.promise }
    betaOperation = operation; return beta.promise
  }
  mount([row('a', 'Alpha'), row('b', 'Beta')])
  fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha' }))
  fireEvent.click(screen.getByRole('button', { name: 'Expand Beta' }))
  assert.equal(screen.getAllByText('Loading sub-agents…').length, 2)
  await act(async () => beta.resolve(response(betaOperation)))
  assert.ok(within(screen.getByRole('list', { name: 'Sub-agents of Beta' })).getByText('Beta child'))
  await act(async () => alpha.resolve(response(alphaOperation)))
  const alphaChildren = screen.getByRole('list', { name: 'Sub-agents of Alpha' })
  assert.ok(within(alphaChildren).getByText('Alpha child'))
  assert.equal(within(alphaChildren).queryByText('Beta child'), null)
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Alpha' }))
  assert.equal(screen.queryByRole('list', { name: 'Sub-agents of Alpha' }), null)
  fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha' }))
  assert.ok(screen.getByRole('list', { name: 'Sub-agents of Alpha' }))
  assert.equal(calls.filter(call => call.name === 'AgentsPage' && call.parent === 'a').length, 1)
})

test('opening a branch fetches 20 children, adds the next page without losing existing rows, and loads actual child totals', async () => {
  pages.a = { rows: Array.from({ length: 23 }, (_, index) => row(`child${index}`, `Child ${index}`, 'a')) }
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha' }))
  await screen.findByText('20 of 23 sub-agents')
  assert.equal(screen.queryByText('Child 20'), null)
  const children = screen.getByRole('list', { name: 'Sub-agents of Alpha' })
  await waitFor(() => assert.equal(within(children).getAllByText('INR 1200').length, 20))
  fireEvent.click(screen.getByRole('button', { name: 'Load more sub-agents' }))
  await screen.findByText('Child 22')
  assert.ok(screen.getByText('Child 0'))
  assert.equal(screen.queryByRole('button', { name: 'Load more sub-agents' }), null)
  assert.deepEqual(calls.filter(call => call.name === 'AgentsPage'), [
    { name: 'AgentsPage', parent: 'a', offset: 0, limit: 20 },
    { name: 'AgentsPage', parent: 'a', offset: 20, limit: 20 },
  ])
})

test('failed children can be retried inline and an empty branch gives an explicit result', async () => {
  let fail = true
  server = async operation => { if (fail) throw new Error('Connection interrupted'); return response(operation) }
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha' }))
  await screen.findByRole('alert')
  assert.ok(screen.getByRole('link', { name: 'Alpha' }))
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry sub-agents' }))
  await screen.findByText('No sub-agents.')
  assert.ok(screen.getByText('0 sub-agents'))
  assert.equal(calls.filter(call => call.name === 'AgentsStats').length, 0)
})

test('child identities appear before stats, missing amounts stay unknown, and stats failures can be retried', async () => {
  pages.a = { rows: [row('a1', 'Alpha child', 'a')] }
  let failStats = true
  server = async operation => { if (operation.operationName === 'AgentsStats' && failStats) throw new Error('Stats unavailable'); return response(operation) }
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha' }))
  await screen.findByText('Alpha child')
  await screen.findByText('Activity totals unavailable.')
  assert.equal(screen.queryByText('INR 0'), null)
  failStats = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry activity' }))
  await screen.findByText('INR 1200')
  assert.equal(screen.queryByRole('alert'), null)
})

test('expand first level actually fetches each root and collapse all hides all branches', async () => {
  pages = { a: { rows: [row('a1', 'Alpha child', 'a')] }, b: { rows: [row('b1', 'Beta child', 'b')] } }
  mount([row('a', 'Alpha'), row('b', 'Beta')])
  fireEvent.click(screen.getByRole('button', { name: 'Expand first level' }))
  await screen.findByText('Alpha child'); await screen.findByText('Beta child')
  assert.deepEqual(calls.filter(call => call.name === 'AgentsPage').map(call => call.parent).sort(), ['a', 'b'])
  fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
  assert.equal(screen.queryByRole('list', { name: 'Sub-agents of Alpha' }), null)
  assert.equal(screen.queryByRole('list', { name: 'Sub-agents of Beta' }), null)
})

test('late responses from the old filter scope cannot populate the new hierarchy', async () => {
  pages.a = { rows: [row('old', 'Old commission child', 'a')] }
  const pending = deferred()
  let operation!: Operation
  server = async request => { operation = request; return pending.promise }
  const view = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha' }))
  view.changeScheme('CREDIT')
  await act(async () => pending.resolve(response(operation)))
  assert.equal(screen.queryByText('Old commission child'), null)
  assert.ok(screen.getByRole('button', { name: 'Expand Alpha' }))
  assert.equal(calls.length, 1)
})

test('View opens the agent profile (there is no details drawer); status and figures stay on the row', () => {
  const root = { ...row('a', 'Alpha'), stats: agentListStatsFixture }
  mount([root])
  assert.equal(screen.getByRole('link', { name: 'View profile Alpha' }).getAttribute('href'), '/agents/a')
  assert.equal(screen.queryByRole('button', { name: /^Details/ }), null)
  assert.equal(screen.getByRole('link', { name: 'Alpha' }).getAttribute('href'), '/agents/a')
  assert.ok(screen.getByText('Active'))
  assert.ok(screen.getByText('INR 1200'))
  assert.ok(screen.getByText('INR 450000'))
})

test('a level-4 credit agent cannot have sub-agents, so it shows no expand control', () => {
  mount([{ ...row('a', 'Alpha'), schemeType: 'CREDIT', levelIndex: 4 }], 'CREDIT')
  assert.equal(screen.queryByRole('button', { name: 'Expand Alpha' }), null)
  assert.ok(screen.getByRole('link', { name: 'View profile Alpha' }))
})
