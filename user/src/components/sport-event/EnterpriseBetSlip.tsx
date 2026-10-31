import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  X,
  Coins,
  Plus,
  Minus,
  Loader2,
  TrendingUp,
  TrendingDown,
  Zap,
  Check,
  Trash2,
  Activity,
} from "lucide-react";
import type { BetSlipData, EventDetails } from "./types";
import { useBetSlip } from "../sports/BetSlipProvider";
import { placeSportsBet, placeFancyBet } from "@/lib/api/user";
import { notify } from "@/lib/notify";
import { useAuth } from "@/lib/auth";
import { useOddsSocket } from "@/lib/hooks/useOddsSocket";
import { useSportsSettings } from "@/hooks/useSportsSettings";
import { useRiskConfig } from "@/hooks/useAppSettings";
import { useStakeLimits } from "@/hooks/useStakeLimits";
import { formatAmount, getCurrencySymbol } from "@/lib/currency";
import { getFancyLiveSnapshot } from "./fancySocketOdds";
import ModalSurface from "../modals/ModalSurface";

interface EnterpriseBetSlipProps {
  bet: BetSlipData;
  event?: EventDetails;
  variant?: "mobile" | "desktop";
}

const QUICK_STAKES = [1000, 2000, 5000, 10000, 20000, 25000, 50000, 75000];

export default function EnterpriseBetSlip({
  bet,
  event,
  variant = "mobile",
}: EnterpriseBetSlipProps) {
  const { closeQuickBet, updateQuickBet, openQuickBet } = useBetSlip();
  const { isAuthenticated, openAuthModal, refreshUser, user } = useAuth();
  const { cashoutEnabled, overallExposureCap } = useRiskConfig();
  const { canPlaceStake } = useStakeLimits();

  // Refs
  const lastBetKeyRef = useRef<string>("");
  const lastOpenIdRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const stakeInputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const slipRootRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number>(0);
  const dragCurrentY = useRef<number>(0);
  const isDragging = useRef<boolean>(false);

  // Local state
  const currentBetKey = `${bet.team}-${bet.market}-${bet.type}`;
  const [stake, setStake] = useState(() => (bet.stake ? String(bet.stake) : ""));
  const [odds, setOdds] = useState<number>(Number(bet.odds) || 0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [animateSuccess, setAnimateSuccess] = useState(false);
  const [, setOddsFlash] = useState<'up' | 'down' | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isClosingByDrag, setIsClosingByDrag] = useState(false);
  const [dragging, setDragging] = useState(false);

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
      return { back: 0, lay: 0 };
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
        back: bet.backOdds || bet.odds || 0,
        lay: bet.layOdds || 0,
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
        back: bet.backOdds || bet.odds || 0,
        lay: bet.layOdds || 0,
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
        back: bet.backOdds || bet.odds || 0,
        lay: bet.layOdds || 0,
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
      back: back > 0 ? back : (bet.backOdds || bet.odds || 0),
      lay: lay > 0 ? lay : (bet.layOdds || 0),
    };
  }, [bet, oddsSocketData, event?.eventCode]);

  const liveOdds = extractLiveOdds();
  const liveBackOdds = liveOdds.back;
  const liveLayOdds = liveOdds.lay;
  const liveFancyBackSize = (liveOdds as { fancyBackSize?: number }).fancyBackSize;
  const liveFancyLaySize = (liveOdds as { fancyLaySize?: number }).fancyLaySize;

  // Extract current fancy status from live data
  const getCurrentFancyStatus = useCallback(() => {
    if (bet.marketType !== "fancy") return bet.fancyStatus;
    const snap = getFancyLiveSnapshot(oddsSocketData as Record<string, unknown> | undefined, bet, event?.eventCode);
    return snap?.fancyStatus ?? bet.fancyStatus;
  }, [bet, oddsSocketData, event?.eventCode]);

  // Normalize odds to 2 decimal places
  const normalizeOdds = (val: number) => {
    if (!Number.isFinite(val)) return 0;
    return parseFloat(Number(val).toFixed(2));
  };

  // Sync odds and stake when bet changes
  useEffect(() => {
    const openId = typeof bet.openId === "number" ? bet.openId : 0;
    const freshOpen = openId > 0 && openId !== lastOpenIdRef.current;
    const betKeyChanged = lastBetKeyRef.current !== currentBetKey;

    if (freshOpen) {
      // Fresh open from odds click - always reset to new selection, clear stake
      lastOpenIdRef.current = openId;
      lastBetKeyRef.current = currentBetKey;
      setOdds(normalizeOdds(Number(bet.odds) || 0));
      setStake("");
    } else if (betKeyChanged) {
      // Bet selection changed (e.g. cashout flow) - reset everything
      lastBetKeyRef.current = currentBetKey;
      setOdds(normalizeOdds(Number(bet.odds) || 0));
      if (typeof bet.stake === "number" && !Number.isNaN(bet.stake) && Number.isFinite(bet.stake)) {
        const stakeValue = Math.max(0, Math.min(bet.stake, 999999999));
        setStake(String(Math.floor(stakeValue)));
      } else {
        setStake("");
      }
    } else {
      // Same selection - check if stake or odds changed
      const currentOdds = normalizeOdds(Number(bet.odds) || 0);
      const oddsChanged = Math.abs(currentOdds - odds) > 0.001;

      const currentStake = typeof bet.stake === "number" && !Number.isNaN(bet.stake) && Number.isFinite(bet.stake)
        ? Math.floor(Math.max(0, Math.min(bet.stake, 999999999)))
        : 0;
      const stakeInState = parseFloat(stake) || 0;
      const stakeChanged = Math.abs(currentStake - stakeInState) > 0.01;

      if (oddsChanged) {
        setOdds(currentOdds);
      }
      if (stakeChanged && currentStake > 0) {
        setStake(String(currentStake));
      }
    }
  }, [currentBetKey, bet.odds, bet.stake, bet.openId, odds, stake]);

  // Flash effect when live odds change
  useEffect(() => {
    const currentOdds = bet.type === 'back' ? liveBackOdds : liveLayOdds;
    if (currentOdds !== odds && currentOdds > 0) {
      setOddsFlash(currentOdds > odds ? 'up' : 'down');
      setTimeout(() => setOddsFlash(null), 500);
    }
  }, [liveBackOdds, liveLayOdds, bet.type, odds]);

  // Fancy: keep slip odds and oddsSize aligned with socket
  useEffect(() => {
    if (bet.marketType !== "fancy" || !event?.eventCode) return;
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
    bet.oddsSize,
    bet.odds_size,
    bet.type,
    extractLiveOdds,
    updateQuickBet,
    liveBackOdds,
    liveLayOdds,
    liveFancyBackSize,
    liveFancyLaySize,
  ]);

  // Open animation on mount
  useEffect(() => {
    if (variant === "mobile") {
      // Trigger open animation
      const frame = requestAnimationFrame(() => {
        setIsOpen(true);
      });
      // Auto focus stake input after animation
      const focusTimer = setTimeout(() => stakeInputRef.current?.focus(), 350);
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(focusTimer);
      };
    }
  }, [variant]);

  // Handlers
  const handleOddsChange = useCallback(
    (newOdds: number) => {
      setOdds(normalizeOdds(newOdds));
      updateQuickBet({ odds: newOdds });
    },
    [updateQuickBet]
  );

  const handleStakeChange = useCallback(
    (newStake: string) => {
      const cleaned = newStake.replace(/[^0-9]/g, "");
      setStake(cleaned);
      const numeric = parseFloat(cleaned) || 0;
      updateQuickBet({ stake: numeric });
    },
    [updateQuickBet]
  );

  const handleQuickStake = useCallback(
    (amount: number) => {
      const currentAmount = parseFloat(stake) || 0;
      const newAmount = currentAmount + amount;
      setStake(String(newAmount));
      updateQuickBet({ stake: newAmount });
    },
    [stake, updateQuickBet]
  );

  // Get available balance (cash - exposure for regular players, creditAvailable for credit players)
  const getAvailableBalance = useCallback(() => {
    if (!isAuthenticated || !user) return 0;
    
    // Check if user is a credit player
    const playerType = (user as any)?.playerType || 'REGULAR'
    const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
    
    // Credit players should use creditAvailable (no exposure deduction needed)
    if (isCreditPlayer) {
      return Number(user.creditAvailable ?? 0)
    }
    
    // Regular players: balance - exposure
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
  }, [bet.marketType, sportsSettings, getAvailableBalance, updateQuickBet]);

  const handleClear = useCallback(() => {
    setStake("");
    setOdds(Number(bet.odds) || 0);
    updateQuickBet({ stake: 0 });
  }, [bet.odds, updateQuickBet]);

  const handleClose = useCallback(() => {
    if (variant === "mobile") {
      // Trigger closing animation
      setIsClosing(true);
      setIsOpen(false);
      // Wait for animation to complete before closing
      setTimeout(() => {
        setIsLoading(false);
        closeQuickBet();
      }, 300);
    } else {
      setIsLoading(false);
      closeQuickBet();
    }
  }, [closeQuickBet, variant]);

  // Drag handlers for pull handle
  const handleDragStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (isClosing || isLoading) return;
    
    isDragging.current = true;
    setDragging(true);
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartY.current = clientY;
    dragCurrentY.current = clientY;
    setDragOffset(0);
  }, [isClosing, isLoading]);

  const handleDragMove = useCallback((e: React.TouchEvent | React.MouseEvent | TouchEvent | MouseEvent) => {
    if (!isDragging.current || isClosing || isLoading) return;
    
    // Prevent default to avoid scrolling
    if ('preventDefault' in e) {
      e.preventDefault();
    }
    
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaY = clientY - dragStartY.current;
    
    // Only allow dragging down (positive deltaY)
    if (deltaY > 0) {
      dragCurrentY.current = clientY;
      setDragOffset(deltaY);
    }
  }, [isClosing, isLoading]);

  const handleDragEnd = useCallback(() => {
    if (!isDragging.current) return;
    
    const dragDistance = dragCurrentY.current - dragStartY.current;
    const threshold = 100; // 100px threshold to close
    
    isDragging.current = false;
    setDragging(false);
    
    if (dragDistance > threshold) {
      // Close via drag - animate to fully closed without CSS animation
      setIsClosingByDrag(true);
      setIsOpen(false);
      
      // Get drawer height to calculate full close
      const drawerElement = slipRootRef.current;
      const drawerHeight = drawerElement?.getBoundingClientRect().height || window.innerHeight;
      
      // Animate to fully closed position
      setDragOffset(drawerHeight);
      
      // Close after animation completes
      setTimeout(() => {
        setIsLoading(false);
        setDragOffset(0);
        setIsClosingByDrag(false);
        dragStartY.current = 0;
        dragCurrentY.current = 0;
        closeQuickBet();
      }, 250);
    } else {
      // Reset to original position with smooth animation
      setDragOffset(0);
      dragStartY.current = 0;
      dragCurrentY.current = 0;
    }
  }, [closeQuickBet]);

  // Global mouse and touch handlers for dragging
  useEffect(() => {
    if (!dragging) return;
    const bodyStyle = document.body.style;
    const originalOverflow = bodyStyle.overflow;
    const originalTouchAction = bodyStyle.touchAction;
    const originalUserSelect = bodyStyle.userSelect;
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        handleDragMove(e);
      }
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        handleDragEnd();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging.current) {
        handleDragMove(e);
      }
    };

    const handleTouchEnd = () => {
      if (isDragging.current) {
        handleDragEnd();
      }
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    bodyStyle.overflow = 'hidden';
    bodyStyle.touchAction = 'none';
    bodyStyle.userSelect = 'none';
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      if (bodyStyle.overflow === 'hidden') bodyStyle.overflow = originalOverflow;
      if (bodyStyle.touchAction === 'none') bodyStyle.touchAction = originalTouchAction;
      if (bodyStyle.userSelect === 'none') bodyStyle.userSelect = originalUserSelect;
    };
  }, [dragging, handleDragMove, handleDragEnd]);

  // Switch bet type (back <-> lay)
  const handleSwitchBetType = useCallback((newType: 'back' | 'lay') => {
    if (newType === bet.type) return;
    const newOdds = newType === 'back' ? liveBackOdds : liveLayOdds;
    openQuickBet({
      ...bet,
      type: newType,
      odds: newOdds || bet.odds,
      backOdds: liveBackOdds,
      layOdds: liveLayOdds,
    });
    setOdds(normalizeOdds(newOdds || bet.odds));
  }, [bet, liveBackOdds, liveLayOdds, openQuickBet]);

  // Use live odds
  const handleUseLiveOdds = useCallback((liveOddsValue: number) => {
    if (liveOddsValue > 0) {
      setOdds(normalizeOdds(liveOddsValue));
      updateQuickBet({ odds: liveOddsValue });
    }
  }, [updateQuickBet]);

  // Calculate potential returns
  const calculateReturns = () => {
    const stakeAmount = parseFloat(stake) || 0;
    if (stakeAmount <= 0 || !Number.isFinite(odds) || odds <= 1) return { profit: 0, liability: 0 };
    
    // Fancy market calculation
    if (bet.marketType === "fancy") {
      // Get oddsSize percentage (default to 100% if not provided)
      // Handle cases where oddsSize might be 0 or undefined
      const rawOddsSize = bet.oddsSize ?? bet.odds_size;
      const oddsSize = (rawOddsSize !== undefined && rawOddsSize !== null && rawOddsSize > 0) ? rawOddsSize : 100;
      const oddsSizePercent = oddsSize / 100;
      
      if (bet.type === "back") {
        // BACK: Potential Profit = Stake × (OddsSize/100), Potential Loss = Stake
        return { 
          profit: stakeAmount * oddsSizePercent, 
          liability: stakeAmount 
        };
      } else {
        // LAY: Potential Profit = Stake, Potential Loss = Stake × (OddsSize/100)
        return { 
          profit: stakeAmount, 
          liability: stakeAmount * oddsSizePercent 
        };
      }
    }
    
    // Exchange/Bookmaker calculation (existing logic)
    if (bet.type === "back") {
      return { profit: stakeAmount * (odds - 1), liability: stakeAmount };
    }
    return { profit: stakeAmount, liability: stakeAmount * (odds - 1) };
  };

  const { profit, liability } = calculateReturns();

  // Cashout is just a regular bet - no special handling needed
  // The bet slip already has the correct odds and stake pre-filled from handleOpenCashoutBetSlip

  // Place bet handler
  const handlePlaceBet = useCallback(async () => {
    if (!isAuthenticated) {
      openAuthModal("login");
      return;
    }

    if (!event) {
      notify.error("Event information not available");
      return;
    }

    // Check if cashout is enabled (for cashout bets)
    if (bet.isCashout && !cashoutEnabled) {
      notify.error("Cashout feature is currently disabled");
      return;
    }

    // Parse and validate stake amount
    const stakeAmount = parseFloat(stake) || 0;
    if (!stakeAmount || stakeAmount <= 0) {
      notify.error("Please enter a valid stake amount");
      return;
    }

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

    // Check if fancy is suspended or ball running (using current live status)
    if (bet.marketType === "fancy") {
      const currentStatus = getCurrentFancyStatus();
      if (currentStatus === "SUSPENDED" || currentStatus === "Ball Running") {
        notify.error("This market is currently suspended");
        return;
      }
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
          selectionId: bet.selectionId || "",
          odds_size: bet.oddsSize || bet.odds_size || 100, // Use oddsSize from fancy data, default to 100
          eventId: event.eventId || event.id,
          leagueId: event.leagueId,
          sportId: event.sportId,
        };

        if (!payload.eventId || !payload.sportId || !payload.leagueId || !payload.marketCode || !payload.selectionId) {
          notify.error("Missing required bet information");
          setIsLoading(false);
          inFlightRef.current = false;
          return;
        }
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

        if (!payload.eventId || !payload.sportId || !payload.leagueId || !payload.marketId) {
          notify.error("Missing required bet information");
          setIsLoading(false);
          inFlightRef.current = false;
          return;
        }
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
          
          // Trigger closing animation before closing
          if (variant === "mobile") {
            setIsClosing(true);
            setIsOpen(false);
            setTimeout(() => closeQuickBet(), 300);
          } else {
            closeQuickBet();
          }
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
  }, [bet, event, stake, odds, closeQuickBet, isAuthenticated, openAuthModal, refreshUser, variant, cashoutEnabled, overallExposureCap, user, canPlaceStake]);

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const root = slipRootRef.current;
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return;
      const ownDialog = root.closest('dialog');
      if (Array.from(document.querySelectorAll('dialog[open]')).some(dialog => dialog !== ownDialog)) return;
      if (e.defaultPrevented || e.isComposing || isClosing || isClosingByDrag) return;
      if (e.key === "Enter" && e.target instanceof HTMLInputElement && !isLoading && stake) {
        e.preventDefault();
        // Cashout is just a regular bet - use normal bet placement
        handlePlaceBet();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlaceBet, handleClose, isLoading, stake, bet, isClosing, isClosingByDrag]);

  const isBack = bet.type === "back";
  
  // Use exact same colors as market odds
  const primaryColor = isBack ? "rgb(59, 130, 246)" : "rgb(244, 63, 94)"; // sky-500 : rose-500
  const primaryColorClass = isBack ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400";
  const primaryBgClass = isBack ? "bg-sky-500" : "bg-rose-500";
  // Mobile Bottom Sheet – full stake state redesign
  if (variant === "mobile") {
    return (
      <ModalSurface open onClose={handleClose} title="Bet slip" titleId="enterprise-bet-slip-title" hideHeader size="lg" dismissible={!isClosing && !isClosingByDrag && !dragging} className="nova-enterprise-betslip-modal">
        <style>{`
          @keyframes drawer-spring {
            0% { transform: translateY(100%); }
            60% { transform: translateY(-8px); }
            80% { transform: translateY(4px); }
            100% { transform: translateY(0); }
          }
          @keyframes drawer-exit {
            0% { transform: translateY(0); opacity: 1; }
            100% { transform: translateY(100%); opacity: 0.8; }
          }
          .drawer-enter { animation: drawer-spring 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
          .drawer-exit { animation: drawer-exit 0.25s cubic-bezier(0.4, 0, 1, 1); }
        `}</style>

        <div
          ref={slipRootRef}
          data-enterprise-betslip="mobile"
          className={`nova-bet-slip-dialog ${
            isClosing && !isClosingByDrag ? "drawer-exit" : !isOpen && !isClosingByDrag ? "translate-y-full" : ""
          }`}
          style={{
            transform: isClosingByDrag
              ? `translateY(${dragOffset}px)`
              : isDragging.current && dragOffset > 0
                ? `translateY(${dragOffset}px)`
                : undefined,
            transition: isClosingByDrag
              ? "transform 0.25s cubic-bezier(0.4, 0, 1, 1)"
              : isDragging.current
                ? "none"
                : dragOffset > 0 && !isClosingByDrag
                  ? "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
                  : !isOpen && !isClosing
                    ? "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                    : undefined,
          }}
        >
          {/* Container – stake state slate only */}
          <div
            className={`relative bg-[color:var(--ds-color-slate-800)] rounded-t-2xl border-t border-x border-[color:var(--ds-color-slate-700)] shadow-2xl overflow-hidden flex flex-col max-h-[88vh] ${
              isOpen && !isClosing ? "scale-100 opacity-100" : "scale-[0.98] opacity-0"
            }`}
          >
            {/* Drag handle */}
            <div
              ref={drawerRef}
              className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
              onMouseDown={handleDragStart}
            >
              <div className="w-10 h-1 rounded-[5px] bg-[color:var(--ds-color-slate-600)]" />
            </div>

            {/* Header – stake style (like ProviderFilterDrawer) */}
            <div className="flex-shrink-0 px-4 py-3 border-b border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 rounded-xl bg-[var(--brand-primary)]/15 border border-[var(--brand-primary)]/30 grid place-items-center flex-shrink-0">
                    <Zap className="h-5 w-5 text-[var(--brand-primary)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 id="enterprise-bet-slip-title" className="text-sm font-semibold text-[color:var(--ds-color-slate-100)] truncate">
                      <span className="sr-only">Bet slip: </span>
                      {bet.team}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[color:var(--ds-color-slate-400)] truncate">
                        {bet.market}
                      </span>
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-[var(--brand-primary)]/15 border border-[var(--brand-primary)]/30">
                        <Activity className="w-2.5 h-2.5 text-[var(--brand-primary)]" />
                        <span className="text-[8px] font-bold text-[var(--brand-primary)] tracking-wide">LIVE</span>
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isClosing && !isClosingByDrag) handleClose();
                  }}
                  disabled={isClosing || isClosingByDrag}
                  aria-label="Close bet slip"
                  className="h-9 w-9 rounded-xl bg-[color:var(--ds-color-slate-700)] hover:bg-[color:var(--ds-color-slate-650)] border border-[color:var(--ds-color-slate-600)] text-[color:var(--ds-color-slate-300)] hover:text-[color:var(--ds-color-slate-100)] grid place-items-center transition-all flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {/* Back / Lay toggle – stake gold when selected */}
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => handleSwitchBetType('back')}
                  disabled={liveBackOdds <= 0}
                  className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${
                    isBack
                      ? "bg-[var(--brand-primary)]/20 text-[var(--brand-primary)] border-[var(--brand-primary)]/50"
                      : "bg-[color:var(--ds-color-slate-700)] text-[color:var(--ds-color-slate-400)] border-[color:var(--ds-color-slate-600)] hover:border-[color:var(--ds-color-slate-500)]"
                  } ${liveBackOdds <= 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  Back {liveBackOdds > 0 ? (bet.marketType === "fancy" ? liveBackOdds.toFixed(0) : liveBackOdds.toFixed(2)) : "–"}
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchBetType('lay')}
                  disabled={liveLayOdds <= 0}
                  className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${
                    !isBack
                      ? "bg-[var(--brand-primary)]/20 text-[var(--brand-primary)] border-[var(--brand-primary)]/50"
                      : "bg-[color:var(--ds-color-slate-700)] text-[color:var(--ds-color-slate-400)] border-[color:var(--ds-color-slate-600)] hover:border-[color:var(--ds-color-slate-500)]"
                  } ${liveLayOdds <= 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  Lay {liveLayOdds > 0 ? (bet.marketType === "fancy" ? liveLayOdds.toFixed(0) : liveLayOdds.toFixed(2)) : "–"}
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="relative flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 bg-[color:var(--ds-color-slate-800)]">
              {/* Success overlay */}
              {animateSuccess && (
                <div className="absolute inset-0 bg-[color:var(--ds-color-slate-800)]/98 z-50 flex items-center justify-center rounded-t-2xl">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-[5px] bg-[var(--brand-primary)]/20 border-2 border-[var(--brand-primary)]/50 flex items-center justify-center mx-auto mb-3">
                      <Check className="w-8 h-8 text-[var(--brand-primary)]" />
                    </div>
                    <p className="text-base font-bold text-[var(--brand-primary)] mb-1">Bet Placed</p>
                    <p className="text-xs text-[color:var(--ds-color-slate-400)]">
                      {formatAmount(Number(stake))} @ {bet.marketType === "fancy" ? odds.toFixed(0) : odds.toFixed(2)}
                    </p>
                  </div>
                </div>
              )}

              {/* Loading overlay */}
              {isLoading && !animateSuccess && (
                <div className="absolute inset-0 bg-[color:var(--ds-color-slate-975)]/90 backdrop-blur-md z-50 flex items-center justify-center rounded-t-2xl">
                  <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-[color:var(--ds-color-slate-800)] border border-[color:var(--ds-color-slate-600)]">
                    <Loader2 className="w-10 h-10 animate-spin text-[var(--brand-primary)]" />
                    <p className="text-sm font-semibold text-[color:var(--ds-color-slate-100)]">Placing Bet...</p>
                    <p className="text-[10px] text-[color:var(--ds-color-slate-400)]">Please wait</p>
                  </div>
                </div>
              )}

              {/* Your odds – stake style card */}
              <div className="rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)] p-3">
                <label className="text-[10px] font-bold uppercase text-[color:var(--ds-color-slate-400)] tracking-wider mb-2 block">
                  {bet.marketType === "fancy" ? `Odds @ ${odds.toFixed(0)}/${(bet.oddsSize ?? bet.odds_size) || 100}` : "Your odds"}
                </label>
                <div className="flex items-center rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--brand-primary)]/30 focus-within:border-[var(--brand-primary)]/50">
                  {bet.marketType !== "fancy" && (
                    <button
                      type="button"
                      onClick={() => handleOddsChange(Math.max(1.01, Number((odds - 0.01).toFixed(2))))}
                      className="p-2.5 text-[color:var(--ds-color-slate-300)] hover:bg-[color:var(--ds-color-slate-700)] transition-colors"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  )}
                  <input
                    type="number"
                    inputMode="decimal"
                    aria-label="Your odds"
                    value={Number.isFinite(odds) ? (bet.marketType === "fancy" ? odds.toFixed(0) : odds.toFixed(2)) : ""}
                    onChange={(e) => {
                      if (bet.marketType === "fancy") return;
                      const num = Number(e.target.value);
                      if (!Number.isNaN(num)) handleOddsChange(num);
                    }}
                    readOnly={bet.marketType === "fancy"}
                    className="flex-1 min-w-0 py-2.5 bg-transparent text-center text-lg font-bold tabular-nums text-[var(--brand-primary)] focus:outline-none appearance-none [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {bet.marketType !== "fancy" && (
                    <button
                      type="button"
                      onClick={() => handleOddsChange(Number((odds + 0.01).toFixed(2)))}
                      className="p-2.5 text-[color:var(--ds-color-slate-300)] hover:bg-[color:var(--ds-color-slate-700)] transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {!isBack && liveBackOdds > 0 && liveBackOdds !== odds && (
                  <button
                    type="button"
                    onClick={() => handleUseLiveOdds(liveBackOdds)}
                    className="mt-2 text-[10px] font-medium text-[var(--brand-primary)] hover:underline"
                  >
                    Use Back {bet.marketType === "fancy" ? liveBackOdds.toFixed(0) : liveBackOdds.toFixed(2)}
                  </button>
                )}
                {isBack && liveLayOdds > 0 && liveLayOdds !== odds && (
                  <button
                    type="button"
                    onClick={() => handleUseLiveOdds(liveLayOdds)}
                    className="mt-2 text-[10px] font-medium text-[var(--brand-primary)] hover:underline"
                  >
                    Use Lay {bet.marketType === "fancy" ? liveLayOdds.toFixed(0) : liveLayOdds.toFixed(2)}
                  </button>
                )}
              </div>

              {/* Stake input – stake style */}
              <div className="rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold uppercase text-[color:var(--ds-color-slate-400)] tracking-wider">
                    Stake
                  </label>
                  <button
                    type="button"
                    onClick={handleMaxStake}
                    className="text-[10px] font-bold text-[var(--brand-primary)] hover:underline"
                  >
                    MAX
                  </button>
                </div>
                <div className="flex items-center rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--brand-primary)]/30 focus-within:border-[var(--brand-primary)]/50">
                  <span className="pl-3 text-sm font-semibold text-[color:var(--ds-color-slate-400)]">{getCurrencySymbol()}</span>
                  <input
                    ref={stakeInputRef}
                    type="text"
                    inputMode="numeric"
                    aria-label="Stake"
                    placeholder="0"
                    value={stake}
                    onChange={(e) => handleStakeChange(e.target.value)}
                    className="flex-1 min-w-0 py-2.5 px-2 bg-transparent text-lg font-bold text-[color:var(--ds-color-slate-100)] placeholder:text-[color:var(--ds-color-slate-500)] focus:outline-none tabular-nums"
                  />
                  {stake && (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="p-2 text-[color:var(--ds-color-slate-400)] hover:bg-[color:var(--ds-color-slate-700)] rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {/* Quick stakes – gold chips */}
                <div className="grid grid-cols-4 gap-1.5 mt-3">
                  {QUICK_STAKES.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => handleQuickStake(amount)}
                      className="py-2 rounded-lg text-[11px] font-bold bg-[var(--brand-primary)]/15 text-[var(--brand-primary)] border border-[var(--brand-primary)]/40 hover:bg-[var(--brand-primary)]/25 active:bg-[var(--brand-primary)]/35 transition-colors"
                    >
                      +{amount >= 1000 ? `${amount / 1000}k` : amount}
                    </button>
                  ))}
                </div>
              </div>

              {/* P&L – stake style card */}
              <div className="rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-[var(--brand-primary)]/15 border border-[var(--brand-primary)]/30 grid place-items-center">
                      <TrendingUp className="w-4 h-4 text-[var(--brand-primary)]" />
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-[color:var(--ds-color-slate-400)] tracking-wider">
                        {isBack ? "Win" : "Risk"}
                      </p>
                      <span className={`text-sm font-bold tabular-nums ${isBack ? "text-green-500" : "text-rose-500"}`}>
                        {isBack ? "+" : "-"}{formatAmount(isBack ? profit : liability)}
                      </span>
                    </div>
                  </div>
                  <div className="w-px h-8 bg-[color:var(--ds-color-slate-600)]" />
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-[color:var(--ds-color-slate-700)] grid place-items-center">
                      <TrendingDown className="w-4 h-4 text-[color:var(--ds-color-slate-400)]" />
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-[color:var(--ds-color-slate-400)] tracking-wider">
                        {isBack ? "Stake" : "Win"}
                      </p>
                      <span className={`text-sm font-bold tabular-nums ${!isBack ? "text-green-500" : "text-[color:var(--ds-color-slate-100)]"}`}>
                        {!isBack ? "+" : ""}{formatAmount(isBack ? liability : profit)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Fixed footer – Place Bet (stake gold CTA) */}
            <div className="flex-shrink-0 px-4 py-3 border-t border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)] pb-[calc(env(safe-area-inset-bottom)+12px)]">
              <button
                type="button"
                onClick={handlePlaceBet}
                disabled={!stake || parseFloat(stake) <= 0 || isLoading}
                className={`w-full py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${
                  !stake || parseFloat(stake) <= 0 || isLoading
                    ? "bg-[color:var(--ds-color-slate-700)] text-[color:var(--ds-color-slate-400)] cursor-not-allowed"
                    : bet.isCashout
                    ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                    : "bg-[var(--brand-primary)] text-white hover:opacity-90 border border-[var(--brand-primary)] shadow-md shadow-[var(--brand-primary)]/20"
                }`}
              >
                <Zap className="w-4 h-4" />
                <span>{bet.isCashout ? "Cashout" : isBack ? "Place Back Bet" : "Place Lay Bet"}</span>
                {stake && parseFloat(stake) > 0 && !bet.isCashout && (
                  <span className="px-2 py-0.5 rounded-md bg-black/10 text-[10px] font-bold">
                    @ {bet.marketType === "fancy" ? odds.toFixed(0) : odds.toFixed(2)}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </ModalSurface>
    );
  }

  // Desktop Design (Inline Card)
  return (
    <div ref={slipRootRef} data-enterprise-betslip="desktop" className="relative bg-[color:var(--surface)] border border-[color:var(--border)]/40 rounded-xl shadow-xl overflow-hidden animate-fade-in">
      {animateSuccess && (
        <div className="absolute inset-0 bg-[color:var(--surface)]/95 z-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-[5px] bg-green-500/20 flex items-center justify-center mx-auto mb-2 animate-bounce">
              <Check className="w-6 h-6 text-green-500" />
            </div>
            <p className="text-xs font-bold text-green-500">Bet Placed!</p>
          </div>
        </div>
      )}

      {isLoading && !animateSuccess && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 p-4 rounded-xl bg-[color:var(--surface)] border border-[color:var(--border)]/50">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: primaryColor }} />
            <p className="text-xs font-bold text-[color:var(--text)]">Placing Bet...</p>
          </div>
        </div>
      )}

      <div className={`px-3 py-2.5 border-b border-[color:var(--border)]/30 ${
        isBack 
          ? "bg-gradient-to-r from-sky-500/15 to-transparent" 
          : "bg-gradient-to-r from-rose-500/15 to-transparent"
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`px-2 py-0.5 rounded text-[9px] font-black tracking-wider ${primaryBgClass} text-white`}>
              {isBack ? "BACK" : "LAY"}
            </span>
            <span className="text-xs font-bold text-[color:var(--text)] truncate">
              {bet.team}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-[color:var(--surface-2)] transition-colors"
          >
            <X className="w-3.5 h-3.5 text-[color:var(--subtle)]" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="flex items-center justify-end gap-2">
          <span className="text-[9px] font-bold uppercase text-[color:var(--subtle)]">P&L</span>
          <div className={`px-2.5 py-1 rounded-lg border text-center text-xs font-black tabular-nums ${
            isBack
              ? "bg-green-500/10 border-green-500/40 text-green-500"
              : "bg-rose-500/10 border-rose-500/40 text-rose-500"
          }`}>
            {isBack ? `+${formatAmount(profit)}` : `-${formatAmount(liability)}`}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-[9px] font-bold uppercase text-[color:var(--subtle)] block text-center mb-1">
              {bet.marketType === 'fancy' ? `@${odds.toFixed(0)}/${((bet.oddsSize ?? bet.odds_size) || 100)}` : 'Odds'}
            </label>
            <div className={`flex items-center rounded-lg border overflow-hidden ${
              isBack 
                ? "bg-sky-500/5 border-sky-500/40" 
                : "bg-rose-500/5 border-rose-500/40"
            }`}>
              {/* Hide plus/minus for fancy */}
              {bet.marketType !== 'fancy' && (
                <button
                  onClick={() => handleOddsChange(Math.max(1.01, Number((odds - 0.01).toFixed(2))))}
                  className="p-1.5 hover:bg-black/10 rounded-l-lg transition-colors"
                >
                  <Minus className="w-3 h-3 text-[color:var(--text)]" />
                </button>
              )}
              <input
                type="number"
                inputMode="decimal"
                aria-label="Your odds"
                value={Number.isFinite(odds) ? (bet.marketType === 'fancy' ? odds.toFixed(0) : odds.toFixed(2)) : ""}
                onChange={(e) => {
                  if (bet.marketType === 'fancy') return; // Read-only for fancy
                  const num = Number(e.target.value);
                  if (!Number.isNaN(num)) handleOddsChange(num);
                }}
                readOnly={bet.marketType === 'fancy'}
                className={`flex-1 min-w-0 px-1 py-1.5 bg-transparent text-xs font-black tabular-nums text-center focus:outline-none appearance-none [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${primaryColorClass} ${bet.marketType === 'fancy' ? 'cursor-default' : ''}`}
              />
              {/* Hide plus/minus for fancy */}
              {bet.marketType !== 'fancy' && (
                <button
                  onClick={() => handleOddsChange(Number((odds + 0.01).toFixed(2)))}
                  className="p-1.5 hover:bg-black/10 rounded-r-lg transition-colors"
                >
                  <Plus className="w-3 h-3 text-[color:var(--text)]" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1">
            <label className="text-[9px] font-bold uppercase text-[color:var(--subtle)] block text-center mb-1">
              Stake
            </label>
            <div className="flex items-center bg-[color:var(--surface-2)] rounded-lg border border-[color:var(--border)]/50">
              <span className="pl-2 text-xs text-[color:var(--subtle)]">{getCurrencySymbol()}</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label="Stake"
                placeholder="0"
                value={stake}
                onChange={(e) => handleStakeChange(e.target.value)}
                className="flex-1 min-w-0 px-1 py-1.5 bg-transparent text-xs font-black text-[color:var(--text)] placeholder:text-[color:var(--subtle)] text-center focus:outline-none tabular-nums"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {QUICK_STAKES.map((amount) => (
            <button
              key={amount}
              onClick={() => handleQuickStake(amount)}
              className="py-1.5 rounded-lg text-[10px] font-bold bg-[var(--brand-primary)]/15 text-[var(--brand-primary)] border border-[var(--brand-primary)]/40 hover:bg-[var(--brand-primary)]/25 active:bg-[var(--brand-primary)]/35 transition-colors"
            >
              +{amount >= 1000 ? `${amount / 1000}k` : amount}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 border-t border-[color:var(--border)]/30 bg-[color:var(--surface-2)]/30 flex items-center justify-end gap-2">
        <button
          onClick={handleClose}
          className="px-2 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleClear}
          className="px-2 py-1.5 rounded-lg text-xs font-bold bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/20 border border-[var(--brand-primary)]/30 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={handlePlaceBet}
          disabled={!stake || parseFloat(stake) <= 0 || isLoading}
          className={`px-6 py-1.5 rounded-lg text-xs font-black text-white flex items-center gap-1.5 transition-all ${
            !stake || parseFloat(stake) <= 0 || isLoading
              ? "bg-[color:var(--surface-3)] text-[color:var(--subtle)] cursor-not-allowed"
              : bet.isCashout
              ? "bg-gradient-to-r from-emerald-500 to-emerald-600 hover:opacity-90 active:scale-[0.98]"
              : isBack
              ? "bg-gradient-to-r from-sky-500 to-sky-600 hover:opacity-90 active:scale-[0.98]"
              : "bg-gradient-to-r from-rose-500 to-rose-600 hover:opacity-90 active:scale-[0.98]"
          }`}
        >
          <Coins className="w-3.5 h-3.5" />
          {bet.isCashout ? "Cashout" : isBack ? "Back" : "Lay"} {bet.isCashout ? "" : "Bet"}
        </button>
      </div>

    </div>
  );
}
