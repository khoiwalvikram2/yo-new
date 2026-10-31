/**
 * Agent Performance: which agent's sub-agents are listed (W4).
 *
 * The resolver passed the client's `filter.parentAgentId` straight to the repo.
 * An agent naming another agent's id saw that agent's sub-agents and their
 * figures; an agent naming nothing fell into the whitelabel branch and saw
 * every root agent of the whitelabel. The hierarchy and tenant lookups are
 * injected, so no database is needed.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/agentReportScope.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAgentPerformanceParent, type AgentReportScopeDeps } from '@src/domains/reporting/resolvers/agentReportScope.js'

// Tree: A -> B -> C ; X is unrelated. Tenants: A,B,C,X in brand-a; Y in brand-b.
const descendants: Record<string, string[]> = { A: ['A', 'B', 'C'], B: ['B', 'C'], C: ['C'], X: ['X'] }
const tenants: Record<string, string> = { A: 'brand-a', B: 'brand-a', C: 'brand-a', X: 'brand-a', Y: 'brand-b' }
const deps: AgentReportScopeDeps = {
  isInSubtree: async (ancestor, descendant) => (descendants[ancestor] ?? []).includes(descendant),
  agentTenant: async (id) => tenants[id] ?? null,
}
const agent = (agentId: string) => ({ user: { type: 'agent', agentId }, permissions: [] })
const admin = (perms: Array<{ domain: string; actions: string[] }> = []) => ({ user: { sub: '7', roles: [] }, permissions: perms })

describe('an agent caller', () => {
  it('ignores a parentAgentId outside its subtree and gets its own sub-agents', async () => {
    assert.equal(await resolveAgentPerformanceParent(agent('B'), 'X', 'brand-a', deps), 'B')
    assert.equal(await resolveAgentPerformanceParent(agent('B'), 'A', 'brand-a', deps), 'B', 'its own parent is not in its subtree')
  })

  it('never falls into the whitelabel-wide branch when it names nothing', async () => {
    assert.equal(await resolveAgentPerformanceParent(agent('B'), undefined, 'brand-a', deps), 'B')
    assert.equal(await resolveAgentPerformanceParent(agent('B'), '', 'brand-a', deps), 'B')
  })

  it('may drill into a descendant', async () => {
    assert.equal(await resolveAgentPerformanceParent(agent('A'), 'C', 'brand-a', deps), 'C')
  })

  it('fails closed without an agent id', async () => {
    await assert.rejects(resolveAgentPerformanceParent({ user: { type: 'agent' } }, 'A', 'brand-a', deps), /Forbidden/)
  })
})

describe('an admin caller', () => {
  it('keeps the whitelabel view when it names nothing', async () => {
    assert.equal(await resolveAgentPerformanceParent(admin(), undefined, 'brand-a', deps), undefined)
  })

  it('may name an agent of its own tenant', async () => {
    assert.equal(await resolveAgentPerformanceParent(admin(), 'B', 'brand-a', deps), 'B')
  })

  it('cannot name another tenant’s agent', async () => {
    assert.equal(await resolveAgentPerformanceParent(admin(), 'Y', 'brand-a', deps), undefined)
  })

  it('a platform admin may name any agent', async () => {
    assert.equal(await resolveAgentPerformanceParent(admin([{ domain: 'all', actions: ['*'] }]), 'Y', 'brand-a', deps), 'Y')
  })
})

describe('the resolver uses it', () => {
  it('agentPerformance passes the resolved parent, not filter.parentAgentId', () => {
    const src = readFileSync(join(process.cwd(), 'src/domains/reporting/resolvers/queries.ts'), 'utf8')
    const start = src.indexOf('agentPerformance: async')
    const body = src.slice(start, src.indexOf('agentTrends: async', start))
    assert.match(body, /resolveAgentPerformanceParent\(ctx, filter\.parentAgentId/)
    assert.doesNotMatch(body, /parentAgentId: filter\.parentAgentId/, 'the raw client value must not reach the repo')
  })
})
