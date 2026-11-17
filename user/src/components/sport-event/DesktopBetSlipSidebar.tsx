import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Coins,
  Plus,
  Minus,
  Loader2,
  Zap,
  Check,
  RotateCcw,
} from "lucide-react";
import type { EventDetails } from "./types";
import { useBetSlip } from "../sports/BetSlipProvider";
import { placeSportsBet, placeFancyBet } from "@/lib/api/user";
import { notify } from "@/lib/notify";
import { useAuth } from "@/lib/auth";
import { useOddsSocket } from "@/lib/hooks/useOddsSocket";
import { useSportsSettings } from "@/hooks/useSportsSettings";
import { useRiskConfig } from "@/hooks/useAppSettings";
import { useStakeLimits } from "@/hooks/useStakeLimits";
import { formatAmount, getCurrencySymbol, getDefaultLocale } from "@/lib/currency";
import { getFancyLiveSnapshot } from "./fancySocketOdds";
interface DesktopBetSlipSidebarProps {
  event?: EventDetails;
}

const QUICK_STAKES = [1000, 2000, 5000, 10000, 20000, 25000, 50000, 75000];

export default function DesktopBetSlipSidebar({
  event,
}: DesktopBetSlipSidebarProps) {
  const { quickBet, closeQuickBet, updateQuickBet } = useBetSlip();
  const { isAuthenticated, openAuthModal, refreshUser, user } = useAuth();
  const { cashoutEnabled, overallExposureCap } = useRiskConfig();
  const { canPlaceStake } = useStakeLimits();

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [stake, setStake] = useState("");
  const [odds, setOdds] = useState(0);
  const [animateSuccess, setAnimateSuccess] = useState(false);
  const [oddsFlash, setOddsFlash] = useState<'up' | 'down' | null>(null);

  const inFlightRef = useRef(false);
  const lastBetKeyRef = useRef("");
  const lastOpenIdRef = useRef<number>(0);

  // Current bet from quick bet
  const bet = quickBet;
  const currentBetKey = bet ? `${bet.team}-${bet.market}-${bet.type}` : "";

  // Subscribe to real-time odds updates
  const marketCodes = useMemo(() => {
    if (!bet?.marketCode) return [];
    // For fancy markets, use event-level subscription
    if (bet.marketType === 'fancy' && event?.eventCode) {
      return [`fancy-${event.eventCode}`];
    }
    // For other markets, use market code
    return [String(bet.marketCode)];
  }, [bet?.marketCode, bet?.marketType, event?.eventCode]);

  const oddsSocketData = useOddsSocket(marketCodes, event?.eventCode ? { eventId: String(event.eventCode) } : undefined);

  // Extract real-time odds from socket data
  const extractLiveOdds = useCallback(() => {
    if (!bet) {
      return {
        back: 0,
        lay: 0,
      };
    }

    if (bet.marketType === "fancy" && event?.eventCode) {
      const snap = getFancyLiveSnapshot(oddsSocketData as Record<string, unknown> | undefined, bet, event.eventCode);
      if (snap) {
        return {
          back: snap.back,
          lay: snap.lay,
          fancyBackSize: snap.fancyBackSize,
          fancyLaySize: snap.fancyLaySize,
          fancyStatus: snap.fancyStatus,
        };
      }
      return {
        back: bet.backOdds || bet.odds || 0,
        lay: bet.layOdds || 0,
        fancyStatus: bet.fancyStatus,
      };
    }

    if (!oddsSocketData) {
      return {
        back: bet?.backOdds || bet?.odds || 0,
        lay: bet?.layOdds || 0,
      };
    }

    const normalize = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const betSelectionNormalized = normalize(bet.team);
    const betSelectionId = bet.selectionId ? Number(bet.selectionId) : undefined;

    // Try to find odds from socket data
    let socketMarketData: any = null;
    
    // Check market code first
    if (bet.marketCode) {
      socketMarketData = (oddsSocketData as any)[String(bet.marketCode)];
    }
    
    // For fancy markets, check event-level data
    if (!socketMarketData && bet.marketType === 'fancy' && event?.eventCode) {
      socketMarketData = (oddsSocketData as any)[`fancy-${event.eventCode}`];
    }

    if (!socketMarketData) {
      return {
        back: bet?.backOdds || bet?.odds || 0,
        lay: bet?.layOdds || 0,
      };
    }

    // Extract runners from socket data
    let runners: any[] = [];
    if (Array.isArray(socketMarketData?.runners)) {
      runners = socketMarketData.runners;
    } else if (Array.isArray(socketMarketData?.selections)) {
      runners = socketMarketData.selections;
    } else if (socketMarketData?.runners && typeof socketMarketData.runners === 'object') {
      runners = Object.values(socketMarketData.runners);
    }

    // Find matching runner
    const runner = runners.find((r: any) => {
      if (betSelectionId && (r.selectionId || r.id)) {
        return Number(r.selectionId || r.id) === betSelectionId;
      }
      const runnerName = normalize(r?.runnerName || r?.selectionName || r?.name || '');
      return runnerName === betSelectionNormalized;
    });

    if (!runner) {
      return {
        back: bet?.backOdds || bet?.odds || 0,
        lay: bet?.layOdds || 0,
      };
    }

    // Extract prices from runner
    // For BACK: use MAXIMUM (highest) from availableToBack array
    // For LAY: use MINIMUM (lowest) from availableToLay array
    const extractPrices = (r: any) => {
      if (r?.b1 != null || r?.l1 != null) {
        return { back: Number(r.b1 || 0), lay: Number(r.l1 || 0) };
      }
      const ex = r?.ex;
      if (ex) {
        const atb = Array.isArray(ex.availableToBack) ? ex.availableToBack : [];
        const atl = Array.isArray(ex.availableToLay) ? ex.availableToLay : [];
        
        // For BACK: take MAXIMUM (highest) price
        let back = 0;
        if (atb.length > 0) {
          const backPrices = atb
            .map((item: any) => Number(item?.price || 0))
            .filter((price: number) => Number.isFinite(price) && price > 1);
          if (backPrices.length > 0) {
            back = Math.max(...backPrices);
          }
        }
        
        // For LAY: take MINIMUM (lowest) price
        let lay = 0;
        if (atl.length > 0) {
          const layPrices = atl
            .map((item: any) => Number(item?.price || 0))
            .filter((price: number) => Number.isFinite(price) && price > 1);
          if (layPrices.length > 0) {
            lay = Math.min(...layPrices);
          }
        }
        
        return { back, lay };
      }
      const back = r?.back ?? r?.backPrice ?? r?.oddsBack ?? r?.b;
      const lay = r?.lay ?? r?.layPrice ?? r?.oddsLay ?? r?.l;
      return { back: Number(back || 0), lay: Number(lay || 0) };
    };

    const { back, lay } = extractPrices(runner);
    return {
      back: back > 0 ? back : (bet?.backOdds || bet?.odds || 0),
      lay: lay > 0 ? lay : (bet?.layOdds || 0),
    };
  }, [bet, oddsSocketData, event?.eventCode]);

  const liveOdds = extractLiveOdds();
  const liveBackOdds = liveOdds.back;
  const liveLayOdds = liveOdds.lay;
  const liveFancyBackSize = (liveOdds as { fancyBackSize?: number }).fancyBackSize;
  const liveFancyLaySize = (liveOdds as { fancyLaySize?: number }).fancyLaySize;

  // Extract current fancy status from live data
  const getCurrentFancyStatus = useCallback(() => {
    if (!bet || bet.marketType !== "fancy") return bet?.fancyStatus;
    const snap = getFancyLiveSnapshot(oddsSocketData as Record<string, unknown> | undefined, bet, event?.eventCode);
    return snap?.fancyStatus ?? bet.fancyStatus;
  }, [bet, oddsSocketData, event?.eventCode]);

  // Sync state with current bet
  useEffect(() => {
    if (bet) {
      const openId = typeof bet.openId === "number" ? bet.openId : 0;
      const freshOpen = openId > 0 && openId !== lastOpenIdRef.current;
      const betKeyChanged = lastBetKeyRef.current !== currentBetKey;
      const currentOdds = normalizeOdds(Number(bet.odds) || 0);
      const oddsChanged = Math.abs(currentOdds - odds) > 0.001; // Check if odds changed significantly
      
      // Check if stake changed (for cashout updates)
      const currentStake = typeof bet.stake === "number" && !Number.isNaN(bet.stake) && Number.isFinite(bet.stake)
        ? Math.floor(Math.max(0, Math.min(bet.stake, 999999999)))
        : 0;
      const stakeInState = parseFloat(stake) || 0;
      const stakeChanged = Math.abs(currentStake - stakeInState) > 0.01;
      
      if (freshOpen) {
        // Fresh open from odds click - always reset to new selection, clear stake
        lastOpenIdRef.current = openId;
        lastBetKeyRef.current = currentBetKey;
        setOdds(currentOdds);
        setStake("");
      } else if (betKeyChanged) {
        // Bet selection changed (e.g. cashout flow) - reset everything
        lastBetKeyRef.current = currentBetKey;
        setOdds(currentOdds);
        if (currentStake > 0) {
          setStake(String(currentStake));
        } else {
          setStake("");
        }
      } else if (oddsChanged) {
        // Same selection but odds changed - update odds only, keep stake
        setOdds(currentOdds);
        updateQuickBet({ odds: currentOdds });
      } else if (stakeChanged && currentStake > 0) {
        // Same selection, same odds, but stake changed (e.g., cashout update)
        setStake(String(currentStake));
      }
    }
  }, [bet, currentBetKey, odds, stake, updateQuickBet]);

  // Normalize odds
  const normalizeOdds = (val: number) => {
    if (!Number.isFinite(val)) return 0;
    return parseFloat(Number(val).toFixed(2));
  };

  // Flash effect when live odds change
  useEffect(() => {
    if (!bet) return;
    const currentOdds = bet.type === 'back' ? liveBackOdds : liveLayOdds;
    if (currentOdds !== odds && currentOdds > 0) {
      setOddsFlash(currentOdds > odds ? 'up' : 'down');
      setTimeout(() => setOddsFlash(null), 500);
    }
  }, [liveBackOdds, liveLayOdds, bet?.type, odds, bet]);

  // Fancy: keep slip odds and oddsSize aligned with socket (avoids stale submission)
  useEffect(() => {
    if (!bet || bet.marketType !== "fancy" || !event?.eventCode) return;
    const lo = extractLiveOdds() as {
      back: number;
      lay: number;
      fancyBackSize?: number;
      fancyLaySize?: number;
    };
    const targetOdds = bet.type === "back" ? lo.back : lo.lay;
    if (targetOdds > 0) {
      const n = parseFloat(Number(targetOdds).toFixed(2));
      if (Math.abs(n - odds) > 0.001) {
        setOdds(n);
        updateQuickBet({ odds: n });
      }
    }
    const targetSize = bet.type === "back" ? lo.fancyBackSize : lo.fancyLaySize;
    if (targetSize != null && Number.isFinite(targetSize) && targetSize > 0) {
      const cur = bet.oddsSize ?? bet.odds_size;
      if (cur == null || Math.abs(Number(cur) - targetSize) > 0.5) {
        updateQuickBet({ oddsSize: targetSize, odds_size: targetSize });
      }
    }
  }, [
    bet,
    event?.eventCode,
    oddsSocketData,
    odds,
    bet?.oddsSize,
    bet?.odds_size,
    bet?.type,
    extractLiveOdds,
    updateQuickBet,
    liveBackOdds,
    liveLayOdds,
    liveFancyBackSize,
    liveFancyLaySize,
  ]);

  // Handlers
  const handleOddsChange = useCallback((newOdds: number) => {
    const normalized = normalizeOdds(newOdds);
    setOdds(normalized);
    updateQuickBet({ odds: normalized });
  }, [updateQuickBet]);

  const handleStakeChange = useCallback((newStake: string) => {
    // Remove all non-numeric characters (including commas)
    const cleaned = newStake.replace(/[^0-9]/g, "");
    setStake(cleaned);
    const numeric = parseFloat(cleaned) || 0;
    updateQuickBet({ stake: numeric });
  }, [updateQuickBet]);

  // Format stake with commas for display
  const formatStake = useCallback((value: string) => {
    if (!value) return "";
    const numeric = value.replace(/[^0-9]/g, "");
    if (!numeric) return "";
    const num = Number(numeric);
    // Ensure number is finite and reasonable before formatting
    if (!Number.isFinite(num) || num > 999999999) {
      return ""; // Return empty if number is too large or invalid
    }
    return num.toLocaleString(getDefaultLocale(), { maximumFractionDigits: 0 });
  }, []);

  const handleQuickStake = useCallback((amount: number) => {
    const current = parseFloat(stake) || 0;
    const newAmount = current + amount;
    setStake(String(newAmount));
    updateQuickBet({ stake: newAmount });
  }, [stake, updateQuickBet]);

  // Switch bet type (back/lay)
  const handleSwitchBetType = useCallback((newType: 'back' | 'lay') => {
    if (!bet) return;
    const liveOddsValue = newType === 'back' ? liveBackOdds : liveLayOdds;
    if (liveOddsValue > 0) {
      updateQuickBet({ type: newType, odds: liveOddsValue });
      setOdds(normalizeOdds(liveOddsValue));
    }
  }, [bet, liveBackOdds, liveLayOdds, updateQuickBet]);

  // Use live odds
  const handleUseLiveOdds = useCallback((liveOddsValue: number) => {
    const normalized = normalizeOdds(liveOddsValue);
    setOdds(normalized);
    updateQuickBet({ odds: normalized });
  }, [updateQuickBet]);

  const handleClear = useCallback(() => {
    setStake("");
    if (bet) {
      setOdds(Number(bet.odds) || 0);
      updateQuickBet({ stake: 0 });
    }
  }, [bet, updateQuickBet]);

  // Get available balance: balance - exposure, for credit players too (their chips are the wallet cash)
  const getAvailableBalance = useCallback(() => {
    if (!isAuthenticated || !user) return 0;

    const currentBalance = Number(user.balance || 0);
    const currentExposure = Math.abs(Number((user as any)?.exposure || 0));
    const netBalance = currentBalance - currentExposure;
    return Math.max(0, netBalance);
  }, [isAuthenticated, user]);

  // Get sports settings for max stake limit
  const { settings: sportsSettings } = useSportsSettings(
    event?.sportId && event?.leagueId && event?.id
      ? {
          sportId: event.sportId,
          leagueId: event.leagueId,
          eventId: event.id,
        }
      : undefined
  );

  const handleMaxStake = useCallback(() => {
    if (!bet) return;
    
    // Get max stake from market settings
    const marketType = (bet.marketType || 'exchange').toLowerCase();
    const marketSettings = marketType === 'fancy' 
      ? sportsSettings?.fancy 
      : marketType === 'bookmaker' 
      ? sportsSettings?.bookmaker 
      : sportsSettings?.exchange;
    
    const maxStakeFromSettings = marketSettings?.maxStake;
    
    // Get available balance (cash - exposure)
    const availableBalance = getAvailableBalance();
    
    // Use minimum of max stake limit and available balance
    let maxAmount = availableBalance;
    if (maxStakeFromSettings != null && Number.isFinite(maxStakeFromSettings) && maxStakeFromSettings > 0) {
      maxAmount = Math.min(maxStakeFromSettings, availableBalance);
    }
    
    if (maxAmount > 0) {
      setStake(String(Math.floor(maxAmount)));
      updateQuickBet({ stake: Math.floor(maxAmount) });
    }
  }, [bet, bet?.marketType, sportsSettings, getAvailableBalance, updateQuickBet]);

  const handleClose = useCallback(() => {
    setIsLoading(false);
    closeQuickBet();
  }, [closeQuickBet]);

  const handleCancel = useCallback(() => {
    handleClose();
  }, [handleClose]);

  // Calculate returns
  const calculateReturns = useMemo(() => {
    if (!bet) return { profit: 0, liability: 0, returns: 0 };
    const stakeAmount = parseFloat(stake) || 0;
    if (stakeAmount <= 0 || !Number.isFinite(odds) || odds <= 1) {
      return { profit: 0, liability: 0, returns: 0 };
    }
    
    // Fancy market calculation
    if (bet.marketType === "fancy") {
      // Get oddsSize percentage (default to 100% if not provided)
      // Handle cases where oddsSize might be 0 or undefined
      const rawOddsSize = bet.oddsSize ?? bet.odds_size;
      const oddsSize = (rawOddsSize !== undefined && rawOddsSize !== null && rawOddsSize > 0) ? rawOddsSize : 100;
      const oddsSizePercent = oddsSize / 100;
      
      if (bet.type === "back") {
        // BACK: Potential Profit = Stake × (OddsSize/100), Potential Loss = Stake
        const profit = stakeAmount * oddsSizePercent;
        return { profit, liability: stakeAmount, returns: stakeAmount + profit };
      } else {
        // LAY: Potential Profit = Stake, Potential Loss = Stake × (OddsSize/100)
        const liability = stakeAmount * oddsSizePercent;
        return { profit: stakeAmount, liability, returns: stakeAmount };
      }
    }
    
    // Exchange/Bookmaker calculation (existing logic)
    if (bet.type === "back") {
      const profit = stakeAmount * (odds - 1);
      return { profit, liability: stakeAmount, returns: stakeAmount + profit };
    }
    // Lay bet
    const liability = stakeAmount * (odds - 1);
    return { profit: stakeAmount, liability, returns: stakeAmount };
  }, [bet, stake, odds]);

  const { profit, liability, returns } = calculateReturns;

  // Cashout is just a regular bet - no special handling needed
  // The bet slip already has the correct odds and stake pre-filled from handleOpenCashoutBetSlip

  // Place bet handler
  const handlePlaceBet = useCallback(async () => {
    if (!isAuthenticated) {
      openAuthModal("login");
      return;
    }

    if (!event || !bet) {
      notify.error("Event information not available");
      return;
    }

    // Check if cashout is enabled (for cashout bets)
    if (bet.isCashout && !cashoutEnabled) {
      notify.error("Cashout feature is currently disabled");
      return;
    }

    // Check if fancy is suspended or ball running (using current live status)
    if (bet.marketType === "fancy") {
      const currentStatus = getCurrentFancyStatus();
      if (currentStatus === "SUSPENDED" || currentStatus === "Ball Running") {
        notify.error("This market is currently suspended");
        return;
      }
    }

    const stakeAmount = parseFloat(stake) || 0;
    
    // Check stake limits (daily/weekly)
    if (stakeAmount > 0) {
      const stakeCheck = canPlaceStake(stakeAmount)
      if (!stakeCheck.allowed) {
        notify.error(stakeCheck.reason || 'Stake limit exceeded')
        return
      }
    }

    // Check overall exposure cap
    if (overallExposureCap != null && user) {
      const currentExposure = Math.abs(Number((user as any)?.exposure || 0))
      const betLiability = bet.type === 'back' ? stakeAmount : stakeAmount * (odds - 1)
      const newExposure = currentExposure + betLiability
      
      if (newExposure > overallExposureCap) {
        notify.error(`Bet would exceed your exposure limit of ${formatAmount(overallExposureCap)}. Current exposure: ${formatAmount(currentExposure)}`)
        return
      }
    }
    if (!stakeAmount || stakeAmount <= 0) {
      notify.error("Please enter a valid stake amount");
      return;
    }

    if (!odds || (bet.marketType === "fancy" ? odds <= 0 : odds <= 1)) {
      notify.error("Please enter valid odds");
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      setIsLoading(true);
      const submitOdds = normalizeOdds(odds);
      const isFancyBet = bet.marketType === "fancy";

      let payload: any;
      if (isFancyBet) {
        payload = {
          stake: Math.abs(stakeAmount),
          selectionType: bet.type,
          odds: submitOdds.toString(),
          selection: bet.team,
          marketType: "fancy",
          marketId: bet.marketId || null,
          marketCode: bet.marketCode || "",
          selectionId: String(bet.selectionId || ""),
          odds_size: bet.oddsSize || bet.odds_size || 100, // Use oddsSize from fancy data, default to 100
          eventId: String(event.eventId || event.id),
          leagueId: String(event.leagueId || ""),
          sportId: String(event.sportId || ""),
        };

        // Validate all required fields
        if (!payload.eventId || !payload.sportId || !payload.leagueId) {
          notify.error("Missing event information. Please refresh the page.");
          setIsLoading(false);
          inFlightRef.current = false;
          return;
        }

        if (!payload.marketCode || !payload.selectionId || !payload.selection) {
          notify.error("Missing market information. Please select odds again.");
          setIsLoading(false);
          inFlightRef.current = false;
          return;
        }

        // Fancy bet payload
      } else {
        payload = {
          eventId: event.eventId || event.id,
          sportId: event.sportId,
          leagueId: event.leagueId,
          marketId: bet.marketId,
          marketCode: bet.marketCode ?? undefined,
          marketType: bet.marketType || "exchange",
          selectionId: Number(bet.selectionId ?? bet.teamIndex),
          selection: bet.team,
          selectionType: bet.type,
          odds: submitOdds,
          stake: Math.abs(stakeAmount),
        };
      }

      const resp = isFancyBet ? await placeFancyBet(payload) : await placeSportsBet(payload);

      // Check response structure

      if (resp?.meta?.code === 200 || resp?.meta?.code === 201) {
        setAnimateSuccess(true);
        setTimeout(() => {
          setAnimateSuccess(false);
          refreshUser();
          // Dispatch events with a small delay to ensure database transaction is committed
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("stakex:bet-placed"));
            window.dispatchEvent(new CustomEvent("stakex:my-bets:update"));
          }, 100);
          notify.success(resp?.meta?.message || "Bet placed successfully!");
          closeQuickBet();
        }, 800);
      } else {
        const errorMsg = resp?.meta?.message || resp?.data?.message || "Failed to place bet";
        throw new Error(errorMsg);
      }
    } catch (err: any) {
      // Check for authentication errors
      const errorMessage = err?.message || ''
      if (errorMessage.toLowerCase().includes('user not found') || 
          errorMessage.toLowerCase().includes('unauthorized')) {
        // Auth state should already be cleared by graphqlClient, but ensure user is logged out
        notify.error("Your session has expired. Please login again.");
        // Open auth modal after a brief delay to allow state to clear
        setTimeout(() => {
          openAuthModal("login");
        }, 500);
      } else {
        notify.error(err?.message || "Failed to place bet");
      }
    } finally {
      setIsLoading(false);
      inFlightRef.current = false;
    }
  }, [bet, event, stake, odds, closeQuickBet, isAuthenticated, openAuthModal, refreshUser, cashoutEnabled, overallExposureCap, user, canPlaceStake]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !isLoading && stake && bet) {
        e.preventDefault();
        // Cashout is just a regular bet - use normal bet placement
        handlePlaceBet();
      }
      if (e.key === "Escape" && bet) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlaceBet, handleClose, isLoading, stake, bet]);

  const isBack = bet?.type === "back";

  if (!isAuthenticated) {
    return null;
  }

  const fancy = bet?.marketType === "fancy";
  const priceText = (value: number) => (value > 0 ? (fancy ? value.toFixed(0) : value.toFixed(2)) : "–");
  const flashFor = (side: boolean) => (oddsFlash && side ? ` is-${oddsFlash}` : "");
  const canPlace = Boolean(stake) && parseFloat(stake) > 0 && !isLoading;

  // Matchbook slip (styles in nova-sports-event.css). The drawer around it (BetSlipDrawer) carries the title and
  // close button; the side of the bet shows as the back/lay colour on the selection and the active price.
  return bet ? (
    <div className={`nova-slip ${isBack ? "is-back" : "is-lay"}`}>
      {animateSuccess && (
        <div className="nova-slip-overlay is-success" role="status">
          <Check aria-hidden="true" />
          <p>Bet placed</p>
        </div>
      )}
      {isLoading && !animateSuccess && (
        <div className="nova-slip-overlay" role="status">
          <Loader2 className="animate-spin" aria-hidden="true" />
          <p>Placing bet…</p>
        </div>
      )}

      <div className="nova-slip-selection">
        <span className="nova-slip-side">{isBack ? "Back" : "Lay"}</span>
        <div>
          <h3>{bet.team}</h3>
          <p>{bet.market}</p>
        </div>
      </div>

      <div className="nova-slip-prices">
        {([["back", liveBackOdds], ["lay", liveLayOdds]] as const).map(([side, live]) => {
          const active = (side === "back") === isBack;
          return (
            <div key={side} className={`nova-slip-price is-${side}${active ? " is-active" : ""}`}>
              <button type="button" disabled={live <= 0} onClick={() => handleSwitchBetType(side)} aria-pressed={active}>
                <span>{side === "back" ? "Back" : "Lay"}</span>
                <strong className={`tabular-nums${flashFor(active)}`}>{priceText(live)}</strong>
              </button>
              {active && live > 0 && live !== odds && (
                <button type="button" className="nova-slip-use-live" onClick={() => handleUseLiveOdds(live)}>Use live price</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="nova-slip-fields">
        <div className="nova-slip-field">
          <label htmlFor="nova-slip-odds">
            Odds{fancy && <span> @{odds.toFixed(0)}/{(bet.oddsSize ?? bet.odds_size) || 100}</span>}
          </label>
          <div className="nova-slip-input">
            {!fancy && (
              <button type="button" onClick={() => handleOddsChange(Math.max(1.01, odds - 0.01))} aria-label="Lower odds"><Minus aria-hidden="true" /></button>
            )}
            <input
              id="nova-slip-odds"
              type="number"
              inputMode="decimal"
              value={Number.isFinite(odds) ? (fancy ? odds.toFixed(0) : odds.toFixed(2)) : ""}
              onChange={(e) => {
                if (fancy) return;
                const num = Number(e.target.value);
                if (!Number.isNaN(num)) handleOddsChange(num);
              }}
              readOnly={fancy}
            />
            {!fancy && (
              <button type="button" onClick={() => handleOddsChange(odds + 0.01)} aria-label="Raise odds"><Plus aria-hidden="true" /></button>
            )}
          </div>
        </div>
        <div className="nova-slip-field">
          <label htmlFor="nova-slip-stake">Stake</label>
          <div className="nova-slip-input">
            <span className="nova-slip-currency" aria-hidden="true">{getCurrencySymbol()}</span>
            <input
              id="nova-slip-stake"
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={formatStake(stake)}
              onChange={(e) => handleStakeChange(e.target.value)}
            />
            {stake && (
              <button type="button" onClick={handleClear} aria-label="Clear stake"><RotateCcw aria-hidden="true" /></button>
            )}
          </div>
        </div>
      </div>

      <div className="nova-slip-quick">
        <div className="nova-slip-quick-head">
          <span><Zap aria-hidden="true" />Quick stake</span>
          <button type="button" onClick={handleMaxStake} disabled={!isAuthenticated || getAvailableBalance() <= 0}>Max</button>
        </div>
        <div className="nova-slip-quick-grid">
          {QUICK_STAKES.map((amount) => (
            <button key={amount} type="button" onClick={() => handleQuickStake(amount)}>
              +{amount >= 1000 ? `${amount / 1000}k` : amount}
            </button>
          ))}
        </div>
      </div>

      <dl className="nova-slip-summary">
        <div>
          <dt>{isBack ? "Profit" : "Liability"}</dt>
          <dd className={isBack ? "is-up" : "is-down"}>{isBack ? "+" : "-"}{formatAmount(isBack ? profit : liability)}</dd>
        </div>
        {isBack ? (
          <div>
            <dt>Returns</dt>
            <dd>{formatAmount(returns)}</dd>
          </div>
        ) : (
          <div>
            <dt>Profit</dt>
            <dd className="is-up">+{formatAmount(profit)}</dd>
          </div>
        )}
      </dl>

      <div className="nova-slip-actions">
        <button type="button" className="nova-slip-cancel" onClick={handleCancel} disabled={isLoading}>Cancel</button>
        <button type="button" className={`nova-slip-place${bet?.isCashout ? " is-cashout" : ""}`} onClick={handlePlaceBet} disabled={!canPlace}>
          {bet?.isCashout ? "Cash out" : isBack ? "Place back bet" : "Place lay bet"}
        </button>
      </div>

      <p className="nova-slip-hint">Press <kbd>Enter</kbd> to place the bet</p>
    </div>
  ) : (
    <p className="nova-slip-empty"><Coins aria-hidden="true" />Select odds to place a bet</p>
  );
}
