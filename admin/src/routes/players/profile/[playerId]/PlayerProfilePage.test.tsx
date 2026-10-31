import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { ChangePlayerPasswordModal } from './components/ChangePlayerPasswordModal'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CurrencyProvider } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { usePlayerProfileStore } from '@/state/playerProfileStore'
import PlayerProfilePage from './index'
import { playerProfileResponse, type PlayerFixtureState } from '../../../../../test/playerProfilePreviewData'
const callbacks = vi.hoisted(() => ({ close: vi.fn(), success: vi.fn() }))
let refused: boolean
let calls: Record<string, unknown>[]
beforeEach(() => {
  refused = false; calls = []; vi.clearAllMocks()
  usePlayerProfileStore.setState({ profiles: {} })
  useAuthStore.setState({ user: { id: 'operator1', name: 'Preview Operator' }, token: undefined, agent: undefined, roles: ['Whitelabel Admin'],
    permissions: ['players.profile', 'players.wallet', 'players.bonuses', 'players.credit', 'players.ledger', 'players.vip', 'players.referral-bonus', 'players.security-audit', 'players.sessions', 'players.notes', 'players.move-agent', 'players.responsible-gaming', 'currency.list'].map((domain) => ({ domain, actions: ['view', 'update', 'create', 'delete', 'execute', 'change-password'] })) })
})
function dialog() {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push(operation.variables)
    queueMicrotask(() => { observer.next({ data: { changePlayerPassword: { success: !refused, message: refused ? 'Password change refused' : 'Password changed' } } }); observer.complete() })
  }))
  return render(<MockedProvider cache={new InMemoryCache()} link={link}><ChangePlayerPasswordModal open playerId="p1" playerName="Preview player" onClose={callbacks.close} onSuccess={callbacks.success} /></MockedProvider>)
}
function fields() {
  const modal = within(screen.getByRole('dialog', { name: 'Change Player Password' }))
  for (const [label, value] of [['New Password', 'new-pass'], ['Confirm New Password', 'new-pass'], ['Your Login Password', 'operator-pass']]) fireEvent.change(modal.getByLabelText(new RegExp(`^${label}\\s*\\*?$`)), { target: { value } })
}
describe('Player Profile password dialog', () => {
  test('validates private fields and calls original mutation only after explicit submit', async () => {
    dialog(); fireEvent.click(screen.getByRole('button', { name: 'Change Password' })); await screen.findByText('Please enter the new password'); assert.equal(calls.length, 0)
    fields(); fireEvent.click(screen.getByRole('button', { name: 'Change Password' }))
    await waitFor(() => assert.equal(callbacks.close.mock.calls.length, 1)); assert.equal(callbacks.success.mock.calls.length, 1)
    assert.deepEqual(calls, [{ playerId: 'p1', newPassword: 'new-pass', adminPassword: 'operator-pass' }])
  })
  test('refusal retains draft and shows server error instead of claiming success', async () => {
    refused = true; dialog(); fields(); fireEvent.click(screen.getByRole('button', { name: 'Change Password' })); await screen.findByText('Password change refused')
    assert.equal(callbacks.close.mock.calls.length, 0); assert.equal(callbacks.success.mock.calls.length, 0)
    assert.equal((screen.getByPlaceholderText('Enter new password') as HTMLInputElement).value, 'new-pass')
  })
})
function workspace(state: PlayerFixtureState & { holdOverview?: boolean; failOverview?: boolean } = {}) {
  let releaseOverview = () => {}
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, variables: operation.variables })
    const send = () => {
      try {
        if (state.failOverview && operation.operationName === 'PlayerOverview') throw new Error('Overview temporarily unavailable')
        observer.next(playerProfileResponse(operation, state)); observer.complete()
      } catch (error) { observer.error(error) }
    }
    queueMicrotask(() => {
      if (state.holdOverview && operation.operationName === 'PlayerOverview') { releaseOverview = send; return }
      send()
    })
  }))
  const view = render(<MockedProvider cache={new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } })} link={link}><CurrencyProvider><MemoryRouter initialEntries={['/players/profile/p1']}><Routes><Route path="/players/profile/:playerId" element={<PlayerProfilePage />} /><Route path="/players/search" element={<p>Search preview</p>} /></Routes></MemoryRouter></CurrencyProvider></MockedProvider>)
  return { ...view, releaseOverview: () => releaseOverview() }
}
// A phone-width viewport for one test (useBreakpoint reads window.innerWidth when the page mounts).
async function onPhone(run: () => Promise<void>) {
  const width = window.innerWidth
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 })
  try { await run() } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width }) }
}
async function tab(label: string, heading: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }))
  return screen.findByRole('heading', { name: heading })
}
describe('Player Profile workspace', () => {
  test('keeps all existing page branches and role/type-specific tabs without implicit mutations', async () => {
    workspace({ type: 'WHITELABEL_CREDIT' })
    await screen.findByRole('region', { name: 'Player summary' })
    await screen.findByRole('tab', { name: 'Credit Management' })
    assert.equal(screen.getAllByRole('tab').length, 14)
    for (const [label, heading] of [['Transactions', 'Transactions'], ['Ledger', 'Ledger — Cash'], ['Bonuses', 'Bonuses'], ['Referral Bonus', 'Referral Details'], ['VIP Status', 'Current VIP Tier'], ['Credit Management', 'Credit Management Actions'], ['Credit Statement', 'Credit statement'],['Payout Account', 'Payout Accounts'], ['Activity Log', 'Security Events'], ['Responsible Gaming', 'Betting Limits'], ['Devices & Sessions', 'Known Devices'], ['Notes & Comms', 'Internal Notes']]) await tab(label, heading)
    assert.equal(calls.some((call) => /^(Set|Change|Add|Adjust|Grant)/.test(String(call.name))), false)
  })
  test('ordinary players omit credit-management and non-whitelabel operators omit payout tab', async () => {
    useAuthStore.setState({ roles: ['Super Admin'] }); workspace()
    await screen.findByRole('region', { name: 'Player summary' })
    assert.equal(screen.queryByRole('tab', { name: 'Credit Management' }), null); assert.equal(screen.queryByRole('tab', { name: 'Payout Account' }), null)
    assert.equal(screen.getAllByRole('tab').length, 11)
  })
  test('the head shows who the player is, the actions and every wallet, without an Account summary card', async () => {
    workspace()
    const head = within(await screen.findByRole('region', { name: 'Player summary' }))
    assert.ok(head.getByRole('heading', { name: 'Ananya Rao · long account display name' }))
    for (const text of ['@ananya-preview', 'Active', 'Normal', 'Gold', 'KYC verified', '+91 90000 12345']) assert.ok(head.getByText(text), text)
    // The actions are on the page title's row, beside "Player Profile".
    assert.ok(screen.getByRole('button', { name: 'Adjust Balance' })); assert.ok(screen.getByRole('button', { name: 'Player actions' }))
    const wallets = within(head.getByRole('group', { name: 'Wallets' }))
    for (const label of ['Balance', 'Exposure', 'Bonus Wallet', 'Referral Bonus']) assert.ok(wallets.getByText(label), label)
    assert.ok(wallets.getByText(/12,345\.67/))
    assert.equal(screen.queryByRole('heading', { name: 'Account summary' }), null)
  })
  test('the Overview groups the period: each product, money flow, bonus and referral, recent bets and transactions', async () => {
    workspace(); await screen.findByRole('heading', { name: 'Performance by product' })
    const products = within(screen.getByRole('table', { name: 'Performance by product' }))
    const sports = within(products.getByRole('row', { name: /^Sports/ }))
    assert.ok(sports.getByText('10')); assert.ok(sports.getByText(/2,500\.00/)); assert.ok(sports.getByText(/850\.00/)); assert.ok(sports.getByText('50%'))
    // Matka has no topProducts row: its settled stake, and no bet count.
    const matka = within(products.getByRole('row', { name: /^Matka/ }))
    assert.equal(matka.getAllByText('—').length, 2); assert.ok(matka.getByText(/1,000\.00/)); assert.ok(matka.getByText('20%'))
    const flow = within(screen.getByRole('region', { name: 'Money flow' }))
    for (const text of ['5 txn', '2 txn', /15,000\.00/, /25,000\.00/]) assert.ok(flow.getByText(text), String(text))
    const bonus = within(screen.getByRole('region', { name: 'Bonus & referral' }))
    assert.ok(bonus.getByText('45%')); assert.ok(bonus.getByText('Referral'))
    const bets = within(screen.getByRole('table', { name: 'Recent bets' }))
    assert.ok(bets.getByText('Sports')); assert.ok(bets.getByText('Won')); assert.ok(bets.getByText(/100\.00/))
    const money = within(screen.getByRole('table', { name: 'Recent transactions' }))
    assert.ok(money.getByText('Deposit')); assert.ok(money.getByText('UPI')); assert.ok(money.getByText(/5,000\.00/)); assert.ok(money.getByText('Withdrawal'))
    const details = within(screen.getByRole('complementary', { name: 'Player details' }))
    for (const text of ['Gold', 'Verified · level 2', 'Low', 'INR', 'Sports', 'Casino', 'Matka', 'Login']) assert.ok(details.getAllByText(text).length, text)
    // Nothing on the Overview reads another tab's data.
    assert.equal(calls.some(call => ['PlayerTransactions', 'PlayerBets', 'PlayerBonuses', 'PlayerVip', 'PlayerNotes', 'PlayerDevices'].includes(String(call.name))), false)
  })
  test('the Overview links open their tabs, and Bets History keeps the period control', async () => {
    workspace(); await screen.findByRole('heading', { name: 'Performance by product' })
    fireEvent.click(within(screen.getByRole('region', { name: 'Recent bets' })).getByRole('button', { name: 'All bets' }))
    assert.equal(screen.getByRole('tab', { name: 'Bets History' }).getAttribute('aria-selected'), 'true')
    assert.ok(screen.getByRole('group', { name: 'Date range' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    fireEvent.click(await screen.findByRole('button', { name: 'VIP status' }))
    assert.equal(screen.getByRole('tab', { name: 'VIP Status' }).getAttribute('aria-selected'), 'true')
  })
  test('on a phone the product table keeps product, stake and P/L, with the bet count under each product', () => onPhone(async () => {
    workspace(); await screen.findByRole('heading', { name: 'Performance by product' })
    const table = within(screen.getByRole('table', { name: 'Performance by product' }))
    for (const name of ['Bets', 'Open stake', 'GGR', 'Share of stake']) assert.equal(table.queryByRole('columnheader', { name }), null, name)
    for (const name of ['Product', 'Stake', 'Player P/L']) assert.ok(table.getByRole('columnheader', { name }), name)
    assert.ok(table.getByText('10 bets')); assert.ok(table.getByText('16 bets'))
  }))
  test('a persisted unavailable tab renders the advertised Overview fallback', async () => {
    workspace(); await screen.findByRole('region', { name: 'Player summary' })
    await act(async () => { usePlayerProfileStore.getState().setActiveTab('p1', 'credit-management') })
    assert.equal(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected'), 'true')
    await screen.findByRole('heading', { name: 'Performance by product' })
  })
  test('financial wallet and bonus KPIs stay masked when view permissions are absent', async () => {
    useAuthStore.setState({ permissions: [{ domain: 'players.profile', actions: ['view'] }] }); workspace()
    await screen.findByRole('heading', { name: 'Performance by product' })
    assert.ok(screen.getAllByText('••••').length >= 4)
    const group = within(screen.getByRole('group', { name: 'Wallet type' })); fireEvent.click(group.getByRole('button', { name: 'Bonus' }))
    assert.ok(screen.getAllByText('••••').length >= 4)
  })
  test('date preset and explicit custom dates retain the PlayerOverview input contract', async () => {
    workspace(); await screen.findByRole('heading', { name: 'Performance by product' })
    const period = within(screen.getByRole('group', { name: 'Date range' }))
    fireEvent.click(period.getByRole('button', { name: 'Last week' }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'PlayerOverview' && (call.variables as { input: { dateRange: string } }).input.dateRange === '7d')))
    fireEvent.click(period.getByRole('button', { name: 'Custom' }))
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-09-01' } })
    fireEvent.change(await screen.findByLabelText('To'), { target: { value: '2026-09-30' } })
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'PlayerOverview' && JSON.stringify(call.variables).includes('"dateFrom":"2026-09-01"') && JSON.stringify(call.variables).includes('"dateTo":"2026-09-30"'))))
  })
  test('notes validate before submit, preserve exact payload and refresh only on confirmed success', async () => {
    workspace(); await screen.findByRole('region', { name: 'Player summary' }); await tab('Notes & Comms', 'Internal Notes')
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' })); const modal = within(screen.getByRole('dialog', { name: 'Add Note' }))
    fireEvent.click(modal.getByRole('button', { name: 'OK' })); await modal.findByText('Please enter content')
    assert.equal(calls.filter((call) => call.name === 'AddPlayerNote').length, 0)
    fireEvent.change(modal.getByLabelText(/^Content/), { target: { value: '  account reviewed  ' } }); fireEvent.change(modal.getByLabelText('Tags'), { target: { value: 'risk, risk, ,vip' } }); fireEvent.click(modal.getByLabelText('Pin this note')); fireEvent.click(modal.getByRole('button', { name: 'OK' }))
    await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog', { name: 'Add Note' })), false))
    assert.deepEqual(calls.find((call) => call.name === 'AddPlayerNote')?.variables, { input: { playerId: 'p1', content: '  account reviewed  ', category: null, tags: ['risk', 'risk', 'vip'], isPinned: true } })
  })
  test('refused note keeps its draft and dialog open', async () => {
    workspace({ refused: true }); await screen.findByRole('region', { name: 'Player summary' }); await tab('Notes & Comms', 'Internal Notes'); fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))
    const modal = within(screen.getByRole('dialog', { name: 'Add Note' })); fireEvent.change(modal.getByLabelText(/^Content/), { target: { value: 'keep draft' } }); fireEvent.click(modal.getByRole('button', { name: 'OK' })); await modal.findByText('Note refused')
    assert.equal((modal.getByLabelText(/^Content/) as HTMLTextAreaElement).value, 'keep draft')
  })
  test('credit decrease validates availability then uses original adjustment payload', async () => {
    workspace({ type: 'WHITELABEL_CREDIT' }); await screen.findByRole('region', { name: 'Player summary' }); await tab('Credit Management', 'Credit Management Actions'); fireEvent.click(screen.getByRole('button', { name: 'Decrease Credit Limit' }))
    const modal = within(screen.getByRole('dialog', { name: 'Decrease Credit Limit' }))
    fireEvent.change(modal.getByLabelText(/^Amount/), { target: { value: '95000' } }); fireEvent.click(modal.getByRole('button', { name: 'Decrease Limit' })); await modal.findByText('Cannot decrease more than available credit')
    assert.equal(calls.filter((call) => call.name === 'AdjustPlayerCredit').length, 0)
    fireEvent.change(modal.getByLabelText(/^Amount/), { target: { value: '500' } }); fireEvent.change(modal.getByLabelText('Notes'), { target: { value: 'exact reason' } }); fireEvent.click(modal.getByRole('button', { name: 'Decrease Limit' }))
    await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog', { name: 'Decrease Credit Limit' })), false))
    assert.deepEqual(calls.find((call) => call.name === 'AdjustPlayerCredit')?.variables, { input: { playerId: 'p1', adjustmentType: 'DECREASE', amount: 500, notes: 'exact reason' } })
  })
  test('no-handler responsible-gaming, session and VIP controls are explicit read-only', async () => {
    workspace(); await screen.findByRole('region', { name: 'Player summary' })
    await tab('Responsible Gaming', 'Betting Limits'); assert.ok((screen.getByRole('button', { name: 'Update Limits' }) as HTMLButtonElement).disabled)
    await tab('Devices & Sessions', 'Known Devices'); assert.ok((screen.getByRole('button', { name: 'Terminate All' }) as HTMLButtonElement).disabled)
    await tab('VIP Status', 'Current VIP Tier'); assert.ok((screen.getByRole('button', { name: 'Adjust Tier' }) as HTMLButtonElement).disabled)
    await tab('Bonuses', 'Bonuses'); assert.equal(screen.queryByRole('button', { name: 'Grant Bonus' }), null)
  })
  test('profile failure and denied access show the original recovery navigation', async () => {
    workspace({ missing: true }); await screen.findByText('Player not found'); assert.ok(screen.getByRole('button', { name: 'Retry' }))
  })
  test('credit players get the Credit Statement tab with players.credit:view, and not without it', async () => {
    const first = workspace({ type: 'AGENT_CREDIT' })
    await screen.findByRole('region', { name: 'Player summary' })
    await tab('Credit Statement', 'Credit statement')
    assert.equal(screen.queryByRole('tab', { name: 'Credit Management' }), null)
    assert.ok(calls.some((call) => call.name === 'PlayerCreditStatement'))
    first.unmount()
    useAuthStore.setState({ permissions: [{ domain: 'players.profile', actions: ['view'] }] })
    workspace({ type: 'AGENT_CREDIT' })
    await screen.findByRole('region', { name: 'Player summary' })
    assert.equal(screen.queryByRole('tab', { name: 'Credit Statement' }), null)
  })
  test('main view guard remains required for an admin without profile:view', async () => {
    useAuthStore.setState({ permissions: [] }); workspace(); await screen.findByText("You don't have permission to view player profiles. Please contact your administrator.")
    assert.equal(screen.queryByRole('region', { name: 'Player summary' }), null)
    assert.equal(calls.some(call => call.name === 'PlayerProfile' || call.name === 'PlayerOverview'), false)
  })
  test('a delayed Overview leaves the header and other tabs usable without preloading inactive tabs', async () => {
    const view = workspace({ holdOverview: true })
    await screen.findByRole('region', { name: 'Player summary' })
    assert.equal(calls.some(call => ['PlayerTransactions', 'PlayerBets', 'PlayerBonuses', 'PlayerVip'].includes(String(call.name))), false)
    await tab('Transactions', 'Transactions')
    await waitFor(() => assert.ok(calls.some(call => call.name === 'PlayerTransactions')))
    assert.equal(calls.filter(call => call.name === 'PlayerOverview').length, 1)
    await tab('Bonuses', 'Bonuses')
    await waitFor(() => assert.ok(calls.some(call => call.name === 'PlayerBonuses')))
    assert.equal(calls.some(call => call.name === 'PlayerVip'), false)
    await act(async () => view.releaseOverview())
    await tab('Overview', 'Performance by product')
    assert.equal(calls.filter(call => call.name === 'PlayerProfile').length, 1)
  })
  test('an Overview failure does not block tabs and Retry requests fresh stats', async () => {
    const state = { failOverview: true }
    workspace(state); await screen.findByText('Failed to load stats.')
    // The failure sits in the Overview; every other tab stays usable.
    await tab('Transactions', 'Transactions')
    state.failOverview = false
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.equal(Boolean(screen.queryByText('Failed to load stats.')), false))
    assert.equal(calls.filter(call => call.name === 'PlayerOverview').length, 2)
    await screen.findByRole('heading', { name: 'Performance by product' })
  })
})
