import React, { useId, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Avatar } from '@/ui/components/Avatar';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { SearchField } from '@/ui/components/SearchField';
import { SegmentedControl } from '@/ui/components/SegmentedControl';
import { StatusPill } from '@/ui/components/StatusPill';
import { Tooltip } from '@/ui/components/Tooltip';
import { IconChevronDown, IconInfoCircle } from '@tabler/icons-react';
import type { EventMarket, EventMarketBet, SportsSharingData } from './eventMarketTypes';
import styles from './MarketBook.module.css';
import { useQuery } from '@apollo/client';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useAuthStore } from '@/shared/core/authStore';
import { useUIStore } from '@/shared/core/uiStore';
import { calculateSelectionBook, type BookEntry, type BookViewContext } from '../utils/bookCalculator';
import { calculatePLWithCut } from '../utils/plCalculator';
import { MY_AGENT_SHARING_QUERY } from '@/lib/graphql/agentSharing';
import { MY_WHITELABEL_SHARING_QUERY } from '@/lib/graphql/whitelabel';
import { PlayerFlagIndicator } from './PlayerFlagIndicator';

// Helper to normalize flags from JSONB to string array
const normalizeFlags = (flags: unknown): string[] => {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags;
  if (typeof flags === 'object') {
    // Handle { manual: [...], pattern: [...] } structure
    const allFlags: string[] = [];
    const record = flags as { manual?: unknown; pattern?: unknown };
    if (record.manual && Array.isArray(record.manual)) {
      allFlags.push(...record.manual);
    }
    if (record.pattern && Array.isArray(record.pattern)) {
      allFlags.push(...record.pattern);
    }
    return allFlags;
  }
  return [];
};

interface MarketBookTableProps {
  market: EventMarket;
  bets: EventMarketBet[];
  isExpanded: boolean;
  onToggle: () => void;
  viewContext?: BookViewContext | null;
}

interface TableRowData {
  key: string;
  name: string;
  agentTag: string;
  agentScheme?: string;
  agentRate?: number;
  selections: Array<{
    withoutCut: number;
    withCut: number;
  }>;
  isAgent: boolean;
  playerCount?: number;
  userFlags?: string[];
}

type BookRows = 'all' | 'players' | 'agents';
type BookFigure = 'gross' | 'net';
type BookSide = 'house' | 'player' | 'mixed';

const ROW_OPTIONS = [{ value: 'all', label: 'All' }, { value: 'players', label: 'Players' }, { value: 'agents', label: 'Agents' }] as const;
const FIGURE_OPTIONS = [{ value: 'gross', label: 'Gross' }, { value: 'net', label: 'Net' }] as const;

/**
 * The index of the figure that costs the house most, or -1 when none is a house loss. House-side figures
 * lose below zero and player-side figures above it; when the rows mix both sides the largest absolute
 * figure stands in.
 */
const worstIndex = (values: number[], side: BookSide): number => {
  let worst = -1;
  let largest = 0;
  values.forEach((value, index) => {
    const loss = side === 'house' ? -value : side === 'player' ? value : Math.abs(value);
    if (loss > largest) {
      largest = loss;
      worst = index;
    }
  });
  return worst;
};

export const MarketBookTable: React.FC<MarketBookTableProps> = ({
  market,
  bets,
  isExpanded,
  onToggle,
  viewContext,
}) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const [searchText, setSearchText] = useState('');
  const [rowKind, setRowKind] = useState<BookRows>('all');
  const [figure, setFigure] = useState<BookFigure>('gross');
  const bodyId = useId();

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

  // Get market selections
  const selections = useMemo(() => {
    return market.runners || market.odds || [];
  }, [market]);

  // Calculate book for each selection and process data
  const tableData = useMemo(() => {
    if (!bets || bets.length === 0 || selections.length === 0) {
      return { rows: [], totals: null };
    }

    const marketId = String(market.id);
    const marketType = market.type || market.kind || 'exchange';

    // Create a map of userId -> agentInfo from all bets to fill in missing agentInfo
    // This ensures players with agents are properly grouped even if some bets don't have agentInfo
    // Priority: Use the first bet with agentInfo for each user (most bets should have it)
    const userAgentMap = new Map<string, { agentId: string; agentName: string; schemeType: string; rate: number }>();
    bets.forEach((bet) => {
      if (bet.userId && bet.agentInfo?.agentId) {
        const userId = String(bet.userId);
        // Only set if not already set (use first occurrence)
        if (!userAgentMap.has(userId)) {
          userAgentMap.set(userId, {
            agentId: String(bet.agentInfo.agentId),
            agentName: bet.agentInfo.agentName || 'Unknown Agent',
            schemeType: bet.agentInfo.schemeType || 'COMMISSION',
            rate: bet.agentInfo.rate || 0,
          });
        }
      }
    });
    

    // Calculate book for each selection
    const selectionBooks = selections.map((selection) => {
      // Try to get selectionId in order:
      // 1. selectionCode (matches bet.selectionId like '5728193')
      // 2. id (runner UUID)
      // 3. selectionId (fallback)
      const selectionId = String(
        selection.selectionCode || 
        selection.id || 
        selection.selectionId || 
        selection.runnerId || 
        ''
      );
      const selectionName = selection.name || selection.selection || '';
      
      const book = calculateSelectionBook(
        selectionId,
        selectionName,
        bets,
        marketId,
        marketType,
        undefined,
        viewContext
      );

      return {
        selectionId,
        selectionName,
        book,
      };
    });

    // Process players and agents
    const playerMap = new Map<string, {
      userId: string;
      userName: string;
      userFlags?: string[];
      agentId?: string;
      agentName?: string;
      agentScheme?: 'COMMISSION' | 'SHARING' | 'CREDIT';
      agentRate: number;
      selections: Array<{ withoutCut: number; withCut: number }>;
    }>();

    const agentMap = new Map<string, {
      agentId: string;
      agentName: string;
      schemeType: 'COMMISSION' | 'SHARING' | 'CREDIT';
      rate: number;
      selections: Array<{ withoutCut: number; withCut: number }>;
      playerCount: number;
    }>();

    // Helper: When viewContext is provided, map an agent ID to its direct child ancestor
    // (i.e., find which direct child the agent belongs to for roll-up)
    const getDirectChildAgentId = (agentId: string): string | null => {
      if (!viewContext?.directChildAgentIds?.length) return agentId;
      // Check if this agent itself is a direct child
      if (viewContext.directChildAgentIds.includes(agentId)) return agentId;
      // Otherwise find which direct child's descendants include this agent
      for (const directChildId of viewContext.directChildAgentIds) {
        const descendants = viewContext.getDescendantsOf(directChildId);
        if (descendants.includes(agentId)) {
          return directChildId;
        }
      }
      return null; // Agent not in any direct child's hierarchy
    };

    // Process each selection's book by index
    selectionBooks.forEach(({ book }, selectionIndex: number) => {
      book.playerEntries.forEach((entry: BookEntry) => {
        const userId = entry.userId;
        
        // When viewContext is provided, map the player's agentId to the direct child ancestor
        const effectiveAgentId = entry.agentId ? getDirectChildAgentId(entry.agentId) : null;
        
        // Initialize player if not exists
        if (!playerMap.has(userId)) {
          const normalizedFlags = normalizeFlags(entry.userFlags);
          // Get agent info from viewContext for correct rolled-up agent name
          const playerViewAgentInfo = effectiveAgentId ? viewContext?.getAgentInfo?.(effectiveAgentId) : null;
          playerMap.set(userId, {
            userId,
            userName: entry.userName,
            userFlags: normalizedFlags,
            agentId: effectiveAgentId || undefined, // Use rolled-up agent ID
            agentName: playerViewAgentInfo?.username || entry.agentName,
            agentScheme: (playerViewAgentInfo?.schemeType as 'COMMISSION' | 'SHARING' | 'CREDIT') || entry.agentScheme,
            agentRate: playerViewAgentInfo?.rate ?? entry.agentRate ?? 0,
            selections: new Array(selections.length).fill(null).map(() => ({ withoutCut: 0, withCut: 0 })),
          });
        }

        const player = playerMap.get(userId)!;
        // Calculate P&L with cut:
        // - If player has agent: use agent's rate (or whitelabel effective rate if viewing as whitelabel)
        // - If player has no agent: use logged-in user's rate (if agent/whitelabel)
        // - For super admin in core mode: use null (Platform P&L)
        // - For super admin in whitelabel mode: use whitelabel rate (same as whitelabel admin)
        let playerRate: number | null = null;
        
        if (entry.agentId && entry.agentRate) {
          // Player has an agent
          if ((isWhitelabelAdmin || isSuperAdminInWhitelabelMode) && sharingRate !== null) {
            // Whitelabel viewing (or super admin in whitelabel mode): effective rate = whitelabel rate - agent rate
            playerRate = Math.max(0, sharingRate - entry.agentRate);
          } else if (isAgent && agent?.id && String(entry.agentId) === String(agent.id)) {
            // Agent viewing their own players: use agent's rate
            playerRate = entry.agentRate;
          } else if (isSuperAdmin && !isSuperAdminInWhitelabelMode) {
            // Super admin in core mode: Platform P&L
            playerRate = null;
          } else {
            // Default: use agent's rate
            playerRate = entry.agentRate;
          }
        } else {
          // Player has no agent: use logged-in user's rate
          if (isSuperAdmin && !isSuperAdminInWhitelabelMode) {
            playerRate = null; // Platform P&L
          } else {
            playerRate = sharingRate;
          }
        }
        const plCalculated = calculatePLWithCut(entry.netPL, playerRate);
        player.selections[selectionIndex] = {
          withoutCut: plCalculated.withoutCut,
          withCut: plCalculated.withCut,
        };

        // Aggregate by agent (use rolled-up agent ID when viewContext is provided)
        if (effectiveAgentId) {
          if (!agentMap.has(effectiveAgentId)) {
            // Get agent info from viewContext (has correct name for rolled-up agents)
            const viewAgentInfo = viewContext?.getAgentInfo?.(effectiveAgentId);
            const rolledAgentEntry = book.agentEntries?.get(effectiveAgentId);
            agentMap.set(effectiveAgentId, {
              agentId: effectiveAgentId,
              agentName: viewAgentInfo?.username || rolledAgentEntry?.agentName || entry.agentName || 'Unknown Agent',
              schemeType: (viewAgentInfo?.schemeType as 'COMMISSION' | 'SHARING' | 'CREDIT') || rolledAgentEntry?.schemeType || entry.agentScheme || 'COMMISSION',
              rate: viewAgentInfo?.rate ?? rolledAgentEntry?.rate ?? entry.agentRate ?? 0,
              selections: new Array(selections.length).fill(null).map(() => ({ withoutCut: 0, withCut: 0 })),
              playerCount: 0,
            });
          }

          const agentEntry = agentMap.get(effectiveAgentId)!;
          // For agent rows: calculate based on viewing user type
          let agentEffectiveRate: number | null = null;
          
          // Super admin in core mode: Platform P&L (inverse)
          if (isSuperAdmin && !isSuperAdminInWhitelabelMode) {
            agentEffectiveRate = null;
          } else if ((isWhitelabelAdmin || isSuperAdminInWhitelabelMode) && sharingRate !== null) {
            // Whitelabel viewing (or super admin in whitelabel mode): effective rate = whitelabel rate - agent rate
            const agentRate = agentEntry.rate || 0;
            agentEffectiveRate = Math.max(0, sharingRate - agentRate);
          } else if (isAgent && effectiveAgentId && agent?.id && String(effectiveAgentId) === String(agent.id)) {
            // Agent viewing their own row: use their own rate
            agentEffectiveRate = agentEntry.rate || 0;
          } else {
            // Agent viewing other agents, or default: use that agent's rate
            agentEffectiveRate = agentEntry.rate || 0;
          }
          
          const agentPLCalculated = calculatePLWithCut(entry.netPL, agentEffectiveRate);
          agentEntry.selections[selectionIndex].withoutCut += agentPLCalculated.withoutCut;
          agentEntry.selections[selectionIndex].withCut += agentPLCalculated.withCut;
        }
      });
    });

    // Fix missing agentInfo: If a player doesn't have agentId but we have it in userAgentMap, add it
    playerMap.forEach((player) => {
      if (!player.agentId && userAgentMap.has(player.userId)) {
        const agentInfo = userAgentMap.get(player.userId)!;
        // Use rolled-up agent ID when viewContext is provided
        const effectiveAgentId = getDirectChildAgentId(agentInfo.agentId);
        
        
        if (!effectiveAgentId) {
          // Agent not in any direct child's hierarchy, skip
          return;
        }
        
        // Get agent info from viewContext for correct rolled-up agent name
        const viewAgentInfo = viewContext?.getAgentInfo?.(effectiveAgentId);
        const rolledAgentName = viewAgentInfo?.username || agentInfo.agentName;
        const rolledSchemeType = (viewAgentInfo?.schemeType as 'COMMISSION' | 'SHARING' | 'CREDIT') || (agentInfo.schemeType as 'COMMISSION' | 'SHARING' | 'CREDIT');
        const rolledRate = viewAgentInfo?.rate ?? agentInfo.rate;
        
        player.agentId = effectiveAgentId;
        player.agentName = rolledAgentName;
        player.agentScheme = rolledSchemeType;
        player.agentRate = rolledRate;
        
        // Add to agentMap if not already present (use rolled-up agent ID)
        if (!agentMap.has(effectiveAgentId)) {
          agentMap.set(effectiveAgentId, {
            agentId: effectiveAgentId,
            agentName: rolledAgentName,
            schemeType: rolledSchemeType,
            rate: rolledRate,
            selections: new Array(selections.length).fill(null).map(() => ({ withoutCut: 0, withCut: 0 })),
            playerCount: 0,
          });
        }
        
        // Recalculate player's P&L with correct agent rate
        player.selections.forEach((sel, idx) => {
          // Recalculate with agent's rate
          const recalculated = calculatePLWithCut(sel.withoutCut, agentInfo.rate);
          player.selections[idx] = recalculated;
        });
        
        // Add player's P&L to agent's selections with correct rate
        const agentEntry = agentMap.get(effectiveAgentId)!;
        // Calculate agent effective rate based on viewing user
        let agentEffectiveRate: number | null = null;
        // Super admin in core mode: Platform P&L
        if (isSuperAdmin && !isSuperAdminInWhitelabelMode) {
          agentEffectiveRate = null;
        } else if ((isWhitelabelAdmin || isSuperAdminInWhitelabelMode) && sharingRate !== null) {
          // Whitelabel viewing (or super admin in whitelabel mode): effective rate = whitelabel rate - agent rate
          agentEffectiveRate = Math.max(0, sharingRate - agentEntry.rate);
        } else if (isAgent && effectiveAgentId && agent?.id && String(effectiveAgentId) === String(agent.id)) {
          // Agent viewing their own row: use their own rate
          agentEffectiveRate = agentEntry.rate;
        } else {
          // Agent viewing other agents: use that agent's rate
          agentEffectiveRate = agentEntry.rate;
        }
        
        player.selections.forEach((sel, idx) => {
          const agentPLCalculated = calculatePLWithCut(sel.withoutCut, agentEffectiveRate);
          agentEntry.selections[idx].withoutCut += agentPLCalculated.withoutCut;
          agentEntry.selections[idx].withCut += agentPLCalculated.withCut;
        });
      }
    });
    

    // Update agent player counts
    const agentPlayerSet = new Map<string, Set<string>>();
    playerMap.forEach((player) => {
      if (player.agentId && agentMap.has(player.agentId)) {
        if (!agentPlayerSet.has(player.agentId)) {
          agentPlayerSet.set(player.agentId, new Set());
        }
        agentPlayerSet.get(player.agentId)!.add(player.userId);
      }
    });
    agentPlayerSet.forEach((playerSet, agentId) => {
      if (agentMap.has(agentId)) {
        agentMap.get(agentId)!.playerCount = playerSet.size;
      }
    });

    // Build table rows
    const rows: TableRowData[] = [];
    const loggedInAgentId = isAgent && agent?.id ? String(agent.id) : null;

    // Add players
    playerMap.forEach((player) => {
      // If player has no agent, show as direct
      if (!player.agentId) {
        const hasFlags = player.userFlags && player.userFlags.length > 0;
        rows.push({
          key: `player-${player.userId}`,
          name: player.userName,
          agentTag: '-',
          selections: player.selections,
          isAgent: false,
          userFlags: hasFlags ? player.userFlags : undefined,
        });
      } else if (loggedInAgentId && String(player.agentId) === loggedInAgentId) {
        // If logged in as agent, show their players individually (not aggregated under agent row)
        const hasFlags = player.userFlags && player.userFlags.length > 0;
        rows.push({
          key: `player-${player.userId}`,
          name: player.userName,
          agentTag: '-', // Show as direct since they're viewing their own players
          selections: player.selections,
          isAgent: false,
          userFlags: hasFlags ? player.userFlags : undefined,
        });
      }
      // Players under other agents will be shown in aggregated agent rows below
    });

    // Add aggregated agents (exclude logged-in agent - their players are shown individually above)
    agentMap.forEach((agent) => {
      // Skip logged-in agent - their players are shown individually above
      if (loggedInAgentId && String(agent.agentId) === loggedInAgentId) {
        return;
      }
      rows.push({
        key: `agent-${agent.agentId}`,
        name: agent.agentName,
        agentTag: `${agent.schemeType === 'COMMISSION' ? 'Comm' : 'Share'} ${agent.rate}%`,
        agentScheme: agent.schemeType,
        agentRate: agent.rate,
        selections: agent.selections,
        isAgent: true,
        playerCount: agent.playerCount,
      });
    });

    // Calculate totals (per selection only, no grand total)
    const totals = {
      selections: new Array(selections.length).fill(null).map(() => ({ withoutCut: 0, withCut: 0 })),
    };

    rows.forEach((row) => {
      row.selections.forEach((s, idx) => {
        if (totals.selections[idx]) {
          totals.selections[idx].withoutCut += s.withoutCut;
          totals.selections[idx].withCut += s.withCut;
        }
      });
    });

    return { rows, totals };
  }, [market, bets, selections, sharingRate, viewContext, isAgent, agent?.id, isWhitelabelAdmin, isSuperAdmin, isSuperAdminInWhitelabelMode]);

  // Filter rows by kind, then by search; the totals still cover every row
  const filteredRows = useMemo(() => {
    const rows = rowKind === 'all' ? tableData.rows : tableData.rows.filter((row) => row.isAgent === (rowKind === 'agents'));
    if (!searchText.trim()) {
      return rows;
    }
    const search = searchText.toLowerCase();
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(search) ||
        row.agentTag.toLowerCase().includes(search)
    );
  }, [tableData.rows, searchText, rowKind]);

  // Summary counts
  const playerCount = tableData.rows.filter((r) => !r.isAgent).length;
  const agentCount = tableData.rows.filter((r) => r.isAgent).length;

  // Super Admin in core mode reads house-side figures (a null rate inverts them in calculatePLWithCut).
  // Everyone else reads the player's side, unless no sharing rate has loaded: then direct players fall
  // back to the null rate and the rows mix both sides.
  const bookSide: BookSide = isSuperAdmin && !isSuperAdminInWhitelabelMode ? 'house' : sharingRate === null ? 'mixed' : 'player';
  const figureKey = figure === 'net' ? 'withCut' : 'withoutCut';
  const selectionLabel = (index: number) => {
    const selection = selections[index];
    return selection?.name || selection?.selection || `Sel ${index + 1}`;
  };

  // Preserve the original book's semantic sign colour as well as its calculated signed values.
  const formatPL = (value: number, worst = false) => <span className={clsx(value >= 0 ? styles.negative : styles.positive, worst && styles.worst)}>{formatAmount(convertFromWhitelabelCurrency(value))}</span>;
  if (!bets || !bets.length) return null;
  const totalFigures = tableData.totals ? tableData.totals.selections.map((value) => value[figureKey]) : [];
  const worstTotal = worstIndex(totalFigures, bookSide);
  const columns: DataTableColumn<TableRowData>[] = [
    { key: 'identity', header: 'Player / Agent', minWidth: 180, cell: row => <div className={styles.who}>
      <Avatar name={row.isAgent ? null : row.name} size={22} className={styles.avatar} />
      <span className={styles.whoText}><span className={styles.row}><strong className={styles.whoName}>{row.name}</strong>{!row.isAgent && !!row.userFlags?.length && <PlayerFlagIndicator flags={row.userFlags} userId={row.key.replace('player-', '')} />}</span>
        <span className={styles.row}>{row.isAgent ? <>
          <Tooltip content={`${row.agentScheme === 'COMMISSION' ? 'Commission' : 'Sharing'} at ${row.agentRate}%`}><span tabIndex={0}><StatusPill tone="info">{row.agentTag}</StatusPill></span></Tooltip>
          {!!row.playerCount && <span className={styles.muted}>{row.playerCount}P</span>}
        </> : <StatusPill>Direct</StatusPill>}</span>
      </span>
    </div>, footer: 'Total' },
    ...selections.map((_selection, index): DataTableColumn<TableRowData> => ({
      key: 'selection-' + index,
      header: `If ${selectionLabel(index)} win`,
      align: 'right',
      minWidth: 120,
      cell: row => formatPL(row.selections[index]?.[figureKey] ?? 0, worstIndex(row.selections.map((value) => value[figureKey]), bookSide) === index),
      footer: tableData.totals ? formatPL(totalFigures[index] ?? 0) : undefined,
    })),
  ];
  return <div className={styles.book}>
    <button type="button" className={styles.bar} onClick={onToggle} aria-expanded={isExpanded} aria-controls={isExpanded ? bodyId : undefined}>
      <IconChevronDown size={16} className={styles.chevron} aria-hidden="true" />
      {/* the spaces keep the button's name in words; a flex row does not render them */}
      <span className={styles.title}>Market book</span>{' '}
      <span className={styles.count}>{playerCount}P</span>{' '}
      {agentCount > 0 && <><span className={styles.count}>{agentCount}A</span>{' '}</>}
      {worstTotal >= 0 && <span className={styles.worstCase}>Worst case <b>{formatPL(totalFigures[worstTotal])}</b> if {selectionLabel(worstTotal)} win</span>}
    </button>
    {isExpanded && <div className={styles.body} id={bodyId}>
      <div className={styles.tools}>
        <SearchField className={styles.find} label="Search players or agents" placeholder="Player or agent" value={searchText} onChange={setSearchText} />
        <SegmentedControl label="Book rows" size="sm" value={rowKind} options={ROW_OPTIONS} onChange={setRowKind} />
        <SegmentedControl label="Figures" size="sm" value={figure} options={FIGURE_OPTIONS} onChange={setFigure} />
      </div>
      <DataTable className={clsx(styles.table, styles.pinned)} label="Market book selections" density="compact" columns={columns} rows={filteredRows} rowKey={row => row.key} width="narrow" pagination={false} empty={<p className={styles.empty}>No rows match. The totals below still cover the whole book.</p>} />
      <p className={styles.note}><IconInfoCircle size={15} aria-hidden="true" /><span>Gross is without cut, Net is with cut. <span>Totals include all loaded book rows, not only search results.</span></span></p>
    </div>}
  </div>;
};
