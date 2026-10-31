import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { snapshotHealthMutationResolvers } from '../resolvers/snapshotHealthMutations.js'

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
