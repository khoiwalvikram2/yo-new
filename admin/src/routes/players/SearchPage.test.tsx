import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable, type FetchResult } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { usePlayersUiStore } from '@/state/playersUiStore'
import { chipAccountFixture, chipPoolFixture } from '@/modules/chips/chipTestKit'
import { playersSearchResponse, type SearchFixtureOptions } from '../../../test/playersSearchPreviewData'
import PlayersSearchPage from './SearchPage'
// The credit players' chips (spec 2026-11-02 §7: Player.chips), added to the fixture's rows here.
const CREDIT_CHIPS: Record<string, ReturnType<typeof chipAccountFixture>> = {
  'wl-credit-1': chipAccountFixture({ accountType: 'PLAYER', id: 'wl-credit-1', username: 'wlcredit', parentAgentId: null, playerType: 'WHITELABEL_CREDIT', creditReference: 1000, balance: 1200, exposure: 10, available: 1190, refPnl: 200 }),
  'agent-credit-1': chipAccountFixture({ accountType: 'PLAYER', id: 'agent-credit-1', username: 'agentcredit', parentAgentId: 'agent-1', playerType: 'AGENT_CREDIT', creditReference: 1000, balance: 700, exposure: 10, available: 690, refPnl: -300 }),
}
// The two reads that carry Player.chips: the list's rows and the drawer's user.
interface ChipsCarrier { id: string | number; chips?: ReturnType<typeof chipAccountFixture> | null }
interface ChipsReadData { usersPage?: { items?: ChipsCarrier[] | null } | null; user?: ChipsCarrier | null }
function withChips(name: string, result: FetchResult): FetchResult {
  const data = result.data as ChipsReadData | null | undefined
  if (name === 'UsersPage') for (const item of data?.usersPage?.items ?? []) item.chips = CREDIT_CHIPS[String(item.id)] ?? null
  if (name === 'DrawerUser' && data?.user) data.user.chips = CREDIT_CHIPS[String(data.user.id)] ?? null
  return result
}
function chipsAnswer(name: string, variables: Record<string, unknown>): FetchResult | null {
  const agents = (payload: Record<string, unknown>) => ({ data: { agents: { __typename: 'AgentsQuery', ...payload } } })
  if (name === 'ChipAccount') return agents({ chipAccount: CREDIT_CHIPS[String(variables.accountId)] ?? null })
  if (name === 'ChipPool') return agents({ chipPool: chipPoolFixture() })
  return null
}
const mocks = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }, excel: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()) }))
vi.mock('@/shared/services/notification', () => ({ notify: mocks.notify }))
vi.mock('./utils/exportPlayerList', () => ({ exportPlayerListToExcel: mocks.excel }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (value: number) => value * 2, getCurrencySymbol: () => '₹', formatAmount: (value: number) => '₹' + Number(value).toFixed(2) }) }))
let options: SearchFixtureOptions
// An agent's hierarchy by parent id, for the agent filter (AgentSubtreeChildren).
let subtree: Record<string, Array<{ id: string; username: string; levelIndex: number; status: string }>> = {}
function subtreeResponse(parentAgentId: string) {
  const items = (subtree[parentAgentId] ?? []).map(item => ({ __typename: 'AgentAccount', schemeType: 'SHARING', parentAgentId, ...item }))
  return { data: { agents: { __typename: 'AgentsQuery', agentsPage: { __typename: 'AgentsPageResult', items } } } }
}
let calls: { name: string; variables: Record<string, unknown>; context: Record<string, unknown> }[]
const adminPermissions = [
  { domain: 'players.list', actions: ['view'] }, { domain: 'players.profile', actions: ['update'] }, { domain: 'players.wallet', actions: ['view'] },
  { domain: 'players.credit', actions: ['view'] }, { domain: 'players.specialBonus', actions: ['create'] },
  { domain: 'players.move-agent', actions: ['execute'] },
]
function Location() { return <output aria-label="Route">{useLocation().search}</output> }
function page(route = '/players/search') {
  const currentCalls = calls; const fixtureOptions = options
  const link = new ApolloLink(operation => new Observable(observer => {
    currentCalls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown>, context: operation.getContext() })
    queueMicrotask(() => { try { observer.next(operation.operationName === 'AgentSubtreeChildren' ? subtreeResponse(String(operation.variables.parentAgentId)) : chipsAnswer(operation.operationName, operation.variables) ?? withChips(operation.operationName, playersSearchResponse(operation, fixtureOptions))); observer.complete() } catch (cause) { observer.error(cause) } })
  }))
  return render(<MockedProvider cache={new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } })} link={link}><MemoryRouter initialEntries={[route]}><Location /><Routes><Route path="/players/search" element={<PlayersSearchPage />} /><Route path="*" element={<div>Destination page</div>} /></Routes></MemoryRouter></MockedProvider>)
}
async function list() { return screen.findByRole('table', { name: 'Players' }) }
async function choose(label: string, text: string) {
  const input = screen.getByRole('combobox', { name: label })
  await waitFor(() => assert.equal((input as HTMLInputElement).disabled, false))
  fireEvent.change(input, { target: { value: text } }); fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: text }))
}
async function drawer(id = 'regular-1') {
  fireEvent.click(screen.getByRole('button', { name: 'More Actions ' + id }))
  return screen.findByRole('dialog', { name: 'Player Actions' })
}
beforeEach(() => {
  options = {}; calls = []; subtree = {}; vi.clearAllMocks()
  useAuthStore.setState({ permissions: adminPermissions, agent: undefined, agentPermissions: [], roles: [] })
  usePlayersUiStore.setState({ drawer: { open: false, activeUserId: null, openSection: 'account' }, selectedUser: null, profileFilters: {} })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.resolve()) } })
})
test('denied admin makes no queries; agents bypass the list guard', async () => {
  useAuthStore.setState({ permissions: [] }); const view = page(); screen.getByText('Access denied'); assert.equal(calls.length, 0); view.unmount()
  useAuthStore.setState({ agent: { id: 'agent-1', username: 'Partner', tenantId: 'preview', phone: null, parentAgentId: null, levelIndex: 1, schemeType: 'COMMISSION', status: 'ACTIVE', allowedDomains: [], tallyEnabled: false, tallyDomains: [], createdAt: '' } })
  page(); await list(); assert.equal(Boolean(screen.queryByRole('group', { name: 'Player group' })), false)
  assert.equal(Boolean(screen.queryByRole('button', { name: 'Adjust Balance regular-1' })), false); assert.equal(Boolean(screen.queryByRole('button', { name: 'Update Remark regular-1' })), false)
})
test('URL/admin scope, agent filtering and group changes preserve backend variables and reset selected agent', async () => {
  page('/players/search?playerType=CREDIT'); await list()
  assert.deepEqual(calls.find(c => c.name === 'UsersPage')?.variables, { parentType: 'CREDIT', offset: 0, limit: 10 })
  await choose('Filter by agent', 'Preview partner')
  await waitFor(() => assert.equal(calls.filter(c => c.name === 'UsersPage').at(-1)?.variables.agentId, 'agent-1'))
  fireEvent.click(screen.getByRole('radio', { name: 'Direct Players' }))
  await waitFor(() => assert.deepEqual(calls.filter(c => c.name === 'UsersPage').at(-1)?.variables, { parentType: 'DIRECT', offset: 0, limit: 10 }))
  assert.equal(Boolean(screen.queryByRole('combobox', { name: 'Filter by agent' })), false)
  assert.equal(screen.getByLabelText('Route').textContent, '?playerType=DIRECT')
})
test('sharing and credit agents map Direct/Sub-Agent views to onlyDirect; their scheme controls columns', async () => {
  for (const schemeType of ['SHARING','CREDIT']) {
    useAuthStore.setState({ agent: { id: 'agent-1', username: 'Partner', tenantId: 'preview', phone: null, parentAgentId: null, levelIndex: 1, schemeType, status: 'ACTIVE', allowedDomains: [], tallyEnabled: false, tallyDomains: [], createdAt: '' }, permissions: [] })
    const view = page(); await list()
    fireEvent.click(screen.getByRole('radio', { name: 'Direct Players' }))
    await waitFor(() => assert.deepEqual(calls.filter(c => c.name === 'UsersPage').at(-1)?.variables, { onlyDirect: true, offset: 0, limit: 10 }))
    fireEvent.click(screen.getByRole('radio', { name: 'Sub-Agent Players' }))
    await waitFor(() => assert.deepEqual(calls.filter(c => c.name === 'UsersPage').at(-1)?.variables, { onlyDirect: false, offset: 0, limit: 10 }))
    const table = screen.getByRole('table', { name: 'Players' })
    // A CREDIT agent's players are on chips: Credit Ref and Ref P/L beside the Balance, no cash Deposits/Withdrawals.
    assert.equal(!!within(table).queryByRole('columnheader', { name: 'Credit Ref' }), schemeType === 'CREDIT')
    assert.equal(!!within(table).queryByRole('columnheader', { name: 'Ref P/L' }), schemeType === 'CREDIT')
    assert.equal(!!within(table).queryByRole('columnheader', { name: 'Deposits/Withdrawals' }), schemeType === 'SHARING')
    assert.ok(within(table).getByRole('columnheader', { name: 'Balance' }))
    assert.equal(within(table).queryByRole('columnheader', { name: 'Settlement' }), null)
    view.unmount(); cleanup(); calls = []
  }
})
test('search minimum, balance/status/type and IST custom range filters retain exact values; paging stays server-side', async () => {
  page(); await list()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search players' }), { target: { value: 'x' } })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
  assert.ok(calls.filter(c => c.name === 'UsersPage').every(c => c.variables.query === undefined))
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search players' }), { target: { value: 'xy' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'suspended' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Balance' }), { target: { value: '100-1000' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Player type' }), { target: { value: 'WHITELABEL_CREDIT' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Registration' }), { target: { value: 'custom' } })
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-09' } })
  await waitFor(() => assert.deepEqual(calls.filter(c => c.name === 'UsersPage').at(-1)?.variables, { query: 'xy', status: 'SUSPENDED', balanceMin: 100, balanceMax: 1000, registeredFrom: '2026-09-30T18:30:00.000Z', registeredTo: '2026-10-09T18:29:59.999Z', playerType: 'WHITELABEL_CREDIT', offset: 0, limit: 10 }))
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await waitFor(() => assert.equal(calls.filter(c => c.name === 'UsersPage').at(-1)?.variables.offset, 10))
  fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page:' }), { target: { value: '20' } })
  await waitFor(() => assert.equal(calls.filter(c => c.name === 'UsersPage').at(-1)?.variables.limit, 20))
  assert.equal(calls.filter(c => c.name === 'UsersPage').at(-1)?.variables.offset, 0)
})
test('a link with ?search= (the global search "See all Players") opens the list already filtered by the term', async () => {
  page('/players/search?search=vfypsh'); await list()
  assert.equal((screen.getByRole('searchbox', { name: 'Search players' }) as HTMLInputElement).value, 'vfypsh')
  // The first list request already carries it: no unfiltered page first.
  assert.equal(calls.find(c => c.name === 'UsersPage')?.variables.query, 'vfypsh')
})
test('wallet figures are converted/masked, metadata copying and an Excel export of the whole filtered list', async () => {
  page(); await list(); screen.getAllByText('Main: ₹1000.00')
  fireEvent.click(screen.getByRole('button', { name: 'Copy phone regular-1' })); assert.equal((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0], '9000000001')
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' })); await waitFor(() => assert.equal(mocks.excel.mock.calls.length, 1))
  // Every row of the list (the fixture's total is 80, served 5 a request), with its stats, and a title that counts them.
  const [exported, count] = mocks.excel.mock.calls[0] as [Array<{ stats?: unknown }>, number]
  assert.equal(exported.length, 80); assert.equal(count, 80); assert.ok(exported.every(row => row.stats), 'every exported row carries its stats')
  const exportPages = calls.filter(c => c.name === 'UsersPage' && c.variables.limit === 100)
  assert.equal(exportPages.length, 16); assert.deepEqual(exportPages.slice(0, 2).map(c => c.variables.offset), [0, 5])
  cleanup(); calls = []; useAuthStore.setState({ permissions: [{ domain: 'players.list', actions: ['view'] }] }); page(); await list()
  assert.equal(Boolean(screen.queryByRole('button', { name: 'Special Bonus regular-1' })), false); assert.ok(screen.getAllByText(/Main: ••••/).length)
})
test('account switches and force logout confirmation preserve exact mutations and UI context', async () => {
  page(); await list(); const d = await drawer()
  fireEvent.click(within(d).getByRole('switch', { name: 'Account Active' }))
  await waitFor(() => assert.ok(calls.some(c => c.name === 'SetUserStatus' && JSON.stringify(c.variables) === '{"id":"regular-1","status":"INACTIVE"}')))
  fireEvent.click(within(d).getByRole('switch', { name: 'Suspended' }))
  await waitFor(() => assert.ok(calls.some(c => c.name === 'SetUserStatus' && c.variables.status === 'SUSPENDED')))
  fireEvent.click(within(d).getByRole('switch', { name: 'Password Reset' }))
  await waitFor(() => assert.ok(calls.some(c => c.name === 'SetRequirePasswordReset' && c.variables.require === true)))
  fireEvent.click(within(d).getByRole('button', { name: 'Logout' }))
  assert.equal(calls.some(c => c.name === 'ForceLogout'), false)
  const confirm = await screen.findByRole('alertdialog', { name: 'Force logout all sessions?' })
  fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }))
  await waitFor(() => assert.ok(calls.some(c => c.name === 'ForceLogout' && c.variables.id === 'regular-1')))
  assert.equal(calls.find(c => c.name === 'ForceLogout')?.context.uiToast, 'message')
})
test('all seven limits, betting domains and wallet/bonus controls preserve nullable inputs and optimistic workflows', async () => {
  page(); await list(); const d = await drawer()
  fireEvent.click(within(d).getByRole('button', { name: 'Limits' }))
  await waitFor(() => assert.equal((screen.getByRole('textbox', { name: 'Daily Limit' }) as HTMLInputElement).value, '10000'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Daily Limit' }), { target: { value: '' } }); fireEvent.change(screen.getByRole('textbox', { name: 'Sports' }), { target: { value: '42' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save All Limits' }))
  await waitFor(() => assert.deepEqual(calls.find(c => c.name === 'UpsertPlayerLimits')?.variables.input, { userId: 'regular-1', dailyStakeLimit: null, weeklyStakeLimit: 20000, exposureCapOverride: 5000, cooldownSeconds: 5, maxBetSports: 42, maxBetCasino: 500, maxBetMatka: 100 }))
  fireEvent.click(within(d).getByRole('button', { name: 'Betting Controls' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Casino Betting Allowed' }))
  await waitFor(() => assert.deepEqual(calls.find(c => c.name === 'SetUserDomainBets')?.variables, { id: 'regular-1', casino: false }))
  fireEvent.click(within(d).getByRole('button', { name: 'Wallet & Bonus' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Withdrawal Lock' })); fireEvent.click(screen.getByRole('switch', { name: 'Bonus Eligibility' }))
  await waitFor(() => assert.deepEqual(calls.find(c => c.name === 'SetWithdrawalLock')?.variables, { id: 'regular-1', lock: true }))
  assert.deepEqual(calls.find(c => c.name === 'SetUserBonusAllowed')?.variables, { id: 'regular-1', allow: false })
})
test('VIP manual tier and Automatic both go through setUserVipTier', async () => {
  useAuthStore.setState({ permissions: [...adminPermissions, { domain: 'players.vip', actions: ['view', 'update'] }] })
  page(); await list(); const d = await drawer()
  fireEvent.click(within(d).getByRole('button', { name: 'VIP Tier' }))
  await choose('VIP Tier', 'Platinum (L2)')
  await waitFor(() => assert.deepEqual(calls.find(c => c.name === 'SetUserVipTier')?.variables, { id: 'regular-1', vipTierId: 'vip-2' }))
  await choose('VIP Tier', 'Automatic — monthly approved deposits')
  await waitFor(() => assert.deepEqual(calls.filter(c => c.name === 'SetUserVipTier').at(-1)?.variables, { id: 'regular-1', vipTierId: null }))
  assert.equal(calls.some(c => c.name === 'AdjustPlayerVipTier'), false)
})
test('credit players get no VIP tier section', async () => {
  useAuthStore.setState({ permissions: [...adminPermissions, { domain: 'players.vip', actions: ['view', 'update'] }] })
  page(); await list(); const d = await drawer('wl-credit-1')
  assert.equal(within(d).queryByRole('button', { name: 'VIP Tier' }), null)
})
test('deposit/withdrawal send signed amounts, bonus flags and trimmed audit reason; refusal preserves draft', async () => {
  page(); await list(); fireEvent.click(screen.getByRole('button', { name: 'Adjust Balance regular-1' }))
  const d = await screen.findByRole('dialog', { name: 'Adjust Balance' })
  fireEvent.click(within(d).getByRole('button', { name: 'Deposit' })); within(d).getByText('Please enter a valid amount')
  fireEvent.change(screen.getByRole('textbox', { name: 'Deposit Amount' }), { target: { value: '25' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: ' Manual correction ' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Apply bonus if eligible campaign is active' }))
  options.refuseMutation = 'AdjustWallet'; await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Deposit' })) })
  await within(d).findByText('Preview mutation refused'); assert.equal((screen.getByRole('textbox', { name: 'Reason' }) as HTMLTextAreaElement).value, ' Manual correction ')
  options.refuseMutation = undefined; await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Deposit' })) }); await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false))
  // The reason is a mutation argument (the server stores it with the ledger and audit rows), not client context.
  const deposit = calls.find(c => c.name === 'AdjustWallet')!; assert.deepEqual(deposit.variables, { userId: 'regular-1', amount: 25, applyBonus: true, reason: 'Manual correction' }); assert.equal(deposit.context.meta, undefined)
  fireEvent.click(screen.getByRole('button', { name: 'Adjust Balance regular-1' })); fireEvent.click(screen.getByRole('tab', { name: 'Withdrawal' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Withdrawal Amount' }), { target: { value: '10' } }); fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Return funds' } })
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw' })); await waitFor(() => assert.deepEqual(calls.filter(c => c.name === 'AdjustWallet').at(-1)?.variables, { userId: 'regular-1', amount: -10, reason: 'Return funds' }))
})
test('a withdrawal above the balance keeps the typed amount, warns and is not sent', async () => {
  page(); await list(); fireEvent.click(screen.getByRole('button', { name: 'Adjust Balance regular-1' }))
  const d = await screen.findByRole('dialog', { name: 'Adjust Balance' }); fireEvent.click(within(d).getByRole('tab', { name: 'Withdrawal' }))
  const amount = within(d).getByRole('textbox', { name: 'Withdrawal Amount' }) as HTMLInputElement
  // 495 is within the cash (500) but above what a withdrawal may take, the cash less its exposure (10): the server's rule.
  fireEvent.change(amount, { target: { value: '495' } }); fireEvent.blur(amount); fireEvent.change(within(d).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Chargeback' } })
  assert.equal(amount.value.replace(/,/g, ''), '495', 'the typed amount is not clamped to the balance')
  assert.ok(within(d).queryAllByText('Withdrawal amount exceeds available balance').length > 0, 'the warning shows while the amount is above the available balance')
  await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Withdraw' })) })
  assert.equal(calls.some(c => c.name === 'AdjustWallet'), false, 'nothing is sent')
  assert.ok(Boolean(screen.queryByRole('dialog', { name: 'Adjust Balance' })), 'the dialog stays open')
})
test('credit rows show their chips, credit reference and Ref P/L; the admin moves chips for whitelabel credit players only', async () => {
  useAuthStore.setState({ permissions: [...adminPermissions, { domain: 'agents.credit', actions: ['update'] }] })
  page(); await list()
  const table = screen.getByRole('table', { name: 'Players' })
  const wl = within(within(table).getByText('Preview whitelabel credit').closest('tr') as HTMLElement)
  // Chips are shown in the whitelabel's currency, unconverted, as the server keeps them.
  for (const text of ['Chips: ₹1200.00', 'Available: ₹1190.00', '₹1000.00', '+₹200.00', 'Upline owes']) assert.ok(wl.getByText(text), text)
  for (const text of [/Limit:/, /Used:/, /Pending:/]) assert.equal(wl.queryByText(text), null, String(text))
  const own = within(within(table).getByText('Preview agent credit').closest('tr') as HTMLElement)
  assert.ok(own.getByText('−₹300.00')); assert.ok(own.getByText('Owes upline'))
  // A whitelabel credit player's direct parent is the admin: D / W / CR. An agent credit player's is its agent.
  for (const name of ['Deposit chips to wlcredit', 'Withdraw chips from wlcredit', 'Set credit reference for wlcredit']) assert.ok(wl.getByRole('button', { name }), name)
  assert.equal(own.queryByRole('button', { name: 'Deposit chips to agentcredit' }), null)
  assert.equal((own.getByRole('button', { name: "Chips managed by the player's agent" }) as HTMLButtonElement).disabled, true)
  fireEvent.click(wl.getByRole('button', { name: 'Deposit chips to wlcredit' }))
  assert.ok(await screen.findByRole('dialog'))
  assert.equal(calls.some(c => c.name === 'AdjustPlayerCredit' || c.name === 'DepositChips'), false)
  // The old credit-limit actions are gone.
  for (const name of ['Adjust Credit wl-credit-1', 'Settle Credit wl-credit-1']) assert.equal(screen.queryByRole('button', { name }), null, name)
})
test('special bonus and remark retain validation and refused drafts before an explicit successful save', async () => {
  page(); await list()
  // Credit players get no bonus (the server refuses them), so their rows offer none.
  for (const id of ['wl-credit-1', 'agent-credit-1']) assert.equal(Boolean(screen.queryByRole('button', { name: 'Special Bonus ' + id })), false, id)
  fireEvent.click(screen.getByRole('button', { name: 'Special Bonus regular-1' }))
  await screen.findByRole('dialog', { name: 'Grant Special Bonus' }); fireEvent.click(screen.getByRole('button', { name: 'Grant' })); screen.getByText('Please select a campaign and enter a positive amount')
  await choose('Campaign', 'Preview reward (INR)'); fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '10' } })
  options.refuseMutation = 'GrantSpecialBonus'; fireEvent.click(screen.getByRole('button', { name: 'Grant' })); await screen.findByText('Preview mutation refused')
  assert.equal((screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement).value, '10')
  options.refuseMutation = undefined; fireEvent.click(screen.getByRole('button', { name: 'Grant' })); await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false))
  assert.deepEqual(calls.find(c => c.name === 'GrantSpecialBonus')?.variables.input, { playerId: 'regular-1', campaignId: 'campaign-1', amount: 10 })
  fireEvent.click(screen.getByRole('button', { name: 'Update Remark regular-1' })); fireEvent.change(screen.getByRole('textbox', { name: 'Remark' }), { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => assert.deepEqual(calls.find(c => c.name === 'UpdatePlayerRemark')?.variables, { userId: 'regular-1', remark: null }))
})
test('commission transfer validates target eligibility and requires confirmation; refusal preserves reason', async () => {
  page(); await list(); const d = await drawer('commission-1'); fireEvent.click(within(d).getByRole('button', { name: 'Commission Information' }))
  await screen.findByText('Commission Statistics'); fireEvent.click(screen.getByRole('button', { name: 'Move to Another Agent' }))
  const move = await screen.findByRole('dialog', { name: 'Move Player to Another Agent' })
  assert.equal(Boolean(screen.queryByRole('dialog', { name: 'Player Actions' })), false)
  await choose('Select Target Agent', 'Target partner (L1)'); await within(move).findByText('All checks passed. Player can be moved.')
  assert.deepEqual(calls.find(c => c.name === 'MovePlayerPreCheck')?.variables, { playerId: 'commission-1', targetAgentId: 'agent-target' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: ' Approved transfer ' } }); fireEvent.click(screen.getByRole('button', { name: 'Move Player' }))
  assert.equal(calls.some(c => c.name === 'MovePlayerToAgent'), false)
  options.refuseMutation = 'MovePlayerToAgent'; fireEvent.click(screen.getByRole('button', { name: 'Yes, Move Player' })); await screen.findByText('Preview mutation refused')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); assert.equal((screen.getByRole('textbox', { name: 'Reason' }) as HTMLTextAreaElement).value, ' Approved transfer ')
  options.refuseMutation = undefined; fireEvent.click(screen.getByRole('button', { name: 'Move Player' })); fireEvent.click(screen.getByRole('button', { name: 'Yes, Move Player' }))
  await waitFor(() => assert.ok(calls.filter(c => c.name === 'MovePlayerToAgent').length === 2))
  assert.deepEqual(calls.find(c => c.name === 'MovePlayerToAgent')?.variables.input, { playerId: 'commission-1', targetAgentId: 'agent-target', reason: 'Approved transfer' })
})
test('list server errors have an explicit retry without hiding unrelated account actions', async () => {
  options.failUsers = true; page(); await screen.findByText('Preview list unavailable')
  options.failUsers = false; fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await list()
})

test('a CREDIT agent moves chips for its own players only; chip figures are masked without players.credit:view', async () => {
  useAuthStore.setState({ agent: { id: 'agent-1', username: 'Partner', tenantId: 'preview', phone: null, parentAgentId: null, levelIndex: 1, schemeType: 'CREDIT', status: 'ACTIVE', allowedDomains: [], tallyEnabled: false, tallyDomains: [], createdAt: '' }, permissions: [], isReadOnly: false })
  const view = page(); await list()
  const table = screen.getByRole('table', { name: 'Players' })
  const own = within(within(table).getByText('Preview agent credit').closest('tr') as HTMLElement)
  for (const name of ['Deposit chips to agentcredit', 'Withdraw chips from agentcredit', 'Set credit reference for agentcredit']) assert.ok(own.getByRole('button', { name }), name)
  const wl = within(within(table).getByText('Preview whitelabel credit').closest('tr') as HTMLElement)
  assert.equal((wl.getByRole('button', { name: 'Chips managed by the whitelabel' }) as HTMLButtonElement).disabled, true)
  view.unmount(); cleanup(); calls = []
  // An admin without players.credit:view sees the credit rows but not their chips.
  useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'players.list', actions: ['view'] }] })
  page(); await list()
  const masked = within(within(screen.getByRole('table', { name: 'Players' })).getByText('Preview whitelabel credit').closest('tr') as HTMLElement)
  assert.equal(masked.queryByText('Chips: ₹1200.00'), null); assert.ok(masked.getByText('Chips: ••••'))
  assert.equal(masked.queryByText('+₹200.00'), null)
})

test('sharing agents cannot submit balance adjustments through an already-open modal', async () => {
  page(); await list(); fireEvent.click(screen.getByRole('button', { name: 'Adjust Balance regular-1' }))
  await screen.findByRole('dialog', { name: 'Adjust Balance' })
  await act(async () => { useAuthStore.setState({ agent: { id: 'agent-1', username: 'Partner', tenantId: 'preview', phone: null, parentAgentId: null, levelIndex: 1, schemeType: 'SHARING', status: 'ACTIVE', allowedDomains: [], tallyEnabled: false, tallyDomains: [], createdAt: '' } }) })
  fireEvent.change(screen.getByRole('textbox', { name: 'Deposit Amount' }), { target: { value: '25' } }); fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Restricted adjustment' } })
  fireEvent.click(screen.getByRole('button', { name: 'Deposit' })); screen.getByText('Sharing agents cannot adjust player balances')
  assert.equal(calls.some(c => c.name === 'AdjustWallet'), false)
})

test('an agent filters by any of its sub-agents (every level), not only itself', async () => {
  subtree = { 'agent-1': [{ id: 'sub-1', username: 'Sub one', levelIndex: 2, status: 'ACTIVE' }], 'sub-1': [{ id: 'grand-1', username: 'Grand one', levelIndex: 3, status: 'SUSPENDED' }] }
  useAuthStore.setState({ agent: { id: 'agent-1', username: 'Partner', tenantId: 'preview', phone: null, parentAgentId: null, levelIndex: 1, schemeType: 'SHARING', status: 'ACTIVE', allowedDomains: [], tallyEnabled: false, tallyDomains: [], createdAt: '' }, permissions: [] })
  page('/players/search?playerType=SUB_AGENTS'); await list()
  await waitFor(() => assert.ok(calls.some(c => c.name === 'AgentSubtreeChildren' && c.variables.parentAgentId === 'sub-1')), { timeout: 3000 })
  assert.equal(calls.some(c => c.name === 'AgentsForPlayerFilter'), false)
  const filter = screen.getByRole('combobox', { name: 'Filter by agent' })
  fireEvent.change(filter, { target: { value: 'Grand' } }); fireEvent.keyDown(filter, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: /Grand one/ }))
  await waitFor(() => assert.equal(calls.filter(c => c.name === 'UsersPage').at(-1)?.variables.agentId, 'grand-1'))
})
