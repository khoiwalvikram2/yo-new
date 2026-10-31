import { db } from '@/db/client.js';
import { depositRequests, withdrawalRequests, wallets, ledgerEntries } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, inArray } from 'drizzle-orm';
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';

interface DateRangeFilter {
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Get payment analytics including pending transactions, payment methods, and success rates
 */
export async function getPaymentAnalytics(tenant: string, filter?: DateRangeFilter) {
  try {
    const tz = await getWhitelabelTimezone(tenant ?? 'default');
    const dateFrom = filter?.dateFrom ? parseDateFrom(filter.dateFrom, tz) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = filter?.dateTo ? parseDateTo(filter.dateTo, tz) : new Date();

    // Get pending withdrawals
    const pendingWithdrawals = await getPendingTransactions(tenant, 'withdrawal', dateFrom, dateTo);
    
    // Get pending deposits
    const pendingDeposits = await getPendingTransactions(tenant, 'deposit', dateFrom, dateTo);
    
    // Get payment method breakdown
    const paymentMethods = await getPaymentMethodBreakdown(tenant, dateFrom, dateTo);
    
    // Calculate transaction success rate
    const successRate = await getTransactionSuccessRate(tenant, dateFrom, dateTo);
    
    // Calculate average withdrawal time
    const avgWithdrawalTime = await getAvgWithdrawalTime(tenant, dateFrom, dateTo);
    
    // Calculate failed transactions rate
    const failedRate = 100 - successRate;
    
    // Calculate withdrawal to deposit ratio
    const ratio = await getWithdrawalToDepositRatio(tenant, dateFrom, dateTo);

    return {
      pendingWithdrawals,
      pendingDeposits,
      paymentMethodBreakdown: paymentMethods,
      transactionSuccessRate: successRate,
      avgWithdrawalTime,
      failedTransactionsRate: failedRate,
      withdrawalToDepositRatio: ratio,
    };
  } catch (error: any) {
    return {
      pendingWithdrawals: { count: 0, totalAmount: 0 },
      pendingDeposits: { count: 0, totalAmount: 0 },
      paymentMethodBreakdown: [],
      transactionSuccessRate: 0,
      avgWithdrawalTime: 0,
      failedTransactionsRate: 0,
      withdrawalToDepositRatio: 0,
    };
  }
}

/**
 * Get pending transactions by type
 */
async function getPendingTransactions(
  tenant: string,
  type: 'deposit' | 'withdrawal',
  dateFrom: Date,
  dateTo: Date
) {
  try {
    const table = type === 'deposit' ? depositRequests : withdrawalRequests;
    const statuses = type === 'deposit' 
      ? ['PENDING'] as any 
      : ['PENDING', 'PROCESSING'] as any;

    const [result] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        total: sql<number>`COALESCE(SUM(${table.amount}::numeric), 0)`,
      })
      .from(table)
      .where(
        and(
          eq(table.tenant, tenant),
          inArray(table.status, statuses),
          gte(table.createdAt, dateFrom),
          lte(table.createdAt, dateTo)
        )
      );

    return {
      count: Number(result?.count || 0),
      totalAmount: Number(result?.total || 0),
    };
  } catch (error: any) {
    return { count: 0, totalAmount: 0 };
  }
}

/**
 * Get payment method breakdown
 */
async function getPaymentMethodBreakdown(tenant: string, dateFrom: Date, dateTo: Date) {
  try {
    // Get deposit methods
    const depositResults = await db
      .select({
        method: depositRequests.method,
        count: sql<number>`COUNT(*)::int`,
        total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
        successCount: sql<number>`COUNT(CASE WHEN ${depositRequests.status} = 'APPROVED' THEN 1 END)::int`,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.tenant, tenant),
          gte(depositRequests.createdAt, dateFrom),
          lte(depositRequests.createdAt, dateTo)
        )
      )
      .groupBy(depositRequests.method);

    // Get withdrawal methods (withdrawals don't have method field, so we'll use a default)
    const withdrawalResults = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        total: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)`,
        successCount: sql<number>`COUNT(CASE WHEN ${withdrawalRequests.status} = 'COMPLETED' THEN 1 END)::int`,
      })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.tenant, tenant),
          gte(withdrawalRequests.createdAt, dateFrom),
          lte(withdrawalRequests.createdAt, dateTo)
        )
      );

    const results = [
      ...depositResults.map((r) => ({
        method: String(r.method || 'Unknown'),
        count: Number(r.count || 0),
        totalAmount: Number(r.total || 0),
        successRate: r.count > 0 ? (Number(r.successCount || 0) / Number(r.count)) * 100 : 0,
      })),
      ...(withdrawalResults[0] ? [{
        method: 'WITHDRAWAL',
        count: Number(withdrawalResults[0].count || 0),
        totalAmount: Number(withdrawalResults[0].total || 0),
        successRate: withdrawalResults[0].count > 0 
          ? (Number(withdrawalResults[0].successCount || 0) / Number(withdrawalResults[0].count)) * 100 
          : 0,
      }] : []),
    ];

    return results;
  } catch (error: any) {
    return [];
  }
}

/**
 * Get transaction success rate
 */
async function getTransactionSuccessRate(tenant: string, dateFrom: Date, dateTo: Date) {
  try {
    // Get deposit success rate
    const [depositResult] = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        successful: sql<number>`COUNT(CASE WHEN ${depositRequests.status} = 'APPROVED' THEN 1 END)::int`,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.tenant, tenant),
          gte(depositRequests.createdAt, dateFrom),
          lte(depositRequests.createdAt, dateTo)
        )
      );

    // Get withdrawal success rate
    const [withdrawalResult] = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        successful: sql<number>`COUNT(CASE WHEN ${withdrawalRequests.status} = 'COMPLETED' THEN 1 END)::int`,
      })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.tenant, tenant),
          gte(withdrawalRequests.createdAt, dateFrom),
          lte(withdrawalRequests.createdAt, dateTo)
        )
      );

    const total = Number(depositResult?.total || 0) + Number(withdrawalResult?.total || 0);
    const successful = Number(depositResult?.successful || 0) + Number(withdrawalResult?.successful || 0);
    return total > 0 ? (successful / total) * 100 : 0;
  } catch (error: any) {
    return 0;
  }
}

/**
 * Get average withdrawal processing time in hours
 */
async function getAvgWithdrawalTime(tenant: string, dateFrom: Date, dateTo: Date) {
  try {
    const [result] = await db
      .select({
        avgTime: sql<number>`AVG(EXTRACT(EPOCH FROM (${withdrawalRequests.updatedAt} - ${withdrawalRequests.createdAt})) / 3600)`,
      })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.tenant, tenant),
          eq(withdrawalRequests.status, 'COMPLETED' as any),
          gte(withdrawalRequests.createdAt, dateFrom),
          lte(withdrawalRequests.createdAt, dateTo)
        )
      );

    return Number(result?.avgTime || 0);
  } catch (error: any) {
    return 0;
  }
}

/**
 * Get withdrawal to deposit ratio (direct + manual combined)
 */
async function getWithdrawalToDepositRatio(tenant: string, dateFrom: Date, dateTo: Date) {
  try {
    // Direct approved deposits
    const [directDepositResult] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.tenant, tenant),
          eq(depositRequests.status, 'APPROVED' as any),
          gte(depositRequests.createdAt, dateFrom),
          lte(depositRequests.createdAt, dateTo)
        )
      );

    // Direct completed withdrawals
    const [directWithdrawalResult] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)`,
      })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.tenant, tenant),
          eq(withdrawalRequests.status, 'COMPLETED' as any),
          gte(withdrawalRequests.createdAt, dateFrom),
          lte(withdrawalRequests.createdAt, dateTo)
        )
      );

    // Manual deposits from ledger_entries
    const [manualDepositResult] = await db
      .select({
        total: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.tenant, tenant),
          eq(ledgerEntries.type, 'credit'),
          sql`${ledgerEntries.meta} IS NOT NULL`,
          sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`,
          sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`,
          gte(ledgerEntries.createdAt, dateFrom),
          lte(ledgerEntries.createdAt, dateTo)
        )
      );

    // Manual withdrawals from ledger_entries
    const [manualWithdrawalResult] = await db
      .select({
        total: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.tenant, tenant),
          eq(ledgerEntries.type, 'debit'),
          sql`${ledgerEntries.meta} IS NOT NULL`,
          sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`,
          gte(ledgerEntries.createdAt, dateFrom),
          lte(ledgerEntries.createdAt, dateTo)
        )
      );

    const deposits = Number(directDepositResult?.total || 0) + Number(manualDepositResult?.total || 0);
    const withdrawals = Number(directWithdrawalResult?.total || 0) + Number(manualWithdrawalResult?.total || 0);
    return deposits > 0 ? withdrawals / deposits : 0;
  } catch (error: any) {
    return 0;
  }
}

