/**
 * createExportJob for agents (agent features spec §4, owner decision 4, 2026-10-22).
 * - Every scheme reaches it: the COMMISSION-agent block is gone.
 * - The whitelabel-level types are refused before a job row is written.
 * - An agent that cannot be loaded is refused rather than exported as an admin.
 *
 * Unit, no database. The agent id is not a uuid, so AgentsRepo.findById returns null without a
 * query, and the export is refused at that point: after the gate and the type rule, before the
 * INSERT. A tripwire replaces db.insert for the whole file, so a path that does reach the INSERT
 * (old code, or a regression) fails with "tripwire" instead of writing a job row.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/createExportJobAgents.test.ts
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@/db/client.js'
import { reportingResolvers } from '../resolvers/index.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'

// These tests must never write: any path that reaches the job INSERT throws here instead.
const realInsert = (db as any).insert
before(() => {
  (db as any).insert = () => {
    throw new Error('tripwire: createExportJob reached db.insert')
  }
})
after(() => {
  (db as any).insert = realInsert
})

function agentCtx(scheme: string, domains: string[], isReadOnly = false) {
  return {
    tenant: 'brand-a',
    whitelabel: { id: 'brand-a' },
    user: { type: 'agent', agentId: 'not-a-uuid', sub: 'not-a-uuid', roles: [], agentSchemeType: scheme, agentAllowedDomains: domains, isReadOnly },
    permissions: deriveAgentPermissions(domains as never, scheme),
  }
}

// async: the mutation guard refuses a read-only agent synchronously; this turns it into a rejection.
async function create(ctx: unknown, reportType: string): Promise<unknown> {
  return (reportingResolvers.Mutation as any).createExportJob(
    undefined,
    { input: { reportType, filtersJson: {}, exportFormat: 'CSV' } },
    ctx,
    undefined,
  )
}

describe('createExportJob for agents', () => {
  it('carries no COMMISSION-agent block in the export resolvers any more', () => {
    for (const file of ['mutations.ts', 'queries.ts']) {
      const src = readFileSync(join('src', 'domains', 'reporting', 'resolvers', file), 'utf8')
      assert.doesNotMatch(src, /Commission agents cannot access export center/, file)
    }
  })

  it('opens to every scheme: the agent passes the gate and the type rule, then must be a real agent', async () => {
    for (const [scheme, type] of [['COMMISSION', 'commission'], ['SHARING', 'settlement'], ['CREDIT', 'players']]) {
      await assert.rejects(create(agentCtx(scheme, []), type), /Forbidden: agent not found for this whitelabel/, `${scheme} ${type}`)
    }
  })

  it('refuses the whitelabel-level and unscoped types to agents before writing a job', async () => {
    for (const type of ['AUDIT_LOGS', 'BONUS_CAMPAIGNS', 'GGR', 'TRANSACTIONS', 'AGENTS']) {
      await assert.rejects(create(agentCtx('SHARING', ['sports', 'casino', 'matka']), type), /Forbidden: agents may not export/, type)
    }
  })

  it('refuses a read-only agent, as every agent mutation does', async () => {
    await assert.rejects(create(agentCtx('SHARING', [], true), 'players'), /inactive/)
  })
})
