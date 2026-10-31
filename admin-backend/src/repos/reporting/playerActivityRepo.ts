import { db } from '@/db/client.js';
import {
  depositRequests,
  withdrawalRequests,
  wallets,
  ledgerEntries,
  users,
} from '@shared/db/schema.js';
import { eq, and, inArray, gte, lte, sql } from 'drizzle-orm';
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';
import { settlementDateExpr } from '@src/shared/reportingSql.js';

export interface PlayerDepositWithdrawalStats {
  playerId: number;
  totalDepositAmount: number;
  totalDepositCount: number;
  totalWithdrawalAmount: number;
  totalWithdrawalCount: number;
  rangeDepositAmount: number;
  rangeDepositCount: number;
  rangeWithdrawalAmount: number;
  rangeWithdrawalCount: number;
}

export interface GetPlayerDepositWithdrawalStatsParams {
  playerIds: number[];
  tenant: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Fetches deposit and withdrawal stats (TOTAL = all-time, RANGE = filtered by date) per player.
 * Includes direct deposits/withdrawals (from deposit_requests, withdrawal_requests) and manual
 * deposits/withdrawals (from ledger_entries admin adjustments).
 */
export async function getPlayerDepositWithdrawalStats(
  params: GetPlayerDepositWithdrawalStatsParams
): Promise<PlayerDepositWithdrawalStats[]> {
  const { playerIds, tenant, dateFrom, dateTo } = params;
  if (playerIds.length === 0) return [];

  // Include ALL player types (REGULAR, SHARING_AGENT_PLAYER, COMMISSION_AGENT_PLAYER, AGENT_CREDIT, etc.)
  const playerRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenant, tenant), inArray(users.id, playerIds)));
  const eligiblePlayerIds = playerRows.map((r) => r.id);
  if (eligiblePlayerIds.length === 0) {
    return playerIds.map((id) => defaultStats(id));
  }

  // CRITICAL: dateFrom/dateTo are used ONLY for RANGE stats. TOTAL is always all-time (no date filter).
  // Use timezone-aware parsing so dateTo includes end-of-day (avoids missing same-day transactions)
  let dateFromDt: Date | undefined;
  let dateToDt: Date | undefined;
  if (dateFrom && dateTo) {
    const tz = await getWhitelabelTimezone(tenant);
    dateFromDt = parseDateFrom(dateFrom, tz);
    dateToDt = parseDateTo(dateTo, tz);
  }

  const [
    totalDeposits,
    totalWithdrawals,
    rangeDeposits,
    rangeWithdrawals,
    walletRows,
  ] = await Promise.all([
    db
      .select({
        userId: depositRequests.userId,
        total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.tenant, tenant),
          inArray(depositRequests.userId, eligiblePlayerIds),
          eq(depositRequests.status, 'APPROVED' as any)
        )
      )
      .groupBy(depositRequests.userId),
    db
      .select({
        userId: withdrawalRequests.userId,
        total: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.tenant, tenant),
          inArray(withdrawalRequests.userId, eligiblePlayerIds),
          eq(withdrawalRequests.status, 'COMPLETED' as any)
        )
      )
      .groupBy(withdrawalRequests.userId),
    dateFromDt && dateToDt
      ? db
          .select({
            userId: depositRequests.userId,
            total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(depositRequests)
          .where(
            and(
              eq(depositRequests.tenant, tenant),
              inArray(depositRequests.userId, eligiblePlayerIds),
              eq(depositRequests.status, 'APPROVED' as any),
              gte(settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt), dateFromDt),
              lte(settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt), dateToDt)
            )
          )
          .groupBy(depositRequests.userId)
      : [],
    dateFromDt && dateToDt
      ? db
          .select({
            userId: withdrawalRequests.userId,
            total: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)`,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(withdrawalRequests)
          .where(
            and(
              eq(withdrawalRequests.tenant, tenant),
              inArray(withdrawalRequests.userId, eligiblePlayerIds),
              eq(withdrawalRequests.status, 'COMPLETED' as any),
              gte(settlementDateExpr(withdrawalRequests.reviewedAt, withdrawalRequests.createdAt), dateFromDt),
              lte(settlementDateExpr(withdrawalRequests.reviewedAt, withdrawalRequests.createdAt), dateToDt)
            )
          )
          .groupBy(withdrawalRequests.userId)
      : [],
    db
      .select({ userId: wallets.userId, walletId: wallets.id })
      .from(wallets)
      .where(
        and(
          eq(wallets.tenant, tenant),
          inArray(wallets.userId, eligiblePlayerIds)
        )
      ),
  ]);

  const userWalletMap = new Map<number, number>();
  const walletUserMap = new Map<number, number>();
  for (const row of walletRows) {
    userWalletMap.set(row.userId, row.walletId);
    walletUserMap.set(row.walletId, row.userId);
  }
  const walletIds = walletRows.map((r) => r.walletId);

  // Manual deposits/withdrawals from ledger_entries (admin adjustments)
  let totalManualDeposits: { walletId: number; count: number; volume: number }[] =
    [];
  let totalManualWithdrawals: {
    walletId: number;
    count: number;
    volume: number;
  }[] = [];
  let rangeManualDeposits: { walletId: number; count: number; volume: number }[] =
    [];
  let rangeManualWithdrawals: {
    walletId: number;
    count: number;
    volume: number;
  }[] = [];

  if (walletIds.length > 0) {
    const manualBaseDepositClauses = [
      eq(ledgerEntries.tenant, tenant),
      inArray(ledgerEntries.walletId, walletIds),
      eq(ledgerEntries.type, 'credit'),
      sql`${ledgerEntries.meta} IS NOT NULL`,
      sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`,
      sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`,
    ];
    const manualBaseWithdrawalClauses = [
      eq(ledgerEntries.tenant, tenant),
      inArray(ledgerEntries.walletId, walletIds),
      eq(ledgerEntries.type, 'debit'),
      sql`${ledgerEntries.meta} IS NOT NULL`,
      sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`,
    ];

    [
      totalManualDeposits,
      totalManualWithdrawals,
      rangeManualDeposits,
      rangeManualWithdrawals,
    ] = await Promise.all([
      db
        .select({
          walletId: ledgerEntries.walletId,
          count: sql<number>`COUNT(*)::int`,
          volume: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
        })
        .from(ledgerEntries)
        .where(and(...manualBaseDepositClauses))
        .groupBy(ledgerEntries.walletId),
      db
        .select({
          walletId: ledgerEntries.walletId,
          count: sql<number>`COUNT(*)::int`,
          volume: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
        })
        .from(ledgerEntries)
        .where(and(...manualBaseWithdrawalClauses))
        .groupBy(ledgerEntries.walletId),
      dateFromDt && dateToDt
        ? db
            .select({
              walletId: ledgerEntries.walletId,
              count: sql<number>`COUNT(*)::int`,
              volume: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
            })
            .from(ledgerEntries)
            .where(
              and(
                ...manualBaseDepositClauses,
                gte(ledgerEntries.createdAt, dateFromDt),
                lte(ledgerEntries.createdAt, dateToDt)
              )
            )
            .groupBy(ledgerEntries.walletId)
        : [],
      dateFromDt && dateToDt
        ? db
            .select({
              walletId: ledgerEntries.walletId,
              count: sql<number>`COUNT(*)::int`,
              volume: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
            })
            .from(ledgerEntries)
            .where(
              and(
                ...manualBaseWithdrawalClauses,
                gte(ledgerEntries.createdAt, dateFromDt),
                lte(ledgerEntries.createdAt, dateToDt)
              )
            )
            .groupBy(ledgerEntries.walletId)
        : [],
    ]);
  }

  // Total Deposit = direct (user self-deposit) + manual (admin deposit) — both amount and count
  const totalDepMap = new Map<number, { total: number; count: number }>();
  for (const row of totalDeposits) {
    totalDepMap.set(row.userId, {
      total: Number(row.total || 0),
      count: Number(row.count || 0),
    });
  }
  for (const row of totalManualDeposits) {
    const userId = walletUserMap.get(row.walletId);
    if (userId !== undefined) {
      const prev = totalDepMap.get(userId) || { total: 0, count: 0 };
      totalDepMap.set(userId, {
        total: prev.total + Number(row.volume || 0),
        count: prev.count + Number(row.count || 0),
      });
    }
  }

  // Total Withdraw = direct (user withdrawal) + manual (admin withdrawal) — both amount and count
  const totalWithMap = new Map<number, { total: number; count: number }>();
  for (const row of totalWithdrawals) {
    totalWithMap.set(row.userId, {
      total: Number(row.total || 0),
      count: Number(row.count || 0),
    });
  }
  for (const row of totalManualWithdrawals) {
    const userId = walletUserMap.get(row.walletId);
    if (userId !== undefined) {
      const prev = totalWithMap.get(userId) || { total: 0, count: 0 };
      totalWithMap.set(userId, {
        total: prev.total + Number(row.volume || 0),
        count: prev.count + Number(row.count || 0),
      });
    }
  }

  const rangeDepMap = new Map<number, { total: number; count: number }>();
  for (const row of rangeDeposits as { userId: number; total: number; count: number }[]) {
    rangeDepMap.set(row.userId, {
      total: Number(row.total || 0),
      count: Number(row.count || 0),
    });
  }
  for (const row of rangeManualDeposits) {
    const userId = walletUserMap.get(row.walletId);
    if (userId !== undefined) {
      const prev = rangeDepMap.get(userId) || { total: 0, count: 0 };
      rangeDepMap.set(userId, {
        total: prev.total + Number(row.volume || 0),
        count: prev.count + Number(row.count || 0),
      });
    }
  }

  const rangeWithMap = new Map<number, { total: number; count: number }>();
  for (const row of rangeWithdrawals as { userId: number; total: number; count: number }[]) {
    rangeWithMap.set(row.userId, {
      total: Number(row.total || 0),
      count: Number(row.count || 0),
    });
  }
  for (const row of rangeManualWithdrawals) {
    const userId = walletUserMap.get(row.walletId);
    if (userId !== undefined) {
      const prev = rangeWithMap.get(userId) || { total: 0, count: 0 };
      rangeWithMap.set(userId, {
        total: prev.total + Number(row.volume || 0),
        count: prev.count + Number(row.count || 0),
      });
    }
  }

  return playerIds.map((playerId) => {
    const totalDep = totalDepMap.get(playerId) || { total: 0, count: 0 };
    const totalWith = totalWithMap.get(playerId) || { total: 0, count: 0 };
    const rangeDep = rangeDepMap.get(playerId) || { total: 0, count: 0 };
    const rangeWith = rangeWithMap.get(playerId) || { total: 0, count: 0 };
    return {
      playerId,
      totalDepositAmount: totalDep.total,
      totalDepositCount: totalDep.count,
      totalWithdrawalAmount: totalWith.total,
      totalWithdrawalCount: totalWith.count,
      rangeDepositAmount: rangeDep.total,
      rangeDepositCount: rangeDep.count,
      rangeWithdrawalAmount: rangeWith.total,
      rangeWithdrawalCount: rangeWith.count,
    };
  });
}

function defaultStats(playerId: number): PlayerDepositWithdrawalStats {
  return {
    playerId,
    totalDepositAmount: 0,
    totalDepositCount: 0,
    totalWithdrawalAmount: 0,
    totalWithdrawalCount: 0,
    rangeDepositAmount: 0,
    rangeDepositCount: 0,
    rangeWithdrawalAmount: 0,
    rangeWithdrawalCount: 0,
  };
}
