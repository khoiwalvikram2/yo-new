import type { AuditListFilter } from '@src/repos/audit/auditRepo.js'
import { getAuditStats as getAuditStatsFromRepo } from '@src/repos/audit/auditRepo.js'

export type { AuditStatsResult } from '@src/repos/audit/auditRepo.js'

/** Delegates to audit repo; service no longer uses db/schema directly. */
export async function getAuditStats(filters: AuditListFilter = {}) {
  return getAuditStatsFromRepo(filters)
}
