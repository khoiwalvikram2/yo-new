import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Coins, Plus, Minus, Loader2 } from "lucide-react";
import type { BetSlipData, EventDetails } from "./types";
import { useBetSlip } from "../sports/BetSlipProvider";
import { placeSportsBet, placeFancyBet } from "@/lib/api/user";
import { notify } from "@/lib/notify";
import { useAuth } from "@/lib/auth";
import { formatAmount } from "@/lib/currency";
import { useOddsSocket } from "@/lib/hooks/useOddsSocket";
import { getFancyLiveSnapshot } from "./fancySocketOdds";

interface InlineBetSlipProps {
  bet: BetSlipData;
  event?: EventDetails;
}

export default function InlineBetSlip({ bet, event }: InlineBetSlipProps) {
  const { closeQuickBet, updateQuickBet } = useBetSlip();
  const { isAuthenticated, openAuthModal, refreshUser } = useAuth();

  // Use ref to track the last bet key to prevent unnecessary resets
  const lastBetKeyRef = useRef<string>("");
  const currentBetKey = `${bet.team}-${bet.market}-${bet.type}`;

  // State management
  const [stake, setStake] = useState(() =>
    bet.stake ? String(bet.stake) : ""
  );
  const [odds, setOdds] = useState<number>(Number(bet.odds) || 0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const inFlightRef = useRef<boolean>(false);

  const marketCodes = useMemo(() => {
    if (!bet?.marketCode) return [];
    if (bet.marketType === "fancy" && event?.eventCode) {
      return [`fancy-${event.eventCode}`];
    }
    return [String(bet.marketCode)];
  }, [bet?.marketCode, bet?.marketType, event?.eventCode]);

  const oddsSocketData = useOddsSocket(
    marketCodes,
    event?.eventCode ? { eventId: String(event.eventCode) } : undefined
  );

  const getCurrentFancyStatus = useCallback(() => {
    if (bet.marketType !== "fancy") return bet.fancyStatus;
    const snap = getFancyLiveSnapshot(oddsSocketData as Record<string, unknown> | undefined, bet, event?.eventCode);
    return snap?.fancyStatus ?? bet.fancyStatus;
  }, [bet, oddsSocketData, event?.eventCode]);

  const extractFancyLive = useCallback(() => {
    if (bet.marketType !== "fancy" || !event?.eventCode) return null;
    return getFancyLiveSnapshot(oddsSocketData as Record<string, unknown> | undefined, bet, event.eventCode);
  }, [bet, oddsSocketData, event?.eventCode]);

  const normalizeOdds = (val: number) => {
    if (!Number.isFinite(val)) return 0;
    // round to 2 decimals to avoid float drift (server compares to 2dp)
    return parseFloat(Number(val).toFixed(2));
  };

  // Sync odds when selection changes, but DO NOT reset stake
  useEffect(() => {
    if (lastBetKeyRef.current !== currentBetKey) {
      lastBetKeyRef.current = currentBetKey;
      setOdds(normalizeOdds(Number(bet.odds) || 0));
      // Initialize stake from provider if present
      if (typeof bet.stake === "number" && !Number.isNaN(bet.stake)) {
        setStake(String(bet.stake));
      }
    }
  }, [currentBetKey, bet.odds, bet.stake]);

  // Fancy: sync odds and oddsSize from socket
  useEffect(() => {
    if (bet.marketType !== "fancy" || !event?.eventCode) return;
    const lo = extractFancyLive();
    if (!lo) return;
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
    bet.marketType,
    bet.type,
    bet.oddsSize,
    bet.odds_size,
    event?.eventCode,
    oddsSocketData,
    odds,
    extractFancyLive,
    updateQuickBet,
    bet.team,
    bet.selectionId,
  ]);

  // Constants
  const quickStakeAmounts = [100, 500, 1000, 5000, 10000];

  // Event handlers
  const handleOddsChange = useCallback(
    (newOdds: number) => {
      setOdds(normalizeOdds(newOdds));
      updateQuickBet({ odds: newOdds });
    },
    [updateQuickBet]
  );

  const handleStakeChange = useCallback(
    (newStake: string) => {
      setStake(newStake);
      const numeric = parseFloat(newStake) || 0;
      updateQuickBet({ stake: numeric });
    },
    [updateQuickBet]
  );

  const handleStakeIncrement = useCallback(
    (amount: number) => {
      const current = parseFloat(stake) || 0;
      const next = Math.max(0, current + amount);
      setStake(String(next));
      updateQuickBet({ stake: next });
    },
    [stake, updateQuickBet]
  );

  const handleStakeDecrement = useCallback(
    (amount: number) => {
      const current = parseFloat(stake) || 0;
      const next = Math.max(0, current - amount);
      setStake(String(next));
      updateQuickBet({ stake: next });
    },
    [stake, updateQuickBet]
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

  const handleMaxStake = useCallback(() => {
    // Set max stake based on user's available balance (you can customize this)
    const maxAmount = 50000; // Example max stake
    setStake(String(maxAmount));
    updateQuickBet({ stake: maxAmount });
  }, [updateQuickBet]);


  const handlePlaceBet = useCallback(async () => {
    // Check authentication first
    if (!isAuthenticated) {
      openAuthModal("login");
      return;
    }

    if (!event) {
      notify.error("Event information not available");
      return;
    }

    if (bet.marketType === "fancy") {
      const currentStatus = getCurrentFancyStatus();
      if (currentStatus === "SUSPENDED" || currentStatus === "Ball Running") {
        notify.error("This market is currently suspended");
        return;
      }
    }

    const stakeAmount = parseFloat(stake);
    if (!stakeAmount || stakeAmount <= 0) {
      notify.error("Please enter a valid stake amount");
      return;
    }

    if (!odds || (bet.marketType === "fancy" ? odds <= 0 : odds <= 1)) {
      notify.error("Please enter valid odds");
      return;
    }

    try {
      const submitOdds = normalizeOdds(odds);
      
      // Check if this is a fancy bet
      const isFancyBet = bet.marketType === 'fancy';
      
      let payload: any;
      
      if (isFancyBet) {
        // Fancy bet data
        
        // Fancy bet payload structure
        payload = {
          stake: Math.abs(stakeAmount),
          selectionType: bet.type,
          odds: submitOdds.toString(),
          selection: bet.team,
          marketType: "fancy",
          marketId: bet.marketId || null,
          marketCode: bet.marketCode || "",
          selectionId: bet.selectionId || "",
          odds_size: bet.oddsSize ?? bet.odds_size ?? 100,
          eventId: event.eventId || event.id,
          leagueId: event.leagueId,
          sportId: event.sportId,
        };
        
        // Validate fancy bet required fields
        if (!payload.eventId) {
          notify.error("Event ID is missing");
          return;
        }
        if (!payload.sportId) {
          notify.error("Sport ID is missing");
          return;
        }
        if (!payload.leagueId) {
          notify.error("League ID is missing");
          return;
        }
        if (!payload.marketCode) {
          notify.error("Market Code is missing for fancy bet");
          return;
        }
        if (!payload.selectionId) {
          notify.error("Selection ID is missing for fancy bet");
          return;
        }
      } else {
        // Regular sports bet payload structure
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

        // Validate regular bet required fields
        if (!payload.eventId) {
          notify.error("Event ID is missing");
          return;
        }
        if (!payload.sportId) {
          notify.error("Sport ID is missing");
          return;
        }
        if (!payload.leagueId) {
          notify.error("League ID is missing");
          return;
        }
        if (!payload.marketId) {
          notify.error("Market ID is missing");
          return;
        }
        if (payload.selectionId === undefined || payload.selectionId === null) {
          notify.error("Selection ID is missing");
          return;
        }
      }

      if (import.meta.env.DEV)
        // debug removed

      // Guard against rapid/double submits
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;

      const doPlace = async () => {
      setIsLoading(true);

        try {
          const resp = isFancyBet ? await placeFancyBet(payload) : await placeSportsBet(payload);
          if (resp?.meta?.code === 200) return resp;
          const msg = resp?.meta?.message || "Failed to place bet";
          throw new Error(msg);
        } catch (error: any) {
          // Normalize error messages similar to earlier logic
          if (
            error?.code === "ECONNABORTED" ||
            error?.message?.includes("timeout")
          ) {
            throw new Error(
              "Request timed out. Please check your connection and try again."
            );
          }
          const status = error?.response?.status;
          if (status === 401) {
            throw new Error("Please login to place bets");
          }
          if (status === 403) {
            const msg = String(
              error?.response?.data?.message || ""
            ).toLowerCase();
            if (msg.includes("odds") && msg.includes("changed")) {
              throw new Error(
                `Odds changed from your selection. Please confirm at ${odds.toFixed(
                  2
                )}`
              );
            }
            throw new Error("Insufficient balance or betting not allowed");
          }
          const serverMsg = error?.response?.data?.message;
          throw new Error(
            serverMsg ||
              error?.message ||
              "Failed to place bet. Please try again."
          );
        }
      };

      try {
        const response = await doPlace();
        // optional debug removed in production

        notify.success("Bet Placed Successfully!");

        // Close bet slip after success - loader will be hidden when bet slip closes
        if ((response as any)?.meta?.code === 200) {
          try {
            const exposureFromServer = Number((response as any)?.data?.exposure)
            if (!Number.isNaN(exposureFromServer)) {
              try { (window as any).dispatchEvent?.(new CustomEvent('stakex:exposure:update', { detail: { exposure: exposureFromServer } })) } catch (_) {}
            }
          } catch (_) {}
          // Immediately push to local my-bets store for UI feedback
          try {
            const raw = localStorage.getItem('stakex:my-bets')
            const arr = raw ? JSON.parse(raw) : []
            arr.unshift({
              id: String(Date.now()),
              selection: bet.team,
              odds: submitOdds,
              stake: Math.abs(stakeAmount),
              type: bet.type,
              pl: undefined,
              market: bet.market,
              marketId: bet.marketId,
              eventId: event?.eventId || event?.id,
            })
            localStorage.setItem('stakex:my-bets', JSON.stringify(arr.slice(0, 50)))
            window.dispatchEvent(new CustomEvent('stakex:my-bets:update'))
          } catch (_) {}

          refreshUser();
          
          closeQuickBet();
          setIsLoading(false);

        } else {
          // If bet failed, hide loader immediately
          inFlightRef.current = false;
        }
      } catch (err: any) {
        // Bet place error
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
          // Show error toast and hide loader
          notify.error(err?.message || "Failed to place bet");
        }
        setIsLoading(false);
        inFlightRef.current = false;
      }
    } catch (_) {
      // Fallback to ensure loader isn't stuck on unexpected errors
      setIsLoading(false);
      inFlightRef.current = false;
    }
  }, [bet, event, stake, odds, closeQuickBet, isAuthenticated, openAuthModal, refreshUser, getCurrentFancyStatus]);

  const handleClose = useCallback(() => {
    setIsLoading(false);
    closeQuickBet();
  }, [closeQuickBet]);

  const handleClear = useCallback(() => {
    setStake("");
    setOdds(Number(bet.odds) || 0);
    updateQuickBet({ stake: 0 });
  }, [bet.odds, updateQuickBet]);

  // Reset loading state when bet slip is closed
  useEffect(() => {
    if (!bet) {
      setIsLoading(false);
    }
  }, [bet]);

  // Calculate potential winnings
  const calculateWinnings = () => {
    const stakeAmount = parseFloat(stake) || 0;
    if (stakeAmount <= 0 || !Number.isFinite(odds) || odds <= 1) return 0;
    if (bet.type === "back") {
      // Back profit
      return stakeAmount * (odds - 1);
    }
    // Lay shows liability as negative P&L
    return -stakeAmount * (odds - 1);
  };

  return (
    <div className="relative bg-[color:var(--surface)] border border-[color:var(--border)]/40 rounded-lg w-full shadow-lg mt-2 overflow-hidden">
      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[color:var(--surface)]/95 border border-[color:var(--border)]/50 shadow-xl">
            <div className="relative">
              <Loader2 className="h-7 w-7 animate-spin text-[color:var(--brand-primary)]" />
              <div className="absolute inset-0 h-7 w-7 animate-ping opacity-20 rounded-[5px] bg-[color:var(--brand-primary)]"></div>
            </div>
            <div className="text-xs font-bold text-[color:var(--text)]">
              Placing Bet...
            </div>
          </div>
        </div>
      )}
      <div>
        {/* Header */}
        <div
          className={`px-2.5 py-2 border-b border-[color:var(--border)]/30 ${
            bet.type === "back"
              ? "bg-sky-500/10"
              : "bg-rose-500/10"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-[9px] font-black tracking-wide ${
                  bet.type === "back"
                    ? "bg-sky-500 text-white"
                    : "bg-rose-500 text-white"
                }`}
              >
                {bet.type === "back" ? "BACK" : "LAY"}
              </span>
              <p className="text-xs font-bold text-[color:var(--text)] truncate">
                {bet.team}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* P&L Row */}
          <div className="flex items-center justify-end gap-2 px-1">
            <span className="text-[9px] font-bold uppercase text-[color:var(--subtle)]">
              P&L
            </span>
            {(() => {
              const pnl = calculateWinnings();
              const formatted = formatAmount(Math.abs(pnl));
              return (
                <div
                  className={`px-2.5 py-1 rounded-lg border text-center ${
                    pnl >= 0
                      ? "bg-sky-500/10 border-sky-500/40 text-sky-600 dark:text-sky-400"
                      : "bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400"
                  } text-xs font-black tabular-nums`}
                >
                  {pnl < 0 ? `-${formatted}` : formatted}
                </div>
              );
            })()}
          </div>

          {/* Odds and Stake Row */}
          <div className="flex items-end justify-end gap-1.5">
            {/* Odds */}
            <div className="flex-col space-y-1 min-w-0 w-[120px]">
              <label className="text-[9px] font-bold uppercase text-[color:var(--subtle)] block text-center">
                Odds
              </label>
              <div
                className={`flex items-center rounded-lg border ${
                  bet.type === "back"
                    ? "bg-sky-500/10 border-sky-500/40"
                    : "bg-rose-500/10 border-rose-500/40"
                }`}
              >
                <button
                  onClick={() =>
                    handleOddsChange(
                      Math.max(1.01, Number((odds - 0.01).toFixed(2)))
                    )
                  }
                  className="p-1 hover:bg-black/10 rounded-l-lg transition-colors active:scale-95"
                  aria-label="Decrease odds"
                >
                  <Minus className="h-3 w-3 text-[color:var(--text)]" />
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  value={Number.isFinite(odds) ? odds.toFixed(2) : ""}
                  onChange={(e) => {
                    const numValue = Number(e.target.value);
                    if (!Number.isNaN(numValue)) handleOddsChange(numValue);
                  }}
                  className={`flex-1 min-w-0 px-0.5 py-1.5 bg-transparent text-xs font-black tabular-nums text-center focus:outline-none appearance-none [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                    bet.type === "back"
                      ? "text-sky-600 dark:text-sky-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                />
                <button
                  onClick={() =>
                    handleOddsChange(Number((odds + 0.01).toFixed(2)))
                  }
                  className="p-1 hover:bg-black/10 rounded-r-lg transition-colors active:scale-95"
                  aria-label="Increase odds"
                >
                  <Plus className="h-3 w-3 text-[color:var(--text)]" />
                </button>
              </div>
            </div>

            {/* Stake */}
            <div className="flex-col space-y-1 min-w-0 w-[140px]">
              <label className="text-[9px] font-bold uppercase text-[color:var(--subtle)] block text-center">
                Stake
              </label>
              <div className="flex items-center bg-[color:var(--surface-2)] rounded-lg border border-[color:var(--border)]/50">
                <button
                  onClick={() => handleStakeDecrement(100)}
                  className="p-1 hover:bg-[color:var(--surface-3)] transition-colors rounded-l-lg active:scale-95"
                  aria-label="Decrease stake"
                >
                  <Minus className="h-3 w-3 text-[color:var(--text)]" />
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={stake}
                  onChange={(e) =>
                    handleStakeChange(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                  className="flex-1 min-w-0 bg-transparent text-xs font-black text-[color:var(--text)] placeholder:text-[color:var(--subtle)] text-center focus:outline-none tabular-nums py-1.5 appearance-none [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={() => handleStakeIncrement(100)}
                  className="p-1 hover:bg-[color:var(--surface-3)] transition-colors rounded-r-lg active:scale-95"
                  aria-label="Increase stake"
                >
                  <Plus className="h-3 w-3 text-[color:var(--text)]" />
                </button>
              </div>
            </div>
          </div>

          {/* Quick stakes */}
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase text-[color:var(--subtle)] block text-center">
              Quick Stakes
            </label>
            <div className="flex flex-wrap justify-end gap-1.5">
            {quickStakeAmounts.map((amount) => (
              <button
                key={amount}
                onClick={() => handleQuickStake(amount)}
                  className="px-3 py-1.5 rounded-md text-[11px] font-bold transition-all hover:scale-105 active:scale-95 bg-gradient-to-br from-[color:var(--surface-2)] to-[color:var(--surface-3)] text-[color:var(--text)] hover:from-[color:var(--brand-primary)]/20 hover:to-[color:var(--brand-primary)]/10 hover:text-[color:var(--brand-primary)] border border-[color:var(--border)]/40 hover:border-[color:var(--brand-primary)]/50 hover:shadow-md text-center"
              >
                  +{amount >= 1000 ? `${amount / 1000}K` : amount}
                </button>
              ))}
              <button
                onClick={handleMaxStake}
                className="px-3 py-1.5 rounded-md text-[11px] font-black transition-all hover:scale-105 active:scale-95 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-emerald-600 dark:text-emerald-400 hover:from-emerald-500/30 hover:to-emerald-600/20 border border-emerald-500/40 hover:border-emerald-500/60 hover:shadow-md text-center uppercase"
              >
                MAX
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[color:var(--border)]/30 bg-[color:var(--surface-2)]/30">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleClose}
              className="px-2 py-1.5 rounded-lg text-xs font-bold transition-colors bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 active:scale-95"
              aria-label="Cancel bet"
            >
              Cancel
            </button>
            <button
              onClick={handleClear}
              className="px-2 py-1.5 rounded-lg text-xs font-bold transition-colors bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/50 active:scale-95"
              aria-label="Clear bet"
            >
              Clear
            </button>
            <button
              onClick={handlePlaceBet}
              disabled={!stake || parseFloat(stake) <= 0 || isLoading}
              className={`px-10 py-1.5 rounded-lg text-xs font-black transition-colors text-white flex items-center justify-center gap-1.5 shadow-md ${
                !stake || parseFloat(stake) <= 0 || isLoading
                  ? "bg-[color:var(--surface-3)] text-[color:var(--subtle)] cursor-not-allowed border border-[color:var(--border)]/30"
                  : bet.type === "back"
                  ? "bg-gradient-to-r from-sky-500 to-sky-500/80 hover:from-sky-500/90 hover:to-sky-500/70 active:scale-[0.98]"
                  : "bg-gradient-to-r from-rose-500 to-rose-500/80 hover:from-rose-500/90 hover:to-rose-500/70 active:scale-[0.98]"
              }`}
              aria-label="Place bet"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Coins className="h-3.5 w-3.5" />
              )}
              {bet.type === "back" ? "Back" : "Lay"} Bet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
