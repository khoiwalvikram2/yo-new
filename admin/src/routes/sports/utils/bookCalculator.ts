export interface BookEntry {
  userId: string;
  userName: string;
  userFlags?: any;
  grossProfit: number;
  grossLoss: number;
  netPL: number;
  agentId?: string;
  agentName?: string;
  agentCut: number;
  agentScheme?: 'COMMISSION' | 'SHARING' | 'CREDIT';
  agentRate: number;
}

export interface AgentBookEntry {
  agentId: string;
  agentName: string;
  grossPL: number; // Total player P&L
  netPL: number;   // After agent cut
  agentCut: number;
  playerCount: number;
  schemeType: 'COMMISSION' | 'SHARING' | 'CREDIT';
  rate: number;
}

export interface SelectionBook {
  selectionId: string;
  selectionName: string;
  playerEntries: BookEntry[];
  agentEntries: Map<string, AgentBookEntry>;
  totals: {
    playerGrossProfit: number;
    playerGrossLoss: number;
    playerNetPL: number;
    platformPL: number;
    totalAgentCut: number;
  };
}

/** When provided (agent view), books show only direct-child agents with rolled-up P&L. */
export interface BookViewContext {
  directChildAgentIds: string[];
  getDescendantsOf: (agentId: string) => string[];
  getAgentInfo?: (agentId: string) => { username: string | null; schemeType: string; rate: number | null } | null;
}

/**
 * Calculate book (P&L) for a specific selection if it wins
 * @param selectionId - The selection ID to calculate book for
 * @param selectionName - Display name of the selection
 * @param allBets - All bets for the event/market
 * @param marketId - Market ID to filter bets
 * @param marketType - Type of market (fancy, match-odds, etc.)
 * @param usersMap - Map of userId -> user name (optional, for display)
 * @param viewContext - When provided (agent view), agentEntries are only direct-child agents with rolled-up P&L
 * @returns SelectionBook with player and agent breakdowns
 */
export function calculateSelectionBook(
  selectionId: string,
  selectionName: string,
  allBets: any[],
  marketId: string,
  marketType: string = 'exchange',
  usersMap?: Record<string, string>,
  viewContext?: BookViewContext | null
): SelectionBook {
  // Normalize selection name for matching (fallback to name-based matching)
  const normalizedSelectionName = (selectionName || '').trim();
  // Filter bets for this market only; only matched bets affect the book
  const relevantBets = allBets.filter(bet => 
    String(bet.marketId) === String(marketId) &&
    String(bet.status || '').toLowerCase() === 'matched'
  );
  
  // Group by user
  const userBets = new Map<string, any[]>();
  relevantBets.forEach(bet => {
    if (bet && bet.userId) {
      const key = String(bet.userId);
      if (!userBets.has(key)) {
        userBets.set(key, []);
      }
      userBets.get(key)!.push(bet);
    }
  });
  
  // Calculate per-user P&L
  const playerEntries: BookEntry[] = [];
  const agentMap = new Map<string, AgentBookEntry>();
  
  for (const [userId, bets] of userBets) {
    // Calculate if THIS selection wins
    let grossProfit = 0;
    let grossLoss = 0;
    
    bets.forEach(bet => {
      // Match by multiple methods (same as user side):
      // 1. runnerId (uuid)
      // 2. selectionId/selectionCode (varchar code like '5728193')
      // 3. selection/team name (fallback, like user side)
      const betSelectionId = String(bet.selectionId || '').trim();
      const betRunnerId = String(bet.runnerId || '').trim();
      const betSelection = String(bet.selection || bet.team || '').trim();
      const matchSelectionId = String(selectionId || '').trim();
      
      // Check if this bet is for the current selection
      // Priority: runnerId match (most reliable), then selectionId/selectionCode, then name
      const isBetOnThisSelection = 
        (betRunnerId && betRunnerId === matchSelectionId) ||
        (betSelectionId && betSelectionId === matchSelectionId) ||
        (betSelection && normalizedSelectionName && betSelection === normalizedSelectionName);
      
      if (isBetOnThisSelection) {
        // Bet ON this selection
        const stake = Number(bet.stake || 0);
        const odds = Number(bet.price || 0);
        
        if (bet.side === 'back') {
          // BACK bet wins: profit = stake * (odds - 1)
          if (stake > 0 && Number.isFinite(odds) && odds > 1) {
            grossProfit += stake * (odds - 1);
          }
        } else {
          // LAY bet loses: loss = stake * (odds - 1) (same as user side)
          if (stake > 0 && Number.isFinite(odds) && odds > 1) {
            grossLoss += stake * (odds - 1);
          }
        }
      } else {
        // Bet on OTHER selections (these lose if THIS wins)
        const stake = Number(bet.stake || 0);
        
        if (bet.side === 'back') {
          // BACK bet loses: loss = stake
          if (stake > 0) {
            grossLoss += stake;
          }
        } else {
          // LAY bet wins: profit = stake (for regular) or stake * (oddsSize/100) for fancy
          if (stake > 0) {
            if (marketType === 'fancy' && bet.oddsSize) {
              // Fancy lay: profit = stake * (oddsSize / 100)
              grossProfit += stake * (Number(bet.oddsSize) / 100);
            } else {
              // Regular lay: profit = stake
              grossProfit += stake;
            }
          }
        }
      }
    });
    
    const netPL = grossProfit - grossLoss;
    const agentInfo = bets[0]?.agentInfo;
    
    // Calculate agent cut
    let agentCut = 0;
    if (agentInfo) {
      const platformPL = -netPL; // Platform wins when player loses
      
      if (agentInfo.schemeType === 'COMMISSION') {
        // Commission only on platform wins (loss-only model)
        agentCut = platformPL > 0 ? platformPL * (agentInfo.rate / 100) : 0;
      } else if (agentInfo.schemeType === 'SHARING' || agentInfo.schemeType === 'CREDIT') {
        // Share of total P&L (absolute value)
        agentCut = Math.abs(platformPL) * (agentInfo.rate / 100);
      }
    }
    
    const userName = usersMap?.[userId] || bets[0]?.userName || `User ${userId}`;
    const userFlags = bets[0]?.userFlags || null;
    
    playerEntries.push({
      userId,
      userName,
      userFlags,
      grossProfit,
      grossLoss,
      netPL,
      agentId: agentInfo?.agentId,
      agentName: agentInfo?.agentName,
      agentCut,
      agentScheme: agentInfo?.schemeType,
      agentRate: agentInfo?.rate || 0
    });
    
    // Aggregate by agent
    if (agentInfo?.agentId) {
      if (!agentMap.has(agentInfo.agentId)) {
        agentMap.set(agentInfo.agentId, {
          agentId: agentInfo.agentId,
          agentName: agentInfo.agentName,
          grossPL: 0,
          netPL: 0,
          agentCut: 0,
          playerCount: 0,
          schemeType: agentInfo.schemeType,
          rate: agentInfo.rate
        });
      }
      const agentEntry = agentMap.get(agentInfo.agentId)!;
      agentEntry.grossPL += netPL;
      agentEntry.agentCut += agentCut;
      agentEntry.playerCount++;
      // Net PL for agent = gross PL - agent cut
      agentEntry.netPL = agentEntry.grossPL - agentEntry.agentCut;
    }
  }
  
  // When viewContext is provided, replace agentMap with direct-child-only entries and roll up P&L
  let finalAgentMap = agentMap;
  if (viewContext?.directChildAgentIds?.length) {
    const rolled = new Map<string, AgentBookEntry>();
    for (const D of viewContext.directChildAgentIds) {
      const descendantIds = new Set(viewContext.getDescendantsOf(D));
      let grossPL = 0;
      let agentCutSum = 0;
      let playerCount = 0;
      let fallbackAgentName = '';
      let fallbackSchemeType: AgentBookEntry['schemeType'] = 'COMMISSION';
      let fallbackRate = 0;
      for (const entry of playerEntries) {
        if (entry.agentId && descendantIds.has(entry.agentId)) {
          grossPL += entry.netPL;
          agentCutSum += entry.agentCut;
          playerCount++;
          if (!fallbackAgentName && entry.agentName) {
            fallbackAgentName = entry.agentName;
            fallbackSchemeType = entry.agentScheme ?? 'COMMISSION';
            fallbackRate = entry.agentRate ?? 0;
          }
        }
      }
      // Get agent info from viewContext (has correct name for rolled-up agents)
      const viewAgentInfo = viewContext.getAgentInfo?.(D);
      const existing = agentMap.get(D);
      rolled.set(D, {
        agentId: D,
        agentName: viewAgentInfo?.username || existing?.agentName || fallbackAgentName || `Agent ${D}`,
        grossPL,
        netPL: grossPL - agentCutSum,
        agentCut: agentCutSum,
        playerCount,
        schemeType: (viewAgentInfo?.schemeType as AgentBookEntry['schemeType']) || existing?.schemeType || fallbackSchemeType,
        rate: viewAgentInfo?.rate ?? existing?.rate ?? fallbackRate,
      });
    }
    finalAgentMap = rolled;
  }

  // Calculate totals
  const totals = {
    playerGrossProfit: playerEntries.reduce((sum, e) => sum + e.grossProfit, 0),
    playerGrossLoss: playerEntries.reduce((sum, e) => sum + e.grossLoss, 0),
    playerNetPL: playerEntries.reduce((sum, e) => sum + e.netPL, 0),
    platformPL: -playerEntries.reduce((sum, e) => sum + e.netPL, 0),
    totalAgentCut: playerEntries.reduce((sum, e) => sum + e.agentCut, 0)
  };

  return {
    selectionId,
    selectionName,
    playerEntries,
    agentEntries: finalAgentMap,
    totals
  };
}

