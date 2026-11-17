import { db } from '@/db/client.js'
import { and, desc, eq, gte, lte, ilike, isNull, or, sql } from 'drizzle-orm'
import { userPayoutAccounts, users } from '@shared/db/schema.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'

export type PayoutAccountFilter = {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
  userId?: number
  method?: string
  query?: string
  fromDate?: string
  toDate?: string
}

export type AdminPayoutAccountRow = {
  id: number
  userId: number
  method: string
  accountNumber: string
  ifscCode: string | null
  bankName: string | null
  accountHolderName: string
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  approvedBy: number | null
  approvedAt: Date | null
  createdAt: Date
  userName: string | null
  userPhone: string | null
  userEmail: string | null
}

export async function listPayoutAccounts(
  filter: PayoutAccountFilter,
  tenant: string,
  pagination: { offset: number; limit: number }
): Promise<{ items: AdminPayoutAccountRow[]; total: number }> {
  // An account the player deleted (deleted_at set, kept only so it counts toward auto-approval) is not reviewed.
  const conditions = [eq(userPayoutAccounts.tenant, tenant), isNull(userPayoutAccounts.deletedAt)]
  if (filter.status) conditions.push(eq(userPayoutAccounts.approvalStatus, filter.status))
  if (filter.userId) conditions.push(eq(userPayoutAccounts.userId, filter.userId))
  if (filter.method) conditions.push(eq(userPayoutAccounts.method, filter.method as 'BANK' | 'UPI'))
  if (filter.fromDate || filter.toDate) {
    const tz = await getWhitelabelTimezone(tenant)
    if (filter.fromDate) conditions.push(gte(userPayoutAccounts.createdAt, parseDateFrom(filter.fromDate, tz)))
    if (filter.toDate) conditions.push(lte(userPayoutAccounts.createdAt, parseDateTo(filter.toDate, tz)))
  }

  if (filter.query && filter.query.trim().length >= 2) {
    const q = `%${filter.query.trim()}%`
    conditions.push(
      or(
        ilike(users.name, q),
        ilike(users.phone, q),
        ilike(users.email, q),
        ilike(userPayoutAccounts.accountHolderName, q),
        ilike(userPayoutAccounts.accountNumber, q),
      )!
    )
  }

  const selectFields = {
    id: userPayoutAccounts.id,
    userId: userPayoutAccounts.userId,
    method: userPayoutAccounts.method,
    accountNumber: userPayoutAccounts.accountNumber,
    ifscCode: userPayoutAccounts.ifscCode,
    bankName: userPayoutAccounts.bankName,
    accountHolderName: userPayoutAccounts.accountHolderName,
    approvalStatus: userPayoutAccounts.approvalStatus,
    rejectionReason: userPayoutAccounts.rejectionReason,
    approvedBy: userPayoutAccounts.approvedBy,
    approvedAt: userPayoutAccounts.approvedAt,
    createdAt: userPayoutAccounts.createdAt,
    userName: users.name,
    userPhone: users.phone,
    userEmail: users.email,
  }

  const joinCondition = and(eq(users.id, userPayoutAccounts.userId), eq(users.tenant, userPayoutAccounts.tenant))
  const whereClause = and(...conditions)

  const items = await db
    .select(selectFields)
    .from(userPayoutAccounts)
    .leftJoin(users, joinCondition)
    .where(whereClause)
    .orderBy(desc(userPayoutAccounts.createdAt), desc(userPayoutAccounts.id))
    .offset(pagination.offset)
    .limit(pagination.limit)

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userPayoutAccounts)
    .leftJoin(users, joinCondition)
    .where(whereClause)

  const total = totalResult[0]?.count ?? 0

  return {
    items: items.map((row) => ({
      id: row.id,
      userId: row.userId,
      method: row.method,
      accountNumber: row.accountNumber,
      ifscCode: row.ifscCode,
      bankName: row.bankName,
      accountHolderName: row.accountHolderName,
      approvalStatus: (row.approvalStatus ?? 'PENDING') as 'PENDING' | 'APPROVED' | 'REJECTED',
      rejectionReason: row.rejectionReason,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      createdAt: row.createdAt,
      userName: row.userName,
      userPhone: row.userPhone,
      userEmail: row.userEmail,
    })),
    total,
  }
}

export async function getPayoutAccountById(id: number, tenant: string): Promise<AdminPayoutAccountRow | null> {
  const rows = await db
    .select({
      id: userPayoutAccounts.id,
      userId: userPayoutAccounts.userId,
      method: userPayoutAccounts.method,
      accountNumber: userPayoutAccounts.accountNumber,
      ifscCode: userPayoutAccounts.ifscCode,
      bankName: userPayoutAccounts.bankName,
      accountHolderName: userPayoutAccounts.accountHolderName,
      approvalStatus: userPayoutAccounts.approvalStatus,
      rejectionReason: userPayoutAccounts.rejectionReason,
      approvedBy: userPayoutAccounts.approvedBy,
      approvedAt: userPayoutAccounts.approvedAt,
      createdAt: userPayoutAccounts.createdAt,
      userName: users.name,
      userPhone: users.phone,
      userEmail: users.email,
    })
    .from(userPayoutAccounts)
    .leftJoin(users, and(eq(users.id, userPayoutAccounts.userId), eq(users.tenant, userPayoutAccounts.tenant)))
    .where(and(eq(userPayoutAccounts.id, id), eq(userPayoutAccounts.tenant, tenant)))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    userId: row.userId,
    method: row.method,
    accountNumber: row.accountNumber,
    ifscCode: row.ifscCode,
    bankName: row.bankName,
    accountHolderName: row.accountHolderName,
    approvalStatus: (row.approvalStatus ?? 'PENDING') as 'PENDING' | 'APPROVED' | 'REJECTED',
    rejectionReason: row.rejectionReason,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    userName: row.userName,
    userPhone: row.userPhone,
    userEmail: row.userEmail,
  }
}

export async function approvePayoutAccount(
  id: number,
  tenant: string,
  reviewerId: number | null
): Promise<AdminPayoutAccountRow | null> {
  const updated = await db
    .update(userPayoutAccounts)
    .set({
      approvalStatus: 'APPROVED',
      approvedBy: reviewerId && reviewerId > 0 ? reviewerId : null,
      approvedAt: new Date(),
      rejectionReason: null,
      updatedAt: new Date(),
    })
    // A deleted account is not reviewed: it reads as not found.
    .where(and(eq(userPayoutAccounts.id, id), eq(userPayoutAccounts.tenant, tenant), isNull(userPayoutAccounts.deletedAt)))
    .returning()

  if (!updated[0]) return null
  return getPayoutAccountById(updated[0].id, tenant)
}

export async function rejectPayoutAccount(
  id: number,
  tenant: string,
  reviewerId: number | null,
  reason?: string | null
): Promise<AdminPayoutAccountRow | null> {
  const updated = await db
    .update(userPayoutAccounts)
    .set({
      approvalStatus: 'REJECTED',
      approvedBy: reviewerId && reviewerId > 0 ? reviewerId : null,
      approvedAt: new Date(),
      rejectionReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(userPayoutAccounts.id, id), eq(userPayoutAccounts.tenant, tenant), isNull(userPayoutAccounts.deletedAt)))
    .returning()

  if (!updated[0]) return null
  return getPayoutAccountById(updated[0].id, tenant)
}
