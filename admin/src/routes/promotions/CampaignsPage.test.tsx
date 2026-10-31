/**
 * /promotions/campaigns against MockedProvider. MockLink answers a request only when its document and
 * variables match a mock exactly, so every mutation below proves the legacy document and variables.
 * The two Apollo hooks are wrapped (not replaced) to record what the page passes them: the list
 * query's options and the absence of mutation options, which keeps the global notification link
 * surfacing each PromotionPayload message as it did before.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import CampaignsPage from './CampaignsPage'
import { CreatePromotion, PausePromotion, PromotionsQuery, PublishPromotion } from './campaignsGraphql'
import type { PromotionRow } from './campaignsPageModel'

interface HookCall {
  document: unknown
  options: unknown
}

const record = vi.hoisted(() => ({
  queries: [] as HookCall[],
  mutations: [] as HookCall[],
}))

const feedback = vi.hoisted(() => ({ toast: vi.fn() }))

const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const realQuery = actual.useQuery as (document: unknown, options?: unknown) => unknown
  const realMutation = actual.useMutation as (document: unknown, options?: unknown) => unknown
  return {
    ...actual,
    useQuery: ((document: unknown, options?: unknown) => {
      record.queries.push({ document, options })
      return realQuery(document, options)
    }) as typeof actual.useQuery,
    useMutation: ((document: unknown, options?: unknown) => {
      record.mutations.push({ document, options })
      return realMutation(document, options)
    }) as typeof actual.useMutation,
  }
})

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDate: (value: string) => `day:${value}`,
    formatDateTime: (value: string) => `time:${value}`,
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    children: ReactNode
  }) => {
    guard.calls.push(required)
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

const DIWALI: PromotionRow = {
  id: 'p-1',
  name: 'Diwali Reload',
  status: 'active',
  updatedAt: '2026-10-06T08:30:00Z',
  scheduleStart: '2026-10-20T00:00:00Z',
  scheduleEnd: '2026-11-05T00:00:00Z',
}

const MONSOON: PromotionRow = {
  id: 'p-2',
  name: 'Monsoon Cashback',
  status: 'draft',
  updatedAt: null,
  scheduleStart: null,
  scheduleEnd: null,
}

function list(promotions: PromotionRow[], delay = 0): MockedResponse {
  return { request: { query: PromotionsQuery }, result: { data: { promotions } }, delay }
}

function payload(field: string, promotion: Record<string, unknown>, message = 'Done'): Record<string, unknown> {
  return { [field]: { success: true, message, promotion } }
}

function renderPage(mocks: MockedResponse[]) {
  return render(
    <MemoryRouter>
      <PageEyebrowProvider value="Marketing">
        <MockedProvider mocks={mocks} addTypename={false}>
          <CampaignsPage />
        </MockedProvider>
      </PageEyebrowProvider>
    </MemoryRouter>,
  )
}

function bodyRows(): string[][] {
  const table = screen.getByRole('table', { name: 'Campaigns' })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''))
}

describe('CampaignsPage', () => {
  beforeEach(() => {
    record.queries.length = 0
    record.mutations.length = 0
    guard.allowed = true
    guard.calls.length = 0
    feedback.toast.mockReset()
  })

  test('sends the legacy list document and draws every row in the server order', async () => {
    renderPage([list([DIWALI, MONSOON])])

    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Campaigns')
    assert.ok(screen.queryByText('Marketing') === null)
    assert.deepEqual(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
      ['Create Campaign', 'Campaigns'],
    )

    await screen.findByText('Diwali Reload')
    const table = screen.getByRole('table', { name: 'Campaigns' })
    assert.deepEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['ID', 'Name', 'Status', 'Schedule', 'Updated', 'Actions'],
    )
    assert.deepEqual(bodyRows(), [
      [
        'p-1',
        'Diwali Reload',
        'active',
        'day:2026-10-20T00:00:00Z – day:2026-11-05T00:00:00Z',
        'time:2026-10-06T08:30:00Z',
        'PublishPause',
      ],
      ['p-2', 'Monsoon Cashback', 'draft', '— – —', '—', 'PublishPause'],
    ])

    assert.equal(record.queries[0]?.document, PromotionsQuery)
    assert.deepEqual(record.queries[0]?.options, { errorPolicy: 'all' })
    assert.deepEqual(
      record.mutations.slice(0, 3).map((call) => call.document),
      [CreatePromotion, PublishPromotion, PausePromotion],
    )
    assert.ok(record.mutations.every((call) => call.options === undefined))
  })

  test('keeps the promotions.campaigns view guard and starts nothing when it denies', () => {
    guard.allowed = false
    renderPage([])

    assert.deepEqual(guard.calls[0], [{ domain: 'promotions.campaigns', actions: ['view'] }])
    assert.ok(screen.getByRole('alert'))
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
    assert.equal(record.queries.length, 0)
    assert.equal(record.mutations.length, 0)
  })

  test('creates with the default name, then the typed name, refetching after each', async () => {
    const created = { id: 'p-3', name: 'New Campaign', status: 'draft', updatedAt: '2026-10-07T10:00:00Z' }
    const typed = { id: 'p-4', name: '  Summer Cashback ', status: 'draft', updatedAt: '2026-10-07T10:05:00Z' }
    renderPage([
      list([DIWALI]),
      {
        request: { query: CreatePromotion, variables: { input: { name: 'New Campaign' } } },
        result: { data: payload('createPromotion', created) },
      },
      list([DIWALI, { ...created, scheduleStart: null, scheduleEnd: null }]),
      {
        request: { query: CreatePromotion, variables: { input: { name: '  Summer Cashback ' } } },
        result: { data: payload('createPromotion', typed) },
      },
      list([DIWALI, { ...created, scheduleStart: null, scheduleEnd: null }, { ...typed, scheduleStart: null, scheduleEnd: null }]),
    ])
    await screen.findByText('Diwali Reload')

    const field = screen.getByLabelText('Campaign name') as HTMLInputElement
    assert.equal(field.value, 'New Campaign')
    assert.equal(field.getAttribute('placeholder'), 'Campaign name')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByText('p-3')

    fireEvent.change(field, { target: { value: '  Summer Cashback ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByText('p-4')

    assert.equal(field.value, '  Summer Cashback ', 'the field keeps what was typed, as before')
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('publishes and pauses one row by its id, then refetches', async () => {
    renderPage([
      list([DIWALI, MONSOON]),
      {
        request: { query: PublishPromotion, variables: { id: 'p-2' } },
        result: { data: payload('publishPromotion', { id: 'p-2', status: 'active', updatedAt: '2026-10-07T11:00:00Z' }) },
      },
      list([DIWALI, { ...MONSOON, status: 'active', updatedAt: '2026-10-07T11:00:00Z' }]),
      {
        request: { query: PausePromotion, variables: { id: 'p-1' } },
        result: { data: payload('pausePromotion', { id: 'p-1', status: 'paused', updatedAt: '2026-10-07T11:05:00Z' }) },
      },
      list([
        { ...DIWALI, status: 'paused', updatedAt: '2026-10-07T11:05:00Z' },
        { ...MONSOON, status: 'active', updatedAt: '2026-10-07T11:00:00Z' },
      ]),
    ])
    await screen.findByText('Diwali Reload')

    const publish = screen.getByRole('button', { name: 'Publish Monsoon Cashback' })
    assert.equal(publish.textContent, 'Publish')
    fireEvent.click(publish)
    await screen.findByText('time:2026-10-07T11:00:00Z')
    assert.equal(bodyRows()[1]?.[2], 'active')

    fireEvent.click(screen.getByRole('button', { name: 'Pause Diwali Reload' }))
    await screen.findByText('paused')
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('holds a busy button until its mutation and refetch finish, so a double click sends once', async () => {
    renderPage([
      list([MONSOON]),
      {
        request: { query: PublishPromotion, variables: { id: 'p-2' } },
        result: { data: payload('publishPromotion', { id: 'p-2', status: 'active', updatedAt: '2026-10-07T11:00:00Z' }) },
        delay: 40,
      },
      list([{ ...MONSOON, status: 'active' }]),
    ])
    await screen.findByText('Monsoon Cashback')

    const publish = screen.getByRole('button', { name: 'Publish Monsoon Cashback' })
    fireEvent.click(publish)
    assert.equal(publish.getAttribute('aria-busy'), 'true')
    assert.equal(publish.getAttribute('aria-disabled'), 'true')
    fireEvent.click(publish)

    await screen.findByText('active')
    await waitFor(() => assert.equal(publish.getAttribute('aria-busy'), null))
    // A second PublishPromotion has no mock: had it been sent, it would have failed into a toast.
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('raises the server message when a mutation fails, and the button recovers', async () => {
    renderPage([
      list([DIWALI]),
      {
        request: { query: PausePromotion, variables: { id: 'p-1' } },
        result: { errors: [{ message: 'Promotion not found' }] },
      },
    ])
    await screen.findByText('Diwali Reload')

    const pause = screen.getByRole('button', { name: 'Pause Diwali Reload' })
    fireEvent.click(pause)

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Promotion not found', tone: 'error' })
    assert.equal(pause.getAttribute('aria-busy'), null)
    assert.equal(bodyRows()[0]?.[2], 'active')
  })

  test('shows loading, then the empty state', async () => {
    renderPage([list([], 30)])

    assert.equal(screen.getByRole('status').textContent, 'Loading Campaigns')
    assert.ok(await screen.findByText('No campaigns'))
    assert.equal(screen.getByRole('table', { name: 'Campaigns' }).getAttribute('aria-busy'), 'false')
  })

  test('shows a failed load with Retry, and Retry fetches the list again', async () => {
    renderPage([
      { request: { query: PromotionsQuery }, error: new Error('Network down') },
      list([DIWALI]),
    ])

    assert.ok(await screen.findByText('Network down'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    assert.ok(await screen.findByText('Diwali Reload'))
    assert.ok(screen.queryByText('Network down') === null)
  })

  test('keeps the rows that arrived beside a partial error (errorPolicy all)', async () => {
    renderPage([
      {
        request: { query: PromotionsQuery },
        result: { data: { promotions: [DIWALI] }, errors: [{ message: 'Schedule unavailable' }] },
      },
    ])

    assert.ok(await screen.findByText('Diwali Reload'))
    assert.equal(screen.getByRole('alert').textContent?.includes('Schedule unavailable'), true)
  })
})
