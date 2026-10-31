import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Matka } from '@/modules/matka/types'
import { ActionsDrawer } from './ActionsDrawer'

interface Call {
  operationName: string
  variables: Record<string, unknown>
}

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string | Date) => new Date(value).toISOString().slice(0, 16),
  }),
}))

const MATKA = {
  id: 'm1',
  name: 'Kalyan',
  code: 'KLN',
  description: 'Primary market',
  timezone: 'Asia/Kolkata',
  schedule: {},
  status: 'inactive',
  limits: {},
  visibility: {},
  priority: 3,
  settings: {},
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} satisfies Matka

let calls: Call[]
const callbacks = { close: vi.fn(), refetch: vi.fn() }

function operationResult(operation: Operation): FetchResult {
  switch (operation.operationName) {
    case 'CloneMatka':
      return {
        data: {
          cloneMatka: {
            __typename: 'MatkaPayload', success: true, message: 'Cloned',
            matka: { __typename: 'Matka', id: 'm2', name: 'Kalyan Copy', code: 'KLN-copy', status: 'INACTIVE' },
          },
        },
      }
    case 'SetMatkaStatus':
      return {
        data: {
          setMatkaStatus: {
            __typename: 'MatkaPayload', success: true, message: 'Changed',
            matka: { __typename: 'Matka', id: 'm1', status: operation.variables.toStatus },
          },
        },
      }
    case 'DeleteMatka':
      return { data: { deleteMatka: true } }
    case 'Matkas':
      return { data: { matkas: { __typename: 'MatkaPage', items: [], total: 0 } } }
    default:
      throw new Error(`unexpected operation ${operation.operationName}`)
  }
}

function link() {
  return new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
    calls.push({ operationName: operation.operationName, variables: { ...operation.variables } })
    Promise.resolve().then(() => operationResult(operation)).then((result) => {
      observer.next(result)
      observer.complete()
    }, (error: unknown) => observer.error(error))
  }))
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderDrawer(matka: Matka = MATKA) {
  return render(
    <MockedProvider link={link()}>
      <MemoryRouter initialEntries={['/matka/list']}>
        <Routes>
          <Route
            path="*"
            element={(
              <>
                <ActionsDrawer
                  matka={matka}
                  open
                  onClose={callbacks.close}
                  onRefetch={callbacks.refetch}
                />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
}

beforeEach(() => {
  calls = []
  callbacks.close.mockReset()
  callbacks.refetch.mockReset()
})

describe('ActionsDrawer', () => {
  test('renders the exact identity, facts and lower-case legacy status actions in kit surfaces', async () => {
    renderDrawer()
    const drawer = await screen.findByRole('dialog', { name: 'Kalyan' })
    assert.ok(within(drawer).getByText('KLN • Priority 3'))
    assert.ok(within(drawer).getByText('INACTIVE'))
    assert.ok(within(drawer).getByText('Primary market'))
    assert.ok(within(drawer).getByText('Asia/Kolkata'))
    assert.ok(within(drawer).getByRole('button', { name: 'Activate' }))
    assert.ok(within(drawer).queryByRole('button', { name: 'Deactivate' }) === null)
    assert.ok(within(drawer).getByRole('button', { name: 'Suspend' }))
  })

  test('clones with the exact historical name/code and closes after refetch', async () => {
    renderDrawer()
    fireEvent.click(await screen.findByRole('button', { name: 'Clone Matka' }))
    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'CloneMatka')))
    const mutation = calls.find((call) => call.operationName === 'CloneMatka')
    assert.deepEqual(mutation?.variables, { id: 'm1', name: 'Kalyan Copy', code: 'KLN-copy' })
    assert.equal(callbacks.refetch.mock.calls.length, 1)
    assert.equal(callbacks.close.mock.calls.length, 1)
  })

  test('repairs status variables to the GraphQL enum while preserving the action copy', async () => {
    renderDrawer()
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }))
    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'SetMatkaStatus')))
    assert.deepEqual(calls.find((call) => call.operationName === 'SetMatkaStatus')?.variables, {
      id: 'm1', toStatus: 'ACTIVE',
    })
    assert.equal(callbacks.refetch.mock.calls.length, 1)
    assert.equal(callbacks.close.mock.calls.length, 1)
  })

  test('requires a non-blank delete reason but sends the original entered value', async () => {
    renderDrawer()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Matka' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Matka' })
    const reason = within(confirm).getByRole('textbox', { name: /Please provide a reason/ })
    const remove = within(confirm).getByRole('button', { name: 'Delete' })
    assert.ok(remove.hasAttribute('disabled'))
    fireEvent.change(reason, { target: { value: '  duplicate market  ' } })
    fireEvent.click(remove)
    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'DeleteMatka')))
    assert.deepEqual(calls.find((call) => call.operationName === 'DeleteMatka')?.variables, {
      id: 'm1', reason: '  duplicate market  ',
    })
    assert.equal(callbacks.refetch.mock.calls.length, 1)
    assert.equal(callbacks.close.mock.calls.length, 1)
  })

  test('edit navigates to the unchanged route and closes the drawer', async () => {
    renderDrawer()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Matka' }))
    assert.equal(screen.getByTestId('location').textContent, '/matka/edit/m1')
    assert.equal(callbacks.close.mock.calls.length, 1)
  })
})
