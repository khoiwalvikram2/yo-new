import { useState, useEffect, useRef, useMemo } from "react";
import clsx from "clsx";
import { Tooltip } from "@/ui/components/Tooltip";
import { Avatar } from "@/ui/components/Avatar";
import { MarketOddsTile } from "./StandardMarketLayout";
import { formatOddsVolume, matchOddsData, totalWithCutForEntries } from "./marketOddsModel";
import type { EventMarket, EventMarketBet, SportsSharingData } from "./eventMarketTypes";
import styles from "./MarketOdds.module.css";
import { useQuery } from "@apollo/client";
import { IconPlayerPause, IconTrendingUp, IconTrendingDown } from "@tabler/icons-react";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { useAuthStore } from "@/shared/core/authStore";
import { useUIStore } from "@/shared/core/uiStore";
import { calculateSelectionBook, type BookViewContext } from "../utils/bookCalculator";
import { MY_AGENT_SHARING_QUERY } from "@/lib/graphql/agentSharing";
import { MY_WHITELABEL_SHARING_QUERY } from "@/lib/graphql/whitelabel";

interface MatchOddsLayoutProps {
  market: EventMarket;
  event: unknown;
  bets?: EventMarketBet[];
  viewContext?: BookViewContext | null;
}

export const MatchOddsLayout = ({
  market,
  bets = [],
  viewContext,
}: MatchOddsLayoutProps) => {
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

  const runners = useMemo(() => market.runners || market.odds || [], [market.runners, market.odds]);
  const maxRows = Math.min(3, runners.length);

  // Track loading start time for each runner to detect 10+ second loading
  const loadingStartTimeRef = useRef<Map<string, number>>(new Map());
  const [showNoOdds, setShowNoOdds] = useState<Map<string, boolean>>(new Map());

  // Prepare team data for loading check
  const teamData = useMemo(() => runners.slice(0, maxRows).map((runner, index) => ({
    runner,
    index,
    key: `${market.id}-${index}`,
  })), [runners, maxRows, market.id]);

  // Check loading duration for each runner
  useEffect(() => {
    const isExchangeMarket = market.type === 'exchange' || market.kind === 'exchange';
    if (!isExchangeMarket) return;

    const checkLoading = () => {
      const now = Date.now();
      const newShowNoOdds = new Map(showNoOdds);
      let hasChanges = false;

      teamData.forEach(({ runner, key }) => {
        const ex = runner.ex || runner.ex;
        const availableToBack = Array.isArray(ex?.availableToBack) ? ex.availableToBack : [];
        const availableToLay = Array.isArray(ex?.availableToLay) ? ex.availableToLay : [];
        const hasNoExchangeOdds = availableToBack.length === 0 && availableToLay.length === 0;
        
        // Also check direct back/lay values for non-exchange markets
        const hasDirectOdds = (Number(runner.back || runner.backPrice || 0) > 0) || 
                              (Number(runner.lay || runner.layPrice || 0) > 0);
        const hasAnyOdds = !hasNoExchangeOdds || hasDirectOdds;

        if (!hasAnyOdds) {
          if (!loadingStartTimeRef.current.has(key)) {
            loadingStartTimeRef.current.set(key, now);
          } else {
            const startTime = loadingStartTimeRef.current.get(key)!;
            const elapsed = now - startTime;
            if (elapsed >= 10000 && !newShowNoOdds.get(key)) {
              newShowNoOdds.set(key, true);
              hasChanges = true;
            }
          }
        } else {
          // Odds are available, clear loading state and no-odds message
          if (loadingStartTimeRef.current.has(key)) {
            loadingStartTimeRef.current.delete(key);
          }
          if (newShowNoOdds.get(key)) {
            newShowNoOdds.delete(key);
            hasChanges = true;
          }
        }
      });

      if (hasChanges) {
        setShowNoOdds(newShowNoOdds);
      }
    };

    const interval = setInterval(checkLoading, 500);
    checkLoading();

    return () => clearInterval(interval);
  }, [market.id, market.type, market.kind, teamData, showNoOdds]);

  return <div className={styles.layout} role="region" aria-label="Match odds selections">
    <div className={clsx(styles.head, styles.ladder)}><span>Selection</span><span className={styles.headPl}>P/L</span><span className={clsx(styles.headBack, styles.backHead)}>Back</span><span className={clsx(styles.headLay, styles.layHead)}>Lay</span></div>
    {runners.slice(0, maxRows).map((runner, index) => {
      const runnerKey = `${market.id}-${index}`;
      const isExchangeMarket = market.type === 'exchange' || market.kind === 'exchange';
      const shouldShowNoOddsMsg = showNoOdds.get(runnerKey) || false;
      const data = matchOddsData(runner, isExchangeMarket, shouldShowNoOddsMsg);
      let totalPL = 0, totalWithCut = 0;
      if (bets.length > 0) {
        const book = calculateSelectionBook(String(runner.selectionCode || runner.id || runner.selectionId || ''), runner.name || runner.selection || `Runner ${index + 1}`, bets, String(market.id), market.type || market.kind || 'exchange', undefined, viewContext);
        totalPL = book.totals.playerNetPL;
        totalWithCut = totalWithCutForEntries(book.playerEntries, { isAgent, agentId: agent?.id, isWhitelabelAdmin, isSuperAdmin, isSuperAdminInWhitelabelMode, sharingRate, viewContext });
      }
      const hasAnyOdds = data.backOdds.some(odd => odd.value > 0) || data.layOdds.some(odd => odd.value > 0);
      const showNoOddsMessage = !hasAnyOdds && shouldShowNoOddsMsg && isExchangeMarket;
      const backOdds = [...data.backOdds], layOdds = [...data.layOdds];
      while (backOdds.length < 3) backOdds.unshift({ value: 0, volume: 0, isMain: false });
      while (layOdds.length < 3) layOdds.push({ value: 0, volume: 0, isMain: false });
      const name = runner.name || runner.selection || `Runner ${index + 1}`;
      // The best prices meet in the middle: back −2, −1, best | best, +1, +2 lay. A depth cell's shade steps lighter with its distance from the best.
      return <article key={runner.id || index} className={styles.runner} aria-label={`Runner ${name}`}><div className={clsx(styles.row, styles.ladder, styles.hasAvatar)}>
        <div className={styles.identity}><Avatar name={name} hue="auto" /><div className={styles.details}><strong className={styles.name}>{name}</strong></div></div>
        {bets.length > 0 && (totalPL !== 0 || totalWithCut !== 0) && <Tooltip content="P&L Without Cut / With Cut"><span className={styles.pl} tabIndex={0} aria-label={`P&L Without Cut ${totalPL}, With Cut ${totalWithCut}`}>
          <span className={styles.plLine}><span className={styles.plLabel}>Without Cut</span><strong className={clsx(styles.plFigure, totalPL >= 0 ? styles.negative : styles.positive)}>{totalPL >= 0 ? <IconTrendingDown size={14} aria-hidden="true" /> : <IconTrendingUp size={14} aria-hidden="true" />}{formatAmount(convertFromWhitelabelCurrency(Math.abs(totalPL)))}</strong></span>
          <span className={styles.plLine}><span className={styles.plLabel}>With Cut</span><span className={clsx(styles.plCut, totalWithCut >= 0 ? styles.negative : styles.positive)}>{formatAmount(convertFromWhitelabelCurrency(Math.abs(totalWithCut)))}</span></span>
        </span></Tooltip>}
        {showNoOddsMessage ? <div className={styles.hold}><IconPlayerPause size={15} aria-hidden="true" />Waiting for feed prices</div> : <div className={styles.prices} role="group" aria-label={`${name} read-only depth odds`}>
          <div className={styles.priceGroup} role="group" aria-label="Back prices">{backOdds.slice(0, 3).map((odd, oddIndex) => { const extra = odd.isLoading ? oddIndex < 2 : !odd.isMain; return <MarketOddsTile key={`back-${oddIndex}`} side="back" price={odd.value} extra={extra} depth={extra ? (oddIndex === 1 ? 2 : 3) : undefined} loading={odd.isLoading} volume={odd.volume > 0 ? formatOddsVolume(odd.volume) : undefined} /> })}</div>
          <div className={styles.priceGroup} role="group" aria-label="Lay prices">{layOdds.slice(0, 3).map((odd, oddIndex) => { const extra = odd.isLoading ? oddIndex > 0 : !odd.isMain; return <MarketOddsTile key={`lay-${oddIndex}`} side="lay" price={odd.value} extra={extra} depth={extra ? (oddIndex === 1 ? 2 : 3) : undefined} loading={odd.isLoading} volume={odd.volume > 0 ? formatOddsVolume(odd.volume) : undefined} /> })}</div>
        </div>}
      </div></article>;
    })}
  </div>;
};

