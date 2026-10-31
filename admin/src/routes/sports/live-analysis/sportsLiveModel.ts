import { useMemo, useState } from 'react';
import type { DataTableColumn, DataTableSort } from '@/ui/components/DataTable';
import type { BettingPatternType, PatternSeverity } from '../components/PatternBadge';

export interface SportsLiveKpis {
  at: string; totalStake: number; totalLiability: number; netExposure: number; grossExposure: number;
  activeMarkets: number; activePlayers: number; betsPerMin: number; avgOdds: number; backBets: number; layBets: number;
}
export interface SportsLiveHistory extends SportsLiveKpis { timestamp: number }
export interface SportsBreakdownRow {
  sportId?: string; sportName?: string; leagueId?: string; leagueName?: string; eventId?: string; eventName?: string;
  marketType?: string; side?: string; totalStake: number; totalLiability: number; netExposure: number; bets: number;
}
export interface SportsLiveDashboard {
  kpis: SportsLiveKpis;
  breakdown?: { bySport?: SportsBreakdownRow[]; byLeague?: SportsBreakdownRow[]; byEvent?: SportsBreakdownRow[]; byMarketType?: SportsBreakdownRow[]; byBetSide?: SportsBreakdownRow[] };
}
export interface SportsLiveRiskAlerts {
  at: string;
  items: Array<{ id: string; entityType: string; entityId: string; entityName: string; severity: 'info' | 'warning' | 'critical'; metric: string; value: number; threshold: number; description: string; channel: string; at: string }>;
}
export interface SportsAggregateBet { id: string; userId: number; marketId: string; eventId: string; stake: number; liability: number | null; side: string; price: number; status: string; currency: string; createdAt: string }
export interface SportsPlayerSummary { userId: number; bets: number; totalStake: number; totalLiability: number; backBets: number; layBets: number; avgOdds: number; lastBetAt: string }
export interface SportsMarketSummary extends Omit<SportsPlayerSummary, 'userId'> { marketId: string; eventId: string }

export interface SidebarPattern { id?: string; userId: string; patternType: BettingPatternType; severity: PatternSeverity; metrics?: Record<string, unknown> }
export interface SidebarRunner { id?: string | number; name?: string; runnerName?: string; selectionCode?: string | number; sortPriority?: number; status?: string }
export interface SidebarMarket { id: string | number; name?: string; kind?: string; type?: string }
export interface SidebarAgent { id: string; username: string | null; schemeType: string; rate: number | null }
export interface SidebarBet {
  id: string; userId: string; eventId?: string; eventName?: string; sportId?: string; sportName?: string; leagueId?: string; leagueName?: string;
  marketId?: string; selectionId?: string; side: string; price?: number; stake: number; liability?: number; status: string; result?: string | null;
  settledAt?: string; matchedAt?: string; currency?: string; createdAt?: string; ipAddress?: string; ip?: string; ip_address?: string;
  userAgent?: string; user_agent?: string; location?: string; country?: string; deviceInfo?: string; device_info?: string; oddsSize?: number; odds_size?: number;
  userName?: string | null; userFlags?: string[]; agentInfo?: { agentId: string; agentName?: string | null; schemeType?: string; rate?: number | null };
}
export interface SidebarCut { cutAmount: number; cutPercentage: number; grossPayout: number; netPayout: number }
export interface ProcessedSidebarBet extends SidebarBet { cutInfo: SidebarCut; displayPayout: number; patterns: SidebarPattern[] }
export interface SidebarUserSummary { userId: string; bets: number; totalStake: number; totalPotentialPayout: number; totalCut: number }
export function liveChartTone(color?: string, index = 0): 'chartBlue' | 'chartPositive' | 'chartNegative' | 'chartWarning' | 'chartViolet' | 'chartIndigo' {
  const marker = color?.toLowerCase() || '';
  if (marker.includes('red') || marker.includes('neg')) return 'chartNegative';
  if (marker.includes('grn') || marker.includes('green') || marker.includes('pos')) return 'chartPositive';
  if (marker.includes('blu') || marker.includes('blue')) return 'chartBlue';
  if (marker.includes('warn') || marker.includes('amb')) return 'chartWarning';
  if (marker.includes('vio') || marker.includes('purple')) return 'chartViolet';
  return (['chartBlue', 'chartPositive', 'chartWarning', 'chartNegative', 'chartViolet', 'chartIndigo'] as const)[index % 6];
}
export function resolveSidebarMarket(marketsMap: Record<string, SidebarMarket> | undefined, marketId: unknown): SidebarMarket | null {
  if (!marketsMap || marketId == null || marketId === '') return null;
  const mid = String(marketId);
  return marketsMap[mid] || marketsMap[Number(marketId)] || Object.values(marketsMap).find(market => market && (String(market.id) === mid || Number(market.id) === Number(marketId))) || null;
}
export function resolveSidebarRunner(runners: SidebarRunner[] | undefined, selectionId: string | undefined): string | null {
  if (!runners?.length || selectionId == null || selectionId === '') return null;
  const sid = String(selectionId);
  const runner = runners.find(item => { const code = item.selectionCode != null ? String(item.selectionCode) : null; const id = item.id != null ? String(item.id) : null; return code === sid || id === sid || (code && code.toLowerCase() === sid.toLowerCase()) || (id && id.toLowerCase() === sid.toLowerCase()); });
  return runner ? String(runner.name || runner.runnerName || 'Unknown') : null;
}
export function sidebarPotentialPayout(bet: SidebarBet, markets: Record<string, SidebarMarket> | undefined): number {
  const side = String(bet?.side || '').toLowerCase(); const stake = Number(bet.stake) || 0; const liability = Number(bet.liability) || 0; const price = Number(bet.price) || 0; const oddsSize = Number(bet.oddsSize ?? bet.odds_size) || 0;
  const market = resolveSidebarMarket(markets, bet.marketId);
  const isFancy = market && (market.kind === 'fancy' || market.type === 'fancy');
  if (isFancy) return side === 'back' ? stake * oddsSize / 100 : liability;
  return side === 'back' ? stake * price - stake : stake;
}
export function sidebarBetPnL(bet: SidebarBet): number {
  const status = String(bet.status || '').toLowerCase(); const side = String(bet.side || '').toLowerCase(); const stake = Number(bet.stake) || 0; const liability = Number(bet.liability) || 0;
  if (status === 'won') return side === 'back' ? liability : stake;
  if (status === 'lost') return side === 'back' ? -stake : -liability;
  return 0;
}
export function sidebarCut(bet: SidebarBet): SidebarCut {
  const stake = Number(bet.stake) || 0; const liability = Number(bet.liability) || 0; const status = String(bet?.status || '').toLowerCase(); const side = String(bet?.side || '').toLowerCase(); const schemeType = bet?.agentInfo?.schemeType; const rate = Number(bet?.agentInfo?.rate) || 0;
  const isSettled = status === 'won' || status === 'lost';
  let platformPL = 0;
  if (status === 'won') platformPL = side === 'back' ? -liability : -stake;
  else if (status === 'lost') platformPL = side === 'back' ? stake : liability;
  let cutAmount = 0;
  if (rate > 0 && (schemeType === 'COMMISSION' || schemeType === 'SHARING' || schemeType === 'CREDIT')) {
    if (isSettled) cutAmount = schemeType === 'COMMISSION' ? platformPL > 0 ? platformPL * (rate / 100) : 0 : Math.abs(platformPL) * (rate / 100);
    else if (schemeType === 'SHARING' || schemeType === 'CREDIT') cutAmount = (side === 'back' ? liability : stake) * (rate / 100);
  }
  const grossPayout = status === 'won' ? side === 'back' ? liability : stake : bet.liability || 0;
  const netPayout = Math.max(0, grossPayout - cutAmount);
  return { cutAmount, cutPercentage: rate, grossPayout, netPayout };
}

/** Client-only presentation of the already loaded snapshot, not a server-wide query. */
export function orderedLiveRows<T>(rows: readonly T[], columns: readonly DataTableColumn<T>[], sort: DataTableSort | null): T[] {
  const compare = sort ? columns.find(column => column.key === sort.key)?.sort : undefined;
  if (!sort || typeof compare !== 'function') return [...rows];
  const direction = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => direction * compare(a, b));
}

export function useLiveTable<T>(rows: readonly T[], columns: readonly DataTableColumn<T>[], initialPageSize: number) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const ordered = useMemo(() => orderedLiveRows(rows, columns, sort), [rows, columns, sort]);
  const current = Math.min(page, Math.max(1, Math.ceil(ordered.length / pageSize)));
  return {
    rows: ordered.slice((current - 1) * pageSize, current * pageSize),
    sort,
    onSortChange: (next: DataTableSort | null) => { setSort(next); setPage(1); },
    pagination: {
      current, pageSize, total: ordered.length, onChange: setPage,
      onPageSizeChange: (next: number) => { setPageSize(next); setPage(1); },
      pageSizeOptions: [10, 20, 25, 50, 100],
    },
  };
}
