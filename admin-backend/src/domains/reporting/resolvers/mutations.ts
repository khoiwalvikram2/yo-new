import { db } from '@/db/client.js';
import {
  reportingSavedReports,
  reportingExportJobs,
} from '@shared/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { generateSnapshotsForRange } from '@/services/reportingSnapshotService.js';
import { normalizeCreatedByForReporting } from './reportingResolverUtils.js';
import { requireExportReportPermission } from '@src/domains/reporting/services/exportReportPermissions.js'
import { loadExportAgentContext, type ExportAgentContext } from '@src/domains/reporting/services/agentExportScope.js'

export const reportingMutationResolvers = {
  createSavedReport: async (_: any, args: any, context: any) => {
    const tenant = context?.tenant || 'default';
    const whitelabelId = context?.whitelabelId || context?.whitelabel?.id || 'default';
    const createdByRaw = context?.userId || context?.user?.id || context?.user?.sub || context?.user?.agentId;
    if (!createdByRaw) throw new Error('User ID required');
    const createdBy = normalizeCreatedByForReporting(createdByRaw);

    const input = args.input;
    const [report] = await db
      .insert(reportingSavedReports)
      .values({
        tenant,
        whitelabelId,
        createdBy,
        name: input.name,
        description: input.description || null,
        reportType: input.reportType,
        filtersJson: input.filtersJson,
        isPinned: input.isPinned || false,
      })
      .returning();

    return {
      id: report.id,
      name: report.name,
      description: report.description || undefined,
      reportType: report.reportType,
      filtersJson: report.filtersJson,
      isPinned: report.isPinned,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  },

  updateSavedReport: async (_: any, args: any, context: any) => {
    const tenant = context?.tenant || 'default';
    const whitelabelId = context?.whitelabelId || context?.whitelabel?.id || 'default';
    const createdByRaw = context?.userId || context?.user?.id || context?.user?.sub || context?.user?.agentId;
    const id = args.id;
    const input = args.input;

    const conditions = [
      eq(reportingSavedReports.id, id),
      eq(reportingSavedReports.tenant, tenant),
      eq(reportingSavedReports.whitelabelId, whitelabelId),
    ];
    if (createdByRaw !== undefined && createdByRaw !== null) {
      conditions.push(eq(reportingSavedReports.createdBy, normalizeCreatedByForReporting(createdByRaw)));
    }

    const [report] = await db
      .update(reportingSavedReports)
      .set({
        name: input.name,
        description: input.description || null,
        reportType: input.reportType,
        filtersJson: input.filtersJson,
        isPinned: input.isPinned !== undefined ? input.isPinned : undefined,
        updatedAt: new Date(),
      })
      .where(and(...conditions.filter(Boolean)))
      .returning();

    if (!report) {
      throw new Error('Report not found');
    }

    return {
      id: report.id,
      name: report.name,
      description: report.description || undefined,
      reportType: report.reportType,
      filtersJson: report.filtersJson,
      isPinned: report.isPinned,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  },

  deleteSavedReport: async (_: any, args: any, context: any) => {
    const tenant = context?.tenant || 'default';
    const whitelabelId = context?.whitelabelId || context?.whitelabel?.id || 'default';
    const createdByRaw = context?.userId || context?.user?.id || context?.user?.sub || context?.user?.agentId;
    const id = args.id;

    const conditions = [
      eq(reportingSavedReports.id, id),
      eq(reportingSavedReports.tenant, tenant),
      eq(reportingSavedReports.whitelabelId, whitelabelId),
    ];
    if (createdByRaw !== undefined && createdByRaw !== null) {
      conditions.push(eq(reportingSavedReports.createdBy, normalizeCreatedByForReporting(createdByRaw)));
    }

    await db
      .delete(reportingSavedReports)
      .where(and(...conditions.filter(Boolean)));

    return { success: true, message: 'Report deleted successfully' };
  },

  createExportJob: async (_: any, args: any, context: any) => {
    // Every agent scheme may export (agent features spec §4, owner decision 4, 2026-10-22); the
    // COMMISSION-agent block that stood here is gone. What an agent may export is agentExportPolicy,
    // asked by requireExportReportPermission below; whose rows is the processor's agent scope.
    
    const tenant = context?.tenant || 'default';
    const whitelabelId = context?.whitelabelId || context?.whitelabel?.id || 'default';
    // Support both admin users (user.sub) and agents (user.agentId or user.id)
    // Note: created_by column is integer, so we need to convert to number
    let createdByRaw = context?.userId || context?.user?.id || context?.user?.sub || context?.user?.agentId;

    if (!createdByRaw) {
      throw new Error('User ID required');
    }

    // Convert to integer: if it's already a number, use it; if it's a string UUID, use a hash or fallback
    // For agents with UUID agentId, we'll use a hash-based integer
    let createdBy: number;
    if (typeof createdByRaw === 'number') {
      createdBy = createdByRaw;
    } else if (typeof createdByRaw === 'string') {
      // If it's a numeric string, parse it
      const parsed = Number(createdByRaw);
      if (Number.isFinite(parsed) && parsed > 0) {
        createdBy = parsed;
      } else {
        // For UUID strings (like agent IDs), convert to a consistent integer hash
        // Simple hash function to convert UUID to integer
        let hash = 0;
        for (let i = 0; i < createdByRaw.length; i++) {
          const char = createdByRaw.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash; // Convert to 32-bit integer
        }
        createdBy = Math.abs(hash);
      }
    } else {
      throw new Error('Invalid user ID format');
    }

    const input = args.input;

    // `reporting.exports:create` is the right to run an export at all. WHICH
    // report may be run is a separate question, and nothing asked it: the
    // caller names the type and ExportJobProcessor dispatches on that string
    // across twenty reports — AUDIT_LOGS, PLAYERS, TRANSACTIONS among them —
    // consulting no further permission.
    requireExportReportPermission(context, input.reportType);

    // An agent's export is scoped to its own subtree, so the processor must know the agent. When it
    // cannot be loaded the export is refused: without agentContext the processor reads as an admin,
    // i.e. the whole whitelabel. (The lookup that stood further down swallowed that error.)
    const agentContext: ExportAgentContext | null =
      context?.user?.type === 'agent' ? await loadExportAgentContext(context?.user?.agentId, tenant) : null;

    const [job] = await db
      .insert(reportingExportJobs)
      .values({
        tenant,
        whitelabelId,
        createdBy,
        reportType: input.reportType,
        filtersJson: input.filtersJson,
        exportFormat: input.exportFormat,
        status: 'pending',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      })
      .returning();

    // Process export job asynchronously (non-blocking)
    // This will fetch data, generate file, upload to S3, and update job status
    const { ExportJobProcessor } = await import('@/domains/reporting/services/ExportJobProcessor.js');
    const processor = new ExportJobProcessor();
    
    // Get whitelabel metadata for enhanced columns
    let whitelabelMetadata: { name?: string; domain?: string; currency?: string } | null = null;
    if (whitelabelId && whitelabelId !== 'default') {
      try {
        const { getWhitelabelById } = await import('@/repos/common/whitelabelRepo.js');
        const whitelabel = await getWhitelabelById(whitelabelId);
        if (whitelabel) {
          whitelabelMetadata = {
            name: whitelabel.name,
            domain: whitelabel.domain,
          };
          
          // Try to get currency from app config
          try {
            const { getAppConfigDb } = await import('@/repos/app-config/appConfigRepo.js');
            const appConfig = await getAppConfigDb(whitelabelId);
            if (appConfig?.baseCurrency) {
              whitelabelMetadata.currency = appConfig.baseCurrency;
            }
          } catch (configError) {
            // App config not available, use default
          }
        }
      } catch (error) {
      }
    }
    
    // Process in background (don't await - let it run async)
    processor.processJob(job.id, {
      agentContext,
      whitelabelId: whitelabelId,
      whitelabelMetadata,
      tenant: tenant,
    }).catch((error) => {
    });

    return {
      id: job.id,
      reportType: job.reportType,
      exportFormat: job.exportFormat,
      status: job.status,
      fileUrl: job.fileUrl || undefined,
      errorMessage: job.errorMessage || undefined,
      scheduledAt: job.scheduledAt?.toISOString() || undefined,
      completedAt: job.completedAt?.toISOString() || undefined,
      createdAt: job.createdAt.toISOString(),
    };
  },

  refreshReportingSnapshots: async (_: any, args: any, context: any) => {
    const tenant = context?.tenant || 'default';
    const whitelabelId = context?.whitelabelId || context?.whitelabel?.id || 'default';
    const domain = args.domain;
    const dateFrom = args.dateFrom ? new Date(args.dateFrom) : new Date();
    const dateTo = args.dateTo ? new Date(args.dateTo) : new Date();

    // Map GraphQL enum to lowercase domain strings
    const domainMap: Record<string, 'sports' | 'casino' | 'matka' | 'agents' | 'bonuses' | 'global'> = {
      SPORTS: 'sports',
      CASINO: 'casino',
      MATKA: 'matka',
      AGENTS: 'agents',
      BONUSES: 'bonuses',
      GLOBAL: 'global',
    };

    const domains: Array<'sports' | 'casino' | 'matka' | 'agents' | 'bonuses' | 'global'> =
      domain && domainMap[domain]
        ? [domainMap[domain]]
        : ['sports', 'casino', 'matka', 'agents', 'bonuses', 'global'];

    await generateSnapshotsForRange(tenant, whitelabelId, dateFrom, dateTo, domains);

    return { success: true, message: 'Reporting snapshots refreshed successfully' };
  },
};

