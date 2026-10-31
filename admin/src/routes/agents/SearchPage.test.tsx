import { beforeEach, afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/shared/core/authStore'
import AgentsSearchPage from './SearchPage'
import { agentsSearchResponse, type AgentsSearchFixtureState } from '../../../test/agentsSearchPreviewData'

const guard = vi.hoisted(() => ({ allowed: true, bypass: false }))
const feedback = vi.hoisted(() => ({ toast: vi.fn(), success: vi.fn(), error: vi.fn(), exporting: vi.fn() }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children, bypassForAgents }: { children: ReactNode; bypassForAgents?: boolean }) => { guard.bypass = !!bypassForAgents; return guard.allowed ? children : <div role="alert">Access denied</div> } }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (amount: number) => `INR ${amount}`, getCurrencySymbol: () => '₹', convertFromWhitelabelCurrency: (amount: number) => amount }) }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: feedback.success, error: feedback.error } }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('./utils/exportAgents', () => ({ exportAgentsToExcel: feedback.exporting }))

let calls: Array<{ name: string; variables: Record<string, unknown> }>
let state: AgentsSearchFixtureState
function LocationProbe() { const location = useLocation(); return <output>{location.search}</output> }
function mount(path = '/agents') {
  const client = new ApolloClient({ cache: new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } }), link: new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    const timer = setTimeout(() => {
      if (state.queryError && operation.operationName === 'AgentsPage') { observer.error(new Error('Agents unavailable')); return }
      try { observer.next(agentsSearchResponse(operation, state)); observer.complete() } catch (error) { observer.error(error) }
    }, 1)
    return () => clearTimeout(timer)
  })) })
  render(<ApolloProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/agents" element={<><AgentsSearchPage /><LocationProbe /></>} /><Route path="/agents/create" element={<div>Create Agent</div>} /><Route path="/agents/:id/edit" element={<div>Edit agent page</div>} /><Route path="/agents/:id" element={<div>Agent profile page</div>} /></Routes></MemoryRouter></ApolloProvider>)
}
beforeEach(() => { calls = []; state = {}; guard.allowed = true; feedback.toast.mockClear(); feedback.success.mockClear(); feedback.error.mockClear(); feedback.exporting.mockClear(); window.sessionStorage.clear(); useAuthStore.setState({ agent: undefined, user: undefined, roles: [], permissions: [] }) })
afterEach(() => cleanup())
async function choose(label: string, option: string) { const input = screen.getByRole('combobox', { name: label }); fireEvent.click(input); fireEvent.click(await screen.findByRole('option', { name: option })) }
function mutation(name: string) { return calls.filter(call => call.name === name).at(-1)?.variables }

test('RBAC remains agent-bypass capable and denied administrators issue no data queries', () => {
  guard.allowed = false; mount(); assert.ok(screen.getByRole('alert')); assert.equal(calls.length, 0); assert.equal(guard.bypass, true)
})
test('default commission scheme synchronizes URL and table retains all commission/activity financial metrics', async () => {
  mount(); await screen.findByText('Root Partner')
  await screen.findByText('INR 1200')
  assert.ok(screen.getByText('INR 450000')); assert.ok(screen.getByText('2.0%')); assert.ok(screen.getByText('?type=COMMISSION'))
  assert.deepEqual(calls.find(call => call.name === 'AgentsPage')?.variables, { schemeType: 'COMMISSION', directOnly: true, offset: 0, limit: 10 })
})
test('URL precedes persisted selection and changing scheme persists session choice without altering API scheme', async () => {
  window.sessionStorage.setItem('agents-list-scheme-type', 'CREDIT')
  mount('/agents?type=SHARING'); await screen.findByText('INR 250000')
  fireEvent.click(screen.getByRole('radio', { name: /^Commission Agents/ }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentsPage' && call.variables.schemeType === 'COMMISSION')))
  assert.equal(window.sessionStorage.getItem('agents-list-scheme-type'), 'COMMISSION')
})
test('Sharing columns preserve percentage interpretation, P/L, GGR, exposure, open bets and settlement values', async () => {
  mount('/agents?type=SHARING'); await screen.findByText('INR 250000')
  for (const text of ['40.00%', '30.00%', '20.00%', 'INR 110000', 'INR 14000', 'INR -8000', 'INR 2500', 'INR 4000', 'INR 21000']) assert.ok(screen.getByText(text))
  // The list's SHARING pending is signed (positive = TO_AGENT): shown as its size with who pays.
  assert.ok(screen.getByText('Pay to agent'))
  assert.ok(screen.getByText('12 open bets')); assert.ok(screen.getByRole('button', { name: 'Settle Now' }))
})
test('Settle Now settles from the agent\'s pending row: its amount, direction and window end (periodTo)', async () => {
  mount('/agents?type=SHARING'); await screen.findByText('INR 250000')
  fireEvent.click(screen.getByRole('button', { name: 'Settle Now' }))
  const dialog = await screen.findByRole('dialog', { name: 'Settle with: Root Partner' })
  await waitFor(() => assert.deepEqual(calls.find(call => call.name === 'PendingSettlements')?.variables, { schemeType: 'SHARING' }))
  assert.equal((within(dialog).getByRole('textbox', { name: 'Settlement Amount' }) as HTMLInputElement).value, '3,500'); assert.ok(within(dialog).getByText('Pay TO Agent (You pay agent)')); assert.ok(within(dialog).getByText('Agent share +INR 3500'))
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Notes/ }), { target: { value: '  Weekly settlement  ' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Review Details' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Settlement' }))
  await waitFor(() => assert.deepEqual(mutation('SettleAgent'), { input: { agentId: 'root1', settlementType: 'P_L', amount: 3500, direction: 'TO_AGENT', notes: 'Weekly settlement', periodTo: '2026-10-09T10:00:00.000Z' } }))
})
test('CREDIT rows retain credit limit/used/available and show compatible credit adjustment modal', async () => {
  mount('/agents?type=CREDIT'); await screen.findByText('Root Partner')
  await screen.findByText('INR 7000'); assert.ok(screen.getByText('INR 10000')); assert.ok(screen.getByText('INR 3000'))
  // A pending balance puts Settle Now in front; Set Credit is in the row menu.
  assert.ok(screen.getByRole('button', { name: 'Settle Now' }))
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Root Partner' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Set Credit' }))
  assert.ok(screen.getByRole('dialog', { name: 'Adjust Credit' }))
  assert.equal((screen.getByRole('textbox', { name: 'New Credit Limit' }) as HTMLInputElement).value, '10,000')
})
test('paging retains limit/offset and current-page export preserves total count', async () => {
  mount(); await screen.findByText('INR 1200')
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentsPage' && call.variables.offset === 10 && call.variables.limit === 10)))
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
  await waitFor(() => assert.equal(feedback.exporting.mock.calls.length, 1))
  assert.equal(feedback.exporting.mock.calls[0][0].length, 1); assert.equal(feedback.exporting.mock.calls[0][1], 21)
})
test('parent filter remains scheme-scoped and querying child preserves directOnly and resets page', async () => {
  mount('/agents?type=SHARING'); await screen.findByText('INR 250000')
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentsForSelector')))
  await choose('Parent agent', 'Root Partner')
  await screen.findByText('Child Partner')
  const latest = calls.filter(call => call.name === 'AgentsPage').at(-1)?.variables
  assert.deepEqual(latest, { schemeType: 'SHARING', parentAgentId: 'root1', offset: 0, limit: 10 })
})
test('agent scope is fixed to own scheme and ID, and level-four credit agents cannot create further children', async () => {
  useAuthStore.setState({ agent: { id: 'logged', username: 'Logged partner', tenantId: 'preview', phone: null, schemeType: 'CREDIT', allowedDomains: [], status: 'ACTIVE', parentAgentId: null, levelIndex: 4, tallyEnabled: false, tallyDomains: [], createdAt: '2026-09-22' } })
  mount('/agents?type=COMMISSION'); await screen.findByText('Child Partner')
  assert.equal(screen.queryByRole('group', { name: 'Agent scheme' }), null)
  assert.equal(screen.queryByRole('link', { name: 'Add Agent' }), null)
  assert.equal(screen.queryByRole('button', { name: 'Settle Now' }), null)
  assert.deepEqual(calls.find(call => call.name === 'AgentsPage')?.variables, { schemeType: 'CREDIT', parentAgentId: 'logged', offset: 0, limit: 10 })
})
test('tree expansion loads children in small batches and reuses collapsed branches', async () => {
  mount('/agents?type=SHARING'); await screen.findByText('INR 250000')
  fireEvent.click(screen.getByRole('tab', { name: 'Tree' }))
  fireEvent.click(screen.getByRole('button', { name: 'Expand Root Partner' }))
  await screen.findByText('Child Partner')
  assert.ok(calls.some(call => call.name === 'AgentsPage' && call.variables.parentAgentId === 'root1' && call.variables.limit === 20 && call.variables.offset === 0))
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Root Partner' })); fireEvent.click(screen.getByRole('button', { name: 'Expand Root Partner' }))
  assert.equal(calls.filter(call => call.name === 'AgentsPage' && call.variables.parentAgentId === 'root1' && call.variables.limit === 20).length, 1)
})
test('tree pagination reaches the next root page and status changes clear old expanded branches', async () => {
  mount('/agents?type=SHARING'); await screen.findByText('INR 250000')
  fireEvent.click(screen.getByRole('tab', { name: 'Tree' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentsPage' && call.variables.offset === 10 && call.variables.limit === 10)))
  const expand = await screen.findByRole('button', { name: 'Expand Root Partner' })
  fireEvent.click(expand)
  await screen.findByText('Child Partner')
  await choose('Status', 'Suspended')
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentsPage' && call.variables.status === 'SUSPENDED' && call.variables.offset === 0)))
  await screen.findByRole('button', { name: 'Expand Root Partner' })
  assert.equal(screen.queryByText('Child Partner'), null)
  assert.equal(screen.getByRole('tab', { name: 'Tree' }).getAttribute('aria-selected'), 'true')
})
test('the row menu changes status with the current one checked, and choosing it again changes nothing', async () => {
  mount(); await screen.findByText('Root Partner')
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Root Partner' }))
  assert.equal(screen.getByRole('menuitemradio', { name: 'Active' }).getAttribute('aria-checked'), 'true')
  assert.equal(screen.queryByRole('menuitemradio', { name: 'Blocked' }), null)
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Active' }))
  assert.equal(mutation('UpdateAgentStatus'), undefined)
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Root Partner' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Suspended' }))
  await waitFor(() => assert.deepEqual(mutation('UpdateAgentStatus'), { agentId: 'root1', status: 'SUSPENDED' }))
})
test('commission stats cards add network money up once: a sub-agent turnover stays inside its parent', async () => {
  mount(); const stats = await screen.findByRole('group', { name: 'Agent statistics' })
  await within(stats).findByText('INR 900000')
  for (const text of [
    'Commission Agents', '2', '1 active · 0 inactive · 1 suspended',
    'Network Levels', '1 · 1 · 0 · 0', 'Super Master 1, Master 1, Agent 0, Sub Agent 0', 'Super Master to Sub Agent',
    // Earned is each agent's own share, so it adds up over every agent: 2500 + 500.
    'Turnover', 'Commission Earned', 'INR 3000',
  ]) assert.ok(within(stats).getByText(text), text)
  assert.equal(within(stats).getAllByText('All commission agents').length, 2)
  assert.ok(calls.some(call => call.name === 'AgentSchemeTotals' && call.variables.schemeType === 'COMMISSION'))
})
test('credit stats cards come from top-level agent records and ask for no stats', async () => {
  mount('/agents?type=CREDIT'); const stats = await screen.findByRole('group', { name: 'Agent statistics' })
  await within(stats).findByText('INR 420000')
  for (const text of [
    'Credit Agents', '1 active · 0 inactive · 1 suspended', 'Credit Used', '84% of INR 500000 limit',
    'Pending Settlement', 'INR 6500', '1 agent to settle', 'Near Credit Limit', 'Agents above 80% used',
  ]) assert.ok(within(stats).getByText(text), text)
  assert.equal(calls.some(call => call.name === 'AgentSchemeTotals'), false)
})
test('sharing stats cards show network P/L and the top-level pending size', async () => {
  mount('/agents?type=SHARING'); const stats = await screen.findByRole('group', { name: 'Agent statistics' })
  await within(stats).findByText('INR 64000')
  for (const text of ['Sharing Agents', 'Network Levels', 'P/L', 'All sharing agents', 'Pending Settlement', 'INR 7000', '1 agent to settle']) assert.ok(within(stats).getByText(text), text)
})
// There is no Quick View drawer: a row's menu and a tree row both go to the agent's profile page.
test('the row menu has no Quick View, and View Profile opens the agent profile', async () => {
  mount('/agents?type=CREDIT'); await screen.findByText('INR 7000')
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Root Partner' }))
  assert.equal(screen.queryByRole('menuitem', { name: 'Quick View' }), null)
  fireEvent.click(screen.getByRole('menuitem', { name: 'View Profile' }))
  await screen.findByText('Agent profile page')
})
test('tree rows have no Details button, and View opens the agent profile', async () => {
  mount('/agents?type=CREDIT'); await screen.findByText('INR 7000')
  fireEvent.click(screen.getByRole('tab', { name: 'Tree' }))
  const view = await screen.findByRole('link', { name: 'View profile Root Partner' })
  assert.equal(screen.queryByRole('button', { name: /^Details/ }), null)
  fireEvent.click(view)
  await screen.findByText('Agent profile page')
})
test('commission payout picks a closed unpaid week and pays its fixed readiness amount for that week\'s IST dates, with untrimmed notes', async () => {
  mount(); await screen.findByText('INR 1200')
  fireEvent.click(screen.getByRole('button', { name: 'Pay Commission' }))
  const dialog = screen.getByRole('dialog', { name: 'Pay commission — Root Partner' })
  // No free-form amount or period: only the closed, unpaid week is offered, and the amount is the readiness payable.
  const picker = await within(dialog).findByRole('combobox', { name: 'Unpaid cycle' }) as HTMLSelectElement
  assert.deepEqual([...picker.options].map(option => option.textContent), ['28 Sep – 04 Oct 2026 · payable INR 1200'])
  assert.equal(within(dialog).queryByRole('textbox', { name: 'Amount' }), null); assert.equal(within(dialog).queryByRole('textbox', { name: 'Period From' }), null)
  await waitFor(() => assert.deepEqual(calls.find(call => call.name === 'CommissionCycleReadiness')?.variables, { agentId: 'root1', cycleFrom: '2026-09-28', cycleTo: '2026-10-05' }))
  const pay = within(dialog).getByRole('button', { name: 'Pay this cycle' }) as HTMLButtonElement; await waitFor(() => assert.equal(pay.disabled, false))
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Notes' }), { target: { value: '  April commission  ' } })
  fireEvent.click(pay)
  await waitFor(() => assert.deepEqual(mutation('PayCommission'), { input: { agentId: 'root1', amount: 1200, periodFrom: '2026-09-28', periodTo: '2026-10-05', notes: '  April commission  ' } }))
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
})
test('whitelabel admins cannot initiate commission payments, and failed payments preserve the draft', async () => {
  useAuthStore.setState({ roles: ['Whitelabel Admin'] }); mount(); await screen.findByText('INR 1200'); assert.equal(screen.queryByRole('button', { name: 'Pay Commission' }), null)
  cleanup(); useAuthStore.setState({ roles: [] }); state.refused = true; mount(); await screen.findByText('INR 1200')
  fireEvent.click(screen.getByRole('button', { name: 'Pay Commission' }))
  const pay = await within(screen.getByRole('dialog')).findByRole('button', { name: 'Pay this cycle' }) as HTMLButtonElement; await waitFor(() => assert.equal(pay.disabled, false))
  fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'Keep payout draft' } })
  fireEvent.click(pay)
  await waitFor(() => assert.ok(feedback.error.mock.calls.some(([text]) => text === 'Payment refused')))
  assert.ok(screen.getByRole('dialog')); assert.equal((screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement).value, 'Keep payout draft')
})
test('a search looks through every level (no root-only filter), so a sub-agent is found by name', async () => {
  mount(); await screen.findByText('Root Partner')
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search agents' }), { target: { value: 'child' } })
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentsPage' && call.variables.query === 'child')))
  const searched = calls.filter(call => call.name === 'AgentsPage' && call.variables.query === 'child').at(-1)?.variables
  assert.equal('directOnly' in (searched ?? {}), false)
})
test('admins and agents reach Edit Agent from a row; an agent edits its sub-agents only', async () => {
  mount(); await screen.findByText('Root Partner')
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Root Partner' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Agent' }))
  await screen.findByText('Edit agent page')
  cleanup()
  useAuthStore.setState({ agent: { id: 'logged', username: 'Logged partner', tenantId: 'preview', phone: null, schemeType: 'CREDIT', allowedDomains: [], status: 'ACTIVE', parentAgentId: null, levelIndex: 1, tallyEnabled: false, tallyDomains: [], createdAt: '2026-09-22' } })
  mount('/agents?type=CREDIT'); await screen.findByText('Child Partner')
  // The rows are its sub-agents; it edits them, and its own row never appears here.
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Child Partner' }))
  assert.ok(screen.getByRole('menuitem', { name: 'Edit Agent' }))
  assert.equal(screen.queryByRole('button', { name: 'More actions for Logged partner' }), null)
})
