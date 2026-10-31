import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import type { Matka } from '@/modules/matka/types'
import { SettingsDrawer } from './SettingsDrawer'
import type { SettingsValues } from '../matkaManagementModel'

interface Call {
  operationName: string
  variables: Record<string, unknown>
}

vi.mock('@/modules/vip/hooks/useVIP', () => ({
  useVIPTiers: () => ({
    data: { vipTiers: [{ id: 'vip-1', name: 'Gold', color: 'ignored' }] },
    loading: false,
  }),
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({ getCurrencySymbol: () => '₹' }),
}))

const MATKA = {
  id: 'm1',
  name: 'Kalyan',
  code: 'KLN',
  description: 'Primary market',
  timezone: 'Asia/Kolkata',
  schedule: {},
  status: 'active',
  limits: { minBet: 10, maxBet: 1000, exposureDaily: 5000, exposureWeekly: 20000, exposureCap: 50000 },
  visibility: {},
  priority: 1,
  settings: { riskLevel: 'medium', riskThreshold: 750 },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} satisfies Matka

const RULE = {
  __typename: 'MatkaBidRule',
  id: 'rule-1',
  matkaId: 'm1',
  matkaType: 'worli',
  marketName: 'Kalyan',
  marketSession: null,
  bidType: 'JODI',
  percentage: 25,
  includeAll: false,
  includedPlayers: { playerIds: ['u1', 'u2'] },
  minStake: null,
  maxStake: null,
  exposureCap: null,
  status: 'active',
  priority: 1,
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

let calls: Call[]
const callbacks = {
  close: vi.fn(),
  save: vi.fn<(values: SettingsValues) => Promise<void>>(async () => undefined),
  status: vi.fn<(value: boolean | 'suspend') => void>(),
}

function resultFor(operation: Operation): FetchResult {
  switch (operation.operationName) {
    case 'MatkaBidRules':
      return { data: { matkaBidRules: { __typename: 'MatkaBidRulePage', items: [RULE], total: 1 } } }
    case 'CreateMatkaBidRule':
      return { data: { createMatkaBidRule: { __typename: 'MatkaBidRule', id: 'rule-2', matkaId: 'm1' } } }
    case 'UpdateMatkaBidRule':
      return {
        data: {
          updateMatkaBidRule: {
            __typename: 'MatkaBidRule', id: 'rule-1', status: operation.variables.patch
              ? (operation.variables.patch as { status: string }).status
              : 'active',
            percentage: 25, minStake: null, maxStake: null, exposureCap: null,
            includedPlayers: { playerIds: ['u1', 'u2'] }, notes: null,
          },
        },
      }
    case 'DeleteMatkaBidRule':
      return { data: { deleteMatkaBidRule: true } }
    default:
      throw new Error(`unexpected operation ${operation.operationName}`)
  }
}

function link() {
  return new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
    calls.push({ operationName: operation.operationName, variables: { ...operation.variables } })
    Promise.resolve().then(() => resultFor(operation)).then((result) => {
      observer.next(result)
      observer.complete()
    }, (error: unknown) => observer.error(error))
  }))
}

interface RenderOptions {
  mode?: 'single' | 'bulk'
  matka?: Matka | null
  selectedMatkas?: Matka[]
  initialTab?: string
  drawerActive?: boolean | 'suspend'
}

function renderDrawer({
  mode = 'single',
  matka = MATKA,
  selectedMatkas = [],
  initialTab,
  drawerActive = true,
}: RenderOptions = {}) {
  return render(
    <MockedProvider link={link()}>
      <SettingsDrawer
        open
        onClose={callbacks.close}
        mode={mode}
        matka={matka}
        selectedMatkas={selectedMatkas}
        drawerActive={drawerActive}
        setDrawerActive={callbacks.status}
        onSave={callbacks.save}
        saving={false}
        initialTab={initialTab}
      />
    </MockedProvider>,
  )
}

beforeEach(() => {
  calls = []
  callbacks.close.mockReset()
  callbacks.save.mockClear()
  callbacks.status.mockReset()
})

describe('SettingsDrawer', () => {
  test('hydrates single settings, preserves labels and uses initialTab when the drawer opens', async () => {
    renderDrawer({ initialTab: 'bid' })
    const drawer = await screen.findByRole('dialog', { name: 'Edit Matka Settings' })
    assert.ok(within(drawer).getByText('Editing: Kalyan'))
    assert.ok(within(drawer).getByText('Single Edit'))
    assert.equal(within(drawer).getByRole('tab', { name: 'Bid Settings' }).getAttribute('aria-selected'), 'true')
    assert.equal(callbacks.status.mock.calls[0]?.[0], true)
    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'MatkaBidRules')))
    assert.deepEqual(calls.find((call) => call.operationName === 'MatkaBidRules')?.variables, {
      filters: { matkaId: 'm1', page: 1, limit: 20 },
    })

    fireEvent.click(within(drawer).getByRole('tab', { name: 'Stake Limits' }))
    assert.equal((within(drawer).getByRole('textbox', { name: 'Min Stake' }) as HTMLInputElement).value, '10')
    assert.equal((within(drawer).getByRole('textbox', { name: 'Max Stake' }) as HTMLInputElement).value, '1000')
    assert.equal((within(drawer).getByRole('combobox', { name: 'VIP Tier' }) as HTMLSelectElement).value, 'default')
    assert.ok(within(drawer).getByRole('option', { name: 'Gold' }))
  })

  test('submits the exact settings values and reset restores the record', async () => {
    renderDrawer()
    const drawer = await screen.findByRole('dialog', { name: 'Edit Matka Settings' })
    const minStake = within(drawer).getByRole('textbox', { name: 'Min Stake' })
    fireEvent.change(minStake, { target: { value: '25' } })
    fireEvent.blur(minStake)
    fireEvent.change(within(drawer).getByRole('combobox', { name: 'Apply Mode' }), { target: { value: 'fill-empty' } })
    fireEvent.change(within(drawer).getByRole('combobox', { name: 'VIP Tier' }), { target: { value: 'vip-1' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Apply Changes' }))

    await waitFor(() => assert.equal(callbacks.save.mock.calls.length, 1))
    assert.deepEqual(callbacks.save.mock.calls[0][0], {
      mode: 'fill-empty',
      tier: 'vip-1',
      minBet: 25,
      maxBet: 1000,
      exposureDaily: 5000,
      exposureWeekly: 20000,
      exposureCap: 50000,
      riskLevel: 'medium',
      riskThreshold: 750,
    })
  })

  test('validates and creates a specific-player bid rule with the legacy GraphQL input', async () => {
    renderDrawer({ initialTab: 'bid' })
    const drawer = await screen.findByRole('dialog', { name: 'Edit Matka Settings' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create Configuration' }))
    assert.ok(await within(drawer).findByText('Please select bid type'))

    fireEvent.change(within(drawer).getByRole('combobox', { name: /Bid Type/ }), { target: { value: 'JODI' } })
    const capacity = within(drawer).getByRole('textbox', { name: /Maximum Bid Capacity/ })
    fireEvent.change(capacity, { target: { value: '35.5' } })
    fireEvent.blur(capacity)
    fireEvent.click(within(drawer).getByRole('switch', { name: 'Player Targeting: All' }))
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Select Players' }), {
      target: { value: 'u1, u2 u3' },
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create Configuration' }))

    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'CreateMatkaBidRule')))
    assert.deepEqual(calls.find((call) => call.operationName === 'CreateMatkaBidRule')?.variables, {
      input: {
        matkaId: 'm1', matkaType: 'worli', marketName: 'Kalyan', marketSession: null,
        bidType: 'JODI', percentage: 35.5, includeAll: false,
        includedPlayers: { playerIds: ['u1', 'u2', 'u3'] },
        minStake: null, maxStake: null, exposureCap: null, status: 'active', notes: null,
      },
    })
  })

  test('keeps bid-rule status/remove variables and page controls exact', async () => {
    renderDrawer({ initialTab: 'bid' })
    const drawer = await screen.findByRole('dialog', { name: 'Edit Matka Settings' })
    await within(drawer).findByText('JODI')
    const status = within(drawer).getByRole('switch', { name: 'Toggle JODI status' })
    fireEvent.click(status)
    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'UpdateMatkaBidRule')))
    assert.deepEqual(calls.find((call) => call.operationName === 'UpdateMatkaBidRule')?.variables, {
      id: 'rule-1', patch: { status: 'inactive' },
    })

    fireEvent.click(within(drawer).getByRole('button', { name: 'Remove' }))
    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'DeleteMatkaBidRule')))
    assert.deepEqual(calls.find((call) => call.operationName === 'DeleteMatkaBidRule')?.variables, { id: 'rule-1' })
    assert.ok(within(drawer).getByText('Page 1'))
    assert.ok(within(drawer).getByRole('button', { name: 'Prev' }).hasAttribute('disabled'))
    assert.ok(within(drawer).getByRole('button', { name: 'Next' }).hasAttribute('disabled'))
  })

  test('bulk mode excludes Bid Settings and disables apply when selection is empty', async () => {
    renderDrawer({ mode: 'bulk', matka: null, selectedMatkas: [], drawerActive: 'suspend' })
    const drawer = await screen.findByRole('dialog', { name: 'Bulk Update Settings' })
    assert.ok(within(drawer).getByText('Bulk Update (0 matkas)'))
    assert.ok(within(drawer).queryByRole('tab', { name: 'Bid Settings' }) === null)
    assert.ok(within(drawer).getByRole('button', { name: 'Apply Changes' }).hasAttribute('disabled'))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Suspend all' }))
    assert.equal(callbacks.status.mock.calls.at(-1)?.[0], 'suspend')
    assert.equal(calls.filter((call) => call.operationName === 'MatkaBidRules').length, 0)
  })
})
