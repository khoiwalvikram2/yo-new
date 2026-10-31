import { db } from '@/db/client.js';
import { users, wallets, ledgerEntries, sportsBets, casinoBets, matkaBets, agents, agentCredentials, casinoGames, depositRequests } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, desc, inArray } from 'drizzle-orm';
import { settlementDateExpr } from '@src/shared/reportingSql.js';

interface DateRangeFilter {
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Get top performers across different categories.
 * All monetary amounts from bet/deposit tables are already in the whitelabel currency.
 * @param whitelabelId - Optional; when set (e.g. Director in whitelabel mode), bet tables are filtered by whitelabelId for correct scoping.
 */
export async function getTopPerformers(tenant: string, filter?: DateRangeFilter, limit: number = 10, whitelabelId?: string | null) {
  try {
    const dateFrom = filter?.dateFrom ? new Date(filter.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = filter?.dateTo ? new Date(filter.dateTo) : new Date();

    const [
      topDepositors,
      topProfitablePlayers,
      topLossMakingPlayers,
      topAgents,
      topGames,
    ] = await Promise.all([
      getTopDepositors(tenant, dateFrom, dateTo, limit),
      getTopProfitablePlayers(tenant, dateFrom, dateTo, limit, whitelabelId ?? undefined),
      getTopLossMakingPlayers(tenant, dateFrom, dateTo, limit),
      getTopAgents(tenant, dateFrom, dateTo, limit),
      getTopGames(tenant, dateFrom, dateTo, limit),
    ]);

    return {
      topDepositors,
      topProfitablePlayers,
      topLossMakingPlayers,
      topAgents,
      topGames,
    };
  } catch (error: any) {
    return {
      topDepositors: [],
      topProfitablePlayers: [],
      topLossMakingPlayers: [],
      topAgents: [],
      topGames: [],
    };
  }
}

/**
 * Get top depositors - combines direct deposits (deposit_requests) + manual deposits (ledger_entries)
 */
async function getTopDepositors(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date, 
  limit: number, 
) {
  try {
    const directResults = await db
      .select({
        userId: depositRequests.userId,
        total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.tenant, tenant),
          eq(depositRequests.status, 'APPROVED' as any),
          gte(settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt), dateFrom),
          lte(settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt), dateTo)
        )
      )
      .groupBy(depositRequests.userId);

    const manualResults = await db
      .select({
        userId: wallets.userId,
        total: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
      })
      .from(ledgerEntries)
      .innerJoin(wallets, eq(ledgerEntries.walletId, wallets.id))
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
      )
      .groupBy(wallets.userId);

    const depositMap = new Map<number, number>();
    for (const r of directResults) {
      depositMap.set(r.userId, (depositMap.get(r.userId) || 0) + Number(r.total || 0));
    }
    for (const r of manualResults) {
      depositMap.set(r.userId, (depositMap.get(r.userId) || 0) + Number(r.total || 0));
    }

    if (depositMap.size === 0) return [];

    const userIds = Array.from(depositMap.keys());
    const userRows = await db
      .select({ id: users.id, username: users.username, name: users.name, phone: users.phone })
      .from(users)
      .where(inArray(users.id, userIds));

    const userMap = new Map(userRows.map(u => [u.id, u]));

    return Array.from(depositMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([userId, total], index) => {
        const user = userMap.get(userId);
        return {
          playerId: String(userId),
          playerName: String(user?.name || user?.username || 'Unknown'),
          username: String(user?.username || 'Unknown'),
          phone: user?.phone ? String(user.phone) : null,
          value: total,
          rank: index + 1,
          trend: 'up',
        };
      });
  } catch (error: any) {
    return [];
  }
}

/**
 * Get top profitable players (highest GGR contributors).
 * Uses separate per-product GGR queries and merges in JS to avoid Drizzle subquery join issues.
 * Bet tables are scoped by whitelabelId when provided (matches DB where tenant may be 'default');
 * otherwise by tenant.
 */
async function getTopProfitablePlayers(
  tenant: string,
  dateFrom: Date,
  dateTo: Date,
  limit: number,
  whitelabelId?: string,
) {
  try {
    const scopeSports = whitelabelId ? eq(sportsBets.whitelabelId, whitelabelId) : eq(sportsBets.tenant, tenant);
    const sportsConditions = and(
      scopeSports,
      gte(sportsBets.createdAt, dateFrom),
      lte(sportsBets.createdAt, dateTo),
      inArray(sportsBets.status, ['won', 'lost', 'settled']),
    );

    const scopeCasino = whitelabelId ? eq(casinoBets.whitelabelId, whitelabelId) : eq(casinoBets.tenant, tenant);
    const casinoConditions = and(
      scopeCasino,
      gte(casinoBets.createdAt, dateFrom),
      lte(casinoBets.createdAt, dateTo),
      inArray(casinoBets.status, ['won', 'lost']),
    );

    const scopeMatka = whitelabelId ? eq(matkaBets.whitelabelId, whitelabelId) : eq(matkaBets.tenant, tenant);
    const matkaConditions = and(
      scopeMatka,
      gte(matkaBets.createdAt, dateFrom),
      lte(matkaBets.createdAt, dateTo),
      inArray(matkaBets.status, ['won', 'lost'] as any),
    );

    const [sportsRows, casinoRows, matkaRows] = await Promise.all([
      db
        .select({
          userId: sportsBets.userId,
          ggr: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -(${sportsBets.pl}::numeric) ELSE 0 END), 0)`.as('ggr'),
        })
        .from(sportsBets)
        .where(sportsConditions)
        .groupBy(sportsBets.userId),
      db
        .select({
          userId: casinoBets.userId,
          ggr: sql<number>`COALESCE(SUM((${casinoBets.stake}::numeric) - (${casinoBets.winAmount}::numeric)), 0)`.as('ggr'),
        })
        .from(casinoBets)
        .where(casinoConditions)
        .groupBy(casinoBets.userId),
      db
        .select({
          userId: matkaBets.userId,
          ggr: sql<number>`COALESCE(SUM((${matkaBets.betAmount}::numeric) - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`.as('ggr'),
        })
        .from(matkaBets)
        .where(matkaConditions)
        .groupBy(matkaBets.userId),
    ]);

    const ggrByUser = new Map<number, number>();
    for (const r of sportsRows) {
      const id = r.userId;
      ggrByUser.set(id, (ggrByUser.get(id) ?? 0) + Number(r.ggr ?? 0));
    }
    for (const r of casinoRows) {
      const id = r.userId;
      ggrByUser.set(id, (ggrByUser.get(id) ?? 0) + Number(r.ggr ?? 0));
    }
    for (const r of matkaRows) {
      const id = r.userId;
      ggrByUser.set(id, (ggrByUser.get(id) ?? 0) + Number(r.ggr ?? 0));
    }

    const topUserIds = Array.from(ggrByUser.entries())
      .filter(([, ggr]) => ggr > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([userId]) => userId);

    if (topUserIds.length === 0) return [];

    const userWhere = whitelabelId
      ? inArray(users.id, topUserIds)
      : and(eq(users.tenant, tenant), inArray(users.id, topUserIds));
    const userRows = await db
      .select({ id: users.id, username: users.username, name: users.name, phone: users.phone })
      .from(users)
      .where(userWhere);

    const userMap = new Map(userRows.map((u) => [u.id, u]));

    return topUserIds.map((userId, index) => {
      const u = userMap.get(userId);
      return {
        playerId: String(userId),
        playerName: String(u?.name || u?.username || 'Unknown'),
        username: String(u?.username ?? ''),
        phone: u?.phone ? String(u.phone) : null,
        value: ggrByUser.get(userId) ?? 0,
        rank: index + 1,
        trend: 'up' as const,
      };
    });
  } catch (error: unknown) {
    console.error('[getTopProfitablePlayers]', error);
    return [];
  }
}

/**
 * Get top loss-making players (highest losses, risk monitoring)
 */
async function getTopLossMakingPlayers(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date, 
  limit: number,
) {
  try {
    const results = await db
      .select({
        userId: users.id,
        username: users.username,
        name: users.name,
        phone: users.phone,
        totalLoss: sql<number>`
          COALESCE(
            (SELECT SUM(COALESCE(sb.pl::numeric, 0))
             FROM sports_bets sb
             WHERE sb.user_id = ${users.id}
             AND sb.tenant = ${tenant}
             AND sb.created_at >= ${dateFrom}
             AND sb.created_at <= ${dateTo}
             AND sb.status IN ('won', 'lost', 'half_won', 'half_lost')
             AND sb.pl IS NOT NULL), 0
          ) +
          COALESCE(
            (SELECT SUM(cb.win_amount::numeric - cb.stake::numeric)
             FROM casino_bets cb
             WHERE cb.user_id = ${users.id}
             AND cb.tenant = ${tenant}
             AND cb.created_at >= ${dateFrom}
             AND cb.created_at <= ${dateTo}
             AND cb.status IN ('won', 'lost')), 0
          ) +
          COALESCE(
            (SELECT SUM(COALESCE(mb.actual_win, 0)::numeric - mb.bet_amount::numeric)
             FROM matka_bets mb
             WHERE mb.user_id = ${users.id}
             AND mb.tenant = ${tenant}
             AND mb.created_at >= ${dateFrom}
             AND mb.created_at <= ${dateTo}
             AND mb.status IN ('won', 'lost')), 0
          )
        `,
      })
      .from(users)
      .where(eq(users.tenant, tenant))
      .orderBy(desc(sql`
        COALESCE(
          (SELECT SUM(CASE WHEN sb.status IN ('won', 'settled') THEN (CASE WHEN sb.odds_size IS NOT NULL AND sb.side = 'back' THEN (sb.stake::numeric + COALESCE(NULLIF(TRIM(COALESCE(sb.result, '')), '')::numeric, (sb.stake::numeric * COALESCE(NULLIF(sb.odds_size::numeric, 0), 100) / 100))) WHEN sb.odds_size IS NOT NULL AND sb.side = 'lay' THEN (sb.liability::numeric + sb.stake::numeric) WHEN sb.side = 'back' THEN COALESCE(NULLIF(TRIM(COALESCE(sb.result, '')), '')::numeric, sb.stake::numeric * COALESCE(sb.price::numeric, 0)) ELSE (sb.liability::numeric + sb.stake::numeric) END) ELSE 0 END - CASE WHEN sb.side = 'back' THEN sb.stake::numeric ELSE sb.liability::numeric END)
           FROM sports_bets sb
           WHERE sb.user_id = ${users.id}
           AND sb.tenant = ${tenant}
           AND sb.created_at >= ${dateFrom}
           AND sb.created_at <= ${dateTo}
           AND sb.status IN ('won', 'lost', 'half_won', 'half_lost')), 0
        ) +
        COALESCE(
          (SELECT SUM(cb.win_amount::numeric - cb.stake::numeric)
           FROM casino_bets cb
           WHERE cb.user_id = ${users.id}
           AND cb.tenant = ${tenant}
           AND cb.created_at >= ${dateFrom}
           AND cb.created_at <= ${dateTo}
           AND cb.status IN ('won', 'lost')), 0
        ) +
        COALESCE(
          (SELECT SUM(COALESCE(mb.actual_win, 0)::numeric - mb.bet_amount::numeric)
           FROM matka_bets mb
           WHERE mb.user_id = ${users.id}
           AND mb.tenant = ${tenant}
           AND mb.created_at >= ${dateFrom}
           AND mb.created_at <= ${dateTo}
           AND mb.status IN ('won', 'lost')), 0
        )
      `))
      .limit(limit);

    return results
      .filter(r => Number(r.totalLoss) > 0)
      .map((r, index) => ({
        playerId: String(r.userId),
        playerName: String(r.name || r.username),
        username: String(r.username),
        phone: r.phone ? String(r.phone) : null,
        value: Number(r.totalLoss || 0),
        rank: index + 1,
        trend: 'up',
      }));
  } catch (error: any) {
    return [];
  }
}

/**
 * Get top agents by revenue generated
 */
async function getTopAgents(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date, 
  limit: number,
) {
  try {
    const results = await db
      .select({
        agentId: agents.id,
        username: agentCredentials.username,
        name: agentCredentials.username,
        totalRevenue: sql<number>`
          COALESCE(
            (SELECT SUM(CASE WHEN sb.pl IS NOT NULL THEN -sb.pl::numeric ELSE 0 END)
             FROM sports_bets sb
             INNER JOIN users u ON sb.user_id = u.id
             WHERE u.agent_id = ${agents.id}
             AND sb.tenant = ${tenant}
             AND sb.created_at >= ${dateFrom}
             AND sb.created_at <= ${dateTo}
             AND sb.status IN ('won', 'lost', 'half_won', 'half_lost')
             AND sb.pl IS NOT NULL), 0
          ) +
          COALESCE(
            (SELECT SUM(cb.stake::numeric - cb.win_amount::numeric)
             FROM casino_bets cb
             INNER JOIN users u ON cb.user_id = u.id
             WHERE u.agent_id = ${agents.id}
             AND cb.tenant = ${tenant}
             AND cb.created_at >= ${dateFrom}
             AND cb.created_at <= ${dateTo}
             AND cb.status IN ('won', 'lost')), 0
          ) +
          COALESCE(
            (SELECT SUM(mb.bet_amount::numeric - COALESCE(mb.actual_win, 0)::numeric)
             FROM matka_bets mb
             INNER JOIN users u ON mb.user_id = u.id
             WHERE u.agent_id = ${agents.id}
             AND mb.tenant = ${tenant}
             AND mb.created_at >= ${dateFrom}
             AND mb.created_at <= ${dateTo}
             AND mb.status IN ('won', 'lost')), 0
          )
        `,
      })
      .from(agents)
      .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
      .where(eq(agents.tenantId, tenant))
      .orderBy(desc(sql`
        COALESCE(
          (SELECT SUM((CASE WHEN sb.side = 'back' THEN sb.stake::numeric ELSE sb.liability::numeric END) - CASE WHEN sb.status IN ('won', 'settled') THEN CASE WHEN sb.odds_size IS NOT NULL AND sb.side = 'back' THEN (sb.stake::numeric + COALESCE(NULLIF(TRIM(COALESCE(sb.result, '')), '')::numeric, (sb.stake::numeric * COALESCE(NULLIF(sb.odds_size::numeric, 0), 100) / 100))) WHEN sb.odds_size IS NOT NULL AND sb.side = 'lay' THEN (sb.liability::numeric + sb.stake::numeric) WHEN sb.side = 'back' THEN COALESCE(NULLIF(TRIM(COALESCE(sb.result, '')), '')::numeric, sb.stake::numeric * COALESCE(sb.price::numeric, 0)) ELSE (sb.liability::numeric + sb.stake::numeric) END ELSE 0 END))
           FROM sports_bets sb
           INNER JOIN users u ON sb.user_id = u.id
           WHERE u.agent_id = ${agents.id}
           AND sb.tenant = ${tenant}
           AND sb.created_at >= ${dateFrom}
           AND sb.created_at <= ${dateTo}
           AND sb.status IN ('won', 'lost', 'half_won', 'half_lost')), 0
        ) +
        COALESCE(
          (SELECT SUM(cb.stake::numeric - cb.win_amount::numeric)
           FROM casino_bets cb
           INNER JOIN users u ON cb.user_id = u.id
           WHERE u.agent_id = ${agents.id}
           AND cb.tenant = ${tenant}
           AND cb.created_at >= ${dateFrom}
           AND cb.created_at <= ${dateTo}
           AND cb.status IN ('won', 'lost')), 0
        ) +
        COALESCE(
          (SELECT SUM(mb.bet_amount::numeric - COALESCE(mb.actual_win, 0)::numeric)
           FROM matka_bets mb
           INNER JOIN users u ON mb.user_id = u.id
           WHERE u.agent_id = ${agents.id}
           AND mb.tenant = ${tenant}
           AND mb.created_at >= ${dateFrom}
           AND mb.created_at <= ${dateTo}
           AND mb.status IN ('won', 'lost')), 0
        )
      `))
      .limit(limit);

    return results.map((r, index) => ({
      agentId: String(r.agentId),
      agentName: String(r.name || r.username),
      username: String(r.username),
      value: Number(r.totalRevenue || 0),
      rank: index + 1,
      metric: 'revenue',
      trend: 'up',
    }));
  } catch (error: any) {
    return [];
  }
}

/**
 * Get top performing games by revenue
 */
async function getTopGames(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date, 
  limit: number,
) {
  try {
    const results = await db
      .select({
        gameId: casinoBets.gameId,
        gameName: casinoGames.name,
        gameType: casinoGames.mainCategory,
        revenue: sql<number>`SUM(${casinoBets.stake}::numeric - ${casinoBets.winAmount}::numeric)`,
        playCount: sql<number>`COUNT(*)::int`,
      })
      .from(casinoBets)
      .leftJoin(casinoGames, eq(casinoBets.gameId, casinoGames.id))
      .where(
        and(
          eq(casinoBets.tenant, tenant),
          inArray(casinoBets.status, ['won', 'lost']),
          gte(casinoBets.createdAt, dateFrom),
          lte(casinoBets.createdAt, dateTo)
        )
      )
      .groupBy(casinoBets.gameId, casinoGames.name, casinoGames.mainCategory)
      .orderBy(desc(sql`SUM(${casinoBets.stake}::numeric - ${casinoBets.winAmount}::numeric)`))
      .limit(limit);

    return results.map((r, index) => ({
      gameId: String(r.gameId),
      gameName: String(r.gameName || 'Unknown Game'),
      gameType: String(r.gameType || 'casino'),
      revenue: Number(r.revenue || 0),
      playCount: Number(r.playCount || 0),
      rank: index + 1,
    }));
  } catch (error: any) {
    return [];
  }
}
