import { useMemo, useState } from 'react';
import type { DataTableColumn, DataTableSort } from '@/ui/components/DataTable';

export type SettlementScheme = 'SHARING' | 'CREDIT' | 'COMMISSION';
export interface SettlementDomain {
  domain: string; amount: number; percentage: number; cutAmount: number; cutPercentage: number;
  shareRate?: number | string | null; agentShare?: number | null;
}
export interface ContributionDomain { domain: string; pl: number; share: number; cutAmount: number }
export interface PlayerContribution {
  playerId: string; playerName?: string | null; playerUsername?: string | null; pl: number; share: number;
  domainBreakdown?: ContributionDomain[]; contributionPercentage?: number; isDirectPlayer?: boolean;
  subAgentId?: string | null; subAgentName?: string | null;
}
export interface AgentContribution {
  subAgentId: string; subAgentName?: string | null; subAgentUsername?: string | null; totalPL: number; totalShare: number;
  playerCount: number; domainBreakdown?: ContributionDomain[]; contributionPercentage?: number; players?: PlayerContribution[];
}
export interface SettlementSummary {
  /** SHARING: signed, positive = TO_AGENT (the agent is paid), negative = FROM_AGENT. */
  settlementDue?: number; settlementDirection?: string | null;
  lastSettlementDate?: string | null; lastSettlementAmount?: number; sharePercentage?: number;
  netPL?: number; currency?: string; sportsPL?: number; casinoPL?: number; matkaPL?: number; sportsShare?: number; casinoShare?: number; matkaShare?: number;
  directPlayersContribution?: number; subAgentsContribution?: number; directPlayersCount?: number; subAgentsCount?: number;
  settlementBreakdownByDomain?: SettlementDomain[]; topPlayers?: PlayerContribution[]; subAgents?: AgentContribution[];
}
export interface PendingSettlement extends SettlementSummary {
  agentId: string; agent?: { id?: string; username?: string | null; schemeType?: string }; schemeType?: string;
  /** SHARING: signed like settlementDue (positive = pay the agent); settlementDirection, when set, says who pays. */
  pendingAmount: number; settlementType: string; settledThisPeriod?: number | null; totalShareForPeriod?: number | null; totalSettledToAgent?: number | null;
  /** SHARING: the exact window [periodFrom, periodTo) the figures cover; settle with periodTo to post exactly them. */
  periodFrom?: string | null; periodTo?: string | null;
}
export interface SettlementHistoryRow {
  id: string; agentId?: string; agent?: { id?: string; username?: string | null; schemeType?: string };
  periodFrom: string; periodTo: string; totalAmount: number; direction?: string; status?: string; currency?: string;
  notes?: string | null; postedBy?: string | null; postedAt?: string | null; createdAt: string;
}
export interface SettlementDetails extends SettlementHistoryRow, SettlementSummary {
  domainBreakdown?: SettlementDomain[]; playerContributions?: PlayerContribution[]; subAgentContributions?: AgentContribution[];
}
/** The admin settlement dashboard. CREDIT is not in it since 2026-11-02 (its chips move by Deposit / Withdraw). */
export interface SettlementDashboard {
  /** NET (to pay − to collect); can be negative. */
  pendingSharingSettlements?: number; pendingSharingToAgents?: number | null; pendingSharingFromAgents?: number | null;
  pendingCommissionPayouts?: number;
  totalSettledThisMonth?: number; totalSettledLast30Days?: number; totalCommissionPaidThisMonth?: number;
  periodFrom?: string; periodTo?: string;
  totalSettledInPeriod?: number; totalPaidToAgentsInPeriod?: number; totalCollectedFromAgentsInPeriod?: number; totalCommissionPaidInPeriod?: number;
  monthlyTrend?: Array<{ month: string; totalSettled: number; commissionPaid: number }>;
}
export interface CommissionSummary {
  agentId: string; username: string | null; pendingCommission: number; totalPaid: number; lastPaidAt: string | null;
  sportsGGR: number; casinoGGR: number; matkaGGR: number; sportsCommission: number; casinoCommission: number; matkaCommission: number;
  sportsCommissionRate: number; casinoCommissionRate: number; matkaCommissionRate: number; currency: string;
  effectiveCalculatedTotal?: number; effectiveSportsCommission?: number; effectiveCasinoCommission?: number; effectiveMatkaCommission?: number;
  tallyApplied?: { enabled: boolean; domains?: string[] };
}
export interface CommissionReadiness { ready: boolean; payableAmount: number; reasons?: string[]; openBets?: number | null; unresolvedAdjustments?: number | null }

/**
 * Who pays a settlement: TO_AGENT (you pay the agent), FROM_AGENT (the agent pays you) or NONE. The backend's
 * settlementDirection wins; without it the sign decides (positive = TO_AGENT, the settlement engine's convention).
 */
export type SettlementDirection = 'TO_AGENT' | 'FROM_AGENT' | 'NONE';
export function settlementDirectionOf(direction: string | null | undefined, signedAmount: number | null | undefined): SettlementDirection {
  if (direction === 'TO_AGENT' || direction === 'FROM_AGENT') return direction;
  const amount = Number(signedAmount ?? 0);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return 'NONE';
  return amount > 0 ? 'TO_AGENT' : 'FROM_AGENT';
}
/** The settler's view (admin, or a parent settling its child). */
export function settlerDirectionLabel(direction: SettlementDirection): string {
  return direction === 'TO_AGENT' ? 'Pay to agent' : direction === 'FROM_AGENT' ? 'Collect from agent' : 'Settled';
}
/** The agent's own view of its settlement with its upline. */
export function agentDirectionLabel(direction: SettlementDirection): string {
  return direction === 'TO_AGENT' ? 'You receive' : direction === 'FROM_AGENT' ? 'You pay' : 'Settled';
}
/**
 * The window part of a settleAgent input. SHARING sends the pending row's periodTo, so the posted amount is
 * exactly the amount shown (the backend clamps it to now; without it the window ends when the settle runs).
 * CREDIT has no window.
 */
export function sharingSettlePeriod(row: { schemeType?: string | null; agent?: { schemeType?: string | null } | null; periodTo?: string | null } | null | undefined): { periodTo?: string } {
  const scheme = row?.schemeType || row?.agent?.schemeType;
  return scheme === 'SHARING' && row?.periodTo ? { periodTo: row.periodTo } : {};
}
/** Something is left to settle: |amount| of at least one cent, whichever way it goes. */
export function hasPendingAmount(amount: number | null | undefined): boolean {
  const value = Number(amount ?? 0);
  return Number.isFinite(value) && Math.abs(value) >= 0.01;
}
/**
 * The dashboard's SHARING pending, split: what you still pay agents and what they still pay you. The net
 * (pendingSharingSettlements) can be negative; a backend without the split fields gives only the net.
 */
export function sharingDashboardSplit(dashboard: Pick<SettlementDashboard, 'pendingSharingSettlements' | 'pendingSharingToAgents' | 'pendingSharingFromAgents'> | null | undefined) {
  const net = Number(dashboard?.pendingSharingSettlements ?? 0) || 0;
  if (dashboard?.pendingSharingToAgents != null || dashboard?.pendingSharingFromAgents != null) {
    return { toAgents: Math.abs(Number(dashboard?.pendingSharingToAgents ?? 0) || 0), fromAgents: Math.abs(Number(dashboard?.pendingSharingFromAgents ?? 0) || 0), net };
  }
  return { toAgents: net > 0 ? net : 0, fromAgents: net < 0 ? -net : 0, net };
}

/**
 * One domain row of an agent's settlement breakdown. Meanings (the settlement engine's):
 *   pl         = the players' P/L (−GGR; negative = players lost);
 *   share      = the agent's share (positive = the agent earns, negative = the agent pays);
 *   cutAmount  = the platform's part of the GGR, |GGR| − |share| (not negative);
 *   shareRate / cutPercentage in percent.
 */
export interface SettlementDomainRow { key: string; domain: string; pl: number; share: number; shareRate: number; cutAmount: number; cutPercentage: number }
const domainLabel = (domain: string) => domain.charAt(0).toUpperCase() + domain.slice(1);
export function agentSettlementDomains(settlement: SettlementSummary): SettlementDomainRow[] {
  if (settlement.settlementBreakdownByDomain?.length) return settlement.settlementBreakdownByDomain.map(item => {
    const pl = Number(item.amount) || 0;
    const rate = item.shareRate != null && item.shareRate !== '' && Number.isFinite(Number(item.shareRate)) ? Number(item.shareRate) : 100 - (Number(item.cutPercentage) || 0);
    // agentShare is the backend's share (positive = the agent earns); without it, the rate of the players' loss.
    const share = item.agentShare != null ? Number(item.agentShare) || 0 : -pl * rate / 100;
    return { key: item.domain, domain: domainLabel(item.domain), pl, share, shareRate: rate, cutAmount: Number(item.cutAmount) || 0, cutPercentage: Number(item.cutPercentage) || 0 };
  });
  return (['sports', 'casino', 'matka'] as const).map(domain => {
    const pl = settlement[`${domain}PL`] || 0; const share = settlement[`${domain}Share`] || 0;
    const shareRate = pl !== 0 ? Math.abs(share) / Math.abs(pl) * 100 : 0;
    return { key: domain, domain: domainLabel(domain), pl, share, shareRate, cutAmount: Math.max(0, Math.abs(pl) - Math.abs(share)), cutPercentage: pl !== 0 ? 100 - shareRate : 0 };
  }).filter(row => row.pl !== 0 || row.share !== 0);
}
/** The admin aggregate per domain: signed players' P/L, the agents' share and the platform cut, summed over the rows. */
export function aggregateSettlementDomains(pending: readonly PendingSettlement[]) {
  const totals = { sports: { pl: 0, share: 0, cutAmount: 0, count: 0 }, casino: { pl: 0, share: 0, cutAmount: 0, count: 0 }, matka: { pl: 0, share: 0, cutAmount: 0, count: 0 } };
  for (const settlement of pending) for (const item of settlement.settlementBreakdownByDomain || []) {
    const domain = item.domain.toLowerCase(); if (domain !== 'sports' && domain !== 'casino' && domain !== 'matka') continue;
    totals[domain].pl += Number(item.amount) || 0; totals[domain].share += Number(item.agentShare ?? 0) || 0; totals[domain].cutAmount += Number(item.cutAmount) || 0; totals[domain].count += 1;
  }
  return (['sports', 'casino', 'matka'] as const).map(domain => ({ key: domain, domain: domainLabel(domain), ...totals[domain] })).filter(row => row.count > 0 && (row.pl !== 0 || row.share !== 0 || row.cutAmount !== 0));
}

/** Client-side table ordering is applied before slicing, as the old antd tables did. */
export function useSettlementTable<T>(rows: readonly T[], columns: readonly DataTableColumn<T>[], initialSize = 10) {
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);
  const ordered = useMemo(() => {
    if (!sort) return [...rows];
    const compare = columns.find(column => column.key === sort.key)?.sort;
    return typeof compare === 'function' ? [...rows].sort((a, b) => (sort.dir === 'desc' ? -1 : 1) * compare(a, b)) : [...rows];
  }, [rows, columns, sort]);
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / size)));
  return { rows: ordered.slice((current - 1) * size, current * size), sort, onSortChange: (next: DataTableSort | null) => { setSort(next); setPage(1); }, pagination: { current, pageSize: size, total: rows.length, onChange: setPage, onPageSizeChange: (next: number) => { setSize(next); setPage(1); } } };
}
