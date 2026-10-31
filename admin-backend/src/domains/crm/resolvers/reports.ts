import {
  crmCanViewAllPlayers,
  requireCrmPermission,
  requireCrmUser,
  type CrmContext,
} from '@src/domains/crm/guards.js'
import { getBookIdsForCrmUser } from '@src/repos/crm/CrmBooksRepo.js'
import { getDeskReport } from '@src/repos/crm/CrmReportsRepo.js'

/**
 * The desk report.
 *
 * Gated on its own permission, `crm.reports:view`, rather than on
 * `crm.tasks:view`: the queue shows a person their own work, a report shows
 * them everybody's — completions, breaches and call outcomes per colleague —
 * and a whitelabel should be able to grant the first without the second.
 *
 * Scoped like desk health. The per-agent rows aggregate only facts inside the
 * caller's books, so a book-bound supervisor reads their own desk's numbers,
 * not the whitelabel's.
 */

/**
 * The widest range one report may cover.
 *
 * A quarter is the longest period anyone reviews as one unit; past that the
 * by-day series stops being readable and the query cost is all that grows.
 */
const MAX_RANGE_DAYS = 92

export const crmReportQueries = {
  crmDeskReport: async (
    _: unknown,
    args: { from: string; to: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.reports', 'view')
    const user = requireCrmUser(ctx)

    const from = new Date(args.from)
    const to = new Date(args.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error('Give the period as two dates')
    }
    if (from.getTime() >= to.getTime()) {
      throw new Error('The period must start before it ends')
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new Error(`Reports cover at most ${MAX_RANGE_DAYS} days at a time`)
    }

    const viewAll = crmCanViewAllPlayers(ctx)
    const bookIds = viewAll ? [] : await getBookIdsForCrmUser(user.tenant, user.id)

    const report = await getDeskReport({ tenant: user.tenant, viewAll, bookIds }, from, to)
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      ...report,
    }
  },
}
