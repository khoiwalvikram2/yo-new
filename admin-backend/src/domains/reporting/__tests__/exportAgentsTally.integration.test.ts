/**
 * The Export Center's agent sheet says "Tally Enabled: Yes" only when tally applies (AGE-09).
 *
 * The agent screens and the commission run treat tally_enabled without a tally domain as off
 * (agentMutationRules.tallyIsOn, CommissionService), but this sheet read the bare flag, so it said
 * Yes for every agent left with the flag and no domain.
 *
 * Against the real database, READ ONLY: the fixtures are whatever agents exist, and a case with no
 * such agent skips.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/exportAgentsTally.integration.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const rows = (result: any): any[] => (Array.isArray(result) ? result : result?.rows ?? [])

after(async () => {
  const { pool } = await import('@src/db/client.js')
  await pool.end().catch(() => {})
})

/** One agent with the tally flag on, with or without a tally domain. */
async function agentWithTally(withDomain: boolean): Promise<{ id: string; tenant: string } | null> {
  const { db } = await import('@src/db/client.js')
  const [row] = rows(await db.execute(sql`
    SELECT id::text AS id, tenant_id AS tenant FROM agents
    WHERE tally_enabled = true
      AND ${withDomain ? sql`COALESCE(cardinality(tally_domains), 0) > 0` : sql`COALESCE(cardinality(tally_domains), 0) = 0`}
    ORDER BY created_at LIMIT 1`))
  return row ?? null
}

async function sheetRow(agent: { id: string; tenant: string }) {
  const { ExportJobProcessor } = await import('@src/domains/reporting/services/ExportJobProcessor.js')
  // The whitelabel admin's AGENTS export (no agent context), narrowed to this agent by its id.
  const sheet: any[] = await (new ExportJobProcessor() as any).fetchAgentsData({ query: agent.id }, { tenant: agent.tenant, whitelabelId: agent.tenant })
  const row = sheet.find((r) => r.id === agent.id)
  assert.ok(row, 'the agent is on its whitelabel sheet')
  return row
}

describe('the agent sheet’s Tally Enabled column', () => {
  it('says No for an agent with the flag but no tally domain', async (t) => {
    const agent = await agentWithTally(false)
    if (!agent) return t.skip('no agent has the tally flag without a domain in this database')
    const row = await sheetRow(agent)
    assert.equal(row.tallyEnabled, 'No')
    assert.equal(row.tallyDomains, '')
  })

  it('still says Yes, with its domains, when tally applies', async (t) => {
    const agent = await agentWithTally(true)
    if (!agent) return t.skip('no agent has tally on with a domain in this database')
    const row = await sheetRow(agent)
    assert.equal(row.tallyEnabled, 'Yes')
    assert.notEqual(row.tallyDomains, '')
  })
})
