import { liquidityReport, exposureReport, pnlReport } from '@/stores/index.js';
import * as sportsReportingRepo from '@/repos/reporting/sportsReportingRepo.js';
import * as casinoReportingRepo from '@/repos/reporting/casinoReportingRepo.js';
import * as matkaReportingRepo from '@/repos/reporting/matkaReportingRepo.js';
import * as agentReportingRepo from '@/repos/reporting/agentReportingRepo.js';
import { getPostedPerformanceCommissions } from '@/repos/reporting/agentPerformanceReads.js';
import * as bonusReportingRepo from '@/repos/reporting/bonusReportingRepo.js';
import * as exposureReportingRepo from '@/repos/reporting/exposureReportingRepo.js';
import * as pnlReportingRepo from '@/repos/reporting/pnlReportingRepo.js';
import { db } from '@/db/client.js';
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js';
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';
import {
  reportingSavedReports,
  reportingExportJobs,
  reportingDailySnapshots,
  users,
} from '@shared/db/schema.js';
import { eq, and, desc, gte, lte, sql, isNotNull, isNull, inArray } from 'drizzle-orm';
import { sportsEventsTable, sportsLeaguesTable, sportsTable } from '@shared/db/schema.js';
import { normalizeCreatedByForReporting } from './reportingResolverUtils.js';
import { generatePresignedGetUrl } from '@/services/storage/s3.js';
import { requireReadPermission, hasPermission } from '@src/domains/common/auth.js'
import { resolveAgentPerformanceParent } from './agentReportScope.js'
import { inAgentPlayers } from '@/repos/reporting/agentPlayerScope.js'
import { countAgentExportRowsForCaller } from '@src/domains/reporting/services/agentExportScope.js'

/**
 * Helper to get agentId from context and apply to filter
 * CRITICAL: Also applies Director Admin mode tenant filtering
 * ENHANCED: Now includes agent scheme type for scheme-aware reporting
 */
function applyAgentFilter(filter: any, ctx: any) {
  // CRITICAL: For Director Admin, use effective tenant based on mode
  const directorTenant = getEffectiveTenantForDirector(ctx)
  const effectiveTenant = directorTenant ?? (ctx?.tenant ?? 'default')
  // For whitelabelId, use directorTenant only if it's set (for director mode), otherwise use whitelabel from context
  const effectiveWhitelabelId = directorTenant || ctx?.whitelabel?.id || ctx?.whitelabelId
  
  // If agent is logged in, automatically filter by their agentId
  // Security: Always use logged-in agent's ID, ignore any provided agentId
  // ENHANCED: Include schemeType and allowedDomains for scheme-aware filtering
  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
    return {
      ...filter,
      tenant: effectiveTenant,
      whitelabelId: effectiveWhitelabelId,
      agentId: ctx.user.agentId, // Always use logged-in agent's ID (ignore filter.agentId for security)
      agentSchemeType: ctx.user.agentSchemeType, // 'COMMISSION' | 'SHARING' | 'CREDIT'
      agentAllowedDomains: ctx.user.agentAllowedDomains, // ['sports', 'casino', 'matka']
    }
  }
  
  // Apply Director Admin mode tenant filtering
  return {
    ...filter,
    tenant: effectiveTenant,
    whitelabelId: effectiveWhitelabelId,
  }
}

/**
 * Parse dateFrom / dateTo from filter using tenant timezone (IST-safe).
 * Returns { dateFrom?: Date; dateTo?: Date } suitable for spreading into repo params.
 */
async function parseDatesFromFilter(filter: any, ctx: any): Promise<{ dateFrom?: Date; dateTo?: Date }> {
  const tenant = filter?.tenant || ctx?.tenant || 'default';
  const tz = await getWhitelabelTimezone(tenant);
  return {
    dateFrom: filter?.dateFrom ? parseDateFrom(filter.dateFrom, tz) : undefined,
    dateTo: filter?.dateTo ? parseDateTo(filter.dateTo, tz) : undefined,
  };
}

/**
 * True when a non-agent, non-platform caller names an agent of another tenant.
 * Agent callers are already pinned to their own id by the resolvers below.
 */
function agentOutsideCallerTenant(ctx: any, agentTenant: string | null | undefined, requestTenant: string): boolean {
  if (ctx?.user?.type === 'agent') return false
  if (hasPermission(ctx?.permissions ?? [], 'all', '*')) return false
  return !!agentTenant && agentTenant.trim() !== requestTenant
}

// Legacy resolvers (kept for backward compatibility)
export const reportingQueryResolvers = {
  liquidity: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.exposure', 'view')
    // Legacy mock report - returns random data
    // TODO: When replacing with real data source, implement agent-specific filtering:
    // - If ctx?.user?.type === 'agent', filter by agent's players
    // - Use agentReportingRepo or player queries filtered by agentId
    return liquidityReport(args.range ?? '7')
  },
  exposure: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.exposure', 'view')
    const filter = applyAgentFilter({}, ctx);
    const range = args.range ?? '7';
    const days = parseInt(range) || 7;
    
    const tenant = filter.tenant || ctx?.tenant || 'default';
    const whitelabelId = filter.whitelabelId || ctx?.whitelabel?.id;
    const tz = await getWhitelabelTimezone(tenant);

    // Use provided dates or calculate from range
    const dateFrom = args.dateFrom 
      ? parseDateFrom(args.dateFrom, tz) 
      : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const dateTo = args.dateTo 
      ? parseDateTo(args.dateTo, tz) 
      : new Date();

    if (!whitelabelId) {
      return [];
    }

    return await exposureReportingRepo.getExposureData({
      tenant,
      whitelabelId,
      dateFrom,
      dateTo,
      domain: (args.domain || filter.domain || 'all') as 'sports' | 'casino' | 'matka' | 'all',
      currency: args.currency || filter.currency,
      agentId: filter.agentId,
    });
  },
  pnl: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.pnl', 'view')
    const filter = applyAgentFilter({}, ctx);
    const range = args.range ?? '7';
    const days = parseInt(range) || 7;
    
    const tenant = filter.tenant || ctx?.tenant || 'default';
    const whitelabelId = filter.whitelabelId || ctx?.whitelabel?.id;
    const tz = await getWhitelabelTimezone(tenant);

    // Use provided dates or calculate from range
    const dateFrom = args.dateFrom 
      ? parseDateFrom(args.dateFrom, tz) 
      : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const dateTo = args.dateTo 
      ? parseDateTo(args.dateTo, tz) 
      : new Date();

    if (!whitelabelId) {
      return [];
    }

    return await pnlReportingRepo.getPNLData({
      tenant,
      whitelabelId,
      dateFrom,
      dateTo,
      domain: (args.domain || filter.domain || 'all') as 'sports' | 'casino' | 'matka' | 'all',
      currency: args.currency || filter.currency,
      agentId: filter.agentId,
    });
  },

  // Sports Reporting
  sportsKPIs: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.sports', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    const tenant = filter.tenant || ctx?.tenant || 'default';
    const whitelabelId = filter.whitelabelId || ctx?.whitelabel?.id;

    if (!whitelabelId) {
      return {
        totalStakes: 0,
        totalPayouts: 0,
        totalExposure: 0,
        grossGamingRevenue: 0,
        netRevenue: 0,
        holdPercentage: 0,
        betCount: 0,
        playerCount: 0,
        activePlayerCount: 0,
      };
    }

    return await sportsReportingRepo.getSportsKPIs({
      tenant,
      whitelabelId,
      agentId: filter.agentId, // Pass agentId to filter by agent's players
      sportId: filter.sportId,
      leagueId: filter.leagueId,
      eventId: filter.eventId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  sportsTrends: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.sports', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await sportsReportingRepo.getSportsTrends({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      sportId: filter.sportId,
      leagueId: filter.leagueId,
      eventId: filter.eventId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  sportsBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.sports', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    const dimension = args.dimension as 'sport' | 'league' | 'event';
    return await sportsReportingRepo.getSportsBreakdown(
      {
        tenant: filter.tenant || ctx?.tenant || 'default',
        whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
        agentId: filter.agentId,
        sportId: filter.sportId,
        leagueId: filter.leagueId,
        eventId: filter.eventId,
        ...(await parseDatesFromFilter(filter, ctx)),
        currency: filter.currency,
      },
      dimension,
    );
  },

  topSportsEvents: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.sports', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    const limit = args.limit || 10;
    return await sportsReportingRepo.getTopSportsEvents(
      {
        tenant: filter.tenant || ctx?.tenant || 'default',
        whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
        agentId: filter.agentId,
        sportId: filter.sportId,
        leagueId: filter.leagueId,
        eventId: filter.eventId,
        ...(await parseDatesFromFilter(filter, ctx)),
        currency: filter.currency,
      },
      limit,
    );
  },

  // Casino Reporting
  casinoKPIs: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.casino', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await casinoReportingRepo.getCasinoKPIs({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  casinoTrends: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.casino', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await casinoReportingRepo.getCasinoTrends({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  // Matka Reporting
  matkaKPIs: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.matka', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await matkaReportingRepo.getMatkaKPIs({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  matkaTrends: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.matka', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await matkaReportingRepo.getMatkaTrends({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  // Agent Reporting (commission uses unified read: earnedPosted from ledger)
  agentKPIs: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.agent-overview', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    const result = await agentReportingRepo.getAgentKPIs({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      domain: filter.domain as 'sports' | 'casino' | 'matka' | undefined,
      currency: filter.currency,
    });
    if (filter.agentId && result) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
      const { AgentLedgerRepo } = await import('@/repos/agents/AgentLedgerRepo.js');
      const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
      const agent = await new AgentsRepo().findById(filter.agentId);
      if (agent?.schemeType === 'COMMISSION') {
        const tenant = filter.tenant || ctx?.tenant || 'default';
        const currency = filter.currency || await getWhitelabelCurrency(tenant);
        const periodTz = await getWhitelabelTimezone(tenant);
        const periodFrom = filter.dateFrom ? parseDateFrom(filter.dateFrom, periodTz) : new Date(0);
        const periodTo = filter.dateTo ? parseDateTo(filter.dateTo, periodTz) : new Date();
        // This column displays posted ledger earnings, not calculated payable.
        result.commissionEarned = await new AgentLedgerRepo().getEarnedPostedSum(filter.agentId, { from: periodFrom, to: periodTo, currency });
      }
    }
    return result;
  },

  agentPerformance: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.agents-performance', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    const limit = args.limit || 50;
    // Never the client's parentAgentId as given: an agent caller is pinned to its
    // own subtree (and never falls into the whitelabel-wide branch); an admin's
    // choice must belong to its own tenant. See agentReportScope.ts.
    const parentAgentId = await resolveAgentPerformanceParent(ctx, filter.parentAgentId, filter.tenant || ctx?.tenant || 'default');
    const result = await agentReportingRepo.getAgentPerformance(
      {
        tenant: filter.tenant || ctx?.tenant || 'default',
        whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
        agentId: filter.agentId,
        parentAgentId,
        schemeType: filter.schemeType as 'COMMISSION' | 'SHARING' | 'CREDIT' | undefined,
        ...(await parseDatesFromFilter(filter, ctx)),
        domain: filter.domain as 'sports' | 'casino' | 'matka' | undefined,
        currency: filter.currency,
      },
      limit,
    );
    if (result?.agents?.length) {
      const commissionAgents = result.agents.filter((a: any) => a.schemeType === 'COMMISSION');
      if (commissionAgents.length > 0) {
        const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
        const tenant = filter.tenant || ctx?.tenant || 'default';
        const currency = filter.currency || await getWhitelabelCurrency(tenant);
        const periodTz = await getWhitelabelTimezone(tenant);
        const periodFrom = filter.dateFrom ? parseDateFrom(filter.dateFrom, periodTz) : new Date(0);
        const periodTo = filter.dateTo ? parseDateTo(filter.dateTo, periodTz) : new Date();
        const posted = await getPostedPerformanceCommissions(tenant, commissionAgents.map(row => row.agentId), currency, periodFrom, periodTo);
        for (const row of commissionAgents) row.commissionEarned = posted.get(row.agentId) ?? 0;
        if (result.totals) {
          result.totals.commissionEarned = result.agents.reduce((s: number, a: any) => s + (a.commissionEarned ?? 0), 0);
        }
      }
    }
    return result;
  },

  agentTrends: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.agent-overview', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await agentReportingRepo.getAgentTrends({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      domain: filter.domain as 'sports' | 'casino' | 'matka' | undefined,
      currency: filter.currency,
    });
  },

  bonusKPIs: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.bonus-overview', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    const tenant = filter.tenant || ctx?.tenant || 'default';

    const rawCampaign = filter.campaignId;
    let campaignId: number | undefined;
    if (rawCampaign != null && rawCampaign !== '') {
      const n = Number(rawCampaign);
      if (Number.isFinite(n)) campaignId = n;
    }

    return await bonusReportingRepo.getBonusKPIs({
      tenant,
      // Set only for an agent caller (applyAgentFilter); was dropped here, so an
      // agent read the whole whitelabel's bonus figures.
      agentId: filter.agentId,
      campaignId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
      domain: filter.domain as 'sports' | 'casino' | 'matka' | 'global' | undefined,
    });
  },

  // Saved Reports
  savedReports: async (_: any, args: any, context: any) => {
    requireReadPermission(context, 'reporting.exports', 'view')
    const tenant = context?.tenant || 'default';
    const whitelabelId = context?.whitelabelId || context?.whitelabel?.id || 'default';
    const createdByRaw = context?.userId || context?.user?.id || context?.user?.sub || context?.user?.agentId;

    const conditions = [eq(reportingSavedReports.tenant, tenant)];
    if (whitelabelId) {
      conditions.push(eq(reportingSavedReports.whitelabelId, whitelabelId));
    }
    if (createdByRaw !== undefined && createdByRaw !== null) {
      conditions.push(eq(reportingSavedReports.createdBy, normalizeCreatedByForReporting(createdByRaw)));
    }

    const reports = await db
      .select()
      .from(reportingSavedReports)
      .where(and(...conditions.filter(Boolean)))
      .orderBy(desc(reportingSavedReports.updatedAt));

    return reports.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || undefined,
      reportType: r.reportType,
      filtersJson: r.filtersJson,
      isPinned: r.isPinned,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  },

  // Export Jobs
  exportJobs: async (_: any, args: any, context: any) => (await loadExportJobsPage(args, context)).items,
  exportJobsPage: async (_: any, args: any, context: any) => loadExportJobsPage(args, context),

  exportJobDownloadUrl: async (_: any, args: any, context: any) => {
    requireReadPermission(context, 'reporting.exports', 'view')
    const tenant = context?.tenant || 'default';
    const whitelabelId = context?.whitelabelId || context?.whitelabel?.id || 'default';
    let createdByRaw = context?.userId || context?.user?.id || context?.user?.sub || context?.user?.agentId;
    let createdBy: number | undefined = undefined;
    if (createdByRaw !== undefined && createdByRaw !== null) {
      if (typeof createdByRaw === 'number') {
        createdBy = createdByRaw;
      } else if (typeof createdByRaw === 'string') {
        const parsed = Number(createdByRaw);
        if (Number.isFinite(parsed) && parsed > 0) {
          createdBy = parsed;
        } else {
          let hash = 0;
          for (let i = 0; i < createdByRaw.length; i++) {
            const char = createdByRaw.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          createdBy = Math.abs(hash);
        }
      }
    }
    const jobId = args.jobId;
    const rows = await db
      .select()
      .from(reportingExportJobs)
      .where(eq(reportingExportJobs.id, jobId))
      .limit(1);
    const job = rows[0];
    if (!job) {
      throw new Error('Export job not found');
    }
    if (job.tenant !== tenant) {
      throw new Error('Export job not found');
    }
    if (whitelabelId && job.whitelabelId !== whitelabelId) {
      throw new Error('Export job not found');
    }
    if (createdBy !== undefined && job.createdBy !== createdBy) {
      throw new Error('Export job not found');
    }
    const fileUrl = job.fileUrl;
    if (!fileUrl) {
      throw new Error('Export file is not available');
    }
    // If stored value is S3 key (new jobs), return fresh presigned URL; else return as-is (legacy full URL)
    if (fileUrl.startsWith('exports/')) {
      return await generatePresignedGetUrl(fileUrl, 3600);
    }
    return fileUrl;
  },

  // The Export Center's row estimate for an agent: the COUNT of the same agent-scoped SQL the
  // export runs (agentExportScope.countAgentExportRows), capped like the file. Null for admins,
  // whose estimates keep their own queries.
  agentExportRowCount: async (_: any, args: any, context: any) => {
    requireReadPermission(context, 'reporting.exports', 'view')
    return countAgentExportRowsForCaller(context, args?.reportType, args?.filtersJson)
  },

  // Sports Drill-Down Queries
  sportsLeagueBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.sports', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await sportsReportingRepo.getSportsLeagueBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      sportId: filter.sportId,
      leagueId: filter.leagueId,
      eventId: filter.eventId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  sportsEventBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.sports', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await sportsReportingRepo.getSportsEventBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      sportId: filter.sportId,
      leagueId: filter.leagueId,
      eventId: filter.eventId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  sportsMarketBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.sports', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    if (!filter.eventId) return [];
    try {
      return await sportsReportingRepo.getSportsMarketBreakdown({
        tenant: filter.tenant || ctx?.tenant || 'default',
        whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
        agentId: filter.agentId,
        sportId: filter.sportId,
        leagueId: filter.leagueId,
        eventId: String(filter.eventId),
        dateFrom: filter.dateFrom ?? undefined,
        dateTo: filter.dateTo ?? undefined,
        currency: filter.currency,
      });
    } catch (error: any) {
      const cause = error?.cause || error;
      throw error;
    }
  },

  sportsAgentBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.sports', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return sportsReportingRepo.getSportsAgentBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      sportId: filter.sportId,
      leagueId: filter.leagueId,
      eventId: filter.eventId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  sportsPlayerBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.sports', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await sportsReportingRepo.getSportsPlayerBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      sportId: filter.sportId,
      leagueId: filter.leagueId,
      eventId: filter.eventId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  // Casino Drill-Down Queries
  casinoProviderBreakdown: async (_: any, args: any, ctx: any) => {
    // The one casino drill-down that checked nothing; the rest demand this.
    requireReadPermission(ctx, 'reporting.casino', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await casinoReportingRepo.getCasinoProviderBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      providerId: filter.providerId,
      vendorId: filter.vendorId,
      gameId: filter.gameId,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  casinoVendorBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.casino', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await casinoReportingRepo.getCasinoVendorBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      providerId: filter.providerId,
      vendorId: filter.vendorId,
      gameId: filter.gameId,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  casinoGameBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.casino', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await casinoReportingRepo.getCasinoGameBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      providerId: filter.providerId,
      vendorId: filter.vendorId,
      gameId: filter.gameId,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  casinoAgentBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.casino', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await casinoReportingRepo.getCasinoAgentBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      providerId: filter.providerId,
      vendorId: filter.vendorId,
      gameId: filter.gameId,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  casinoPlayerBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.casino', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await casinoReportingRepo.getCasinoPlayerBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      providerId: filter.providerId,
      vendorId: filter.vendorId,
      gameId: filter.gameId,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  // Matka Drill-Down Queries
  matkaTypeBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.matka', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await matkaReportingRepo.getMatkaTypeBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      matkaType: filter.matkaType,
      matkaId: filter.matkaId,
      marketSession: filter.marketSession,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  matkaMarketBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.matka', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await matkaReportingRepo.getMatkaMarketBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      matkaType: filter.matkaType,
      matkaId: filter.matkaId,
      marketSession: filter.marketSession,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  matkaSessionBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.matka', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await matkaReportingRepo.getMatkaSessionBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      matkaType: filter.matkaType,
      matkaId: filter.matkaId,
      marketSession: filter.marketSession,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  matkaAgentBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.matka', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await matkaReportingRepo.getMatkaAgentBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      matkaType: filter.matkaType,
      matkaId: filter.matkaId,
      marketSession: filter.marketSession,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  matkaPlayerBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.matka', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await matkaReportingRepo.getMatkaPlayerBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      matkaType: filter.matkaType,
      matkaId: filter.matkaId,
      marketSession: filter.marketSession,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      currency: filter.currency,
    });
  },

  // Agent Drill-Down Queries
  agentPlayerBreakdown: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'reporting.agent-overview', 'view')
    const filter = applyAgentFilter(args.filter || {}, ctx);
    return await agentReportingRepo.getAgentPlayerBreakdown({
      tenant: filter.tenant || ctx?.tenant || 'default',
      whitelabelId: filter.whitelabelId || ctx?.whitelabel?.id,
      agentId: filter.agentId,
      ...(await parseDatesFromFilter(filter, ctx)),
      domain: filter.domain as 'sports' | 'casino' | 'matka' | undefined,
      currency: filter.currency,
    });
  },

  // Agent-specific reporting queries moved to ReportingQuery type (see reportingQueryGroupResolvers below)
};

// ReportingQuery resolvers - grouped under reporting field
export const reportingQueryGroupResolvers = {
  ggrTrends: async (parent: any, { agentId, periodFrom, periodTo }: { agentId: string; periodFrom: string; periodTo: string }, ctx: any) => {
    try {
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        const loggedInAgentId = ctx.user.agentId;
        if (loggedInAgentId !== agentId) {
          throw new Error('Unauthorized: You can only access your own GGR trends');
        }
      }

      const requestTenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
      const agentsRepo = new AgentsRepo();
      const agentRecord = await agentsRepo.findById(agentId);
      const tenant = (agentRecord?.tenantId && agentRecord.tenantId.trim() !== '') ? agentRecord.tenantId : requestTenant;
      // The agent's own tenant is used for the read, so an admin naming another
      // whitelabel's agent would read that whitelabel; only a platform admin may.
      if (agentOutsideCallerTenant(ctx, tenant, requestTenant)) return [];
      const agentIds = await agentsRepo.getDescendantIds(agentId);
      const agentIdList = agentIds.length > 0 ? agentIds : [agentId];

      const { getStartOfDay, getEndOfYesterday } = await import('@src/shared/dateUtils.js');
      const tz = await (async () => {
        try {
          const z = await getWhitelabelTimezone(tenant);
          return z?.trim() || 'Asia/Kolkata';
        } catch {
          return 'Asia/Kolkata';
        }
      })();
      const dateFrom = parseDateFrom(periodFrom, tz);
      const dateTo = parseDateTo(periodTo, tz);
      const startOfToday = getStartOfDay(tz);
      const endOfYesterday = getEndOfYesterday(tz);
      const rangeIncludesToday = dateTo >= startOfToday;
      const snapshotDateTo = rangeIncludesToday ? endOfYesterday : dateTo;

      const results = await db
        .select({
          date: sql<string>`DATE(${reportingDailySnapshots.snapshotDate})`,
          sportsGGR: sql<number>`COALESCE(SUM(CASE WHEN ${reportingDailySnapshots.domain} = 'sports' THEN ${reportingDailySnapshots.grossGamingRevenue}::numeric ELSE 0 END), 0)`,
          casinoGGR: sql<number>`COALESCE(SUM(CASE WHEN ${reportingDailySnapshots.domain} = 'casino' THEN ${reportingDailySnapshots.grossGamingRevenue}::numeric ELSE 0 END), 0)`,
          matkaGGR: sql<number>`COALESCE(SUM(CASE WHEN ${reportingDailySnapshots.domain} = 'matka' THEN ${reportingDailySnapshots.grossGamingRevenue}::numeric ELSE 0 END), 0)`,
          totalGGR: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
        })
        .from(reportingDailySnapshots)
        .where(
          and(
            eq(reportingDailySnapshots.tenant, tenant),
            // The agent's players (subtree + confirmed referrals), from player-level rows: agent-level
            // rows are keyed by users.agent_id and so leave referral-linked players out.
            isNotNull(reportingDailySnapshots.playerId),
            inAgentPlayers(reportingDailySnapshots.playerId, agentId, tenant),
            gte(reportingDailySnapshots.snapshotDate, dateFrom),
            lte(reportingDailySnapshots.snapshotDate, snapshotDateTo)
          )
        )
        .groupBy(sql`DATE(${reportingDailySnapshots.snapshotDate})`)
        .orderBy(sql`DATE(${reportingDailySnapshots.snapshotDate})`);

      const points = results.map((r) => ({
        date: r.date,
        sportsGGR: Number(r.sportsGGR) || 0,
        casinoGGR: Number(r.casinoGGR) || 0,
        matkaGGR: Number(r.matkaGGR) || 0,
        totalGGR: Number(r.totalGGR) || 0,
      }));

      if (rangeIncludesToday && agentIdList.length > 0) {
        const { LiveGGRReader } = await import('@src/domains/agents/services/LiveGGRReader.js');
        const liveReader = new LiveGGRReader();
        const [sportsRes, casinoRes, matkaRes] = await Promise.all([
          liveReader.getSportsGGRByAgentIds!({ agentIds: agentIdList, tenantId: tenant, from: startOfToday, to: dateTo, whitelabelId: tenant }),
          liveReader.getCasinoGGRByAgentIds!({ agentIds: agentIdList, tenantId: tenant, from: startOfToday, to: dateTo, whitelabelId: tenant }),
          liveReader.getMatkaGGRByAgentIds!({ agentIds: agentIdList, tenantId: tenant, from: startOfToday, to: dateTo, whitelabelId: tenant }),
        ]);
        const { DateTime } = await import('luxon');
        const todayStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
        points.push({
          date: todayStr,
          sportsGGR: sportsRes.ggr || 0,
          casinoGGR: casinoRes.ggr || 0,
          matkaGGR: matkaRes.ggr || 0,
          totalGGR: (sportsRes.ggr || 0) + (casinoRes.ggr || 0) + (matkaRes.ggr || 0),
        });
      }

      return points;
    } catch (error) {
      return [];
    }
  },

  domainBreakdown: async (_: any, { agentId, periodFrom, periodTo }: { agentId: string; periodFrom: string; periodTo: string }, ctx: any) => {
    try {
      // If agent is logged in, ensure they can only access their own breakdown
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        const loggedInAgentId = ctx.user.agentId;
        if (loggedInAgentId !== agentId) {
          throw new Error('Unauthorized: You can only access your own domain breakdown');
        }
      }

      const requestTenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
      const agentsRepo = new AgentsRepo();
      const agentRecord = await agentsRepo.findById(agentId);
      const tenant = (agentRecord?.tenantId && agentRecord.tenantId.trim() !== '') ? agentRecord.tenantId : requestTenant;
      // The agent's own tenant is used for the read, so an admin naming another
      // whitelabel's agent would read that whitelabel; only a platform admin may.
      if (agentOutsideCallerTenant(ctx, tenant, requestTenant)) return [];
      const dbTz = await getWhitelabelTimezone(tenant);
      const dateFrom = parseDateFrom(periodFrom, dbTz);
      const dateTo = parseDateTo(periodTo, dbTz);

      const results = await db
        .select({
          domain: reportingDailySnapshots.domain,
          ggr: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
          totalBets: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
          totalStake: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
        })
        .from(reportingDailySnapshots)
        .where(
          and(
            eq(reportingDailySnapshots.tenant, tenant),
            // Player-level rows of the agent's players (subtree + confirmed referrals), and only
            // those, so nothing is counted twice and referral-linked players are included.
            isNotNull(reportingDailySnapshots.playerId),
            inAgentPlayers(reportingDailySnapshots.playerId, agentId, tenant),
            gte(reportingDailySnapshots.snapshotDate, dateFrom),
            lte(reportingDailySnapshots.snapshotDate, dateTo)
          )
        )
        .groupBy(reportingDailySnapshots.domain);

      const totalGGR = results.reduce((sum, r) => sum + Number(r.ggr || 0), 0);

      return results.map((r) => ({
        domain: r.domain,
        ggr: Number(r.ggr) || 0,
        percentage: totalGGR > 0 ? (Number(r.ggr) || 0) / totalGGR : 0,
        totalBets: Number(r.totalBets) || 0,
        totalStake: Number(r.totalStake) || 0,
      }));
    } catch (error) {
      return [];
    }
  },

  playerActivity: async (_: any, { agentId, periodFrom, periodTo }: { agentId: string; periodFrom: string; periodTo: string }, ctx: any) => {
    try {
      // If agent is logged in, ensure they can only access their own player activity
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        const loggedInAgentId = ctx.user.agentId;
        if (loggedInAgentId !== agentId) {
          throw new Error('Unauthorized: You can only access your own player activity');
        }
      }

      const requestTenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
      const agentsRepo = new AgentsRepo();
      const agentRecord = await agentsRepo.findById(agentId);
      const tenant = (agentRecord?.tenantId && agentRecord.tenantId.trim() !== '') ? agentRecord.tenantId : requestTenant;
      // The agent's own tenant is used for the read, so an admin naming another
      // whitelabel's agent would read that whitelabel; only a platform admin may.
      if (agentOutsideCallerTenant(ctx, tenant, requestTenant)) return [];
      const paTz = await getWhitelabelTimezone(tenant);
      const dateFrom = parseDateFrom(periodFrom, paTz);
      const dateTo = parseDateTo(periodTo, paTz);

      // One player-level row per (player, domain, day). A player active in two domains on a day is one
      // active player, so players are counted DISTINCT; "new" is a player who registered that day and
      // played. (The agent-level rows used before counted (agent, domain) rows as "new players" and
      // took the MAX of one agent's count as the day's active players, and missed referral players.)
      const results = await db
        .select({
          date: sql<string>`DATE(${reportingDailySnapshots.snapshotDate})`,
          newPlayers: sql<number>`COUNT(DISTINCT CASE WHEN DATE(${users.createdAt}) = DATE(${reportingDailySnapshots.snapshotDate}) THEN ${reportingDailySnapshots.playerId} END)`,
          activePlayers: sql<number>`COUNT(DISTINCT ${reportingDailySnapshots.playerId})`,
          totalBets: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
          totalDeposits: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
        })
        .from(reportingDailySnapshots)
        .leftJoin(users, eq(users.id, reportingDailySnapshots.playerId))
        .where(
          and(
            eq(reportingDailySnapshots.tenant, tenant),
            isNotNull(reportingDailySnapshots.playerId),
            inAgentPlayers(reportingDailySnapshots.playerId, agentId, tenant),
            gte(reportingDailySnapshots.snapshotDate, dateFrom),
            lte(reportingDailySnapshots.snapshotDate, dateTo)
          )
        )
        .groupBy(sql`DATE(${reportingDailySnapshots.snapshotDate})`)
        .orderBy(sql`DATE(${reportingDailySnapshots.snapshotDate})`);

      return results.map((r) => ({
        date: r.date,
        newPlayers: Number(r.newPlayers) || 0,
        activePlayers: Number(r.activePlayers) || 0,
        totalBets: Number(r.totalBets) || 0,
        totalDeposits: Number(r.totalDeposits) || 0,
      }));
    } catch (error) {
      return [];
    }
  },

  topPlayers: async (_: any, { agentId, periodFrom, periodTo, limit = 50 }: { agentId: string; periodFrom: string; periodTo: string; limit?: number }, ctx: any) => {
    try {
      // If agent is logged in, ensure they can only access their own top players
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        const loggedInAgentId = ctx.user.agentId;
        if (loggedInAgentId !== agentId) {
          throw new Error('Unauthorized: You can only access your own top players');
        }
      }

    const tenant = ctx?.tenant || 'default';
    const tpTz = await getWhitelabelTimezone(tenant);
    const dateFrom = parseDateFrom(periodFrom, tpTz);
    const dateTo = parseDateTo(periodTo, tpTz);

    const results = await db
      .select({
        playerId: reportingDailySnapshots.playerId,
        totalGGR: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
        totalBets: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
        totalStake: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
        totalPayout: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalPayouts}::numeric), 0)`,
      })
      .from(reportingDailySnapshots)
      .where(
        and(
          eq(reportingDailySnapshots.tenant, tenant),
          inAgentPlayers(reportingDailySnapshots.playerId, agentId, tenant), // whole subtree + referral players, not only direct ones
          isNotNull(reportingDailySnapshots.playerId),
          gte(reportingDailySnapshots.snapshotDate, dateFrom),
          lte(reportingDailySnapshots.snapshotDate, dateTo)
        )
      )
      .groupBy(reportingDailySnapshots.playerId)
      .orderBy(sql`SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric) DESC`)
      .limit(limit);

    // Get player usernames and status
    const playerIds = results.map(r => r.playerId).filter(Boolean) as number[];
    let playerMap = new Map<number, { username: string; name: string; status: string }>();
    
    if (playerIds.length > 0) {
      const playerData = await db
        .select({ id: users.id, username: users.username, name: users.name, status: users.status })
        .from(users)
        .where(inArray(users.id, playerIds));
      
      playerMap = new Map(playerData.map(p => [
        p.id,
        {
          username: p.username || `player_${p.id}`,
          name: p.name || p.username || `Player ${p.id}`,
          status: p.status || 'ACTIVE',
        }
      ]));
    }

    // Get last bet dates from reportingDailySnapshots
    const lastBetDates = await db
      .select({
        playerId: reportingDailySnapshots.playerId,
        lastBetDate: sql<string>`MAX(${reportingDailySnapshots.snapshotDate})`,
      })
      .from(reportingDailySnapshots)
      .where(
        and(
          eq(reportingDailySnapshots.tenant, tenant),
          inAgentPlayers(reportingDailySnapshots.playerId, agentId, tenant), // whole subtree + referral players, not only direct ones
          isNotNull(reportingDailySnapshots.playerId),
          inArray(reportingDailySnapshots.playerId, playerIds),
          gte(reportingDailySnapshots.snapshotDate, dateFrom),
          lte(reportingDailySnapshots.snapshotDate, dateTo)
        )
      )
      .groupBy(reportingDailySnapshots.playerId);

    const lastBetMap = new Map<number, string>();
    lastBetDates.forEach((d) => {
      if (d.playerId) {
        lastBetMap.set(d.playerId, d.lastBetDate);
      }
    });

    return results.map((r) => {
      const playerId = r.playerId;
      const playerInfo = playerMap.get(playerId || 0) || {
        username: `player_${playerId}`,
        name: `Player ${playerId}`,
        status: 'ACTIVE',
      };
      const totalStake = Number(r.totalStake) || 0;
      const totalPayout = Number(r.totalPayout) || 0;
      const winRate = totalStake > 0 ? (totalPayout / totalStake) : 0;
      const avgBetSize = (Number(r.totalBets) || 0) > 0 ? totalStake / (Number(r.totalBets) || 1) : 0;

      return {
        playerId: String(playerId || ''),
        playerName: playerInfo.name,
        username: playerInfo.username,
        totalGGR: Number(r.totalGGR) || 0,
        totalBets: Number(r.totalBets) || 0,
        totalStake,
        totalPayout,
        winRate,
        avgBetSize,
        status: playerInfo.status,
        lastBetAt: lastBetMap.get(playerId || 0) || periodTo,
      };
    });
    } catch (error) {
      return [];
    }
  },

  topEvents: async (_: any, { agentId, periodFrom, periodTo, domain, limit = 50 }: { agentId: string; periodFrom: string; periodTo: string; domain?: string; limit?: number }, ctx: any) => {
    try {
      // If agent is logged in, ensure they can only access their own top events
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        const loggedInAgentId = ctx.user.agentId;
        if (loggedInAgentId !== agentId) {
          throw new Error('Unauthorized: You can only access your own top events');
        }
      }

    const tenant = ctx?.tenant || 'default';
    const teTz = await getWhitelabelTimezone(tenant);
    const dateFrom = parseDateFrom(periodFrom, teTz);
    const dateTo = parseDateTo(periodTo, teTz);

    const conditions = [
      eq(reportingDailySnapshots.tenant, tenant),
      inAgentPlayers(reportingDailySnapshots.playerId, agentId, tenant), // whole subtree + referral players, not only direct ones
      isNotNull(reportingDailySnapshots.eventId),
      gte(reportingDailySnapshots.snapshotDate, dateFrom),
      lte(reportingDailySnapshots.snapshotDate, dateTo),
    ];

    if (domain) {
      conditions.push(eq(reportingDailySnapshots.domain, domain as any));
    }

    const results = await db
      .select({
        eventId: reportingDailySnapshots.eventId,
        domain: reportingDailySnapshots.domain,
        totalGGR: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
        totalBets: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
        totalStake: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
        totalPayout: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalPayouts}::numeric), 0)`,
      })
      .from(reportingDailySnapshots)
      .where(and(...conditions))
      .groupBy(reportingDailySnapshots.eventId, reportingDailySnapshots.domain)
      .orderBy(sql`SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric) DESC`)
      .limit(limit);

    // Get event details for sports events
    const eventIds = results
      .filter(r => r.domain === 'sports' && r.eventId)
      .map(r => String(r.eventId));
    
    let eventMap = new Map<string, { name: string; sport: string; startTime: string; status: string }>();
    
    if (eventIds.length > 0) {
      const eventData = await db
        .select({
          id: sportsEventsTable.id,
          name: sportsEventsTable.name,
          startTime: sportsEventsTable.startTime,
          status: sportsEventsTable.status,
          sportName: sportsTable.name,
        })
        .from(sportsEventsTable)
        .leftJoin(sportsLeaguesTable, eq(sportsEventsTable.leagueId, sportsLeaguesTable.id))
        .leftJoin(sportsTable, eq(sportsLeaguesTable.sportId, sportsTable.id))
        .where(inArray(sportsEventsTable.id, eventIds));

      eventMap = new Map(eventData.map(e => [
        String(e.id),
        {
          name: e.name || `Event ${e.id}`,
          sport: e.sportName || 'Unknown',
          startTime: e.startTime ? new Date(e.startTime).toISOString() : periodFrom,
          status: e.status || 'COMPLETED',
        }
      ]));
    }

    return results.map((r) => {
      const totalStake = Number(r.totalStake) || 0;
      const totalPayout = Number(r.totalPayout) || 0;
      const avgOdds = totalStake > 0 && totalPayout > 0 ? totalPayout / totalStake : 1.0;

      const eventId = String(r.eventId || '');
      const eventInfo = eventMap.get(eventId) || {
        name: r.domain === 'sports' ? `Event ${eventId}` : `Game ${eventId}`,
        sport: r.domain === 'sports' ? 'Unknown' : undefined,
        startTime: periodFrom,
        status: 'COMPLETED',
      };

      return {
        eventId,
        eventName: eventInfo.name,
        sport: eventInfo.sport,
        domain: r.domain || 'unknown',
        totalGGR: Number(r.totalGGR) || 0,
        totalBets: Number(r.totalBets) || 0,
        totalStake,
        totalPayout,
        avgOdds,
        startTime: eventInfo.startTime,
        status: eventInfo.status,
      };
    });
    } catch (error) {
      return [];
    }
  },
};

async function loadExportJobsPage(args: any, context: any) {
    requireReadPermission(context, 'reporting.exports', 'view')
    // Every agent scheme has the Export Center (owner decision 4, 2026-10-22); a caller lists only
    // its own jobs (createdBy below).
    
    const tenant = context?.tenant || 'default';
    const whitelabelId = context?.whitelabelId || context?.whitelabel?.id || 'default';
    // Support both admin users (user.sub) and agents (user.agentId or user.id)
    // Note: created_by column is integer, so we need to convert to number
    let createdByRaw = context?.userId || context?.user?.id || context?.user?.sub || context?.user?.agentId;
    const status = args.status;
    const limit = Math.min(500, Math.max(1, args.limit ?? 50));

    // Convert to integer for query matching
    let createdBy: number | undefined = undefined;
    if (createdByRaw) {
      if (typeof createdByRaw === 'number') {
        createdBy = createdByRaw;
      } else if (typeof createdByRaw === 'string') {
        const parsed = Number(createdByRaw);
        if (Number.isFinite(parsed) && parsed > 0) {
          createdBy = parsed;
        } else {
          // For UUID strings, convert to hash integer (same logic as in createExportJob)
          let hash = 0;
          for (let i = 0; i < createdByRaw.length; i++) {
            const char = createdByRaw.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          createdBy = Math.abs(hash);
        }
      }
    }

    const conditions = [eq(reportingExportJobs.tenant, tenant)];
    if (whitelabelId) {
      conditions.push(eq(reportingExportJobs.whitelabelId, whitelabelId));
    }
    if (createdBy !== undefined) {
      conditions.push(eq(reportingExportJobs.createdBy, createdBy));
    }
    if (status) {
      conditions.push(eq(reportingExportJobs.status, status));
    }

    const [summary] = await db.select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where status='completed')::int`,
      pending: sql<number>`count(*) filter (where status in ('pending','processing'))::int`,
      failed: sql<number>`count(*) filter (where status='failed')::int`,
      average: sql<number>`coalesce(avg(floor(extract(epoch from (completed_at-created_at))/60)) filter (where status='completed' and completed_at is not null),0)::float8`,
    }).from(reportingExportJobs).where(and(...conditions.filter(Boolean)));
    const jobs = await db
      .select()
      .from(reportingExportJobs)
      .where(and(...conditions.filter(Boolean)))
      .orderBy(desc(reportingExportJobs.createdAt), desc(reportingExportJobs.id))
      .limit(limit).offset(Math.max(0, args.offset ?? 0));

    const items = jobs.map((j) => ({
      id: j.id,
      reportType: j.reportType,
      exportFormat: j.exportFormat,
      status: j.status,
      fileUrl: j.fileUrl || undefined,
      errorMessage: j.errorMessage || undefined,
      scheduledAt: j.scheduledAt?.toISOString() || undefined,
      completedAt: j.completedAt?.toISOString() || undefined,
      createdAt: j.createdAt.toISOString(),
    }));

    return { items, ...summary, successRate: summary.total ? (100 * summary.completed / summary.total).toFixed(1) : "0", avgProcessingTime: Number(summary.average).toFixed(1) };

}
