import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ApolloLink, InMemoryCache, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { playerCreateResponse, type PlayerFixtureOptions } from '../../../test/playerCreatePreviewData'
import CreatePage from './CreatePage'
interface Creator { id: string; username: string; schemeType: string }
const VIP_UPDATE = [{ domain: 'players.vip', actions: ['view', 'update'] }]
const state = vi.hoisted(() => ({ allowed: true, agent: undefined as Creator | undefined, success: vi.fn(), error: vi.fn(), guard: [] as unknown[], permissions: [] as Array<{ domain: string; actions: string[] }> }))
vi.mock('@/shared/core/authStore', () => ({ useAuthStore: (selector: (value: { agent: typeof state.agent; roles: string[]; permissions: typeof state.permissions }) => unknown) => selector({ agent: state.agent, roles: [], permissions: state.permissions }) }))
vi.mock('@/shared/core/useWhitelabels', () => ({ useCurrentWhitelabel: () => ({ whitelabel: { id: 'default' } }) }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ getWhitelabelBaseCurrencyCode: () => 'INR', getCurrencySymbol: () => '₹', formatAmount: (value: number) => `INR ${value.toFixed(2)}` }) }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children, ...props }: { children: ReactNode }) => { state.guard.push(props); return state.allowed ? children : <div>Access denied</div> } }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: state.success, error: state.error } }))
let calls: { name: string; variables: Record<string, unknown> }[]
let options: PlayerFixtureOptions
// The agent's hierarchy, by parent id, answered for the sub-agent owner picker (AgentSubtreeChildren).
let subtree: Record<string, Array<{ id: string; username: string; schemeType: string; levelIndex: number; status: string }>>
function subtreeResponse(parentAgentId: string) {
  const items = (subtree[parentAgentId] ?? []).map((item) => ({ __typename: 'AgentAccount', ...item, parentAgentId }))
  return { data: { agents: { __typename: 'AgentsQuery', agentsPage: { __typename: 'AgentsPageResult', items } } } }
}
// The chips reads (spec 2026-11-02 §7): a CREDIT agent's own free chips, the whitelabel pool, and an agent the admin
// chose for a new agent credit player (600 free). The player fixture predates the chips API, so they are answered here.
function chipsResponse(operation: Operation): FetchResult | null {
  const agents = (payload: Record<string, unknown>) => ({ data: { agents: { __typename: 'AgentsQuery', ...payload } } })
  const account = (id: string, available: number) => ({ __typename: 'ChipAccount', accountType: 'AGENT', id, username: id, name: null, status: 'ACTIVE', parentAgentId: null, playerType: null, currency: 'INR', creditReference: 0, balance: available, exposure: 0, available, downlineBalance: 0, refPnl: available, downlineCount: 0 })
  if (operation.operationName === 'MyChipAccount') return agents({ myChipAccount: account('agent-1', 800) })
  if (operation.operationName === 'ChipPool') return agents({ chipPool: { __typename: 'ChipPool', currency: 'INR', creditLimit: 10000, used: 7000, available: 3000 } })
  if (operation.operationName === 'ChipAccount') return agents({ chipAccount: account(String(operation.variables.accountId), 600) })
  return null
}
function page() {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    queueMicrotask(() => {
      try { observer.next(operation.operationName === 'AgentSubtreeChildren' ? subtreeResponse(String(operation.variables.parentAgentId)) : chipsResponse(operation) ?? playerCreateResponse(operation, options)); observer.complete() }
      catch (error) { observer.error(error) }
    })
  }))
  return render(<MockedProvider link={link} cache={new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } })}><MemoryRouter initialEntries={['/players/create']}>
    <PageEyebrowProvider value="Players"><Routes><Route path="/players/create" element={<CreatePage />} /><Route path="/players" element={<div>Player list</div>} /></Routes></PageEyebrowProvider>
  </MemoryRouter></MockedProvider>)
}
beforeEach(() => { calls = []; options = {}; subtree = {}; state.allowed = true; state.agent = undefined; state.guard = []; state.permissions = VIP_UPDATE; vi.clearAllMocks() })
function change(label: string, value: string) { fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } }) }
async function next(title: string) { fireEvent.click(screen.getByRole('button', { name: 'Next Step' })); await screen.findByRole('heading', { name: title }) }
// The password is required on the first step, as the server requires it (it was labelled optional for admins).
function basic() { change('Full Name', 'Alice Example'); change('Phone Number', '9876543210'); fireEvent.change(screen.getByLabelText(/^Password\s*\*?$/), { target: { value: 'fake-pass-1' } }) }
async function review() { await next('Account Settings'); await next('Betting Controls'); await next('Review Player Information') }
async function choose(label: string, option: string | RegExp) {
  await waitFor(() => assert.equal((screen.getByRole('combobox', { name: label }) as HTMLInputElement).disabled, false))
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}
describe('complete Player Create workflow', () => {
  test('admin denial skips all queries and required fields block Next', async () => {
    state.allowed = false; const view = page(); assert.ok(screen.getByText('Access denied')); assert.equal(calls.length, 0); view.unmount()
    state.allowed = true; page(); fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
    await screen.findByText('Please enter full name'); assert.deepEqual(state.guard[1], { required: [{ domain: 'players.create', actions: ['view', 'create'] }] })
    // The password is required on this first step, not refused by the server after the last one.
    change('Full Name', 'Alice Example'); change('Phone Number', '9876543210'); fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
    await screen.findByText('Password is required'); assert.ok(screen.getByRole('heading', { name: 'Basic Information' }))
    assert.equal(calls.some((call) => call.name === 'CreatePlayer'), false)
  })
  test('without VIP update rights the tier field is hidden and the Review shows Automatic', async () => {
    state.permissions = []
    page(); basic(); await next('Account Settings')
    assert.equal(screen.queryByRole('combobox', { name: 'VIP Tier' }), null)
    await next('Betting Controls'); await next('Review Player Information')
    assert.ok(screen.getByText('Automatic (monthly deposits)'))
  })
  test('admin retains defaults/flags/limits and never mutates before explicit Save', async () => {
    page(); basic(); await next('Account Settings'); await choose('VIP Tier', 'Silver Rewards')
    await next('Betting Controls')
    const sports = screen.getByRole('heading', { name: 'Sports Betting' }).closest('section')!
    fireEvent.click(within(sports).getByRole('switch', { name: 'Visible' }))
    change('Daily Stake Limit', '50')
    const previousNext = screen.getByRole('button', { name: 'Next Step' })
    await next('Review Player Information'); assert.equal(previousNext.isConnected, false)
    assert.equal(calls.some((call) => call.name === 'CreatePlayer'), false)
    fireEvent.click(screen.getByRole('button', { name: 'Create Player' })); await screen.findByText('Player created successfully')
    const input = calls.find((call) => call.name === 'CreatePlayer')?.variables.input as Record<string, unknown>
    assert.deepEqual(input, { name: 'Alice Example', phone: '+919876543210', password: 'fake-pass-1', playerType: 'REGULAR', status: 'ACTIVE', requirePasswordReset: false,
      bonusAllowed: true, sportsVisible: false, sportsBetAllowed: true, casinoVisible: true, casinoBetAllowed: true, matkaVisible: false, matkaBetAllowed: false,
      initialBalance: 0, currency: 'INR', dailyStakeLimit: 50, weeklyStakeLimit: null, exposureCapOverride: null, cooldownSeconds: null,
      maxBetSports: null, maxBetCasino: null, maxBetMatka: null, vipTierId: 'silver' })
    assert.equal((screen.getByRole('textbox', { name: 'Full Name' }) as HTMLInputElement).value, '')
  })
  test('agent selector lists active agents at every level and changes of type clear stale ownership', async () => {
    page(); basic(); fireEvent.change(screen.getByLabelText(/^Player Type/), { target: { value: 'AGENT_CREDIT' } })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Credit Agent' }), { key: 'ArrowDown' })
    assert.ok(await screen.findByRole('option', { name: /Child partner/ }))
    fireEvent.click(screen.getByRole('option', { name: /Root partner/ }))
    // The chosen CREDIT agent's free chips arrive before the step moves on (they bound the opening chips).
    await screen.findByText(/Deposited from Root partner's chips \(600\.00 free\)/)
    await next('Account Settings'); assert.equal((screen.getByLabelText('Currency') as HTMLInputElement).disabled, true)
    assert.equal(screen.getByRole('switch', { name: 'Enable Bonus Eligibility' }).getAttribute('aria-checked'), 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    fireEvent.change(screen.getByLabelText(/^Player Type/), { target: { value: 'SHARING_AGENT_PLAYER' } })
    assert.equal((screen.getByRole('combobox', { name: 'Sharing Agent' }) as HTMLInputElement).value, '')
    assert.ok(calls.some((call) => call.name === 'CreditAgentsForPlayerCreate'))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'SharingAgentsForPlayerCreate')))
  })
  test.each(['admin', 'agent'])('phone is marked invalid only for a real phone error in %s mode', async (mode) => {
    if (mode === 'agent') state.agent = { id: 'agent-1', username: 'Partner', schemeType: 'COMMISSION' }
    page()
    const label = mode === 'agent' ? 'Phone' : 'Phone Number'
    const phone = screen.getByRole('textbox', { name: label })
    assert.equal(phone.getAttribute('aria-invalid'), null)
    change(label, '9876543210')
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'CheckPhoneAvailable')))
    await waitFor(() => assert.ok(screen.queryByText('Checking phone availability\u2026') === null))
    assert.equal(phone.getAttribute('aria-invalid'), null)
    change(label, '12'); fireEvent.blur(phone)
    await screen.findByText(mode === 'agent' ? 'Please enter a valid 10-digit phone number' : 'Please enter a valid phone number')
    assert.equal(phone.getAttribute('aria-invalid'), 'true')
    change(label, '9876543210'); fireEvent.blur(phone)
    await waitFor(() => assert.equal(phone.getAttribute('aria-invalid'), null))
    assert.equal(calls.some((call) => call.name === 'CreatePlayer' || call.name === 'CreatePlayerForAgent'), false)
  })
  test('unavailable phones use the existing normalized query and block progress', async () => {
    options.unavailable = true; page(); basic(); await screen.findByText('Phone already registered')
    assert.deepEqual(calls.find((call) => call.name === 'CheckPhoneAvailable')?.variables, { phone: '+919876543210' })
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' })); assert.ok(screen.getByRole('heading', { name: 'Basic Information' }))
  })
  test('false-success admin responses keep the draft and review instead of clearing it', async () => {
    options.refused = true; page(); basic(); await review(); fireEvent.click(screen.getByRole('button', { name: 'Create Player' }))
    await screen.findByText('Create refused'); assert.ok(screen.getByText('Alice Example'))
    assert.ok(screen.getByRole('heading', { name: 'Review Player Information' }))
  })
  test.each(['CREDIT', 'SHARING', 'COMMISSION'])('agent %s defaults to itself as owner with its own input/currency/bonus rules', async (scheme) => {
    state.agent = { id: 'agent-1', username: 'Partner', schemeType: scheme }; page()
    change('Full Name', 'Alice Example'); change('Username', 'Player_A'); change('Phone', '9876543210')
    fireEvent.change(screen.getByLabelText(/^Password\s*\*?$/), { target: { value: 'fake-pass-1' } })
    change('Max Bet - Sports', '25')
    fireEvent.click(screen.getByRole('button', { name: 'Create Player' })); await screen.findByText('Player list')
    // The API client's notification link shows the server's success message; the page adds no second toast.
    assert.equal(state.success.mock.calls.length, 0)
    const input = calls.find((call) => call.name === 'CreatePlayerForAgent')?.variables.input as Record<string, unknown>
    assert.equal(input.agentId, 'agent-1'); assert.equal(input.phone, '9876543210'); assert.equal(input.username, 'Player_A'); assert.equal(input.initialBalance, 0)
    assert.equal(input.bonusAllowed, scheme !== 'CREDIT'); assert.equal(input.maxBetSports, 25); assert.equal('dailyStakeLimit' in input, false)
    // The API derives the player type from the owning agent, so the agent flow does not send one.
    assert.equal('playerType' in input, false)
    assert.ok(calls.some((call) => call.name === 'AgentSubtreeChildren' && call.variables.parentAgentId === 'agent-1'))
    assert.equal(state.guard.length, 0)
  })
  test("an admin gives an agent credit player a credit reference and opening chips out of its chosen agent's chips", async () => {
    page(); basic(); fireEvent.change(screen.getByLabelText(/^Player Type/), { target: { value: 'WHITELABEL_CREDIT' } })
    // An amount typed for a whitelabel credit player (from the pool) is dropped once the type changes.
    await screen.findByText(/Deposited from the whitelabel pool/)
    change('Opening Chips', '400')
    fireEvent.change(screen.getByLabelText(/^Player Type/), { target: { value: 'AGENT_CREDIT' } })
    // The fields wait for the CREDIT agent whose chips fund them (owner decision 2026-11-04).
    assert.equal(screen.queryByRole('textbox', { name: 'Credit Reference' }), null)
    assert.equal(screen.queryByRole('textbox', { name: 'Opening Chips' }), null)
    await choose('Credit Agent', /Child partner/)
    await screen.findByText(/^Optional\. Deposited from Child partner's chips \(600\.00 free\)\./)
    const agentRead = calls.findIndex((call) => call.name === 'ChipAccount' && call.variables.accountType === 'AGENT' && call.variables.accountId === 'child-1')
    assert.ok(agentRead >= 0, "the chosen agent's chips are read")
    assert.equal(calls.slice(agentRead).some((call) => call.name === 'ChipPool'), false, 'the pool is not read for an agent credit player')
    assert.equal((screen.getByRole('textbox', { name: 'Opening Chips' }) as HTMLInputElement).value, '')
    change('Credit Reference', '750'); change('Opening Chips', '900')
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' })); await screen.findByText('Not enough chips: 600.00 free')
    assert.ok(screen.getByRole('heading', { name: 'Basic Information' }))
    change('Opening Chips', '500')
    await review(); assert.ok(screen.getByText('Credit Reference')); assert.ok(screen.getByText('INR 750.00'))
    assert.ok(screen.getByText('Opening Chips')); assert.ok(screen.getByText('INR 500.00'))
    fireEvent.click(screen.getByRole('button', { name: 'Create Player' })); await screen.findByText('Player created successfully')
    const input = calls.find((call) => call.name === 'CreatePlayer')?.variables.input as Record<string, unknown>
    assert.equal(input.agentId, 'child-1'); assert.equal(input.creditLimit, 750); assert.equal(input.playerType, 'AGENT_CREDIT'); assert.equal(input.openingChips, 500)
  })
  test('the credit reference and opening chips come only with a CREDIT parent: none for a sharing or commission agent player', async () => {
    page(); basic()
    for (const [type, label] of [['SHARING_AGENT_PLAYER', 'Sharing Agent'], ['COMMISSION_AGENT_PLAYER', 'Commission Agent']] as const) {
      fireEvent.change(screen.getByLabelText(/^Player Type/), { target: { value: type } })
      await choose(label, /Root partner/)
      assert.equal(screen.queryByRole('textbox', { name: 'Credit Reference' }), null, type)
      assert.equal(screen.queryByRole('textbox', { name: 'Opening Chips' }), null, type)
    }
    assert.equal(calls.some((call) => call.name === 'ChipAccount' || call.name === 'ChipPool'), false, 'no chips read')
  })
  test('a whitelabel credit player takes its opening chips from the pool', async () => {
    page(); basic(); fireEvent.change(screen.getByLabelText(/^Player Type/), { target: { value: 'WHITELABEL_CREDIT' } })
    await screen.findByText(/Deposited from the whitelabel pool \(3000\.00 free\)/)
    change('Opening Chips', '1000')
    await review(); fireEvent.click(screen.getByRole('button', { name: 'Create Player' })); await screen.findByText('Player created successfully')
    const input = calls.find((call) => call.name === 'CreatePlayer')?.variables.input as Record<string, unknown>
    assert.equal(input.playerType, 'WHITELABEL_CREDIT'); assert.equal(input.openingChips, 1000); assert.equal(input.creditLimit, 0)
  })
  test('a CREDIT agent gives its own new player a credit reference and opening chips from its own chips', async () => {
    state.agent = { id: 'agent-1', username: 'Partner', schemeType: 'CREDIT' }; page()
    change('Full Name', 'Alice Example'); change('Username', 'Player_A'); change('Phone', '9876543210')
    fireEvent.change(screen.getByLabelText(/^Password\s*\*?$/), { target: { value: 'fake-pass-1' } })
    await screen.findByText(/Deposited from your chips \(800\.00 free\)/)
    change('Credit Reference', '2000'); change('Opening Chips', '900')
    fireEvent.click(screen.getByRole('button', { name: 'Create Player' })); await screen.findByText('Not enough chips: 800.00 free')
    assert.equal(calls.some((call) => call.name === 'CreatePlayerForAgent'), false)
    change('Opening Chips', '500')
    fireEvent.click(screen.getByRole('button', { name: 'Create Player' })); await screen.findByText('Player list')
    const input = calls.find((call) => call.name === 'CreatePlayerForAgent')?.variables.input as Record<string, unknown>
    assert.equal(input.agentId, 'agent-1'); assert.equal(input.creditLimit, 2000); assert.equal(input.openingChips, 500)
  })
  test('an agent can create a player for an active sub-agent at any depth; suspended branches are not offered', async () => {
    subtree = {
      'agent-1': [{ id: 'sub-1', username: 'Sub one', schemeType: 'CREDIT', levelIndex: 2, status: 'ACTIVE' }, { id: 'sub-off', username: 'Sub suspended', schemeType: 'CREDIT', levelIndex: 2, status: 'SUSPENDED' }],
      'sub-1': [{ id: 'grand-1', username: 'Grand one', schemeType: 'CREDIT', levelIndex: 3, status: 'ACTIVE' }],
      'sub-off': [{ id: 'grand-off', username: 'Grand blocked', schemeType: 'CREDIT', levelIndex: 3, status: 'ACTIVE' }],
    }
    state.agent = { id: 'agent-1', username: 'Partner', schemeType: 'CREDIT' }; page()
    change('Full Name', 'Alice Example'); change('Username', 'Player_A'); change('Phone', '9876543210')
    fireEvent.change(screen.getByLabelText(/^Password\s*\*?$/), { target: { value: 'fake-pass-1' } })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Player owner' }), { key: 'ArrowDown' })
    assert.ok(await screen.findByRole('option', { name: /Grand one/ }))
    assert.equal(screen.queryByRole('option', { name: /Sub suspended/ }), null); assert.equal(screen.queryByRole('option', { name: /Grand blocked/ }), null)
    fireEvent.click(screen.getByRole('option', { name: /Grand one/ }))
    assert.ok(screen.getByText('The player starts with no chips and a credit reference of 0. The upline agent deposits chips after the account is created.'))
    // Only the sub-agent moves its player's chips: no opening chips or credit reference from here.
    assert.equal(screen.queryByRole('textbox', { name: 'Opening Chips' }), null)
    fireEvent.click(screen.getByRole('button', { name: 'Create Player' })); await screen.findByText('Player list')
    const input = calls.find((call) => call.name === 'CreatePlayerForAgent')?.variables.input as Record<string, unknown>
    assert.equal(input.agentId, 'grand-1'); assert.equal(input.creditLimit, 0); assert.equal('playerType' in input, false); assert.equal('openingChips' in input, false)
  })
})

