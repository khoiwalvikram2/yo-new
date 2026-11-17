import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { LivePlayerFeed } from './LivePlayerFeed'

vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatTime: (value: string) => value.slice(11, 19) }) }))

const event = { id: 'b1', at: '2026-11-04T08:00:00.000Z', userId: 746, userName: 'rakesh001', matkaType: 'worli', marketName: 'KALYAN', bidType: 'SINGLE', betAmount: 250, potentialWin: 2375, status: 'active' }
const row = () => screen.getByText('rakesh001').closest('li')!
// The bet's figures, as the row prints them: "Bet <amount>" and "Potential <amount>".
const figures = () => [...row().querySelectorAll('span')].map((span) => span.textContent).filter((text) => /^(Bet|Potential) /.test(text ?? ''))

beforeEach(() => useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] }))

// H403 (owner, 2026-11-04): the live feed printed each player's bet and potential win to every role, while the Bet List tab
// masks the same amounts. A role without settlements.center view sees who bet, on what, when and its status.
test('without settlements.center view each live bet shows its player, market, bid, time and status, but no amounts', () => {
  useAuthStore.setState({ permissions: [{ domain: 'matka.live-analysis', actions: ['view'] }] })
  render(<LivePlayerFeed latestEvent={event} />)
  assert.deepEqual(figures(), ['Bet ••••', 'Potential ••••'])
  for (const text of ['rakesh001', '08:00:00', 'WORLI · KALYAN · SINGLE', 'ACTIVE']) assert.ok(row().textContent?.includes(text), text)
  assert.equal(/250|2375/.test(row().textContent ?? ''), false, 'no amount shown')
})

test('with settlements.center view (directly or through finance read) each live bet shows its bet and potential win', () => {
  for (const permissions of [[{ domain: 'settlements.center', actions: ['view'] }], [{ domain: 'finance', actions: ['read'] }]]) {
    useAuthStore.setState({ permissions })
    const page = render(<LivePlayerFeed latestEvent={event} />)
    assert.deepEqual(figures(), ['Bet 250', 'Potential 2375'], JSON.stringify(permissions))
    page.unmount()
  }
})
