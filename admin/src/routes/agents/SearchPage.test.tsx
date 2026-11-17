import { beforeEach, afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable, type FetchResult, type Operation } from '@apollo/client'
import { Link, MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/shared/core/authStore'
import { chipAccountFixture, chipPoolFixture } from '@/modules/chips/chipTestKit'
import AgentsSearchPage from './SearchPage'
import { agentsSearchResponse, type AgentsSearchFixtureState } from '../../../test/agentsSearchPreviewData'

const guard = vi.hoisted(() => ({ allowed: true, bypass: false }))
const feedback = vi.hoisted(() => ({ toast: vi.fn(), success: vi.fn(), error: vi.fn(), exporting: vi.fn() }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children, bypassForAgents }: { children: ReactNode; bypassForAgents?: boolean }) => { guard.bypass = !!bypassForAgents; return guard.allowed ? children : <div role="alert">Access denied</div> } }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (amount: number) => `INR ${amount}`, getCurrencySymbol: () => '₹', convertFromWhitelabelCurrency: (amount: number) => amount }) }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: feedback.success, error: feedback.error } }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
// The export's reads stay real (loadAgentsForExport, through this test's Apollo link); only the workbook is faked.
vi.mock('./utils/exportAgents', async (importOriginal) => ({ ...(await importOriginal<typeof import('./utils/exportAgents')>()), exportAgentsToExcel: feedback.exporting }))

let calls: Array<{ name: string; variables: Record<string, unknown> }>
let state: AgentsSearchFixtureState
// CREDIT agents' chips (spec 2026-11-02 §7 AgentAccount.chips): the root agent and its sub-agent on the list,
// and the network totals' top-level agent and its sub-agent. The list's other reads come from the preview data.
const ROOT_CHIPS = chipAccountFixture({ id: 'root1', username: 'Root Partner', parentAgentId: null, creditReference: 50000, balance: 42000, available: 42000, downlineBalance: 6000, refPnl: -2000, downlineCount: 1 })
const CHILD_CHIPS = chipAccountFixture({ id: 'child1', username: 'Child Partner', parentAgentId: 'root1', creditReference: 5000, balance: 6500, available: 6500, refPnl: 1500 })
const totalsItem = (id: string, parentAgentId: string | null, chips: Record<string, number>) => ({ __typename: 'AgentAccount', id, parentAgentId, chips: { __typename: 'ChipAccount', id, currency: 'INR', creditReference: 0, balance: 0, exposure: 0, downlineBalance: 0, refPnl: 0, ...chips } })
function chipsResponse(operation: Operation): FetchResult | null {
  const agents = (value: Record<string, unknown>) => ({ data: { agents: { __typename: 'AgentsQuery', ...value } } })
  switch (operation.operationName) {
    case 'AgentsChips': {
      const child = Boolean(operation.variables.parentAgentId)
      return agents({ agentsPage: { __typename: 'AgentsPageResult', items: [{ __typename: 'AgentAccount', id: child ? 'child1' : 'root1', chips: child ? CHILD_CHIPS : ROOT_CHIPS }] } })
    }
    case 'AgentChipTotals': return agents({ agentsPage: { __typename: 'AgentsPageResult', items: [
      totalsItem('creditroot', null, { balance: 30000, downlineBalance: 5000, exposure: 700, creditReference: 40000, refPnl: -5000 }),
      // Inside its parent's downline balance and Ref P/L already: not added again.
      totalsItem('creditchild', 'creditroot', { balance: 5000, exposure: 300, creditReference: 1000, refPnl: 4000 }),
    ] } })
    case 'ChipAccount': return agents({ chipAccount: operation.variables.accountId === 'child1' ? CHILD_CHIPS : ROOT_CHIPS })
    case 'ChipPool': return agents({ chipPool: chipPoolFixture() })
    default: return null
  }
}
const signInChipsAdmin = () => useAuthStore.setState({ agent: undefined, user: { id: 'admin-1', name: 'Admin' }, permissions: [{ domain: 'agents.credit', actions: ['update'] }] })
function LocationProbe() { const location = useLocation(); return <output>{location.search}</output> }
function mount(path = '/agents', extra?: ReactNode) {
  const client = new ApolloClient({ cache: new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } }), link: new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    const timer = setTimeout(() => {
      if (state.queryError && operation.operationName === 'AgentsPage') { observer.error(new Error('Agents unavailable')); return }
      try { observer.next(chipsResponse(operation) ?? agentsSearchResponse(operation, state)); observer.complete() } catch (error) { observer.error(error) }
    }, 1)
    return () => clearTimeout(timer)
  })) })
  render(<ApolloProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/agents" element={<><AgentsSearchPage /><LocationProbe />{extra}</>} /><Route path="/agents/create" element={<div>Create Agent</div>} /><Route path="/agents/:id/edit" element={<div>Edit agent page</div>} /><Route path="/agents/:id" element={<div>Agent profile page</div>} /></Routes></MemoryRouter></ApolloProvider>)
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
test('a link with ?search= (the global search "See all Agents") opens the list already filtered by the term', async () => {
  mount('/agents?search=Root'); await screen.findByText('Root Partner')
  assert.equal((screen.getByRole('searchbox', { name: 'Search agents' }) as HTMLInputElement).value, 'Root')
  // The first list request already carries it (a search spans every level, so not direct-only).
  assert.deepEqual(calls.find(call => call.name === 'AgentsPage')?.variables, { schemeType: 'COMMISSION', query: 'Root', offset: 0, limit: 10 })
  // Syncing the scheme into the URL on open clears neither the box nor the URL's term, so a refresh or Back
  // restores the search (it used to replace the whole query string with ?type=).
  await waitFor(() => assert.ok(screen.queryByText('?search=Root&type=COMMISSION') !== null, 'the URL keeps ?search= beside ?type='))
  assert.equal((screen.getByRole('searchbox', { name: 'Search agents' }) as HTMLInputElement).value, 'Root')
})
test('a refresh of the synced URL opens the same search', async () => {
  mount('/agents?search=Root&type=COMMISSION'); await screen.findByText('Root Partner')
  assert.equal((screen.getByRole('searchbox', { name: 'Search agents' }) as HTMLInputElement).value, 'Root')
  assert.deepEqual(calls.find(call => call.name === 'AgentsPage')?.variables, { schemeType: 'COMMISSION', query: 'Root', offset: 0, limit: 10 })
  assert.ok(screen.getByText('?search=Root&type=COMMISSION'))
})
/* B005: the global search's See all Agents now names the scheme of its matches (?type=). The topbar search is open on
   this page too, and the list, still mounted, kept the scheme it opened with while the URL named another. */
test('a later link that names a scheme switches the mounted list to it, with its term', async () => {
  mount('/agents?type=COMMISSION', <Link to="/agents?search=Root&type=SHARING">Test: See all Agents</Link>)
  await screen.findByText('Root Partner')
  fireEvent.click(screen.getByRole('link', { name: 'Test: See all Agents' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentsPage' && call.variables.schemeType === 'SHARING' && call.variables.query === 'Root'), 'the list was not read for SHARING with the term'))
  await screen.findByText('INR 250000')
  assert.equal((screen.getByRole('radio', { name: /^Sharing Agents/ }) as HTMLInputElement).checked, true)
  assert.equal((screen.getByRole('searchbox', { name: 'Search agents' }) as HTMLInputElement).value, 'Root')
  assert.equal(window.sessionStorage.getItem('agents-list-scheme-type'), null, 'a link is not a choice to remember')
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
test('CREDIT rows show chips and Ref P/L instead of credit used, with D / W / CR in front and no settlement', async () => {
  signInChipsAdmin(); mount('/agents?type=CREDIT')
  const row = (await screen.findByText('INR 42000')).closest('tr')!
  const table = screen.getByRole('table', { name: 'Agents list' })
  const headers = within(table).getAllByRole('columnheader').map(cell => cell.textContent)
  for (const header of ['Chips', 'Ref P/L', 'Performance']) assert.ok(headers.includes(header), header)
  for (const header of ['Credit used', 'Pending settlement']) assert.equal(headers.includes(header), false, header)
  assert.ok(within(row).getByText('INR 6000'), 'downline balance')
  const refPnl = within(row).getByText('−INR 2000'); assert.ok(refPnl.className.includes('loss'))
  assert.ok(within(row).getByText('Owes upline')); assert.ok(within(row).getByText('INR 50000'), 'credit reference')
  for (const gone of ['INR 7000', 'INR 3000', 'No credit limit', 'High use']) assert.equal(screen.queryByText(gone), null, gone)
  // The admin is the root agent's direct parent: D / W / CR in front; a CREDIT agent is never settled from the list.
  assert.ok(within(row).getByRole('button', { name: 'Deposit chips to Root Partner' }))
  assert.ok(within(row).getByRole('button', { name: 'Withdraw chips from Root Partner' }))
  assert.ok(within(row).getByRole('button', { name: 'Set credit reference for Root Partner' }))
  assert.equal(screen.queryByRole('button', { name: 'Settle Now' }), null)
  // The chips read mirrors the list's filters and page.
  const page = calls.find(call => call.name === 'AgentsPage')?.variables
  assert.deepEqual(calls.find(call => call.name === 'AgentsChips')?.variables, page)
})
test('the row menu offers Deposit / Withdraw / Credit reference to the direct parent, never Set Credit', async () => {
  signInChipsAdmin(); mount('/agents?type=CREDIT'); await screen.findByText('INR 42000')
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Root Partner' }))
  assert.equal(screen.queryByRole('menuitem', { name: 'Set Credit' }), null)
  assert.ok(screen.getByRole('menuitem', { name: 'Withdraw chips' })); assert.ok(screen.getByRole('menuitem', { name: 'Set credit reference' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Deposit chips' }))
  assert.ok(await screen.findByRole('dialog', { name: 'Deposit chips' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'ChipAccount' && call.variables.accountId === 'root1')))
})
test('without agents.credit:update an admin sees the chips but gets View, not D / W / CR', async () => {
  mount('/agents?type=CREDIT'); const row = (await screen.findByText('INR 42000')).closest('tr')!
  assert.equal(within(row).queryByRole('button', { name: /Deposit chips/ }), null)
  assert.ok(within(row).getByRole('link', { name: 'View profile Root Partner' }))
})
test('paging retains limit/offset, and Export reads every agent of the filter from the first row, not the page on screen', async () => {
  mount(); await screen.findByText('INR 1200')
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentsPage' && call.variables.offset === 10 && call.variables.limit === 10)))
  calls = []
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
  await waitFor(() => assert.equal(feedback.exporting.mock.calls.length, 1))
  // AGE-08: the sheet said "21 agents" over the 10 rows of the page shown. Now the export reads from offset 0 in
  // pages of 100 (the preview data answers one row whatever the page), with the stats the rows show.
  for (const name of ['AgentsPage', 'AgentsStats']) assert.deepEqual(calls.find(call => call.name === name)?.variables, { schemeType: 'COMMISSION', directOnly: true, offset: 0, limit: 100 }, name)
  const [rows, total] = feedback.exporting.mock.calls[0]
  assert.equal(total, 21); assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'root1'); assert.equal(rows[0].stats?.totalDeposits, 250000, 'the row carries its stats')
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
test('credit stats cards add up the top-level agents\' chips and ask for no stats', async () => {
  mount('/agents?type=CREDIT'); const stats = await screen.findByRole('group', { name: 'Agent statistics' })
  // Chips with the network: the top-level agent's balance plus its downline's (30000 + 5000); its sub-agent is inside.
  await within(stats).findByText('INR 35000')
  for (const text of [
    'Credit Agents', '1 active · 0 inactive · 1 suspended', 'Chips', 'With agents and their players',
    'Exposure', 'INR 700', 'Ref P/L', '−INR 5000', 'Owes upline · credit ref INR 40000',
  ]) assert.ok(within(stats).getByText(text), text)
  for (const gone of ['Credit Used', 'Pending Settlement', 'Near Credit Limit']) assert.equal(within(stats).queryByText(gone), null, gone)
  assert.equal(calls.some(call => call.name === 'AgentSchemeTotals'), false)
  assert.equal(calls.filter(call => call.name === 'AgentChipTotals').length, 1)
})
test('sharing stats cards show network P/L and the top-level pending size', async () => {
  mount('/agents?type=SHARING'); const stats = await screen.findByRole('group', { name: 'Agent statistics' })
  await within(stats).findByText('INR 64000')
  for (const text of ['Sharing Agents', 'Network Levels', 'P/L', 'All sharing agents', 'Pending Settlement', 'INR 7000', '1 agent to settle']) assert.ok(within(stats).getByText(text), text)
})
// There is no Quick View drawer: a row's menu and a tree row both go to the agent's profile page.
test('the row menu has no Quick View, and View Profile opens the agent profile', async () => {
  mount('/agents?type=CREDIT'); await screen.findByText('INR 42000')
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Root Partner' }))
  assert.equal(screen.queryByRole('menuitem', { name: 'Quick View' }), null)
  fireEvent.click(screen.getByRole('menuitem', { name: 'View Profile' }))
  await screen.findByText('Agent profile page')
})
test('tree rows have no Details button, and View opens the agent profile', async () => {
  mount('/agents?type=CREDIT'); await screen.findByText('INR 42000')
  fireEvent.click(screen.getByRole('tab', { name: 'Tree' }))
  const view = await screen.findByRole('link', { name: 'View profile Root Partner' })
  assert.equal(screen.queryByRole('button', { name: /^Details/ }), null)
  fireEvent.click(view)
  await screen.findByText('Agent profile page')
})
test('the CREDIT tree shows each level\'s chips: a branch reads its own beside its page', async () => {
  signInChipsAdmin(); mount('/agents?type=CREDIT'); await screen.findByText('INR 42000')
  fireEvent.click(screen.getByRole('tab', { name: 'Tree' }))
  // The root row: balance and Ref P/L in colour, and D / W / CR for its direct parent (the admin).
  assert.ok(await screen.findByText('−INR 2000'))
  assert.ok(screen.getByRole('button', { name: 'Deposit chips to Root Partner' }))
  fireEvent.click(screen.getByRole('button', { name: 'Expand Root Partner' }))
  const branch = await screen.findByRole('list', { name: 'Sub-agents of Root Partner' })
  assert.ok(await within(branch).findByText('+INR 1500'))
  assert.ok(within(branch).getByText('INR 6500'))
  // The admin is not the sub-agent's parent: no D / W / CR on it.
  assert.equal(within(branch).queryByRole('button', { name: /Deposit chips/ }), null)
  assert.ok(calls.some(call => call.name === 'AgentsChips' && call.variables.parentAgentId === 'root1' && call.variables.limit === 20 && call.variables.offset === 0))
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
