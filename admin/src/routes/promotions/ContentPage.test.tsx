/**
 * /promotions/content against MockedProvider. MockLink answers a request only when its document and
 * variables match a mock exactly, so every mutation below proves the legacy document and variables.
 * The two Apollo hooks are wrapped (not replaced) to record what the page passes them.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import ContentPage from './ContentPage'
import { ContentQuery, CreateContent, PublishContent, UpdateContent } from './contentGraphql'
import type { ContentRow } from './contentPageModel'

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

const BANNER: ContentRow = {
  id: 'c-1',
  name: 'Welcome Banner',
  locale: 'en',
  body: 'Hello and welcome',
  status: 'published',
  updatedAt: '2026-10-06T08:30:00Z',
}

const FOOTER: ContentRow = {
  id: 'c-2',
  name: 'Footer Note',
  locale: 'hi',
  body: 'Namaste',
  status: 'draft',
  updatedAt: null,
}

function list(content: ContentRow[], delay = 0): MockedResponse {
  return { request: { query: ContentQuery }, result: { data: { content } }, delay }
}

function renderPage(mocks: MockedResponse[]) {
  return render(
    <MemoryRouter>
      <PageEyebrowProvider value="Marketing">
        <MockedProvider mocks={mocks} addTypename={false}>
          <ContentPage />
        </MockedProvider>
      </PageEyebrowProvider>
    </MemoryRouter>,
  )
}

function bodyRows(): string[][] {
  const table = screen.getByRole('table', { name: 'Content' })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''))
}

describe('ContentPage', () => {
  beforeEach(() => {
    record.queries.length = 0
    record.mutations.length = 0
    guard.allowed = true
    guard.calls.length = 0
    feedback.toast.mockReset()
  })

  test('sends the legacy list document and draws every row in the server order', async () => {
    renderPage([list([BANNER, FOOTER])])

    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Content')
    assert.ok(screen.queryByText('Marketing') === null)
    assert.deepEqual(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
      ['Create Content', 'Content'],
    )

    await screen.findByText('Welcome Banner')
    const table = screen.getByRole('table', { name: 'Content' })
    assert.deepEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['ID', 'Name', 'Locale', 'Status', 'Updated', 'Actions'],
    )
    assert.deepEqual(bodyRows(), [
      ['c-1', 'Welcome Banner', 'en', 'published', 'time:2026-10-06T08:30:00Z', 'UpdatePublish'],
      ['c-2', 'Footer Note', 'hi', 'draft', '—', 'UpdatePublish'],
    ])

    assert.equal(record.queries[0]?.document, ContentQuery)
    assert.deepEqual(record.queries[0]?.options, { errorPolicy: 'all' })
    assert.deepEqual(
      record.mutations.slice(0, 3).map((call) => call.document),
      [CreateContent, UpdateContent, PublishContent],
    )
    assert.ok(record.mutations.every((call) => call.options === undefined))
  })

  test('keeps the promotions.content view guard and starts nothing when it denies', () => {
    guard.allowed = false
    renderPage([])

    assert.deepEqual(guard.calls[0], [{ domain: 'promotions.content', actions: ['view'] }])
    assert.ok(screen.getByRole('alert'))
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
    assert.equal(record.queries.length, 0)
    assert.equal(record.mutations.length, 0)
  })

  test('creates with the three fields as typed, then refetches; the fields keep their values', async () => {
    const created = { id: 'c-3', name: '  Promo strip ', status: 'draft' }
    renderPage([
      list([BANNER]),
      {
        request: {
          query: CreateContent,
          variables: { input: { name: '  Promo strip ', locale: 'ta', body: 'Line one\nLine two' } },
        },
        result: { data: { createContent: created } },
      },
      list([BANNER, { ...created, locale: 'ta', body: 'Line one\nLine two', updatedAt: '2026-10-07T10:00:00Z' }]),
    ])
    await screen.findByText('Welcome Banner')

    const name = screen.getByLabelText('Name') as HTMLInputElement
    const locale = screen.getByLabelText('Locale') as HTMLInputElement
    const body = screen.getByLabelText('Body') as HTMLTextAreaElement
    assert.deepEqual([name.value, locale.value, body.value], ['New Block', 'en', ''])
    assert.deepEqual(
      [name.placeholder, locale.placeholder, body.placeholder],
      ['Name', 'Locale', 'Body'],
    )

    // Name, Locale and Body now come before Create in the tab order (legacy put Create before Body).
    const create = screen.getByRole('button', { name: 'Create' })
    assert.equal(body.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING, Node.DOCUMENT_POSITION_FOLLOWING)

    fireEvent.change(name, { target: { value: '  Promo strip ' } })
    fireEvent.change(locale, { target: { value: 'ta' } })
    fireEvent.change(body, { target: { value: 'Line one\nLine two' } })
    fireEvent.click(create)

    await screen.findByText('c-3')
    assert.deepEqual([name.value, locale.value, body.value], ['  Promo strip ', 'ta', 'Line one\nLine two'])
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('Update re-sends the row id, name and body (no locale); Publish sends the id', async () => {
    renderPage([
      list([BANNER, FOOTER]),
      {
        request: { query: UpdateContent, variables: { input: { id: 'c-2', name: 'Footer Note', body: 'Namaste' } } },
        result: {
          data: { updateContent: { ...FOOTER, updatedAt: '2026-10-07T11:00:00Z' } },
        },
      },
      list([BANNER, { ...FOOTER, updatedAt: '2026-10-07T11:00:00Z' }]),
      {
        request: { query: PublishContent, variables: { id: 'c-2' } },
        result: { data: { publishContent: { id: 'c-2', status: 'published', updatedAt: '2026-10-07T11:05:00Z' } } },
      },
      list([BANNER, { ...FOOTER, status: 'published', updatedAt: '2026-10-07T11:05:00Z' }]),
    ])
    await screen.findByText('Footer Note')

    const update = screen.getByRole('button', { name: 'Update Footer Note' })
    assert.equal(update.textContent, 'Update')
    fireEvent.click(update)
    await screen.findByText('time:2026-10-07T11:00:00Z')

    fireEvent.click(screen.getByRole('button', { name: 'Publish Footer Note' }))
    await screen.findByText('time:2026-10-07T11:05:00Z')
    assert.equal(bodyRows()[1]?.[3], 'published')
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('holds a busy button until its mutation and refetch finish, so a double click sends once', async () => {
    renderPage([
      list([FOOTER]),
      {
        request: { query: PublishContent, variables: { id: 'c-2' } },
        result: { data: { publishContent: { id: 'c-2', status: 'published', updatedAt: '2026-10-07T11:05:00Z' } } },
        delay: 40,
      },
      list([{ ...FOOTER, status: 'published' }]),
    ])
    await screen.findByText('Footer Note')

    const publish = screen.getByRole('button', { name: 'Publish Footer Note' })
    fireEvent.click(publish)
    assert.equal(publish.getAttribute('aria-busy'), 'true')
    fireEvent.click(publish)

    await screen.findByText('published')
    await waitFor(() => assert.equal(publish.getAttribute('aria-busy'), null))
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('raises the server message when a mutation fails, and the button recovers', async () => {
    renderPage([
      list([BANNER]),
      {
        request: { query: PublishContent, variables: { id: 'c-1' } },
        result: { errors: [{ message: 'Content not found' }] },
      },
    ])
    await screen.findByText('Welcome Banner')

    const publish = screen.getByRole('button', { name: 'Publish Welcome Banner' })
    fireEvent.click(publish)

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Content not found', tone: 'error' })
    assert.equal(publish.getAttribute('aria-busy'), null)
  })

  test('shows loading, then the empty state', async () => {
    renderPage([list([], 30)])

    assert.equal(screen.getByRole('status').textContent, 'Loading Content')
    assert.ok(await screen.findByText('No content'))
  })

  test('shows a failed load with Retry, and Retry fetches the list again', async () => {
    renderPage([
      { request: { query: ContentQuery }, error: new Error('Network down') },
      list([BANNER]),
    ])

    assert.ok(await screen.findByText('Network down'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    assert.ok(await screen.findByText('Welcome Banner'))
  })
})
