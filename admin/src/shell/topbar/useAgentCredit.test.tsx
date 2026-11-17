/**
 * useAgentCredit feeds a CREDIT agent's topbar wallet. On Deposit/Withdraw chips (spec 2026-11-02 §8) it
 * reads the agent's own chips from myChipAccount (never the retired myAgentCredit), maps them to the
 * wallet figures, and hides the wallet for other schemes, for a failed first read and for an answer with
 * no chips account. It reads no sharing figures: CREDIT has no partnership split.
 */
import { afterEach, beforeEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { ApolloProvider } from '@apollo/client'
import { renderHook, waitFor } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { agentSession, chipAccountFixture, chipServer, type ChipHandler, type ChipServer } from '@/modules/chips/chipTestKit'
import { useAgentCredit } from './useAgentCredit'

const ME = chipAccountFixture({ id: 'agent-1', creditReference: 100000, balance: 95000, available: 95000, downlineBalance: 9700, refPnl: 4700 })
const servers: ChipServer[] = []

function mount(handlers: Record<string, ChipHandler>) {
  // Every call is recorded before it is answered, so a sharing read would show in server.calls.
  const server = chipServer(handlers)
  servers.push(server)
  const wrapper = ({ children }: { children: ReactNode }) => <ApolloProvider client={server.client}>{children}</ApolloProvider>
  return { server, ...renderHook(() => useAgentCredit(), { wrapper }) }
}

beforeEach(() => useAuthStore.setState({ agent: agentSession(), user: undefined, permissions: [], agentPermissions: [], isReadOnly: false }))
afterEach(() => {
  servers.splice(0).forEach((server) => server.client.stop())
})

describe('useAgentCredit', () => {
  test('a CREDIT agent’s wallet shows its own chips from myChipAccount, and nothing about sharing', async () => {
    const { server, result } = mount({ MyChipAccount: () => ({ myChipAccount: ME }) })
    assert.equal(result.current.visible, true)
    assert.equal(result.current.loading, true, 'a placeholder until the first answer')
    await waitFor(() => assert.equal(result.current.loading, false))
    assert.deepEqual(result.current, {
      visible: true,
      loading: false,
      chips: { currency: 'INR', balance: 95000, downlineBalance: 9700, creditReference: 100000, refPnl: 4700 },
    })
    assert.equal(server.callsOf('MyChipAccount').length, 1)
    assert.ok(server.calls.every((call) => !/AgentCredit/.test(call.operationName)), 'no credit-limit read or subscription')
    assert.ok(server.calls.every((call) => !/Sharing/.test(call.operationName)), 'no sharing read or subscription')
  })

  test('another scheme gets no wallet and reads no chips', async () => {
    useAuthStore.setState({ agent: agentSession({ schemeType: 'SHARING' }) })
    const { server, result } = mount({ MyChipAccount: () => ({ myChipAccount: ME }) })
    assert.equal(result.current.visible, false)
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(server.callsOf('MyChipAccount').length, 0)
  })

  test('a failed first read, or an answer with no chips account, hides the wallet', async () => {
    const failed = mount({ MyChipAccount: () => new Error('Chips unavailable') })
    await waitFor(() => assert.equal(failed.result.current.visible, false))
    failed.unmount()

    const empty = mount({ MyChipAccount: () => ({ myChipAccount: null }) })
    await waitFor(() => assert.equal(empty.result.current.visible, false))
    assert.equal(empty.result.current.chips, null)
  })
})
