import { db } from '@/db/client';
import { 
  users, 
  depositRequests, 
  withdrawalRequests,
  sportsBets,
  casinoBets,
  matkaBets,
  wallets,
  ledgerEntries,
} from '@shared/db/schema';
import { eq, and, inArray, sql, gte, lte } from 'drizzle-orm';
import { settlementDateExpr } from '@src/shared/reportingSql.js';

interface PlayerListStats {
  // For REGULAR and SHARING_AGENT_PLAYER
  totalDeposits: number | null;
  totalWithdrawals: number | null;
  depositCount: number | null;
  withdrawalCount: number | null;
  manualDepositCount: number | null;
  manualWithdrawalCount: number | null;
  
  // For all player types (except commission)
  ggr: number | null;
  profitLoss: number | null;
  plTrend: 'up' | 'down' | 'neutral' | null;
  betCount: number | null;
  totalExposure: number | null;
  lastLogin: string | null;
  lastActivityAt: string | null; // max(lastLogin, lastBetAt) for "Last Activity" column
  lastBetAt: string | null; // last bet timestamp (sports/casino/matka) for display
  daysSinceLastBet: number | null;
  
  // For COMMISSION_AGENT_PLAYER
  turnover: number | null;
  commissionEarned: number | null;
  commissionTrend: 'up' | 'down' | 'neutral' | null;
}

export class PlayerListStatsService {
  async getStatsForPlayers(
    playerIds: number[],
    tenant: string,
    playerTypes: Map<number, string> // Map<playerId, playerType>
  ): Promise<Map<number, PlayerListStats>> {
    if (playerIds.length === 0) {
      return new Map();
    }

    const statsMap = new Map<number, PlayerListStats>();
    
    // Initialize with default values
    for (const playerId of playerIds) {
      statsMap.set(playerId, this.getDefaultStats());
    }

    await Promise.all([
      this.fetchLastLogin(playerIds, tenant, statsMap),
      this.fetchLastBetInfo(playerIds, tenant, statsMap),
      this.fetchDepositsWithdrawals(playerIds, tenant, statsMap, playerTypes),
      this.fetchGGRAndExposure(playerIds, tenant, statsMap, playerTypes),
      this.fetchPLTrend(playerIds, tenant, statsMap, playerTypes),
      this.fetchCommissionInfo(playerIds, tenant, statsMap, playerTypes),
    ]);

    // lastActivityAt = most recent of lastLogin and last bet (from daysSinceLastBet we have no timestamp here; recompute from stored lastBet in fetchLastBetInfo)
    this.computeLastActivityAt(statsMap);

    return statsMap;
  }

  /** Set lastActivityAt = max(lastLogin, lastBetAt) and lastBetAt per player. lastBetAt is stored temporarily in _lastBetAt. */
  private computeLastActivityAt(statsMap: Map<number, PlayerListStats>): void {
    for (const stats of statsMap.values()) {
      const extended = stats as PlayerListStats & { _lastBetAt?: Date | null };
      const betDate = extended._lastBetAt;
      stats.lastBetAt = betDate ? betDate.toISOString() : null;
      const login = stats.lastLogin ? new Date(stats.lastLogin).getTime() : 0;
      const bet = betDate?.getTime() ?? 0;
      const latest = Math.max(login, bet);
      stats.lastActivityAt = latest > 0 ? new Date(latest).toISOString() : null;
      delete extended._lastBetAt;
    }
  }

  private getDefaultStats(): PlayerListStats {
    return {
      totalDeposits: null,
      totalWithdrawals: null,
      depositCount: null,
      withdrawalCount: null,
      manualDepositCount: null,
      manualWithdrawalCount: null,
      ggr: null,
      profitLoss: null,
      plTrend: null,
      betCount: null,
      totalExposure: null,
      lastLogin: null,
      lastActivityAt: null,
      lastBetAt: null,
      daysSinceLastBet: null,
      turnover: null,
      commissionEarned: null,
      commissionTrend: null,
    };
  }

  private async fetchLastLogin(
    playerIds: number[],
    tenant: string,
    statsMap: Map<number, PlayerListStats>
  ): Promise<void> {
    if (playerIds.length === 0) return;
    const rows = await db
      .select({ id: users.id, lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(and(eq(users.tenant, tenant), inArray(users.id, playerIds)));
    for (const row of rows) {
      const stats = statsMap.get(row.id);
      if (stats) {
        stats.lastLogin = row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null;
      }
    }
  }

  private async fetchLastBetInfo(
    playerIds: number[],
    tenant: string,
    statsMap: Map<number, PlayerListStats>
  ): Promise<void> {
    try {
      const now = new Date();

      const [sportsResults, casinoResults, matkaResults] = await Promise.all([
        db
          .select({
            userId: sportsBets.userId,
            lastBet: sql<Date>`MAX(${sportsBets.createdAt})`,
            betCount: sql<number>`COUNT(*)::int`,
            exposure: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.status} = 'unmatched' OR ${sportsBets.status} = 'matched' THEN ${sportsBets.liability}::numeric ELSE 0 END), 0)`,
          })
          .from(sportsBets)
          .where(
            and(
              eq(sportsBets.tenant, tenant),
              inArray(sportsBets.userId, playerIds)
            )
          )
          .groupBy(sportsBets.userId),
        db
          .select({
            userId: casinoBets.userId,
            lastBet: sql<Date>`MAX(${casinoBets.createdAt})`,
            betCount: sql<number>`COUNT(*)::int`,
          })
          .from(casinoBets)
          .where(
            and(
              eq(casinoBets.tenant, tenant),
              inArray(casinoBets.userId, playerIds)
            )
          )
          .groupBy(casinoBets.userId),
        db
          .select({
            userId: matkaBets.userId,
            lastBet: sql<Date>`MAX(${matkaBets.createdAt})`,
            betCount: sql<number>`COUNT(*)::int`,
          })
          .from(matkaBets)
          .where(
            and(
              eq(matkaBets.tenant, tenant),
              inArray(matkaBets.userId, playerIds)
            )
          )
          .groupBy(matkaBets.userId),
      ]);

      type StatsWithLastBet = PlayerListStats & { _lastBetAt?: Date | null };
      const setLastBet = (stats: PlayerListStats, lastBet: Date) => {
        const s = stats as StatsWithLastBet;
        if (!s._lastBetAt || lastBet.getTime() > s._lastBetAt.getTime()) s._lastBetAt = lastBet;
      };

      // Combine results
      for (const row of sportsResults) {
        const stats = statsMap.get(row.userId);
        if (stats) {
          if (row.lastBet) {
            const lastBetDate = new Date(row.lastBet);
            setLastBet(stats, lastBetDate);
            const daysDiff = Math.floor((now.getTime() - lastBetDate.getTime()) / (1000 * 60 * 60 * 24));
            stats.daysSinceLastBet = stats.daysSinceLastBet === null 
              ? daysDiff 
              : Math.min(stats.daysSinceLastBet, daysDiff);
          }
          stats.betCount = (stats.betCount || 0) + Number(row.betCount || 0);
          stats.totalExposure = (stats.totalExposure || 0) + Number(row.exposure || 0);
        }
      }

      for (const row of casinoResults) {
        const stats = statsMap.get(row.userId);
        if (stats) {
          if (row.lastBet) {
            const lastBetDate = new Date(row.lastBet);
            setLastBet(stats, lastBetDate);
            const daysDiff = Math.floor((now.getTime() - lastBetDate.getTime()) / (1000 * 60 * 60 * 24));
            stats.daysSinceLastBet = stats.daysSinceLastBet === null 
              ? daysDiff 
              : Math.min(stats.daysSinceLastBet, daysDiff);
          }
          stats.betCount = (stats.betCount || 0) + Number(row.betCount || 0);
        }
      }

      for (const row of matkaResults) {
        const stats = statsMap.get(row.userId);
        if (stats) {
          if (row.lastBet) {
            const lastBetDate = new Date(row.lastBet);
            setLastBet(stats, lastBetDate);
            const daysDiff = Math.floor((now.getTime() - lastBetDate.getTime()) / (1000 * 60 * 60 * 24));
            stats.daysSinceLastBet = stats.daysSinceLastBet === null 
              ? daysDiff 
              : Math.min(stats.daysSinceLastBet, daysDiff);
          }
          stats.betCount = (stats.betCount || 0) + Number(row.betCount || 0);
        }
      }
    } catch (error) {
    }
  }

  private async fetchDepositsWithdrawals(
    playerIds: number[],
    tenant: string,
    statsMap: Map<number, PlayerListStats>,
    playerTypes: Map<number, string>
  ): Promise<void> {
    try {
      const regularPlayerIds = playerIds.filter(id => {
        const playerType = playerTypes.get(id);
        return playerType === 'REGULAR' || playerType === 'SHARING_AGENT_PLAYER';
      });

      if (regularPlayerIds.length === 0) return;

      const [depositsResults, withdrawalsResults, walletRows] = await Promise.all([
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
              inArray(depositRequests.userId, regularPlayerIds),
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
              inArray(withdrawalRequests.userId, regularPlayerIds),
              eq(withdrawalRequests.status, 'COMPLETED' as any)
            )
          )
          .groupBy(withdrawalRequests.userId),
        db
          .select({
            userId: wallets.userId,
            walletId: wallets.id,
          })
          .from(wallets)
          .where(
            and(
              eq(wallets.tenant, tenant),
              inArray(wallets.userId, regularPlayerIds)
            )
          ),
      ]);

      const userWalletMap = new Map<number, number>();
      const walletUserMap = new Map<number, number>();
      for (const row of walletRows) {
        userWalletMap.set(row.userId, row.walletId);
        walletUserMap.set(row.walletId, row.userId);
      }

      const walletIds = walletRows.map(r => r.walletId);

      // Get manual deposits from ledger_entries (admin adjustments, not from deposit_requests)
      let manualDepositsResults: { walletId: number; count: number; volume: number }[] = [];
      let manualWithdrawalsResults: { walletId: number; count: number; volume: number }[] = [];

      if (walletIds.length > 0) {
        [manualDepositsResults, manualWithdrawalsResults] = await Promise.all([
          db
            .select({
              walletId: ledgerEntries.walletId,
              count: sql<number>`COUNT(*)::int`,
              volume: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
            })
            .from(ledgerEntries)
            .where(
              and(
                eq(ledgerEntries.tenant, tenant),
                inArray(ledgerEntries.walletId, walletIds),
                eq(ledgerEntries.type, 'credit'),
                sql`${ledgerEntries.meta} IS NOT NULL`,
                sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`,
                sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`
              )
            )
            .groupBy(ledgerEntries.walletId),
          db
            .select({
              walletId: ledgerEntries.walletId,
              count: sql<number>`COUNT(*)::int`,
              volume: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
            })
            .from(ledgerEntries)
            .where(
              and(
                eq(ledgerEntries.tenant, tenant),
                inArray(ledgerEntries.walletId, walletIds),
                eq(ledgerEntries.type, 'debit'),
                sql`${ledgerEntries.meta} IS NOT NULL`,
                sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`
              )
            )
            .groupBy(ledgerEntries.walletId),
        ]);
      }

      // Update stats map with direct deposit/withdrawal counts & amounts
      for (const row of depositsResults) {
        const stats = statsMap.get(row.userId);
        if (stats) {
          stats.totalDeposits = Number(row.total || 0);
          stats.depositCount = Number(row.count || 0);
        }
      }

      for (const row of withdrawalsResults) {
        const stats = statsMap.get(row.userId);
        if (stats) {
          stats.totalWithdrawals = Number(row.total || 0);
          stats.withdrawalCount = Number(row.count || 0);
        }
      }

      // Update stats map with manual deposit/withdrawal counts & add manual volume to totals
      for (const row of manualDepositsResults) {
        const userId = walletUserMap.get(row.walletId);
        if (userId !== undefined) {
          const stats = statsMap.get(userId);
          if (stats) {
            stats.manualDepositCount = Number(row.count || 0);
            // Add manual deposit volume to totalDeposits (direct + manual combined)
            stats.totalDeposits = (stats.totalDeposits || 0) + Number(row.volume || 0);
          }
        }
      }

      for (const row of manualWithdrawalsResults) {
        const userId = walletUserMap.get(row.walletId);
        if (userId !== undefined) {
          const stats = statsMap.get(userId);
          if (stats) {
            stats.manualWithdrawalCount = Number(row.count || 0);
            // Add manual withdrawal volume to totalWithdrawals (direct + manual combined)
            stats.totalWithdrawals = (stats.totalWithdrawals || 0) + Number(row.volume || 0);
          }
        }
      }
    } catch (error) {
    }
  }

  private async fetchGGRAndExposure(
    playerIds: number[],
    tenant: string,
    statsMap: Map<number, PlayerListStats>,
    playerTypes: Map<number, string>
  ): Promise<void> {
    try {
      // Fetch GGR for all player types except none (commission players also need performance stats)
      const nonCommissionPlayerIds = playerIds.filter(id => {
        const playerType = playerTypes.get(id);
        return playerType != null;
      });

      if (nonCommissionPlayerIds.length === 0) return;

      const [sportsGGRResults, casinoGGRResults, matkaGGRResults] = await Promise.all([
        db
          .select({
            userId: sportsBets.userId,
            ggr: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
            pl: sql<number>`COALESCE(SUM(${sportsBets.pl}::numeric), 0)`,
          })
          .from(sportsBets)
          .where(
            and(
              eq(sportsBets.tenant, tenant),
              inArray(sportsBets.userId, nonCommissionPlayerIds),
              inArray(sportsBets.status, ['won', 'lost', 'settled'])
            )
          )
          .groupBy(sportsBets.userId),
        db
          .select({
            userId: casinoBets.userId,
            ggr: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}::numeric, 0)), 0)`,
            pl: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, 0) - ${casinoBets.stake}::numeric), 0)`,
          })
          .from(casinoBets)
          .where(
            and(
              eq(casinoBets.tenant, tenant),
              inArray(casinoBets.userId, nonCommissionPlayerIds),
              inArray(casinoBets.status, ['won', 'lost'])
            )
          )
          .groupBy(casinoBets.userId),
        db
          .select({
            userId: matkaBets.userId,
            ggr: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`,
            pl: sql<number>`COALESCE(SUM(COALESCE(${matkaBets.actualWin}::numeric, 0) - ${matkaBets.betAmount}::numeric), 0)`,
          })
          .from(matkaBets)
          .where(
            and(
              eq(matkaBets.tenant, tenant),
              inArray(matkaBets.userId, nonCommissionPlayerIds),
              inArray(matkaBets.status, ['won', 'lost'])
            )
          )
          .groupBy(matkaBets.userId),
      ]);

      // Combine results
      const ggrMap = new Map<number, { ggr: number; pl: number }>();
      
      for (const row of sportsGGRResults) {
        const existing = ggrMap.get(row.userId) || { ggr: 0, pl: 0 };
        ggrMap.set(row.userId, {
          ggr: existing.ggr + Number(row.ggr || 0),
          pl: existing.pl + Number(row.pl || 0),
        });
      }

      for (const row of casinoGGRResults) {
        const existing = ggrMap.get(row.userId) || { ggr: 0, pl: 0 };
        ggrMap.set(row.userId, {
          ggr: existing.ggr + Number(row.ggr || 0),
          pl: existing.pl + Number(row.pl || 0),
        });
      }

      for (const row of matkaGGRResults) {
        const existing = ggrMap.get(row.userId) || { ggr: 0, pl: 0 };
        ggrMap.set(row.userId, {
          ggr: existing.ggr + Number(row.ggr || 0),
          pl: existing.pl + Number(row.pl || 0),
        });
      }

      // Update stats map
      for (const [userId, values] of ggrMap) {
        const stats = statsMap.get(userId);
        if (stats) {
          stats.ggr = values.ggr;
          stats.profitLoss = values.pl;
        }
      }
    } catch (error) {
    }
  }

  private async fetchPLTrend(
    playerIds: number[],
    tenant: string,
    statsMap: Map<number, PlayerListStats>,
    playerTypes?: Map<number, string>
  ): Promise<void> {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      if (playerIds.length === 0) return;
      const allCommission = playerTypes != null && playerIds.every(id => playerTypes.get(id) === 'COMMISSION_AGENT_PLAYER');

      const [sportsCurrent, sportsPrevious, casinoCurrent, casinoPrevious, matkaCurrent, matkaPrevious] =
        await Promise.all([
          db
            .select({
              userId: sportsBets.userId,
              ggr: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
            })
            .from(sportsBets)
            .where(
              and(
                eq(sportsBets.tenant, tenant),
                inArray(sportsBets.userId, playerIds),
                gte(sportsBets.createdAt, thirtyDaysAgo),
                lte(sportsBets.createdAt, now)
              )
            )
            .groupBy(sportsBets.userId),
          db
            .select({
              userId: sportsBets.userId,
              ggr: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
            })
            .from(sportsBets)
            .where(
              and(
                eq(sportsBets.tenant, tenant),
                inArray(sportsBets.userId, playerIds),
                gte(sportsBets.createdAt, sixtyDaysAgo),
                lte(sportsBets.createdAt, thirtyDaysAgo)
              )
            )
            .groupBy(sportsBets.userId),
          db
            .select({
              userId: casinoBets.userId,
              ggr: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.winAmount}, 0)::numeric), 0)`,
            })
            .from(casinoBets)
            .where(
              and(
                eq(casinoBets.tenant, tenant),
                inArray(casinoBets.userId, playerIds),
                gte(casinoBets.createdAt, thirtyDaysAgo),
                lte(casinoBets.createdAt, now)
              )
            )
            .groupBy(casinoBets.userId),
          db
            .select({
              userId: casinoBets.userId,
              ggr: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.winAmount}, 0)::numeric), 0)`,
            })
            .from(casinoBets)
            .where(
              and(
                eq(casinoBets.tenant, tenant),
                inArray(casinoBets.userId, playerIds),
                gte(casinoBets.createdAt, sixtyDaysAgo),
                lte(casinoBets.createdAt, thirtyDaysAgo)
              )
            )
            .groupBy(casinoBets.userId),
          db
            .select({
              userId: matkaBets.userId,
              ggr: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}, 0)::numeric), 0)`,
            })
            .from(matkaBets)
            .where(
              and(
                eq(matkaBets.tenant, tenant),
                inArray(matkaBets.userId, playerIds),
                gte(matkaBets.createdAt, thirtyDaysAgo),
                lte(matkaBets.createdAt, now)
              )
            )
            .groupBy(matkaBets.userId),
          db
            .select({
              userId: matkaBets.userId,
              ggr: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}, 0)::numeric), 0)`,
            })
            .from(matkaBets)
            .where(
              and(
                eq(matkaBets.tenant, tenant),
                inArray(matkaBets.userId, playerIds),
                gte(matkaBets.createdAt, sixtyDaysAgo),
                lte(matkaBets.createdAt, thirtyDaysAgo)
              )
            )
            .groupBy(matkaBets.userId),
        ]);

      const toMap = <T extends { userId: number }>(rows: T[], key: keyof T) =>
        new Map(rows.map((r) => [r.userId, Number((r as any)[key] ?? 0)]));
      const sportsCurrentMap = toMap(sportsCurrent, 'ggr');
      const sportsPrevMap = toMap(sportsPrevious, 'ggr');
      const casinoCurrentMap = toMap(casinoCurrent, 'ggr');
      const casinoPrevMap = toMap(casinoPrevious, 'ggr');
      const matkaCurrentMap = toMap(matkaCurrent, 'ggr');
      const matkaPrevMap = toMap(matkaPrevious, 'ggr');

      let depositCurrentMap = new Map<number, number>();
      let depositPrevMap = new Map<number, number>();
      let withdrawalCurrentMap = new Map<number, number>();
      let withdrawalPrevMap = new Map<number, number>();
      let manualDepCurrent = new Map<number, number>();
      let manualDepPrev = new Map<number, number>();
      let manualWithCurrent = new Map<number, number>();
      let manualWithPrev = new Map<number, number>();

      if (!allCommission) {
        const regularIds = playerTypes
          ? playerIds.filter(id => playerTypes.get(id) !== 'COMMISSION_AGENT_PLAYER')
          : playerIds;

        if (regularIds.length > 0) {
          // 30/60-day deposit & withdrawal totals bucket by the date money actually moved
          // (admin approval), not the request date.
          const depSettledAt = settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt);
          const wdSettledAt = settlementDateExpr(withdrawalRequests.reviewedAt, withdrawalRequests.createdAt);
          const [depCur, depPrev, withCur, withPrev] = await Promise.all([
            db.select({ userId: depositRequests.userId, total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)` })
              .from(depositRequests)
              .where(and(eq(depositRequests.tenant, tenant), inArray(depositRequests.userId, regularIds), eq(depositRequests.status, 'APPROVED' as any), gte(depSettledAt, thirtyDaysAgo), lte(depSettledAt, now)))
              .groupBy(depositRequests.userId),
            db.select({ userId: depositRequests.userId, total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)` })
              .from(depositRequests)
              .where(and(eq(depositRequests.tenant, tenant), inArray(depositRequests.userId, regularIds), eq(depositRequests.status, 'APPROVED' as any), gte(depSettledAt, sixtyDaysAgo), lte(depSettledAt, thirtyDaysAgo)))
              .groupBy(depositRequests.userId),
            db.select({ userId: withdrawalRequests.userId, total: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)` })
              .from(withdrawalRequests)
              .where(and(eq(withdrawalRequests.tenant, tenant), inArray(withdrawalRequests.userId, regularIds), eq(withdrawalRequests.status, 'COMPLETED' as any), gte(wdSettledAt, thirtyDaysAgo), lte(wdSettledAt, now)))
              .groupBy(withdrawalRequests.userId),
            db.select({ userId: withdrawalRequests.userId, total: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)` })
              .from(withdrawalRequests)
              .where(and(eq(withdrawalRequests.tenant, tenant), inArray(withdrawalRequests.userId, regularIds), eq(withdrawalRequests.status, 'COMPLETED' as any), gte(wdSettledAt, sixtyDaysAgo), lte(wdSettledAt, thirtyDaysAgo)))
              .groupBy(withdrawalRequests.userId),
          ]);
          depositCurrentMap = toMap(depCur, 'total');
          depositPrevMap = toMap(depPrev, 'total');
          withdrawalCurrentMap = toMap(withCur, 'total');
          withdrawalPrevMap = toMap(withPrev, 'total');

          const walletRows = await db.select({ userId: wallets.userId, walletId: wallets.id }).from(wallets).where(and(eq(wallets.tenant, tenant), inArray(wallets.userId, regularIds)));
          const walletIds = walletRows.map((r) => r.walletId);
          const walletUserMap = new Map(walletRows.map((r) => [r.walletId, r.userId]));
          if (walletIds.length > 0) {
            const [manDepCur, manDepPrv, manWithCur, manWithPrv] = await Promise.all([
              db.select({ walletId: ledgerEntries.walletId, total: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)` })
                .from(ledgerEntries).where(and(eq(ledgerEntries.tenant, tenant), inArray(ledgerEntries.walletId, walletIds), eq(ledgerEntries.type, 'credit'), sql`${ledgerEntries.meta} IS NOT NULL`, sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`, sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`, gte(ledgerEntries.createdAt, thirtyDaysAgo), lte(ledgerEntries.createdAt, now))).groupBy(ledgerEntries.walletId),
              db.select({ walletId: ledgerEntries.walletId, total: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)` })
                .from(ledgerEntries).where(and(eq(ledgerEntries.tenant, tenant), inArray(ledgerEntries.walletId, walletIds), eq(ledgerEntries.type, 'credit'), sql`${ledgerEntries.meta} IS NOT NULL`, sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`, sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`, gte(ledgerEntries.createdAt, sixtyDaysAgo), lte(ledgerEntries.createdAt, thirtyDaysAgo))).groupBy(ledgerEntries.walletId),
              db.select({ walletId: ledgerEntries.walletId, total: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)` })
                .from(ledgerEntries).where(and(eq(ledgerEntries.tenant, tenant), inArray(ledgerEntries.walletId, walletIds), eq(ledgerEntries.type, 'debit'), sql`${ledgerEntries.meta} IS NOT NULL`, sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`, gte(ledgerEntries.createdAt, thirtyDaysAgo), lte(ledgerEntries.createdAt, now))).groupBy(ledgerEntries.walletId),
              db.select({ walletId: ledgerEntries.walletId, total: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)` })
                .from(ledgerEntries).where(and(eq(ledgerEntries.tenant, tenant), inArray(ledgerEntries.walletId, walletIds), eq(ledgerEntries.type, 'debit'), sql`${ledgerEntries.meta} IS NOT NULL`, sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`, gte(ledgerEntries.createdAt, sixtyDaysAgo), lte(ledgerEntries.createdAt, thirtyDaysAgo))).groupBy(ledgerEntries.walletId),
            ]);
            for (const r of manDepCur) { const uid = walletUserMap.get(r.walletId); if (uid !== undefined) manualDepCurrent.set(uid, Number(r.total ?? 0)); }
            for (const r of manDepPrv) { const uid = walletUserMap.get(r.walletId); if (uid !== undefined) manualDepPrev.set(uid, Number(r.total ?? 0)); }
            for (const r of manWithCur) { const uid = walletUserMap.get(r.walletId); if (uid !== undefined) manualWithCurrent.set(uid, Number(r.total ?? 0)); }
            for (const r of manWithPrv) { const uid = walletUserMap.get(r.walletId); if (uid !== undefined) manualWithPrev.set(uid, Number(r.total ?? 0)); }
          }
        }
      }

      for (const playerId of playerIds) {
        const stats = statsMap.get(playerId);
        if (!stats) continue;
        const currentGGR =
          (sportsCurrentMap.get(playerId) ?? 0) +
          (casinoCurrentMap.get(playerId) ?? 0) +
          (matkaCurrentMap.get(playerId) ?? 0);
        const previousGGR =
          (sportsPrevMap.get(playerId) ?? 0) +
          (casinoPrevMap.get(playerId) ?? 0) +
          (matkaPrevMap.get(playerId) ?? 0);
        const currentDep =
          (depositCurrentMap.get(playerId) ?? 0) + (manualDepCurrent.get(playerId) ?? 0);
        const previousDep =
          (depositPrevMap.get(playerId) ?? 0) + (manualDepPrev.get(playerId) ?? 0);
        const currentWith =
          (withdrawalCurrentMap.get(playerId) ?? 0) + (manualWithCurrent.get(playerId) ?? 0);
        const previousWith =
          (withdrawalPrevMap.get(playerId) ?? 0) + (manualWithPrev.get(playerId) ?? 0);
        const currentPL = currentGGR - (currentDep - currentWith);
        const previousPL = previousGGR - (previousDep - previousWith);
        if (currentPL > previousPL) stats.plTrend = 'up';
        else if (currentPL < previousPL) stats.plTrend = 'down';
        else stats.plTrend = 'neutral';
      }
    } catch (error) {
    }
  }

  private async fetchCommissionInfo(
    playerIds: number[],
    tenant: string,
    statsMap: Map<number, PlayerListStats>,
    playerTypes: Map<number, string>
  ): Promise<void> {
    try {
      const commissionPlayerIds = playerIds.filter(id => playerTypes.get(id) === 'COMMISSION_AGENT_PLAYER');
      if (commissionPlayerIds.length === 0) return;

      const playersData = await db
        .select({ id: users.id, agentId: users.agentId })
        .from(users)
        .where(and(eq(users.tenant, tenant), inArray(users.id, commissionPlayerIds)));

      const playerAgentMap = new Map<number, string>();
      for (const p of playersData) {
        if (p.agentId) playerAgentMap.set(p.id, String(p.agentId));
      }

      const [sportsTurnoverRows, casinoTurnoverRows, matkaTurnoverRows] = await Promise.all([
        db
          .select({
            userId: sportsBets.userId,
            turnover: sql<number>`COALESCE(SUM(${sportsBets.liability})::numeric, 0)`,
          })
          .from(sportsBets)
          .where(and(eq(sportsBets.tenant, tenant), inArray(sportsBets.userId, commissionPlayerIds)))
          .groupBy(sportsBets.userId),
        db
          .select({
            userId: casinoBets.userId,
            turnover: sql<number>`COALESCE(SUM(${casinoBets.stake})::numeric, 0)`,
          })
          .from(casinoBets)
          .where(and(eq(casinoBets.tenant, tenant), inArray(casinoBets.userId, commissionPlayerIds)))
          .groupBy(casinoBets.userId),
        db
          .select({
            userId: matkaBets.userId,
            turnover: sql<number>`COALESCE(SUM(${matkaBets.betAmount})::numeric, 0)`,
          })
          .from(matkaBets)
          .where(and(eq(matkaBets.tenant, tenant), inArray(matkaBets.userId, commissionPlayerIds)))
          .groupBy(matkaBets.userId),
      ]);

      const turnoverByPlayer = new Map<number, number>();
      for (const r of sportsTurnoverRows) turnoverByPlayer.set(r.userId, (turnoverByPlayer.get(r.userId) ?? 0) + Number(r.turnover ?? 0));
      for (const r of casinoTurnoverRows) turnoverByPlayer.set(r.userId, (turnoverByPlayer.get(r.userId) ?? 0) + Number(r.turnover ?? 0));
      for (const r of matkaTurnoverRows) turnoverByPlayer.set(r.userId, (turnoverByPlayer.get(r.userId) ?? 0) + Number(r.turnover ?? 0));

      const uniqueAgentIds = [...new Set(playerAgentMap.values())];
      const { AgentLedgerRepo } = await import('../../../repos/agents/AgentLedgerRepo');
      const ledgerRepo = new AgentLedgerRepo();
      const ledgerByAgent = new Map<string, { lineType: string; refKey: string | null; amount: string; createdAt: Date | string }[]>();
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const allLedgerEntries = await ledgerRepo.listBatch(uniqueAgentIds, sixtyDaysAgo, now);
      for (const entry of allLedgerEntries) {
        const agentId = (entry as any).agentId as string;
        if (!ledgerByAgent.has(agentId)) ledgerByAgent.set(agentId, []);
        ledgerByAgent.get(agentId)!.push(entry as any);
      }

      for (const playerId of commissionPlayerIds) {
        const stats = statsMap.get(playerId);
        if (!stats) continue;
        stats.turnover = turnoverByPlayer.get(playerId) ?? 0;
        const agentId = playerAgentMap.get(playerId);
        if (!agentId) {
          stats.commissionEarned = 0;
          stats.commissionTrend = null;
          continue;
        }
        const ledgerEntriesList = ledgerByAgent.get(agentId) ?? [];
        const playerCommissionEntries = ledgerEntriesList.filter((e: any) => {
          if (e.lineType !== 'COMMISSION') return false;
          const refKey = e.refKey || '';
          return refKey.includes(`player_${playerId}`) || refKey.includes(`player${playerId}`);
        });
        stats.commissionEarned = playerCommissionEntries.reduce((sum: number, e: any) => sum + Number(e.amount), 0);
        const currentCommission = playerCommissionEntries
          .filter((e: any) => {
            const d = new Date(e.createdAt);
            return d >= thirtyDaysAgo && d < now;
          })
          .reduce((sum: number, e: any) => sum + Number(e.amount), 0);
        const previousCommission = playerCommissionEntries
          .filter((e: any) => {
            const d = new Date(e.createdAt);
            return d >= sixtyDaysAgo && d < thirtyDaysAgo;
          })
          .reduce((sum: number, e: any) => sum + Number(e.amount), 0);
        if (currentCommission > previousCommission) stats.commissionTrend = 'up';
        else if (currentCommission < previousCommission) stats.commissionTrend = 'down';
        else stats.commissionTrend = 'neutral';
      }
    } catch (error) {
    }
  }
}

