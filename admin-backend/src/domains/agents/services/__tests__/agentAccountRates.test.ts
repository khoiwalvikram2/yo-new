import { after, afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { getTableName } from 'drizzle-orm'
import { db, pool } from '@src/db/client.js'
import { readAgentAccountRates } from '../agentAccountRates.js'
import { agentsResolvers } from '../../resolvers/index.js'
import { AgentConfigsRepo } from '@src/repos/agents/AgentConfigsRepo.js'

afterEach(() => mock.restoreAll())
after(async () => { await pool.end() })
const at = new Date('2026-10-24T10:00:00Z')
const current = new Date(at.getTime() - 1000), future = new Date(at.getTime()+2000)
function database(rows: any[], reject = false) {
  const queries: string[] = []
  mock.method(db, 'select', () => ({ from: (table: any) => ({ where: () => ({ orderBy: async () => {
    queries.push(getTableName(table))
    if (reject) throw new Error('Batch unavailable')
    return rows
  } }) }) }) as any)
  return queries
}
describe('request-local AgentAccount rates', () => {
  it('batches 100 agents while preserving domain order, percent conversion and duplicate requested domains', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ agentId: `a${i}`, domain: 'sports', commissionRate: '.02', effectiveFrom: current, effectiveTo: null }))
    const queries = database(rows)
    const ctx = {}
    const rates = await Promise.all(rows.map(row => readAgentAccountRates({ id: row.agentId, allowedDomains: ['casino', 'sports', 'sports'] }, 'commission', ctx, at)))
    assert.equal(queries.length, 1)
    for (const value of rates) assert.deepEqual(value, [{ domain: 'sports', rate: 2 }, { domain: 'sports', rate: 2 }])
    await readAgentAccountRates({ id: 'a0', allowedDomains: ['sports'] }, 'commission', ctx, at)
    assert.equal(queries.length, 1)
  })
  it('keeps expiry, future rows, latest matching history and the one-second buffer unchanged', async () => {
    database([
      { agentId: 'a', domain: 'sports', commissionRate: '.99', effectiveFrom: future, effectiveTo: null },
      { agentId: 'a', domain: 'sports', commissionRate: '.03', effectiveFrom: new Date(at.getTime()+1000), effectiveTo: at },
      { agentId: 'a', domain: 'sports', commissionRate: '.02', effectiveFrom: current, effectiveTo: null },
      { agentId: 'a', domain: 'casino', commissionRate: '.20', effectiveFrom: current, effectiveTo: new Date(at.getTime()-1) },
      { agentId: 'a', domain: 'matka', commissionRate: '.10', effectiveFrom: future, effectiveTo: null },
    ])
    assert.deepEqual(await readAgentAccountRates({ id: 'a', allowedDomains: ['sports','casino','matka'] }, 'commission', {}, at), [{ domain: 'sports', rate: 3 }])
  })
  it('does not mix commission/sharing or contexts and keeps each field effective instant independent', async () => {
    const queries = database([{ agentId: 'a', domain: 'sports', commissionRate: '.02', shareRate: '.4', effectiveFrom: current, effectiveTo: at }])
    const parent = { id: 'a', allowedDomains: ['sports'] }, ctx = {}
    assert.deepEqual(await readAgentAccountRates(parent, 'commission', ctx, at), [{ domain: 'sports', rate: 2 }])
    assert.deepEqual(await readAgentAccountRates(parent, 'sharing', ctx, at), [{ domain: 'sports', rate: 40 }])
    assert.deepEqual(await readAgentAccountRates(parent, 'commission', ctx, new Date(at.getTime()+1)), [])
    await readAgentAccountRates(parent, 'commission', {}, at)
    assert.equal(queries.length, 3)
  })
  it('retains the legacy per-domain fallback on failure and skips unrelated or empty-domain accounts', async () => {
    const queries = database([], true)
    const calls: string[] = []
    mock.method(AgentConfigsRepo.prototype, 'getCommissionConfig', async (_id, domain) => { calls.push(domain); return { commissionRate: '.02' } as any })
    const value = await agentsResolvers.AgentAccount.commissionRates({ id: 'a', schemeType: 'COMMISSION', allowedDomains: ['sports','casino'] }, {}, {})
    assert.deepEqual(value, [{ domain: 'sports', rate: 2 }, { domain: 'casino', rate: 2 }])
    assert.deepEqual(calls, ['sports','casino']); assert.equal(queries.length, 1)
    await agentsResolvers.AgentAccount.commissionRates({ id: 'a', schemeType: 'SHARING', allowedDomains: ['sports'] }, {}, {})
    await readAgentAccountRates({ id: 'a', allowedDomains: [] }, 'commission', {}, at)
    assert.equal(queries.length, 1)
  })
})
