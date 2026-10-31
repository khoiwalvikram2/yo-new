import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ApolloLink, InMemoryCache, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { AGENT_PARENT, agentResponse, type AgentFixtureOptions } from '../../../test/agentPreviewData'
import CreatePage from './CreatePage'
import EditPage from './EditPage'

interface Creator { id: string; username: string; schemeType: string; levelIndex: number; allowedDomains: string[] }
const state = vi.hoisted(() => ({ allowed: true, agent: undefined as Creator | undefined, roles: [] as string[], success: vi.fn(), error: vi.fn(), guards: [] as unknown[] }))
vi.mock('@/shared/core/authStore', () => ({ useAuthStore: (selector: (value: { agent: typeof state.agent; roles: string[] }) => unknown) => selector({ agent: state.agent, roles: state.roles }) }))
vi.mock('@/shared/core/useWhitelabels', () => ({ useCurrentWhitelabel: () => ({ whitelabel: { id: 'wl-1' } }) }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ getWhitelabelBaseCurrencyCode: () => 'USD' }) }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: state.success, error: state.error } }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children, ...props }: { children: ReactNode }) => {
  state.guards.push(props); return state.allowed ? children : <div>Access denied</div>
} }))
let calls: { name: string; variables: Record<string, unknown> }[]
let options: AgentFixtureOptions
// Per-test answers that the shared fixture does not cover (a refused rate, a whitelabel with no sharing).
let override: ((operation: Operation) => FetchResult | undefined) | undefined
function Location() { const location = useLocation(); return <output aria-label="Location">{location.pathname}</output> }
function page(edit = false) {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    queueMicrotask(() => { observer.next(override?.(operation) ?? agentResponse(operation, options)); observer.complete() })
  }))
  return render(<MockedProvider link={link} cache={new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } })}>
    <MemoryRouter initialEntries={[edit ? '/agents/edit-1/edit' : '/agents/create']}><PageEyebrowProvider value="Agents">
      <Routes><Route path="/agents/create" element={<CreatePage />} /><Route path="/agents/:id/edit" element={<EditPage />} /><Route path="/agents" element={<div>Agent list</div>} /></Routes><Location />
    </PageEyebrowProvider></MemoryRouter></MockedProvider>)
}
beforeEach(() => { calls = []; options = {}; override = undefined; state.allowed = true; state.agent = undefined; state.roles = []; state.guards = []; vi.clearAllMocks() })
test('an existing agent can turn its final domain off and save with no new rate changes', async () => {
  page(true); await screen.findByLabelText('Username', { exact: false })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sports' }))
  next(); await screen.findByText('All products disabled')
  next(); await screen.findByText('None (all products disabled)')
  fireEvent.click(screen.getByRole('button', { name: 'Update Agent' })); await screen.findByText('Agent list')
  assert.deepEqual((calls.find(call => call.name === 'UpdateAgent')?.variables.input as { allowedDomains: string[] }).allowedDomains, [])
  assert.equal(calls.some(call => call.name === 'SetCommissionConfig' || call.name === 'SetSharingConfig'), false)
})
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(new RegExp(`^${label}\\s*\\*?$`)), { target: { value } }) }
function next() { fireEvent.click(screen.getByRole('button', { name: 'Next Step' })) }
async function fillBasic(scheme = 'COMMISSION') {
  change('Username', 'agent_one'); change('Password', 'fake-pass-1')
  if (scheme !== 'COMMISSION') fireEvent.click(screen.getByRole('radio', { name: new RegExp(scheme === 'CREDIT' ? 'Credit' : 'Sharing') }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sports' }))
  next(); await screen.findByRole('heading', { name: 'Scheme Configuration' })
}
describe('Agent Create/Edit wizard', () => {
  test('username availability scope remains normalized and unavailable names block progression', async () => {
    options.unavailable = true; page(); change('Username', 'agent_one'); change('Password', 'fake-pass-1')
    await screen.findByText('Username unavailable')
    assert.deepEqual(calls.find((call) => call.name === 'CheckAgentUsernameAvailable')?.variables, { username: 'agent_one' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sports' })); next()
    await waitFor(() => assert.ok(screen.getByRole('heading', { name: 'Basic Agent Information' })))
    assert.equal(calls.some((call) => call.name === 'CreateAgent'), false)
  })
  test('preserves create guard, staged validation and failed-form values', async () => {
    options.failSave = true; page()
    assert.deepEqual(state.guards[0], { required: [{ domain: 'agents.create', actions: ['view', 'create'] }], bypassForAgents: true })
    next(); await screen.findByText('Please enter username')
    await fillBasic(); change('Sports commission rate', '10'); next()
    await screen.findByRole('heading', { name: 'Review Agent Details' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }))
    await screen.findByText('Create refused')
    fireEvent.click(screen.getByRole('button', { name: 'Previous' })); fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    assert.equal((screen.getByLabelText('Username', { exact: false }) as HTMLInputElement).value, 'agent_one')
  })
  test('create sends exact root account and fractional commission input', async () => {
    page(); await fillBasic(); change('Sports commission rate', '10')
    const previousNext = screen.getByRole('button', { name: 'Next Step' })
    next(); await screen.findByRole('heading', { name: 'Review Agent Details' })
    assert.equal(previousNext.isConnected, false)
    assert.equal(calls.some((call) => call.name === 'CreateAgent'), false)
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }))
    await screen.findByText('Agent list')
    assert.deepEqual(calls.find((call) => call.name === 'CreateAgent')?.variables.input, { username: 'agent_one', password: 'fake-pass-1', phone: null, schemeType: 'COMMISSION', allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: null, levelIndex: 1, tallyEnabled: true, tallyDomains: [], currency: 'USD' })
    const rate = calls.find((call) => call.name === 'SetCommissionConfig')?.variables.input as Record<string, unknown>
    assert.equal(rate.agentId, 'created-1'); assert.equal(rate.commissionRate, 0.1); assert.equal(rate.domain, 'sports'); assert.equal(typeof rate.effectiveFrom, 'string')
  })
  test('credit creation retains zero sharing rate instead of dropping it', async () => {
    page(); await fillBasic('CREDIT'); change('Sports sharing rate', '0'); next(); await screen.findByRole('heading', { name: 'Review Agent Details' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' })); await screen.findByText('Agent list')
    const input = calls.find((call) => call.name === 'SetSharingConfig')?.variables.input as Record<string, unknown>
    assert.equal(input.shareRate, 0); assert.equal(calls.some((call) => call.name === 'SetCommissionConfig'), false)
  })
  test('creator scheme/parent/domain restrictions and parent rate cap remain', async () => {
    state.agent = { ...AGENT_PARENT, username: AGENT_PARENT.username, levelIndex: 2 }
    page(); await screen.findByText('Only the selected parent\'s domains are available: sports')
    assert.equal(screen.queryByRole('radio'), null); assert.equal(screen.queryByRole('checkbox', { name: 'Casino' }), null)
    await fillBasic(); await waitFor(() => assert.ok(calls.some((call) => call.name === 'GetParentAgent')))
    const rate = screen.getByLabelText('Sports commission rate', { exact: false }) as HTMLInputElement
    assert.equal(rate.getAttribute('aria-disabled'), null)
    change('Sports commission rate', '10'); next(); await screen.findByRole('heading', { name: 'Review Agent Details' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' })); await screen.findByText('Agent list')
    const input = calls.find((call) => call.name === 'CreateAgent')?.variables.input as Record<string, unknown>
    assert.equal(input.parentAgentId, 'parent-1'); assert.equal(input.levelIndex, 3)
  })
  test('maximum sharing depth and denied edit start no queries', async () => {
    state.agent = { ...AGENT_PARENT, username: AGENT_PARENT.username, schemeType: 'SHARING', levelIndex: 4 }; const view = page()
    assert.ok(screen.getByText('Maximum hierarchy depth (4 levels) reached. You cannot create sub-agents.')); assert.equal(calls.length, 0)
    view.unmount(); state.agent = undefined; state.allowed = false; page(true); assert.ok(screen.getByText('Access denied')); assert.equal(calls.length, 0)
  })
  test('edit seeds percentage units and sends existing supported settings only', async () => {
    page(true); await screen.findByLabelText('Username', { exact: false })
    assert.equal((screen.getByLabelText('Username', { exact: false }) as HTMLInputElement).disabled, true)
    next(); await screen.findByRole('heading', { name: 'Scheme Configuration' })
    assert.equal((screen.getByLabelText('Sports commission rate', { exact: false }) as HTMLInputElement).value, '10.00')
    next(); await screen.findByRole('heading', { name: 'Review Agent Details' })
    fireEvent.click(screen.getByRole('button', { name: 'Update Agent' })); await screen.findByText('Agent list')
    assert.deepEqual(calls.find((call) => call.name === 'UpdateAgent')?.variables.input, { id: 'edit-1', allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: 'parent-1', levelIndex: 3, tallyEnabled: false, tallyDomains: [] })
    assert.equal((calls.find((call) => call.name === 'SetCommissionConfig')?.variables.input as Record<string, unknown>).commissionRate, 0.1)
  })
  test('the scheme is read-only on edit, and an edited commission rate can be lowered to 0', async () => {
    page(true); await screen.findByLabelText('Username', { exact: false })
    for (const radio of screen.getAllByRole('radio')) assert.equal((radio as HTMLInputElement).disabled, true)
    next(); await screen.findByRole('heading', { name: 'Scheme Configuration' })
    assert.equal(screen.getByRole('switch', { name: 'Cross-Domain Tally' }).getAttribute('aria-checked'), 'false')
    change('Sports commission rate', '0'); next(); await screen.findByRole('heading', { name: 'Review Agent Details' })
    fireEvent.click(screen.getByRole('button', { name: 'Update Agent' })); await screen.findByText('Agent list')
    assert.equal((calls.find((call) => call.name === 'SetCommissionConfig')?.variables.input as Record<string, unknown>).commissionRate, 0)
  })
  test('an admin can create a sub-agent under an active parent of the same scheme', async () => {
    page(); change('Username', 'agent_one'); change('Password', 'fake-pass-1')
    fireEvent.click(screen.getByRole('radio', { name: /Sharing/ }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'GetSharingAgentsForBasicInfo' && call.variables.schemeType === 'SHARING' && call.variables.status === 'ACTIVE')))
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Parent agent' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: /Parent partner/ }))
    await screen.findByText('Only the selected parent\'s domains are available: sports')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sports' }))
    next(); await screen.findByRole('heading', { name: 'Scheme Configuration' })
    change('Sports sharing rate', '10'); next(); await screen.findByRole('heading', { name: 'Review Agent Details' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' })); await screen.findByText('Agent list')
    const input = calls.find((call) => call.name === 'CreateAgent')?.variables.input as Record<string, unknown>
    assert.equal(input.parentAgentId, 'parent-1'); assert.equal(input.levelIndex, 3); assert.equal(input.tallyEnabled, false)
  })
  test('a CREDIT agent can be given a credit limit at creation', async () => {
    page(); await fillBasic('CREDIT'); change('Credit limit', '2500'); change('Sports sharing rate', '5'); next()
    await screen.findByRole('heading', { name: 'Review Agent Details' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' })); await screen.findByText('Agent list')
    assert.equal((calls.find((call) => call.name === 'CreateAgent')?.variables.input as Record<string, unknown>).creditLimit, 2500)
  })
  test('a refused rate keeps the created agent and a retry sends only the rate, never the create again', async () => {
    let refuse = true
    override = (operation) => operation.operationName === 'SetCommissionConfig' && refuse ? { errors: [{ message: 'Rate above parent' }] } : undefined
    page(); await fillBasic(); change('Sports commission rate', '10'); next(); await screen.findByRole('heading', { name: 'Review Agent Details' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }))
    await screen.findByRole('heading', { name: 'Finish Agent Setup' })
    assert.ok(screen.getByText(/The sports rate could not be saved: Rate above parent/))
    assert.equal(screen.getByRole('link', { name: 'Edit agent' }).getAttribute('href'), '/agents/created-1/edit')
    refuse = false; fireEvent.click(screen.getByRole('button', { name: 'Retry saving rates' })); await screen.findByText('Agent list')
    assert.equal(calls.filter((call) => call.name === 'CreateAgent').length, 1)
    assert.equal(calls.filter((call) => call.name === 'SetCommissionConfig').length, 2)
    assert.equal((calls.filter((call) => call.name === 'SetCommissionConfig')[1].variables.input as Record<string, unknown>).agentId, 'created-1')
  })
  test('a whitelabel domain with 0 sharing counts as unconfigured and blocks a root agent', async () => {
    state.roles = ['Whitelabel Admin']
    override = (operation) => operation.operationName === 'GetWhitelabel' ? { data: { whitelabel: { __typename: 'Whitelabel', id: 'wl-1', sharingRates: [{ __typename: 'AgentDomainRate', domain: 'sports', rate: 0 }] } } } : undefined
    // Wait for the whitelabel's base currency first: it lands in the form and would restart Next's validation.
    page(); await screen.findByText('Set to your whitelabel\'s base currency: USD'); await fillBasic('SHARING')
    await screen.findByText('Whitelabel has no sharing configured for sports. Cannot assign.')
    change('Sports sharing rate', '10'); next()
    await waitFor(() => assert.ok(screen.getAllByText(/Whitelabel has no sharing configured for sports/).length >= 2))
    assert.equal(screen.queryByRole('heading', { name: 'Review Agent Details' }), null)
  })
  test('an agent edits a sub-agent without level, parent or tally, and cannot open its own edit', async () => {
    state.agent = { ...AGENT_PARENT, username: AGENT_PARENT.username, levelIndex: 2 }
    page(true); await screen.findByLabelText('Username', { exact: false })
    assert.equal(state.guards.length, 0)
    next(); await screen.findByRole('heading', { name: 'Scheme Configuration' })
    assert.equal(screen.queryByRole('switch', { name: 'Cross-Domain Tally' }), null)
    assert.ok(screen.getByText(/Only an administrator can change the tally/))
    next(); await screen.findByRole('heading', { name: 'Review Agent Details' })
    fireEvent.click(screen.getByRole('button', { name: 'Update Agent' })); await screen.findByText('Agent list')
    assert.deepEqual(calls.find((call) => call.name === 'UpdateAgent')?.variables.input, { id: 'edit-1', allowedDomains: ['sports'], status: 'ACTIVE' })
  })
  test('an agent opening its own edit page is refused before any query', () => {
    state.agent = { ...AGENT_PARENT, id: 'edit-1', username: 'existing_agent', levelIndex: 3 }
    page(true); assert.ok(screen.getByText('You cannot edit your own account')); assert.equal(calls.length, 0)
  })
})

