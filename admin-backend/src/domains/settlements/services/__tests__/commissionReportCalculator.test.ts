import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CommissionReportGGRReader, commissionReportAgents, type CommissionReportAgent } from '../commissionReportCalculator.js'

const from = new Date('2026-10-18T18:30:00Z')
const to = new Date('2026-10-25T18:30:00Z')
describe('request-local commission report reads', () => {
  it('profile calculations can preserve missing closure self rows exactly as the repository does', async () => {
    const row = { id: 'a', parentAgentId: null, tenantId: 't', schemeType: 'COMMISSION', tallyEnabled: false, tallyDomains: null } as CommissionReportAgent
    const reader = commissionReportAgents([row], [], { preserveExactClosure: true })
    assert.deepEqual(await reader.getDescendantIds('a'), [])
    const complete = commissionReportAgents([row], [{ ancestorId: 'a', descendantId: 'a' }], { preserveExactClosure: true })
    assert.deepEqual(await complete.getDescendantIds('a'), ['a'])
  })
  it('shares one exact-window read across concurrent agents without mixing their rows', async () => {
    const calls: string[][] = []
    const reader = new CommissionReportGGRReader('tenant-a', ['a', 'b'], async params => {
      calls.push(params.agentIds)
      return [{ cycleKey: '2026-10-19', agentId: 'a', sports: 10, casino: 0, matka: 0 },
        { cycleKey: '2026-10-19', agentId: 'b', sports: 20, casino: 0, matka: 0 }]
    })
    const [a, b] = await Promise.all(['a', 'b'].map(id => reader.getGGRByCycleAndAgent({ tenantId: 'tenant-a', agentIds: [id], from, to })))
    assert.deepEqual(calls, [['a', 'b']])
    assert.deepEqual(a.map(row => row.sports), [10])
    assert.deepEqual(b.map(row => row.sports), [20])
  })
  it('keeps partial ranges and carry lookback windows separate; a new report reads fresh data', async () => {
    let calls = 0
    const read = async () => { calls++; return [] }
    const reader = new CommissionReportGGRReader('t', ['a'], read)
    const args = { tenantId: 't', agentIds: ['a'], from, to }
    await reader.getGGRByCycleAndAgent(args)
    await reader.getGGRByCycleAndAgent({ ...args, from: new Date(from.getTime() + 1000) })
    await new CommissionReportGGRReader('t', ['a'], read).getGGRByCycleAndAgent(args)
    assert.equal(calls, 3)
  })
  it('refuses another tenant or agents outside the loaded report', async () => {
    const reader = new CommissionReportGGRReader('t', ['a'], async () => { throw new Error('must not read') })
    await assert.rejects(reader.getGGRByCycleAndAgent({ tenantId: 'other', agentIds: ['a'], from, to }), /scope/)
    await assert.rejects(reader.getGGRByCycleAndAgent({ tenantId: 't', agentIds: ['b'], from, to }), /scope/)
  })
  it('keeps closure membership and direct children within the loaded tenant', async () => {
    const agent = (id: string, parentAgentId: string | null): CommissionReportAgent => ({ id, parentAgentId, tenantId: 't', schemeType: 'COMMISSION', tallyEnabled: false, tallyDomains: null, createdAt: from, username: id })
    const reader = commissionReportAgents([agent('a', null), agent('b', 'a'), agent('c', 'b')], [
      { ancestorId: 'a', descendantId: 'b' }, { ancestorId: 'a', descendantId: 'c' },
      { ancestorId: 'a', descendantId: 'outside' },
    ])
    assert.deepEqual(await reader.getDescendantIds('a'), ['a', 'b', 'c'])
    assert.deepEqual((await reader.listChildren('a')).map(row => row.id), ['b'])
    assert.equal(await reader.findById('outside'), null)
  })
})
