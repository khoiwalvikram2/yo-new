export interface CasinoBet {
  id: string; userId: string | number; userName?: string | null; gameId: string | number; gameName?: string | null;
  providerId?: string; vendorId?: string; vendorName?: string | null; stake: number; payout?: number | null;
  winAmount?: number | null; netAmount?: number | null; status: string; currency?: string; createdAt: string; settledAt?: string; transactionId?: string | null;
}
export interface CasinoPlayerEvent {
  id: string; userId: string; userName?: string | null; gameId: string; gameName?: string | null; vendorName?: string | null;
  status: string; stake: number; payout?: number | null; at: string;
}
export interface CasinoPlayerRecord { id: string | number; vipTierName?: string | null; createdAt: string }
export interface CasinoBreakdown {
  byGame: Array<{ gameId: string; gameName: string; wagered: number; payouts: number; ggr: number; bets: number }>;
  byProvider: Array<{ providerId: string; providerName: string; wagered: number; payouts: number; ggr: number; bets: number }>;
  byVendor: Array<{ vendorId: string; vendorName?: string | null; wagered: number; payouts: number; ggr: number; bets: number }>;
}
export interface CasinoKpis { at: string; betsPerMin: number; wagered: number; payouts: number; ggr: number; rtp: number; activePlayers: number }
export interface CasinoDashboard { kpis: CasinoKpis; breakdown: CasinoBreakdown }
export function isGoodCasinoSnapshot(snapshot: CasinoDashboard | null | undefined) {
  if (!snapshot || !snapshot.kpis) return false;
  const kpis = snapshot.kpis;
  return [kpis.betsPerMin, kpis.wagered, kpis.payouts, kpis.ggr, kpis.rtp, kpis.activePlayers].every(value => typeof value === 'number' && Number.isFinite(value));
}
export function filterCasinoBets(bets: CasinoBet[], searchQuery: string, vendorFilter?: string, gameFilter?: string, stakeRange?: string) {
  let result = bets;
  if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(bet => bet.gameName?.toLowerCase().includes(q) || bet.userId?.toString().includes(q) || bet.userName?.toLowerCase().includes(q) || bet.transactionId?.toLowerCase().includes(q) || bet.vendorName?.toLowerCase().includes(q)); }
  if (vendorFilter) result = result.filter(bet => bet.vendorName === vendorFilter);
  if (gameFilter) result = result.filter(bet => bet.gameName === gameFilter);
  if (stakeRange) { if (stakeRange.includes('-')) { const [min, max] = stakeRange.split('-').map(Number); result = result.filter(bet => bet.stake >= min && bet.stake <= max); } else if (stakeRange.endsWith('+')) { const min = Number(stakeRange.replace('+', '')); result = result.filter(bet => bet.stake >= min); } }
  return result;
}
/** A bet's net with its sign in the text: a loss read "₹80.00" like a gain, and only the colour told them apart. */
export function signedNet(net: number, format: (value: number) => string): string {
  return `${net > 0 ? '+' : net < 0 ? '-' : ''}${format(Math.abs(net))}`
}
