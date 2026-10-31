// TypeScript types for reporting domain
// These are generated/typed from the GraphQL schema

export type ReportingDomain = 'SPORTS' | 'CASINO' | 'MATKA' | 'AGENTS' | 'BONUSES' | 'GLOBAL';

export interface SportsKPIs {
  totalStakes: number;
  totalPayouts: number;
  totalExposure: number;
  grossGamingRevenue: number;
  netRevenue: number;
  holdPercentage: number;
  betCount: number;
  playerCount: number;
  activePlayerCount: number;
}

export interface SportsTrendPoint {
  date: string;
  stakes: number;
  payouts: number;
  ggr: number;
  betCount: number;
  playerCount: number;
}

export interface SportsBreakdown {
  id?: string;
  name: string;
  totalStakes: number;
  totalPayouts: number;
  grossGamingRevenue: number;
  betCount: number;
  playerCount: number;
}

export interface TopSportsEvent {
  eventId?: string;
  eventName: string;
  leagueName: string;
  sportName: string;
  totalStakes: number;
  totalPayouts: number;
  grossGamingRevenue: number;
  betCount: number;
}

export interface CasinoKPIs {
  totalStakes: number;
  totalPayouts: number;
  grossGamingRevenue: number;
  netRevenue: number;
  holdPercentage: number;
  betCount: number;
  playerCount: number;
  activePlayerCount: number;
}

export interface CasinoTrendPoint {
  date: string;
  stakes: number;
  payouts: number;
  ggr: number;
  betCount: number;
  playerCount: number;
}

export interface MatkaKPIs {
  totalStakes: number;
  totalPayouts: number;
  totalExposure: number;
  grossGamingRevenue: number;
  netRevenue: number;
  holdPercentage: number;
  betCount: number;
  playerCount: number;
  activePlayerCount: number;
}

export interface MatkaTrendPoint {
  date: string;
  stakes: number;
  payouts: number;
  ggr: number;
  betCount: number;
  playerCount: number;
}

export interface AgentKPIs {
  totalTurnover: number;
  totalGGR: number;
  commissionEarned: number;
  shareEarned: number;
  downlineTurnover: number;
  downlineGGR: number;
  playerCount: number;
  activePlayerCount: number;
  betCount: number;
  agentCount: number;
}

export interface AgentPerformance {
  agentId: string;
  agentName?: string;
  totalTurnover: number;
  totalGGR: number;
  commissionEarned: number;
  shareEarned: number;
  downlineTurnover: number;
  downlineGGR: number;
  playerCount: number;
  betCount: number;
  level: number;
}

export interface AgentTrendPoint {
  date: string;
  turnover: number;
  ggr: number;
  commission: number;
  share: number;
  playerCount: number;
}

export interface BonusKPIs {
  totalIssued: number;
  totalRedeemed: number;
  totalExpired: number;
  totalCancelled: number;
  outstandingLiability: number;
  totalWagering: number;
  totalRevenue: number;
  awardCount: number;
  redemptionCount: number;
  playerCount: number;
  roi: number;
}

export interface BonusCampaignPerformance {
  campaignId: number;
  campaignName: string;
  totalIssued: number;
  totalRedeemed: number;
  outstandingLiability: number;
  totalWagering: number;
  totalRevenue: number;
  awardCount: number;
  playerCount: number;
  roi: number;
}

export interface BonusTrendPoint {
  date: string;
  issued: number;
  redeemed: number;
  expired: number;
  liability: number;
  wagering: number;
  revenue: number;
}

export interface ReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
}

export interface SportsReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  agentId?: string;
  sportId?: string;
  leagueId?: string;
  eventId?: string;
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
}

export interface CasinoReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  agentId?: string;
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
}

export interface MatkaReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  agentId?: string;
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
}

export interface AgentReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  agentId?: string;
  parentAgentId?: string;
  dateFrom?: string;
  dateTo?: string;
  domain?: string;
  currency?: string;
}

export interface BonusReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  campaignId?: number;
  dateFrom?: string;
  dateTo?: string;
  domain?: string;
  currency?: string;
}

export interface SavedReport {
  id: string;
  name: string;
  description?: string;
  reportType: string;
  filtersJson: any;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedReportInput {
  name: string;
  description?: string;
  reportType: string;
  filtersJson: any;
  isPinned?: boolean;
}

export interface ExportJob {
  id: string;
  reportType: string;
  exportFormat: string;
  status: string;
  fileUrl?: string;
  errorMessage?: string;
  scheduledAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface ExportJobInput {
  reportType: string;
  filtersJson: any;
  exportFormat: string;
  scheduledAt?: string;
}

