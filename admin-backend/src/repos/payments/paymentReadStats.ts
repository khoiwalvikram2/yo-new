import { db } from '@src/db/client.js'
import { depositRequests, withdrawalRequests, userPayoutAccounts } from '@shared/db/schema.js'
import { eq, sql } from 'drizzle-orm'

const percent = (part: number, total: number) => total > 0 ? Math.round(part / total * 100) : 0

/** Cards intentionally cover all statuses/dates for the effective tenant,
 * independently of the table's filters. Never hydrate proof URLs or people. */
export async function readDepositRequestStats(tenant: string) {
  const [row] = await db.select({
    totalRequests: sql<number>`count(*)::int`,
    pending: sql<number>`count(*) filter (where ${depositRequests.status} = 'PENDING')::int`,
    approved: sql<number>`count(*) filter (where ${depositRequests.status} = 'APPROVED')::int`,
    rejected: sql<number>`count(*) filter (where ${depositRequests.status} = 'REJECTED')::int`,
    totalAmount: sql<string>`coalesce(sum(${depositRequests.amount}) filter (where ${depositRequests.status} = 'APPROVED'), 0)`,
  }).from(depositRequests).where(eq(depositRequests.tenant, tenant))
  const stats = { totalRequests: Number(row?.totalRequests ?? 0), pending: Number(row?.pending ?? 0), approved: Number(row?.approved ?? 0), rejected: Number(row?.rejected ?? 0), totalAmount: Number(row?.totalAmount ?? 0) }
  return { ...stats, approvalRate: percent(stats.approved, stats.totalRequests), rejectionRate: percent(stats.rejected, stats.totalRequests) }
}

export async function readWithdrawalRequestStats(tenant: string) {
  const [row] = await db.select({
    totalRequests: sql<number>`count(*)::int`,
    pending: sql<number>`count(*) filter (where ${withdrawalRequests.status} = 'PENDING')::int`,
    processing: sql<number>`count(*) filter (where ${withdrawalRequests.status} = 'PROCESSING')::int`,
    completed: sql<number>`count(*) filter (where ${withdrawalRequests.status} = 'COMPLETED')::int`,
    failed: sql<number>`count(*) filter (where ${withdrawalRequests.status} = 'FAILED')::int`,
    totalAmount: sql<string>`coalesce(sum(${withdrawalRequests.amount}) filter (where ${withdrawalRequests.status} = 'COMPLETED'), 0)`,
  }).from(withdrawalRequests).where(eq(withdrawalRequests.tenant, tenant))
  const stats = { totalRequests: Number(row?.totalRequests ?? 0), pending: Number(row?.pending ?? 0), processing: Number(row?.processing ?? 0), completed: Number(row?.completed ?? 0), failed: Number(row?.failed ?? 0), totalAmount: Number(row?.totalAmount ?? 0) }
  return { ...stats, completionRate: percent(stats.completed, stats.totalRequests), failureRate: percent(stats.failed, stats.totalRequests) }
}

export async function readPayoutAccountStats(tenant: string) {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    pending: sql<number>`count(*) filter (where coalesce(${userPayoutAccounts.approvalStatus}, 'PENDING') = 'PENDING')::int`,
    approved: sql<number>`count(*) filter (where ${userPayoutAccounts.approvalStatus} = 'APPROVED')::int`,
    rejected: sql<number>`count(*) filter (where ${userPayoutAccounts.approvalStatus} = 'REJECTED')::int`,
  }).from(userPayoutAccounts).where(eq(userPayoutAccounts.tenant, tenant))
  const stats = { total: Number(row?.total ?? 0), pending: Number(row?.pending ?? 0), approved: Number(row?.approved ?? 0), rejected: Number(row?.rejected ?? 0) }
  return { ...stats, approvalRate: percent(stats.approved, stats.total), rejectionRate: percent(stats.rejected, stats.total) }
}
