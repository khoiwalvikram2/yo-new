import { db } from '@/db/client.js';
import { reportingExportJobs } from '@shared/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { ExportService } from './ExportService.js';
import { uploadToS3 } from '@/services/storage/s3.js';
import { assertAgentMayExport } from './agentExportPolicy.js';
import {
  AGENT_SCOPE_MISSING,
  betExportWindow,
  instantExportWindow,
  loadAgentExportScope,
  loadSettlementAgentIds,
  type AgentExportScope,
  type ExportAgentContext,
} from './agentExportScope.js';
import { buildCommissionCycleRows, orderScopeAgents, toAgentSettlementRow } from './agentExportRows.js';
import {
  agentCasinoBetsQuery,
  agentDepositsQuery,
  agentMatkaBetsQuery,
  agentPlayersQuery,
  agentSettlementsQuery,
  agentSportsBetsQuery,
  agentWithdrawalsQuery,
  agentsInScopeQuery,
  type AgentExportQueryScope,
} from '@/repos/reporting/agentExportQueries.js';
import type { CommissionCycleInfo } from '@/domains/agents/services/CommissionCycleService.js';

interface ExportFilters {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  domain?: string;
  agentId?: string;
  [key: string]: any;
}

interface ExportContext {
  agentContext?: ExportAgentContext | null;
  whitelabelId?: string;
  whitelabelMetadata?: {
    name?: string;
    domain?: string;
    currency?: string;
  } | null;
  tenant?: string;
  /** Set by processJob for an agent caller: whose rows the file may hold (agentExportScope). */
  agentScope?: AgentExportScope | null;
}

/** The scope of an agent's export; refuses when processJob did not resolve one. */
function requireAgentScope(exportContext?: ExportContext): AgentExportScope {
  const scope = exportContext?.agentScope;
  if (!scope) throw new Error(AGENT_SCOPE_MISSING);
  return scope;
}

/** The SQL scope of an agent's export: the scope agent's players, in the job's tenant and whitelabel. */
function agentQueryScope(exportContext?: ExportContext): AgentExportQueryScope {
  const scope = requireAgentScope(exportContext);
  return { agentId: scope.scopeAgentId, tenant: scope.tenant, whitelabelId: scope.whitelabelId };
}

export class ExportJobProcessor {
  private exportService: ExportService;

  constructor() {
    this.exportService = new ExportService();
  }

  /**
   * Process a single export job
   */
  async processJob(jobId: string, context?: ExportContext): Promise<void> {
    const job = await db
      .select()
      .from(reportingExportJobs)
      .where(eq(reportingExportJobs.id, jobId))
      .limit(1);

    if (!job || job.length === 0) {
      throw new Error(`Export job ${jobId} not found`);
    }

    const exportJob = job[0];

    // Skip if already completed or failed
    if (exportJob.status === 'completed' || exportJob.status === 'failed') {
      return;
    }

    try {
      // Update status to processing
      await db
        .update(reportingExportJobs)
        .set({ status: 'processing' })
        .where(eq(reportingExportJobs.id, jobId));

      // Parse filters
      let filters: ExportFilters = {};
      try {
        filters = exportJob.filtersJson
          ? (typeof exportJob.filtersJson === 'string'
              ? JSON.parse(exportJob.filtersJson)
              : exportJob.filtersJson)
          : {};
      } catch (error) {
        filters = {};
      }

      // An agent's export is scoped to its own subtree (agent features spec §4, owner decision 4,
      // 2026-10-22). Resolve whose rows once, before any row is read: the caller, or a sub-agent
      // it named in filters.agentId (anything outside its subtree is ignored).
      if (context?.agentContext && !context.agentScope) {
        context.agentScope = await loadAgentExportScope({
          callerAgentId: context.agentContext.agentId,
          schemeType: context.agentContext.schemeType,
          allowedDomains: context.agentContext.allowedDomains,
          tenant: exportJob.tenant,
          whitelabelId: exportJob.whitelabelId,
          requestedAgentId: filters.agentId,
        });
      }

      // Fetch data based on report type with context
      const data = await this.fetchExportData(
        exportJob.reportType,
        filters,
        {
          tenant: exportJob.tenant,
          whitelabelId: exportJob.whitelabelId,
        },
        context
      );

      // If no data found, still create an empty file with headers
      if (!data || data.length === 0) {
      }

      // Generate file
      let fileContent: string | Buffer;
      let fileExtension: string;
      let contentType: string;

      // Get columns for the normalized report type with context-aware customization
      const columns = this.getColumnsForReportType(
        exportJob.reportType,
        context?.agentContext,
        context?.whitelabelId,
        context?.whitelabelMetadata
      );
      
      if (columns.length === 0) {
        throw new Error(`No column definitions found for report type: ${exportJob.reportType}`);
      }

      if (exportJob.exportFormat === 'CSV' || exportJob.exportFormat === 'XLSX') {
        // For now, both CSV and XLSX generate CSV (Excel support pending)
        const csvContent = await this.exportService.generateCSV({
          filename: `${exportJob.reportType}-${jobId}`,
          columns: columns,
          data: data || [], // Ensure data is always an array
        });
        fileContent = csvContent;
        fileExtension = exportJob.exportFormat === 'XLSX' ? 'csv' : 'csv'; // Both generate CSV for now
        contentType = 'text/csv';
        // TODO: Implement Excel generation when exceljs is installed
      } else {
        throw new Error(`Unsupported export format: ${exportJob.exportFormat}`);
      }

      // Convert string to Buffer if needed
      const fileBuffer = typeof fileContent === 'string' 
        ? Buffer.from(fileContent, 'utf-8')
        : fileContent;

      // Upload to S3 (store S3 key in fileUrl so download can use presigned URL on demand)
      const fileName = `exports/${exportJob.tenant}/${exportJob.whitelabelId}/${exportJob.reportType}-${jobId}-${Date.now()}.${fileExtension}`;
      try {
        await uploadToS3(
          fileBuffer,
          fileName,
          contentType
        );
      } catch (s3Error: any) {
        throw new Error(`Failed to upload file to S3: ${s3Error?.message || 'Unknown S3 error'}`);
      }

      // Update job with completed status and file key (used by exportJobDownloadUrl for presigned URL)
      await db
        .update(reportingExportJobs)
        .set({
          status: 'completed',
          fileUrl: fileName,
          completedAt: new Date(),
        })
        .where(eq(reportingExportJobs.id, jobId));
    } catch (error: any) {
      // Update job with failed status and error message
      await db
        .update(reportingExportJobs)
        .set({
          status: 'failed',
          errorMessage: error?.message || 'Export processing failed',
        })
        .where(eq(reportingExportJobs.id, jobId));
      throw error;
    }
  }

  /**
   * Normalize report type to handle different formats (lowercase, uppercase, hyphenated)
   */
  private normalizeReportType(reportType: string): string {
    // Convert to uppercase and replace hyphens with underscores
    return reportType.toUpperCase().replace(/-/g, '_');
  }

  /**
   * Fetch data for export based on report type with context-aware enhancements
   */
  private async fetchExportData(
    reportType: string,
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    // Normalize report type to handle case and format variations
    const normalizedType = this.normalizeReportType(reportType);
    // Defence in depth (agent features spec §4): createExportJob already refused these, but a job
    // row can carry any report type, so ask the agent policy again before any row is read, and
    // never read an agent's export without its resolved scope.
    if (exportContext?.agentContext) {
      assertAgentMayExport(normalizedType, exportContext.agentContext.schemeType, exportContext.agentContext.allowedDomains);
      if (!exportContext.agentScope) {
        throw new Error(AGENT_SCOPE_MISSING);
      }
    }
    
    switch (normalizedType) {
      case 'PLAYERS':
        return await this.fetchPlayersData(filters, context, exportContext);
      case 'AGENTS':
      case 'SUBAGENTS': // Handle subagents as agents data
        return await this.fetchAgentsData(filters, context, exportContext);
      case 'SPORTS_BETS':
      case 'SPORTSBETS':
        return await this.fetchSportsBetsData(filters, context, exportContext);
      case 'CASINO_BETS':
      case 'CASINOBETS':
        return await this.fetchCasinoBetsData(filters, context, exportContext);
      case 'MATKA_BETS':
      case 'MATKABETS':
        return await this.fetchMatkaBetsData(filters, context, exportContext);
      case 'DEPOSITS':
        return await this.fetchDepositsData(filters, context, exportContext);
      case 'WITHDRAWALS':
        return await this.fetchWithdrawalsData(filters, context, exportContext);
      case 'TRANSACTIONS':
        // Transactions is a combination of deposits and withdrawals
        const deposits = await this.fetchDepositsData(filters, context, exportContext);
        const withdrawals = await this.fetchWithdrawalsData(filters, context, exportContext);
        // Add type field to distinguish between deposits and withdrawals
        return [
          ...deposits.map((d: any) => ({ ...d, type: 'deposit' })),
          ...withdrawals.map((w: any) => ({ ...w, type: 'withdrawal' })),
        ];
      case 'BONUS_CAMPAIGNS':
      case 'BONUSCAMPAIGNS':
        return await this.fetchBonusCampaignsData(filters, context, exportContext);
      case 'AUDIT_LOGS':
      case 'AUDITLOGS':
        return await this.fetchAuditLogsData(filters, context, exportContext);
      case 'COMMISSION':
        // Commission reports - return agent ledger commission data
        return await this.fetchCommissionData(filters, context, exportContext);
      case 'SETTLEMENT':
      case 'SETTLEMENTS':
        // Settlement reports - return agent settlement transaction data
        return await this.fetchSettlementData(filters, context, exportContext);
      case 'GGR':
        // GGR reports - return aggregated bet data
        const sportsBets = await this.fetchSportsBetsData(filters, context, exportContext);
        const casinoBets = await this.fetchCasinoBetsData(filters, context, exportContext);
        const matkaBets = await this.fetchMatkaBetsData(filters, context, exportContext);
        return [...sportsBets, ...casinoBets, ...matkaBets];
      default:
        throw new Error(`Unsupported report type: ${reportType} (normalized: ${normalizedType})`);
    }
  }

  /**
   * Get columns definition for a report type with context-aware customization
   * Columns are enhanced based on agent type (COMMISSION, SHARING, CREDIT) and whitelabel
   */
  private getColumnsForReportType(
    reportType: string,
    agentContext?: { agentId: string; schemeType: 'COMMISSION' | 'SHARING' | 'CREDIT' } | null,
    whitelabelId?: string,
    whitelabelMetadata?: { name?: string; domain?: string; currency?: string } | null
  ): any[] {
    // Normalize report type first
    const normalizedType = this.normalizeReportType(reportType);
    const agentType = agentContext?.schemeType;
    const isAgent = !!agentContext;
    
    // Base column definitions for each report type
    const baseColumnDefinitions: Record<string, any[]> = {
      PLAYERS: [
        { header: 'ID', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Email', key: 'email' },
        { header: 'Phone', key: 'phone' },
        { header: 'Balance', key: 'balance', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
        { header: 'Registered At', key: 'registeredAt' },
      ],
      AGENTS: [
        { header: 'ID', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Email', key: 'email' },
        { header: 'Type', key: 'type' },
        { header: 'Credit', key: 'credit', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
      ],
      SPORTS_BETS: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
        { header: 'Created At', key: 'createdAt' },
      ],
      CASINO_BETS: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
        { header: 'Created At', key: 'createdAt' },
      ],
      MATKA_BETS: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Type', key: 'type' },
        { header: 'Created At', key: 'createdAt' },
      ],
      DEPOSITS: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
        { header: 'Created At', key: 'createdAt' },
      ],
      WITHDRAWALS: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
        { header: 'Created At', key: 'createdAt' },
      ],
      BONUS_CAMPAIGNS: [
        { header: 'ID', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Status', key: 'status' },
        { header: 'Domain', key: 'domain' },
        { header: 'Created At', key: 'createdAt' },
      ],
      AUDIT_LOGS: [
        { header: 'ID', key: 'id' },
        { header: 'Action', key: 'action' },
        { header: 'User ID', key: 'userId' },
        { header: 'Created At', key: 'createdAt' },
      ],
      TRANSACTIONS: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
        { header: 'Type', key: 'type' },
        { header: 'Created At', key: 'createdAt' },
      ],
      // One row per agent per IST week, from the commission engine (agentExportRows).
      COMMISSION: [
        { header: 'ID', key: 'id' },
        { header: 'Agent', key: 'name' },
        { header: 'Agent ID', key: 'agentId' },
        { header: 'Relation', key: 'relation' },
        { header: 'Cycle From', key: 'cycleFrom' },
        { header: 'Cycle To', key: 'cycleTo' },
        { header: 'Status', key: 'status' },
        { header: 'Gross', key: 'gross', format: (v: any) => String(v || 0) },
        { header: 'Loss Carried From Last Week', key: 'carriedLoss' },
        { header: 'Carry Applied', key: 'carryApplied' },
        { header: "This Week's Loss (Carries To Next Week)", key: 'lossThisCycle' },
        { header: 'Adjustments', key: 'adjustments', format: (v: any) => String(v || 0) },
        { header: 'Payable', key: 'payable' },
        { header: 'Paid', key: 'paid', format: (v: any) => String(v || 0) },
        { header: 'Currency', key: 'currency' },
      ],
      SETTLEMENT: [
        { header: 'ID', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Type', key: 'type' },
        { header: 'Credit', key: 'credit', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
      ],
      SETTLEMENTS: [
        { header: 'ID', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Type', key: 'type' },
        { header: 'Credit', key: 'credit', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
      ],
      GGR: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
        { header: 'Type', key: 'type' },
        { header: 'Created At', key: 'createdAt' },
      ],
      SUBAGENTS: [
        { header: 'ID', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Email', key: 'email' },
        { header: 'Type', key: 'type' },
        { header: 'Credit', key: 'credit', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
      ],
      SPORTSBETS: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
        { header: 'Created At', key: 'createdAt' },
      ],
      CASINOBETS: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Status', key: 'status' },
        { header: 'Created At', key: 'createdAt' },
      ],
      MATKABETS: [
        { header: 'ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Amount', key: 'amount', format: (v: any) => String(v || 0) },
        { header: 'Type', key: 'type' },
        { header: 'Created At', key: 'createdAt' },
      ],
      BONUSCAMPAIGNS: [
        { header: 'ID', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Status', key: 'status' },
        { header: 'Domain', key: 'domain' },
        { header: 'Created At', key: 'createdAt' },
      ],
      AUDITLOGS: [
        { header: 'ID', key: 'id' },
        { header: 'Action', key: 'action' },
        { header: 'User ID', key: 'userId' },
        { header: 'Created At', key: 'createdAt' },
      ],
    };

    // Get base columns
    let columns = baseColumnDefinitions[normalizedType] || baseColumnDefinitions[reportType] || [];
    
    // Enhance columns based on agent type and whitelabel context
    columns = this.enhanceColumnsForContext(
      columns,
      normalizedType,
      agentType,
      isAgent,
      whitelabelId,
      whitelabelMetadata
    );
    
    return columns;
  }

  /**
   * Enhance columns based on agent type and whitelabel context
   */
  private enhanceColumnsForContext(
    baseColumns: any[],
    reportType: string,
    agentType?: 'COMMISSION' | 'SHARING' | 'CREDIT',
    isAgent?: boolean,
    whitelabelId?: string,
    whitelabelMetadata?: { name?: string; domain?: string; currency?: string } | null
  ): any[] {
    const enhancedColumns = [...baseColumns];
    
    // Add whitelabel metadata columns ONLY if whitelabel context exists AND no agent is logged in
    // Agents should not see whitelabel columns in their exports
    if (whitelabelId && whitelabelId !== 'default' && !isAgent && !agentType) {
      enhancedColumns.unshift({ header: 'Whitelabel ID', key: 'whitelabelId' });
      if (whitelabelMetadata?.name) {
        enhancedColumns.unshift({ header: 'Whitelabel Name', key: 'whitelabelName' });
      }
      if (whitelabelMetadata?.domain) {
        enhancedColumns.unshift({ header: 'Whitelabel Domain', key: 'whitelabelDomain' });
      }
      // Currency column is added per report type in the switch statement below
      // This ensures currency appears in all export types when whitelabel context exists
    }
    
    // Enhance based on report type and agent type
    switch (reportType) {
      case 'PLAYERS':
        // For credit agents: add credit-specific columns
        if (agentType === 'CREDIT') {
          enhancedColumns.push(
            { header: 'Credit Limit', key: 'creditLimit', format: (v: any) => String(v || 0) },
            { header: 'Credit Used', key: 'creditUsed', format: (v: any) => String(v || 0) },
            { header: 'Credit Available', key: 'creditAvailable', format: (v: any) => String(v || 0) },
            { header: 'Exposure', key: 'exposure', format: (v: any) => String(v || 0) },
            { header: 'Player Type', key: 'playerType' }
          );
        }
        // For commission/sharing agents: add agent relationship
        if (agentType === 'COMMISSION' || agentType === 'SHARING') {
          enhancedColumns.push(
            { header: 'Agent ID', key: 'agentId' },
            { header: 'Player Type', key: 'playerType' }
          );
        }
        // Add currency for whitelabel context (only if no agent is logged in)
        if (whitelabelId && !isAgent && !agentType) {
          enhancedColumns.push({ header: 'Currency', key: 'currency' });
        }
        // Add comprehensive player fields
        enhancedColumns.push(
          { header: 'Username', key: 'username' },
          { header: 'Cash Balance', key: 'cashBalance', format: (v: any) => String(v || 0) },
          { header: 'Bonus Balance', key: 'bonusBalance', format: (v: any) => String(v || 0) },
          { header: 'VIP Tier', key: 'vipTier' },
          { header: 'Last Login', key: 'lastLogin' }
        );
        break;
        
      case 'AGENTS':
      case 'SUBAGENTS':
        // Add comprehensive agent fields
        enhancedColumns.push(
          { header: 'Username', key: 'username' },
          { header: 'Phone', key: 'phone' },
          { header: 'Tenant ID', key: 'tenantId' },
          { header: 'Allowed Domains', key: 'allowedDomains' },
          { header: 'Parent Agent ID', key: 'parentAgentId' },
          { header: 'Level Index', key: 'levelIndex' },
          { header: 'Created At', key: 'createdAt' }
        );
        
        // For commission agents: add commission-specific columns
        if (agentType === 'COMMISSION') {
          enhancedColumns.push(
            { header: 'Tally Enabled', key: 'tallyEnabled' },
            { header: 'Tally Domains', key: 'tallyDomains' },
            { header: 'Commission Rate (Sports)', key: 'commissionRateSports', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Commission Rate (Casino)', key: 'commissionRateCasino', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Commission Rate (Matka)', key: 'commissionRateMatka', format: (v: any) => v ? `${v}%` : 'N/A' }
          );
        }
        
        // For sharing/credit agents: add sharing/credit-specific columns
        if (agentType === 'SHARING' || agentType === 'CREDIT') {
          enhancedColumns.push(
            { header: 'Credit Limit', key: 'creditLimit', format: (v: any) => String(v || 0) },
            { header: 'Credit Used', key: 'creditUsed', format: (v: any) => String(v || 0) },
            { header: 'Credit Alert Threshold', key: 'creditAlertThreshold', format: (v: any) => v ? `${v}%` : '80%' },
            { header: 'Wallet Balance', key: 'walletBalance', format: (v: any) => String(v || 0) },
            { header: 'Locked Balance', key: 'lockedBalance', format: (v: any) => String(v || 0) }
          );
        }
        
        // For sharing agents: add sharing-specific columns
        if (agentType === 'SHARING') {
          enhancedColumns.push(
            { header: 'Sharing Rate (Sports)', key: 'sharingRateSports', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Sharing Rate (Casino)', key: 'sharingRateCasino', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Sharing Rate (Matka)', key: 'sharingRateMatka', format: (v: any) => v ? `${v}%` : 'N/A' }
          );
        }
        break;
        
      case 'SPORTS_BETS':
      case 'SPORTSBETS':
        // Add comprehensive bet fields
        enhancedColumns.push(
          { header: 'Sport', key: 'sportName' },
          { header: 'League', key: 'leagueName' },
          { header: 'Event', key: 'eventName' },
          { header: 'Stake', key: 'stake', format: (v: any) => String(v || 0) },
          { header: 'Odds', key: 'price', format: (v: any) => String(v || 0) },
          { header: 'Side', key: 'side' },
          { header: 'Currency', key: 'currency' },
          { header: 'Matched At', key: 'matchedAt' },
          { header: 'Settled At', key: 'settledAt' },
          { header: 'Result', key: 'result' }
        );
        
        // For commission agents: add commission calculation fields
        if (agentType === 'COMMISSION') {
          enhancedColumns.push(
            { header: 'Commission Rate', key: 'commissionRate', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Commission Amount', key: 'commissionAmount', format: (v: any) => String(v || 0) }
          );
        }
        
        // For sharing agents: add sharing calculation fields
        if (agentType === 'SHARING') {
          enhancedColumns.push(
            { header: 'GGR', key: 'ggr', format: (v: any) => String(v || 0) },
            { header: 'Sharing Rate', key: 'sharingRate', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Share Amount', key: 'shareAmount', format: (v: any) => String(v || 0) }
          );
        }
        break;
        
      case 'CASINO_BETS':
      case 'CASINOBETS':
        // Add comprehensive casino bet fields
        enhancedColumns.push(
          { header: 'Game Name', key: 'gameName' },
          { header: 'Vendor', key: 'vendorName' },
          { header: 'Stake', key: 'stake', format: (v: any) => String(v || 0) },
          { header: 'Payout', key: 'payout', format: (v: any) => String(v || 0) },
          { header: 'Win Amount', key: 'winAmount', format: (v: any) => String(v || 0) },
          { header: 'Net Amount', key: 'netAmount', format: (v: any) => String(v || 0) },
          { header: 'Currency', key: 'currency' },
          { header: 'Settled At', key: 'settledAt' }
        );
        
        // For commission agents: add commission fields
        if (agentType === 'COMMISSION') {
          enhancedColumns.push(
            { header: 'Commission Rate', key: 'commissionRate', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Commission Amount', key: 'commissionAmount', format: (v: any) => String(v || 0) }
          );
        }
        
        // For sharing agents: add sharing fields
        if (agentType === 'SHARING') {
          enhancedColumns.push(
            { header: 'GGR', key: 'ggr', format: (v: any) => String(v || 0) },
            { header: 'Sharing Rate', key: 'sharingRate', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Share Amount', key: 'shareAmount', format: (v: any) => String(v || 0) }
          );
        }
        break;
        
      case 'MATKA_BETS':
      case 'MATKABETS':
        // Add comprehensive matka bet fields
        enhancedColumns.push(
          { header: 'Market Name', key: 'marketName' },
          { header: 'Market Session', key: 'marketSession' },
          { header: 'Bid Type', key: 'bidType' },
          { header: 'Bet Numbers', key: 'betNumbers' },
          { header: 'Payout Multiplier', key: 'payoutMultiplier', format: (v: any) => String(v || 0) },
          { header: 'Potential Win', key: 'potentialWin', format: (v: any) => String(v || 0) },
          { header: 'Actual Win', key: 'actualWin', format: (v: any) => String(v || 0) },
          { header: 'Currency', key: 'currency' },
          { header: 'Settled At', key: 'settledAt' },
          { header: 'Result', key: 'result' }
        );
        
        // For commission agents: add commission fields
        if (agentType === 'COMMISSION') {
          enhancedColumns.push(
            { header: 'Commission Rate', key: 'commissionRate', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Commission Amount', key: 'commissionAmount', format: (v: any) => String(v || 0) }
          );
        }
        
        // For sharing agents: add sharing fields
        if (agentType === 'SHARING') {
          enhancedColumns.push(
            { header: 'GGR', key: 'ggr', format: (v: any) => String(v || 0) },
            { header: 'Sharing Rate', key: 'sharingRate', format: (v: any) => v ? `${v}%` : 'N/A' },
            { header: 'Share Amount', key: 'shareAmount', format: (v: any) => String(v || 0) }
          );
        }
        break;
        
      case 'DEPOSITS':
        // Add comprehensive deposit fields
        enhancedColumns.push(
          { header: 'Method', key: 'method' },
          { header: 'Currency', key: 'currency' },
          { header: 'Transaction ID', key: 'transactionId' },
          { header: 'Processed At', key: 'processedAt' },
          { header: 'Notes', key: 'notes' }
        );
        
        // For credit agents: add credit allocation info
        if (agentType === 'CREDIT') {
          enhancedColumns.push(
            { header: 'Credit Allocation', key: 'creditAllocation', format: (v: any) => String(v || 0) }
          );
        }
        break;
        
      case 'WITHDRAWALS':
        // Add comprehensive withdrawal fields
        enhancedColumns.push(
          { header: 'Currency', key: 'currency' },
          { header: 'Payout Account', key: 'payoutAccount' },
          { header: 'Reviewed By', key: 'reviewerId' },
          { header: 'Reviewed At', key: 'reviewedAt' },
          { header: 'Notes', key: 'note' }
        );
        break;
        
      case 'TRANSACTIONS':
        // Add comprehensive transaction fields
        enhancedColumns.push(
          { header: 'Currency', key: 'currency' },
          { header: 'Transaction ID', key: 'transactionId' },
          { header: 'Method', key: 'method' },
          { header: 'Processed At', key: 'processedAt' }
        );
        break;
        
      case 'BONUS_CAMPAIGNS':
      case 'BONUSCAMPAIGNS':
        // Add currency for whitelabel context (only if no agent is logged in)
        if (whitelabelId && !isAgent && !agentType) {
          enhancedColumns.push({ header: 'Currency', key: 'currency' });
        }
        break;
        
      case 'AUDIT_LOGS':
      case 'AUDITLOGS':
        // Add currency for whitelabel context (only if no agent is logged in)
        if (whitelabelId && !isAgent && !agentType) {
          enhancedColumns.push({ header: 'Currency', key: 'currency' });
        }
        break;
        
      case 'COMMISSION':
        // The per-cycle base columns are the whole report (agentExportRows.CommissionExportRow).
        break;
        
      case 'SETTLEMENT':
      case 'SETTLEMENTS':
        // Add comprehensive settlement fields
        enhancedColumns.push(
          { header: 'Agent Name', key: 'name' },
          { header: 'Agent Type', key: 'type' },
          { header: 'Settlement Type', key: 'status' },
          { header: 'Direction', key: 'direction' },
          { header: 'Period From', key: 'periodFrom' },
          { header: 'Period To', key: 'periodTo' },
          { header: 'Total Amount', key: 'totalAmount', format: (v: any) => String(v || 0) },
          { header: 'Previous Balance', key: 'previousBalance', format: (v: any) => String(v || 0) },
          { header: 'New Balance', key: 'newBalance', format: (v: any) => String(v || 0) },
          { header: 'Currency', key: 'currency' },
          { header: 'Posted At', key: 'postedAt' },
          { header: 'Posted By', key: 'postedBy' },
          { header: 'Notes', key: 'notes' }
        );
        // An agent's file holds its own and its direct children's settlements: say whose each is.
        if (isAgent) {
          enhancedColumns.push(
            { header: 'Agent ID', key: 'agentId' },
            { header: 'Relation', key: 'relation' }
          );
        }
        break;
        
      case 'GGR':
        // Add comprehensive GGR fields
        enhancedColumns.push(
          { header: 'Domain', key: 'domain' },
          { header: 'Total Stakes', key: 'totalStakes', format: (v: any) => String(v || 0) },
          { header: 'Total Payouts', key: 'totalPayouts', format: (v: any) => String(v || 0) },
          { header: 'GGR', key: 'ggr', format: (v: any) => String(v || 0) },
          { header: 'Hold Percentage', key: 'holdPercentage', format: (v: any) => v ? `${(Number(v) * 100).toFixed(2)}%` : '0%' },
          { header: 'Currency', key: 'currency' }
        );
        break;
    }
    
    return enhancedColumns;
  }

  // Data fetching methods - enhanced with context-aware fields
  private async fetchPlayersData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    const { listUsersDb } = await import('@/repos/users/usersRepo.js');
    const { wallets, users } = await import('@shared/db/schema.js');
    const { eq, and, inArray } = await import('drizzle-orm');
    const { db } = await import('@/db/client.js');
    
    let list: any[] = [];
    
    if (exportContext?.agentContext) {
      // The agent's players: its subtree's players plus their confirmed referrals, in SQL before the
      // row cap. (users.agent_id IN subtree, used before, missed the referral-linked players.)
      list = await agentPlayersQuery(agentQueryScope(exportContext), filters.status);
    } else {
      // No agent context - admin user, get all players (still filtered by whitelabel)
      const raw = await listUsersDb(
        {
          status: filters.status as any,
          agentId: filters.agentId,
          query: filters.query,
        },
        context.tenant
      );
      list = Array.isArray(raw) ? raw : (raw as { rows: unknown[] }).rows;
    }
    
    if (list.length === 0) {
      return [];
    }
    
    // Batch fetch wallets for all users to avoid N+1 queries
    const userIds = list.map((u: any) => u.id);
    const walletsList = await db
      .select({
        userId: wallets.userId,
        cash: wallets.cash,
        bonus: wallets.bonus,
        currency: wallets.currency,
        exposure: wallets.exposure,
      })
      .from(wallets)
      .where(
        and(
          eq(wallets.tenant, context.tenant),
          inArray(wallets.userId, userIds)
        )
      );
    
    // Create maps for quick lookup
    const walletMap = new Map(
      walletsList.map((w: any) => [
        w.userId,
        {
          cash: Number(w.cash || 0),
          bonus: Number(w.bonus || 0),
          currency: w.currency || 'USD',
          exposure: Number(w.exposure || 0),
        }
      ])
    );
    
    // Fetch credit info for credit agents
    let creditMap = new Map<number, any>();
    if (exportContext?.agentContext?.schemeType === 'CREDIT' && exportContext.agentContext.agentId) {
      try {
        const { AgentPlayerCreditsRepo } = await import('@/repos/agents/AgentPlayerCreditsRepo.js');
        const creditRepo = new AgentPlayerCreditsRepo();
        const credits = await creditRepo.listAgentPlayers(exportContext.agentContext.agentId);
        credits.forEach((c: any) => {
          creditMap.set(c.playerId, {
            creditLimit: c.creditLimit,
            creditUsed: c.creditUsed,
            creditAvailable: c.creditAvailable,
            exposure: c.openExposure,
          });
        });
      } catch (error) {
      }
    }
    
    // Map users with enhanced data
    return list.map((u: any) => {
      const wallet = walletMap.get(u.id);
      const credit = creditMap.get(u.id);
      
      return {
        id: u.id,
        name: u.name || '',
        email: u.email || '',
        phone: u.phone || '',
        balance: wallet?.cash || 0,
        cashBalance: wallet?.cash || 0,
        bonusBalance: wallet?.bonus || 0,
        status: u.status || '',
        registeredAt: u.createdAt ? new Date(u.createdAt).toISOString() : '',
        username: u.username || '',
        currency: wallet?.currency || exportContext?.whitelabelMetadata?.currency || 'USD',
        // Only include whitelabel fields if no agent is logged in
        ...(exportContext?.agentContext ? {} : {
          // whitelabelId not supported in ListDepositRequestsFilter
          whitelabelName: exportContext?.whitelabelMetadata?.name || '',
          whitelabelDomain: exportContext?.whitelabelMetadata?.domain || '',
        }),
        // Credit agent specific fields
        creditLimit: credit?.creditLimit || u.creditLimit || 0,
        creditUsed: credit?.creditUsed || u.creditUsed || 0,
        creditAvailable: credit?.creditAvailable || u.creditAvailable || 0,
        exposure: credit?.exposure || wallet?.exposure || 0,
        playerType: u.playerType || 'REGULAR',
        agentId: u.agentId || '',
        vipTier: u.vipTierId || '',
        lastLogin: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : '',
      };
    });
  }

  private async fetchAgentsData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
    const { AgentConfigsRepo } = await import('@/repos/agents/AgentConfigsRepo.js');
    const { agentWallets, agents } = await import('@shared/db/schema.js');
    const { eq, and, inArray } = await import('drizzle-orm');
    const { db } = await import('@/db/client.js');
    
    const agentsRepo = new AgentsRepo();
    const configsRepo = new AgentConfigsRepo();
    
    let filteredAgents: any[] = [];
    if (exportContext?.agentContext) {
      // An agent's SUBAGENTS export: its sub-agents at every depth (agent_hierarchy_closure), not
      // itself. agentExportPolicy never lets an agent run the whole-whitelabel AGENTS export.
      const scope = requireAgentScope(exportContext);
      const subAgentIds = scope.subtreeIds.filter((id) => id !== scope.scopeAgentId);
      if (subAgentIds.length === 0) {
        return [];
      }
      const { agentCredentials } = await import('@shared/db/schema.js');
      const whereConditions = [
        eq(agents.tenantId, context.tenant),
        inArray(agents.id, subAgentIds),
      ];
      if (filters.status) {
        whereConditions.push(eq(agents.status, filters.status as any));
      }
      
      const agentsWithCredentials = await db
        .select({
          id: agents.id,
          tenantId: agents.tenantId,
          schemeType: agents.schemeType,
          allowedDomains: agents.allowedDomains,
          status: agents.status,
          phone: agents.phone,
          parentAgentId: agents.parentAgentId,
          levelIndex: agents.levelIndex,
          tallyEnabled: agents.tallyEnabled,
          tallyDomains: agents.tallyDomains,
          creditLimit: agents.creditLimit,
          creditUsed: agents.creditUsed,
          creditAvailable: agents.creditAvailable,
          creditAlertThreshold: agents.creditAlertThreshold,
          createdAt: agents.createdAt,
          username: agentCredentials.username,
        })
        .from(agents)
        .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
        .where(and(...whereConditions))
        .limit(10000);
      
      filteredAgents = agentsWithCredentials;
    } else {
      // No agent context - admin user, get all agents (still filtered by whitelabel)
      const agentsList = await agentsRepo.list(
        context.tenant,
        {
          schemeType: filters.schemeType as any,
          status: filters.status,
          query: filters.query,
          parentAgentId: filters.parentAgentId,
        },
        { offset: 0, limit: 10000 }
      );
      filteredAgents = agentsList;
    }
    
    // Batch fetch wallets and configs
    const agentIds = filteredAgents.map((a: any) => a.id);
    const walletsList = agentIds.length > 0 ? await db
      .select({
        agentId: agentWallets.agentId,
        balance: agentWallets.balance,
        lockedBalance: agentWallets.lockedBalance,
        currency: agentWallets.currency,
      })
      .from(agentWallets)
      .where(inArray(agentWallets.agentId, agentIds)) : [];
    
    const walletMap = new Map(
      walletsList.map((w: any) => [
        w.agentId,
        {
          balance: Number(w.balance || 0),
          lockedBalance: Number(w.lockedBalance || 0),
          currency: w.currency || 'USD',
        }
      ])
    );
    
    // Fetch commission/sharing configs if needed
    const now = new Date();
    const configsMap = new Map();
    
    if (agentIds.length > 0) {
      for (const agent of filteredAgents) {
        if (agent.schemeType === 'COMMISSION') {
          const sportsConfig = await configsRepo.getCommissionConfig(agent.id, 'sports', now);
          const casinoConfig = await configsRepo.getCommissionConfig(agent.id, 'casino', now);
          const matkaConfig = await configsRepo.getCommissionConfig(agent.id, 'matka', now);
          configsMap.set(agent.id, {
            commissionRateSports: sportsConfig ? Number(sportsConfig.commissionRate) : null,
            commissionRateCasino: casinoConfig ? Number(casinoConfig.commissionRate) : null,
            commissionRateMatka: matkaConfig ? Number(matkaConfig.commissionRate) : null,
          });
        } else if (agent.schemeType === 'SHARING') {
          const sportsConfig = await configsRepo.getSharingConfig(agent.id, 'sports', now);
          const casinoConfig = await configsRepo.getSharingConfig(agent.id, 'casino', now);
          const matkaConfig = await configsRepo.getSharingConfig(agent.id, 'matka', now);
          configsMap.set(agent.id, {
            sharingRateSports: sportsConfig ? Number(sportsConfig.shareRate) : null,
            sharingRateCasino: casinoConfig ? Number(casinoConfig.shareRate) : null,
            sharingRateMatka: matkaConfig ? Number(matkaConfig.shareRate) : null,
          });
        }
      }
    }
    
    return filteredAgents.map((a: any) => {
      const wallet = walletMap.get(a.id);
      const configs = configsMap.get(a.id);
      
      return {
        id: a.id,
        name: a.username || '',
        email: a.phone || '',
        type: a.schemeType || '',
        credit: Number(a.creditAvailable || 0),
        status: a.status || '',
        username: a.username || '',
        phone: a.phone || '',
        tenantId: a.tenantId || '',
        allowedDomains: Array.isArray(a.allowedDomains) ? a.allowedDomains.join(', ') : '',
        parentAgentId: a.parentAgentId || '',
        levelIndex: a.levelIndex || '',
        createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : '',
        // Only include whitelabel fields if no agent is logged in
        ...(exportContext?.agentContext ? {} : {
          // whitelabelId not supported in ListDepositRequestsFilter
          whitelabelName: exportContext?.whitelabelMetadata?.name || '',
          whitelabelDomain: exportContext?.whitelabelMetadata?.domain || '',
        }),
        // Commission agent specific
        tallyEnabled: a.tallyEnabled ? 'Yes' : 'No',
        tallyDomains: Array.isArray(a.tallyDomains) ? a.tallyDomains.join(', ') : '',
        commissionRateSports: configs?.commissionRateSports || null,
        commissionRateCasino: configs?.commissionRateCasino || null,
        commissionRateMatka: configs?.commissionRateMatka || null,
        // Sharing/Credit agent specific
        creditLimit: Number(a.creditLimit || 0),
        creditUsed: Number(a.creditUsed || 0),
        creditAlertThreshold: Number(a.creditAlertThreshold || 80),
        walletBalance: wallet?.balance || 0,
        lockedBalance: wallet?.lockedBalance || 0,
        // Sharing agent specific
        sharingRateSports: configs?.sharingRateSports || null,
        sharingRateCasino: configs?.sharingRateCasino || null,
        sharingRateMatka: configs?.sharingRateMatka || null,
      };
    });
  }

  private async fetchSportsBetsData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    const { getSportsBets } = await import('@/repos/sports/sportsBetsRepo.js');
    const { AgentConfigsRepo } = await import('@/repos/agents/AgentConfigsRepo.js');
    
    // An agent's bets are its players' bets, filtered in SQL before the 10k cap (agentExportQueries).
    // The old path read the whitelabel's latest 10k bets and filtered them in memory, so an agent's
    // file silently missed rows once the whitelabel had more.
    let filteredBets: any[];
    if (exportContext?.agentContext) {
      const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
      const timeZone = await getWhitelabelTimezone(context.tenant);
      filteredBets = await agentSportsBetsQuery(agentQueryScope(exportContext), betExportWindow(filters, timeZone), filters.status);
    } else {
      filteredBets = (await getSportsBets({
        tenant: context.tenant,
        whitelabelId: context.whitelabelId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status as any,
        userId: filters.userId,
        limit: 10000, // Get up to 10k bets
        offset: 0,
      })) || [];
    }

    // Fetch commission/sharing configs if agent context exists
    let commissionRate: number | null = null;
    let sharingRate: number | null = null;
    
    if (exportContext?.agentContext) {
      const configsRepo = new AgentConfigsRepo();
      const now = new Date();
      
      if (exportContext.agentContext.schemeType === 'COMMISSION') {
        const config = await configsRepo.getCommissionConfig(exportContext.agentContext.agentId, 'sports', now);
        commissionRate = config ? Number(config.commissionRate) : null;
      } else if (exportContext.agentContext.schemeType === 'SHARING') {
        const config = await configsRepo.getSharingConfig(exportContext.agentContext.agentId, 'sports', now);
        sharingRate = config ? Number(config.shareRate) : null;
      }
    }
    
    return filteredBets.map((b: any) => {
      const stake = Number(b.stake || 0);
      const payout = Number(b.liability || 0);
      const ggr = stake - payout; // Simplified GGR calculation
      
      return {
        id: b.id,
        userId: b.userId,
        amount: stake,
        status: b.status || '',
        createdAt: b.createdAt ? (b.createdAt instanceof Date ? b.createdAt.toISOString() : new Date(b.createdAt).toISOString()) : '',
        // Only include whitelabel fields if no agent is logged in
        ...(exportContext?.agentContext ? {} : {
          // whitelabelId not supported in ListDepositRequestsFilter
          whitelabelName: exportContext?.whitelabelMetadata?.name || '',
          whitelabelDomain: exportContext?.whitelabelMetadata?.domain || '',
        }),
        // Enhanced fields
        sportName: b.sportName || '',
        leagueName: b.leagueName || '',
        eventName: b.eventName || '',
        stake: stake,
        price: Number(b.price || 0),
        side: b.side || '',
        currency: b.currency || exportContext?.whitelabelMetadata?.currency || 'USD',
        matchedAt: b.matchedAt ? (b.matchedAt instanceof Date ? b.matchedAt.toISOString() : new Date(b.matchedAt).toISOString()) : '',
        settledAt: b.settledAt ? (b.settledAt instanceof Date ? b.settledAt.toISOString() : new Date(b.settledAt).toISOString()) : '',
        result: b.result || '',
        // Commission/Sharing fields
        // commissionRate and sharingRate are stored as decimals (0..1), e.g., 0.05 for 5%
        commissionRate: commissionRate,
        commissionAmount: commissionRate ? (ggr * commissionRate) : 0, // No division by 100 needed
        ggr: ggr,
        sharingRate: sharingRate,
        shareAmount: sharingRate ? (ggr * sharingRate) : 0, // No division by 100 needed
      };
    });
  }

  private async fetchCasinoBetsData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    const { getCasinoBets } = await import('@/repos/casino/casinoBetsRepo.js');
    const { AgentConfigsRepo } = await import('@/repos/agents/AgentConfigsRepo.js');
    
    // An agent's bets, filtered in SQL before the cap (see fetchSportsBetsData).
    let filteredBets: any[];
    if (exportContext?.agentContext) {
      const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
      const timeZone = await getWhitelabelTimezone(context.tenant);
      filteredBets = await agentCasinoBetsQuery(agentQueryScope(exportContext), betExportWindow(filters, timeZone), filters.status);
    } else {
      filteredBets = (await getCasinoBets({
        tenant: context.tenant,
        whitelabelId: context.whitelabelId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status as any,
        userId: filters.userId,
        limit: 10000,
        offset: 0,
      })) || [];
    }
    
    // Fetch commission/sharing configs if agent context exists
    let commissionRate: number | null = null;
    let sharingRate: number | null = null;
    
    if (exportContext?.agentContext) {
      const configsRepo = new AgentConfigsRepo();
      const now = new Date();
      
      if (exportContext.agentContext.schemeType === 'COMMISSION') {
        const config = await configsRepo.getCommissionConfig(exportContext.agentContext.agentId, 'casino', now);
        commissionRate = config ? Number(config.commissionRate) : null;
      } else if (exportContext.agentContext.schemeType === 'SHARING') {
        const config = await configsRepo.getSharingConfig(exportContext.agentContext.agentId, 'casino', now);
        sharingRate = config ? Number(config.shareRate) : null;
      }
    }
    
    return filteredBets.map((b: any) => {
      const stake = Number(b.stake || 0);
      const winAmount = Number(b.winAmount || 0);
      const netAmount = Number(b.netAmount || 0);
      const ggr = stake - winAmount; // GGR = stake - win
      
      return {
        id: b.id,
        userId: b.userId,
        amount: stake,
        status: b.status || '',
        createdAt: b.createdAt ? (b.createdAt instanceof Date ? b.createdAt.toISOString() : new Date(b.createdAt).toISOString()) : '',
        // Only include whitelabel fields if no agent is logged in
        ...(exportContext?.agentContext ? {} : {
          // whitelabelId not supported in ListDepositRequestsFilter
          whitelabelName: exportContext?.whitelabelMetadata?.name || '',
          whitelabelDomain: exportContext?.whitelabelMetadata?.domain || '',
        }),
        // Enhanced fields
        gameName: b.gameName || '',
        vendorName: b.vendorName || '',
        stake: stake,
        payout: Number(b.payout || 0),
        winAmount: winAmount,
        netAmount: netAmount,
        currency: b.currency || exportContext?.whitelabelMetadata?.currency || 'USD',
        settledAt: b.settledAt ? (b.settledAt instanceof Date ? b.settledAt.toISOString() : new Date(b.settledAt).toISOString()) : '',
        // Commission/Sharing fields
        // commissionRate and sharingRate are stored as decimals (0..1), e.g., 0.05 for 5%
        commissionRate: commissionRate,
        commissionAmount: commissionRate && ggr > 0 ? (ggr * commissionRate) : 0, // No division by 100 needed
        ggr: ggr,
        sharingRate: sharingRate,
        shareAmount: sharingRate && ggr > 0 ? (ggr * sharingRate) : 0, // No division by 100 needed
      };
    });
  }

  private async fetchMatkaBetsData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    const { getMatkaBets } = await import('@/repos/matka/matkaBetsRepo.js');
    const { AgentConfigsRepo } = await import('@/repos/agents/AgentConfigsRepo.js');
    
    // An agent's bets, filtered in SQL before the cap (see fetchSportsBetsData).
    let filteredBets: any[];
    if (exportContext?.agentContext) {
      const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
      const timeZone = await getWhitelabelTimezone(context.tenant);
      filteredBets = await agentMatkaBetsQuery(
        agentQueryScope(exportContext),
        betExportWindow(filters, timeZone),
        filters.status,
        filters.matkaType
      );
    } else {
      filteredBets = (await getMatkaBets({
        tenant: context.tenant,
        whitelabelId: context.whitelabelId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status as any,
        userId: filters.userId,
        matkaType: filters.matkaType as any,
        limit: 10000,
        offset: 0,
      })) || [];
    }
    
    // Fetch commission/sharing configs if agent context exists
    let commissionRate: number | null = null;
    let sharingRate: number | null = null;
    
    if (exportContext?.agentContext) {
      const configsRepo = new AgentConfigsRepo();
      const now = new Date();
      
      if (exportContext.agentContext.schemeType === 'COMMISSION') {
        const config = await configsRepo.getCommissionConfig(exportContext.agentContext.agentId, 'matka', now);
        commissionRate = config ? Number(config.commissionRate) : null;
      } else if (exportContext.agentContext.schemeType === 'SHARING') {
        const config = await configsRepo.getSharingConfig(exportContext.agentContext.agentId, 'matka', now);
        sharingRate = config ? Number(config.shareRate) : null;
      }
    }
    
    return filteredBets.map((b: any) => {
      const betAmount = Number(b.betAmount || 0);
      const actualWin = Number(b.actualWin || 0);
      const ggr = betAmount - actualWin; // GGR = bet amount - actual win
      
      return {
        id: b.id,
        userId: b.userId,
        amount: betAmount,
        type: b.matkaType || b.type || '',
        createdAt: b.createdAt ? (b.createdAt instanceof Date ? b.createdAt.toISOString() : new Date(b.createdAt).toISOString()) : '',
        // Only include whitelabel fields if no agent is logged in
        ...(exportContext?.agentContext ? {} : {
          // whitelabelId not supported in ListDepositRequestsFilter
          whitelabelName: exportContext?.whitelabelMetadata?.name || '',
          whitelabelDomain: exportContext?.whitelabelMetadata?.domain || '',
        }),
        // Enhanced fields
        marketName: b.marketName || '',
        marketSession: b.marketSession || '',
        bidType: b.bidType || '',
        betNumbers: b.betNumbers || '',
        payoutMultiplier: Number(b.payoutMultiplier || 0),
        potentialWin: Number(b.potentialWin || 0),
        actualWin: actualWin,
        currency: b.currency || exportContext?.whitelabelMetadata?.currency || 'USD',
        settledAt: b.settledAt ? (b.settledAt instanceof Date ? b.settledAt.toISOString() : new Date(b.settledAt).toISOString()) : '',
        result: b.result || '',
        // Commission/Sharing fields
        // commissionRate and sharingRate are stored as decimals (0..1), e.g., 0.05 for 5%
        commissionRate: commissionRate,
        commissionAmount: commissionRate && ggr > 0 ? (ggr * commissionRate) : 0, // No division by 100 needed
        ggr: ggr,
        sharingRate: sharingRate,
        shareAmount: sharingRate && ggr > 0 ? (ggr * sharingRate) : 0, // No division by 100 needed
      };
    });
  }

  private async fetchDepositsData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    const { listDepositRequests } = await import('@/repos/deposits/depositRequestsRepo.js');
    
    // An agent's deposit requests: its players', filtered in SQL before the cap.
    let filteredItems: any[];
    if (exportContext?.agentContext) {
      filteredItems = await agentDepositsQuery(agentQueryScope(exportContext), instantExportWindow(filters), filters.status);
    } else {
      const result = await listDepositRequests(
        {
          // whitelabelId not supported in ListDepositRequestsFilter
          status: filters.status as any,
          userId: filters.userId,
          fromDate: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
          toDate: filters.dateTo ? new Date(filters.dateTo) : undefined,
        },
        context.tenant,
        { offset: 0, limit: 10000 }
      );
      filteredItems = result.items;
    }
    
    return filteredItems.map((d: any) => ({
      id: d.id,
      userId: d.userId,
      amount: Number(d.amount || 0),
      status: d.status || '',
      createdAt: d.createdAt ? (d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date(d.createdAt).toISOString()) : '',
      // Only include whitelabel fields if no agent is logged in
      ...(exportContext?.agentContext ? {} : {
        // whitelabelId not supported in ListDepositRequestsFilter
        whitelabelName: exportContext?.whitelabelMetadata?.name || '',
        whitelabelDomain: exportContext?.whitelabelMetadata?.domain || '',
      }),
      // Enhanced fields
      method: d.method || '',
      currency: d.currency || exportContext?.whitelabelMetadata?.currency || 'USD',
      transactionId: d.transactionId || '',
      processedAt: d.processedAt ? (d.processedAt instanceof Date ? d.processedAt.toISOString() : new Date(d.processedAt).toISOString()) : '',
      notes: d.notes || '',
      // Credit agent specific
      creditAllocation: exportContext?.agentContext?.schemeType === 'CREDIT' ? Number(d.amount || 0) : 0,
    }));
  }

  private async fetchWithdrawalsData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    const { listWithdrawalRequests } = await import('@/repos/payments/withdrawalRequestsRepo.js');
    
    // An agent's withdrawal requests: its players', filtered in SQL before the cap.
    let filteredItems: any[];
    if (exportContext?.agentContext) {
      filteredItems = await agentWithdrawalsQuery(agentQueryScope(exportContext), instantExportWindow(filters), filters.status);
    } else {
      const result = await listWithdrawalRequests(
        {
          status: filters.status as any,
          userId: filters.userId,
          fromDate: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
          toDate: filters.dateTo ? new Date(filters.dateTo) : undefined,
        },
        context.tenant,
        { offset: 0, limit: 10000 }
      );
      filteredItems = result.items;
    }
    
    return filteredItems.map((w: any) => ({
      id: w.id,
      userId: w.userId,
      amount: Number(w.amount || 0),
      status: w.status || '',
      createdAt: w.createdAt ? (w.createdAt instanceof Date ? w.createdAt.toISOString() : new Date(w.createdAt).toISOString()) : '',
      // Only include whitelabel fields if no agent is logged in
      ...(exportContext?.agentContext ? {} : {
        // whitelabelId not supported in ListDepositRequestsFilter
        whitelabelName: exportContext?.whitelabelMetadata?.name || '',
        whitelabelDomain: exportContext?.whitelabelMetadata?.domain || '',
      }),
      // Enhanced fields
      currency: w.currency || exportContext?.whitelabelMetadata?.currency || 'USD',
      payoutAccount: w.payoutAccountId || '',
      reviewerId: w.reviewerId || '',
      reviewedAt: w.reviewedAt ? (w.reviewedAt instanceof Date ? w.reviewedAt.toISOString() : new Date(w.reviewedAt).toISOString()) : '',
      note: w.note || '',
    }));
  }

  private async fetchBonusCampaignsData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    // Bonus campaigns are whitelabel-level: never an agent's (fetchExportData refuses it first).
    if (exportContext?.agentContext) {
      return [];
    }
    try {
      const { bonusCampaigns } = await import('@shared/db/schema.js');
      const { eq, and } = await import('drizzle-orm');
      const { db } = await import('@/db/client.js');
      
      const conditions = [
        eq(bonusCampaigns.tenant, context.tenant),
        // bonus_campaigns uses tenant, not whitelabelId
      ];
      
      if (filters.status) {
        conditions.push(eq(bonusCampaigns.status, filters.status as any));
      }
      
      const campaigns = await db
        .select()
        .from(bonusCampaigns)
        .where(and(...conditions))
        .limit(10000);
      
      return campaigns.map((c: any) => ({
        id: c.id,
        name: c.name || '',
        status: c.status || '',
        domain: c.domain || '',
        createdAt: c.createdAt ? (c.createdAt instanceof Date ? c.createdAt.toISOString() : new Date(c.createdAt).toISOString()) : '',
        // Only include whitelabel fields if no agent is logged in
        ...(exportContext?.agentContext ? {} : {
          // whitelabelId not supported in ListDepositRequestsFilter
          whitelabelName: exportContext?.whitelabelMetadata?.name || '',
          whitelabelDomain: exportContext?.whitelabelMetadata?.domain || '',
          currency: exportContext?.whitelabelMetadata?.currency || 'USD',
        }),
      }));
    } catch (error) {
      return [];
    }
  }

  private async fetchCommissionData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    // This report has only ever been built for agents; an admin's export stays empty, as before.
    if (!exportContext?.agentContext) {
      return [];
    }
    // COMMISSION agents (agentExportPolicy): one row per agent per IST week, for the agent and every
    // sub-agent below it, from the commission engine's own cycle list: gross, adjustments, payable,
    // paid, status, and the loss carry-forward once the engine reports it. It used to sum raw
    // agent_ledger COMMISSION lines, which carry none of the payable figures.
    const scope = requireAgentScope(exportContext);
    const [{ CommissionCycleService }, { AgentsRepo }, { CommissionPayoutsRepo }] = await Promise.all([
      import('@/domains/agents/services/CommissionCycleService.js'),
      import('@/repos/agents/AgentsRepo.js'),
      import('@/repos/settlements/CommissionPayoutsRepo.js'),
    ]);
    const agentsInScope = orderScopeAgents(
      (await agentsInScopeQuery(context.tenant, scope.subtreeIds)).map((agent) => ({ ...agent, id: String(agent.id) })),
      scope.scopeAgentId
    );
    const cycleService = new CommissionCycleService(new AgentsRepo(), new CommissionPayoutsRepo());
    const cyclesByAgent = new Map<string, CommissionCycleInfo[]>();
    for (const agent of agentsInScope) {
      if (agent.schemeType !== 'COMMISSION') continue;
      cyclesByAgent.set(agent.id, await cycleService.listCyclesForAgent(agent.id, context.tenant));
    }
    return buildCommissionCycleRows(agentsInScope, cyclesByAgent, {
      window: instantExportWindow(filters),
      scopeAgentId: scope.scopeAgentId,
      currency: exportContext.whitelabelMetadata?.currency || 'USD',
    });
  }

  private async fetchSettlementData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    // This report has only ever been built for agents; an admin's export stays empty, as before.
    if (!exportContext?.agentContext) {
      return [];
    }
    // SHARING/CREDIT agents (agentExportPolicy): the agent's own settlements and those of its direct
    // children, i.e. the settlements it receives and the ones it makes (agent features spec §4).
    const scope = requireAgentScope(exportContext);
    const agentIds = await loadSettlementAgentIds(scope.scopeAgentId);
    const settlements = await agentSettlementsQuery(context.tenant, agentIds, instantExportWindow(filters));
    const named = await agentsInScopeQuery(context.tenant, agentIds);
    const agentsById = new Map(named.map((agent) => [String(agent.id), agent]));
    const currency = exportContext.whitelabelMetadata?.currency || 'USD';
    return settlements.map((settlement) =>
      toAgentSettlementRow(settlement, agentsById.get(String(settlement.agentId)), {
        scopeAgentId: scope.scopeAgentId,
        periodFrom: filters.dateFrom,
        periodTo: filters.dateTo,
        currency,
      })
    );
  }

  private async fetchAuditLogsData(
    filters: ExportFilters,
    context: { tenant: string; whitelabelId: string },
    exportContext?: ExportContext
  ): Promise<any[]> {
    try {
      const { auditLogs } = await import('@shared/db/schema.js');
      const { eq, and, gte, lte, inArray } = await import('drizzle-orm');
      const { db } = await import('@/db/client.js');
      
      const conditions = [
        eq(auditLogs.tenant, context.tenant),
      ];
      
      if (filters.dateFrom) {
        conditions.push(gte(auditLogs.createdAt, new Date(filters.dateFrom)));
      }
      if (filters.dateTo) {
        conditions.push(lte(auditLogs.createdAt, new Date(filters.dateTo)));
      }
      
      // The audit trail is whitelabel-level: never an agent's (fetchExportData refuses it first).
      if (exportContext?.agentContext) {
        return [];
      } else if (filters.userId) {
        // No agent context - admin user, can filter by specific userId if provided
        conditions.push(eq(auditLogs.actorId, String(filters.userId)));
      }
      
      const logs = await db
        .select({
          id: auditLogs.id,
          tenant: auditLogs.tenant,
          actorId: auditLogs.actorId,
          domain: auditLogs.domain,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          before: auditLogs.before,
          after: auditLogs.after,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(and(...conditions))
        .limit(10000);
      
      return logs.map((l: any) => ({
        id: String(l.id),
        action: l.action || '',
        userId: l.actorId || '',
        createdAt: l.createdAt ? (l.createdAt instanceof Date ? l.createdAt.toISOString() : new Date(l.createdAt).toISOString()) : '',
        // Only include whitelabel fields if no agent is logged in
        ...(exportContext?.agentContext ? {} : {
          // whitelabelId not supported in ListDepositRequestsFilter
          whitelabelName: exportContext?.whitelabelMetadata?.name || '',
          whitelabelDomain: exportContext?.whitelabelMetadata?.domain || '',
        }),
        domain: l.domain || '',
        resourceType: l.resourceType || '',
        resourceId: l.resourceId || '',
      }));
    } catch (error) {
      return [];
    }
  }
}
