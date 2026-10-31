import { guardMutationMap, type RequiredPermission } from '@src/domains/common/guardMutationMap.js'
import { reportingQueryResolvers, reportingQueryGroupResolvers } from '@src/domains/reporting/resolvers/queries.js'
import { reportingMutationResolvers } from '@src/domains/reporting/resolvers/mutations.js'
import { snapshotHealthQueryResolvers } from '@src/domains/reporting/resolvers/snapshotHealthQueries.js'
import { snapshotHealthMutationResolvers } from '@src/domains/reporting/resolvers/snapshotHealthMutations.js'
import { reportingSubscriptionResolvers } from '@src/domains/reporting/resolvers/subscriptions.js'
import { hasPermission, ensureAgentCanMutate } from '@src/domains/common/auth.js'

/**
 * The permission each reporting mutation demands.
 *
 * `canMutateReporting` accepted `reporting.pnl:view` — a *read* permission —
 * for every write in the domain, including deleting another user’s saved
 * report and triggering a snapshot rebuild.
 */
export const REPORTING_MUTATION_PERMISSIONS: Record<string, RequiredPermission> = {
  // A saved report is the caller's own stored view, and the `savedReports`
  // query that lists them is gated on `reporting.exports:view`. Requiring
  // `:create` here would have left five live roles — Operator, Viewer and
  // Manager across both whitelabels — looking at the saved-reports screen with
  // a Save button that refuses. Matching the screen's own permission keeps them
  // working and still refuses the roles that cannot open it at all.
  createSavedReport: [['reporting.exports', 'view']],
  updateSavedReport: [['reporting.exports', 'view']],
  deleteSavedReport: [['reporting.exports', 'view']],
  // This one genuinely runs an export.

  createExportJob: [['reporting.exports', 'create']],
  refreshReportingSnapshots: [['reporting.snapshot-health', 'trigger']],
}
function wrapReportingMutations(mutations: Record<string, (...args: any[]) => any>) {
  return guardMutationMap(mutations, REPORTING_MUTATION_PERMISSIONS, {
    label: 'reporting',
  })
}

/**
 * Snapshot rebuilds are expensive and rewrite the numbers every report reads.
 * The wrapper here checked that a caller was signed in and nothing else, while
 * the catalogue has carried `reporting.snapshot-health:trigger` all along.
 */
export const SNAPSHOT_HEALTH_PERMISSIONS: Record<string, RequiredPermission> = {
  enqueueSnapshotForReportingDay: [['reporting.snapshot-health', 'trigger']],
  enqueueSnapshotBackfillRange: [['reporting.snapshot-health', 'trigger']],
  regenerateStaleSnapshot: [['reporting.snapshot-health', 'trigger']],
}

function wrapSnapshotHealthMutations(mutations: Record<string, (...args: any[]) => any>) {
  return guardMutationMap(mutations, SNAPSHOT_HEALTH_PERMISSIONS, { label: 'snapshot health' })
}

export const reportingResolvers = {
  Query: {
    ...reportingQueryResolvers,
    ...snapshotHealthQueryResolvers,
    reporting: (_: any, __: any, ctx: any) => {
      if (!hasPermission(ctx?.permissions ?? [], 'reporting.pnl', 'view')) {
        throw new Error('Forbidden: insufficient permissions to access reporting')
      }
      return {};
    },
  },
  Mutation: {
    ...wrapReportingMutations(reportingMutationResolvers),
    ...wrapSnapshotHealthMutations(snapshotHealthMutationResolvers),
  },
  Subscription: reportingSubscriptionResolvers,
  ReportingQuery: reportingQueryGroupResolvers,
}
