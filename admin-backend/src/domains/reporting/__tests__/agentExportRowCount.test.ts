/**
 * agentExportRowCount: the Export Center's estimate for an agent counts exactly the rows its export
 * would hold (agent features spec §4). Unit: the gate and the refusals run before any query, and
 * an admin gets null without one.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/agentExportRowCount.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reportingResolvers } from '../resolvers/index.js'

const count = (args: unknown, ctx: unknown) => (reportingResolvers.Query as any).agentExportRowCount(undefined, args, ctx)

describe('agentExportRowCount', () => {
  it('is in the schema, nullable, with a one-line comment the probes read past', () => {
    const schema = readFileSync(join('src', 'types', 'operations', 'queries.graphql'), 'utf8')
    // \r?: the checkout may have CRLF line endings (queries.graphql has had them since 2026-11-02)
    assert.match(schema, /\r?\n  agentExportRowCount\(reportType: String!, filtersJson: JSON\): Int\r?\n/)
  })

  it('needs reporting.exports:view', async () => {
    await assert.rejects(count({ reportType: 'players' }, { user: { sub: '1' }, permissions: [] }), /insufficient permissions for reporting\.exports:view/)
  })

  it('answers null to an admin', async () => {
    const admin = { tenant: 'brand-a', user: { sub: '1' }, permissions: [{ domain: 'reporting.exports', actions: ['view'] }] }
    assert.equal(await count({ reportType: 'players', filtersJson: {} }, admin), null)
  })

  it('refuses a type the agent may not export', async () => {
    const agent = {
      tenant: 'brand-a',
      user: { type: 'agent', agentId: 'agent-1', agentSchemeType: 'COMMISSION', agentAllowedDomains: [] },
      permissions: [{ domain: 'reporting', actions: ['read', 'view'] }],
    }
    await assert.rejects(count({ reportType: 'audit-logs', filtersJson: {} }, agent), /agents may not export AUDIT_LOGS/)
    await assert.rejects(count({ reportType: 'settlement', filtersJson: {} }, agent), /agents may not export SETTLEMENT/)
  })
})
