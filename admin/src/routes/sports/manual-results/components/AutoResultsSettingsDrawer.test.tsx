import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AutoResultsSettingsDrawer } from './AutoResultsSettingsDrawer'

interface QueryCall { name: string; options?: Record<string, unknown> }

const apollo = vi.hoisted(() => ({
  queryCalls: [] as QueryCall[],
  mutationCalls: [] as Array<{ name: string; options?: Record<string, unknown> }>,
  responses: {} as Record<string, unknown>,
  mutationResponses: {} as Record<string, unknown>,
  refetch: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const operationName = (document: { definitions?: Array<{ name?: { value?: string } }> }) =>
    document.definitions?.find((definition) => definition.name?.value)?.name?.value ?? 'Unknown'
  return {
    ...actual,
    useQuery: (document: { definitions?: Array<{ name?: { value?: string } }> }, options?: Record<string, unknown>) => {
      const name = operationName(document)
      apollo.queryCalls.push({ name, options })
      return { data: apollo.responses[name], loading: false, error: undefined, refetch: apollo.refetch }
    },
    useMutation: (document: { definitions?: Array<{ name?: { value?: string } }> }) => {
      const name = operationName(document)
      const mutate = vi.fn(async (options?: Record<string, unknown>) => {
        apollo.mutationCalls.push({ name, options })
        return { data: apollo.mutationResponses[name] }
      })
      return [mutate, { loading: false }] as const
    },
  }
})

vi.mock('@/ui/components/toast', () => ({ toast: apollo.toast }))

vi.mock('@/ui/components/confirm', () => ({
  confirm: (options: { onConfirm?: () => void | Promise<void> }) => {
    apollo.confirm(options)
    return Promise.resolve(options.onConfirm?.()).then(() => true)
  },
}))

async function choose(label: string, option: string) {
  const input = screen.getByRole('combobox', { name: label })
  fireEvent.click(input)
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

function renderDrawer() {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  render(
    <div data-theme="light">
      <AutoResultsSettingsDrawer open onClose={onClose} onSuccess={onSuccess} />
    </div>,
  )
  return { onClose, onSuccess }
}

beforeEach(() => {
  apollo.queryCalls = []
  apollo.mutationCalls = []
  apollo.responses = {
    ListSports: { sports: [
      { id: 's1', name: 'Cricket', sportCode: '4' },
      { id: 's2', name: 'Football', sportCode: '1' },
    ] },
    ListLeagues: { leagues: [{ id: 'l1', name: 'IPL', sportId: 's1' }] },
    ListEvents: { events: [{ id: 'e1', name: 'Final' }] },
    SportsAutoResultsSettings: { sportsAutoResultsSettings: [{
      id: 'setting-1', sportId: 's1', leagueId: 'l1', eventId: 'e1',
      exchangeEnabled: true, bookmakerEnabled: false, fancyEnabled: true,
      sport: { id: 's1', name: 'Cricket' }, league: { id: 'l1', name: 'IPL' }, event: { id: 'e1', name: 'Final' },
    }] },
  }
  apollo.mutationResponses = {
    UpsertSportsAutoResultsSettings: { upsertSportsAutoResultsSettings: { success: true, message: 'Saved' } },
    ToggleAutoResultMarketType: { toggleAutoResultMarketType: { success: true, message: 'Updated' } },
    DeleteSportsAutoResultsSettings: { deleteSportsAutoResultsSettings: { success: true, message: 'Deleted' } },
  }
  apollo.refetch.mockReset().mockResolvedValue(undefined)
  apollo.toast.mockReset()
  apollo.confirm.mockReset()
})

describe('AutoResultsSettingsDrawer', () => {
  test('renders the two-tab workflow and preserves all query options', () => {
    renderDrawer()
    assert.ok(screen.getByRole('dialog', { name: 'Auto Results Settings' }))
    assert.equal(screen.getByRole('tab', { name: 'Make Settings' }).getAttribute('aria-selected'), 'true')
    assert.equal(
      screen.getAllByText('Configure automatic result declaration for sports markets').length,
      2,
    )
    assert.deepEqual(apollo.queryCalls.find((call) => call.name === 'ListSports')?.options, { errorPolicy: 'all' })
    assert.deepEqual(apollo.queryCalls.find((call) => call.name === 'SportsAutoResultsSettings')?.options, { errorPolicy: 'all' })
  })

  test('blocks Save until a scope and an allowed market type are selected', async () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    assert.ok(apollo.toast.mock.calls.some(([value]) => value.message === 'Please select at least one scope (Sport, League, or Event)'))
    await choose('Sport (Optional)', 'Football')
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    assert.ok(apollo.toast.mock.calls.some(([value]) => value.message === 'Please enable Exchange market type'))
    assert.equal(screen.queryByRole('switch', { name: 'Bookmaker' }), null)
    assert.equal(screen.queryByRole('switch', { name: 'Fancy' }), null)
  })

  test('saves a cricket scope with exact variables and switches to All Settings', async () => {
    const { onSuccess } = renderDrawer()
    await choose('Sport (Optional)', 'Cricket')
    await choose('League (Optional)', 'IPL')
    await choose('Event (Optional)', 'Final')
    await waitFor(() => {
      assert.equal(screen.getByRole('switch', { name: 'Exchange' }).getAttribute('aria-checked'), 'true')
      assert.equal(screen.getByRole('switch', { name: 'Fancy' }).getAttribute('aria-checked'), 'true')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    await waitFor(() => assert.equal(apollo.mutationCalls.filter((call) => call.name === 'UpsertSportsAutoResultsSettings').length, 1))
    const call = apollo.mutationCalls.find((item) => item.name === 'UpsertSportsAutoResultsSettings')
    assert.deepEqual(call?.options, {
      variables: { input: {
        sportId: 's1', leagueId: 'l1', eventId: 'e1',
        exchangeEnabled: true, bookmakerEnabled: false, fancyEnabled: true,
      } },
      context: { uiToast: 'notification' },
    })
    assert.equal(onSuccess.mock.calls.length, 1)
    assert.equal(screen.getByRole('tab', { name: 'All Settings' }).getAttribute('aria-selected'), 'true')
  })

  test('lists saved scopes and toggles a market through the exact mutation contract', async () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('tab', { name: 'All Settings' }))
    assert.ok(screen.getByText('Cricket / IPL / Final'))
    fireEvent.click(screen.getByRole('switch', { name: 'Bookmaker for Cricket / IPL / Final' }))
    await waitFor(() => assert.equal(apollo.mutationCalls.filter((call) => call.name === 'ToggleAutoResultMarketType').length, 1))
    assert.deepEqual(apollo.mutationCalls.find((call) => call.name === 'ToggleAutoResultMarketType')?.options, {
      variables: { input: { id: 'setting-1', marketType: 'bookmaker', enabled: true } },
      context: { uiToast: 'notification' },
    })
  })

  test('confirms and deletes saved settings', async () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('tab', { name: 'All Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete settings for Cricket / IPL / Final' }))
    await waitFor(() => assert.equal(apollo.confirm.mock.calls.length, 1))
    const request = apollo.confirm.mock.calls[0][0]
    assert.equal(request.title, 'Delete Settings')
    assert.equal(request.confirmLabel, 'Yes')
    await waitFor(() => assert.equal(apollo.mutationCalls.filter((call) => call.name === 'DeleteSportsAutoResultsSettings').length, 1))
    assert.deepEqual(apollo.mutationCalls.find((call) => call.name === 'DeleteSportsAutoResultsSettings')?.options, {
      variables: { id: 'setting-1' },
      context: { uiToast: 'notification' },
    })
  })

  test('Reset clears the make-settings form and Cancel closes', async () => {
    const { onClose } = renderDrawer()
    await choose('Sport (Optional)', 'Cricket')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.equal((screen.getByRole('combobox', { name: 'Sport (Optional)' }) as HTMLInputElement).value, '')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(onClose.mock.calls.length, 1)
  })
})
