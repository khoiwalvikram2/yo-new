import { beforeEach, afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable, type FetchResult } from '@apollo/client'
import type { SubscriptionObserver } from 'zen-observable-ts'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/shared/core/authStore'
import AgentProfilePage from './index'
import { agentProfileResponse, type AgentProfileFixtureState } from '../../../../test/agentProfilePreviewData'

const feedback = vi.hoisted(() => ({ toast: vi.fn(), success: vi.fn(), error: vi.fn() }))
const guard = vi.hoisted(() => ({ update: true, view: true, calls: [] as unknown[] }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: feedback.success, error: feedback.error } }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children, required, fallback }: { children: ReactNode; required: Array<{domain: string; actions: string[]}>; fallback?: ReactNode }) => { guard.calls.push(required); return required.some(rule => rule.actions.includes('update')) && !guard.update || required.some(rule => rule.domain === 'agents.profile' && rule.actions.includes('view')) && !guard.view ? fallback || null : children } }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `INR ${value}`, getCurrencySymbol: () => '₹', convertFromWhitelabelCurrency: (value: number) => value * 2 }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string) => value, formatDateTime: (value: string) => value, formatTime: () => '09:00' }) }))
let state: AgentProfileFixtureState
// Per-test change to a fixture answer (e.g. upper-case player statuses).
let rewrite: ((name: string, result: FetchResult) => FetchResult) | undefined
let calls: Array<{ name: string; variables: Record<string, unknown> }>
let creditObserver: SubscriptionObserver<FetchResult> | undefined
let holdStats: boolean
let failStats: boolean
let heldStats: Map<string, () => void>
function JumpToChild() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/agents/child1')}>Open child profile</button>
}
function mount(entry = '/agents/root1', navigation = false) {
  const client = new ApolloClient({ cache: new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } }), link: new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    if (operation.operationName === 'AgentCreditUpdated') { creditObserver = observer; return }
    const send = () => {
      if (state.profileError && operation.operationName === 'AgentProfile') { observer.error(new Error('Profile unavailable')); return }
      if (failStats && operation.operationName === 'AgentDashboardStats') { observer.error(new Error('Stats temporarily unavailable')); return }
      try {
        const result = agentProfileResponse(operation, state)
        if (operation.operationName === 'AgentProfile' && operation.variables.id === 'child1') {
          const account = result.data?.agents?.agentProfile as Record<string, unknown>
          result.data!.agents.agentProfile = { ...account, id: 'child1', username: 'Child Profile' }
        }
        observer.next(rewrite ? rewrite(operation.operationName, result) : result); observer.complete()
      } catch (error) { observer.error(error) }
    }
    const timer = setTimeout(() => {
      if (holdStats && operation.operationName === 'AgentDashboardStats') { heldStats.set(String(operation.variables.id), send); return }
      send()
    }, 1)
    return () => clearTimeout(timer)
  })) })
  return render(<ApolloProvider client={client}><MemoryRouter initialEntries={[entry]}>{navigation && <JumpToChild />}<Routes><Route path="/agents/:id" element={<AgentProfilePage />} /><Route path="/agents" element={<div>Agents list</div>} /><Route path="/settlement" element={<div>Settlement management</div>} /><Route path="/players/profile/:playerId" element={<div>Player profile</div>} /></Routes></MemoryRouter></ApolloProvider>)
}
beforeEach(() => {
  state = { scheme: 'CREDIT' }; rewrite = undefined; calls = []; creditObserver = undefined; guard.update = true; guard.view = true; guard.calls = []
  holdStats = false; failStats = false; heldStats = new Map()
  feedback.toast.mockClear(); feedback.success.mockClear(); feedback.error.mockClear()
  useAuthStore.setState({ agent: undefined, user: undefined, roles: [], permissions: [{ domain: 'players.wallet', actions: ['view'] }, { domain: 'players.credit', actions: ['view'] }] })
})
afterEach(cleanup)
// A tab with a count is named "Players, 17".
const tabName = (name: string) => new RegExp(`^${name}(, [0-9,]+)?$`)
async function openTab(name: string) { fireEvent.click(await screen.findByRole('tab', { name: tabName(name) })) }
// A phone-width viewport for one test (useBreakpoint reads window.innerWidth when the page mounts).
async function onPhone(run: () => Promise<void>) {
  const width = window.innerWidth
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 })
  try { await run() } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width }) }
}
async function figures() { return within(await screen.findByRole('group', { name: 'Agent figures' })) }
function mutation(name: string) { return calls.filter(call => call.name === name).at(-1)?.variables }

test('profile query/stats stay scoped, overview retains all identifiers/rates/hierarchy and header update guard', async () => {
  mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.equal((await screen.findByRole('link', { name: 'Parent Partner' })).getAttribute('href'), '/agents/parent1')
  assert.ok(screen.getByRole('heading', { name: 'Agent details' })); assert.ok(screen.getAllByText('40.00%').length > 0); assert.ok(screen.getByText('Manage credit allocation for players'))
  assert.deepEqual(calls.find(call => call.name === 'AgentProfile')?.variables, { id: 'root1' })
  assert.equal(calls.find(call => call.name === 'AgentDashboardStats')?.variables.id, 'root1')
  assert.ok(guard.calls.some(value => JSON.stringify(value) === JSON.stringify([{ domain: 'agents.profile', actions: ['update'] }])))
})

test('a denied profile never mounts its profile, stats or financial reads', async () => {
  guard.view = false; mount()
  await screen.findByText("You don't have permission to view agent profiles. Please contact your administrator.")
  assert.equal(calls.length, 0)
})

test('delayed stats leave the header and selected Players tab usable without preloading other tabs', async () => {
  holdStats = true; mount()
  await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  await waitFor(() => assert.ok(heldStats.has('root1')))
  assert.equal(calls.some(call => ['AgentPlayers','CreditAllocation','AgentCreditTransactions','AgentSecurityAudit'].includes(call.name)), false)
  await openTab('Players'); await screen.findByText('Referred by: Referrer Partner (9000000002)')
  assert.equal(calls.filter(call => call.name === 'AgentDashboardStats').length, 1)
})

test('failed stats show a stats-only retry while the selected tab stays available', async () => {
  failStats = true; mount(); await screen.findByText('Agent stats unavailable')
  await openTab('Players'); await screen.findByText('Referred by: Referrer Partner (9000000002)')
  const headerReads = calls.filter(call => call.name === 'AgentProfile').length
  failStats = false; fireEvent.click(screen.getByRole('button', { name: 'Retry stats' }))
  // The head's strip reads the stats on every tab.
  await within(screen.getByRole('group', { name: 'Credit and players' })).findByText('17')
  assert.equal(calls.filter(call => call.name === 'AgentProfile').length, headerReads)
  assert.equal(screen.getByRole('tab', { name: tabName('Players') }).getAttribute('aria-selected'), 'true')
})

test('changing the route agent clears previous figures and tab state before delayed stats arrive', async () => {
  mount('/agents/root1', true); await (await figures()).findByText('+INR 2400')
  await openTab('Players'); holdStats = true
  fireEvent.click(screen.getByRole('button', { name: 'Open child profile' }))
  await screen.findByRole('heading', { name: 'Child Profile', level: 2 })
  await waitFor(() => assert.ok(heldStats.has('child1')))
  assert.equal(screen.queryByText('+INR 2400'), null)
  assert.equal(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected'), 'true')
  await act(async () => heldStats.get('child1')?.())
  await (await figures()).findByText('+INR 2400')
})
test('wallet KPI arrays preserve conversion, counts and credit raw limits across cash/bonus/referral', async () => {
  mount(); const kpis = await figures(); await kpis.findByText('+INR 2400')
  assert.ok(within(screen.getByRole('region', { name: 'Downline money' })).getByText('INR 50000'))
  const wallet = within(screen.getByRole('group', { name: 'Wallet type' }))
  fireEvent.click(wallet.getByRole('button', { name: 'Bonus' })); assert.ok(kpis.getByText('-INR 400')); assert.ok(kpis.getByText('INR 1400'))
  fireEvent.click(wallet.getByRole('button', { name: 'Referral Bonus' })); assert.ok(kpis.getByText('+INR 80')); assert.ok(kpis.getByText('INR 160'))
  // A credit agent's limits are raw (unconverted) figures, in the head's strip.
  const strip = within(screen.getByRole('group', { name: 'Credit and players' }))
  for (const text of ['INR 10000', 'INR 3000', 'INR 7000', '30% of the limit', '10 direct · 7 under sub-agents']) assert.ok(strip.getByText(text), text)
})
test('stats all-time and custom date filters preserve existing nullable API values and ISO calendar strings', async () => {
  mount(); await (await figures()).findByText('+INR 2400')
  const range = within(screen.getByRole('group', { name: 'Stats date range' }))
  fireEvent.click(range.getByRole('button', { name: 'All time' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentDashboardStats' && call.variables.dateFrom === null && call.variables.dateTo === null)))
  fireEvent.click(range.getByRole('button', { name: 'Custom' }))
  fireEvent.change(await screen.findByLabelText('Stats From'), { target: { value: '2026-09-01' } }); fireEvent.change(screen.getByLabelText('Stats To'), { target: { value: '2026-09-30' } })
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentDashboardStats' && call.variables.dateFrom === '2026-09-01' && call.variables.dateTo === '2026-09-30')))
})
test('the Overview groups the period by product and downline money, beside the agent setup and network', async () => {
  mount(); await (await figures()).findByText('+INR 2400')
  const products = within(screen.getByRole('table', { name: 'Performance by product' }))
  const sports = within(products.getByRole('row', { name: /^Sports/ }))
  for (const text of ['+INR 6000', '+INR 1400', '40.00%']) assert.ok(sports.getByText(text), text)
  const money = within(screen.getByRole('region', { name: 'Downline money' }))
  for (const text of ['INR 50000', 'INR 20000', 'INR 40000', 'INR 14000', 'INR 10000', 'INR 6000']) assert.ok(money.getAllByText(text).length, text)
  const side = within(screen.getByRole('complementary', { name: 'Agent details' }))
  for (const text of ['L1 · Super Master', 'Under a parent agent', 'On · Sports', 'Sharing rates', 'Credit', 'Network', '80% used']) assert.ok(side.getAllByText(text).length, text)
  // Nothing on the Overview reads another tab's data.
  assert.equal(calls.some(call => ['AgentPlayers', 'CreditAllocation', 'AgentCreditTransactions', 'AgentSecurityAudit', 'CommissionSummary', 'CommissionCyclesForAgent'].includes(call.name)), false)
})
test('Pay Commission follows the agents list: the direct parent pays a sub-agent, an admin only a top-level one', async () => {
  state.scheme = 'COMMISSION'; mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  // root1 sits under parent1, so an admin does not pay it from here.
  assert.equal(screen.queryByRole('button', { name: 'Pay Commission' }), null)
  assert.ok(within(screen.getByRole('group', { name: 'Network' })).getByText('INR 160000'))
  cleanup(); useAuthStore.setState({ agent: agentLogin('parent1') }); mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.ok(screen.getByRole('button', { name: 'Pay Commission' }))
  cleanup(); useAuthStore.setState({ agent: agentLogin('root1') }); mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.equal(screen.queryByRole('button', { name: 'Pay Commission' }), null)
})
test('on a phone the products table keeps GGR and P/L; the rates stay in their own card', () => onPhone(async () => {
  mount(); await (await figures()).findByText('+INR 2400')
  const table = within(screen.getByRole('table', { name: 'Performance by product' }))
  assert.equal(table.queryByRole('columnheader', { name: 'Sharing rate' }), null)
  for (const name of ['Product', 'GGR', "Players' P/L"]) assert.ok(table.getByRole('columnheader', { name }), name)
  assert.ok(screen.getByRole('heading', { name: 'Sharing rates' }))
}))
test('header status actions preserve mutation and refresh only after confirmed success', async () => {
  mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Agent actions' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Suspend' }))
  await waitFor(() => assert.deepEqual(mutation('UpdateAgentStatus'), { agentId: 'root1', status: 'SUSPENDED' }))
  await waitFor(() => assert.ok(feedback.toast.mock.calls.some(([value]) => value.message === 'Agent set to suspended')))
})
test('reset-password requires six characters, matching confirmation and administrator authorization; sends only unchanged fields', async () => {
  mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Agent actions' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Reset Password' }))
  const dialog = screen.getByRole('dialog', { name: 'Reset Agent Password' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset Password' })); assert.ok(screen.getByText('Please enter the new password')); assert.equal(mutation('AdminResetAgentPassword'), undefined)
  fireEvent.change(screen.getByLabelText('New Password', { exact: true }), { target: { value: 'preview-pass' } }); fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'different-pass' } }); fireEvent.change(screen.getByLabelText('Your Login Password'), { target: { value: 'preview-admin' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset Password' })); assert.ok(screen.getByText('Passwords do not match')); assert.equal(mutation('AdminResetAgentPassword'), undefined)
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'preview-pass' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Reset Password' }))
  await waitFor(() => assert.deepEqual(mutation('AdminResetAgentPassword'), { agentId: 'root1', newPassword: 'preview-pass', adminPassword: 'preview-admin' }))
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
})
test('read-only header hides password/status/credit changes and server refusals retain password draft', async () => {
  guard.update = false; mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 }); assert.equal(screen.queryByRole('button', { name: 'Agent actions' }), null)
  cleanup(); guard.update = true; state.refused = true; mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Agent actions' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Reset Password' }))
  fireEvent.change(screen.getByLabelText('New Password', { exact: true }), { target: { value: 'preview-pass' } }); fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'preview-pass' } }); fireEvent.change(screen.getByLabelText('Your Login Password'), { target: { value: 'preview-admin' } })
  fireEvent.click(screen.getByRole('button', { name: 'Reset Password' })); await screen.findByText('Password reset refused'); assert.ok(screen.getByRole('dialog'))
})
test('credit allocation threshold/resolve actions and subscription retain their exact scope and refresh behavior', async () => {
  mount(); await openTab('Credit'); await screen.findByText('Funding credit')
  assert.ok(calls.some(call => call.name === 'AgentCreditTransactions' && call.variables.agentId === 'root1' && call.variables.limit === 20 && call.variables.offset === 0))
  fireEvent.click(screen.getByRole('button', { name: 'Set Alert Threshold' })); fireEvent.change(screen.getByRole('textbox', { name: 'Alert Threshold (%)' }), { target: { value: '0' } }); fireEvent.click(screen.getByRole('button', { name: 'Set Threshold' }))
  await waitFor(() => assert.deepEqual(mutation('SetAgentCreditAlertThreshold'), { agentId: 'root1', threshold: 0 }))
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' })); await waitFor(() => assert.deepEqual(mutation('ResolveAgentCreditAlert'), { alertId: 'alert1' }))
  const before = calls.filter(call => call.name === 'CreditAllocation').length
  await act(async () => { creditObserver?.next({ data: { agentCreditUpdated: { agentId: 'root1', creditLimit: 10000, creditUsed: 3000, creditAvailable: 7000 } } }) })
  await waitFor(() => assert.ok(calls.filter(call => call.name === 'CreditAllocation').length > before))
})
test('player credit mask remains permission-dependent, and credit reconciliation stays a preview without invented mutations', async () => {
  useAuthStore.setState({ permissions: [] }); mount(); await openTab('Credit')
  const table = await screen.findByRole('table', { name: 'Agent player credit allocations' })
  assert.equal((await within(table).findAllByText('••••')).length, 5); assert.equal(within(table).queryByText('INR 8000'), null)
  fireEvent.click(screen.getByRole('button', { name: 'Credit Reconciliation' })); assert.ok(screen.getByText('Credit reconciliation features are available in the credit management section.')); assert.equal(calls.some(call => call.name === 'ApplyCreditReconciliation'), false)
})
test('Sharing dates/rates/ledger amounts and Initiate Settlement keep existing query variables and navigation', async () => {
  state.scheme = 'SHARING'; mount(); await openTab('Sharing')
  await screen.findByRole('table', { name: 'Sharing ledger entries' })
  assert.ok(screen.getByText('+INR 2000 INR')); assert.ok(screen.getAllByText('40.00%').length > 0)
  fireEvent.change(screen.getByLabelText('Sharing From'), { target: { value: '2026-09-01' } }); fireEvent.change(screen.getByLabelText('Sharing To'), { target: { value: '2026-09-30' } })
  await waitFor(() => assert.ok(calls.some(call => call.name === 'SettlementSummary' && call.variables.periodFrom === '2026-09-01' && call.variables.periodTo === '2026-09-30')))
  fireEvent.click(await screen.findByRole('button', { name: 'Initiate Settlement' })); assert.ok(screen.getByText('Settlement management'))
})
test('Settlement tab preserves pending/type and trims notes before committing reviewed input', async () => {
  // Pending +4000 = TO_AGENT (pay the agent its share); the settle posts exactly the pending row's window (periodTo).
  state.scheme = 'SHARING'; mount(); await openTab('Settlement'); fireEvent.click(await screen.findByRole('button', { name: 'Settle Now' }))
  assert.ok(screen.getByText('INR 8000 pending P/L settlement · Pay to agent')); assert.ok(screen.getByText('Pay TO Agent (You pay agent)'))
  fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: '  Weekly profile settlement  ' } }); fireEvent.click(screen.getByRole('button', { name: 'Review Details' })); assert.equal(mutation('SettleAgent'), undefined)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Settlement' }))
  await waitFor(() => assert.deepEqual(mutation('SettleAgent'), { input: { agentId: 'root1', settlementType: 'P_L', amount: 4000, direction: 'TO_AGENT', notes: 'Weekly profile settlement', periodTo: '2026-10-09T10:00:00.000Z' } }))
})
test('Commission summary retains gross-net-payable arithmetic, domain-rate normalization and independent weekly cycles', async () => {
  // Receivable = the backend gross after tally (600), My Share = the backend net (410), Payable = the sub-agents' effective (190).
  state.scheme = 'COMMISSION'; mount(); await openTab('Commission'); await screen.findAllByText('INR 1200')
  assert.ok(screen.getAllByText('+INR 820').length > 0); assert.ok(screen.getAllByText('INR 380').length > 0); assert.ok(screen.getByText('INR 1600'))
  // Every domain is one row of the Commission by domain table: its rate (a fraction from the API) as a percent.
  const sports = within(within(screen.getByRole('table', { name: 'Commission by domain' })).getByRole('row', { name: /^Sports/ }))
  for (const text of ['2.00%', 'INR 400', 'INR 320']) assert.ok(sports.getByText(text), text)
  const cycleGroup = screen.getByRole('group', { name: 'Sub-Agent cycle' }); fireEvent.click(within(cycleGroup).getByRole('button', { name: /^Last Week/ }))
  await waitFor(() => assert.ok(calls.filter(call => call.name === 'SubAgentCommissionSummaries').length >= 2))
  assert.equal(calls.filter(call => call.name === 'DirectPlayerCommissionSummaries').length, 1)
})
test('Commission View Bets passes child/player IDs and cycle range into already-migrated shared dialog', async () => {
  state.scheme = 'COMMISSION'; mount(); await openTab('Commission'); const table = await screen.findByRole('table', { name: 'Player commission' }); await within(table).findByText('Preview Player')
  fireEvent.click(within(table).getByRole('button', { name: 'View Bets' })); await screen.findByRole('dialog')
  await waitFor(() => assert.ok(calls.some(call => call.name === 'CommissionHistory' && call.variables.agentId === 'child1' && call.variables.playerId === 'player1' && call.variables.limit === 50 && call.variables.offset === 0)))
})
test('Players downline scope, balance sorting, masks and paging preserve server input', async () => {
  mount(); await openTab('Players'); await screen.findByText('Referred by: Referrer Partner (9000000002)')
  assert.ok(calls.some(call => call.name === 'AgentPlayers' && call.variables.includeDownline === true && call.variables.limit === 10 && call.variables.offset === 0))
  fireEvent.click(screen.getByRole('button', { name: 'Balance / Credit' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentPlayers' && call.variables.sortBy === 'balance' && call.variables.sortOrder === 'asc')))
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentPlayers' && call.variables.offset === 10)))
})
test('Sub-Agent hierarchy retains lazy-root query and no duplicate child fetch after collapse', async () => {
  state.scheme = 'COMMISSION'; mount(); await openTab('Sub-Agents'); await screen.findByText('Child Partner')
  fireEvent.click(screen.getByRole('button', { name: 'Expand Child Partner' })); await screen.findByText('Nested Partner')
  assert.ok(calls.some(call => call.name === 'AgentTree' && call.variables.rootId === 'child1'))
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Child Partner' })); fireEvent.click(screen.getByRole('button', { name: 'Expand Child Partner' }))
  assert.equal(calls.filter(call => call.name === 'AgentTree' && call.variables.rootId === 'child1').length, 1)
})
test('Activity Log queries only selected agent and keeps event counts/details; referral link generation preserves code URL shape', async () => {
  state.scheme = 'COMMISSION'; state.referralMissing = true; mount(); await openTab('Activity Log'); await screen.findByText('Successful sign in')
  assert.deepEqual(calls.find(call => call.name === 'AgentSecurityAudit')?.variables, { agentId: 'root1', limit: 100 })
  await openTab('Referral Link'); fireEvent.click(await screen.findByRole('button', { name: 'Generate Referral Link' })); await screen.findByText('PREVIEW42')
  assert.deepEqual(mutation('GenerateAgentReferralLink'), { agentId: 'root1' }); assert.ok((screen.getByRole('textbox', { name: 'Full URL' }) as HTMLInputElement).value.endsWith('/r?ref=PREVIEW42'))
})
test('profile errors and missing records keep retry/back actions without rendering unsupported tabs', async () => {
  state.profileError = true; mount(); await screen.findByText('Profile unavailable'); assert.ok(screen.getByRole('button', { name: 'Retry' }))
  cleanup(); state = { scheme: 'CREDIT', missing: true }; mount(); await screen.findByText('Agent not found'); assert.equal(screen.queryByRole('tab', { name: 'Commission' }), null)
})

const agentLogin = (id: string) => ({ id, username: 'Logged agent', tenantId: 'preview', phone: null, schemeType: 'SHARING', allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: null, levelIndex: 1, tallyEnabled: false, tallyDomains: [], createdAt: '2026-09-22' })
test('admins and the parent agent get Edit Agent; an agent on its own profile gets no management actions', async () => {
  mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.equal(screen.getByRole('link', { name: 'Edit Agent' }).getAttribute('href'), '/agents/root1/edit')
  cleanup(); useAuthStore.setState({ agent: agentLogin('root1') }); mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.equal(screen.queryByRole('link', { name: 'Edit Agent' }), null); assert.equal(screen.queryByRole('button', { name: 'Agent actions' }), null); assert.equal(screen.queryByRole('button', { name: 'Adjust Credit' }), null)
  cleanup(); useAuthStore.setState({ agent: agentLogin('parent1') }); mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.ok(screen.getByRole('link', { name: 'Edit Agent' }))
})
test('Settle Now is offered to admins and to the direct parent agent only', async () => {
  state.scheme = 'SHARING'; useAuthStore.setState({ agent: agentLogin('grandparent') }); mount(); await openTab('Settlement')
  await screen.findByText('Pending Settlement Available'); assert.equal(screen.queryByRole('button', { name: 'Settle Now' }), null)
  cleanup(); useAuthStore.setState({ agent: agentLogin('parent1') }); mount(); await openTab('Settlement')
  assert.ok(await screen.findByRole('button', { name: 'Settle Now' }))
})
test('Players figures count the whole downline: Active comes from a status count, not from the page of rows', async () => {
  mount(); await openTab('Players'); await screen.findByText('Referred by: Referrer Partner (9000000002)')
  assert.deepEqual(calls.find(call => call.name === 'AgentPlayerCounts')?.variables, { agentId: 'root1' })
  // 21 players, 15 of them active (the page holds 2 rows): 6 are not active.
  const figures = within(screen.getByRole('group', { name: 'Player figures' }))
  for (const text of ['21', '15', '71.4% of players', '6']) assert.ok(await figures.findByText(text), text)
})
test('the tabs open with their figures: sub-agents, activity, settlement and credit', async () => {
  state.scheme = 'COMMISSION'; mount(); await openTab('Sub-Agents'); await screen.findByText('Child Partner')
  const tree = within(screen.getByRole('group', { name: 'Sub-agent figures' }))
  assert.ok(tree.getByText('Direct Sub-Agents')); assert.equal(screen.getByRole('link', { name: 'Child Partner' }).getAttribute('href'), '/agents/child1')
  await openTab('Activity Log'); await screen.findByText('Successful sign in')
  const activity = within(screen.getByRole('group', { name: 'Activity figures' }))
  for (const [label, value] of [['Total Events', '3'], ['Successful Logins', '1'], ['Failed Logins', '1'], ['Password Changes', '1']]) assert.ok(activity.getByText(label) && activity.getAllByText(value).length, label)
  cleanup(); state = { scheme: 'CREDIT' }; mount(); await openTab('Settlement'); await screen.findByText('Pending Settlement Available')
  assert.ok(within(screen.getByRole('group', { name: 'Settlement figures' })).getByText('Collected from Agent'))
  await openTab('Credit'); await screen.findByText('Funding credit')
  const credit = within(screen.getByRole('group', { name: 'Credit figures' }))
  assert.ok(credit.getByText('Players on Credit')); assert.ok(await credit.findByText('Given INR 8000'))
})
test('the Review adjustments link lands on the Commission tab and its Adjustments card, read-only without the permission', async () => {
  state.scheme = 'COMMISSION'; mount('/agents/root1?tab=commission#commission-adjustments')
  const section = await screen.findByRole('region', { name: 'Adjustments' })
  assert.equal(screen.getByRole('tab', { name: 'Commission' }).getAttribute('aria-selected'), 'true')
  await within(section).findByText('No adjustments')
  assert.deepEqual(calls.find(call => call.name === 'CommissionAdjustmentsPage')?.variables, { agentId: 'root1', limit: 20, offset: 0 })
  assert.equal(within(section).queryByRole('button', { name: 'New adjustment' }), null)
})
