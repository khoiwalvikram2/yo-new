/**
 * The Export Center's agent sheet says "Tally Enabled: Yes" only when tally applies (AGE-09), on agents made for
 * the test: exportAgentsTally.integration.test.ts reads whatever agents exist and skips its "No" case once no live
 * agent has the flag without a domain (the 2026-11 data step turned those off).
 *
 * The sheet reads tally_domains with the flag (fetchAgentsData's select) and says Yes only for a flag with a
 * tally domain (agentMutationRules.tallyIsOn), as the agent screens and the commission run do.
 *
 * Against the isolated Matka QA database, inside a transaction that is rolled back.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/exportAgentsTallyFixture.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { ExportJobProcessor } = await import('../services/ExportJobProcessor.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

test('Tally Enabled is Yes only for a flag with a tally domain', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    const cases: Array<[label: string, enabled: boolean, domains: string[], sheet: [string, string]]> = [
      ['flag on, no domain', true, [], ['No', '']],
      ['flag on, sports', true, ['sports'], ['Yes', 'sports']],
      ['flag on, casino and matka', true, ['casino', 'matka'], ['Yes', 'casino, matka']],
      ['flag off, sports', false, ['sports'], ['No', 'sports']],
    ]
    const processor = new ExportJobProcessor() as any
    for (const [label, tallyEnabled, tallyDomains, [enabled, domains]] of cases) {
      const agent = await f.agent('COMMISSION')
      await tx.update(t.agents).set({ tallyEnabled, tallyDomains }).where(eq(t.agents.id, agent.id))
      // The whitelabel admin's AGENTS export (no agent context), narrowed to this agent by its id.
      const sheet: any[] = await processor.fetchAgentsData({ query: agent.id }, { tenant: f.tenant, whitelabelId: f.tenant })
      const row = sheet.find((r) => r.id === agent.id)
      assert.ok(row, `${label}: the agent is on its whitelabel sheet`)
      assert.deepEqual([row.tallyEnabled, row.tallyDomains], [enabled, domains], label)
    }
  })
})
