import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  resolveTenantForMutation,
  resolveWhitelabelForMutation,
  snapshotHealthMutationResolvers,
} from '../resolvers/snapshotHealthMutations.js'

const resolvers = snapshotHealthMutationResolvers as Record<string, (root: unknown, args: unknown, ctx: unknown) => Promise<unknown>>
const TRIGGERS = Object.keys(resolvers)
/** Arguments every trigger accepts; the tenant and whitelabel named are another brand's. */
const ARGS = { tenant: 'kondareddi-com', whitelabelId: 'kondareddi-com', reportingDay: '2025-06-01', dateFrom: '2025-06-01', dateTo: '2025-06-02', currency: 'INR' }
const wlAdmin = (permissions: Array<{ domain: string; actions: string[] }>) => ({
  user: { sub: '2', roles: ['Whitelabel Admin'] },
  permissions,
  tenant: 'grandwinn-com',
  whitelabel: { id: 'grandwinn-com' },
})
const superAdmin = (directorMode: string, extra: Record<string, unknown> = {}) => ({
  user: { sub: '1', roles: ['Super Admin'] },
  permissions: [{ domain: 'all', actions: ['*'] }],
  tenant: 'default',
  whitelabel: { id: 'default' },
  directorMode,
  ...extra,
})

describe('snapshotHealthMutationResolvers', () => {
  it('enqueueSnapshotForReportingDay rejects without trigger permission', async () => {
    await assert.rejects(
      () =>
        snapshotHealthMutationResolvers.enqueueSnapshotForReportingDay(
          null,
          { reportingDay: '2025-06-01', currency: 'INR' },
          {
            user: { sub: '1', roles: ['Admin'] },
            permissions: [{ domain: 'reporting.snapshot-health', actions: ['view'] }],
            tenant: 't1',
            whitelabel: { id: 'w1' },
          },
        ),
      /Forbidden: reporting.snapshot-health trigger required/,
    )
  })

  it('enqueueSnapshotBackfillRange rejects without auth', async () => {
    await assert.rejects(
      () =>
        snapshotHealthMutationResolvers.enqueueSnapshotBackfillRange(
          null,
          {
            dateFrom: '2025-06-01',
            dateTo: '2025-06-02',
            currency: 'INR',
          },
          { permissions: [{ domain: 'reporting.snapshot-health', actions: ['trigger'] }] },
        ),
      /Unauthorized/,
    )
  })
})

describe('snapshot health triggers are Super Admin only, like its reads (L4-R3)', () => {
  it('are the three the page uses', () => {
    assert.deepEqual([...TRIGGERS].sort(), ['enqueueSnapshotBackfillRange', 'enqueueSnapshotForReportingDay', 'regenerateStaleSnapshot'])
  })

  it('refuse a Whitelabel Admin holding the trigger through reporting:write or by name, before any read or write', async () => {
    for (const permissions of [
      [{ domain: 'reporting', actions: ['read', 'write'] }],
      [{ domain: 'reporting.snapshot-health', actions: ['view', 'trigger'] }],
    ]) {
      for (const name of TRIGGERS) {
        await assert.rejects(resolvers[name](null, ARGS, wlAdmin(permissions)), /Forbidden: snapshot health is only available to Super Admin/, name)
      }
    }
  })

  it('still name the missing trigger permission first', async () => {
    for (const name of TRIGGERS) {
      await assert.rejects(resolvers[name](null, ARGS, wlAdmin([{ domain: 'reporting', actions: ['read'] }])), /reporting\.snapshot-health trigger required/, name)
    }
  })

  it('let the Super Admin past the new check (the core-mode rule after it applies as before)', async () => {
    for (const name of TRIGGERS) {
      await assert.rejects(resolvers[name](null, ARGS, superAdmin('whitelabel', { directorWhitelabelId: 'grandwinn-com' })), /only available in core mode/, name)
    }
  })

  it('still let the Super Admin in core mode trigger: it reaches the date checks, which come before any write or job', async () => {
    const future = '2999-01-01'
    await assert.rejects(
      resolvers.enqueueSnapshotForReportingDay(null, { reportingDay: future, currency: 'INR' }, superAdmin('core')),
      /Cannot generate snapshot for 2999-01-01 — the day is not yet complete/,
    )
    await assert.rejects(
      resolvers.enqueueSnapshotBackfillRange(null, { dateFrom: future, dateTo: future, currency: 'INR' }, superAdmin('core')),
      /dateTo must be on or after dateFrom/,
    )
  })
})

describe('the tenant a trigger runs for', () => {
  it('is the one a Super Admin in core mode names, or the director whitelabel', () => {
    assert.equal(resolveTenantForMutation(superAdmin('core'), 'kondareddi-com'), 'kondareddi-com')
    assert.equal(resolveWhitelabelForMutation(superAdmin('core'), 'kondareddi-com'), 'kondareddi-com')
    assert.equal(resolveTenantForMutation(superAdmin('core'), null), 'default')
    const director = superAdmin('whitelabel', { directorWhitelabelId: 'grandwinn-com' })
    assert.equal(resolveTenantForMutation(director, 'kondareddi-com'), 'grandwinn-com')
    assert.equal(resolveWhitelabelForMutation(director, 'kondareddi-com'), 'grandwinn-com')
  })

  it("is the caller's own for anyone else, whatever the arguments name", () => {
    // all:* under a role not named Super Admin passes requireSnapshotHealthTrigger but is no platform caller.
    const wlAllStar = wlAdmin([{ domain: 'all', actions: ['*'] }])
    assert.equal(resolveTenantForMutation(wlAllStar, 'kondareddi-com'), 'grandwinn-com')
    assert.equal(resolveWhitelabelForMutation(wlAllStar, 'kondareddi-com'), 'grandwinn-com')
    assert.equal(resolveTenantForMutation(wlAllStar, null), 'grandwinn-com')
  })
})
