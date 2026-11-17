/**
 * /matka/:id mounted against MockedProvider and a MemoryRouter: the exact Matka lookup (route id,
 * errorPolicy all) through the shared hooks, the two mutations with their refetch of the matka list,
 * Activate / Pause / Clone and what each sends, the RBAC requirement and its denial, and the loading,
 * not-found and failed-load states. The RBAC guard is a stub; everything else is real.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  CLONE_MATKA_MUTATION,
  MATKAS_QUERY,
  MATKA_QUERY,
  SET_MATKA_STATUS_MUTATION,
} from '@/lib/graphql/matka'
import MatkaViewPage from './ViewPage'

const apollo = vi.hoisted(() => ({
  queries: [] as Array<{ query: unknown; options: unknown }>,
  mutations: [] as Array<{ mutation: unknown; options: unknown }>,
}))
const rbac = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ query: args[0], options: args[1] })
      return actual.useQuery(...args)
    },
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({ mutation: args[0], options: args[1] })
      return actual.useMutation(...args)
    },
  }
})

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    children: ReactNode
  }) => {
    rbac.calls.push(required)
    return rbac.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

interface Row {
  __typename: 'Matka'
  id: string
  name: string
  code: string
  description: string | null
  timezone: string | null
  schedule: unknown
  status: string
  limits: unknown
  visibility: unknown
  priority: number | null
  settings: unknown
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

function row(patch: Partial<Row> = {}): Row {
  return {
    __typename: 'Matka',
    id: '7',
    name: 'Kalyan Morning',
    code: 'KLM',
    description: null,
    timezone: 'Asia/Kolkata',
    schedule: { open: '09:30', close: '11:30', days: ['MON', 'TUE'] },
    status: 'INACTIVE',
    limits: { minBet: 10, maxBet: 50000 },
    visibility: null,
    priority: 0,
    settings: null,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-10-06T10:15:00.000Z',
    deletedAt: null,
    ...patch,
  }
}

const server = vi.hoisted(() => ({ status: 'INACTIVE', lookups: 0 }))

function matkaMock(patch: Partial<Row> = {}): MockedResponse {
  return {
    request: { query: MATKA_QUERY, variables: { id: '7' } },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.lookups += 1
      return { data: { matka: row({ status: server.status, ...patch }) } }
    },
  }
}

const listMock: MockedResponse = {
  request: { query: MATKAS_QUERY },
  maxUsageCount: Number.POSITIVE_INFINITY,
  result: { data: { matkas: { __typename: 'MatkaList', items: [], total: 0 } } },
}

function statusMock(toStatus: string, sent: Array<Record<string, unknown>>): MockedResponse {
  return {
    request: { query: SET_MATKA_STATUS_MUTATION, variables: { id: '7', toStatus } },
    result: () => {
      sent.push({ id: '7', toStatus })
      server.status = toStatus
      return {
        data: {
          setMatkaStatus: {
            __typename: 'MatkaPayload',
            success: true,
            message: 'Status updated',
            matka: { __typename: 'Matka', id: '7', status: toStatus },
          },
        },
      }
    },
  }
}

function renderPage(mocks: MockedResponse[], path = '/matka/7') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MockedProvider mocks={mocks}>
        <PageEyebrowProvider value="Trading">
          <Routes>
            <Route path="/matka/:id" element={<MatkaViewPage />} />
            <Route path="/matka/list" element={<p>Matka list route</p>} />
            <Route path="/matka/edit/:id" element={<p>Matka edit route</p>} />
          </Routes>
        </PageEyebrowProvider>
      </MockedProvider>
    </MemoryRouter>,
  )
}

function factRows() {
  const list = document.querySelector('dl') as HTMLDListElement
  return Array.from(list.querySelectorAll('dt')).map((term) => [
    term.textContent,
    (term.nextElementSibling as HTMLElement).textContent,
  ])
}

/* Elements are compared by identity: a node:assert diff of a jsdom element can exhaust the worker. */
function assertAbsent(element: Element | null, what: string) {
  assert.ok(element === null, `${what} should be absent`)
}

const hasClass = (element: Element, name: string) => [...element.classList].some((cls) => cls.includes(`_${name}_`))

beforeEach(() => {
  apollo.queries.length = 0
  apollo.mutations.length = 0
  rbac.allowed = true
  rbac.calls.length = 0
  server.status = 'INACTIVE'
  server.lookups = 0
})

describe('MatkaViewPage', () => {
  test('loads the matka by route id and renders the header, facts and JSON blocks', async () => {
    renderPage([matkaMock(), listMock])
    assert.equal(screen.getByRole('status').textContent, 'Loading matka')

    const heading = await screen.findByRole('heading', { level: 1, name: 'Kalyan Morning' })
    assert.ok(heading)
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.ok(screen.queryByText('Trading') === null)

    const lookup = apollo.queries.find((call) => call.query === MATKA_QUERY)
    assert.ok(lookup)
    assert.deepEqual(lookup.options, { variables: { id: '7' }, skip: false, errorPolicy: 'all' })
    const mutationOptions = apollo.mutations.map((call) => [call.mutation, call.options])
    assert.ok(mutationOptions.some(([doc, options]) => doc === SET_MATKA_STATUS_MUTATION
      && JSON.stringify(options) === JSON.stringify({ refetchQueries: [{ query: MATKAS_QUERY }] })))
    assert.ok(mutationOptions.some(([doc, options]) => doc === CLONE_MATKA_MUTATION
      && JSON.stringify(options) === JSON.stringify({ refetchQueries: [{ query: MATKAS_QUERY }] })))

    assert.deepEqual(factRows(), [
      ['Code', 'KLM'],
      ['Status', 'INACTIVE'],
      ['Timezone', 'Asia/Kolkata'],
      ['Priority', '0'],
      ['Updated', '2026-10-06T10:15:00.000Z'],
    ])

    for (const [label, json] of [
      ['Schedule', JSON.stringify(row().schedule, null, 2)],
      ['Limits', JSON.stringify(row().limits, null, 2)],
      ['Settings', 'null'],
    ]) {
      const block = screen.getByLabelText(label)
      assert.equal(block.tagName, 'PRE')
      assert.equal(block.textContent, json)
      assert.ok(screen.getByRole('button', { name: `Copy ${label}` }))
    }

    const edit = screen.getByRole('link', { name: 'Edit' })
    assert.equal(edit.getAttribute('href'), '/matka/edit/7')
    assertAbsent(edit.querySelector('button'), 'a button inside the Edit link')
    assert.ok(screen.getByRole('button', { name: 'Clone' }))
    const activate = screen.getByRole('button', { name: 'Activate' })
    assert.ok(hasClass(activate, 'primary'))
    assertAbsent(screen.queryByRole('button', { name: 'Pause' }), 'Pause')
    assert.deepEqual(rbac.calls[0], [{ domain: 'matka.management', actions: ['view'] }])
  })

  test('Activate sends ACTIVE, then reloads the matka, which now offers Pause', async () => {
    const sent: Array<Record<string, unknown>> = []
    renderPage([matkaMock(), listMock, statusMock('ACTIVE', sent)])
    const activate = await screen.findByRole('button', { name: 'Activate' })

    await act(async () => {
      fireEvent.click(activate)
    })

    await waitFor(() => assert.deepEqual(sent, [{ id: '7', toStatus: 'ACTIVE' }]))
    await waitFor(() => assert.equal(server.lookups, 2))
    const pause = await screen.findByRole('button', { name: 'Pause' })
    assert.equal(hasClass(pause, 'primary'), false)
    await waitFor(() => assert.deepEqual(factRows()[1], ['Status', 'ACTIVE']))
  })

  test('Pause sends the legacy PAUSED value for an ACTIVE matka', async () => {
    server.status = 'ACTIVE'
    const sent: Array<Record<string, unknown>> = []
    renderPage([matkaMock(), listMock, statusMock('PAUSED', sent)])
    const pause = await screen.findByRole('button', { name: 'Pause' })
    assertAbsent(screen.queryByRole('button', { name: 'Activate' }), 'Activate')

    await act(async () => {
      fireEvent.click(pause)
    })

    await waitFor(() => assert.deepEqual(sent, [{ id: '7', toStatus: 'PAUSED' }]))
    await waitFor(() => assert.equal(server.lookups, 2))
  })

  test('Clone sends "<name> Copy" and "<code>-copy", then opens the matka list', async () => {
    const sent: Array<Record<string, unknown>> = []
    renderPage([
      matkaMock(),
      listMock,
      {
        request: {
          query: CLONE_MATKA_MUTATION,
          variables: { id: '7', name: 'Kalyan Morning Copy', code: 'KLM-copy' },
        },
        result: () => {
          sent.push({ id: '7', name: 'Kalyan Morning Copy', code: 'KLM-copy' })
          return {
            data: {
              cloneMatka: {
                __typename: 'MatkaPayload',
                success: true,
                message: 'Matka cloned',
                matka: { __typename: 'Matka', id: '8', name: 'Kalyan Morning Copy', code: 'KLM-copy', status: 'INACTIVE' },
              },
            },
          }
        },
      },
    ])
    const clone = await screen.findByRole('button', { name: 'Clone' })

    await act(async () => {
      fireEvent.click(clone)
    })

    await screen.findByText('Matka list route')
    assert.equal(sent.length, 1)
  })

  test('the guard asks for matka.management view; a denied caller sees the denial and no lookup runs', () => {
    rbac.allowed = false
    renderPage([matkaMock()])
    assert.deepEqual(rbac.calls, [[{ domain: 'matka.management', actions: ['view'] }]])
    assert.equal(screen.getByRole('alert').textContent, 'Access denied')
    assert.equal(apollo.queries.length, 0)
    assert.equal(server.lookups, 0)
  })

  test('a matka the server does not return shows the route label and Not found', async () => {
    renderPage([{
      request: { query: MATKA_QUERY, variables: { id: '7' } },
      result: { data: { matka: null } },
    }])
    const heading = await screen.findByRole('heading', { level: 1, name: 'Matka Details' })
    assert.ok(heading)
    assert.ok(screen.getByText('Not found'))
    assertAbsent(screen.queryByRole('button', { name: 'Clone' }), 'Clone')
  })

  test('a failed load says why, and Retry loads the matka', async () => {
    renderPage([
      {
        request: { query: MATKA_QUERY, variables: { id: '7' } },
        error: new Error('Response not successful: Received status code 502'),
      },
      matkaMock(),
      listMock,
    ])
    await screen.findByText('Failed to load matka: Response not successful: Received status code 502')
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Matka Details' }))
    assertAbsent(screen.queryByText('Not found'), 'Not found')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    await screen.findByRole('heading', { level: 1, name: 'Kalyan Morning' })
  })

  test('a Super Admin in core mode is asked to select a whitelabel: no lookup, and no Edit, Clone or status action', async () => {
    // Core mode read the platform's own tenant ('default'): a real matka showed "Not found", and Clone or a status
    // change would have acted in that tenant, where no whitelabel sees it.
    const auth = useAuthStore.getState(), ui = useUIStore.getState()
    useAuthStore.setState({ roles: ['Super Admin'] }); useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    try {
      const core = renderPage([matkaMock(), listMock])
      assert.ok(await screen.findByText('Select a whitelabel'))
      assert.ok(screen.getByRole('heading', { level: 1, name: 'Matka Details' }))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      assert.equal(server.lookups, 0, 'no Matka lookup')
      assert.equal(apollo.queries.length, 0)
      assert.equal(apollo.mutations.length, 0, 'no clone or status mutation is prepared')
      assertAbsent(screen.queryByRole('link', { name: 'Edit' }), 'Edit')
      assertAbsent(screen.queryByRole('button', { name: 'Clone' }), 'Clone')
      assertAbsent(screen.queryByRole('button', { name: 'Activate' }), 'Activate')
      assertAbsent(screen.queryByText('Not found'), 'Not found')
      core.unmount()
      // With a site selected the same admin gets the page, as a whitelabel admin always does.
      useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'grandwinn-com' })
      renderPage([matkaMock(), listMock])
      await screen.findByRole('heading', { level: 1, name: 'Kalyan Morning' })
      assert.ok(screen.queryByText('Select a whitelabel') === null, 'no select state with a site selected')
      assert.ok(screen.getByRole('button', { name: 'Clone' }))
    } finally {
      useAuthStore.setState({ roles: auth.roles }); useUIStore.setState({ directorMode: ui.directorMode, selectedWhitelabelId: ui.selectedWhitelabelId })
    }
  })
})
