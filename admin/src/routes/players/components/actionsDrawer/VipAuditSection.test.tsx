import { afterEach, beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloLink, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { useAuthStore } from '@/shared/core/authStore'
import type { Player } from '@/shared/types/player'
import { VipAuditSection } from './VipAuditSection'

const mocks = vi.hoisted(() => ({ tiersError: null as Error | null, success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: mocks.success, error: mocks.error } }))
vi.mock('@/modules/vip/hooks/useVIP', () => ({
  useVIPTiers: () => ({ loading: false, error: mocks.tiersError, data: mocks.tiersError ? undefined : { vipTiers: [
    { id: 'bronze', name: 'Bronze', level: 1, status: 'active' },
    { id: 'gold', name: 'Gold', level: 3, status: 'active' },
    { id: 'retired', name: 'Retired', level: 9, status: 'inactive' },
  ] } }),
}))

let calls: Record<string, unknown>[]
let reject: string | null
const player = (overrides: Partial<Player> = {}): Player => ({ id: '123', name: 'Fixture', phone: '000', playerType: 'REGULAR', status: 'ACTIVE',
  vipTierId: 'bronze', vipTierName: 'Bronze', vipTierMode: 'AUTO', ...overrides } as Player)
function view(user = player(), onRefetch = vi.fn(), setSavingFlag = vi.fn()) {
  const link = new ApolloLink(operation => new Observable(observer => {
    calls.push(operation.variables)
    Promise.resolve().then(() => {
      if (reject) { observer.error(new Error(reject)); return }
      const id = operation.variables.vipTierId as string | null
      observer.next({ data: { setUserVipTier: { __typename: 'User', id: user.id, vipTierId: id ?? 'bronze', vipTierName: id === 'gold' ? 'Gold' : 'Bronze' } } })
      observer.complete()
    })
  }))
  render(<MockedProvider link={link}><VipAuditSection user={user} saving={{}} setSavingFlag={setSavingFlag} onRefetch={onRefetch} /></MockedProvider>)
  return { onRefetch, setSavingFlag }
}
const field = () => screen.getByRole('combobox', { name: 'VIP Tier' }) as HTMLInputElement
async function choose(label: string) {
  fireEvent.keyDown(field(), { key: 'ArrowDown' })
  await screen.findByRole('listbox')
  fireEvent.click(screen.getByRole('option', { name: label }))
}

beforeEach(() => {
  calls = []; reject = null; mocks.tiersError = null; mocks.success.mockClear(); mocks.error.mockClear()
  useAuthStore.setState({ agent: undefined, isReadOnly: false, permissions: [{ domain: 'players.vip', actions: ['view', 'update'] }] })
})
afterEach(cleanup)

test('Automatic players show the Automatic option; only active tiers are offered', async () => {
  view()
  assert.equal(field().value, 'Automatic — monthly approved deposits')
  fireEvent.keyDown(field(), { key: 'ArrowDown' })
  await screen.findByRole('listbox')
  const labels = screen.getAllByRole('option').map(option => option.textContent)
  assert.deepEqual(labels, ['Automatic — monthly approved deposits', 'Bronze (L1)', 'Gold (L3)'])
})

test('choosing a tier saves it as a manual assignment and refetches the drawer', async () => {
  const { onRefetch, setSavingFlag } = view()
  await choose('Gold (L3)')
  await waitFor(() => assert.equal(onRefetch.mock.calls.length, 1))
  assert.deepEqual(calls, [{ id: '123', vipTierId: 'gold' }])
  assert.deepEqual(mocks.success.mock.calls[0], ['VIP tier updated'])
  assert.deepEqual(setSavingFlag.mock.calls, [['vip-123', true], ['vip-123', false]])
})

test('choosing Automatic clears the manual tier by sending null', async () => {
  const { onRefetch } = view(player({ vipTierId: 'gold', vipTierName: 'Gold', vipTierMode: 'MANUAL' }))
  assert.equal(field().value, 'Gold (L3)')
  await choose('Automatic — monthly approved deposits')
  await waitFor(() => assert.equal(onRefetch.mock.calls.length, 1))
  assert.deepEqual(calls, [{ id: '123', vipTierId: null }])
  assert.deepEqual(mocks.success.mock.calls[0], ['Automatic monthly tier enabled'])
})

test('a rejected change shows the server message, does not refetch and releases the saving flag', async () => {
  reject = 'VIP tiers and deposits are unavailable for credit-agent players'
  const { onRefetch, setSavingFlag } = view()
  await choose('Gold (L3)')
  await waitFor(() => assert.equal(mocks.error.mock.calls.length, 1))
  assert.deepEqual(mocks.error.mock.calls[0], ['VIP tiers and deposits are unavailable for credit-agent players'])
  assert.equal(onRefetch.mock.calls.length, 0)
  assert.deepEqual(setSavingFlag.mock.calls.at(-1), ['vip-123', false])
})

test('admins without players.vip update cannot change the tier', () => {
  useAuthStore.setState({ permissions: [{ domain: 'players.vip', actions: ['view'] }] })
  view()
  assert.ok(field().disabled)
  fireEvent.keyDown(field(), { key: 'ArrowDown' })
  assert.equal(screen.queryByRole('listbox'), null)
  assert.equal(calls.length, 0)
})

test('a failed tier list blocks saving instead of offering a partial list', () => {
  mocks.tiersError = new Error('network down')
  view()
  assert.ok(screen.getByText('Unable to load VIP tiers. Try again before saving.'))
  assert.ok(field().disabled)
})

test('the deposit access message from the server is shown to the admin', () => {
  view(player({ vipDepositAccess: { eligible: true, message: 'Automatic tier: Bronze. Monthly approved deposits: 0.' } }))
  assert.ok(screen.getByText('Automatic tier: Bronze. Monthly approved deposits: 0.'))
})
