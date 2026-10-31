import { beforeEach, afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ConfirmHost } from '@/ui/components/ConfirmHost'
import { confirmQueue } from '@/ui/components/confirm'
import BonusViewPage from './BonusViewPage'
import { bonusCampaignFixture, bonusDetailResponse, type BonusFixtureState } from '../../../../test/bonusDetailPreviewData'

const guard = vi.hoisted(() => ({ allowed: true, required: [] as unknown[] }))
const feedback = vi.hoisted(() => ({ toast: vi.fn(), amounts: vi.fn() }))
vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: unknown[]; children: ReactNode }) => {
    guard.required = required
    return guard.allowed ? children : <div role="alert">Access denied</div>
  },
}))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (amount: number, code: string) => { feedback.amounts(amount, code); return `${code} ${amount}` } }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string) => value, formatDateTime: (value: string) => value }) }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

let state: BonusFixtureState
let calls: Array<{ name: string; variables: Record<string, unknown> }>
function mount() {
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    const timer = setTimeout(() => {
      if (state.queryError && operation.operationName === 'GetBonusCampaign') { observer.error(new Error('Campaign unavailable')); return }
      try { observer.next(bonusDetailResponse(operation, state)); observer.complete() } catch (error) { observer.error(error) }
    }, 1)
    return () => clearTimeout(timer)
  })) })
  render(<ApolloProvider client={client}><MemoryRouter initialEntries={['/bonuses/42']}><Routes>
    <Route path="/bonuses/:id" element={<BonusViewPage />} /><Route path="/bonuses" element={<div>Bonus list</div>} /><Route path="/bonuses/:id/edit" element={<div>Edit campaign</div>} />
  </Routes><ConfirmHost /></MemoryRouter></ApolloProvider>)
}
const cloneCampaign = () => JSON.parse(JSON.stringify(bonusCampaignFixture)) as Record<string, unknown>
beforeEach(() => { state = { campaign: cloneCampaign() }; calls = []; guard.allowed = true; feedback.toast.mockClear(); feedback.amounts.mockClear() })
afterEach(() => { cleanup(); let request = confirmQueue.current(); while (request) { confirmQueue.settle(request.id, false); request = confirmQueue.current() } })
async function tab(name: string) { fireEvent.click(await screen.findByRole('tab', { name })) }
async function pick(label: string, option: string) {
  const input = screen.getByRole('combobox', { name: label })
  fireEvent.click(input); fireEvent.change(input, { target: { value: option } })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}
function mutation(name: string) { return calls.filter(call => call.name === name).at(-1)?.variables }

test('guards bonuses.detail view and does not query for a denied user', () => {
  guard.allowed = false; mount()
  assert.ok(screen.getByRole('alert')); assert.equal(calls.length, 0)
  assert.deepEqual(guard.required, [{ domain: 'bonuses.detail', actions: ['view'] }])
})
test('campaign details retain date, distribution, amount and tenant currency semantics with edit/back navigation', async () => {
  mount(); await screen.findByRole('heading', { name: 'Weekend reload rewards', level: 1 })
  assert.ok(screen.getByText('Total Amount in Bonus Wallet')); assert.ok(screen.getByText('7 days after award')); assert.ok(screen.getByText('3.00x'))
  assert.ok(screen.getByText('25%')); assert.ok(screen.getByText('INR 250000'))
  assert.ok(feedback.amounts.mock.calls.some(([amount, code]) => amount === 1000 && code === 'INR'))
  assert.deepEqual(calls[0], { name: 'GetBonusCampaign', variables: { id: '42' } })
  fireEvent.click(screen.getByRole('button', { name: 'Edit' })); assert.ok(screen.getByText('Edit campaign'))
})
test('not-found and load error states stay actionable; sports campaigns omit unsupported game tabs', async () => {
  state.campaign = null; mount(); await screen.findByText('Campaign not found')
  fireEvent.click(screen.getByRole('link', { name: 'Back to List' })); assert.ok(screen.getByText('Bonus list'))
  cleanup(); calls = []; state = { campaign: null, queryError: true }; mount()
  await screen.findByText('Campaign unavailable'); assert.ok(screen.getByRole('button', { name: 'Retry' }))
  cleanup(); state = { campaign: { ...cloneCampaign(), domain: 'sports' } }; mount()
  await screen.findByRole('heading', { name: 'Weekend reload rewards', level: 1 })
  assert.equal(screen.queryByRole('tab', { name: 'Casino Games' }), null)
  assert.equal(screen.queryByRole('tab', { name: 'Matka Games' }), null)
  assert.equal(screen.queryByRole('tab', { name: 'Bundles' }), null)
  assert.ok(screen.getByRole('tab', { name: 'Exclusion List' }))
})
test('casino selection adds games and default weights, then shows added games with bounded server-page variables', async () => {
  mount(); await tab('Casino Games')
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Dragon Slots' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add Selected (1)' }))
  await waitFor(() => assert.deepEqual(mutation('SaveBonusCampaignGames'), { campaignId: '42', gameIds: ['101', '102'], gameWeights: { 101: 2, 102: 1 } }))
  await screen.findByRole('tab', { name: 'Added Games (2)', selected: true })
  const inputs = calls.filter(call => call.name === 'CasinoSelectionGames').map(call => call.variables.input)
  assert.deepEqual(inputs[0], { excludeGameIds: ['101'], page: 1, pageSize: 20 })
  assert.equal(calls.some(call => call.name === 'CasinoGames'), false)

})
test('casino provider/vendor search and provider-matched bundles preserve request and merge precedence', async () => {
  mount(); await tab('Casino Games'); await screen.findByText('Dragon Slots')
  await pick('Provider', 'Primary Provider')
  await waitFor(() => assert.ok(calls.some(call => call.name === 'CasinoSelectionGameIds' && call.variables.providerId === 'provider1')))
  await pick('Bundle', 'Weekend favourites (2 games)')
  fireEvent.click(screen.getByRole('button', { name: 'Add Bundle' }))
  await waitFor(() => assert.deepEqual(mutation('SaveBonusCampaignGames'), { campaignId: '42', gameIds: ['101', '102'], gameWeights: { 101: 2, 102: 0.4 } }))
})
test('casino single weight and confirmed removal keep all other game weights intact', async () => {
  mount(); await tab('Casino Games'); await tab('Added Games (1)')
  fireEvent.click(await screen.findByRole('button', { name: 'Set Weight' }))
  const dialog = screen.getByRole('dialog', { name: 'Set Game Weight' })
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Weight (0-100)' }), { target: { value: '4.5' } })
  fireEvent.blur(within(dialog).getByRole('textbox', { name: 'Weight (0-100)' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => assert.deepEqual(mutation('SaveBonusCampaignGames'), { campaignId: '42', gameIds: ['101'], gameWeights: { 101: 4.5 } }))
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  assert.equal(calls.filter(call => call.name === 'SaveBonusCampaignGames').length, 1)
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
  await waitFor(() => assert.deepEqual(mutation('SaveBonusCampaignGames'), { campaignId: '42', gameIds: [], gameWeights: {} }))
})
test('Matka add initializes seven bid-type weights and the configuration drawer preserves existing weights', async () => {
  mount(); await tab('Matka Games')
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Mumbai Night' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add Selected (1)' }))
  await waitFor(() => assert.deepEqual(mutation('SaveBonusCampaignMatkas'), { campaignId: '42', matkaIds: ['m1', 'm2'], matkaBidTypeWeights: { m1: { SINGLE: 2 }, m2: { SINGLE: 1, JODI: 1, SINGLE_PAANA: 1, DOUBLE_PAANA: 1, TRIPLE_PAANA: 1, HALF_SANGAM: 1, FULL_SANGAM: 1 } } }))
  await screen.findByRole('tab', { name: 'Added Markets (2)', selected: true })
  fireEvent.click(screen.getAllByRole('button', { name: 'Configure Weights' })[0])
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'JODI' }), { target: { value: '3' } }); fireEvent.blur(within(dialog).getByRole('textbox', { name: 'JODI' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save Weights' }))
  await waitFor(() => assert.equal(((mutation('SaveBonusCampaignMatkas')?.matkaBidTypeWeights as Record<string, Record<string, number>>).m1).JODI, 3))
})
test('domain bundle apply uses confirmation, preserves games and overrides bundle weights as before', async () => {
  mount(); await tab('Bundles'); await screen.findByText('Weekend favourites')
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  assert.equal(mutation('SaveBonusCampaignGames'), undefined)
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes' }))
  await waitFor(() => assert.deepEqual(mutation('SaveBonusCampaignGames'), { campaignId: '42', gameIds: ['101', '102'], gameWeights: { 101: 0.3, 102: 0.4 } }))
  await tab('Sports'); await screen.findByText('Sports bundle support is coming soon. Currently, only Casino and Matka bundles are available.')
  assert.ok(calls.some(call => call.name === 'CasinoGameBundles' && call.variables.domain === 'sports'))
})
test('exclusion player transfers preserve other campaign rules and existing agent ids', async () => {
  mount(); await tab('Exclusion List')
  const table = await screen.findByRole('table', { name: 'Eligible players' })
  fireEvent.click(await within(table).findByRole('checkbox', { name: 'Select alice' }))
  fireEvent.click(screen.getByRole('button', { name: "→ Won't get bonus (1)" }))
  await waitFor(() => assert.deepEqual(mutation('UpdateBonusCampaign'), { input: { id: '42', rulesJson: { excludedPlayerIds: ['p2', 'p1'], excludedAgentIds: ['a2'], preservedRule: 'keep' } } }))
  const excluded = screen.getByRole('table', { name: 'Excluded players' })
  fireEvent.click(await within(excluded).findByRole('checkbox', { name: 'Select alice' }))
  fireEvent.click(screen.getByRole('button', { name: '→ Gets bonus (1)' }))
  await waitFor(() => assert.deepEqual((mutation('UpdateBonusCampaign')?.input as { rulesJson: { excludedPlayerIds:string[] } }).rulesJson.excludedPlayerIds, ['p2']))
})
test('agent exclusion includes downline players and keeps unchanged campaign rules', async () => {
  mount(); await tab('Exclusion List'); await tab('Agents (1 excluded)')
  const table = await screen.findByRole('table', { name: 'Eligible agents' })
  fireEvent.click(await within(table).findByRole('checkbox', { name: 'Select Root partner' }))
  fireEvent.click(screen.getByRole('button', { name: "→ Won't get bonus (1)" }))
  await waitFor(() => assert.deepEqual(mutation('UpdateBonusCampaign'), { input: { id: '42', rulesJson: { excludedPlayerIds: ['p2', 'p1'], excludedAgentIds: ['a2', 'a1'], preservedRule: 'keep' } } }))
  assert.ok(calls.some(call => call.name === 'AgentExclusionImpact' && call.variables.agentId === 'a1'))
})
test('rejected exclusion responses do not announce a successful save', async () => {
  state.refused = true; mount(); await tab('Exclusion List')
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select alice' }))
  fireEvent.click(screen.getByRole('button', { name: "→ Won't get bonus (1)" }))
  await waitFor(() => assert.ok(feedback.toast.mock.calls.some(([value]) => value.tone === 'error')))
  assert.equal(feedback.toast.mock.calls.some(([value]) => value.tone === 'ok'), false)
})
test('rejected game weight save leaves drawer and draft visible for correction', async () => {
  state.refused = true; mount(); await tab('Casino Games'); await tab('Added Games (1)')
  fireEvent.click(await screen.findByRole('button', { name: 'Set Weight' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
  await waitFor(() => assert.ok(feedback.toast.mock.calls.some(([value]) => value.tone === 'error')))
  assert.ok(screen.getByRole('dialog')); assert.equal(feedback.toast.mock.calls.some(([value]) => value.tone === 'ok'), false)
})

test('casino bulk weight and removal update only selected added games', async () => {
  state.campaign = { ...cloneCampaign(), casinoGameIds: ['101', '102'], casinoGameWeights: { 101: 2, 102: 4 } }
  mount(); await tab('Casino Games'); await tab('Added Games (2)')
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Dragon Slots' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Bulk weight' }), { target: { value: '5' } }); fireEvent.blur(screen.getByRole('textbox', { name: 'Bulk weight' }))
  fireEvent.click(screen.getByRole('button', { name: 'Set Weight (1)' }))
  await waitFor(() => assert.deepEqual(mutation('SaveBonusCampaignGames'), { campaignId: '42', gameIds: ['101', '102'], gameWeights: { 101: 2, 102: 5 } }))
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: 'Remove (1)' }), null))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dragon Slots' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove (1)' }))
  await waitFor(() => assert.deepEqual(mutation('SaveBonusCampaignGames'), { campaignId: '42', gameIds: ['101'], gameWeights: { 101: 2 } }))
})
test('player exclusion upload resolves deduplicated phones and merges tenant-scoped ids without dropping rules', async () => {
  mount(); await tab('Exclusion List'); await screen.findByRole('checkbox', { name: 'Select alice' })
  const file = new File(['9100000001\n9100000001\n9999999999'], 'excluded.txt', { type: 'text/plain' })
  Object.defineProperty(file, 'text', { value: async () => '9100000001\n9100000001\n9999999999' })
  fireEvent.change(screen.getByLabelText('Upload player exclusions'), { target: { files: [file] } })
  await waitFor(() => assert.ok(calls.some(call => call.name === 'UserIdsByPhones')))
  assert.deepEqual(calls.find(call => call.name === 'UserIdsByPhones')?.variables, { phones: ['9100000001', '9999999999'] })
  await waitFor(() => assert.deepEqual(mutation('UpdateBonusCampaign'), { input: { id: '42', rulesJson: { excludedPlayerIds: ['p2', 'p1'], excludedAgentIds: ['a2'], preservedRule: 'keep' } } }))
  assert.ok(feedback.toast.mock.calls.some(([value]) => value.message.includes('1 number(s) could not be matched.')))
})
test('unresolvable exclusion ids remain stored and visible through the warning rather than placeholder users', async () => {
  state.campaign = { ...cloneCampaign(), rulesJson: { excludedPlayerIds: ['unresolved'], excludedAgentIds: ['unresolved'] } }
  mount(); await tab('Exclusion List')
  await screen.findByText('1 of 1 excluded player(s) could not be resolved (may be deleted or from another tenant). They remain excluded.')
  await tab('Agents (1 excluded)')
  await screen.findByText('1 of 1 excluded agent(s) could not be resolved. They remain excluded.')
  assert.equal(mutation('UpdateBonusCampaign'), undefined)
})
