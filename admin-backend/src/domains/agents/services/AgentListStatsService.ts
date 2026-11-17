import { db } from '@/db/client';
import { 
  users, 
  sportsBets,
  casinoBets,
  matkaBets,
  agents,
  agentCredentials,
} from '@shared/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { walkUnique } from './hierarchyWalk';
import { AgentSettlementsRepo } from '../../../repos/agents/AgentSettlementsRepo';
import { AgentLedgerRepo } from '../../../repos/agents/AgentLedgerRepo';
import { attributedAgentId, withReferralScope } from './commissionPlayerScope';
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js';
import { createCommissionReportCalculator } from '@src/domains/settlements/services/commissionReportCalculator.js';
import { readAgentListHierarchy, readAgentListPayments, readAgentListGgr, readAgentListTurnover } from './agentListStatsReads.js';
import { chipService } from './ChipService.js';

/**
 * The agent list's player sets (getPlayersByAgents), from rows of (the one agent
 * a player belongs to, player id): each listed agent gets its own players plus
 * those of every agent in its subtree (`subtreeOf`, sub-agents only), each player
 * once, in first-seen order.
 */
export function assignPlayersToAgents(
  rows: ReadonlyArray<{ agentId: string | null | undefined; playerId: number }>,
  agentIds: readonly string[],
  subtreeOf: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, number[]> {
  const sets = new Map<string, Set<number>>();
  for (const agentId of agentIds) sets.set(agentId, new Set());
  for (const row of rows) {
    if (!row.agentId) continue;
    const owner = String(row.agentId);
    sets.get(owner)?.add(row.playerId);
    for (const [ancestorId, subtree] of subtreeOf) {
      if (ancestorId !== owner && subtree.has(owner)) sets.get(ancestorId)?.add(row.playerId);
    }
  }
  return new Map([...sets].map(([agentId, players]) => [agentId, [...players]]));
}

export interface PlByDomain {
  sports: number;
  casino: number;
  matka: number;
}

interface AgentListStats {
  // Common for all scheme types
  activePlayers: number;
  lastLogin: string | null;
  daysSinceLastBet: number | null;
  
  // For SHARING and CREDIT agents
  totalDeposits: number | null;
  totalWithdrawals: number | null;
  ggr: number | null;
  totalExposure: number | null;
  profitLoss: number | null;
  plByDomain: PlByDomain | null;
  plTrend: 'up' | 'down' | 'neutral' | null;
  betCount: number | null;
  pendingSettlement: number | null;
  totalSettled: number | null;
  lastSettlementDate: string | null;
  
  // For COMMISSION agents
  turnover: number | null;
  commissionEarned: number | null;
  commissionTrend: 'up' | 'down' | 'neutral' | null;
}

export class AgentListStatsService {
  private agentsRepo: AgentsRepo;
  private settlementsRepo: AgentSettlementsRepo;
  private ledgerRepo: AgentLedgerRepo;
  /** Lazily created; see fetchSettlementInfo (SHARING pending). */
  private sharingEngine: import('./SharingSettlementEngine').SharingSettlementEngine | null = null;

  constructor() {
    this.agentsRepo = new AgentsRepo();
    this.settlementsRepo = new AgentSettlementsRepo();
    this.ledgerRepo = new AgentLedgerRepo();
  }

  async getStatsForAgents(
    agentIds: string[],
    tenant: string,
    dateRange?: { from?: Date; to?: Date }
  ): Promise<Map<string, AgentListStats>> {
    if (agentIds.length === 0) {
      return new Map();
    }

    const statsMap = new Map<string, AgentListStats>();
    for (const agentId of agentIds) {
      statsMap.set(agentId, this.getDefaultStats());
    }

    // Resolve player IDs once (includes drill-down: direct + sub-agent players) and reuse across fetchers
    const playersByAgent = await this.getPlayersByAgents(agentIds, tenant);

    await Promise.all([
      this.fetchPlayerCounts(agentIds, tenant, statsMap, playersByAgent),
      this.fetchLastLogin(agentIds, statsMap),
      this.fetchLastBetInfoBatched(playersByAgent, statsMap, tenant),
      this.fetchDepositsWithdrawals(agentIds, tenant, statsMap, playersByAgent),
      this.fetchGGRAndExposure(agentIds, tenant, statsMap, dateRange, playersByAgent),
      this.fetchSettlementInfo(agentIds, statsMap, tenant),
      this.fetchCommissionInfo(agentIds, tenant, statsMap, dateRange, playersByAgent),
      this.fetchPLTrend(agentIds, statsMap),
    ]);

    return statsMap;
  }

  private getDefaultStats(): AgentListStats {
    return {
      activePlayers: 0,
      lastLogin: null,
      daysSinceLastBet: null,
      totalDeposits: null,
      totalWithdrawals: null,
      ggr: null,
      totalExposure: null,
      profitLoss: null,
      plByDomain: null,
      plTrend: null,
      betCount: null,
      pendingSettlement: null,
      totalSettled: null,
      lastSettlementDate: null,
      turnover: null,
      commissionEarned: null,
      commissionTrend: null,
    };
  }

  /** Player count = drill-down (direct + sub-agent players), active only. Uses playersByAgent from getPlayersByAgents. */
  private async fetchPlayerCounts(
    agentIds: string[],
    tenant: string,
    statsMap: Map<string, AgentListStats>,
    playersByAgent: Map<string, number[]>
  ): Promise<void> {
    try {
      const allPlayerIds = [...new Set([...playersByAgent.values()].flat())];
      if (allPlayerIds.length === 0) return;

      const activeRows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenant, tenant),
            inArray(users.id, allPlayerIds),
            eq(users.status, 'active')
          )
        );
      const activeIdSet = new Set(activeRows.map((r) => r.id));

      for (const [agentId, playerIds] of playersByAgent) {
        const stats = statsMap.get(agentId);
        if (stats) {
          stats.activePlayers = playerIds.filter((id) => activeIdSet.has(id)).length;
        }
      }
    } catch (error) {
      console.error('[AgentListStatsService] fetchPlayerCounts failed:', error instanceof Error ? error.message : error);
    }
  }

  private async fetchLastLogin(
    agentIds: string[],
    statsMap: Map<string, AgentListStats>
  ): Promise<void> {
    if (agentIds.length === 0) return;
    const rows = await db
      .select({ agentId: agentCredentials.agentId, lastLoginAt: agentCredentials.lastLoginAt })
      .from(agentCredentials)
      .where(inArray(agentCredentials.agentId, agentIds));
    for (const row of rows) {
      const stats = statsMap.get(row.agentId);
      if (stats) {
        stats.lastLogin = row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null;
      }
    }
  }

  /** Batched version: 3 queries total (sports, casino, matka) then aggregate by agent. */
  private async fetchLastBetInfoBatched(
    playersByAgent: Map<string, number[]>,
    statsMap: Map<string, AgentListStats>,
    tenant: string
  ): Promise<void> {
    try {
      const allPlayerIds = [...new Set([...playersByAgent.values()].flat())];
      if (allPlayerIds.length === 0) return;

      const now = new Date();

      const [sportsRows, casinoRows, matkaRows] = await Promise.all([
        db
          .select({
            userId: sportsBets.userId,
            lastBet: sql<Date>`MAX(${sportsBets.createdAt})`,
            betCount: sql<number>`COUNT(*)::int`,
            exposure: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.status} = 'unmatched' OR ${sportsBets.status} = 'matched' THEN ${sportsBets.liability}::numeric ELSE 0 END), 0)`,
          })
          .from(sportsBets)
          .where(and(eq(sportsBets.tenant, tenant), inArray(sportsBets.userId, allPlayerIds)))
          .groupBy(sportsBets.userId),
        db
          .select({
            userId: casinoBets.userId,
            lastBet: sql<Date>`MAX(${casinoBets.createdAt})`,
            betCount: sql<number>`COUNT(*)::int`,
          })
          .from(casinoBets)
          .where(and(eq(casinoBets.tenant, tenant), inArray(casinoBets.userId, allPlayerIds)))
          .groupBy(casinoBets.userId),
        db
          .select({
            userId: matkaBets.userId,
            lastBet: sql<Date>`MAX(${matkaBets.createdAt})`,
            betCount: sql<number>`COUNT(*)::int`,
          })
          .from(matkaBets)
          .where(and(eq(matkaBets.tenant, tenant), inArray(matkaBets.userId, allPlayerIds)))
          .groupBy(matkaBets.userId),
      ]);

      const byUser = (rows: { userId: number; lastBet?: Date | null; betCount?: number; exposure?: number }[], key: 'lastBet' | 'betCount' | 'exposure') => {
        const m = new Map<number, number | Date>();
        for (const r of rows) {
          const v = key === 'lastBet' ? r.lastBet : (r as any)[key];
          if (v != null) m.set(r.userId, v as number | Date);
        }
        return m;
      };
      const sportsLastBet = byUser(sportsRows as any[], 'lastBet') as Map<number, Date>;
      const sportsBetCount = byUser(sportsRows as any[], 'betCount') as Map<number, number>;
      const sportsExposure = byUser(sportsRows as any[], 'exposure') as Map<number, number>;
      const casinoLastBet = byUser(casinoRows as any[], 'lastBet') as Map<number, Date>;
      const casinoBetCount = byUser(casinoRows as any[], 'betCount') as Map<number, number>;
      const matkaLastBet = byUser(matkaRows as any[], 'lastBet') as Map<number, Date>;
      const matkaBetCount = byUser(matkaRows as any[], 'betCount') as Map<number, number>;

      for (const [agentId, playerIds] of playersByAgent) {
        if (playerIds.length === 0) continue;
        const stats = statsMap.get(agentId);
        if (!stats) continue;

        let daysSinceLastBet: number | null = null;
        let betCount = 0;
        let totalExposure = 0;

        for (const pid of playerIds) {
          const sportsLast = sportsLastBet.get(pid);
          const casinoLast = casinoLastBet.get(pid);
          const matkaLast = matkaLastBet.get(pid);
          const lastDates = [sportsLast, casinoLast, matkaLast].filter(Boolean).map((d) => d instanceof Date ? d : new Date(d as unknown as string | number));
          if (lastDates.length > 0) {
            const latest = new Date(Math.max(...lastDates.map((d) => d.getTime())));
            const days = Math.floor((now.getTime() - latest.getTime()) / (1000 * 60 * 60 * 24));
            daysSinceLastBet = daysSinceLastBet === null ? days : Math.min(daysSinceLastBet, days);
          }
          betCount += Number(sportsBetCount.get(pid) || 0) + Number(casinoBetCount.get(pid) || 0) + Number(matkaBetCount.get(pid) || 0);
          totalExposure += Number(sportsExposure.get(pid) || 0);
        }

        if (daysSinceLastBet !== null) stats.daysSinceLastBet = daysSinceLastBet;
        stats.betCount = betCount;
        stats.totalExposure = totalExposure;
      }
    } catch (error) {
      console.error('[AgentListStatsService] fetchLastBetInfoBatched failed:', error instanceof Error ? error.message : error);
    }
  }

  // Helper to get player IDs mapped by agent
  // For SHARING agents, includes players from sub-agents (downline)
  private async getPlayersByAgents(agentIds: string[], tenant: string): Promise<Map<string, number[]>> {
    const agentPlayerMap = new Map<string, number[]>();
    
    // Initialize empty arrays for all agents
    for (const agentId of agentIds) {
      agentPlayerMap.set(agentId, []);
    }
    
    try {
      // Get agent types to determine if we need sub-agents
      const agentData = await readAgentListHierarchy(agentIds);
      
      const agentTypeMap = new Map(agentData.map(a => [a.id, a.schemeType]));
      
      // Helper to get all sub-agents recursively (excluding the root itself).
      // CR-12: cycle-safe — walkUnique threads a visited Set so a corrupt/re-parented
      // hierarchy (e.g. A->B & B->A) can't infinite-loop / stack-overflow. walkUnique
      // includes the root id as the first element, so we drop it to keep the original
      // "sub-agents only" contract.
      const getAllSubAgentIds = async (parentAgentId: string): Promise<string[]> => {
        const all = await walkUnique(parentAgentId, async (id) => {
          const subAgents = agentData.filter(row => row.parentAgentId === id);
          return subAgents.map((subAgent) => subAgent.id);
        });
        return all.slice(1);
      };
      
      // Build parent-child map and collect all agent IDs (direct + sub-agents)
      const allAgentIds = new Set<string>(agentIds);
      const parentChildMap = new Map<string, Set<string>>();
      for (const agentId of agentIds) {
        const schemeType = agentTypeMap.get(agentId);
        if (schemeType === 'SHARING' || schemeType === 'CREDIT' || schemeType === 'COMMISSION') {
          const subAgentIds = await getAllSubAgentIds(agentId);
          parentChildMap.set(agentId, new Set(subAgentIds));
          subAgentIds.forEach(id => allAgentIds.add(id));
        }
      }
      
      // Players of all these agents, by the same rule as the money paths
      // (commissionPlayerScope, decision 3): a player belongs to ONE agent,
      // COALESCE(users.agent_id, the agent of its confirmed referrer). Referral-
      // linked players used to be missing from the list stats (users.agent_id only).
      const playerRows = await withReferralScope(
        db
          .select({
            agentId: attributedAgentId,
            playerId: users.id,
          })
          .from(users),
        tenant
      ).where(
        and(
          eq(users.tenant, tenant),
          inArray(attributedAgentId, Array.from(allAgentIds))
        )
      );

      const assigned = assignPlayersToAgents(playerRows as Array<{ agentId: string | null; playerId: number }>, agentIds, parentChildMap);
      for (const [agentId, playerIds] of assigned) agentPlayerMap.set(agentId, playerIds);
    } catch (error) {
      console.error('[AgentListStatsService] getPlayersByAgents failed:', error instanceof Error ? error.message : error);
    }
    
    return agentPlayerMap;
  }

  private async fetchDepositsWithdrawals(
    _agentIds: string[], tenant: string, statsMap: Map<string, AgentListStats>, playersByAgent: Map<string, number[]>
  ): Promise<void> {
    try {
      if (![...playersByAgent.values()].some(ids => ids.length)) return;
      const payments = await readAgentListPayments(playersByAgent, tenant);
      for (const [id, amounts] of payments) {
        const stats = statsMap.get(id);
        if (stats) Object.assign(stats, amounts);
      }
    } catch (error) {
      console.error('[AgentListStatsService] fetchDepositsWithdrawals failed:', error instanceof Error ? error.message : error);
    }
  }

  private async fetchGGRAndExposure(
    agentIds: string[], tenant: string, statsMap: Map<string, AgentListStats>, dateRange?: { from?: Date; to?: Date }, playersByAgent?: Map<string, number[]>
  ): Promise<void> {
    try {
      const players = playersByAgent ?? await this.getPlayersByAgents(agentIds, tenant);
      if (![...players.values()].some(ids => ids.length)) return;
      const figures = await readAgentListGgr(players, tenant, dateRange);
      for (const [id, amounts] of figures) {
        const stats = statsMap.get(id);
        if (stats) Object.assign(stats, amounts);
      }
    } catch (error) {
      console.error('[AgentListStatsService] fetchGGRAndExposure failed:', error instanceof Error ? error.message : error);
    }
  }

  private async fetchSettlementInfo(
    agentIds: string[],
    statsMap: Map<string, AgentListStats>,
    tenant: string
  ): Promise<void> {
    try {
      const [agentRows, allSettlements] = await Promise.all([
        db.select().from(agents).where(inArray(agents.id, agentIds)),
        this.settlementsRepo.listBatch(agentIds, new Date(0), new Date()),
      ]);
      const byId = new Map(agentRows.map(row => [row.id, row]));
      // CREDIT agents settle on chips: what is pending is the size of their Ref P/L, the amount a Deposit or
      // Withdraw would move to bring them back to their credit reference (spec 2026-11-02 decision 8). One batch
      // read for every CREDIT agent of the page; settlement_balance is no longer written for them.
      const creditIds = agentRows.filter(row => row.schemeType === 'CREDIT').map(row => row.id);
      const chips = creditIds.length > 0 ? await chipService.chipAccountsForAgents(tenant, creditIds) : new Map();
      for (const agentId of agentIds) {
        const stats = statsMap.get(agentId);
        if (!stats) continue;

        // Get agent to check scheme type
        const agent = byId.get(agentId);
        if (!agent) continue;

        // Get all settlements for this agent
        const settlements = allSettlements.filter(row => row.agentId === agentId);

        if (settlements.length > 0) {
          // Total settled
          const completedSettlements = settlements.filter(s => s.status === 'POSTED');
          stats.totalSettled = completedSettlements.reduce(
            (sum, s) => sum + Number(s.totalAmount),
            0
          );

          // Last settlement date
          const lastSettlement = settlements.find(s => s.status === 'POSTED');
          if (lastSettlement && lastSettlement.periodTo) {
            stats.lastSettlementDate = lastSettlement.periodTo instanceof Date
              ? lastSettlement.periodTo.toISOString()
              : String(lastSettlement.periodTo);
          }
        }

        // CREDIT: |Ref P/L| from the chip figures (see above); its sign is on AgentAccount.chips.refPnl.
        if (agent.schemeType === 'CREDIT') {
          const refPnl = chips.get(String(agentId).toLowerCase())?.refPnl ?? 0;
          stats.pendingSettlement = Math.abs(refPnl);
        } else if (agent.schemeType === 'SHARING') {
          // SHARING: what is still owed for the open settlement window, from the
          // settlement engine — the same window and maths the settle mutation posts.
          // Signed like the SHARE lines: positive = TO_AGENT (the agent is paid),
          // negative = FROM_AGENT. (This used to sum settlements with status
          // 'PENDING', a status no settlement ever has, so it was always 0 and the
          // agent list's Settle Now stayed disabled.)
          try {
            if (!this.sharingEngine) {
              const { createSharingSettlementEngine } = await import('./sharingSettlementWiring');
              this.sharingEngine = createSharingSettlementEngine();
            }
            const pending = await this.sharingEngine.pending(agent as any);
            stats.pendingSettlement = pending.remaining;
          } catch (err) {
            console.error('[AgentListStatsService] SHARING pending failed:', err instanceof Error ? err.message : err);
            stats.pendingSettlement = null;
          }
        } else {
          stats.pendingSettlement = 0;
        }
      }
    } catch (error) {
      console.error('[AgentListStatsService] fetchSettlementInfo failed:', error instanceof Error ? error.message : error);
    }
  }

  private async fetchCommissionInfo(
    agentIds: string[], tenant: string, statsMap: Map<string, AgentListStats>, dateRange: { from?: Date; to?: Date } | undefined, playersByAgent: Map<string, number[]>
  ): Promise<void> {
    const periodFrom = dateRange?.from ?? new Date(0);
    const periodTo = dateRange?.to ?? new Date();
    await Promise.all([
      (async () => {
        try {
          const rows = await this.agentsRepo.list(tenant);
          const selected = new Set(agentIds);
          const commissionRows = rows.filter(row => selected.has(row.id) && row.schemeType === 'COMMISSION');
          if (!commissionRows.length) return;
          const currency = await getWhitelabelCurrency(tenant).catch(() => 'USD');
          const service = await createCommissionReportCalculator(tenant, rows);
          // Same cycle, rate, net, tally and carry maths. Only calculatedTotal is
          // displayed here; posted-ledger and payout calculations are not needed.
          await Promise.all(commissionRows.map(async row => {
            try {
              const summary = await service.calculateCommissionSummary(row.id, periodFrom, periodTo, currency, 'net');
              const stats = statsMap.get(row.id);
              if (stats) stats.commissionEarned = summary.effectiveCalculatedTotal;
            } catch (error) {
              console.error('[AgentListStatsService] commission summary failed:', error instanceof Error ? error.message : error);
            }
          }));
        } catch (error) {
          console.error('[AgentListStatsService] fetchCommissionInfo failed:', error instanceof Error ? error.message : error);
        }
      })(),
      (async () => {
        try {
          const turnover = [...playersByAgent.values()].some(ids => ids.length)
            ? await readAgentListTurnover(playersByAgent, tenant) : new Map<string, number>();
          for (const id of agentIds) {
            const stats = statsMap.get(id);
            if (stats) stats.turnover = turnover.get(id) ?? 0;
          }
        } catch (error) {
          for (const id of agentIds) { const stats = statsMap.get(id); if (stats) stats.turnover = 0; }
        }
      })(),
    ]);
  }

  private async fetchPLTrend(
    agentIds: string[],
    statsMap: Map<string, AgentListStats>
  ): Promise<void> {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      const [currentEntries, previousEntries] = await Promise.all([
        this.ledgerRepo.listBatch(agentIds, thirtyDaysAgo, now),
        this.ledgerRepo.listBatch(agentIds, sixtyDaysAgo, thirtyDaysAgo),
      ]);
      for (const agentId of agentIds) {
        const stats = statsMap.get(agentId);
        if (!stats) continue;

        // Get ledger entries for this period and previous period
        const currentPeriodEntries = currentEntries.filter(row => row.agentId === agentId);

        const previousPeriodEntries = previousEntries.filter(row => row.agentId === agentId);

        const currentPL = currentPeriodEntries.reduce((sum, e) => sum + Number(e.amount), 0);
        const previousPL = previousPeriodEntries.reduce((sum, e) => sum + Number(e.amount), 0);

        if (currentPL > previousPL) {
          stats.plTrend = 'up';
        } else if (currentPL < previousPL) {
          stats.plTrend = 'down';
        } else {
          stats.plTrend = 'neutral';
        }

        // Commission trend (same logic)
        const currentCommission = currentPeriodEntries
          .filter(e => e.lineType === 'COMMISSION')
          .reduce((sum, e) => sum + Number(e.amount), 0);
        const previousCommission = previousPeriodEntries
          .filter(e => e.lineType === 'COMMISSION')
          .reduce((sum, e) => sum + Number(e.amount), 0);

        if (currentCommission > previousCommission) {
          stats.commissionTrend = 'up';
        } else if (currentCommission < previousCommission) {
          stats.commissionTrend = 'down';
        } else {
          stats.commissionTrend = 'neutral';
        }
      }
    } catch (error) {
      console.error('[AgentListStatsService] fetchPLTrend failed:', error instanceof Error ? error.message : error);
    }
  }
}

