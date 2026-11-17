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

const feedback = vi.hoisted(() => ({ toasts: [] as Array<Record<string, unknown>> }))
vi.mock('@/ui/components/toast', () => ({
  toast: (options: Record<string, unknown>) => {
    feedback.toasts.push(options)
    return feedback.toasts.length
  },
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
/** When set, CreateMatkaBidRule answers with this GraphQL error, as the server refuses a rule. */
let refuseCreate: string | null
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
      if (refuseCreate) return { errors: [{ message: refuseCreate }] }
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
  refuseCreate = null
  feedback.toasts.length = 0
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

  test('a refused bid configuration shows the server reason and keeps the draft; a created one says so', async () => {
    refuseCreate = 'This bid type is unavailable for the market'
    renderDrawer({ initialTab: 'bid' })
    const drawer = await screen.findByRole('dialog', { name: 'Edit Matka Settings' })
    fireEvent.change(within(drawer).getByRole('combobox', { name: /Bid Type/ }), { target: { value: 'JODI' } })
    const capacity = within(drawer).getByRole('textbox', { name: /Maximum Bid Capacity/ })
    fireEvent.change(capacity, { target: { value: '50' } })
    fireEvent.blur(capacity)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create Configuration' }))
    // The refusal used to escape as an unhandled rejection with nothing on screen.
    const alert = await within(drawer).findByRole('alert')
    assert.equal(alert.textContent, 'This bid type is unavailable for the market')
    assert.equal((within(drawer).getByRole('combobox', { name: /Bid Type/ }) as HTMLSelectElement).value, 'JODI')
    assert.ok(!feedback.toasts.some((entry) => entry.tone === 'ok'), 'no success for a refusal')

    refuseCreate = null
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create Configuration' }))
    await waitFor(() => assert.ok(feedback.toasts.some((entry) => entry.message === 'Bid configuration created' && entry.tone === 'ok')))
    assert.ok(within(drawer).queryByRole('alert') === null, 'the refusal clears')
    assert.equal(calls.filter((call) => call.operationName === 'CreateMatkaBidRule').length, 2)
  })

  test('the Bid Type list offers only the bid types the market kind takes', async () => {
    // A Worli market offered Satta AB, A and B, which the server refuses ("This bid type is unavailable for the market").
    const offered = (drawer: HTMLElement) => Array.from((within(drawer).getByRole('combobox', { name: /Bid Type/ }) as HTMLSelectElement).options)
      .map((option) => option.value).filter(Boolean)
    const worli = renderDrawer({ initialTab: 'bid' })
    let drawer = await screen.findByRole('dialog', { name: 'Edit Matka Settings' })
    assert.deepEqual(offered(drawer), ['SINGLE', 'JODI', 'SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA', 'HALF_SANGAM', 'FULL_SANGAM'])
    worli.unmount()

    renderDrawer({ initialTab: 'bid', matka: { ...MATKA, settings: { ...MATKA.settings, matkaType: 'sattaMatka' } } })
    drawer = await screen.findByRole('dialog', { name: 'Edit Matka Settings' })
    assert.deepEqual(offered(drawer), ['AB', 'A', 'B'])
  })

  test('keeps bid-rule status/remove variables and page controls exact, and Remove asks first', async () => {
    renderDrawer({ initialTab: 'bid' })
    const drawer = await screen.findByRole('dialog', { name: 'Edit Matka Settings' })
    await within(drawer).findByText('JODI')
    const status = within(drawer).getByRole('switch', { name: 'Toggle JODI status' })
    fireEvent.click(status)
    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'UpdateMatkaBidRule')))
    assert.deepEqual(calls.find((call) => call.operationName === 'UpdateMatkaBidRule')?.variables, {
      id: 'rule-1', patch: { status: 'inactive' },
    })
    // The rule comes back as a record (no { success, message } for the notification link), so the page says it.
    await waitFor(() => assert.ok(feedback.toasts.some((entry) => entry.message === 'Bid configuration deactivated' && entry.tone === 'ok')))

    // Remove deletes the rule outright, so it asks first; Cancel sends nothing.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Remove' }))
    const prompt = await screen.findByRole('alertdialog', { name: 'Remove bid configuration' })
    assert.ok(within(prompt).getByText('Remove the JODI configuration (25%)? Its bid limit stops applying to players at once.'))
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null, 'Cancel closes the prompt'))
    assert.equal(calls.some((call) => call.operationName === 'DeleteMatkaBidRule'), false)

    fireEvent.click(within(drawer).getByRole('button', { name: 'Remove' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove bid configuration' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'DeleteMatkaBidRule')))
    assert.deepEqual(calls.find((call) => call.operationName === 'DeleteMatkaBidRule')?.variables, { id: 'rule-1' })
    await waitFor(() => assert.ok(feedback.toasts.some((entry) => entry.message === 'Bid configuration removed' && entry.tone === 'ok')))
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null, 'the prompt closes once removed'))
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
