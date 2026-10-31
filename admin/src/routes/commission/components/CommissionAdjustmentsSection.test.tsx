import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { commissionResponse, type CommissionFixtureOptions } from '../../../../test/commissionPreviewData'
import { CommissionAdjustmentsSection } from './CommissionAdjustmentsSection'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `INR ${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value }) }))
vi.mock('@/shared/services/notification', () => ({ notify: feedback }))

const AGENT_LOGIN = { id: 'sub-1', username: 'Partner', tenantId: 'preview', phone: null, parentAgentId: 'root-1', levelIndex: 2, schemeType: 'COMMISSION' as const, status: 'ACTIVE', allowedDomains: ['sports'], tallyEnabled: false, tallyDomains: [], createdAt: '' }

let calls: { name: string; variables: Record<string, unknown> }[]
let options: CommissionFixtureOptions
function mount(entry = '/agents/sub-1') {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    queueMicrotask(() => { observer.next(commissionResponse(operation, options)); observer.complete() })
  }))
  return render(<MemoryRouter initialEntries={[entry]}><MockedProvider link={link} cache={new InMemoryCache()}>
    <CommissionAdjustmentsSection agentId="sub-1" username="Partner" />
  </MockedProvider></MemoryRouter>)
}
const asAdmin = (actions: string[] = ['write']) => useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'finance', actions }] })
const loadedSection = async () => {
  const section = await screen.findByRole('region', { name: 'Adjustments' })
  await within(section).findByText('-INR 25.50')
  return section
}
beforeEach(() => { calls = []; options = {}; feedback.success.mockClear(); feedback.error.mockClear(); asAdmin() })
afterEach(cleanup)

describe('CommissionAdjustmentsSection', () => {
  test('lists the adjustments with signed amounts in words, weeks, status, reason and IST dates', async () => {
    mount()
    const section = await loadedSection()
    const table = within(section).getByRole('table', { name: 'Commission adjustments' })
    assert.ok(within(table).getByText('+INR 40.00'))
    assert.ok(within(table).getByText('+INR 10.00'))
    assert.equal(within(table).getAllByText('Deduct').length, 1)
    assert.equal(within(table).getAllByText('Add').length, 2)
    for (const text of ['Pending', 'Applied', 'Cancelled', 'Void', 'Correction', 'Refund']) assert.ok(within(table).getByText(text), text)
    // The pending one corrects the closed week; the applied one landed in it. Both other rows correct the week before.
    assert.equal(within(table).getAllByText('28 Sep – 04 Oct 2026').length, 2)
    assert.equal(within(table).getAllByText('21 Sep – 27 Sep 2026').length, 2)
    for (const text of ['06 Oct 2026 10:30', '01 Oct 2026 10:30', '30 Sep 2026 10:30', '02 Oct 2026 10:30']) assert.ok(within(table).getByText(text), text)
    assert.deepEqual(calls.find((call) => call.name === 'CommissionAdjustmentsPage')?.variables, { agentId: 'sub-1', limit: 20, offset: 0 })
  })

  test('an admin with settlements.commission:create gets New adjustment, and Apply / Cancel on the pending row only', async () => {
    mount()
    const section = await loadedSection()
    assert.ok(within(section).getByRole('button', { name: 'New adjustment' }))
    assert.equal(within(section).getAllByRole('button', { name: 'Apply' }).length, 1)
    assert.equal(within(section).getAllByRole('button', { name: 'Cancel' }).length, 1)
  })

  test('agents, and admins without the permission, see the list read-only', async () => {
    for (const setup of [() => useAuthStore.setState({ agent: AGENT_LOGIN, permissions: [] }), () => asAdmin(['read'])]) {
      cleanup()
      setup()
      mount()
      const section = await loadedSection()
      assert.equal(within(section).queryByRole('button', { name: 'New adjustment' }), null)
      assert.equal(within(section).queryByRole('button', { name: 'Apply' }), null)
      assert.equal(within(section).queryByRole('button', { name: 'Cancel' }), null)
      assert.equal(within(section).queryByRole('columnheader', { name: 'Actions' }), null)
    }
  })

  test('New adjustment and Apply open their dialogs for this agent', async () => {
    mount()
    const section = await loadedSection()
    fireEvent.click(within(section).getByRole('button', { name: 'New adjustment' }))
    const created = await screen.findByRole('dialog', { name: 'New adjustment — Partner' })
    await waitFor(() => assert.deepEqual(calls.filter((call) => call.name === 'CommissionCyclesForAgent').at(-1)?.variables, { agentId: 'sub-1' }))
    fireEvent.click(within(created).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    fireEvent.click(within(section).getByRole('button', { name: 'Apply' }))
    const apply = await screen.findByRole('dialog', { name: 'Apply adjustment' })
    assert.ok(within(apply).getByText('-INR 25.50 · Deduct'))
  })

  test('Cancel asks first, sends the adjustment id, reports success and reloads the list', async () => {
    mount()
    const section = await loadedSection()
    fireEvent.click(within(section).getByRole('button', { name: 'Cancel' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel this adjustment?' })
    assert.equal(calls.some((call) => call.name === 'CancelCommissionAdjustment'), false)
    const listReads = calls.filter((call) => call.name === 'CommissionAdjustmentsPage').length
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel adjustment' }))
    await waitFor(() => assert.deepEqual(calls.find((call) => call.name === 'CancelCommissionAdjustment')?.variables, { adjustmentId: 'adj-pending' }))
    await waitFor(() => assert.ok(feedback.success.mock.calls.some(([text]) => text === 'Adjustment cancelled')))
    await waitFor(() => assert.ok(calls.filter((call) => call.name === 'CommissionAdjustmentsPage').length > listReads))
    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null))
  })

  test('a refused cancel keeps the confirm dialog open with the reason', async () => {
    options.adjustmentRefused = true
    mount()
    const section = await loadedSection()
    fireEvent.click(within(section).getByRole('button', { name: 'Cancel' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel this adjustment?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel adjustment' }))
    assert.ok(await within(confirm).findByText('Only a PENDING adjustment can be cancelled (this one is APPLIED)'))
    assert.ok(screen.getByRole('alertdialog', { name: 'Cancel this adjustment?' }))
    assert.equal(feedback.success.mock.calls.length, 0)
  })

  test('opening the page at #commission-adjustments scrolls the card into view; without the hash it does not', async () => {
    const scroll = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView')
    try {
      const plain = mount('/agents/sub-1')
      await screen.findByRole('region', { name: 'Adjustments' })
      assert.equal(scroll.mock.calls.length, 0)
      plain.unmount()
      mount('/agents/sub-1?tab=commission#commission-adjustments')
      await screen.findByRole('region', { name: 'Adjustments' })
      await waitFor(() => assert.deepEqual(scroll.mock.calls, [[{ block: 'start' }]]))
    } finally {
      scroll.mockRestore()
    }
  })
})
