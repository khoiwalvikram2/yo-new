/**
 * The Export Center's row estimates (page migration C, W3 Task 128): each export type asks the same
 * document with the same variables and fetch policy as the legacy calculateEstimate, and counts the
 * same way. The client is a recording stand-in; documents are compared by identity with the moved
 * constants (exportsPageQueries.ts, which gate 10 holds equal to the legacy ones).
 */
import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { DocumentNode } from '@apollo/client'
import { estimateExport, type ExportEstimateRequest } from './exportsPageEstimate'
import { buildEstimateFilters, exportDateRange } from './exportsPageModel'
import {
  AGENT_EXPORT_ROW_COUNT_QUERY,
  AGENTS_COUNT_QUERY,
  AGENTS_FOR_ESTIMATE_QUERY,
  AGENTS_FOR_PERFORMANCE_QUERY,
  ALL_SUB_AGENTS_QUERY,
  AUDIT_LOGS_COUNT_QUERY,
  BONUS_CAMPAIGNS_COUNT_QUERY,
  CASINO_BETS_COUNT_QUERY,
  DEPOSIT_REQUESTS_COUNT_QUERY,
  MATKA_BETS_COUNT_QUERY,
  PLAYERS_COUNT_QUERY,
  PLAYERS_FOR_TRANSACTION_ESTIMATE_QUERY,
  SPORTS_BETS_COUNT_QUERY,
  WITHDRAWAL_REQUESTS_COUNT_QUERY,
} from './exportsPageQueries'

interface QueryCall {
  query: DocumentNode
  variables?: Record<string, unknown>
  fetchPolicy?: string
}

const STARTING_ZONE = process.env.TZ

afterEach(() => {
  if (STARTING_ZONE === undefined) delete process.env.TZ
  else process.env.TZ = STARTING_ZONE
})

/* A client that answers each document from a table, or fails it. */
function fakeClient(answers: Map<DocumentNode, unknown>) {
  const calls: QueryCall[] = []
  const client = {
    query: async (options: QueryCall) => {
      calls.push(options)
      const answer = answers.get(options.query)
      if (answer instanceof Error) throw answer
      return { data: answer, loading: false, networkStatus: 7 }
    },
  }
  return { client: client as unknown as Parameters<typeof estimateExport>[0], calls }
}

/* Seven IST days: 2026-10-01 to 2026-10-07, which dayjs counted as 6 whole days in IST. */
const WEEK = exportDateRange('2026-10-01', '2026-10-07')

function request(activeFilters: Record<string, unknown>, options: Partial<ExportEstimateRequest> = {}): ExportEstimateRequest {
  const isAgent = options.isAgent ?? false
  const agentId = options.agentId
  const dateRange = 'dateRange' in options ? options.dateRange : WEEK
  return {
    filters: buildEstimateFilters({ activeFilters, dateRange, isAgent, agentId }),
    dateRange,
    isAgent,
    agentId,
  }
}

function pinIst() {
  process.env.TZ = 'Asia/Kolkata'
  assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), -330)
}

describe('estimateExport', () => {
  test('players: the usersPage total, status upper-cased, network-only', async () => {
    const { client, calls } = fakeClient(new Map([[PLAYERS_COUNT_QUERY, { usersPage: { total: 50 } }]]))
    const estimate = await estimateExport(client, 'players', request({ status: 'active' }))
    assert.deepEqual(estimate, { rows: 50, size: '9.8 KB' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].query, PLAYERS_COUNT_QUERY)
    assert.deepEqual(calls[0].variables, { query: undefined, status: 'ACTIVE', offset: 0, limit: 1 })
    assert.equal(calls[0].fetchPolicy, 'network-only')

    const all = await estimateExport(client, 'players', request({ status: 'all' }))
    assert.equal(calls[1].variables?.status, undefined)
    assert.equal(all.rows, 50)
  })

  test('transactions: 30% of players, three a day, a type filter keeps 30%', async () => {
    pinIst()
    const { client, calls } = fakeClient(new Map([[PLAYERS_FOR_TRANSACTION_ESTIMATE_QUERY, { usersPage: { total: 100 } }]]))
    assert.deepEqual(await estimateExport(client, 'transactions', request({})), { rows: 540, size: '105.5 KB' })
    assert.deepEqual(calls[0].variables, { offset: 0, limit: 1 })
    assert.equal(calls[0].fetchPolicy, 'cache-first')
    assert.deepEqual(await estimateExport(client, 'transactions', request({ type: 'bet' })), { rows: 162, size: '31.6 KB' })

    const noRange = fakeClient(new Map())
    assert.deepEqual(
      await estimateExport(noRange.client, 'transactions', request({}, { dateRange: undefined })),
      { rows: 0, size: '0 B' },
    )
    assert.equal(noRange.calls.length, 0)
  })

  test('bets: the returned bets, with the legacy bet filters per domain', async () => {
    const answers = new Map<DocumentNode, unknown>([
      [SPORTS_BETS_COUNT_QUERY, { sportsBets: [{ id: '1' }, { id: '2' }, { id: '3' }] }],
      [CASINO_BETS_COUNT_QUERY, { casinoBets: [] }],
      [MATKA_BETS_COUNT_QUERY, { matkaBets: [{ id: '9' }] }],
    ])
    const { client, calls } = fakeClient(answers)
    assert.deepEqual(
      await estimateExport(client, 'sports-bets', request({ status: 'Won', sport: 'cricket' })),
      { rows: 3, size: '450 B' },
    )
    assert.equal(calls[0].query, SPORTS_BETS_COUNT_QUERY)
    assert.deepEqual(calls[0].variables, {
      query: { dateFrom: WEEK?.from, dateTo: WEEK?.to, status: 'won', sport: 'cricket' },
    })
    assert.equal(calls[0].fetchPolicy, 'network-only')

    assert.deepEqual(await estimateExport(client, 'casino-bets', request({ status: 'all' })), { rows: 0, size: '0 B' })
    assert.equal(calls[1].query, CASINO_BETS_COUNT_QUERY)
    assert.deepEqual(calls[1].variables, { query: { dateFrom: WEEK?.from, dateTo: WEEK?.to } })

    assert.deepEqual(await estimateExport(client, 'matka-bets', request({ matkaType: 'Worli' })), { rows: 1, size: '150 B' })
    assert.equal(calls[2].query, MATKA_BETS_COUNT_QUERY)
    assert.deepEqual(calls[2].variables, { query: { dateFrom: WEEK?.from, dateTo: WEEK?.to, matkaType: 'worli' } })

    const failing = fakeClient(new Map([[SPORTS_BETS_COUNT_QUERY, new Error('down')]]))
    assert.deepEqual(await estimateExport(failing.client, 'sports-bets', request({})), { rows: 0, size: '0 B' })
  })

  test('agents and sub-agents (admins)', async () => {
    const answers = new Map<DocumentNode, unknown>([
      [AGENTS_COUNT_QUERY, { agents: { agentsPage: { total: 12 } } }],
      [ALL_SUB_AGENTS_QUERY, {
        agents: { agentsPage: { items: [{ id: '1', parentAgentId: null }, { id: '2', parentAgentId: '1' }, { id: '3', parentAgentId: '1' }], total: 3 } },
      }],
    ])
    const { client, calls } = fakeClient(answers)
    assert.deepEqual(await estimateExport(client, 'agents', request({ status: 'active' })), { rows: 12, size: '5.9 KB' })
    assert.deepEqual(calls[0].variables, { query: undefined, schemeType: undefined, status: 'active', offset: 0, limit: 1 })
    assert.equal(calls[0].fetchPolicy, 'network-only')

    assert.deepEqual(await estimateExport(client, 'subagents', request({})), { rows: 2, size: '800 B' })
    assert.equal(calls[1].query, ALL_SUB_AGENTS_QUERY)
    assert.deepEqual(calls[1].variables, { offset: 0, limit: 1000 })

    const failing = fakeClient(new Map([[AGENTS_COUNT_QUERY, new Error('down')]]))
    assert.deepEqual(await estimateExport(failing.client, 'agents', request({})), { rows: 0, size: '0 B' })
  })

  test("an agent's estimate is the backend's count of its own export, for each type it may export", async () => {
    const { client, calls } = fakeClient(new Map([[AGENT_EXPORT_ROW_COUNT_QUERY, { agentExportRowCount: 1024 }]]))
    const agentRequest = request({ status: 'pending' }, { isAgent: true, agentId: 'agent-7' })
    assert.deepEqual(await estimateExport(client, 'deposits', agentRequest), { rows: 1024, size: '300.0 KB' })
    assert.equal(calls[0].query, AGENT_EXPORT_ROW_COUNT_QUERY)
    assert.deepEqual(calls[0].variables, {
      reportType: 'deposits',
      filtersJson: { status: 'pending', dateFrom: WEEK?.from, dateTo: WEEK?.to, agentId: 'agent-7' },
    })
    assert.equal(calls[0].fetchPolicy, 'network-only')

    const sizes: Array<[string, string]> = [
      ['players', '200.0 KB'],
      ['sports-bets', '150.0 KB'],
      ['casino-bets', '150.0 KB'],
      ['matka-bets', '150.0 KB'],
      ['withdrawals', '300.0 KB'],
      ['subagents', '400.0 KB'],
      ['commission', '300.0 KB'],
      ['settlement', '300.0 KB'],
    ]
    for (const [type, size] of sizes) {
      assert.deepEqual(await estimateExport(client, type, agentRequest), { rows: 1024, size }, type)
    }
    assert.ok(calls.every((call) => call.query === AGENT_EXPORT_ROW_COUNT_QUERY), 'no admin document is asked for an agent')
  })

  test('an agent estimate is nothing for a type it may not export, a null count or a failed query', async () => {
    const agentRequest = request({}, { isAgent: true, agentId: 'agent-7' })
    const none = fakeClient(new Map())
    assert.deepEqual(await estimateExport(none.client, 'audit-logs', agentRequest), { rows: 0, size: '0 B' })
    assert.equal(none.calls.length, 0)
    const nullCount = fakeClient(new Map([[AGENT_EXPORT_ROW_COUNT_QUERY, { agentExportRowCount: null }]]))
    assert.deepEqual(await estimateExport(nullCount.client, 'players', agentRequest), { rows: 0, size: '0 B' })
    const failing = fakeClient(new Map([[AGENT_EXPORT_ROW_COUNT_QUERY, new Error('down')]]))
    assert.deepEqual(await estimateExport(failing.client, 'players', agentRequest), { rows: 0, size: '0 B' })
  })

  test('commission, settlement, aggregates and KPIs follow the period', async () => {
    pinIst()
    const { client, calls } = fakeClient(new Map([
      [AGENTS_FOR_ESTIMATE_QUERY, { agents: { agentsPage: { total: 10 } } }],
      [AGENTS_FOR_PERFORMANCE_QUERY, { agents: { agentsPage: { total: 40 } } }],
    ]))
    assert.deepEqual(await estimateExport(client, 'commission', request({})), { rows: 42, size: '12.3 KB' })
    assert.deepEqual(calls[0].variables, { offset: 0, limit: 1 })
    assert.equal(calls[0].fetchPolicy, 'cache-first')
    assert.deepEqual(await estimateExport(client, 'settlement', request({})), { rows: 10, size: '2.9 KB' })

    assert.deepEqual(await estimateExport(client, 'ggr', request({})), { rows: 18, size: '7.0 KB' })
    assert.deepEqual(await estimateExport(client, 'pnl', request({ domain: 'casino' })), { rows: 6, size: '2.3 KB' })
    assert.deepEqual(await estimateExport(client, 'exposure', request({ domain: 'all' })), { rows: 18, size: '7.0 KB' })
    assert.deepEqual(await estimateExport(client, 'sports-kpis', request({})), { rows: 6, size: '2.9 KB' })
    assert.deepEqual(await estimateExport(client, 'matka-kpis', request({}, { dateRange: undefined })), { rows: 0, size: '0 B' })

    assert.deepEqual(await estimateExport(client, 'agent-performance', request({})), { rows: 40, size: '23.4 KB' })
    assert.equal(calls.at(-1)?.query, AGENTS_FOR_PERFORMANCE_QUERY)
    assert.equal(calls.at(-1)?.fetchPolicy, 'cache-first')
    assert.equal(calls.length, 3, 'the aggregate and KPI estimates send no query')
  })

  test('bonus campaigns and audit logs', async () => {
    pinIst()
    const sample = Array.from({ length: 100 }, (_, index) => ({ id: String(index) }))
    const { client, calls } = fakeClient(new Map<DocumentNode, unknown>([
      [BONUS_CAMPAIGNS_COUNT_QUERY, { bonusCampaigns: [{ id: '1' }, { id: '2' }] }],
      [AUDIT_LOGS_COUNT_QUERY, { audit: sample }],
    ]))
    assert.deepEqual(
      await estimateExport(client, 'bonus-campaigns', request({ status: 'Active', domain: 'Casino' })),
      { rows: 2, size: '800 B' },
    )
    assert.deepEqual(calls[0].variables, { status: 'active', domain: 'casino' })
    assert.equal(calls[0].fetchPolicy, 'network-only')

    // A full sample of 100 means about 50 a day; a domain keeps 30%, an action 20% of that.
    assert.deepEqual(await estimateExport(client, 'audit-logs', request({})), { rows: 300, size: '58.6 KB' })
    assert.deepEqual(calls[1].variables, {
      domain: undefined, action: undefined, from: WEEK?.from, to: WEEK?.to, limit: 100,
    })
    assert.deepEqual(await estimateExport(client, 'audit-logs', request({ domain: 'players', action: 'login' })), {
      rows: 18,
      size: '3.5 KB',
    })

    const few = fakeClient(new Map([[AUDIT_LOGS_COUNT_QUERY, { audit: [{ id: '1' }, { id: '2' }] }]]))
    assert.deepEqual(await estimateExport(few.client, 'audit-logs', request({})), { rows: 2, size: '400 B' })
  })

  test('deposit and withdrawal requests', async () => {
    const { client, calls } = fakeClient(new Map<DocumentNode, unknown>([
      [DEPOSIT_REQUESTS_COUNT_QUERY, { adminDepositRequests: { total: 7 } }],
      [WITHDRAWAL_REQUESTS_COUNT_QUERY, { adminWithdrawalRequests: { total: 4 } }],
    ]))
    assert.deepEqual(await estimateExport(client, 'deposits', request({ status: 'pending' })), { rows: 7, size: '2.1 KB' })
    assert.deepEqual(calls[0].variables, {
      input: { status: 'PENDING', fromDate: WEEK?.from, toDate: WEEK?.to, offset: 0, limit: 1 },
    })
    assert.deepEqual(await estimateExport(client, 'withdrawals', request({})), { rows: 4, size: '1.2 KB' })
    assert.equal(calls[1].query, WITHDRAWAL_REQUESTS_COUNT_QUERY)
    assert.deepEqual(calls[1].variables, {
      input: { status: undefined, fromDate: WEEK?.from, toDate: WEEK?.to, offset: 0, limit: 1 },
    })
  })

  test('a failed query or an unknown type estimates nothing, and never rejects', async () => {
    const failing = fakeClient(new Map([[PLAYERS_COUNT_QUERY, new Error('down')]]))
    assert.deepEqual(await estimateExport(failing.client, 'players', request({})), { rows: 0, size: '0 B' })
    const none = fakeClient(new Map())
    assert.deepEqual(await estimateExport(none.client, 'mystery-report', request({})), { rows: 0, size: '0 B' })
    assert.equal(none.calls.length, 0)
  })
})
