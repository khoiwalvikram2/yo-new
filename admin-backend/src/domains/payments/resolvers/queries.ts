import { hasPermission } from '@/domains/common/auth.js'
import { listWithdrawalRequests, getPayoutAccount, getUserBasic, getWithdrawalHistory, getWithdrawalRequestById } from '@/repos/payments/withdrawalRequestsRepo.js'
import { listPayoutAccounts as listPayoutAccountsAdmin } from '@/repos/payments/payoutAccountsRepo.js'
import { listAuditDb } from '@/repos/audit/auditRepo.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { pgSettingsQueryResolvers } from './pgSettings.js'

/** List / history / payout accounts: any withdrawal-scoped action is enough (approve-only roles can work the queue). */
function canAccessWithdrawalAdminData(perms: { domain: string; actions: string[] }[] | undefined): boolean {
  const p = perms ?? []
  return (
    hasPermission(p, 'payments.withdrawals', 'view') ||
    hasPermission(p, 'payments.withdrawals', 'approve') ||
    hasPermission(p, 'payments.withdrawals', 'reject')
  )
}

import { readWithdrawalRequestStats, readPayoutAccountStats } from '@src/repos/payments/paymentReadStats.js'
import { getUsersByIdsForExclusion } from '@src/repos/users/usersRepo.js'
import { getPayoutAccountsByIds } from '@src/repos/payments/withdrawalRequestsRepo.js'

async function requireWithdrawalRequestsRead(ctx: any) {
    // Block commission agents from accessing payment requests
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'COMMISSION') {
        throw new Error('Commission agents cannot access payment requests')
      }
    }
    
    if (!canAccessWithdrawalAdminData(ctx?.permissions)) {
      throw new Error('Forbidden: insufficient permissions for withdrawal requests')
    }
 }

export const paymentsQueryResolvers = {
  adminWithdrawalRequestStats: async (_: any, __: any, ctx: any) => {
    if (!ctx?.user) throw new Error('Unauthorized: authentication required')
    await requireWithdrawalRequestsRead(ctx)
    const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    return readWithdrawalRequestStats(tenant)
  },
  adminPayoutAccountStats: async (_: any, __: any, ctx: any) => {
    if (!ctx?.user) throw new Error('Unauthorized: authentication required')
    if (!canAccessWithdrawalAdminData(ctx?.permissions)) throw new Error('Forbidden: insufficient permissions for payout accounts')
    const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    return readPayoutAccountStats(tenant)
  },
  ...pgSettingsQueryResolvers,
  adminWithdrawalRequests: async (_: any, args: any, ctx: any) => {
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    await requireWithdrawalRequestsRead(ctx)
    const input = args.input || {}
    const tz = await getWhitelabelTimezone(tenant)
    const filter = {
      status: input.status,
      userId: input.userId ? Number(input.userId) : undefined,
      accountId: input.accountId ? Number(input.accountId) : undefined,
      fromDate: input.fromDate ? parseDateFrom(input.fromDate, tz) : undefined,
      toDate: input.toDate ? parseDateTo(input.toDate, tz) : undefined,
    }
    const { items, total } = await listWithdrawalRequests(filter, tenant, {
      offset: input.offset ?? 0,
      limit: input.limit ?? 100,
    })

    const [people, accounts] = await Promise.all([
      getUsersByIdsForExclusion([...new Set(items.map(item => item.userId))], tenant).catch(() => []),
      getPayoutAccountsByIds([...new Set(items.flatMap(item => item.payoutAccountId ? [item.payoutAccountId] : []))], tenant),
    ])
    const peopleById = new Map(people.map(person => [person.id, person]))
    const accountsById = new Map(accounts.map(account => [account.id, account]))
    const enriched = await Promise.all(
      items.map(async (item) => {
        const account = item.payoutAccountId ? (accountsById.get(item.payoutAccountId) ?? null) : null
        const user = peopleById.get(item.userId) ?? null
        return {
          id: String(item.id),
          userId: String(item.userId),
          amount: Number(item.amount ?? 0),
          currency: item.currency,
          status: item.status,
          reviewerId: item.reviewerId ? String(item.reviewerId) : null,
          reviewedAt: item.reviewedAt ? item.reviewedAt.toISOString() : null,
          note: item.note,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          account: account
            ? {
                id: String(account.id),
                method: account.method,
                accountNumber: account.accountNumber,
                ifscCode: account.ifscCode,
                bankName: account.bankName,
                accountHolderName: account.accountHolderName,
              }
            : null,
          user: user
            ? {
                id: String(user.id),
                name: user.name,
                phone: user.phone,
                email: user.email,
              }
            : null,
        }
      })
    )

    return { items: enriched, total }
  },

  adminPayoutAccounts: async (_: any, args: any, ctx: any) => {
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    if (!canAccessWithdrawalAdminData(ctx?.permissions)) {
      throw new Error('Forbidden: insufficient permissions for payout accounts')
    }
    const input = args.input || {}
    const filter = {
      status: input.status as 'PENDING' | 'APPROVED' | 'REJECTED' | undefined,
      userId: input.userId ? Number(input.userId) : undefined,
      method: input.method as string | undefined,
      query: input.query as string | undefined,
      fromDate: input.fromDate as string | undefined,
      toDate: input.toDate as string | undefined,
    }
    const { items, total } = await listPayoutAccountsAdmin(filter, tenant, {
      offset: input.offset ?? 0,
      limit: input.limit ?? 100,
    })
    return {
      items: items.map((row) => ({
        id: String(row.id),
        userId: String(row.userId),
        method: row.method,
        accountNumber: row.accountNumber,
        ifscCode: row.ifscCode,
        bankName: row.bankName,
        accountHolderName: row.accountHolderName,
        approvalStatus: row.approvalStatus,
        rejectionReason: row.rejectionReason,
        approvedBy: row.approvedBy ? String(row.approvedBy) : null,
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        user: {
          id: String(row.userId),
          name: row.userName,
          phone: row.userPhone,
          email: row.userEmail,
        },
      })),
      total,
    }
  },

  adminWithdrawalHistory: async (_: any, args: any, ctx: any) => {
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    // Block commission agents from accessing payment requests
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'COMMISSION') {
        throw new Error('Commission agents cannot access payment requests')
      }
    }
    
    if (!canAccessWithdrawalAdminData(ctx?.permissions)) {
      throw new Error('Forbidden: insufficient permissions for withdrawal requests')
    }
    
    const withdrawalId = Number(args.id)
    
    // Fetch audit log entries for this withdrawal
    const auditEntries = await listAuditDb({
      domain: 'payments',
      action: 'withdrawal_status_update',
      tenant,
      limit: 100,
    })

    const filteredAudits = auditEntries.items.filter((e: any) => e.resourceType === 'withdrawal_request' && e.resourceId === String(withdrawalId))
    
    // Get initial state from first audit entry's "before" status, or from base entry if no audits
    const base = await getWithdrawalRequestById(withdrawalId, tenant)
    let initialEntry: Array<{ status: string; reviewerId: string | null; reviewedAt: string | null; note: string | null }> = []
    
    if (filteredAudits.length > 0) {
      // Use first audit entry's "before" status as initial state
      const firstAudit = filteredAudits[0]
      const beforeStatus = firstAudit.before as any
      if (beforeStatus?.status) {
        initialEntry = [{
          status: String(beforeStatus.status || '').toUpperCase(),
          reviewerId: beforeStatus.reviewerId ? String(beforeStatus.reviewerId) : null,
          reviewedAt: beforeStatus.reviewedAt || (base?.createdAt ? base.createdAt.toISOString() : null),
          note: beforeStatus.note ?? null,
        }]
      } else if (base) {
        // Fallback to base entry if before status not available
        initialEntry = [{
          status: String(base.status || '').toUpperCase(),
          reviewerId: base.reviewerId ? String(base.reviewerId) : null,
          reviewedAt: base.createdAt ? base.createdAt.toISOString() : null,
          note: base.note ?? null,
        }]
      }
    } else if (base) {
      // No audit entries, use base entry
      initialEntry = [{
        status: String(base.status || '').toUpperCase(),
        reviewerId: base.reviewerId ? String(base.reviewerId) : null,
        reviewedAt: base.createdAt ? base.createdAt.toISOString() : null,
        note: base.note ?? null,
      }]
    }

    const filtered = filteredAudits.map((e: any) => ({
      status: String(e.after?.status || '').toUpperCase(),
      reviewerId: e.after?.reviewerId ?? e.actorId ?? null,
      reviewedAt: e.after?.reviewedAt || e.timestamp || null,
      note: e.after?.note ?? null,
      actorId: e.actorId,
    }))

    // Collect all unique reviewer/actor IDs to look up
    const allReviewerIds = new Set<string>()
    filtered.forEach((f) => {
      if (f.reviewerId) allReviewerIds.add(String(f.reviewerId))
      if (f.actorId) allReviewerIds.add(String(f.actorId))
    })
    initialEntry.forEach((b) => {
      if (b.reviewerId) allReviewerIds.add(String(b.reviewerId))
    })

    // Look up all reviewer names in parallel
    const reviewerMap = new Map<string, string>()
    await Promise.all(
      Array.from(allReviewerIds).map(async (idStr) => {
        try {
          const u = await getUserBasic(Number(idStr), tenant)
          if (u) {
            const name = u.name || u.username || u.email || u.phone || idStr
            reviewerMap.set(idStr, name)
          }
        } catch {
          // ignore lookup errors
        }
      })
    )

    // Enrich filtered entries with reviewer names
    const filteredEnriched = filtered.map((f) => {
      const reviewerIdStr = f.reviewerId ? String(f.reviewerId) : null
      const reviewerName = reviewerIdStr && reviewerMap.has(reviewerIdStr)
        ? reviewerMap.get(reviewerIdStr)!
        : (reviewerIdStr || null)
      return {
        status: f.status,
        reviewerId: reviewerName,
        reviewedAt: f.reviewedAt,
        note: f.note,
      }
    })

    // Enrich initial entry with reviewer name
    const initialEnriched = initialEntry.map((b) => {
      const reviewerIdStr = b.reviewerId ? String(b.reviewerId) : null
      const reviewerName = reviewerIdStr && reviewerMap.has(reviewerIdStr)
        ? reviewerMap.get(reviewerIdStr)!
        : (reviewerIdStr || null)
      return {
        status: b.status,
        reviewerId: reviewerName,
        reviewedAt: b.reviewedAt,
        note: b.note,
      }
    })

    // Combine and de-duplicate
    const combined = [...initialEnriched, ...filteredEnriched]

    // Fallback to single-row history from withdrawals table if audits missing
    if (combined.length === 0) {
      const history = await getWithdrawalHistory(withdrawalId, tenant)
      return history.map((h) => {
        const reviewerIdStr = h.reviewerId ? String(h.reviewerId) : null
        const reviewerName = reviewerIdStr && reviewerMap.has(reviewerIdStr)
          ? reviewerMap.get(reviewerIdStr)!
          : (reviewerIdStr || null)
        return {
          status: h.status,
          reviewerId: reviewerName,
          reviewedAt: h.reviewedAt ? h.reviewedAt.toISOString() : null,
          note: h.note,
        }
      })
    }

    // Normalize entries: trim notes, normalize timestamps
    const normalized = combined.map((entry) => ({
      ...entry,
      note: (entry.note || '').trim(),
      reviewedAt: entry.reviewedAt || '',
      timestamp: entry.reviewedAt ? new Date(entry.reviewedAt).getTime() : 0,
    }))

    // Sort by date (oldest first for chronological order)
    const sorted = normalized.sort((a, b) => a.timestamp - b.timestamp)

    // Group entries by status+note+timestamp (rounded to nearest second to handle millisecond differences)
    const grouped = new Map<string, typeof sorted>()
    for (const entry of sorted) {
      // Round timestamp to nearest second for grouping
      const roundedTime = Math.floor(entry.timestamp / 1000) * 1000
      const roundedTimeStr = roundedTime ? new Date(roundedTime).toISOString() : entry.reviewedAt
      const key = `${entry.status}|${entry.note}|${roundedTimeStr}`
      
      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key)!.push(entry)
    }

    // For each group, keep only the entry with the most complete information
    // Prefer entry with reviewer over one without, and most recent if all have reviewers
    const dedupedByKey: typeof sorted = []
    for (const [key, entries] of grouped.entries()) {
      if (entries.length === 1) {
        dedupedByKey.push(entries[0])
      } else {
        // Multiple entries with same status+note+timestamp
        // Prefer entry with reviewer, then most recent
        const withReviewer = entries.filter((e) => e.reviewerId && e.reviewerId !== '—' && e.reviewerId !== '-')
        if (withReviewer.length > 0) {
          // Sort by timestamp descending and take the first (most recent with reviewer)
          const sortedWithReviewer = withReviewer.sort((a, b) => b.timestamp - a.timestamp)
          dedupedByKey.push(sortedWithReviewer[0])
        } else {
          // No reviewer in any entry, take the most recent
          const sortedAll = entries.sort((a, b) => b.timestamp - a.timestamp)
          dedupedByKey.push(sortedAll[0])
        }
      }
    }

    // Re-sort after deduplication
    const reSorted = dedupedByKey.sort((a, b) => a.timestamp - b.timestamp)

    // Final de-duplicate: only keep entries where status changed from previous entry
    // This ensures we don't show duplicate statuses (e.g., two PROCESSING entries)
    const statusChanges: typeof reSorted = []
    let lastStatus: string | null = null
    
    for (const entry of reSorted) {
      // Always include the first entry
      if (statusChanges.length === 0) {
        statusChanges.push(entry)
        lastStatus = entry.status
        continue
      }
      
      // Only add if status changed from previous entry
      if (entry.status !== lastStatus) {
        statusChanges.push(entry)
        lastStatus = entry.status
      } else {
        // If same status, replace the previous entry with this one (to get the latest note/timestamp)
        statusChanges[statusChanges.length - 1] = entry
      }
    }

    // Remove the temporary timestamp field before returning
    return statusChanges.map(({ timestamp, ...entry }) => entry)
  },
}


