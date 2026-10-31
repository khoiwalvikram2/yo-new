import React, { useMemo, useState, useEffect, useCallback, useId, useRef } from 'react';
import clsx from 'clsx';
import { Avatar } from '@/ui/components/Avatar';
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable';
import { DescriptionList } from '@/ui/components/DescriptionList';
import { IconButton } from '@/ui/components/IconButton';
import { SearchField } from '@/ui/components/SearchField';
import { SegmentedControl } from '@/ui/components/SegmentedControl';
import { StatusPill } from '@/ui/components/StatusPill';
import { Tooltip } from '@/ui/components/Tooltip';
import styles from './MarketBook.module.css';
import { IconChevronUp, IconChevronDown } from '@tabler/icons-react';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useAuthStore } from '@/shared/core/authStore';
import { calculateFancyBook, calculateFancyBookByPlayer, type FancyBookEntry, type FancyBookPlayerBreakdown } from '../utils/fancyBookCalculator';
import { PlayerFlagIndicator } from './PlayerFlagIndicator';
import type { BookViewContext } from '../utils/bookCalculator';

// Helper to normalize flags from JSONB to string array
const normalizeFlags = (flags: unknown): string[] => {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags;
  if (typeof flags === 'object') {
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

const RANGE_OPTIONS = [{ value: 'summary', label: 'Summary' }, { value: 'full', label: 'Full Range' }] as const;
/** Full Range can run to 200 positions; the bar strip shows this many around the break-even. */
const STRIP_LIMIT = 25;
/** The bar strip's tallest bar, in px (the kit's 34px half-height). */
const STRIP_BAR = 34;
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
/** Where the book turns between two shown positions; the table tags the later one Break Even. */
const turnsAt = (previous: FancyBookEntry | null | undefined, entry: FancyBookEntry) =>
  previous != null && (previous.pnl < 0) !== (entry.pnl < 0);

interface FancyBookTableProps {
  market: { id?: string | number | null };
  bets: unknown[];
  isExpanded: boolean;
  onToggle: () => void;
  selectionId?: string;
  selectionName?: string;
  viewContext?: BookViewContext | null;
}

export const FancyBookTable: React.FC<FancyBookTableProps> = ({
  market,
  bets,
  isExpanded,
  onToggle,
  selectionId,
  selectionName,
  viewContext,
}) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const isAgent = useAuthStore((s) => s.isAgent());
  const agent = useAuthStore((s) => s.agent);
  const [searchText, setSearchText] = useState('');
  const [showFullRange, setShowFullRange] = useState(false);
  const titleId = useId();

  // Reset search and view when market changes
  useEffect(() => {
    setSearchText('');
    setShowFullRange(false);
  }, [market?.id]);

  // Calculate fancy book
  const bookData = useMemo(() => {
    if (!bets || bets.length === 0 || !market?.id) {
      return null;
    }

    try {
      return calculateFancyBook(bets, String(market.id), selectionId, selectionName);
    } catch {
      return null;
    }
  }, [bets, market?.id, selectionId, selectionName]);

  // Calculate player breakdown
  const rawPlayerBreakdown = useMemo(() => {
    if (!bets || bets.length === 0 || !bookData || !market?.id) {
      return new Map<string, FancyBookPlayerBreakdown>();
    }

    try {
      return calculateFancyBookByPlayer(bets, String(market.id), selectionId, selectionName);
    } catch {
      return new Map<string, FancyBookPlayerBreakdown>();
    }
  }, [bets, market?.id, selectionId, selectionName, bookData]);

  // Helper: map an agent ID to its direct child ancestor when viewContext is provided
  const getDirectChildAgentId = useCallback((agentId: string): string | null => {
    if (!viewContext?.directChildAgentIds?.length) return agentId;
    if (viewContext.directChildAgentIds.includes(agentId)) return agentId;
    for (const directChildId of viewContext.directChildAgentIds) {
      const descendants = viewContext.getDescendantsOf(directChildId);
      if (descendants.includes(agentId)) {
        return directChildId;
      }
    }
    return null; // Not in any direct child's hierarchy
  }, [viewContext]);

  // Filter players based on view context:
  // - Agent view: show only direct players (no agent) or players under logged-in agent
  // - Whitelabel view with viewContext: show only players under root agents (direct children)
  const playerBreakdown = useMemo(() => {
    // Agent view: filter to logged-in agent's players only
    if (isAgent && agent?.id) {
      const filtered = new Map<string, import('../utils/fancyBookCalculator').FancyBookPlayerBreakdown>();
      rawPlayerBreakdown.forEach((breakdown, userId) => {
        if (breakdown.agentId == null || String(breakdown.agentId) === String(agent.id)) {
          filtered.set(userId, breakdown);
        }
      });
      return filtered;
    }
    
    // Whitelabel view with viewContext: filter to players under direct child agents
    if (viewContext?.directChildAgentIds?.length) {
      const filtered = new Map<string, import('../utils/fancyBookCalculator').FancyBookPlayerBreakdown>();
      rawPlayerBreakdown.forEach((breakdown, userId) => {
        // Include players with no agent (direct whitelabel players)
        if (!breakdown.agentId) {
          filtered.set(userId, breakdown);
          return;
        }
        // Include players whose agent is in a direct child's hierarchy
        const effectiveAgentId = getDirectChildAgentId(breakdown.agentId);
        if (effectiveAgentId) {
          // Update the breakdown with rolled-up agent info
          const viewAgentInfo = viewContext.getAgentInfo?.(effectiveAgentId);
          filtered.set(userId, {
            ...breakdown,
            agentId: effectiveAgentId,
            agentName: viewAgentInfo?.username || breakdown.agentName,
            agentScheme: (viewAgentInfo?.schemeType as 'COMMISSION' | 'SHARING' | 'CREDIT') || breakdown.agentScheme,
            agentRate: viewAgentInfo?.rate ?? breakdown.agentRate,
          });
        }
      });
      return filtered;
    }
    
    return rawPlayerBreakdown;
  }, [rawPlayerBreakdown, isAgent, agent?.id, viewContext, getDirectChildAgentId]);

  // Filter and sort entries
  const filteredEntries = useMemo(() => {
    if (!bookData || bookData.entries.length === 0) {
      return [];
    }

    let entries = [...bookData.entries];

    // If summary mode, show only top 5 profitable and worst 5 loss positions
    if (!showFullRange) {
      const profitable = entries.filter((e: { pnl: number }) => e.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 5);
      const losses = entries.filter((e: { pnl: number }) => e.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 5);
      const breakEven = entries.filter((e: { pnl: number }) => e.pnl === 0).slice(0, 1); // Show one break-even if exists
      entries = [...profitable, ...breakEven, ...losses].sort((a, b) => a.position - b.position);
    }

    // Filter by search (if searching for position number)
    if (searchText.trim()) {
      const search = searchText.trim();
      const positionNum = parseInt(search, 10);
      if (!isNaN(positionNum)) {
        entries = entries.filter((e) => e.position === positionNum);
      } else {
        // Search by player name - filter entries that have players matching the search
        const matchingUserIds = Array.from(playerBreakdown.keys()).filter((userId) => {
          const player = playerBreakdown.get(userId);
          return player?.userName.toLowerCase().includes(search.toLowerCase());
        });
        // Filter entries to only show positions where matching players have bets
        if (matchingUserIds.length > 0) {
          entries = entries.filter((entry) => {
            return Array.from(playerBreakdown.values()).some((player) => {
              if (!matchingUserIds.includes(player.userId)) return false;
              const playerEntry = player.entries.find((e: { position: number }) => e.position === entry.position);
              return playerEntry && playerEntry.pnl !== 0;
            });
          });
        } else {
          // No matching players, return empty
          entries = [];
        }
      }
    }

    return entries;
  }, [bookData, showFullRange, searchText, playerBreakdown]);

  // The bar strip shows the table's entries; a long Full Range keeps the window around the first turn
  const stripEntries = useMemo(() => {
    if (filteredEntries.length <= STRIP_LIMIT) return filteredEntries;
    const turn = filteredEntries.findIndex((entry, index) => turnsAt(filteredEntries[index - 1], entry));
    const start = turn < 0 ? 0 : Math.min(Math.max(0, turn - Math.floor(STRIP_LIMIT / 2)), filteredEntries.length - STRIP_LIMIT);
    return filteredEntries.slice(start, start + STRIP_LIMIT);
  }, [filteredEntries]);

  // A strip wider than its panel opens with the break-even column centred, not at its first position
  const stripRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const turn = strip?.querySelector<HTMLElement>(`.${styles.breakEven}`);
    if (!strip || !turn) return;
    strip.scrollLeft = turn.offsetLeft - (strip.clientWidth - turn.offsetWidth) / 2;
  }, [stripEntries, isExpanded]);

  // Format P/L value as string (for Tag components)
  const formatPLString = (value: number) => {
    if (!Number.isFinite(value)) {
      return 'N/A';
    }
    const converted = convertFromWhitelabelCurrency(value);
    return formatAmount(converted);
  };


  const formatPL = (value: number) => Number.isFinite(value)
    ? <span className={value >= 0 ? styles.positive : styles.negative}>{formatPLString(value)}</span>
    : <span className={styles.muted}>N/A</span>;
  if (!bets || !bets.length || !bookData?.entries.length) return null;
  const stats = bookData.statistics;
  const bestPos = bookData.bestPosition;
  const worstPos = bookData.worstPosition;
  const breakEvens = new Set(filteredEntries.filter((entry, index) => turnsAt(filteredEntries[index - 1], entry)).map(entry => entry.position));
  const stripLargest = Math.max(0, ...stripEntries.map(entry => Math.abs(entry.pnl)));
  const toggleLabel = isExpanded ? 'Collapse Fancy Book' : 'Expand Fancy Book';
  const columns: DataTableColumn<FancyBookEntry>[] = [
    { key: 'position', header: 'Position', width: 100, cell: entry => <span className={styles.positionCell}>{entry.position}{breakEvens.has(entry.position) && <StatusPill tone="neutral">Break Even</StatusPill>}</span> },
    { key: 'pnl', header: 'Total P/L', align: 'right', width: 150, cell: entry => formatPL(entry.pnl) },
    { key: 'players', header: 'Players', minWidth: 200, cell: entry => {
      const playersAtPosition = Array.from(playerBreakdown.values()).flatMap(player => {
        const playerEntry = player.entries.find(value => value.position === entry.position);
        return playerEntry && playerEntry.pnl !== 0 ? [{ userId: player.userId, userName: player.userName, userFlags: player.userFlags as unknown, pnl: playerEntry.pnl }] : [];
      });
      return <div className={styles.players}>
        {!playersAtPosition.length ? <span className={styles.muted}>No players</span> : playersAtPosition.slice(0, 5).map(player => <Tooltip key={player.userId} content={`${player.userName || 'Unknown'}: ${formatPLString(player.pnl)}`}>
          <span tabIndex={0} className={styles.player}><Avatar name={player.userName} size={22} className={styles.avatar} /><span className={styles.srOnly}>{player.userName || 'Unknown'}</span>{normalizeFlags(player.userFlags).length > 0 && <PlayerFlagIndicator flags={normalizeFlags(player.userFlags)} userId={player.userId} />}</span>
        </Tooltip>)}
        {playersAtPosition.length > 5 && <StatusPill>+{playersAtPosition.length - 5}</StatusPill>}
      </div>;
    } },
  ];
  return <div className={styles.fancy}>
    <div className={styles.fancyHead}>
      <h3 id={titleId} className={styles.fancyTitle}>Player position by final score{selectionName ? <> · <b>{selectionName}</b></> : null}</h3>
      <span className={styles.fancyMeta}>{stats.totalBets} {stats.totalBets === 1 ? 'bet' : 'bets'}
        <Tooltip content={toggleLabel}><IconButton size="sm" label={toggleLabel} icon={isExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />} aria-expanded={isExpanded} onClick={onToggle} /></Tooltip>
      </span>
    </div>
    {isExpanded && <>
      {stripEntries.length > 0 && <ol ref={stripRef} className={styles.strip} aria-labelledby={titleId}>
        {stripEntries.map(entry => {
          const height = entry.pnl === 0 || !stripLargest ? 0 : Math.max(2, Math.round((Math.abs(entry.pnl) / stripLargest) * STRIP_BAR));
          const fill = height > 0 && <span className={styles.fill} style={{ height }} />;
          return <li key={entry.position} className={clsx(styles.position, entry.pnl > 0 && styles.profit, entry.pnl < 0 && styles.loss, breakEvens.has(entry.position) && styles.breakEven)}>
            <span className={styles.above} aria-hidden="true">{entry.pnl > 0 && fill}</span>
            <span className={styles.below} aria-hidden="true">{entry.pnl < 0 && fill}</span>
            <b className={styles.compact} aria-hidden="true">{compactNumber.format(convertFromWhitelabelCurrency(entry.pnl))}</b>
            <span className={styles.score} aria-hidden="true">{entry.position}</span>
            <span className={styles.srOnly}>{`At ${entry.position}: ${formatPLString(entry.pnl)}`}</span>
          </li>;
        })}
      </ol>}
      {stripEntries.length < filteredEntries.length && <p className={styles.muted}>{`The bars show ${stripEntries.length} of ${filteredEntries.length} positions, around the break-even.`}</p>}
      {((bestPos && bestPos.pnl > 0) || (worstPos && worstPos.pnl < 0)) && <div className={styles.row}>
        {bestPos && bestPos.pnl > 0 && <StatusPill tone="ok">Best: {bestPos.position} → {formatPLString(bestPos.pnl)}</StatusPill>}
        {worstPos && worstPos.pnl < 0 && <StatusPill tone="neg">Worst: {worstPos.position} → {formatPLString(worstPos.pnl)}</StatusPill>}
      </div>}
      <DescriptionList className={styles.stats} labelWidth={96} items={[{ term: 'Total Back', value: formatAmount(convertFromWhitelabelCurrency(stats.totalBackStake)) }, { term: 'Total Lay', value: formatAmount(convertFromWhitelabelCurrency(stats.totalLayStake)) }, { term: 'Back Bets', value: stats.backBets }, { term: 'Lay Bets', value: stats.layBets }]} />
      <div className={styles.tools}>
        <SearchField className={styles.find} label="Search position or player" placeholder="Position or player" value={searchText} onChange={setSearchText} />
        <SegmentedControl label="Positions shown" size="sm" value={showFullRange ? 'full' : 'summary'} options={RANGE_OPTIONS} onChange={value => setShowFullRange(value === 'full')} />
      </div>
      <DataTable className={styles.table} label="Fancy book player positions" density="compact" columns={columns} rows={filteredEntries} rowKey={entry => String(entry.position)} width="narrow" pagination={false} empty={<p className={styles.empty}>No positions found</p>} />
    </>}
  </div>;
};

