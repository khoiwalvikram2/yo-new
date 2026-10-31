/**
 * Fancy Book Calculator
 * Calculates profit/loss for each possible result position in a fancy market
 * Based on the logic from user-facing app
 */

export interface FancyBookEntry {
  position: number;
  pnl: number;
}

export interface FancyBookStatistics {
  totalBackStake: number;
  totalLayStake: number;
  totalBets: number;
  backBets: number;
  layBets: number;
  totalStake: number;
}

export interface FancyBookData {
  entries: FancyBookEntry[];
  statistics: FancyBookStatistics;
  bestPosition: FancyBookEntry | null;
  worstPosition: FancyBookEntry | null;
}

export interface FancyBookPlayerEntry {
  userId: string;
  userName: string;
  position: number;
  pnl: number;
  bets: Array<{
    id: string;
    side: 'back' | 'lay';
    odds: number;
    stake: number;
    oddsSize: number;
  }>;
}

export interface FancyBookPlayerBreakdown {
  userId: string;
  userName: string;
  userFlags?: any;
  entries: FancyBookPlayerEntry[];
  totalPnl: number;
  agentId?: string;
  agentName?: string;
  agentScheme?: 'COMMISSION' | 'SHARING' | 'CREDIT';
  agentRate?: number;
}

/**
 * Calculate fancy book (P/L for each position) for a specific fancy selection
 * @param bets - All bets for the event/market
 * @param marketId - Market ID to filter bets (can be a single ID or comma-separated IDs)
 * @param selectionId - Optional: specific selection ID to filter bets
 * @param selectionName - Optional: specific selection name to filter bets
 * @returns FancyBookData with entries, statistics, and best/worst positions
 */
export function calculateFancyBook(
  bets: any[],
  marketId: string,
  selectionId?: string,
  selectionName?: string
): FancyBookData {
  // Handle multiple market IDs (for merged fancy markets)
  const marketIds = marketId.includes(',') ? marketId.split(',') : [marketId];
  
  // Filter bets for this fancy market and optionally specific selection
  const relevantBets = bets.filter((bet) => {
    // Must match one of the market IDs
    const betMarketId = String(bet.marketId);
    if (!marketIds.some((mid) => String(mid) === betMarketId)) {
      return false;
    }

    // If selection filter provided, match by selectionId or selection name
    if (selectionId || selectionName) {
      const betSelectionId = String(bet.selectionId || '').trim();
      // Note: 'selection' field may not be in GraphQL response, use selectionId primarily
      const betSelection = String(bet.selection || bet.selectionName || '').trim();
      const matchSelectionId = selectionId ? String(selectionId).trim() : '';
      const matchSelectionName = selectionName ? String(selectionName).trim() : '';

      const matchesId = matchSelectionId && betSelectionId === matchSelectionId;
      const matchesName = matchSelectionName && betSelection && betSelection === matchSelectionName;

      if (!matchesId && !matchesName) {
        return false;
      }
    }

    // Only matched bets affect the book
    const status = String(bet.status || '').toLowerCase();
    return status === 'matched';
  });

  if (relevantBets.length === 0) {
    return {
      entries: [],
      statistics: {
        totalBackStake: 0,
        totalLayStake: 0,
        totalBets: 0,
        backBets: 0,
        layBets: 0,
        totalStake: 0,
      },
      bestPosition: null,
      worstPosition: null,
    };
  }

  // Calculate statistics
  const statistics: FancyBookStatistics = {
    totalBackStake: 0,
    totalLayStake: 0,
    totalBets: relevantBets.length,
    backBets: 0,
    layBets: 0,
    totalStake: 0,
  };

  relevantBets.forEach((bet) => {
    const stake = Number(bet.stake || 0);
    const liability = Number(bet.liability ?? bet.stake ?? 0);
    const side = String(bet.side || '').toLowerCase() as 'back' | 'lay';

    if (side === 'back') {
      statistics.totalBackStake += stake;
      statistics.backBets++;
    } else if (side === 'lay') {
      statistics.totalLayStake += liability;
      statistics.layBets++;
    }

    statistics.totalStake += liability;
  });

  // Find min and max odds from all bets
  const allOdds = relevantBets
    .map((b) => Number(b.price || b.odds || 0))
    .filter((o) => o > 0 && Number.isFinite(o));

  if (allOdds.length === 0) {
    return {
      entries: [],
      statistics,
      bestPosition: null,
      worstPosition: null,
    };
  }

  const minOdd = Math.min(...allOdds);
  const maxOdd = Math.max(...allOdds);

  // Create range (min - 5 to max + 5)
  // Safety check: ensure range is reasonable (max 200 positions to prevent performance issues)
  const rangeStart = Math.max(1, Math.floor(minOdd) - 5);
  const rangeEnd = Math.max(rangeStart, Math.min(Math.floor(maxOdd) + 5, rangeStart + 200)); // Ensure rangeEnd >= rangeStart, limit to 200 positions max
  const positions: number[] = [];

  for (let i = rangeStart; i <= rangeEnd; i++) {
    positions.push(i);
  }

  // Calculate P/L for each position
  const bookEntries: FancyBookEntry[] = positions.map((position) => {
    let netPnl = 0;

    relevantBets.forEach((bet) => {
      const oddsSize = Number(bet.oddsSize || 100);
      // Ensure oddsSize is valid (between 0 and 1000, default to 100)
      const validOddsSize = (oddsSize > 0 && oddsSize <= 1000) ? oddsSize : 100;
      const oddsSizePercent = validOddsSize / 100;
      const stake = Number(bet.stake || 0);
      const odds = Number(bet.price || bet.odds || 0);
      const side = String(bet.side || '').toLowerCase() as 'back' | 'lay';

      // Skip invalid bets
      if (stake <= 0 || odds <= 0 || !Number.isFinite(stake) || !Number.isFinite(odds)) {
        return;
      }

      if (side === 'back') {
        // BACK bet
        if (position >= odds) {
          // Result >= Odds → WIN → Profit = Stake × (OddsSize/100)
          netPnl += stake * oddsSizePercent;
        } else {
          // Result < Odds → LOSS → Loss = Stake
          netPnl -= stake;
        }
      } else if (side === 'lay') {
        // LAY bet
        if (position < odds) {
          // Result < Odds → WIN → Profit = Stake
          netPnl += stake;
        } else {
          // Result >= Odds → LOSS → Loss = Stake × (OddsSize/100)
          netPnl -= stake * oddsSizePercent;
        }
      }
    });

    return {
      position,
      pnl: Number.isFinite(netPnl) ? netPnl : 0,
    };
  });

  // Find best and worst positions
  const bestPosition =
    bookEntries.length > 0
      ? bookEntries.reduce((best, curr) => (curr.pnl > best.pnl ? curr : best), bookEntries[0])
      : null;

  const worstPosition =
    bookEntries.length > 0
      ? bookEntries.reduce((worst, curr) => (curr.pnl < worst.pnl ? curr : worst), bookEntries[0])
      : null;

  return {
    entries: bookEntries,
    statistics,
    bestPosition,
    worstPosition,
  };
}

/**
 * Calculate fancy book breakdown by player
 * @param bets - All bets for the event/market
 * @param marketId - Market ID to filter bets (can be a single ID or comma-separated IDs)
 * @param selectionId - Optional: specific selection ID to filter bets
 * @param selectionName - Optional: specific selection name to filter bets
 * @returns Map of userId -> FancyBookPlayerBreakdown
 */
export function calculateFancyBookByPlayer(
  bets: any[],
  marketId: string,
  selectionId?: string,
  selectionName?: string
): Map<string, FancyBookPlayerBreakdown> {
  // Handle multiple market IDs (for merged fancy markets)
  const marketIds = marketId.includes(',') ? marketId.split(',') : [marketId];
  
  // Filter bets (same logic as calculateFancyBook)
  const relevantBets = bets.filter((bet) => {
    // Must match one of the market IDs
    const betMarketId = String(bet.marketId);
    if (!marketIds.some((mid) => String(mid) === betMarketId)) {
      return false;
    }

    if (selectionId || selectionName) {
      const betSelectionId = String(bet.selectionId || '').trim();
      // Note: 'selection' field may not be in GraphQL response, use selectionId primarily
      const betSelection = String(bet.selection || bet.selectionName || '').trim();
      const matchSelectionId = selectionId ? String(selectionId).trim() : '';
      const matchSelectionName = selectionName ? String(selectionName).trim() : '';

      const matchesId = matchSelectionId && betSelectionId === matchSelectionId;
      const matchesName = matchSelectionName && betSelection && betSelection === matchSelectionName;

      if (!matchesId && !matchesName) {
        return false;
      }
    }

    const status = String(bet.status || '').toLowerCase();
    return status === 'matched';
  });

  if (relevantBets.length === 0) {
    return new Map();
  }

  // Find min/max odds for position range
  const allOdds = relevantBets
    .map((b) => Number(b.price || b.odds || 0))
    .filter((o) => o > 0 && Number.isFinite(o));

  if (allOdds.length === 0) {
    return new Map();
  }

  const minOdd = Math.min(...allOdds);
  const maxOdd = Math.max(...allOdds);
  // Safety check: ensure range is reasonable (max 200 positions to prevent performance issues)
  const rangeStart = Math.max(1, Math.floor(minOdd) - 5);
  const rangeEnd = Math.max(rangeStart, Math.min(Math.floor(maxOdd) + 5, rangeStart + 200)); // Ensure rangeEnd >= rangeStart, limit to 200 positions max
  const positions: number[] = [];

  for (let i = rangeStart; i <= rangeEnd; i++) {
    positions.push(i);
  }

  // Group bets by user
  const userBetsMap = new Map<string, any[]>();
  relevantBets.forEach((bet) => {
    const userId = String(bet.userId || '');
    if (!userId) return;

    if (!userBetsMap.has(userId)) {
      userBetsMap.set(userId, []);
    }
    userBetsMap.get(userId)!.push(bet);
  });

  // Calculate per-player book
  const playerBreakdownMap = new Map<string, FancyBookPlayerBreakdown>();

  userBetsMap.forEach((userBets, userId) => {
    const firstBet = userBets[0];
    const userName = firstBet?.userName || `User ${userId}`;
    const userFlags = firstBet?.userFlags || null;
    const agentInfo = firstBet?.agentInfo;

    // Calculate P/L for each position for this player
    const playerEntries: FancyBookPlayerEntry[] = positions.map((position) => {
      let netPnl = 0;
      const playerBets: FancyBookPlayerEntry['bets'] = [];

      userBets.forEach((bet) => {
        const oddsSize = Number(bet.oddsSize || 100);
        // Ensure oddsSize is valid (between 0 and 1000, default to 100)
        const validOddsSize = (oddsSize > 0 && oddsSize <= 1000) ? oddsSize : 100;
        const oddsSizePercent = validOddsSize / 100;
        const stake = Number(bet.stake || 0);
        const odds = Number(bet.price || bet.odds || 0);
        const side = String(bet.side || '').toLowerCase() as 'back' | 'lay';

        // Skip invalid bets
        if (stake <= 0 || odds <= 0 || !Number.isFinite(stake) || !Number.isFinite(odds)) {
          return;
        }

        let betPnl = 0;

        if (side === 'back') {
          if (position >= odds) {
            betPnl = stake * oddsSizePercent;
          } else {
            betPnl = -stake;
          }
        } else if (side === 'lay') {
          if (position < odds) {
            betPnl = stake;
          } else {
            betPnl = -stake * oddsSizePercent;
          }
        }

        netPnl += betPnl;

        playerBets.push({
          id: String(bet.id || ''),
          side,
          odds,
          stake,
          oddsSize: validOddsSize,
        });
      });

      return {
        userId,
        userName,
        position,
        pnl: Number.isFinite(netPnl) ? netPnl : 0,
        bets: playerBets,
      };
    });

    // Calculate total P/L (sum across all positions - this is not meaningful, but included for consistency)
    const totalPnl = playerEntries.reduce((sum, entry) => sum + entry.pnl, 0);

    playerBreakdownMap.set(userId, {
      userId,
      userName,
      userFlags,
      entries: playerEntries,
      totalPnl,
      agentId: agentInfo?.agentId,
      agentName: agentInfo?.agentName,
      agentScheme: agentInfo?.schemeType,
      agentRate: agentInfo?.rate,
    });
  });

  return playerBreakdownMap;
}

