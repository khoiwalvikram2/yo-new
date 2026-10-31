import { sportsPayoutAggregateSql } from '@src/shared/reportingSql.js'
import { db } from '../../../db/client';
import { sportsBets, casinoBets, matkaBets, users, agentHierarchyClosure } from '@shared/db/schema';
import { and, eq, inArray, gte, lt, sql } from 'drizzle-orm';
import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { AgentRateHistoryRepo } from '../../../repos/agents/AgentRateHistoryRepo';
import { attributedAgentId, withReferralScope } from '../../agents/services/commissionPlayerScope';
import {
  rateSegments,
  round2,
  SHARE_DOMAINS,
  isShareDomain,
  type ShareDomain,
  type RateSegment,
} from '../../agents/services/SharingSettlementEngine';
import type { RateRow } from '../../agents/services/agentMutationRules';

export interface PlayerContribution {
  playerId: number;
  playerName: string | null;
  playerUsername: string | null;
  pl: number;
  share: number;
  domainBreakdown: {
    sports: { pl: number; share: number; cutAmount: number };
    casino: { pl: number; share: number; cutAmount: number };
    matka: { pl: number; share: number; cutAmount: number };
  };
  contributionPercentage: number;
  isDirectPlayer: boolean;
  subAgentId?: string;
  subAgentName?: string;
}

export interface SubAgentContribution {
  subAgentId: string;
  subAgentName: string | null;
  subAgentUsername: string | null;
  totalPL: number;
  totalShare: number;
  playerCount: number;
  domainBreakdown: {
    sports: { pl: number; share: number; cutAmount: number };
    casino: { pl: number; share: number; cutAmount: number };
    matka: { pl: number; share: number; cutAmount: number };
  };
  contributionPercentage: number;
  players: PlayerContribution[];
}

export interface ContributionTotals {
  directPL: number;
  subAgentPL: number;
  directShare: number;
  subAgentShare: number;
  directPlayersCount: number;
  subAgentsCount: number;
}

/** A player in the agent's scope, with the route that put it there. */
export interface ScopedPlayerRow {
  playerId: number;
  name: string | null;
  username: string | null;
  status: string | null;
  /** The one subtree agent the player belongs to: COALESCE(its own agent, its referrer's agent). */
  viaAgentId: string | null;
  route: 'direct' | 'referral';
}

/** A player's GGR and the agent's share of it for one domain over the window (all rate segments summed). */
export interface PlayerDomainActivity {
  playerId: number;
  domain: ShareDomain;
  /** Operator GGR (stakes − payouts; > 0 = the player lost). */
  ggr: number;
  /** The agent's share of it: Σ segment GGR x segment rate. */
  share: number;
  /** The agent the bets were attributed to (same rule as the SHARE base). */
  viaAgentId?: string | null;
}

type DomainTriple = PlayerContribution['domainBreakdown'];
const emptyTriple = (): DomainTriple => ({
  sports: { pl: 0, share: 0, cutAmount: 0 },
  casino: { pl: 0, share: 0, cutAmount: 0 },
  matka: { pl: 0, share: 0, cutAmount: 0 },
});

/**
 * Builds the contribution breakdown from already-loaded rows (no I/O, unit-tested).
 *
 * - Each player is counted ONCE: one row per player id (direct route first).
 *   The loaders already attribute every player to one agent, as the SHARE base
 *   does, so a referral-linked player is never counted under two agents.
 * - A player belongs to the direct bucket when it hangs off the agent itself,
 *   otherwise to the bucket of the direct child whose subtree contains its agent
 *   (`childOf`), so every level below the child is covered, not only the child's
 *   own players.
 * - Players are listed when ACTIVE, or when they had bets in the window whatever
 *   their status (a suspended player's losses still count). A player that has
 *   activity but is missing from `players` is still listed, so the shares always
 *   add up to the agent's SHARE for the window.
 * - Signs: pl = the player's P/L (−GGR); share = the agent's share (positive =
 *   TO_AGENT, as the SHARE lines); cutAmount = the rest of the GGR (GGR − share).
 */
export function assembleContributions(params: {
  agentId: string;
  players: ScopedPlayerRow[];
  children: Array<{ id: string; username?: string | null }>;
  /** descendant agent id → the direct child of `agentId` whose subtree contains it */
  childOf: Map<string, string>;
  activity: PlayerDomainActivity[];
}): { directPlayers: PlayerContribution[]; subAgents: SubAgentContribution[]; totals: ContributionTotals } {
  const byPlayer = new Map<number, DomainTriple>();
  const active = new Set<number>();
  const activityVia = new Map<number, string | null>();
  for (const a of params.activity) {
    if (!isShareDomain(a.domain)) continue;
    active.add(a.playerId);
    if (!activityVia.has(a.playerId) && a.viaAgentId !== undefined) activityVia.set(a.playerId, a.viaAgentId ?? null);
    const triple = byPlayer.get(a.playerId) ?? emptyTriple();
    const cell = triple[a.domain];
    const ggr = Number(a.ggr) || 0;
    const share = Number(a.share) || 0;
    cell.pl = round2(cell.pl - ggr);
    cell.share = round2(cell.share + share);
    cell.cutAmount = round2(cell.cutAmount + (ggr - share));
    byPlayer.set(a.playerId, triple);
  }

  // One row per player: direct route first, then the order given; then any
  // player that only shows up in the activity.
  const ordered = [...params.players].sort((a, b) => (a.route === b.route ? 0 : a.route === 'direct' ? -1 : 1));
  const listed = new Set(ordered.map((p) => p.playerId));
  for (const playerId of active) {
    if (listed.has(playerId)) continue;
    ordered.push({ playerId, name: null, username: null, status: null, viaAgentId: activityVia.get(playerId) ?? null, route: 'direct' });
  }
  const seen = new Set<number>();
  const childIds = new Set(params.children.map((c) => c.id));
  const childName = new Map(params.children.map((c) => [c.id, c.username ?? null]));
  const directPlayers: PlayerContribution[] = [];
  const childPlayers = new Map<string, PlayerContribution[]>();

  for (const p of ordered) {
    if (seen.has(p.playerId)) continue;
    seen.add(p.playerId);
    const isActive = (p.status ?? '').toLowerCase() === 'active';
    if (!isActive && !active.has(p.playerId)) continue;
    const triple = byPlayer.get(p.playerId) ?? emptyTriple();
    const pl = round2(triple.sports.pl + triple.casino.pl + triple.matka.pl);
    const share = round2(triple.sports.share + triple.casino.share + triple.matka.share);
    const via = activityVia.get(p.playerId) ?? p.viaAgentId ?? params.agentId;
    const child = via === params.agentId ? null : params.childOf.get(via) ?? null;
    const bucket = child && childIds.has(child) ? child : null;
    const row: PlayerContribution = {
      playerId: p.playerId,
      playerName: p.name,
      playerUsername: p.username,
      pl,
      share,
      domainBreakdown: triple,
      contributionPercentage: 0,
      isDirectPlayer: bucket === null,
      ...(bucket ? { subAgentId: bucket, subAgentName: childName.get(bucket) ?? undefined } : {}),
    };
    if (bucket) {
      const list = childPlayers.get(bucket) ?? [];
      list.push(row);
      childPlayers.set(bucket, list);
    } else {
      directPlayers.push(row);
    }
  }

  const subAgents: SubAgentContribution[] = params.children.map((c) => {
    const players = childPlayers.get(c.id) ?? [];
    const breakdown = emptyTriple();
    for (const p of players) {
      for (const d of SHARE_DOMAINS) {
        breakdown[d].pl = round2(breakdown[d].pl + p.domainBreakdown[d].pl);
        breakdown[d].share = round2(breakdown[d].share + p.domainBreakdown[d].share);
        breakdown[d].cutAmount = round2(breakdown[d].cutAmount + p.domainBreakdown[d].cutAmount);
      }
    }
    return {
      subAgentId: c.id,
      subAgentName: c.username ?? null,
      subAgentUsername: c.username || null,
      totalPL: round2(breakdown.sports.pl + breakdown.casino.pl + breakdown.matka.pl),
      totalShare: round2(breakdown.sports.share + breakdown.casino.share + breakdown.matka.share),
      playerCount: players.length,
      domainBreakdown: breakdown,
      contributionPercentage: 0,
      players,
    };
  });

  const directPL = round2(directPlayers.reduce((s, p) => s + p.pl, 0));
  const directShare = round2(directPlayers.reduce((s, p) => s + p.share, 0));
  const subAgentPL = round2(subAgents.reduce((s, a) => s + a.totalPL, 0));
  const subAgentShare = round2(subAgents.reduce((s, a) => s + a.totalShare, 0));
  const totalPL = directPL + subAgentPL;
  for (const p of directPlayers) {
    p.contributionPercentage = totalPL !== 0 ? (Math.abs(p.pl) / Math.abs(totalPL)) * 100 : 0;
  }
  for (const s of subAgents) {
    s.contributionPercentage = totalPL !== 0 ? (Math.abs(s.totalPL) / Math.abs(totalPL)) * 100 : 0;
    for (const p of s.players) {
      p.contributionPercentage = s.totalPL !== 0 ? (Math.abs(p.pl) / Math.abs(s.totalPL)) * 100 : 0;
    }
  }

  return {
    directPlayers,
    subAgents,
    totals: {
      directPL,
      subAgentPL,
      directShare,
      subAgentShare,
      directPlayersCount: directPlayers.length,
      subAgentsCount: subAgents.length,
    },
  };
}

/**
 * The players of a set of agents (the agent's subtree, self included), with the
 * one agent each belongs to — the SHARE base's attribution rule
 * (commissionPlayerScope: COALESCE(users.agent_id, confirmed referrer's
 * agent_id)). Routes are the shared two (closure-table subtree via users.agent_id,
 * confirmed referral_attributions); a referred player with its own agent stays
 * with that agent.
 */
export function scopedPlayersQuery(agentIds: string[], tenant: string) {
  return withReferralScope(
    db
      .select({
        playerId: users.id,
        name: users.name,
        username: users.username,
        status: users.status,
        ownAgentId: users.agentId,
        viaAgentId: attributedAgentId,
      })
      .from(users),
    tenant
  ).where(and(eq(users.tenant, tenant), inArray(attributedAgentId, agentIds)));
}

export interface SettlementContributionDeps {
  rateRows?: (agentId: string, domain: ShareDomain) => Promise<RateRow[]>;
}

export class SettlementContributionService {
  private agentsRepo: AgentsRepo;
  private rateRows: (agentId: string, domain: ShareDomain) => Promise<RateRow[]>;

  constructor(deps: SettlementContributionDeps = {}) {
    this.agentsRepo = new AgentsRepo();
    const history = new AgentRateHistoryRepo();
    this.rateRows = deps.rateRows ?? ((agentId, domain) => history.listRows('sharing', agentId, domain));
  }

  /**
   * Player and sub-agent contributions to an agent's SHARING settlement for the
   * half-open window [periodFrom, periodTo).
   *
   * Same scope, window and maths as the SHARE the settlement posts (LiveGGRReader,
   * 'downline' scope), so the shares add up to it:
   *  - players: every player attributed to an agent of the subtree (closure
   *    table), by users.agent_id or a confirmed referral (decision 3), each once;
   *    inactive/suspended players included when they bet in the window. Before:
   *    direct children's direct ACTIVE players only, users.agent_id only;
   *  - GGR: LiveGGRReader's formulas and filters (settled bets, createdAt in
   *    [from, to), whitelabel filter, casino cash wallet only). Before: the sports
   *    `pl` column, lte(to) and no whitelabel filter;
   *  - share: the agent's rate per rate segment (a mid-window rate change is
   *    prorated by bet time), only for its allowed domains — the SHARE domains.
   */
  async getPlayerContributions(
    agentId: string,
    periodFrom: Date,
    periodTo: Date,
    tenant: string
  ): Promise<{
    directPlayers: PlayerContribution[];
    subAgents: SubAgentContribution[];
    totals: ContributionTotals;
  }> {
    const agent = await this.agentsRepo.findById(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }
    const t = agent.tenantId || tenant;
    const subtree = await this.agentsRepo.getDescendantIds(agentId);

    const playerRows: any[] = await scopedPlayersQuery(subtree, t);
    const players: ScopedPlayerRow[] = playerRows
      .map((r) => ({
        playerId: Number(r.playerId),
        name: r.name ?? null,
        username: r.username ?? null,
        status: r.status ?? null,
        viaAgentId: r.viaAgentId != null ? String(r.viaAgentId) : null,
        route: (r.ownAgentId != null ? 'direct' : 'referral') as 'direct' | 'referral',
      }))
      .filter((p) => Number.isFinite(p.playerId));

    const children = await this.agentsRepo.listChildren(agentId);
    const childOf = new Map<string, string>();
    if (children.length > 0) {
      const rows = await db
        .select({ ancestorId: agentHierarchyClosure.ancestorId, descendantId: agentHierarchyClosure.descendantId })
        .from(agentHierarchyClosure)
        .where(inArray(agentHierarchyClosure.ancestorId, children.map((c) => c.id)));
      for (const c of children) childOf.set(c.id, c.id);
      for (const r of rows) childOf.set(r.descendantId, r.ancestorId);
    }

    const allowed = new Set(((agent.allowedDomains ?? []) as string[]).filter(isShareDomain));
    const activity: PlayerDomainActivity[] = [];
    for (const d of SHARE_DOMAINS) {
      const segments: RateSegment[] = allowed.has(d)
        ? rateSegments(await this.rateRows(agentId, d), periodFrom, periodTo)
        : periodTo.getTime() > periodFrom.getTime()
          ? [{ from: periodFrom, to: periodTo, rate: 0 }]
          : [];
      const perPlayer = new Map<number, { ggr: number; share: number; via: string | null }>();
      for (const seg of segments) {
        const rows = await this.ggrByPlayer(d, subtree, t, seg.from, seg.to);
        for (const r of rows) {
          const acc = perPlayer.get(r.playerId) ?? { ggr: 0, share: 0, via: r.viaAgentId };
          acc.ggr += r.ggr;
          acc.share += r.ggr * seg.rate;
          perPlayer.set(r.playerId, acc);
        }
      }
      for (const [playerId, acc] of perPlayer) {
        activity.push({ playerId, domain: d, ggr: round2(acc.ggr), share: round2(acc.share), viaAgentId: acc.via });
      }
    }

    return assembleContributions({
      agentId,
      players,
      children: children.map((c) => ({ id: c.id, username: c.username ?? null })),
      childOf,
      activity,
    });
  }

  /**
   * Per-player operator GGR (stakes − payouts) for one domain over [from, to),
   * for the players attributed to `agentIds`. The expressions, joins and filters
   * mirror LiveGGRReader.domainRows exactly (the SHARE base), grouped by player
   * instead of by cycle; keep the two in step.
   */
  private async ggrByPlayer(
    domain: ShareDomain,
    agentIds: string[],
    tenant: string,
    from: Date,
    to: Date
  ): Promise<Array<{ playerId: number; viaAgentId: string | null; ggr: number }>> {
    if (agentIds.length === 0) return [];
    let rows: Array<{ playerId: number | null; viaAgentId: string | null; totalStakes: number; totalPayouts: number }>;
    if (domain === 'sports') {
      rows = await withReferralScope(
        db
          .select({
            playerId: sportsBets.userId,
            viaAgentId: attributedAgentId,
            totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
            totalPayouts: sportsPayoutAggregateSql(),
          })
          .from(sportsBets)
          .leftJoin(users, eq(sportsBets.userId, users.id)),
        tenant
      )
        .where(
          and(
            eq(sportsBets.tenant, tenant),
            gte(sportsBets.createdAt, from),
            lt(sportsBets.createdAt, to),
            inArray(attributedAgentId, agentIds),
            inArray(sportsBets.status, ['won', 'lost', 'settled']),
            eq(sportsBets.whitelabelId, tenant)
          )
        )
        .groupBy(sql`1`, sql`2`);
    } else if (domain === 'casino') {
      rows = await withReferralScope(
        db
          .select({
            playerId: casinoBets.userId,
            viaAgentId: attributedAgentId,
            totalStakes: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN ${casinoBets.stake}::numeric ELSE 0 END), 0)`,
            totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0) ELSE 0 END), 0)`,
          })
          .from(casinoBets)
          .leftJoin(users, eq(casinoBets.userId, users.id)),
        tenant
      )
        .where(
          and(
            eq(casinoBets.tenant, tenant),
            eq(casinoBets.walletType, 'cash'),
            gte(casinoBets.createdAt, from),
            lt(casinoBets.createdAt, to),
            inArray(attributedAgentId, agentIds),
            inArray(casinoBets.status, ['won', 'lost']),
            eq(casinoBets.whitelabelId, tenant)
          )
        )
        .groupBy(sql`1`, sql`2`);
    } else {
      rows = await withReferralScope(
        db
          .select({
            playerId: matkaBets.userId,
            viaAgentId: attributedAgentId,
            totalStakes: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} IN ('won', 'lost') THEN ${matkaBets.betAmount}::numeric ELSE 0 END), 0)`,
            totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} = 'won' THEN ${matkaBets.actualWin}::numeric ELSE 0 END), 0)`,
          })
          .from(matkaBets)
          .leftJoin(users, eq(matkaBets.userId, users.id)),
        tenant
      )
        .where(
          and(
            eq(matkaBets.tenant, tenant),
            gte(matkaBets.createdAt, from),
            lt(matkaBets.createdAt, to),
            inArray(attributedAgentId, agentIds),
            inArray(matkaBets.status, ['won', 'lost']),
            eq(matkaBets.whitelabelId, tenant)
          )
        )
        .groupBy(sql`1`, sql`2`);
    }
    return rows
      .filter((r) => r.playerId != null)
      .map((r) => ({
        playerId: Number(r.playerId),
        viaAgentId: r.viaAgentId != null ? String(r.viaAgentId) : null,
        ggr: Number(r.totalStakes ?? 0) - Number(r.totalPayouts ?? 0),
      }));
  }
}
