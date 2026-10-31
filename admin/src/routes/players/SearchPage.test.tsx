import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { usePlayersUiStore } from '@/state/playersUiStore'
import { playersSearchResponse, type SearchFixtureOptions } from '../../../test/playersSearchPreviewData'
import PlayersSearchPage from './SearchPage'
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
    queueMicrotask(() => { try { observer.next(operation.operationName === 'AgentSubtreeChildren' ? subtreeResponse(String(operation.variables.parentAgentId)) : playersSearchResponse(operation, fixtureOptions)); observer.complete() } catch (cause) { observer.error(cause) } })
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
    assert.equal(!!within(table).queryByRole('columnheader', { name: 'Credit' }), schemeType === 'CREDIT')
    assert.equal(!!within(table).queryByRole('columnheader', { name: 'Balance' }), schemeType === 'SHARING')
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
test('wallet figures are converted/masked, metadata copying and Excel current-page export remain available', async () => {
  page(); await list(); screen.getAllByText('Main: ₹1000.00')
  fireEvent.click(screen.getByRole('button', { name: 'Copy phone regular-1' })); assert.equal((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0], '9000000001')
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' })); await waitFor(() => assert.equal(mocks.excel.mock.calls.length, 1))
  assert.equal(mocks.excel.mock.calls[0].length, 2); assert.equal(mocks.excel.mock.calls[0][1], 80)
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
  const deposit = calls.find(c => c.name === 'AdjustWallet')!; assert.deepEqual(deposit.variables, { userId: 'regular-1', amount: 25, applyBonus: true }); assert.deepEqual(deposit.context.meta, { reason: 'Manual correction', type: 'deposit' })
  fireEvent.click(screen.getByRole('button', { name: 'Adjust Balance regular-1' })); fireEvent.click(screen.getByRole('tab', { name: 'Withdrawal' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Withdrawal Amount' }), { target: { value: '10' } }); fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Return funds' } })
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw' })); await waitFor(() => assert.deepEqual(calls.filter(c => c.name === 'AdjustWallet').at(-1)?.variables, { userId: 'regular-1', amount: -10 }))
})
test('credit limit/increase/decrease/settle retain business boundaries, initial tabs and exact payloads', async () => {
  page(); await list(); fireEvent.click(screen.getByRole('button', { name: 'Adjust Credit wl-credit-1' }))
  await screen.findByRole('dialog', { name: 'Credit Management' }); screen.getByRole('tab', { name: 'Add/Remove Credit', selected: true })
  fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '801' } }); assert.equal((screen.getByRole('button', { name: 'Add Credit' }) as HTMLButtonElement).disabled, true)
  fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '20' } }); fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: ' correction ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add Credit' })); await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false))
  assert.deepEqual(calls.find(c => c.name === 'AdjustPlayerCredit')?.variables.input, { playerId: 'wl-credit-1', adjustmentType: 'INCREASE', amount: 20, notes: 'correction' })
  fireEvent.click(screen.getByRole('button', { name: 'Adjust Credit wl-credit-1' })); fireEvent.click(screen.getByRole('tab', { name: 'Adjust Limit' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'New Credit Limit' }), { target: { value: '100' } }); assert.equal((screen.getByRole('button', { name: 'Update Limit' }) as HTMLButtonElement).disabled, true)
  fireEvent.change(screen.getByRole('textbox', { name: 'New Credit Limit' }), { target: { value: '900' } }); fireEvent.click(screen.getByRole('button', { name: 'Update Limit' })); await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false))
  assert.deepEqual(calls.filter(c => c.name === 'AdjustPlayerCredit').at(-1)?.variables.input, { playerId: 'wl-credit-1', adjustmentType: 'LIMIT_CHANGE', amount: 900, notes: '' })
  fireEvent.click(screen.getByRole('button', { name: 'Settle Credit wl-credit-1' })); screen.getByRole('tab', { name: 'Settle', selected: true }); fireEvent.click(screen.getByRole('button', { name: 'Settle Credit' }))
  await waitFor(() => assert.deepEqual(calls.filter(c => c.name === 'AdjustPlayerCredit').at(-1)?.variables.input, { playerId: 'wl-credit-1', adjustmentType: 'SETTLE', amount: 50, notes: '' }))
})
test('special bonus and remark retain validation and refused drafts before an explicit successful save', async () => {
  page(); await list(); fireEvent.click(screen.getByRole('button', { name: 'Special Bonus regular-1' }))
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

test('credit decrease validates current used and refuses non-owned agent credit before any mutation', async () => {
  page(); await list(); fireEvent.click(screen.getByRole('button', { name: 'Adjust Credit wl-credit-1' }))
  await screen.findByRole('dialog', { name: 'Credit Management' })
  fireEvent.change(screen.getByRole('combobox', { name: 'Adjustment Type' }), { target: { value: 'DECREASE' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '201' } }); assert.equal((screen.getByRole('button', { name: 'Remove Credit' }) as HTMLButtonElement).disabled, true)
  fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '40' } }); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove Credit' })) })
  await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false))
  assert.deepEqual(calls.find(c => c.name === 'AdjustPlayerCredit')?.variables.input, { playerId: 'wl-credit-1', adjustmentType: 'DECREASE', amount: 40, notes: '' })
  const row = within(screen.getByRole('table', { name: 'Players' })).getByText('Preview agent credit').closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: 'Settle' }))
  await screen.findByRole('dialog', { name: 'Credit Management' }); fireEvent.click(screen.getByRole('button', { name: 'Settle Credit' }))
  screen.getByText("Credit adjustments for AGENT_CREDIT players are only available when you are the player's agent.")
  assert.equal(calls.filter(c => c.name === 'AdjustPlayerCredit').length, 1)
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
