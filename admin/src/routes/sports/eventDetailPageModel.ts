import type { EventMarket, MarketRunner } from "./components/eventMarketTypes";
import type { SidebarBet, SidebarPattern } from "./live-analysis/sportsLiveModel";

export interface EventDetailBet extends SidebarBet { [key: string]: unknown }
export type EventDetailPattern = SidebarPattern;
type RunnerId = string | number | null | undefined;
type Quote = string | number | null;
export interface FancyLine {
  id?: RunnerId; name?: string; runnerName?: string; selectionName?: string;
  priority?: Quote; b1?: Quote; l1?: Quote; b?: Quote; l?: Quote;
  back?: Quote; lay?: Quote; yes?: Quote; no?: Quote;
  bs1?: Quote; ls1?: Quote; yesSize?: Quote; noSize?: Quote; backSize?: Quote; laySize?: Quote;
  gstatus?: string | null; status1?: string | null; status?: string | null; odd_type?: unknown;
}
export interface DetailRunner extends MarketRunner {
  runnerName?: string; selectionName?: string; oddsBack?: Quote; oddsLay?: Quote; b?: Quote; l?: Quote;
  sortOrder?: Quote; _fancyLine?: FancyLine; _projectedDepth?: boolean;
}
export interface DetailMarket extends EventMarket {
  id: string; eventId?: string | number | null; marketCode?: string | null;
  runners?: DetailRunner[] | null; odds?: DetailRunner[] | null;
  _isSynthetic?: boolean; _hasWebSocketData?: boolean; _isDbBacked?: boolean; _hasProjectedDepth?: boolean;
}
export interface SocketPacket {
  runners?: DetailRunner[] | Record<string, DetailRunner>; selections?: DetailRunner[];
  payload?: Array<FancyLine | string>; lines?: Array<FancyLine | string>; data?: Array<FancyLine | string>;
}
export type OddsPayload = Record<string, unknown>;
export interface EventLiveMarket {
  marketId?: string | number; name?: string; kind?: string; state?: string;
  top?: DetailRunner[]; topRunners?: DetailRunner[]; fancy?: FancyLine[];
}
export interface EventLiveData {
  eventId?: string; at?: string; markets?: EventLiveMarket[];
  totalStake?: number | null; totalLiability?: number | null;
}
export interface EventDetailEvent {
  id: string; name?: string; sport?: string; competition?: string; startTime?: string;
  status?: string; inPlay?: boolean; eventCode?: string; updatedAt?: string;
  marketCount?: number; totalLiquidity?: number; matchedVolume?: number;
  [key: string]: unknown;
}
export interface EventDetailResponse { eventDetail?: { event?: EventDetailEvent | null; markets?: DetailMarket[] } }
export interface PageRootAgent { id: string; username: string | null; schemeType: string; rate: number | null }
export interface PageAgentTreeResponse { agents?: { agentTree?: Array<{ id: string }>; agentRootAgents?: PageRootAgent[] } }
export interface PageRiskConfigResponse { eventRiskConfig?: { alerts?: { bannerEnabled?: boolean } } }
export interface MergedMarketListItem {
  mergedMarket: DetailMarket; oddsSignature: string; market: DetailMarket;
  betCount: number; exposure: number; marketBets: EventDetailBet[];
}
export interface MergedMarketsOddsOnlyItem {
  marketId: string; mergedMarket: DetailMarket; oddsSignature: string; market: DetailMarket;
}

/** Cheap deterministic string for runner odds so MarketCard memo can skip re-render when odds unchanged. */
export function getMarketOddsSignature(runners: DetailRunner[]): string {
  if (!Array.isArray(runners) || runners.length === 0) return "";
  return runners
    .map(
      (r: DetailRunner) =>
        `${r?.id ?? ""},${Number(r?.back ?? r?.backPrice ?? 0)},${Number(r?.lay ?? r?.layPrice ?? 0)}`
    )
    .join(";");
}

/** Pure helper: merge socket/live odds into a market and return merged market + signature for memoization. */
export function getMergedMarketWithOdds(
  market: DetailMarket,
  socketOddsData: OddsPayload,
  liveData: EventLiveData | null,
  eventCode: string | undefined
): { mergedMarket: DetailMarket; oddsSignature: string } {
  const normalize = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const socketMarketData = (market.marketCode && socketOddsData ? socketOddsData[market.marketCode] : null) as SocketPacket | null;
  const isFancy = market.kind === 'fancy' || market.type === 'fancy';
  const fancySocketData = (isFancy && eventCode && socketOddsData ? socketOddsData[`fancy-${eventCode}`] : null) as SocketPacket | Array<FancyLine | string> | null;
  const liveMarketData = liveData?.markets?.find(
    (m: EventLiveMarket) => m.marketId === market.id || String(m.marketId) === String(market.id)
  );
  let socketRunners: DetailRunner[] = [];
  if (socketMarketData) {
    if (Array.isArray(socketMarketData.runners)) socketRunners = socketMarketData.runners;
    else if (Array.isArray(socketMarketData.selections)) socketRunners = socketMarketData.selections;
    else if (socketMarketData.runners && typeof socketMarketData.runners === 'object') socketRunners = Object.values(socketMarketData.runners);
    else if (typeof socketMarketData === 'object' && !socketMarketData.runners) {
      const vals = Object.values(socketMarketData);
      if (vals.length > 0 && vals.every((v: unknown) => v && typeof v === 'object' && ('ex' in v || 'back' in v))) socketRunners = vals as DetailRunner[];
    }
  }
  const marketName = normalize(market.name || '');
  const marketRunners = market.runners || [];
  const socketRunnerMap = new Map<RunnerId, DetailRunner | null>();
  marketRunners.forEach((r: DetailRunner, i: number) => {
    const rn = normalize(r.name);
    let sr: DetailRunner | undefined | null = null;
    if (r.selectionCode) sr = socketRunners.find((s: DetailRunner) => String(s.selectionId) === String(r.selectionCode) || String(s.id) === String(r.selectionCode));
    if (!sr && r.id) sr = socketRunners.find((s: DetailRunner) => String(s.selectionId) === String(r.id) || String(s.id) === String(r.id));
    if (!sr) sr = socketRunners.find((s: DetailRunner) => normalize(s.runnerName || s.selectionName || s.name || '') === rn);
    if (!sr && i < socketRunners.length) sr = socketRunners[i];
    socketRunnerMap.set(r.id, sr ?? null);
  });
  const fancyLineByKey = new Map<string, FancyLine>();
  if (isFancy && fancySocketData) {
    let parsed: Array<FancyLine | string> = [];
    if (Array.isArray(fancySocketData)) parsed = fancySocketData;
    else if (Array.isArray(fancySocketData.payload)) parsed = fancySocketData.payload;
    else if (Array.isArray(fancySocketData.lines)) parsed = fancySocketData.lines;
    else if (Array.isArray(fancySocketData.data)) parsed = fancySocketData.data;
    else if (typeof fancySocketData === 'object') parsed = Object.values(fancySocketData).filter((v: unknown) => v && typeof v === 'object' && ('name' in v || 'back' in v || 'yes' in v)) as FancyLine[];
    const parsedLines = parsed.map((fl) => (typeof fl === 'string' ? (() => { try { return JSON.parse(fl); } catch { return fl; } })() : fl)).filter(Boolean);
    parsedLines.forEach((fl: FancyLine) => {
      fancyLineByKey.set(normalize(fl.name || fl.runnerName || ''), fl);
      if (fl.id != null) fancyLineByKey.set(String(fl.id), fl);
    });
  }
  const topRunners = liveMarketData?.top || liveMarketData?.topRunners || [];
  const liveRunnerMap = new Map<RunnerId, DetailRunner>();
  const graphqlFancyMap = new Map<RunnerId, FancyLine>();
  marketRunners.forEach((r: DetailRunner) => {
    const rn = normalize(r.name);
    const tr = topRunners.find((t: DetailRunner) => String(t.selectionId) === String(r.id) || normalize(t.selectionName || t.runnerName) === rn);
    if (tr) liveRunnerMap.set(r.id, tr);
    const gf = (liveMarketData?.fancy || []).find((f: FancyLine) => String(f.id) === String(r.id) || normalize(f.name) === rn || normalize(f.name) === marketName);
    if (gf) graphqlFancyMap.set(r.id, gf);
  });
  const volume = 1000;
  const createSyntheticDepth = (price: number, isBack: boolean) => {
    if (!price || price <= 0 || !Number.isFinite(price)) return [];
    const baseSize = volume;
    if (isBack) {
      return [
        { price: Math.max(1.01, price - 0.02), size: Math.round(baseSize * 0.7) },
        { price: Math.max(1.01, price - 0.01), size: Math.round(baseSize * 0.85) },
        { price: price, size: baseSize },
      ];
    }
    return [
      { price: price, size: baseSize },
      { price: price + 0.01, size: Math.round(baseSize * 0.85) },
      { price: price + 0.02, size: Math.round(baseSize * 0.7) },
    ];
  };
  const runnersWithOdds = marketRunners.map((runner: DetailRunner) => {
    const runnerName = normalize(runner.name);
    let back = 0;
    let lay = 0;
    if (runner.back && Number(runner.back) > 0) back = Number(runner.back);
    if (runner.lay && Number(runner.lay) > 0) lay = Number(runner.lay);
    if (market._isSynthetic && runner._fancyLine) {
      const fl = runner._fancyLine;
      const fancyBack = Number(fl.b1 ?? fl.back ?? fl.yes ?? fl.b ?? 0);
      const fancyLay = Number(fl.l1 ?? fl.lay ?? fl.no ?? fl.l ?? 0);
      const fancyData = {
        bs1: String(fl.bs1 ?? fl.yesSize ?? fl.backSize ?? '100'),
        ls1: String(fl.ls1 ?? fl.noSize ?? fl.laySize ?? '100'),
        status1: fl.gstatus ?? fl.status1 ?? fl.status ?? 'active',
        odd_type: fl.odd_type,
        id: fl.id,
      };
      return { ...runner, selection: runner.name, selectionId: runner.id, back: fancyBack, lay: fancyLay, backPrice: fancyBack, layPrice: fancyLay, volume: 100, fancyData, ex: null };
    }
    const socketRunner = socketRunnerMap.get(runner.id) ?? null;
    const socketEx = socketRunner?.ex ?? null;
    let fancyData: DetailRunner['fancyData'] = null;
    const fancyLine = fancyLineByKey.get(runnerName) ?? fancyLineByKey.get(String(runner.id));
    if (fancyLine) {
      const fancyBack = Number(fancyLine.back ?? fancyLine.yes ?? fancyLine.b ?? 0);
      const fancyLay = Number(fancyLine.lay ?? fancyLine.no ?? fancyLine.l ?? 0);
      if (fancyBack > 0 || fancyLay > 0) { back = fancyBack; lay = fancyLay; }
      fancyData = { bs1: String(fancyLine.bs1 ?? fancyLine.yesSize ?? fancyLine.backSize ?? '100'), ls1: String(fancyLine.ls1 ?? fancyLine.noSize ?? fancyLine.laySize ?? '100'), status1: fancyLine.status1 ?? fancyLine.status ?? fancyLine.gstatus ?? 'active' };
    }
    const liveRunner = liveRunnerMap.get(runner.id) ?? null;
    const graphqlFancyLine = graphqlFancyMap.get(runner.id) ?? null;
    let ex: DetailRunner['ex'] = null;
    if (socketEx) {
      const atb = Array.isArray(socketEx.availableToBack) ? socketEx.availableToBack : [];
      const atl = Array.isArray(socketEx.availableToLay) ? socketEx.availableToLay : [];
      if (atb.length > 0 && back === 0) back = Number(atb[atb.length - 1]?.price || 0);
      if (atl.length > 0 && lay === 0) lay = Number(atl[0]?.price || 0);
      ex = socketEx;
    } else if (socketRunner && back === 0 && lay === 0 && !isFancy) {
      back = Number(socketRunner.back ?? socketRunner.backPrice ?? socketRunner.oddsBack ?? socketRunner.b ?? 0);
      lay = Number(socketRunner.lay ?? socketRunner.layPrice ?? socketRunner.oddsLay ?? socketRunner.l ?? 0);
    }
    if (back === 0 && lay === 0 && liveRunner) { back = Number(liveRunner.back || 0); lay = Number(liveRunner.lay || 0); }
    if (back === 0 && lay === 0 && graphqlFancyLine) {
      back = Number(graphqlFancyLine.back || 0);
      lay = Number(graphqlFancyLine.lay || 0);
      if (!fancyData) fancyData = { bs1: graphqlFancyLine.bs1 || '100', ls1: graphqlFancyLine.ls1 || '100', status1: graphqlFancyLine.status || 'active' };
    }
    let finalEx = ex;
    const projectedDepth = !finalEx && (back > 0 || lay > 0);
    if (!finalEx && (back > 0 || lay > 0)) finalEx = { availableToBack: createSyntheticDepth(back, true), availableToLay: createSyntheticDepth(lay, false) };
    return { ...runner, selection: runner.name, selectionId: runner.id, back, lay, backPrice: back, layPrice: lay, volume, fancyData, ex: finalEx, _projectedDepth: projectedDepth };
  });
  const mergedMarket: DetailMarket = { ...market, ...liveMarketData, odds: runnersWithOdds, runners: runnersWithOdds, _hasProjectedDepth: runnersWithOdds.some((r) => '_projectedDepth' in r && r._projectedDepth) };
  const oddsSignature = getMarketOddsSignature(runnersWithOdds);
  return { mergedMarket, oddsSignature };
}

/** Match bets to a market card (handles merged fancy `_dbMarketIds`). */
export function marketIdSetForCard(market: DetailMarket): Set<string> {
  const id = market?.id != null ? String(market.id) : "";
  const dbIds = Array.isArray(market?._dbMarketIds) ? market._dbMarketIds.map((x) => String(x)) : [];
  return new Set([id, ...dbIds].filter(Boolean));
}

export function betsForMarketCard(market: DetailMarket, allBets: EventDetailBet[]): EventDetailBet[] {
  const match = marketIdSetForCard(market);
  if (match.size === 0) return [];
  return allBets.filter((b) => match.has(String(b.marketId)));
}


