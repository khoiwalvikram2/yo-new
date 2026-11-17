import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/shared/core/authStore'
import { DeclareResultDrawer } from './DeclareResultDrawer'

interface QueryCall { name: string; options?: Record<string, unknown> }

const apollo = vi.hoisted(() => ({
  queryCalls: [] as QueryCall[],
  responses: {} as Record<string, unknown>,
  createResult: vi.fn(),
  setEventStatus: vi.fn(),
  refetchQueries: vi.fn(),
  toast: vi.fn(),
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
      return { data: apollo.responses[name], loading: false, error: undefined, refetch: vi.fn() }
    },
    useMutation: () => [apollo.setEventStatus, { loading: false }] as const,
    useApolloClient: () => ({ refetchQueries: apollo.refetchQueries }),
  }
})

vi.mock('../../../../modules/sports/results', () => ({
  useCreateSportsResult: () => [apollo.createResult, { loading: false }] as const,
}))

vi.mock('@/ui/components/toast', () => ({ toast: apollo.toast }))

function ThemeRoot({ children }: { children: ReactNode }) {
  return <div data-theme="light">{children}</div>
}

function renderDrawer(props: Partial<React.ComponentProps<typeof DeclareResultDrawer>> = {}) {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  render(
    <ThemeRoot>
      <DeclareResultDrawer open onClose={onClose} onSuccess={onSuccess} {...props} />
    </ThemeRoot>,
  )
  return { onClose, onSuccess }
}

async function choose(label: string, option: string) {
  const input = screen.getByRole('combobox', { name: label })
  fireEvent.click(input)
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

async function chooseCore(marketType: 'exchange' | 'fancy' = 'exchange') {
  await choose('Sport', 'Cricket')
  await choose('League', 'IPL')
  await choose('Event', 'Final')
  fireEvent.change(screen.getByRole('combobox', { name: 'Market Type' }), { target: { value: marketType } })
  await choose('Market', marketType === 'fancy' ? 'Fancy Runs' : 'Match Odds')
}

beforeEach(() => {
  apollo.queryCalls = []
  apollo.responses = {
    ListSports: { sports: [{ id: 's1', name: 'Cricket', sportCode: '4' }, { id: 's2', name: 'Football', sportCode: '1' }] },
    ListLeaguesWithOpenBets: { leaguesWithOpenBets: [{ id: 'l1', name: 'IPL', sportId: 's1' }] },
    ListEventsWithOpenBets: { eventsWithOpenBets: [{ id: 'e1', name: 'Final' }] },
    MarketsWithOpenBets: { marketsWithOpenBets: [
      { id: 'm1', name: 'Match Odds', type: 'MATCH_ODDS' },
      { id: 'm2', name: 'Fancy Runs', type: 'fancy' },
    ] },
    SportsResults: { sportsResults: { items: [] } },
    EventOpenBetsForCounts: { sportsBets: [{ marketId: 'm1' }] },
    RunnersByMarket: { runnersByMarket: [{ id: 'r1', name: 'India' }, { id: 'r2', name: 'Australia' }] },
    SearchSportsHierarchy: { searchSportsHierarchy: [
      { type: 'event', sportId: 's1', sportName: 'Cricket', leagueId: 'l1', leagueName: 'IPL', eventId: 'e1', eventName: 'Final' },
    ] },
  }
  apollo.createResult.mockReset().mockResolvedValue({ data: { createSportsResult: { success: true } } })
  apollo.setEventStatus.mockReset().mockResolvedValue({ data: { setEventStatus: { success: true } } })
  apollo.refetchQueries.mockReset().mockResolvedValue(undefined)
  apollo.toast.mockReset()
  useAuthStore.setState({ permissions: [{ domain: 'sports', actions: ['read', 'write'] }], roles: ['Whitelabel Admin'] })
})

describe('DeclareResultDrawer', () => {
  test('renders legacy copy, fresh defaults and exact query options', () => {
    renderDrawer()
    assert.ok(screen.getByRole('dialog', { name: 'Declare Sports Result' }))
    assert.ok(screen.getByText('Declare results for sports markets and events'))
    assert.equal(screen.getByRole('button', { name: 'Declare Result' }).getAttribute('aria-disabled'), 'true')
    const listSports = apollo.queryCalls.find((call) => call.name === 'ListSports')
    assert.deepEqual(listSports?.options, { errorPolicy: 'all' })
    const search = apollo.queryCalls.find((call) => call.name === 'SearchSportsHierarchy')
    assert.deepEqual(search?.options?.variables, { input: { query: '', limit: 50 } })
    assert.equal(search?.options?.skip, true)
  })

  test('Reset clears the hierarchy and Cancel closes', async () => {
    const { onClose } = renderDrawer()
    await choose('Sport', 'Cricket')
    assert.equal((screen.getByRole('combobox', { name: 'Sport' }) as HTMLInputElement).value, 'Cricket')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.equal((screen.getByRole('combobox', { name: 'Sport' }) as HTMLInputElement).value, '')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(onClose.mock.calls.length, 1)
  })

  test('declares an exchange winner with the exact mutation input, context and refetch', async () => {
    const { onClose, onSuccess } = renderDrawer()
    await chooseCore('exchange')
    await choose('Winner Selection', 'India')
    const declare = screen.getByRole('button', { name: 'Declare Result' })
    assert.equal(declare.getAttribute('aria-disabled'), null)
    fireEvent.click(declare)
    await waitFor(() => assert.equal(apollo.createResult.mock.calls.length, 1))
    assert.deepEqual(apollo.createResult.mock.calls[0][0], {
      variables: {
        input: {
          sportId: 's1', leagueId: 'l1', eventId: 'e1', marketId: 'm1', marketType: 'exchange',
          runnerId: 'r1', selectionName: undefined, result: undefined,
        },
      },
      context: { uiToast: 'notification' },
    })
    assert.equal(apollo.refetchQueries.mock.calls.length, 1)
    assert.equal(onSuccess.mock.calls.length, 1)
    assert.equal(onClose.mock.calls.length, 1)
  })

  test('declares a fancy special status without a result value', async () => {
    renderDrawer()
    await chooseCore('fancy')
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'STATUS:VOID' } })
    assert.equal((screen.getByRole('textbox', { name: 'Result Value' }) as HTMLInputElement).disabled, true)
    fireEvent.click(screen.getByRole('button', { name: 'Declare Result' }))
    await waitFor(() => assert.equal(apollo.createResult.mock.calls.length, 1))
    const input = apollo.createResult.mock.calls[0][0].variables.input
    assert.equal(input.selectionName, 'VOID')
    assert.equal(input.result, undefined)
    assert.equal(input.runnerId, undefined)
  })

  test('a whitelabel admin is not offered to disable the event, which every whitelabel shares', async () => {
    renderDrawer()
    await chooseCore('exchange')
    await choose('Winner Selection', 'India')
    assert.equal(Boolean(screen.queryByRole('switch', { name: 'Disable event after declaring result' })),false)
    fireEvent.click(screen.getByRole('button', { name: 'Declare Result' }))
    await waitFor(() => assert.equal(apollo.createResult.mock.calls.length, 1))
    await waitFor(() => assert.equal(apollo.refetchQueries.mock.calls.length, 1))
    assert.equal(apollo.setEventStatus.mock.calls.length, 0)
  })

  test('disables the event only after the sole open-bet market is declared', async () => {
    useAuthStore.setState({ permissions: [{ domain: 'all', actions: ['*'] }], roles: ['Super Admin'] })
    renderDrawer()
    await chooseCore('exchange')
    await choose('Winner Selection', 'India')
    fireEvent.click(screen.getByRole('switch', { name: 'Disable event after declaring result' }))
    fireEvent.click(screen.getByRole('button', { name: 'Declare Result' }))
    await waitFor(() => assert.equal(apollo.setEventStatus.mock.calls.length, 1))
    assert.deepEqual(apollo.setEventStatus.mock.calls[0][0], {
      variables: { id: 'e1', status: 'inactive' },
      context: { uiToast: 'notification' },
    })
    assert.ok(apollo.toast.mock.calls.some(([value]) => value.message === 'Event disabled successfully'))
  })

  test('quick search auto-fills the hierarchy and reports the legacy success message without decoration', async () => {
    renderDrawer()
    const quick = screen.getByRole('combobox', { name: 'Quick Search' })
    fireEvent.change(quick, { target: { value: 'fi' } })
    fireEvent.click(await screen.findByRole('option', { name: /Final/ }))
    assert.equal((screen.getByRole('combobox', { name: 'Sport' }) as HTMLInputElement).value, 'Cricket')
    assert.equal((screen.getByRole('combobox', { name: 'League' }) as HTMLInputElement).value, 'IPL')
    assert.equal((screen.getByRole('combobox', { name: 'Event' }) as HTMLInputElement).value, 'Final')
    assert.ok(apollo.toast.mock.calls.some(([value]) => value.message === 'Auto-filled: Final → IPL → Cricket'))
  })

  test('keeps the drawer open and surfaces the thrown declaration error', async () => {
    apollo.createResult.mockRejectedValueOnce(new Error('provider offline'))
    const { onClose } = renderDrawer()
    await chooseCore('exchange')
    await choose('Winner Selection', 'India')
    fireEvent.click(screen.getByRole('button', { name: 'Declare Result' }))
    await waitFor(() => assert.ok(apollo.toast.mock.calls.some(([value]) => value.message === 'provider offline')))
    assert.equal(onClose.mock.calls.length, 0)
  })
})
