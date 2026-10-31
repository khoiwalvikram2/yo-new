import { beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloLink, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { useAuthStore } from '@/shared/core/authStore'
import type { Player } from '@/shared/types/player'
import { BettingControlsSection } from './BettingControlsSection'
const domains = ['Sports', 'Casino', 'Matka']
let calls: Record<string, unknown>[]
let reject: boolean
const player = (type = 'REGULAR'): Player => ({ id: '123', name: 'Fixture', phone: '000', playerType: type as Player['playerType'], status: 'ACTIVE', bonusAllowed: false,
  sportsVisible: false, casinoVisible: false, matkaVisible: false, sportsBetAllowed: false, casinoBetAllowed: false, matkaBetAllowed: false })
const agent = (scheme = 'CREDIT') => ({ id: 'a1', username: 'Fixture Agent', tenantId: 'qa', phone: null, parentAgentId: null, levelIndex: 1, schemeType: scheme,
  status: 'ACTIVE', allowedDomains: ['sports','casino','matka'], tallyEnabled: false, tallyDomains: [], createdAt: '' })
function view(user = player()) {
  let stored = { ...user }
  const link = new ApolloLink(operation => new Observable(observer => {
    calls.push(operation.variables)
    Promise.resolve().then(() => {
      if (reject) { observer.error(new Error('Agent branch does not allow this domain')); return }
      for (const domain of ['sports','casino','matka'] as const) {
        if (operation.variables[domain] !== undefined) stored = { ...stored, [`${domain}BetAllowed`]: operation.variables[domain] }
        if (operation.variables[`${domain}Visible`] !== undefined) stored = { ...stored, [`${domain}Visible`]: operation.variables[`${domain}Visible`] }
      }
      observer.next({ data: { setUserDomainBets: { __typename: 'UserPayload', success: true, message: 'Updated', user: { __typename: 'User', ...stored } } } }); observer.complete()
    })
  }))
  return render(<MockedProvider link={link}><BettingControlsSection user={user} saving={{}} setSavingFlag={vi.fn()} /></MockedProvider>)
}
beforeEach(() => { calls = []; reject = false; useAuthStore.setState({ agent: undefined, isReadOnly: false, permissions: [{ domain: 'players.profile', actions: ['update'] }] }) })
for (const type of ['REGULAR','WHITELABEL_CREDIT','AGENT_CREDIT','SHARING_AGENT_PLAYER','COMMISSION_AGENT_PLAYER']) {
  test(`all six access switches save independently for ${type}`, async () => {
    view(player(type)); assert.equal(screen.getAllByRole('switch').length, 6)
    for (const label of domains) {
      const domain = label.toLowerCase(), visible = screen.getByRole('switch', { name: `${label} Visible` })
      fireEvent.click(visible)
      await waitFor(() => assert.equal(visible.getAttribute('aria-checked'), 'true'))
      const betting = screen.getByRole('switch', { name: `${label} Betting Allowed` })
      fireEvent.click(betting)
      await waitFor(() => assert.equal(betting.getAttribute('aria-checked'), 'true'))
      assert.ok(calls.some(call => call[`${domain}Visible`] === true && call.id === '123'))
      assert.ok(calls.some(call => call[domain] === true && call.id === '123'))
    }
  })
}
for (const scheme of ['CREDIT','SHARING','COMMISSION']) test(`${scheme} agents get editable domain switches for owned players`, () => {
  useAuthStore.setState({ agent: agent(scheme), permissions: [] }); view()
  assert.ok(!screen.getByRole('switch', { name: 'Matka Visible' }).hasAttribute('disabled'))
})
test('read-only agents and admins without update permission cannot edit access', () => {
  useAuthStore.setState({ agent: agent(), isReadOnly: true, permissions: [] }); const first = view()
  assert.ok(screen.getAllByRole('switch').every(node => node.hasAttribute('disabled'))); first.unmount()
  useAuthStore.setState({ agent: undefined, isReadOnly: false, permissions: [] }); view()
  assert.ok(screen.getAllByRole('switch').every(node => node.hasAttribute('disabled'))); assert.equal(calls.length, 0)
})
test('a rejected server update leaves the saved switch value unchanged', async () => {
  reject = true; view(); fireEvent.click(screen.getByRole('switch', { name: 'Matka Visible' }))
  await screen.findByRole('alert')
  assert.equal(screen.getByRole('switch', { name: 'Matka Visible' }).getAttribute('aria-checked'), 'false')
})
