import { db } from '@src/db/client.js'
import { and, asc, count, desc, eq, gte, inArray, lte, or } from 'drizzle-orm'
import { walletLedger } from '@shared/db/schema.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'

export type WalletLedgerListParams = {
  tenant: string
  walletId: number
  walletType: string
  category?: string
  categories?: string[]
  direction?: string
  /** When set, also includes admin_adjustment entries with this direction via OR */
  includeAdjustmentDirection?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
}

export async function listWalletLedgerEntriesDb(params: WalletLedgerListParams) {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100)
  const offset = Math.max(params.offset ?? 0, 0)

  const clauses = [eq(walletLedger.tenant, params.tenant), eq(walletLedger.walletId, params.walletId), eq(walletLedger.walletType, params.walletType)]

  const adjDir = params.includeAdjustmentDirection
  if (adjDir) {
    const adjClause = and(eq(walletLedger.category, 'admin_adjustment'), eq(walletLedger.direction, adjDir))!
    if (params.categories && params.categories.length > 0) {
      clauses.push(or(inArray(walletLedger.category, params.categories), adjClause)!)
    } else if (params.category) {
      clauses.push(or(eq(walletLedger.category, params.category), adjClause)!)
    } else {
      clauses.push(adjClause)
    }
  } else {
    if (params.categories && params.categories.length > 0) {
      clauses.push(inArray(walletLedger.category, params.categories))
    } else if (params.category) {
      clauses.push(eq(walletLedger.category, params.category))
    }
    if (params.direction) {
      clauses.push(eq(walletLedger.direction, params.direction))
    }
  }
  if (params.dateFrom || params.dateTo) {
    const tz = await getWhitelabelTimezone(params.tenant)
    if (params.dateFrom) {
      const fromDate = parseDateFrom(params.dateFrom, tz)
      if (!Number.isNaN(fromDate.getTime())) clauses.push(gte(walletLedger.createdAt, fromDate))
    }
    if (params.dateTo) {
      const toDate = parseDateTo(params.dateTo, tz)
      if (!Number.isNaN(toDate.getTime())) clauses.push(lte(walletLedger.createdAt, toDate))
    }
  }

  const where = and(...clauses)

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: walletLedger.id,
        walletType: walletLedger.walletType,
        category: walletLedger.category,
        direction: walletLedger.direction,
        amount: walletLedger.amount,
        balanceBefore: walletLedger.balanceBefore,
        balanceAfter: walletLedger.balanceAfter,
        description: walletLedger.description,
        referenceType: walletLedger.referenceType,
        referenceId: walletLedger.referenceId,
        meta: walletLedger.meta,
        createdAt: walletLedger.createdAt,
      })
      .from(walletLedger)
      .where(where)
      .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(walletLedger).where(where),
  ])
  const total = (countResult[0] as { total: number } | undefined)?.total ?? 0

  const mapped = items.map((row) => ({
    id: row.id,
    walletType: row.walletType,
    category: row.category,
    direction: row.direction,
    amount: Number(row.amount ?? 0),
    balanceBefore: row.balanceBefore != null ? Number(row.balanceBefore) : null,
    balanceAfter: row.balanceAfter != null ? Number(row.balanceAfter) : null,
    description: row.description ?? null,
    referenceType: row.referenceType ?? null,
    referenceId: row.referenceId ?? null,
    meta: row.meta ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  }))

  const totalCount = Number(total)
  return {
    items: mapped,
    total: totalCount,
    hasMore: offset + mapped.length < totalCount,
  }
}
