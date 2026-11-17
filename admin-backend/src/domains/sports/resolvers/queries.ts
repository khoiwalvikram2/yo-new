import {
  fetchMarkets,
  fetchEventsSummary,
  fetchEventDetail,
} from "@src/domains/sports/adapters/sportsApi.js";
import type { GraphQLResolveInfo } from 'graphql';
import { readSportsBetEnrichment, sportsBetEnrichmentFields } from '@src/domains/sports/services/sportsBetEnrichment.js';
import { listRiskLimits, listExposurePoints } from "@src/stores/index.js";
import { getSportSettings } from "@src/repos/sports/sportsSettingsRepo.js";
import { getLeagueSettings } from "@src/repos/sports/leagueSettingsRepo.js";
import { getEventSettings } from "@src/repos/sports/eventSettingsRepo.js";
import { getRiskConfig } from "@src/repos/sports/riskConfigRepo.js";
import { hasPermission } from "@src/domains/common/auth.js";
import {
  listSports,
  listExistingLeagueCodes,
  listExistingEventCodesByLeagueCode,
  listAutoRuns,
  getSportById,
} from "@src/repos/sports/sportsRepo.js";
import { db } from "@src/db/client.js";
import { searchSportsHierarchy } from "@src/repos/sports/sportsSearchRepo.js";
import {
  getLeaguesWithOpenBets,
  getEventsWithOpenBets,
  getMarketsWithOpenBets,
  type OpenBetsScope,
} from "@src/repos/sports/sportsBetsRepo.js";
import {
  sportsAutoConfigsTable,
  sportsLeaguesTable,
  sportsEventsTable,
  sportsMarketsTable,
  sportsRunnersTable,
  sportsTable,
} from "@shared/db/schema.js";
import { and, eq, or, inArray } from "drizzle-orm";
import { users } from "@src/db/schema.js";
import { getEffectiveTenantForDirector } from "@src/domains/common/directorModeUtils.js";
import { getSportsAdapters } from "@src/adapters/sportsRegistry.js";
import { sql } from "drizzle-orm";
import { sportsBets as sportsBetsTable } from "@shared/db/schema.js";
import { inAgentPlayers, agentPlayerIdsSubquery } from "@src/repos/reporting/agentPlayerScope.js";

import { sportsResultReadScope } from '@src/domains/sports/services/resultReadScope.js';

interface AgentEventTotals {
  matchedVolume: number;
  totalLiquidity: number;
  betsCount: number;
  lastBetAt: string | null;
}

/**
 * Open-book totals per event over an agent's own players (subtree + referral,
 * agentPlayerScope.ts), using the same definitions as getRunningEvents:
 * matched volume = liability of matched bets, exposure = liability of matched
 * and unmatched bets, bet count = open bets, admin-tool bets excluded. Only
 * events where the agent's players have open bets are returned.
 */
export async function agentOpenEventTotals(
  agentId: string,
  tenant: string,
  whitelabelId: string,
  eventIds?: string[],
): Promise<Map<string, AgentEventTotals>> {
  const t = sportsBetsTable;
  const rows = await db
    .select({
      eventId: t.eventId,
      matchedVolume: sql<number>`COALESCE(SUM(CASE WHEN ${t.status} = 'matched' THEN ${t.liability}::numeric ELSE 0 END), 0)`,
      totalLiquidity: sql<number>`COALESCE(SUM(${t.liability}::numeric), 0)`,
      betsCount: sql<number>`COUNT(*)::int`,
    })
    .from(t)
    .where(
      and(
        eq(t.whitelabelId, whitelabelId),
        eq(t.tenant, tenant),
        or(eq(t.status, 'matched'), eq(t.status, 'unmatched')),
        eq(t.excludeFromAdminRunning, false),
        inAgentPlayers(t.userId, agentId, tenant),
        eventIds && eventIds.length > 0 ? inArray(t.eventId, eventIds) : undefined,
      ),
    )
    .groupBy(t.eventId);

  const out = new Map<string, AgentEventTotals>();
  for (const r of rows) {
    out.set(String(r.eventId), {
      matchedVolume: Number(r.matchedVolume) || 0,
      totalLiquidity: Number(r.totalLiquidity) || 0,
      betsCount: Number(r.betsCount) || 0,
      lastBetAt: null,
    });
  }
  if (out.size === 0) return out;

  // Last bet placed by the agent's players on each event (any status), as the
  // whitelabel list reports the last bet of anyone.
  const last = await db
    .select({ eventId: t.eventId, lastBetAt: sql<Date | null>`MAX(${t.createdAt})` })
    .from(t)
    .where(
      and(
        eq(t.whitelabelId, whitelabelId),
        inArray(t.eventId, [...out.keys()]),
        inAgentPlayers(t.userId, agentId, tenant),
      ),
    )
    .groupBy(t.eventId);
  for (const r of last) {
    const entry = out.get(String(r.eventId));
    if (entry && r.lastBetAt) entry.lastBetAt = new Date(r.lastBetAt).toISOString();
  }
  return out;
}

/**
 * Whose open bets the declare-result pickers (leagues/events/marketsWithOpenBets) list: the reach of the
 * declaration itself. A platform administrator outside whitelabel mode declares a global result
 * (createSportsResult) and sees every whitelabel's open bets (undefined: no scope). Anyone else settles
 * only their own whitelabel, so sees only its open bets, and an agent only its own players' (null: an agent
 * session with no agent id sees none). The pickers read every whitelabel's bets before, so another brand,
 * or any agent, learned where a brand's players held open bets, and a declaration there settled nothing.
 */
function openBetsScope(ctx: any): OpenBetsScope | undefined | null {
  if (hasPermission(ctx?.permissions ?? [], 'all', '*') && ctx?.directorMode !== 'whitelabel') return undefined;
  const tenant = ctx?.tenant || 'default';
  const whitelabelId = ctx?.whitelabel?.id || 'default';
  if (ctx?.user?.type === 'agent') {
    const agentId = ctx?.user?.agentId ? String(ctx.user.agentId) : '';
    return agentId ? { tenant, whitelabelId, agentId } : null;
  }
  return { tenant, whitelabelId };
}

/** Whether an agent may look at one player: the player is in its subtree or referral-linked to it. */
async function agentMayViewPlayer(agentId: string, tenant: string, userId: number): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 AS ok WHERE ${userId} IN ${agentPlayerIdsSubquery(agentId, tenant)}`,
  );
  const list: any[] = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
  return list.length > 0;
}

export const sportsQueryResolvers = {
  markets: async (_: any, args: any, ctx: any) => {
    // If marketId is provided, fetch from database directly
    if (args.marketId) {
      const wl = ctx?.whitelabel?.id as string;
      if (!wl) return [];
      
      // MarketId is UUID, compare as string
      const marketIdStr = String(args.marketId);
      
      const rows = await db
        .select({
          id: sportsMarketsTable.id,
          name: sportsMarketsTable.name,
          eventId: sportsMarketsTable.eventId,
          type: sportsMarketsTable.type,
          status: sportsMarketsTable.status,
          updatedAt: sportsMarketsTable.updatedAt,
        })
        .from(sportsMarketsTable)
        .where(
          eq(sportsMarketsTable.id, marketIdStr)
        )
        .limit(1);
      
      if (rows.length === 0) return [];
      
      // Get event info for the market
      const eventRow = rows[0].eventId ? await db
        .select({
          sportName: sportsTable.name,
          leagueName: sportsLeaguesTable.name,
          eventName: sportsEventsTable.name,
        })
        .from(sportsEventsTable)
        .innerJoin(sportsLeaguesTable, eq(sportsEventsTable.leagueId, sportsLeaguesTable.id))
        .innerJoin(sportsTable, eq(sportsLeaguesTable.sportId, sportsTable.id))
        .where(eq(sportsEventsTable.id, rows[0].eventId))
        .limit(1) : null;
      
      const market = rows[0];
      const event = eventRow?.[0];
      
      // Map to Market format
      const marketType = market.type || 'match_odds';
      const marketKind = (marketType === 'fancy' ? 'fancy' : marketType === 'bookmaker' ? 'bookmaker' : 'exchange') as 'exchange' | 'bookmaker' | 'fancy';
      
      return [{
        id: String(market.id),
        sport: event?.sportName || 'Unknown',
        competition: event?.leagueName || 'Unknown',
        event: event?.eventName || 'Unknown',
        name: String(market.name),
        eventId: String(market.eventId),
        state: market.status === 'active' ? 'open' : 'suspended',
        kind: marketKind,
        type: marketType, // Add type field for compatibility
        liquidity: 0,
        unmatchedOrders: 0,
        cutoffAt: market.updatedAt?.toISOString() || new Date().toISOString(),
        tickSize: 0.01,
        createdBy: 'system',
        updatedAt: market.updatedAt?.toISOString() || new Date().toISOString(),
        runners: [],
      }];
    }
    
    // Otherwise use the existing fetchMarkets (for other filters)
    const data = await fetchMarkets({
      state: args.state,
      sport: args.sport,
      from: args.from,
      to: args.to,
      marketId: args.marketId,
      whitelabelId: ctx?.whitelabel?.id,
    });
    return data;
  },
  // Event-centric running markets views
  runningEvents: async (_: any, args: any, ctx: any) => {
    const whitelabelId = ctx?.whitelabel?.id as string;
    const tenant = ctx?.tenant || "default";
    if (!whitelabelId) {
      return [];
    }
    
    // An agent sees only events its players have open bets on, and — new — the
    // volume, exposure and bet count of ITS players on them. The list was
    // filtered before, but every total on it was the whole whitelabel's.
    if (ctx?.user?.type === 'agent') {
      const agentId = ctx?.user?.agentId ? String(ctx.user.agentId) : '';
      if (!agentId) return [];
      try {
        const totals = await agentOpenEventTotals(agentId, tenant, whitelabelId);
        if (totals.size === 0) return [];
        const events = await fetchEventsSummary({
          whitelabelId,
          sport: args.sport,
          from: args.from,
          to: args.to,
        });
        return events
          .filter((e: any) => totals.has(String(e.id)))
          .map((e) => {
            const t = totals.get(String(e.id))!;
            return {
              ...e,
              matchedVolume: t.matchedVolume,
              totalLiquidity: t.totalLiquidity,
              marketCount: Number(e.marketCount || 0),
              betsCount: t.betsCount,
              lastBetAt: t.lastBetAt,
            };
          });
      } catch {
        // Fail closed for agents.
        return [];
      }
    }

    const events = await fetchEventsSummary({
      whitelabelId,
      sport: args.sport,
      from: args.from,
      to: args.to,
    });

    const filteredEvents = events;

    return filteredEvents.map((e) => ({
      ...e,
      matchedVolume: Number(e.matchedVolume || 0),
      totalLiquidity: Number(e.totalLiquidity || 0),
      marketCount: Number(e.marketCount || 0),
      betsCount: Number(e.betsCount || 0),
      lastBetAt: e.lastBetAt || null,
    }));
  },
  eventDetail: async (_: any, args: any, ctx: any) => {
    const whitelabelId = ctx?.whitelabel?.id as string;
    if (!whitelabelId) {
      throw new Error("Whitelabel ID is required");
    }
    const { event, markets } = await fetchEventDetail({
      eventId: String(args.eventId),
      whitelabelId,
    });
    // The event's matched volume, exposure and bet count are the whitelabel's;
    // an agent gets its own players' figures for the event instead.
    if (ctx?.user?.type === 'agent') {
      const agentId = ctx?.user?.agentId ? String(ctx.user.agentId) : '';
      if (!agentId) throw new Error('Forbidden: agent session has no agent id');
      const totals = await agentOpenEventTotals(agentId, ctx?.tenant || 'default', whitelabelId, [String(args.eventId)]);
      const t = totals.get(String(args.eventId));
      return {
        event: {
          ...event,
          matchedVolume: t?.matchedVolume ?? 0,
          totalLiquidity: t?.totalLiquidity ?? 0,
          betsCount: t?.betsCount ?? 0,
          marketCount: Number(event.marketCount || 0),
        },
        markets,
      };
    }
    return {
      event: {
        ...event,
        matchedVolume: Number(event.matchedVolume || 0),
        totalLiquidity: Number(event.totalLiquidity || 0),
        marketCount: Number(event.marketCount || 0),
      },
      markets,
    };
  },
  // Global data - no tenant filtering. updatedAt goes out as ISO, as leagues and events send it: the bare
  // Date reached the client as epoch milliseconds, which the Sports table showed as "Invalid Date".
  sports: async (_: any, _args: any, ctx: any) =>
    (await listSports()).map((row) => ({
      ...row,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    })),
  leagues: async (_: any, args: any, ctx: any) => {
    // Global data - no tenant filtering
    const rows = await db
      .select({
        id: sportsLeaguesTable.id,
        name: sportsLeaguesTable.name,
        sportId: sportsLeaguesTable.sportId,
        sort: sportsLeaguesTable.sort,
        status: sportsLeaguesTable.status,
        updatedAt: sportsLeaguesTable.updatedAt,
      })
      .from(sportsLeaguesTable)
      .where(eq(sportsLeaguesTable.sportId, String(args.sportId)))
      .orderBy(sportsLeaguesTable.sort);
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      sportId: String(r.sportId),
      sort: Number(r.sort || 999),
      status: r.status,
      updatedAt: r.updatedAt?.toISOString?.() ?? null,
    }));
  },
  events: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string;
    const rows = await db
      .select({
        id: sportsEventsTable.id,
        name: sportsEventsTable.name,
        leagueId: sportsEventsTable.leagueId,
        startTime: sportsEventsTable.startTime,
        status: sportsEventsTable.status,
        updatedAt: sportsEventsTable.updatedAt,
      })
      .from(sportsEventsTable)
      .where(eq(sportsEventsTable.leagueId, String(args.leagueId))); // Global data - no tenant filtering
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      leagueId: String(r.leagueId),
      startTime: r.startTime ? r.startTime.toISOString() : null,
      status: r.status,
      updatedAt: r.updatedAt?.toISOString?.() ?? null,
    }));
  },
  // Provider-proxied data for Manual builder (no DB)
  providerLeagues: async (_: any, args: any) => {
    const adapters = getSportsAdapters();
    const adapter = adapters[0];
    const sportCode = String(args.sportCode);
    const leagues = await adapter.listLeagues({ sportCode });
    return (leagues || []).map((it: any) => ({
      id: String(it?.competition?.id ?? ""),
      name: String(it?.competition?.name ?? ""),
      sportId: null,
      status: "active",
      updatedAt: null,
    }));
  },
  providerEvents: async (_: any, args: any) => {
    const adapters = getSportsAdapters();
    const adapter = adapters[0];
    const leagueId = String(args.leagueId);
    const events = await adapter.listEvents({ leagueId });
    return (events || []).map((it: any) => ({
      id: String(it?.event?.id ?? ""),
      name: String(it?.event?.name ?? ""),
      leagueId: leagueId,
      startTime: it?.event?.openDate
        ? new Date(it.event.openDate).toISOString()
        : null,
      status: "active",
      updatedAt: null,
    }));
  },
  leagueSettings: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string;
    let leagueId = String(args.leagueId);
    const tierId = args.tierId ?? "default";
    // Fallback: if leagueId is not a UUID (e.g., legacy provider id), resolve to DB UUID by code/key
    if (
      !/^\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b$/i.test(
        leagueId
      )
    ) {
      try {
        const byCode = await db
          .select({ id: sportsLeaguesTable.id })
          .from(sportsLeaguesTable)
          .where(
            or(
              eq(sportsLeaguesTable.key as any, leagueId),
              eq(sportsLeaguesTable.leagueCode as any, leagueId)
            )
          );
        if (byCode?.[0]?.id) leagueId = String(byCode[0].id);
      } catch {}
    }
    const settings = await getLeagueSettings(wl, leagueId, tierId);
    if (settings) {
      return {
        ...settings,
        id: String(settings.id),
        leagueId: String(settings.leagueId),
        alertOnBreach: settings.alertOnBreach ?? false,
        alertChannel: settings.alertChannel ?? "email",
        alertRateLimit: settings.alertRateLimit ?? 10,
      };
    }
    if (tierId !== "default") {
      const def = await getLeagueSettings(wl, leagueId, "default");
      if (def) {
        return {
          ...def,
          id: String(def.id),
          leagueId: String(def.leagueId),
          tierId: "default",
          alertOnBreach: def.alertOnBreach ?? false,
          alertChannel: def.alertChannel ?? "email",
          alertRateLimit: def.alertRateLimit ?? 10,
        };
      }
    }
    return null;
  },
  eventSettings: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string;
    const eventId = String(args.eventId);
    const tierId = args.tierId ?? "default";
    const settings = await getEventSettings(wl, eventId, tierId);
    if (settings) {
      return {
        ...settings,
        id: String(settings.id),
        eventId: String(settings.eventId),
        alertOnBreach: settings.alertOnBreach ?? false,
        alertChannel: settings.alertChannel ?? "email",
        alertRateLimit: settings.alertRateLimit ?? 10,
      };
    }
    if (tierId !== "default") {
      const def = await getEventSettings(wl, eventId, "default");
      if (def) {
        return {
          ...def,
          id: String(def.id),
          eventId: String(def.eventId),
          tierId: "default",
          alertOnBreach: def.alertOnBreach ?? false,
          alertChannel: def.alertChannel ?? "email",
          alertRateLimit: def.alertRateLimit ?? 10,
        };
      }
    }
    return null;
  },
  eventRiskConfig: async (_: any, args: any, ctx: any) => {
    // Block agents from accessing risk config (even read access)
    if (ctx?.user?.type === 'agent') {
      throw new Error('Agents are not allowed to access risk configuration');
    }
    
    // Get whitelabel ID from context
    // Note: ctx.whitelabel.id can be 'default' if fallback whitelabel is used
    const wl = ctx?.whitelabel?.id;
    const tenant = ctx?.tenant || 'default';
    const eventId = String(args.eventId);
    
    // If whitelabel ID is not available, throw error
    if (!wl) {
      throw new Error('Whitelabel ID is required');
    }
    
    // Use whitelabel ID (even if it's 'default' - that's a valid whitelabel ID)
    const config = await getRiskConfig(wl, eventId, tenant);
    
    if (!config) {
      return null;
    }
    
    return {
      id: config.id,
      eventId: config.eventId,
      percentiles: config.percentiles,
      weights: config.weights,
      amounts: config.amounts,
      alerts: config.alerts,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  },
  existingLeagueCodes: async (_: any, args: any, ctx: any) => {
    // Global data - no tenant filtering
    return listExistingLeagueCodes(String(args.sportId));
  },
  existingEventCodes: async (_: any, args: any, ctx: any) => {
    // Global data - no tenant filtering
    return listExistingEventCodesByLeagueCode(String(args.leagueCode));
  },
  marketsByEvent: async (_: any, args: any, ctx: any) => {
    // Global data - no tenant filtering
    const rows = await db
      .select({
        id: sportsMarketsTable.id,
        name: sportsMarketsTable.name,
        eventId: sportsMarketsTable.eventId,
        type: sportsMarketsTable.type,
        status: sportsMarketsTable.status,
        updatedAt: sportsMarketsTable.updatedAt,
      })
      .from(sportsMarketsTable)
      .where(eq(sportsMarketsTable.eventId, String(args.eventId)))
      .orderBy(sportsMarketsTable.name);
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      eventId: String(r.eventId),
      type: String(r.type || "match_odds"),
      status: r.status,
      updatedAt: r.updatedAt?.toISOString?.() ?? null,
    }));
  },
  leaguesWithOpenBets: async (_: any, args: any, ctx: any) => {
    const scope = openBetsScope(ctx);
    if (scope === null) return [];
    const rows = await getLeaguesWithOpenBets(String(args.sportId), scope);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sportId: r.sportId,
      status: r.status,
      updatedAt: r.updatedAt?.toISOString?.() ?? null,
    }));
  },
  eventsWithOpenBets: async (_: any, args: any, ctx: any) => {
    const scope = openBetsScope(ctx);
    if (scope === null) return [];
    const rows = await getEventsWithOpenBets(String(args.leagueId), scope);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      leagueId: r.leagueId,
      startTime: r.startTime?.toISOString?.() ?? null,
      status: r.status,
      updatedAt: r.updatedAt?.toISOString?.() ?? null,
    }));
  },
  marketsWithOpenBets: async (_: any, args: any, ctx: any) => {
    const scope = openBetsScope(ctx);
    if (scope === null) return [];
    const rows = await getMarketsWithOpenBets(String(args.eventId), scope);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      eventId: r.eventId,
      type: r.type,
      status: r.status,
      updatedAt: r.updatedAt?.toISOString?.() ?? null,
    }));
  },
  marketsByIds: async (_: any, args: any, ctx: any) => {
    // Global data - no tenant filtering
    if (!args.marketIds || !Array.isArray(args.marketIds) || args.marketIds.length === 0) {
      return [];
    }
    
    const marketIdStrings = args.marketIds.map((id: any) => String(id));
    
    const rows = await db
      .select({
        id: sportsMarketsTable.id,
        name: sportsMarketsTable.name,
        eventId: sportsMarketsTable.eventId,
        type: sportsMarketsTable.type,
        status: sportsMarketsTable.status,
        updatedAt: sportsMarketsTable.updatedAt,
      })
      .from(sportsMarketsTable)
      .where(inArray(sportsMarketsTable.id, marketIdStrings));
    
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      eventId: String(r.eventId),
      type: String(r.type || "match_odds"),
      status: r.status,
      updatedAt: r.updatedAt?.toISOString?.() ?? null,
    }));
  },
  runnersByMarket: async (_: any, args: any, ctx: any) => {
    // Global data - no tenant filtering
    const rows = await db
      .select({
        id: sportsRunnersTable.id,
        name: sportsRunnersTable.name,
        marketId: sportsRunnersTable.marketId,
        selectionCode: sportsRunnersTable.selectionCode,
        sort: sportsRunnersTable.sort,
        status: sportsRunnersTable.status,
      })
      .from(sportsRunnersTable)
      .where(eq(sportsRunnersTable.marketId, String(args.marketId)))
      .orderBy(sportsRunnersTable.sort);
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      marketId: String(r.marketId),
      selectionCode: String(r.selectionCode),
      sortPriority: Number(r.sort || 999),
      status: r.status,
    }));
  },
  exposures: async (_: any, args: any) =>
    listExposurePoints({ sport: args.sport, competition: args.competition }),
  riskLimits: async (_: any, args: any) =>
    listRiskLimits({ segment: args.segment, userId: args.userId }),
  // Auto sports configs
  autoSportsConfigs: async (_: any, _args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string;
    const rows = await db
      .select()
      .from(sportsAutoConfigsTable)
      .where(eq(sportsAutoConfigsTable.whitelabelId, wl));
    return rows.map((r) => ({
      id: String(r.id),
      sportId: String(r.sportId),
      leagueCodes: (r.leagueCodes as unknown as string[]) ?? null,
      frequencyHours: Number(r.frequencyHours ?? 6),
      active: Boolean(r.active ?? false),
      lastRunAt: r?.lastRunAt ? r.lastRunAt.toISOString() : null,
      lastRunStatus: r?.lastRunStatus ?? "never",
      nextRunAt:
        r?.lastRunAt && r?.frequencyHours
          ? new Date(
              r.lastRunAt.getTime() + Number(r.frequencyHours) * 3600 * 1000
            ).toISOString()
        : null,
      updatedAt:
        (r.updatedAt ?? r.createdAt)?.toISOString?.() ??
        new Date().toISOString(),
    }));
  },
  autoSportsConfig: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string;
    const rows = await db
      .select()
      .from(sportsAutoConfigsTable)
      .where(
        and(
          eq(sportsAutoConfigsTable.whitelabelId, wl),
          eq(sportsAutoConfigsTable.sportId, String(args.sportId))
        )
      );
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      sportId: String(r.sportId),
      leagueCodes: (r.leagueCodes as unknown as string[]) ?? null,
      frequencyHours: Number(r.frequencyHours ?? 6),
      active: Boolean(r.active ?? false),
      lastRunAt: r?.lastRunAt ? r.lastRunAt.toISOString() : null,
      lastRunStatus: r?.lastRunStatus ?? "never",
      nextRunAt:
        r?.lastRunAt && r?.frequencyHours
          ? new Date(
              r.lastRunAt.getTime() + Number(r.frequencyHours) * 3600 * 1000
            ).toISOString()
        : null,
      updatedAt:
        (r.updatedAt ?? r.createdAt)?.toISOString?.() ??
        new Date().toISOString(),
    };
  },
  availableAutoFrequencies: async () => [1, 2, 3, 6, 12, 24],
  autoRuns: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string;
    const rows = await listAutoRuns(
      wl,
      String(args.sportId),
      Number(args.limit ?? 20)
    );
    return rows.map((r: any) => ({
      id: String(r.id),
      sportId: String(r.sportId),
      startedAt: r?.startedAt?.toISOString?.() ?? new Date().toISOString(),
      finishedAt: r?.finishedAt?.toISOString?.() ?? null,
      status: String(r?.status ?? "unknown"),
      leaguesAdded: Number(r?.leaguesAdded ?? 0),
      eventsAdded: Number(r?.eventsAdded ?? 0),
      marketsAdded: Number(r?.marketsAdded ?? 0),
      runnersAdded: Number(r?.runnersAdded ?? 0),
      skippedEventsCount: Number(r?.skippedEventsCount ?? 0),
      skippedEvents: Array.isArray(r?.skippedEvents) ? r.skippedEvents : null,
      errorMessage: (r?.errorMessage ?? null) as any,
    }));
  },  autoRunsPage: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string;
    const { items: rows, total } = await (await import('@/repos/sports/sportsRepo.js')).listAutoRunsPage(wl, String(args.sportId), args.limit, args.offset);
    const items = rows.map((r: any) => ({
      id: String(r.id),
      sportId: String(r.sportId),
      startedAt: r?.startedAt?.toISOString?.() ?? new Date().toISOString(),
      finishedAt: r?.finishedAt?.toISOString?.() ?? null,
      status: String(r?.status ?? "unknown"),
      leaguesAdded: Number(r?.leaguesAdded ?? 0),
      eventsAdded: Number(r?.eventsAdded ?? 0),
      marketsAdded: Number(r?.marketsAdded ?? 0),
      runnersAdded: Number(r?.runnersAdded ?? 0),
      skippedEventsCount: Number(r?.skippedEventsCount ?? 0),
      skippedEvents: Array.isArray(r?.skippedEvents) ? r.skippedEvents : null,
      errorMessage: (r?.errorMessage ?? null) as any,
    }));
    return { items, total };
  },
  sportSettings: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string;
    const data = await getSportSettings(
      wl,
      String(args.sportId),
      args?.tierId ? String(args.tierId) : null
    );
    return data;
  },
  sportsBets: async (_: any, args: { query?: any }, ctx: any, info?: GraphQLResolveInfo) => {
    try {
      const { getSportsBets } = await import(
        "@src/repos/sports/sportsBetsRepo.js"
      );
      const { PlayerAuthService } = await import(
        "@src/domains/players/services/PlayerAuthService.js"
      );
      const query = args.query ?? {};
      // `allTenants` drops the tenant filter *and* the agent filter below, so a
      // client that simply sent the flag read every whitelabel's bets — an agent
      // included, whose own players are the only ones they may see. It is a
      // platform-wide view, so it is honoured only for a caller who actually
      // holds platform-wide permission. Anyone else is scoped normally rather
      // than refused: the flag is a widening request, and ignoring it returns
      // exactly the rows they are entitled to.
      const useAllTenants =
        query.allTenants === true && hasPermission(ctx?.permissions ?? [], 'all', '*');
      const directorTenant = getEffectiveTenantForDirector(ctx);
      const tenant = useAllTenants ? undefined : (directorTenant ?? ctx?.tenant ?? "default");
      const wl = useAllTenants ? undefined : ((directorTenant ?? ctx?.whitelabel?.id) as string);

      const filter: Record<string, any> = { ...query };
      delete filter.allTenants;
      if (!useAllTenants) {
        filter.tenant = tenant;
        filter.whitelabelId = wl;
      }
      if (filter.userId != null && filter.userIds == null) {
        filter.userId = Number(filter.userId);
      }

      // Add agent filtering: if agent is logged in, only show bets from their players (skip when allTenants)
      if (!useAllTenants && ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        const playerAuthService = new PlayerAuthService();
        const agentPlayerIds = await playerAuthService.getAgentPlayerIds(
          ctx.user.agentId,
          tenant
        );
        
        // If agent has no players, return empty array
        if (agentPlayerIds.length === 0) {
          return [];
        }

        // Narrow to the requested player(s) when the caller asked for some, and
        // only among the agent's own. This replaced any requested userId with
        // the agent's whole player list, so a contributor player's page showed
        // the bets of every player in the agent's subtree.
        const requested: number[] = [];
        if (Array.isArray(filter.userIds)) requested.push(...filter.userIds.map((v: unknown) => Number(v)));
        if (filter.userId != null) requested.push(Number(filter.userId));
        const own = new Set(agentPlayerIds);
        const scopedIds = requested.length > 0 ? requested.filter((id) => Number.isFinite(id) && own.has(id)) : agentPlayerIds;
        if (scopedIds.length === 0) {
          return [];
        }
        filter.userIds = scopedIds;
        delete filter.userId; // Ensure single userId filter is not applied if userIds is present
      }
      
      const bets = await getSportsBets({ ...filter, omitOpenAdminToolBets: true });
      
      
      // Safety check: ensure bets is an array
      if (!bets || !Array.isArray(bets)) {
        return [];
      }

      const now = new Date();
      const enrichment = await readSportsBetEnrichment(
        bets.map((bet: any) => Number(bet?.userId)), tenant, sportsBetEnrichmentFields(info), now,
      );
      const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
      const fallbackCurrency = await getWhitelabelCurrency(tenant);

      // Format the response - map ALL bets, not just first one
      const enrichedBets = await Promise.all(
        bets.map(async (bet: any) => {
          if (!bet) return null;
        
        // Drizzle returns snake_case from database when using db.select() without explicit mapping
        // Check snake_case FIRST (database format), then camelCase (schema format) as fallback
          const ipAddress =
            (bet as any).ip_address ?? (bet as any).ipAddress ?? null;
          const userAgent =
            (bet as any).user_agent ?? (bet as any).userAgent ?? null;
          const location = (bet as any).location ?? null;
          const country = (bet as any).country ?? null;
          const deviceInfo =
            (bet as any).device_info ?? (bet as any).deviceInfo ?? null;
          const oddsSizeRaw = (bet as any).odds_size ?? (bet as any).oddsSize ?? (bet as any).oddsSizeValue ?? null;
          const oddsSize = oddsSizeRaw !== null && oddsSizeRaw !== undefined ? Number(oddsSizeRaw) : null;

          const userInfo = enrichment.get(String(bet.userId));
          const userName = userInfo?.name ?? `User ${bet.userId}`;
          const userFlags = userInfo?.flags ?? null;
          const agentInfo = userInfo?.agentInfo ?? null;

        return {
      id: bet.id,
      tenant: bet.tenant,
      whitelabelId: bet.whitelabelId,
      userId: bet.userId,
      userName: userName,
      userFlags: userFlags,
      sportId: bet.sportId,
      sportName: bet.sportName || bet.sport_name || null,
      leagueId: bet.leagueId,
      leagueName: bet.leagueName || bet.league_name || null,
      marketId: bet.marketId,
      eventId: bet.eventId,
      eventName: bet.eventName || bet.event_name || null,
      runnerId: bet.runnerId,
      selectionId: bet.selectionId,
      side: bet.side,
      price: bet.price ? Number(bet.price) : 0,
      size: bet.size ? Number(bet.size) : 0,
      stake: bet.stake ? Number(bet.stake) : 0,
      liability: bet.liability ? Number(bet.liability) : 0,
      status: bet.status,
            matchedAt: bet.matchedAt
              ? new Date(bet.matchedAt).toISOString()
              : null,
            settledAt: bet.settledAt
              ? new Date(bet.settledAt).toISOString()
              : null,
      result: bet.result || null,
      pl: (bet as any).pl != null ? Number((bet as any).pl) : null,
            currency: bet.currency || fallbackCurrency,
      // IP fields with proper mapping
      ipAddress: ipAddress,
      userAgent: userAgent,
      location: location,
      country: country,
      deviceInfo: deviceInfo,
            oddsSize: oddsSize,
            // Agent info
            agentInfo: agentInfo,
            createdAt: bet.createdAt
              ? new Date(bet.createdAt).toISOString()
              : new Date().toISOString(),
            updatedAt: bet.updatedAt
              ? new Date(bet.updatedAt).toISOString()
              : new Date().toISOString(),
          };
        })
      );

      return enrichedBets.filter((bet: any) => bet !== null);
    } catch (error: any) {
      return [];
    }
  },
  sportsResultStats: async (_: any, __: any, ctx: any) => {
    if (!ctx?.user) throw new Error('Unauthorized: authentication required');
    if (!hasPermission(ctx?.permissions ?? [], 'sports.results', 'view')) throw new Error('Forbidden: insufficient permissions for sports results');
    const scope = sportsResultReadScope(ctx);
    if (!scope) return { total: 0, today: 0, exchange: 0, bookmaker: 0, fancy: 0, rolledBack: 0 };
    const { getSportsResultStats } = await import('@src/repos/sports/sportsResultsRepo.js');
    return getSportsResultStats(scope);
  },

  sportsResults: async (_: any, args: { query?: any }, ctx: any) => {
    if (ctx?.directorMode === "whitelabel") {
      return { items: [], total: 0 };
    }
    const { getSportsResults } = await import(
      "@src/repos/sports/sportsResultsRepo.js"
    );
    const {
      sportsLeaguesTable,
      sportsEventsTable,
      sportsMarketsTable,
      sportsRunnersTable,
    } = await import("@shared/db/schema.js");
    const { eq } = await import("drizzle-orm");

    const tenant = ctx?.tenant || 'default';
    const filter = { ...args.query, ...sportsResultReadScope(ctx) };

    const result = await getSportsResults(filter);
    
    const ids = (key: 'sportId' | 'leagueId' | 'eventId' | 'marketId' | 'runnerId') => [...new Set(result.items.map(item => item[key]).filter((id): id is string => Boolean(id)))];
    const [sportData, leagueData, eventData, marketData, runnerData] = await Promise.all([
      ids('sportId').length ? db.select().from(sportsTable).where(inArray(sportsTable.id, ids('sportId'))) : [],
      ids('leagueId').length ? db.select().from(sportsLeaguesTable).where(inArray(sportsLeaguesTable.id, ids('leagueId'))) : [],
      ids('eventId').length ? db.select().from(sportsEventsTable).where(inArray(sportsEventsTable.id, ids('eventId'))) : [],
      ids('marketId').length ? db.select().from(sportsMarketsTable).where(inArray(sportsMarketsTable.id, ids('marketId'))) : [],
      ids('runnerId').length ? db.select().from(sportsRunnersTable).where(inArray(sportsRunnersTable.id, ids('runnerId'))) : [],
    ]);
    const sportById = new Map(sportData.map(row => [String(row.id), row]));
    const leagueById = new Map(leagueData.map(row => [String(row.id), row]));
    const eventById = new Map(eventData.map(row => [String(row.id), row]));
    const marketById = new Map(marketData.map(row => [String(row.id), row]));
    const runnerById = new Map(runnerData.map(row => [String(row.id), row]));
    const actorIds = [...new Set(result.items.flatMap(item => [item.declaredBy, item.rolledBackBy]).map(id => Number.parseInt(id ?? '', 10)).filter(Number.isFinite))];
    const { getUsersByIdsForExclusion } = await import('@src/repos/users/usersRepo.js');
    const actorData = await getUsersByIdsForExclusion(actorIds, tenant).catch(() => []);
    const actorById = new Map(actorData.map(row => [row.id, row]));

    // Resolve related entities for each result
    const items = await Promise.all(
      result.items.map(async (item: any) => {
      // Get sport
        const sportRow = sportById.get(String(item.sportId));
        const sport = sportRow
          ? {
        id: String(sportRow.id),
        key: String(sportRow.key),
        name: String(sportRow.name),
        sort: Number(sportRow.sort || 999),
        sportCode: String(sportRow.sportCode),
        status: sportRow.status,
              updatedAt:
                sportRow.updatedAt?.toISOString() ||
                new Date().toISOString(),
            }
          : null;
      
      // Get league
        const leagueRow = leagueById.get(String(item.leagueId));
        const league = leagueRow
          ? {
        id: String(leagueRow.id),
        name: String(leagueRow.name),
        sportId: String(leagueRow.sportId),
        status: leagueRow.status,
        updatedAt: leagueRow.updatedAt?.toISOString() || null,
            }
          : null;
      
      // Get event
        const eventRow = eventById.get(String(item.eventId));
        const event = eventRow
          ? {
        id: String(eventRow.id),
        name: String(eventRow.name),
        leagueId: String(eventRow.leagueId),
        startTime: eventRow.startTime?.toISOString() || null,
        status: eventRow.status,
        updatedAt: eventRow.updatedAt?.toISOString() || null,
            }
          : null;
      
      // Get market
        const marketRow = marketById.get(String(item.marketId));
        const market = marketRow
          ? {
        id: String(marketRow.id),
        name: String(marketRow.name),
        eventId: String(marketRow.eventId),
              type: String(marketRow.type || "match_odds"),
        status: marketRow.status,
        updatedAt: marketRow.updatedAt?.toISOString() || null,
        startTime: null,
        runners: [],
            }
          : null;
      
      // Get runner if exists
        let runner = null;
      if (item.runnerId) {
          const runnerRow = runnerById.get(String(item.runnerId));
          runner = runnerRow
            ? {
          id: String(runnerRow.id),
          name: String(runnerRow.name),
          sortPriority: Number(runnerRow.sort || 999),
              }
            : null;
      }
      
      // Resolve user names for declaredBy and rolledBackBy
        let declaredByName: string | undefined = undefined;
        let rolledBackByName: string | undefined = undefined;
      
      // Try to resolve declaredBy as user ID
        const declaredById = Number.parseInt(item.declaredBy, 10);
      if (Number.isFinite(declaredById)) {
        try {
            const user = actorById.get(declaredById);
            declaredByName = user?.name || item.declaredBy;
        } catch {
            declaredByName = item.declaredBy;
        }
      } else {
          declaredByName = item.declaredBy;
      }
      
      // Try to resolve rolledBackBy as user ID
      if (item.rolledBackBy) {
          const rolledBackById = Number.parseInt(item.rolledBackBy, 10);
        if (Number.isFinite(rolledBackById)) {
          try {
              const user = actorById.get(rolledBackById);
              rolledBackByName = user?.name || item.rolledBackBy;
          } catch {
              rolledBackByName = item.rolledBackBy;
          }
        } else {
            rolledBackByName = item.rolledBackBy;
        }
      }
      
      return {
        id: item.id,
        tenant: item.tenant,
        whitelabelId: item.whitelabelId,
        isGlobal: Boolean(item.isGlobal),
        sportId: item.sportId,
        leagueId: item.leagueId,
        eventId: item.eventId,
        marketId: item.marketId,
        marketType: item.marketType,
        runnerId: item.runnerId,
        selectionName: item.selectionName,
        result: item.result,
        declaredBy: item.declaredBy,
        declaredByName,
        declaredAt:
          item.declaredAt?.toISOString() || new Date().toISOString(),
        rolledBackAt: item.rolledBackAt?.toISOString() || null,
        rolledBackBy: item.rolledBackBy || null,
        rolledBackByName,
        rollbackReason: item.rollbackReason || null,
        rollbackTag: item.rollbackTag || null,
        createdAt: item.createdAt?.toISOString() || new Date().toISOString(),
        sport,
        league,
        event,
        market,
        runner,
      };
      })
    );
    
    return {
      items,
      total: result.total,
    };
  },
  sportsAutoResultsSettings: async (_: any, args: any, ctx: any) => {
    const { getSportsAutoResultsSettings, buildSportsAutoResultsContext } =
      await import("@src/repos/sports/sportsAutoResultsRepo.js");
    const { getSportById } = await import("@src/repos/sports/sportsRepo.js");
    const resultCtx = buildSportsAutoResultsContext(ctx);
    const filters = {
      ...args.filters,
      tenant: resultCtx.tenant,
      whitelabelId: resultCtx.whitelabelId,
    };
    const items = await getSportsAutoResultsSettings(filters);
    
    // Resolve sport, league, event for each item
    const resolvedItems = await Promise.all(
      items.map(async (item) => {
        const sport = item.sportId ? await getSportById(item.sportId) : null;
        const league = item.leagueId
          ? await db
              .select({
                id: sportsLeaguesTable.id,
                name: sportsLeaguesTable.name,
              })
        .from(sportsLeaguesTable)
              .where(
                eq(sportsLeaguesTable.id, item.leagueId)
              )
        .limit(1)
              .then((rows) => rows[0] || null)
          : null;
        const event = item.eventId
          ? await db
              .select({
                id: sportsEventsTable.id,
                name: sportsEventsTable.name,
              })
        .from(sportsEventsTable)
              .where(eq(sportsEventsTable.id, item.eventId)) // Global data - no tenant filtering
        .limit(1)
              .then((rows) => rows[0] || null)
          : null;

      return {
        ...item,
          sport: sport
            ? {
                id: String(sport.id),
                name: sport.name,
                sportCode: sport.sportCode,
              }
            : null,
          league: league
            ? { id: String(league.id), name: String(league.name) }
            : null,
          event: event
            ? { id: String(event.id), name: String(event.name) }
            : null,
          createdAt:
            item.createdAt?.toISOString?.() || new Date().toISOString(),
          updatedAt:
            item.updatedAt?.toISOString?.() || new Date().toISOString(),
        };
      })
    );
    
    return resolvedItems;
  },
  sportsAutoResultsSetting: async (_: any, args: any, ctx: any) => {
    const { getSportsAutoResultsSettingsById, buildSportsAutoResultsContext } =
      await import("@src/repos/sports/sportsAutoResultsRepo.js");
    const { getSportById } = await import("@src/repos/sports/sportsRepo.js");
    const resultCtx = buildSportsAutoResultsContext(ctx);
    const item = await getSportsAutoResultsSettingsById(
      args.id,
      resultCtx.tenant,
      resultCtx.whitelabelId
    );
    if (!item) return null;
    
    // Resolve sport, league, event
    const sport = item.sportId ? await getSportById(item.sportId) : null;
    const league = item.leagueId
      ? await db
          .select({ id: sportsLeaguesTable.id, name: sportsLeaguesTable.name })
      .from(sportsLeaguesTable)
          .where(eq(sportsLeaguesTable.id, item.leagueId)) // Global data - no tenant filtering
      .limit(1)
          .then((rows) => rows[0] || null)
      : null;
    const event = item.eventId
      ? await db
          .select({ id: sportsEventsTable.id, name: sportsEventsTable.name })
      .from(sportsEventsTable)
          .where(
            eq(sportsEventsTable.id, item.eventId)
          )
      .limit(1)
          .then((rows) => rows[0] || null)
      : null;

    return {
      ...item,
      sport: sport
        ? { id: String(sport.id), name: sport.name, sportCode: sport.sportCode }
        : null,
      league: league
        ? { id: String(league.id), name: String(league.name) }
        : null,
      event: event ? { id: String(event.id), name: String(event.name) } : null,
      rules: item.rules ? JSON.stringify(item.rules) : null,
      notifyChannels: (item.notifyChannels as unknown as string[]) || [],
      createdAt: item.createdAt?.toISOString?.() || new Date().toISOString(),
      updatedAt: item.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  },
  searchSportsHierarchy: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id || "default";
    const { query, limit = 50 } = args.input;

    if (!query || query.length < 2) {
      return [];
    }

    try {
      const results = await searchSportsHierarchy(query, wl, limit);
      return results;
    } catch (error: any) {
      return [];
    }
  },
  // Betting Patterns & Intelligence (Sports-specific player profile)
  sportsPlayerProfile: async (_: any, args: any, ctx: any) => {
    try {
      const { getPlayerStatistics, getPlayerBettingPatterns, getPlayerRiskProfile, getPlayerDevices, getRelatedPlayers, getPlayerAgentChain, getPlayerBettingHistory } = await import("@src/repos/sports/playerIntelligenceRepo.js");
      const { users } = await import("@shared/db/schema.js");
      const { db } = await import("@src/db/client.js");
      const { eq } = await import("drizzle-orm");
      
      // Validate userId
      if (!args.userId) {
        return null;
      }
      
      const userId = Number(args.userId);
      if (isNaN(userId) || userId <= 0) {
        return null;
      }
      
      const tenant = ctx?.tenant || 'default';
      const whitelabelId = ctx?.whitelabel?.id || 'default';

      // Get user — in the caller's own tenant. This looked the id up across
      // every whitelabel, so any caller with sports access could read any
      // player's name, e-mail, phone, devices and bets by guessing ids.
      const { and: andOp } = await import("drizzle-orm");
      const userRows = await db.select().from(users).where(andOp(eq(users.id, userId), eq(users.tenant, tenant))).limit(1);
      if (userRows.length === 0) {
        return null; // Return null instead of throwing
      }
      const user = userRows[0];

      // An agent may open its own players only (subtree + referral).
      const agentId = ctx?.user?.type === 'agent' ? String(ctx?.user?.agentId ?? '') : null;
      if (agentId !== null) {
        if (!agentId || !(await agentMayViewPlayer(agentId, tenant, userId))) {
          return null;
        }
      }
      
      // Normalize status to uppercase enum value
      const normalizedStatus = user.status ? String(user.status).toUpperCase() : 'INACTIVE';
      
      // Get all player intelligence data
      const [statistics, patterns, riskProfile, devices, relatedPlayers, agentChain, recentBets] = await Promise.all([
        getPlayerStatistics(userId, tenant, whitelabelId),
        getPlayerBettingPatterns(userId, tenant, whitelabelId),
        getPlayerRiskProfile(userId, tenant, whitelabelId),
        getPlayerDevices(userId, tenant),
        getRelatedPlayers(userId, tenant),
        getPlayerAgentChain(userId, tenant),
        getPlayerBettingHistory(userId, { tenant, whitelabelId, limit: 50 }),
      ]);

      // Related players (shared IPs) and the referral chain name other users;
      // an agent sees only those that are its own players.
      let visibleRelated = relatedPlayers;
      let visibleChain = agentChain;
      if (agentId) {
        const { listAgentPlayerIds } = await import("@src/repos/reporting/agentPlayerScope.js");
        const own = new Set(await listAgentPlayerIds(agentId, tenant));
        visibleRelated = relatedPlayers.filter((rp: any) => own.has(Number(rp.userId)));
        visibleChain = agentChain.filter((ac: any) => own.has(Number(ac.agentId)));
      }

      return {
        user: {
          id: String(user.id),
          name: user.name,
          username: user.username,
          email: user.email,
          phone: user.phone,
          status: normalizedStatus as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
          riskType: user.riskType,
        },
        statistics,
        patterns,
        riskProfile: {
          ...riskProfile,
          lastReviewedAt: riskProfile.lastReviewedAt?.toISOString() || null,
        },
        devices: devices.map(d => ({
          ...d,
          firstUsed: d.firstUsed.toISOString(),
          lastUsed: d.lastUsed.toISOString(),
        })),
        relatedPlayers: visibleRelated.map(rp => ({
          ...rp,
          userId: String(rp.userId),
        })),
        agentChain: visibleChain.map(ac => ({
          ...ac,
          agentId: String(ac.agentId),
        })),
        recentBets: recentBets.map((bet: any) => ({
          ...bet,
          id: String(bet.id),
          userId: String(bet.userId),
          createdAt: bet.createdAt?.toISOString() || new Date().toISOString(),
        })),
      };
    } catch (error: any) {
      return null; // Return null on error instead of throwing
    }
  },
  bettingPatterns: async (_: any, args: any, ctx: any) => {
    try {
      const { getBettingPatterns } = await import("@src/repos/sports/bettingPatternsRepo.js");
      const { users } = await import("@shared/db/schema.js");
      const { db } = await import("@src/db/client.js");
      const { eq } = await import("drizzle-orm");
      
      const tenant = ctx?.tenant || 'default';
      const whitelabelId = ctx?.whitelabel?.id || 'default';

      // An agent sees patterns of its own players only (subtree + referral);
      // this listed the whole whitelabel's flagged players to any agent.
      let patterns: Awaited<ReturnType<typeof getBettingPatterns>>;
      if (ctx?.user?.type === 'agent') {
        const agentId = ctx?.user?.agentId ? String(ctx.user.agentId) : '';
        if (!agentId) return [];
        const requestedUser = args.userId ? Number(args.userId) : undefined;
        if (requestedUser !== undefined && !(await agentMayViewPlayer(agentId, tenant, requestedUser))) return [];
        const { bettingPatternsTable } = await import("@shared/db/schema.js");
        const { and: andOp, desc } = await import("drizzle-orm");
        const bp = bettingPatternsTable;
        const rows = await db
          .select()
          .from(bp)
          .where(andOp(
            eq(bp.tenant, tenant),
            eq(bp.whitelabelId, whitelabelId),
            inAgentPlayers(bp.userId, agentId, tenant),
            requestedUser !== undefined ? eq(bp.userId, requestedUser) : undefined,
            args.eventId ? eq(bp.eventId, args.eventId) : undefined,
            args.severity ? eq(bp.severity, args.severity) : undefined,
            args.status ? eq(bp.status, args.status) : undefined,
          ))
          .orderBy(desc(bp.detectedAt))
          .limit(args.limit || 100);
        patterns = rows as any;
      } else {
        patterns = await getBettingPatterns({
          userId: args.userId ? Number(args.userId) : undefined,
          eventId: args.eventId,
          severity: args.severity,
          status: args.status,
          tenant,
          whitelabelId,
          limit: args.limit || 100,
        });
      }
      
      // Enrich with user names
      const userIds = [...new Set(
        patterns
          .map(p => p.userId)
          .filter(id => id != null && id !== undefined && !isNaN(Number(id)))
          .map(id => Number(id))
      )];
      let userMap = new Map();
      if (userIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        const userRows = await db
          .select({ id: users.id, name: users.name, username: users.username })
          .from(users)
          .where(inArray(users.id, userIds));
        userMap = new Map(userRows.map(u => [u.id, u]));
      }
    
      return patterns.map(p => ({
        id: p.id,
        userId: String(p.userId),
        userName: userMap.get(p.userId)?.name || userMap.get(p.userId)?.username || null,
        eventId: p.eventId,
        patternType: p.patternType,
        severity: p.severity,
        metrics: p.metrics || {},
        detectedAt: p.detectedAt.toISOString(),
        status: p.status,
        notes: p.notes,
      }));
    } catch (error: any) {
      // If table doesn't exist or other database error, return empty array
      const errorMessage = error?.message || String(error || '');
      if (
        errorMessage.includes('does not exist') ||
        errorMessage.includes('Failed query') ||
        error?.code === '42P01'
      ) {
        return [];
      }
      throw error;
    }
  },
  automationRules: async (_: any, args: any, ctx: any) => {
    const { getAutomationRules } = await import("@src/repos/sports/automationRulesRepo.js");
    
    const tenant = ctx?.tenant || 'default';
    const whitelabelId = ctx?.whitelabel?.id || 'default';
    
    const rules = await getAutomationRules(args.eventId || null, tenant, whitelabelId);
    
    return rules.map(r => ({
      id: r.id,
      eventId: r.eventId,
      ruleType: r.ruleType,
      config: r.config,
      enabled: r.enabled,
      priority: r.priority,
    }));
  },
};
