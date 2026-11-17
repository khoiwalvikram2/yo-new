import { beforeEach, afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable, type FetchResult } from '@apollo/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/shared/core/authStore'
import { chipAccountFixture, chipRowFixture, chipTotalsFixture } from '@/modules/chips/chipTestKit'
import AgentProfilePage from './index'
import { agentProfileResponse, type AgentProfileFixtureState } from '../../../../test/agentProfilePreviewData'

// The CREDIT agent's chips (spec 2026-11-02 §7), answered here: the profile fixture predates the chips API.
const ROOT_CHIPS = chipAccountFixture({ id: 'root1', username: 'Root Partner', parentAgentId: 'parent1', creditReference: 100000, balance: 95000, exposure: 1200, available: 95000, downlineBalance: 8000, refPnl: 3000, downlineCount: 2 })
const PARENT_CHIPS = chipAccountFixture({ id: 'parent1', username: 'Parent Partner', parentAgentId: null, creditReference: 500000, balance: 300000, available: 300000, downlineBalance: 103000, refPnl: -97000, downlineCount: 1 })
const CHILD_CHIPS = chipAccountFixture({ id: 'child1', username: 'Child Partner', parentAgentId: 'root1', creditReference: 5000, balance: 4000, available: 4000, refPnl: -1000 })
const PLAYER_CHIPS = chipAccountFixture({ accountType: 'PLAYER', id: 'player2', username: 'credit_player', parentAgentId: 'root1', playerType: 'AGENT_CREDIT', creditReference: 4000, balance: 4500, exposure: 300, available: 4200, refPnl: 500 })
function chipsResponse(name: string, variables: Record<string, unknown>): FetchResult | null {
  const agents = (payload: Record<string, unknown>) => ({ data: { agents: { __typename: 'AgentsQuery', ...payload } } })
  if (name === 'ChipAccount') return agents({ chipAccount: variables.accountId === 'root1' ? ROOT_CHIPS : variables.accountId === 'parent1' ? PARENT_CHIPS : { ...ROOT_CHIPS, id: String(variables.accountId), username: 'Child Profile' } })
  if (name === 'ChipDownline') return agents({ chipDownline: { __typename: 'ChipDownline', parent: ROOT_CHIPS, pool: null, items: [CHILD_CHIPS, PLAYER_CHIPS], total: 2, totals: chipTotalsFixture({ creditReference: 9000, balance: 8500, exposure: 300, available: 8200, refPnl: -500 }) } })
  if (name === 'ChipStatement') return agents({ chipStatement: { __typename: 'ChipStatementPage', rows: [chipRowFixture({ id: 'chip-row1', amount: 95000, balanceBefore: 0, balanceAfter: 95000, kind: 'OPENING', counterpartyType: null, counterpartyId: null, counterpartyName: null, remark: 'Opening chips' })], total: 1 } })
  return null
}

const feedback = vi.hoisted(() => ({ toast: vi.fn(), success: vi.fn(), error: vi.fn() }))
const guard = vi.hoisted(() => ({ update: true, view: true, calls: [] as unknown[] }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: feedback.success, error: feedback.error } }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children, required, fallback }: { children: ReactNode; required: Array<{domain: string; actions: string[]}>; fallback?: ReactNode }) => { guard.calls.push(required); return required.some(rule => rule.actions.includes('update')) && !guard.update || required.some(rule => rule.domain === 'agents.profile' && rule.actions.includes('view')) && !guard.view ? fallback || null : children } }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `INR ${value}`, getCurrencySymbol: () => '₹', convertFromWhitelabelCurrency: (value: number) => value * 2 }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string) => value, formatDateTime: (value: string) => value, formatTime: () => '09:00' }) }))
let state: AgentProfileFixtureState
// The ancestor that restricts the agent (AgentAccount.blockedByAncestor, AGE-16): none unless a test sets one.
let restriction: { id: string; username: string | null; status: string } | null
function restrictionResponse(name: string, variables: Record<string, unknown>): FetchResult | null {
  if (name !== 'AgentRestriction') return null
  return { data: { agents: { agentProfile: { id: String(variables.id), blockedByAncestor: restriction && { __typename: 'AgentAncestorBlock', ...restriction } } } } }
}
// Per-test change to a fixture answer (e.g. upper-case player statuses).
let rewrite: ((name: string, result: FetchResult) => FetchResult) | undefined
let calls: Array<{ name: string; variables: Record<string, unknown> }>
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
    const send = () => {
      if (state.profileError && operation.operationName === 'AgentProfile') { observer.error(new Error('Profile unavailable')); return }
      if (failStats && operation.operationName === 'AgentDashboardStats') { observer.error(new Error('Stats temporarily unavailable')); return }
      try {
        const result = restrictionResponse(operation.operationName, operation.variables) ?? chipsResponse(operation.operationName, operation.variables) ?? agentProfileResponse(operation, state)
        if (operation.operationName === 'AgentProfile' && operation.variables.id === 'child1') {
          const account = result.data?.agents?.agentProfile as Record<string, unknown>
          result.data!.agents.agentProfile = { ...account, id: 'child1', username: 'Child Profile' }
        }
        // The profile and its restriction both read agentProfile(id). The server's answers carry __typename, so the
        // two become one AgentAccount in the cache; the fixture's untyped objects would replace each other instead.
        const profile = result.data?.agents?.agentProfile as Record<string, unknown> | null | undefined
        if ((operation.operationName === 'AgentProfile' || operation.operationName === 'AgentRestriction') && profile) profile.__typename = 'AgentAccount'
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
  state = { scheme: 'CREDIT' }; restriction = null; rewrite = undefined; calls = []; guard.update = true; guard.view = true; guard.calls = []
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
  assert.ok(screen.getByRole('heading', { name: 'Agent details' })); assert.ok(screen.getAllByText('40.00%').length > 0); assert.ok(screen.getByText('Deposits and withdraws chips for its downline'))
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
  assert.equal(calls.some(call => ['AgentPlayers','ChipDownline','ChipStatement','AgentSecurityAudit'].includes(call.name)), false)
  await openTab('Players'); await screen.findByText('Referred by: Referrer Partner (9000000002)')
  assert.equal(calls.filter(call => call.name === 'AgentDashboardStats').length, 1)
})

test('failed stats show a stats-only retry while the selected tab stays available', async () => {
  failStats = true; mount(); await screen.findByText('Agent stats unavailable')
  await openTab('Players'); await screen.findByText('Referred by: Referrer Partner (9000000002)')
  const headerReads = calls.filter(call => call.name === 'AgentProfile').length
  failStats = false; fireEvent.click(screen.getByRole('button', { name: 'Retry stats' }))
  // The head's strip reads the stats on every tab.
  await within(screen.getByRole('group', { name: 'Chips and players' })).findByText('17')
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
  // A credit agent's chips are raw (unconverted) figures in the whitelabel currency, in the head's strip.
  const strip = within(screen.getByRole('group', { name: 'Chips and players' }))
  for (const text of ['INR 95000', 'Downline holds INR 8000', 'INR 100000', 'Reference only', '+INR 3000', 'Upline owes', '10 direct · 7 under sub-agents']) assert.ok(await strip.findByText(text), text)
  // The old credit-limit words are gone from the head.
  for (const text of ['Credit Limit', 'Credit Used', '30% of the limit']) assert.equal(strip.queryByText(text), null, text)
  assert.deepEqual(calls.find(call => call.name === 'ChipAccount')?.variables, { accountType: 'AGENT', accountId: 'root1' })
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
  for (const text of ['L1 · Super Master', 'Under a parent agent', 'On · Sports', 'Sharing rates', 'Chips', 'Network']) assert.ok(side.getAllByText(text).length, text)
  // The Chips card: the agent's own balance, its downline's, the exposure, the reference and Ref P/L in words.
  const chips = within(screen.getByRole('region', { name: 'Chips' }))
  for (const text of ['INR 95000', 'INR 8000', 'INR 1200', 'INR 100000', '+INR 3000', 'Upline owes']) assert.ok(await chips.findByText(text), text)
  assert.equal(side.queryByText('80% used'), null)
  // Nothing on the Overview reads another tab's data.
  assert.equal(calls.some(call => ['AgentPlayers', 'ChipDownline', 'ChipStatement', 'AgentSecurityAudit', 'CommissionSummary', 'CommissionCyclesForAgent'].includes(call.name)), false)
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
test('the Chips tab shows the figures, the downline and the statement, and reads no old credit API', async () => {
  mount(); await openTab('Chips')
  const figures = within(await screen.findByRole('group', { name: 'Agent chip figures' }))
  // An agent's available chips are its balance: both read INR 95000.
  for (const text of ['INR 100000', 'INR 95000', 'INR 1200', '+INR 3000', 'Upline owes', 'Downline holds INR 8000']) assert.ok((await figures.findAllByText(text)).length, text)
  const downline = await screen.findByRole('table', { name: 'Agent chip downline' })
  await within(downline).findByText('Child Partner'); assert.ok(within(downline).getByText('credit_player'))
  assert.equal(calls.find(call => call.name === 'ChipDownline')?.variables.parentAgentId, 'root1')
  const statement = await screen.findByRole('table', { name: 'Agent chip statement' })
  await within(statement).findByText('Opening chips')
  assert.deepEqual(calls.find(call => call.name === 'ChipStatement')?.variables, { accountType: 'AGENT', accountId: 'root1', from: null, to: null, offset: 0, limit: 20 })
  // root1 sits under parent1: an admin is not its direct parent, so no D / W / CR for it here.
  assert.equal(screen.queryByRole('button', { name: 'Deposit chips to Root Partner' }), null)
  assert.equal(calls.some(call => ['CreditAllocation', 'AgentCreditAlerts', 'AgentPlayerCredits', 'AgentCreditTransactions', 'AgentCreditUpdated'].includes(call.name)), false)
})
test('the direct parent agent gets Deposit / Withdraw chips and the credit reference on the head and the Chips tab', async () => {
  useAuthStore.setState({ agent: agentLogin('parent1', 'CREDIT') }); mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  const head = await screen.findByRole('group', { name: 'Chips for Root Partner' })
  for (const name of ['Deposit chips to Root Partner', 'Withdraw chips from Root Partner', 'Set credit reference for Root Partner']) assert.ok(within(head).getByRole('button', { name }), name)
  fireEvent.click(within(head).getByRole('button', { name: 'Deposit chips to Root Partner' }))
  assert.ok(await screen.findByRole('dialog'))
  // Settlement is a D / W of the Ref P/L for a CREDIT agent: the old Settle and Adjust Credit are gone.
  assert.equal(screen.queryByRole('button', { name: 'Adjust Credit' }), null)
  assert.equal(screen.queryByRole('tab', { name: 'Settlement' }), null)
})
test('a credit player on the Players tab shows its chips, masked without players.credit:view', async () => {
  rewrite = (name, result) => {
    if (name !== 'AgentPlayers') return result
    const rows = result.data?.usersPage?.itemsWithStats as Array<{ player: Record<string, unknown> }>
    rows[1].player.chips = PLAYER_CHIPS
    return result
  }
  mount(); await openTab('Players')
  const table = await screen.findByRole('table', { name: 'Agent downline players' })
  const row = within((await within(table).findByText('Credit Player')).closest('tr') as HTMLElement)
  assert.ok(row.getByText('INR 4500')); assert.ok(row.getByText('+INR 500'))
  cleanup(); useAuthStore.setState({ permissions: [{ domain: 'players.wallet', actions: ['view'] }] }); mount(); await openTab('Players')
  const masked = within((await within(await screen.findByRole('table', { name: 'Agent downline players' })).findByText('Credit Player')).closest('tr') as HTMLElement)
  assert.equal(masked.queryByText('INR 4500'), null); assert.ok(masked.getAllByText('••••').length >= 2)
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
  fireEvent.click(screen.getByRole('button', { name: 'Balance' }))
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
test('a SHARING profile lists its sub-agents too, with their share rates and no tally (AGE-11)', async () => {
  // Its head counted them ("SUB-AGENTS 2") but no tab or link led to them; only COMMISSION profiles had the tab.
  state.scheme = 'SHARING'; mount(); await openTab('Sub-Agents'); await screen.findByText('Child Partner')
  assert.deepEqual(calls.find(call => call.name === 'SubAgentsCount')?.variables, { rootId: 'root1' })
  const figures = within(screen.getByRole('group', { name: 'Sub-agent figures' }))
  assert.ok(figures.getByText('Direct Sub-Agents')); assert.equal(figures.queryByText('Tally On'), null, 'the tally is a COMMISSION setting')
  assert.ok(screen.getByRole('columnheader', { name: 'Share Rates' })); assert.equal(screen.queryByRole('columnheader', { name: 'Commission Rates' }), null)
  assert.ok(screen.getByText('Sports 40.00%')); assert.equal(screen.queryByText(/^Tally (on|off)/), null)
  cleanup(); state = { scheme: 'COMMISSION' }; mount(); await openTab('Sub-Agents'); await screen.findByText('Child Partner')
  assert.ok(within(screen.getByRole('group', { name: 'Sub-agent figures' })).getByText('Tally On'))
  // A CREDIT agent's downline stays in its Chips tab.
  cleanup(); calls = []; state = { scheme: 'CREDIT' }; mount(); await screen.findByRole('tab', { name: tabName('Chips') })
  assert.equal(screen.queryByRole('tab', { name: tabName('Sub-Agents') }), null); assert.equal(calls.some(call => call.name === 'SubAgentsCount'), false)
})
test('an agent restricted through its upline says so under its own status (AGE-16)', async () => {
  // It read ACTIVE with no hint while its sign-in was refused because its parent was suspended.
  restriction = { id: 'parent1', username: 'Parent Partner', status: 'SUSPENDED' }
  mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.deepEqual(calls.find(call => call.name === 'AgentRestriction')?.variables, { id: 'root1' })
  const notice = within(screen.getByText('Blocked by its parent').parentElement as HTMLElement)
  assert.equal(notice.getByRole('link', { name: 'Parent Partner' }).getAttribute('href'), '/agents/parent1')
  assert.ok(notice.getByText(/^, its parent, is suspended\. Until it is active again this agent cannot sign in and its players cannot place new bets/))
  cleanup(); restriction = null; mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.equal(screen.queryByText(/^(Blocked by|Read-only through) its/), null, 'none while every ancestor is ACTIVE')
  // A server that cannot answer it (one without the field) costs the notice only, never the profile.
  cleanup(); rewrite = (name, result) => { if (name === 'AgentRestriction') throw new Error('Cannot query field "blockedByAncestor" on type "AgentAccount".'); return result }
  mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.ok(screen.getByRole('tab', { name: tabName('Overview') })); assert.equal(screen.queryByText(/^(Blocked by|Read-only through) its/), null)
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

const agentLogin = (id: string, schemeType = 'SHARING') => ({ id, username: 'Logged agent', tenantId: 'preview', phone: null, schemeType, allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: null, levelIndex: 1, tallyEnabled: false, tallyDomains: [], createdAt: '2026-09-22' })
test('admins and the parent agent get Edit Agent; an agent on its own profile gets no management actions', async () => {
  mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.equal(screen.getByRole('link', { name: 'Edit Agent' }).getAttribute('href'), '/agents/root1/edit')
  cleanup(); useAuthStore.setState({ agent: agentLogin('root1') }); mount(); await screen.findByRole('heading', { name: 'Root Partner', level: 2 })
  assert.equal(screen.queryByRole('link', { name: 'Edit Agent' }), null); assert.equal(screen.queryByRole('button', { name: 'Agent actions' }), null)
  // Its own chips are moved by its parent, never by itself.
  await within(screen.getByRole('group', { name: 'Chips and players' })).findByText('INR 95000')
  assert.equal(screen.queryByRole('button', { name: 'Deposit chips to Root Partner' }), null)
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
test('the tabs open with their figures: sub-agents, activity, settlement and chips', async () => {
  state.scheme = 'COMMISSION'; mount(); await openTab('Sub-Agents'); await screen.findByText('Child Partner')
  const tree = within(screen.getByRole('group', { name: 'Sub-agent figures' }))
  assert.ok(tree.getByText('Direct Sub-Agents')); assert.equal(screen.getByRole('link', { name: 'Child Partner' }).getAttribute('href'), '/agents/child1')
  await openTab('Activity Log'); await screen.findByText('Successful sign in')
  const activity = within(screen.getByRole('group', { name: 'Activity figures' }))
  for (const [label, value] of [['Total Events', '3'], ['Successful Logins', '1'], ['Failed Logins', '1'], ['Password Changes', '1']]) assert.ok(activity.getByText(label) && activity.getAllByText(value).length, label)
  cleanup(); state = { scheme: 'SHARING' }; mount(); await openTab('Settlement'); await screen.findByText('Pending Settlement Available')
  assert.ok(within(screen.getByRole('group', { name: 'Settlement figures' })).getByText('Collected from Agent'))
  // A CREDIT agent settles with chips: a Chips tab and no Settlement tab.
  cleanup(); state = { scheme: 'CREDIT' }; mount(); await openTab('Chips')
  const chips = within(await screen.findByRole('group', { name: 'Agent chip figures' }))
  assert.ok(chips.getByText('Ref P/L')); assert.ok(await chips.findByText('+INR 3000'))
  assert.equal(screen.queryByRole('tab', { name: 'Settlement' }), null)
  assert.equal(screen.queryByRole('tab', { name: 'Credit' }), null)
})
test('the Review adjustments link lands on the Commission tab and its Adjustments card, read-only without the permission', async () => {
  state.scheme = 'COMMISSION'; mount('/agents/root1?tab=commission#commission-adjustments')
  const section = await screen.findByRole('region', { name: 'Adjustments' })
  assert.equal(screen.getByRole('tab', { name: 'Commission' }).getAttribute('aria-selected'), 'true')
  await within(section).findByText('No adjustments')
  assert.deepEqual(calls.find(call => call.name === 'CommissionAdjustmentsPage')?.variables, { agentId: 'root1', limit: 20, offset: 0 })
  assert.equal(within(section).queryByRole('button', { name: 'New adjustment' }), null)
})
