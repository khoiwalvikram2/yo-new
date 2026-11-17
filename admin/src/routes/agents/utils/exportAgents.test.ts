import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { DocumentNode } from 'graphql'
import { AGENTS_PAGE_QUERY, AGENTS_STATS_QUERY } from '@/lib/graphql/agents'
import { AGENTS_CHIPS_QUERY } from '../components/agentChips'
import { AGENT_EXPORT_PAGE_SIZE, agentsExportTitle, loadAgentsForExport } from './exportAgents'

/** A fake Apollo client over `count` agents, answering each read with the page it asks for. */
function fakeClient(count: number) {
  const reads: Array<{ query: DocumentNode; variables: Record<string, unknown> }> = []
  const all = Array.from({ length: count }, (_, index) => ({ id: `a${index}`, username: `agent${index}`, schemeType: 'CREDIT', status: 'ACTIVE' }))
  const client = {
    async query({ query, variables }: { query: DocumentNode; variables: Record<string, unknown> }) {
      reads.push({ query, variables })
      const page = all.slice(Number(variables.offset), Number(variables.offset) + Number(variables.limit))
      if (query === AGENTS_STATS_QUERY) return { data: { agents: { agentsPage: { itemsWithStats: page.map((agent) => ({ agent: { id: agent.id }, stats: { activePlayers: 1, totalDeposits: 10 } })) } } } }
      if (query === AGENTS_CHIPS_QUERY) return { data: { agents: { agentsPage: { items: page.map((agent) => ({ id: agent.id, chips: { id: agent.id, balance: 5 } })) } } } }
      return { data: { agents: { agentsPage: { items: page, total: count } } } }
    },
  }
  return { client: client as never, reads }
}

test('loadAgentsForExport reads every agent of the filter page by page, each with its stats and chips', async () => {
  const { client, reads } = fakeClient(230)
  const rows = await loadAgentsForExport(client, { schemeType: 'CREDIT', directOnly: true }, { total: 230, withChips: true })
  assert.equal(rows.length, 230)
  assert.deepEqual(rows.slice(0, 2).map((row) => row.id), ['a0', 'a1'])
  assert.equal(rows[229].id, 'a229')
  assert.ok(rows.every((row) => row.stats?.totalDeposits === 10 && row.chips?.balance === 5), 'each row carries its stats and chips')
  const pages = reads.filter((read) => read.query === AGENTS_PAGE_QUERY).map((read) => read.variables)
  assert.deepEqual(pages, [0, 100, 200].map((offset) => ({ schemeType: 'CREDIT', directOnly: true, offset, limit: AGENT_EXPORT_PAGE_SIZE })))
})

test('loadAgentsForExport reads no chips outside the CREDIT list, and stops at a short page', async () => {
  const { client, reads } = fakeClient(30)
  const rows = await loadAgentsForExport(client, {}, { total: 500, withChips: false })
  assert.equal(rows.length, 30)
  assert.equal(reads.some((read) => read.query === AGENTS_CHIPS_QUERY), false)
  assert.equal(reads.filter((read) => read.query === AGENTS_PAGE_QUERY).length, 1, 'a page shorter than the page size is the last one')
})

test("the sheet's title states what it holds", () => {
  assert.equal(agentsExportTitle(64, 64), 'Agents Export — 64 agents')
  assert.equal(agentsExportTitle(10, 64), 'Agents Export — 10 of 64 agents')
  assert.equal(agentsExportTitle(65, 64), 'Agents Export — 65 agents', 'never "65 of 64"')
})
