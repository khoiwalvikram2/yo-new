import { Fragment, useState, useMemo, type Dispatch, type SetStateAction, type ReactNode } from "react";
import clsx from "clsx";
import { Tooltip } from "@/ui/components/Tooltip";
import { Button } from "@/ui/components/Button";
import { StatusPill } from "@/ui/components/StatusPill";
import { Avatar } from "@/ui/components/Avatar";
import { Skeleton } from "@/ui/components/Skeleton";
import { IconClock, IconLock, IconPlayerPause, IconTrendingUp, IconTrendingDown } from "@tabler/icons-react";
import type { EventMarket, EventMarketBet, SportsSharingData } from "./eventMarketTypes";
import { fancyRunnerHasBets, formatOddsVolume, standardOddsData, totalWithCutForEntries } from "./marketOddsModel";
import styles from "./MarketOdds.module.css";
import { useQuery } from "@apollo/client";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { useAuthStore } from "@/shared/core/authStore";
import { useUIStore } from "@/shared/core/uiStore";
import { calculateSelectionBook, type BookViewContext } from "../utils/bookCalculator";
import { MY_AGENT_SHARING_QUERY } from "@/lib/graphql/agentSharing";
import { MY_WHITELABEL_SHARING_QUERY } from "@/lib/graphql/whitelabel";
import { FancyBookTable } from "./FancyBookTable";
import { FancyBookModal } from "./FancyBookModal";
import { calculateFancyBook } from "../utils/fancyBookCalculator";

interface StandardMarketLayoutProps {
  market: EventMarket;
  event?: unknown;
  bets?: EventMarketBet[];
  viewContext?: BookViewContext | null;
  fancyBookExpandedMap?: Map<string, boolean>;
  setFancyBookExpandedMap?: Dispatch<SetStateAction<Map<string, boolean>>>;
  fancyBookModalMap?: Map<string, boolean>;
  setFancyBookModalMap?: Dispatch<SetStateAction<Map<string, boolean>>>;
}

export const StandardMarketLayout = ({
  market,
  bets = [],
  viewContext,
  fancyBookExpandedMap: externalFancyBookExpandedMap,
  setFancyBookExpandedMap: externalSetFancyBookExpandedMap,
  fancyBookModalMap: externalFancyBookModalMap,
  setFancyBookModalMap: externalSetFancyBookModalMap,
}: StandardMarketLayoutProps) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  
  // Get user type and sharing rate
  const isAgent = useAuthStore(s => s.isAgent());
  const agent = useAuthStore(s => s.agent);
  const roles = useAuthStore(s => s.roles) || [];
  const directorMode = useUIStore(s => s.directorMode);
  
  const isWhitelabelAdmin = roles.some(r => 
    r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
  );
  
  const isSuperAdmin = roles.some(r => 
    r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
    (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
  );
  
  // Check if super admin is in whitelabel mode
  const isSuperAdminInWhitelabelMode = isSuperAdmin && directorMode === 'whitelabel';
  
  // Fetch agent sharing rate
  const { data: agentSharingData } = useQuery<SportsSharingData>(MY_AGENT_SHARING_QUERY, {
    skip: !isAgent || !agent?.id || (agent.schemeType !== 'SHARING' && agent.schemeType !== 'CREDIT'),
    errorPolicy: 'all',
    fetchPolicy: 'cache-first',
  });
  
  // Fetch whitelabel sharing rate (for whitelabel admin OR super admin in whitelabel mode)
  const { data: whitelabelSharingData } = useQuery<SportsSharingData>(MY_WHITELABEL_SHARING_QUERY, {
    skip: (!isWhitelabelAdmin && !isSuperAdminInWhitelabelMode) || isAgent,
    errorPolicy: 'all',
    fetchPolicy: 'cache-first',
  });
  
  // Get sharing rate for 'sports' domain
  const sharingRate = useMemo(() => {
    // Super admin in whitelabel mode: use whitelabel sharing rate (same as whitelabel admin)
    if (isSuperAdminInWhitelabelMode && whitelabelSharingData?.myWhitelabelSharing?.sharingRates) {
      const rate = whitelabelSharingData.myWhitelabelSharing.sharingRates.find(
        (r) => r.domain === 'sports'
      );
      if (rate && typeof rate.rate === 'number') {
        return rate.rate; // Already in percentage (0-100)
      }
    }
    
    // Super admin in core mode: show Platform P&L
    if (isSuperAdmin && !isSuperAdminInWhitelabelMode) {
      return null;
    }
    
    if (isAgent && agentSharingData?.myAgentSharing?.sharingRates) {
      const rate = agentSharingData.myAgentSharing.sharingRates.find(
        (r) => r.domain === 'sports'
      );
      if (rate && typeof rate.rate === 'number') {
        return rate.rate; // Already in percentage (0-100)
      }
    }
    
    if (isWhitelabelAdmin && whitelabelSharingData?.myWhitelabelSharing?.sharingRates) {
      const rate = whitelabelSharingData.myWhitelabelSharing.sharingRates.find(
        (r) => r.domain === 'sports'
      );
      if (rate && typeof rate.rate === 'number') {
        return rate.rate; // Already in percentage (0-100)
      }
    }
    
    return null;
  }, [isAgent, isWhitelabelAdmin, isSuperAdmin, isSuperAdminInWhitelabelMode, agentSharingData, whitelabelSharingData]);
  
  // Use external state if provided, otherwise use local state
  const [localFancyBookExpandedMap, setLocalFancyBookExpandedMap] = useState<Map<string, boolean>>(new Map());
  const [localFancyBookModalMap, setLocalFancyBookModalMap] = useState<Map<string, boolean>>(new Map());
  
  const fancyBookExpandedMap = externalFancyBookExpandedMap ?? localFancyBookExpandedMap;
  const setFancyBookExpandedMap = externalSetFancyBookExpandedMap ?? setLocalFancyBookExpandedMap;
  const fancyBookModalMap = externalFancyBookModalMap ?? localFancyBookModalMap;
  const setFancyBookModalMap = externalSetFancyBookModalMap ?? setLocalFancyBookModalMap;

  const isFancyMarket = market.kind === 'fancy' || market.type === 'fancy';
  const isBookmaker = market.kind === 'bookmaker' || market.type === 'bookmaker';
  const rawOdds = useMemo(() => market.odds || market.runners || [], [market.odds, market.runners]);
  const odds = useMemo(() => {
    if (!isFancyMarket) return rawOdds;
    return [...rawOdds.filter(runner => fancyRunnerHasBets(runner, market, bets)), ...rawOdds.filter(runner => !fancyRunnerHasBets(runner, market, bets))];
  }, [rawOdds, isFancyMarket, market, bets]);
  // Kit two-price rows: Selection | P/L | Back | Lay; a fancy line reads Line | Worst case | No | Yes | Limits.
  const lineColumns = clsx(styles.lines, isFancyMarket && styles.withLimits);
  return <div className={styles.layout} role="region" aria-label={isFancyMarket ? 'Fancy market selections' : 'Standard market selections'}>
    <div className={clsx(styles.head, lineColumns)}>
      <span>{isFancyMarket ? 'Line' : 'Selection'}</span><span className={styles.headPl}>{isFancyMarket ? 'Worst case' : 'P/L'}</span>
      {isFancyMarket ? <><span className={clsx(styles.headPrice, styles.layHead)}>No</span><span className={clsx(styles.headPrice, styles.backHead)}>Yes</span><span className={styles.headLimits}>Limits</span></>
        : <><span className={clsx(styles.headPrice, styles.backHead)}>Back</span><span className={clsx(styles.headPrice, styles.layHead)}>Lay</span></>}
    </div>
    {odds.map((runner, index) => {
      const data = standardOddsData(runner);
      const hasOdds = data.back > 0 || data.lay > 0;
      const fancyData = runner.fancyData;
      const isSuspended = fancyData?.status1 === 'SUSPENDED' || fancyData?.status1 === 'Ball Running';
      const runnerId = String(runner.id || runner.selectionId || '');
      const runnerCode = String(runner.selectionCode || '').trim();
      const runnerName = String(runner.name || runner.selection || '').trim();
      const fancyLineId = runner._fancyLine?.id ? String(runner._fancyLine.id) : '';
      const runnerKey = `${runnerId || fancyLineId || runnerCode}-${runnerName}`;
      const hasBets = fancyRunnerHasBets(runner, market, bets);
      let totalPL = 0, totalWithCut = 0;
      if (bets.length > 0 && !isFancyMarket) {
        const book = calculateSelectionBook(String(runner.selectionCode || runner.id || runner.selectionId || ''), runner.name || runner.selection || `Selection ${index + 1}`, bets, String(market.id), market.type || market.kind || 'exchange', undefined, viewContext);
        totalPL = book.totals.playerNetPL;
        totalWithCut = totalWithCutForEntries(book.playerEntries, { isAgent, agentId: agent?.id, isWhitelabelAdmin, isSuperAdmin, isSuperAdminInWhitelabelMode, sharingRate, viewContext });
      }
      const marketIdForCalc = market._dbMarketIds ? market._dbMarketIds.join(',') : String(market.id);
      let exposure = 0;
      if (hasBets && isFancyMarket) {
        try { const book = calculateFancyBook(bets, marketIdForCalc, runnerId, runnerName); if (book.worstPosition) exposure = Math.abs(book.worstPosition.pnl); } catch { /* Same unavailable-book fallback. */ }
      }
      const expanded = hasBets ? fancyBookExpandedMap.get(runnerKey) || false : false;
      const modalOpen = hasBets ? fancyBookModalMap.get(runnerKey) || false : false;
      const displayName = runner.name || runner.selection || `Selection ${index + 1}`;
      const ballRunning = fancyData?.status1 === 'Ball Running';
      return <Fragment key={runner.id || index}><article className={styles.runner} aria-label={`Selection ${displayName}`}><div className={clsx(styles.row, lineColumns, isBookmaker && styles.hasAvatar)}>
        <div className={styles.identity}>{isBookmaker && <Avatar name={displayName} hue="auto" />}<div className={styles.details}>
          <strong className={styles.name}>{displayName}</strong>
          {isFancyMarket && hasBets && <div className={styles.actions}>
            <Button variant="secondary" size="xs" aria-expanded={expanded} onClick={() => setFancyBookExpandedMap(previous => { const next = new Map(previous); next.set(runnerKey, !expanded); return next; })}>{expanded ? 'Hide book' : 'Position book'}</Button>
            <Button variant="link" size="sm" onClick={() => setFancyBookModalMap(previous => { const next = new Map(previous); next.set(runnerKey, true); return next; })}>detailed analytics</Button>
          </div>}
        </div></div>
        {!isFancyMarket && bets.length > 0 && (totalPL !== 0 || totalWithCut !== 0) && <Tooltip content="P&L Without Cut / With Cut"><span className={styles.pl} tabIndex={0} aria-label={`P&L Without Cut ${totalPL}, With Cut ${totalWithCut}`}>
          <span className={styles.plLine}><span className={styles.plLabel}>Without Cut</span><strong className={clsx(styles.plFigure, totalPL >= 0 ? styles.positive : styles.negative)}>{totalPL >= 0 ? <IconTrendingUp size={14} aria-hidden="true" /> : <IconTrendingDown size={14} aria-hidden="true" />}{formatAmount(convertFromWhitelabelCurrency(Math.abs(totalPL)))}</strong></span>
          <span className={styles.plLine}><span className={styles.plLabel}>With Cut</span><span className={clsx(styles.plCut, totalWithCut >= 0 ? styles.positive : styles.negative)}>{formatAmount(convertFromWhitelabelCurrency(Math.abs(totalWithCut)))}</span></span>
        </span></Tooltip>}
        {isFancyMarket && hasBets && exposure > 0 && <span className={styles.pl}><StatusPill tone="neg">{formatAmount(convertFromWhitelabelCurrency(exposure))}</StatusPill></span>}
        {isFancyMarket && isSuspended ? <div className={clsx(styles.hold, ballRunning && styles.holdWarn)}>{ballRunning ? <IconClock size={15} aria-hidden="true" /> : <IconLock size={15} aria-hidden="true" />}{ballRunning ? 'Ball Running' : 'Suspended'}</div>
          : !hasOdds ? <div className={styles.hold}><IconPlayerPause size={15} aria-hidden="true" />No odds available</div>
          : <div className={styles.prices} role="group" aria-label={`${displayName} read-only odds`}>{isFancyMarket ? <>
            <MarketOddsTile side="lay" price={data.lay} integer volume={fancyData?.ls1 || (data.laySize > 0 ? formatOddsVolume(data.laySize) : '100')} />
            <MarketOddsTile side="back" price={data.back} integer volume={fancyData?.bs1 || (data.backSize > 0 ? formatOddsVolume(data.backSize) : '100')} />
          </> : <><MarketOddsTile side="back" price={data.back} volume={data.backSize > 0 ? formatOddsVolume(data.backSize) : undefined} /><MarketOddsTile side="lay" price={data.lay} volume={data.laySize > 0 ? formatOddsVolume(data.laySize) : undefined} /></>}</div>}
        {isFancyMarket && <span className={styles.limits}>{!!fancyData?.minBet && <>Min: {fancyData.minBet}</>}</span>}
      </div>{isFancyMarket && expanded && <div className={styles.analytics}>{hasBets ? <FancyBookTable market={{ ...market, id: market._dbMarketIds ? market._dbMarketIds.join(',') : market.id }} bets={bets} isExpanded onToggle={() => setFancyBookExpandedMap(previous => { const next = new Map(previous); next.set(runnerKey, false); return next; })} selectionId={runnerId} selectionName={runnerName} viewContext={viewContext} /> : <span className={styles.empty}>No bets placed on this selection</span>}</div>}</article>
      {isFancyMarket && <FancyBookModal open={modalOpen} onClose={() => setFancyBookModalMap(previous => { const next = new Map(previous); next.set(runnerKey, false); return next; })} market={{ ...market, id: market._dbMarketIds ? market._dbMarketIds.join(',') : market.id }} bets={bets} fancySelection={runnerName} />}</Fragment>;
    })}
  </div>;
};

/** A read-only price cell (kit .odds). `extra` marks a depth cell, hidden in a narrow layout; `depth` is its distance from the best price, which shades it lighter. */
export function MarketOddsTile({ side, price, volume, extra, depth, loading, integer }: { side: 'back' | 'lay'; price: number; volume?: ReactNode; extra?: boolean; depth?: 2 | 3; loading?: boolean; integer?: boolean }) {
  const printed = integer ? String(Math.round(price)) : price.toFixed(2);
  return <div className={clsx(styles.oddsTile, styles[side], extra && styles.extraDepth, depth === 2 && styles.depth2, depth === 3 && styles.depth3, price > 0 && styles.filled)} aria-busy={loading || undefined} aria-label={`${side === 'back' ? 'Back' : 'Lay'} price ${loading ? 'loading' : price > 0 ? printed : 'unavailable'}`}>
    {loading ? <><Skeleton width={36} height={12} /><Skeleton width={28} height={8} /></> : price > 0 ? <><span className={styles.priceValue}>{printed}</span>{volume !== undefined && <span className={styles.priceVolume}>{volume}</span>}</> : <span>—</span>}
  </div>;
}

