/**
 * Snapshot Health reads are Super Admin only, as the page's superAdminRoute is.
 *
 * Every whitelabel role reaches reporting.snapshot-health:view through the flat reporting:read
 * grant, so a Whitelabel Admin could call these reads directly, and some of them (pg-boss jobs and
 * schedules, the scheduler's events) cover the whole platform. Agents are refused centrally
 * (SCO-05, common/agentExcludedOperations.ts). Every refusal comes before any read: no database.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/snapshotHealthQueries.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { snapshotHealthQueryResolvers } from '../resolvers/snapshotHealthQueries.js'

const resolvers = snapshotHealthQueryResolvers as Record<string, (root: unknown, args: unknown, ctx: unknown) => Promise<unknown>>
const READS = Object.keys(resolvers)
const call = (name: string, ctx: unknown) => resolvers[name](null, {}, ctx)

const wlAdmin = (permissions: Array<{ domain: string; actions: string[] }>) => ({
  user: { sub: '2', roles: ['Whitelabel Admin'] },
  permissions,
  tenant: 'grandwinn-com',
  whitelabel: { id: 'grandwinn-com' },
})
const superAdmin = (directorMode: string) => ({
  user: { sub: '1', roles: ['Super Admin'] },
  permissions: [{ domain: 'all', actions: ['*'] }],
  tenant: 'default',
  directorMode,
})

describe('snapshot health reads', () => {
  it('are the eight the page uses', () => {
    assert.deepEqual([...READS].sort(), [
      'snapshotEvents', 'snapshotEventsConnection', 'snapshotHealthSummary', 'snapshotMissingDays',
      'snapshotPgBossOverview', 'snapshotRuns', 'snapshotRunsConnection', 'snapshotStaleDays',
    ])
  })

  it('refuse a Whitelabel Admin, who holds the view through reporting:read or by name', async () => {
    for (const permissions of [[{ domain: 'reporting', actions: ['read'] }], [{ domain: 'reporting.snapshot-health', actions: ['view'] }]]) {
      for (const name of READS) {
        await assert.rejects(call(name, wlAdmin(permissions)), /Forbidden: snapshot health is only available to Super Admin/, name)
      }
    }
  })

  it('still name the missing view permission first', async () => {
    for (const name of READS) {
      await assert.rejects(call(name, wlAdmin([{ domain: 'players', actions: ['read'] }])), /reporting\.snapshot-health view required/, name)
    }
  })

  it('let a Super Admin past the new check (the core-mode rule after it then applies as before)', async () => {
    for (const name of READS) {
      await assert.rejects(call(name, superAdmin('whitelabel')), /only available in core mode/, name)
    }
  })
})
