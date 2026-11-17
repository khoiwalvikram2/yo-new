/* Test-only helpers for the chips module's tests (imported by *.test.tsx only, so never bundled): a mock
   GraphQL server that answers by operation name and records every call, fixtures in the shapes of spec §7,
   and a render wrapper. Each test file still mocks the currency and date contexts itself, because vi.mock
   only hoists within the file that calls it. */
import type { ReactElement } from 'react'
import {
  ApolloClient,
  ApolloLink,
  ApolloProvider,
  InMemoryCache,
  Observable,
  type FetchResult,
  type NormalizedCacheObject,
} from '@apollo/client'
import { print } from 'graphql'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ChipAccount, ChipPool, ChipStatementRow, ChipTotals } from '@/lib/graphql/chips'

export interface ChipCall {
  operationName: string
  variables: Record<string, unknown>
  document: string
}

/** The `agents` payload for an operation, or an Error to answer with a GraphQL error carrying its message. */
export type ChipHandler = (variables: Record<string, unknown>) => unknown

export interface ChipServer {
  client: ApolloClient<NormalizedCacheObject>
  calls: ChipCall[]
  callsOf: (operationName: string) => ChipCall[]
}

export function chipServer(handlers: Record<string, ChipHandler>): ChipServer {
  const calls: ChipCall[] = []
  const link = new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
    const mutation = print(operation.query).trimStart().startsWith('mutation')
    const call: ChipCall = {
      operationName: operation.operationName,
      variables: JSON.parse(JSON.stringify(operation.variables ?? {})) as Record<string, unknown>,
      document: print(operation.query),
    }
    calls.push(call)
    const timer = setTimeout(() => {
      try {
        const handler = handlers[operation.operationName]
        if (!handler) throw new Error(`No mock for ${operation.operationName}`)
        const payload = handler(call.variables)
        if (payload instanceof Error) {
          observer.next({ data: null, errors: [{ message: payload.message }] })
        } else {
          observer.next({ data: { agents: { __typename: mutation ? 'AgentsMutation' : 'AgentsQuery', ...(payload as object) } } })
        }
        observer.complete()
      } catch (error) {
        observer.error(error)
      }
    }, 0)
    return () => clearTimeout(timer)
  }))
  const client = new ApolloClient({ link, cache: new InMemoryCache() })
  return { client, calls, callsOf: (operationName) => calls.filter((call) => call.operationName === operationName) }
}

export function renderWithChips(ui: ReactElement, server: ChipServer, route = '/') {
  return render(
    <ApolloProvider client={server.client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </ApolloProvider>,
  )
}

type Typed<T, N extends string> = T & { __typename: N }

export function chipAccountFixture(overrides: Partial<ChipAccount> = {}): Typed<ChipAccount, 'ChipAccount'> {
  return {
    __typename: 'ChipAccount',
    accountType: 'AGENT',
    id: 'agent-1',
    username: 'agent1',
    name: null,
    status: 'ACTIVE',
    parentAgentId: null,
    playerType: null,
    currency: 'INR',
    creditReference: 100000,
    balance: 95000,
    exposure: 0,
    available: 95000,
    downlineBalance: 0,
    refPnl: -5000,
    downlineCount: 0,
    ...overrides,
  }
}

export function chipPoolFixture(overrides: Partial<ChipPool> = {}): Typed<ChipPool, 'ChipPool'> {
  return { __typename: 'ChipPool', currency: 'INR', creditLimit: 1000000, used: 100000, available: 900000, ...overrides }
}

export function chipTotalsFixture(overrides: Partial<ChipTotals> = {}): Typed<ChipTotals, 'ChipTotals'> {
  return { __typename: 'ChipTotals', creditReference: 0, balance: 0, exposure: 0, available: 0, downlineBalance: 0, refPnl: 0, ...overrides }
}

export function chipRowFixture(overrides: Partial<ChipStatementRow> = {}): Typed<ChipStatementRow, 'ChipStatementRow'> {
  return {
    __typename: 'ChipStatementRow',
    id: 'row-1',
    createdAt: '2026-11-02T10:00:00.000Z',
    kind: 'DEPOSIT',
    amount: 500,
    balanceBefore: 1000,
    balanceAfter: 1500,
    creditReferenceBefore: null,
    creditReferenceAfter: null,
    counterpartyType: 'agent',
    counterpartyId: 'agent-1',
    counterpartyName: 'agent1',
    remark: null,
    createdBy: 'agent-1',
    ...overrides,
  }
}

/** The signed-in agent, in the auth store's shape. */
export function agentSession(overrides: { id?: string; schemeType?: string; status?: string } = {}) {
  return {
    id: overrides.id ?? 'agent-1',
    tenantId: 'tenant-1',
    username: 'agent1',
    phone: null,
    schemeType: overrides.schemeType ?? 'CREDIT',
    allowedDomains: [],
    status: overrides.status ?? 'ACTIVE',
    parentAgentId: null,
    levelIndex: 1,
    tallyEnabled: false,
    tallyDomains: null,
    createdAt: '2026-11-01T00:00:00.000Z',
  }
}
