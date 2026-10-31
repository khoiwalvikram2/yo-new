import type { ReactNode } from 'react'
import { beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import MatkaSettingsPage from './SettingsPage'

const access = vi.hoisted(() => ({ allowed: true }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children }: { children: ReactNode }) => access.allowed ? children : <p role="alert">Access denied</p> }))
vi.mock('@/modules/vip/hooks/useVIP', () => ({ useVIPTiers: () => ({ data: { vipTiers: [] }, loading: false }) }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ getCurrencySymbol: () => 'INR' }) }))

const INITIAL = {
  __typename: 'Matka', id: 'm1', name: 'Kalyan', code: 'KLN', description: null, timezone: 'Asia/Kolkata',
  status: 'ACTIVE', priority: 1, visibility: {}, schedule: {},
  limits: { minBet: 10, maxBet: 1000, exposureDaily: 5000 }, settings: { riskLevel: 'medium', riskThreshold: 500 },
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', deletedAt: null,
}
let record: typeof INITIAL | null
let failSave: boolean
let failLoad: boolean
let calls: Array<{ operationName: string; variables: Record<string, unknown> }>

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}
function renderPage(path = '/matka/settings/m1?tab=stake') {
  const link = new ApolloLink(operation => new Observable<FetchResult>(observer => {
    calls.push({ operationName: operation.operationName, variables: structuredClone(operation.variables) })
    Promise.resolve().then(() => {
      switch (operation.operationName) {
        case 'Matka':
          if (failLoad) throw new Error('Market load failed')
          return { data: { matka: record } }
        case 'MatkaBidRules': return { data: { matkaBidRules: { __typename: 'MatkaBidRulePage', items: [], total: 0 } } }
        case 'Matkas': return { data: { matkas: { __typename: 'MatkaPage', items: [], total: 0, page: 1, limit: 20 } } }
        case 'UpdateMatka': {
          if (failSave) throw new Error('Save temporarily unavailable')
          const input = operation.variables.input
          record = { ...record!, ...input }
          return { data: { updateMatka: { __typename: 'MatkaPayload', success: true, message: 'Updated', matka: record } } }
        }
        case 'SetMatkaStatus': {
          record = { ...record!, status: operation.variables.toStatus }
          return { data: { setMatkaStatus: { __typename: 'MatkaPayload', success: true, message: 'Updated', matka: record } } }
        }
        case 'UpdateMatkaSettings': {
          record = { ...record!, settings: operation.variables.settings }
          return { data: { updateMatkaSettings: { __typename: 'MatkaPayload', success: true, message: 'Updated', matka: record } } }
        }
        default: throw new Error(`Unexpected operation ${operation.operationName}`)
      }
    }).then(result => { observer.next(result); observer.complete() }, failure => observer.error(failure))
  }))
  return render(<MockedProvider link={link}><MemoryRouter initialEntries={[path]}><PageEyebrowProvider value="Trading">
    <Routes><Route path="/matka/settings/:id" element={<MatkaSettingsPage />} /><Route path="/matka/management" element={<h1>Management list</h1>} /></Routes>
    <LocationProbe />
  </PageEyebrowProvider></MemoryRouter></MockedProvider>)
}

beforeEach(() => {
  record = structuredClone(INITIAL); calls = []; failSave = false; failLoad = false; access.allowed = true
})

test('opens a direct page URL with its tab, preserves edits across tabs, and saves the configured market', async () => {
  renderPage('/matka/settings/m1?tab=risk')
  await screen.findByRole('textbox', { name: 'Risk Threshold' })
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Edit Matka Settings' }))
  assert.ok(screen.getByRole('region', { name: 'Market overview' }))
  assert.ok(screen.getByRole('heading', { name: 'Save options' }))
  assert.equal(screen.getByRole('tablist', { name: 'Matka settings' }).getAttribute('aria-orientation'), 'vertical')
  assert.equal(screen.queryByRole('dialog'), null)
  assert.equal(screen.getByRole('tab', { name: 'Risk' }).getAttribute('aria-selected'), 'true')
  fireEvent.click(screen.getByRole('tab', { name: 'Stake Limits' }))
  const minimum = screen.getByRole('textbox', { name: 'Min Stake' })
  fireEvent.change(minimum, { target: { value: '12.25' } }); fireEvent.blur(minimum)
  assert.ok(screen.getByText('Unsaved changes'))
  fireEvent.click(screen.getByRole('tab', { name: 'Bid Settings' }))
  await screen.findByText('Create Bid Configuration')
  assert.equal(screen.getByTestId('location').textContent, '/matka/settings/m1?tab=bid')
  fireEvent.click(screen.getByRole('tab', { name: 'Stake Limits' }))
  assert.equal((screen.getByRole('textbox', { name: 'Min Stake' }) as HTMLInputElement).value, '12.25')
  fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
  await screen.findByText('Settings saved successfully.')
  assert.ok(screen.getByText('No unsaved changes'))
  assert.equal((screen.getByRole('textbox', { name: 'Min Stake' }) as HTMLInputElement).value, '12.25')
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  assert.equal((screen.getByRole('textbox', { name: 'Min Stake' }) as HTMLInputElement).value, '12.25')
  assert.deepEqual(calls.find(call => call.operationName === 'UpdateMatka')?.variables,
    { input: { id: 'm1', limits: { minBet: 12.25, maxBet: 1000, exposureDaily: 5000 } } })
  assert.deepEqual(calls.find(call => call.operationName === 'Matka')?.variables, { id: 'm1' })
  assert.deepEqual(calls.find(call => call.operationName === 'MatkaBidRules')?.variables, { filters: { matkaId: 'm1', page: 1, limit: 20 } })
  assert.ok(calls.filter(call => call.operationName === 'Matka').length >= 2)
})

test('save failures retain edited values for retry', async () => {
  failSave = true; renderPage()
  const minimum = await screen.findByRole('textbox', { name: 'Min Stake' })
  fireEvent.change(minimum, { target: { value: '25' } }); fireEvent.blur(minimum)
  fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
  await screen.findByRole('alert')
  assert.equal((screen.getByRole('textbox', { name: 'Min Stake' }) as HTMLInputElement).value, '25')
  assert.equal(screen.queryByText('Settings saved successfully.'), null)
  failSave = false
  fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
  await screen.findByText('Settings saved successfully.')
})

test('reset restores loaded settings and cancel returns to management without mutations', async () => {
  renderPage()
  const minimum = await screen.findByRole('textbox', { name: 'Min Stake' })
  fireEvent.change(minimum, { target: { value: '50' } }); fireEvent.blur(minimum)
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  assert.equal((screen.getByRole('textbox', { name: 'Min Stake' }) as HTMLInputElement).value, '10')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await screen.findByRole('heading', { name: 'Management list' })
  assert.ok(calls.every(call => !['UpdateMatka', 'SetMatkaStatus', 'UpdateMatkaSettings'].includes(call.operationName)))
})

test('not-found and loading errors have recovery routes instead of an empty editor', async () => {
  record = null
  const first = renderPage()
  await screen.findByText('Matka not found')
  assert.equal(screen.queryByRole('button', { name: 'Apply Changes' }), null)
  first.unmount()
  failLoad = true; renderPage()
  await screen.findByText('Could not load matka settings')
  assert.ok(screen.getByRole('button', { name: 'Try again' }))
})

test('denied access starts no market or settings query', async () => {
  access.allowed = false; renderPage()
  await waitFor(() => assert.ok(screen.getByRole('alert')))
  assert.equal(calls.length, 0)
})
