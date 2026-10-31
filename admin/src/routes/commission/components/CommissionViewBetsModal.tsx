import { Dialog } from '@/ui/components/Dialog'
import { Pagination } from '@/ui/components/Pagination'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Stat } from '@/ui/components/Stat'
import { Switch } from '@/ui/components/Switch'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { StatusPill } from '@/ui/components/StatusPill'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from './CommissionViewBetsModal.module.css'
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import dayjs from 'dayjs';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { COMMISSION_CYCLES_FOR_AGENT_QUERY } from '@/lib/graphql/settlements';
import { COMMISSION_HISTORY_QUERY } from '@/lib/graphql/agents';


export interface CommissionViewBetsParams {
  agentId: string;
  username: string | null;
  cycleFrom?: string;
  cycleTo?: string;
  activeCycleKey?: string;
  playerId?: string;
}

interface CommissionHistoryEntry {
  id: string;
  date: string;
  playerId: string;
  playerName: string;
  domain: 'sports' | 'casino' | 'matka';
  betAmount: number;
  ggr: number;
  commissionRate: number;
  commissionEarned: number;
  currency: string;
  status?: string | null;
  eventName?: string | null;
  marketName?: string | null;
  selectionName?: string | null;
  side?: string | null;
  odds?: number | null;
  liability?: number | null;
  gameName?: string | null;
  vendorName?: string | null;
  payout?: number | null;
  winAmount?: number | null;
  matkaType?: string | null;
  bidType?: string | null;
  betNumbers?: string | null;
  payoutMultiplier?: number | null;
  potentialWin?: number | null;
  actualWin?: number | null;
  marketSession?: string | null;
}

const domainLabel = (domain: string) => domain ? domain[0].toUpperCase() + domain.slice(1).toLowerCase() : '';

type CommissionViewBetsModalProps = {
  open: boolean;
  onClose: () => void;
  params: CommissionViewBetsParams | null;
};

export function CommissionViewBetsModal({ open, onClose, params }: CommissionViewBetsModalProps) {
  const { formatAmount } = useCurrency();
  const [viewBetsActiveKey, setViewBetsActiveKey] = useState<string | null>(null);
  const [viewBetsDomainFilter, setViewBetsDomainFilter] = useState<'sports' | 'casino' | 'matka' | null>(null);
  const [viewBetsFullDetail, setViewBetsFullDetail] = useState(false);
  const [viewBetsFullDetailPage, setViewBetsFullDetailPage] = useState(1);

  const [detailSize, setDetailSize] = useState(50);
  const { data: viewBetsCyclesData, loading: cyclesLoading, error: cyclesError } = useQuery(COMMISSION_CYCLES_FOR_AGENT_QUERY, {
    variables: { agentId: params?.agentId ?? '' },
    skip: !open || !params?.agentId,
    fetchPolicy: 'cache-and-network',
  });
  const viewBetsAllCycles = useMemo(() => (viewBetsCyclesData?.commissionCyclesForAgent ?? []) as { from: string; to: string; status: string }[], [viewBetsCyclesData]);
  const viewBetsActiveCycle = useMemo(() => {
    const selected = viewBetsActiveKey ? viewBetsAllCycles.find((c) => c.from === viewBetsActiveKey) : null;
    if (selected) return selected;
    if (params?.cycleFrom && params?.cycleTo) {
      return { from: params.cycleFrom, to: params.cycleTo, status: 'MANUAL' };
    }
    return null;
  }, [viewBetsActiveKey, viewBetsAllCycles, params?.cycleFrom, params?.cycleTo]);

  const { data: viewBetsHistoryData, loading: viewBetsLoading, error: historyError } = useQuery(COMMISSION_HISTORY_QUERY, {
    variables: {
      agentId: params?.agentId ?? '',
      periodFrom: viewBetsActiveCycle?.from ?? '',
      periodTo: viewBetsActiveCycle?.to ?? '',
      domain: viewBetsDomainFilter ?? undefined,
      playerId: params?.playerId ?? undefined,
      limit: detailSize,
      offset: (viewBetsFullDetailPage - 1) * detailSize,
    },
    skip: !open || !params?.agentId || !viewBetsActiveCycle?.from || !viewBetsActiveCycle?.to,
    fetchPolicy: 'cache-and-network',
  });
  const viewBetsEntries = useMemo<CommissionHistoryEntry[]>(() => viewBetsHistoryData?.agents?.commissionHistory?.entries ?? [], [viewBetsHistoryData]);
  const viewBetsTotal = viewBetsHistoryData?.agents?.commissionHistory?.total ?? 0;
  const viewBetsCurrency = viewBetsEntries[0]?.currency ?? 'INR';
  const viewBetsPlayerGroups = useMemo(() => {
    const grouped = new Map<
      string,
      {
        playerId: string;
        playerName: string;
        totalStake: number;
        totalPL: number;
        sportsPL: number;
        casinoPL: number;
        matkaPL: number;
        entries: CommissionHistoryEntry[];
      }
    >();
    for (const entry of viewBetsEntries as CommissionHistoryEntry[]) {
      const key = entry.playerId || entry.playerName || 'unknown';
      const existing = grouped.get(key);
      const pl = Number(entry.ggr ?? 0);
      const stake = Number(entry.betAmount ?? 0);
      if (existing) {
        existing.totalStake += stake;
        existing.totalPL += pl;
        if (entry.domain === 'sports') existing.sportsPL += pl;
        if (entry.domain === 'casino') existing.casinoPL += pl;
        if (entry.domain === 'matka') existing.matkaPL += pl;
        existing.entries.push(entry);
      } else {
        grouped.set(key, {
          playerId: entry.playerId,
          playerName: entry.playerName,
          totalStake: stake,
          totalPL: pl,
          sportsPL: entry.domain === 'sports' ? pl : 0,
          casinoPL: entry.domain === 'casino' ? pl : 0,
          matkaPL: entry.domain === 'matka' ? pl : 0,
          entries: [entry],
        });
      }
    }
    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        entries: [...group.entries].sort((a, b) => dayjs(b.date).valueOf() - dayjs(a.date).valueOf()),
      }))
      .sort((a, b) => Math.abs(b.totalPL) - Math.abs(a.totalPL));
  }, [viewBetsEntries]);

  const viewBetsTopSummary = useMemo(
    () =>
      viewBetsPlayerGroups.reduce(
        (acc, group) => {
          acc.players += 1;
          acc.totalStake += group.totalStake;
          acc.sportsPL += group.sportsPL;
          acc.casinoPL += group.casinoPL;
          acc.matkaPL += group.matkaPL;
          acc.overallPL += group.totalPL;
          return acc;
        },
        { players: 0, totalStake: 0, sportsPL: 0, casinoPL: 0, matkaPL: 0, overallPL: 0 },
      ),
    [viewBetsPlayerGroups],
  );
  const showSportsInfo = viewBetsDomainFilter == null || viewBetsDomainFilter === 'sports';
  const showCasinoInfo = viewBetsDomainFilter == null || viewBetsDomainFilter === 'casino';
  const showMatkaInfo = viewBetsDomainFilter == null || viewBetsDomainFilter === 'matka';


  useEffect(() => {
    if (!open || !params) {
      if (!open) setViewBetsActiveKey(null);
      return;
    }
    if (viewBetsAllCycles.length === 0) {
      if (params.cycleFrom && params.cycleTo) {
        setViewBetsActiveKey(params.cycleFrom);
      } else {
        setViewBetsActiveKey(null);
      }
      return;
    }
    setViewBetsActiveKey((prev) => {
      // Prefer dashboard-selected range so modal shows data for the same period as the table
      if (params.cycleFrom && params.cycleTo) {
        const exactInList = viewBetsAllCycles.find(
          (c) => c.from === params.cycleFrom || dayjs(c.from).format('YYYY-MM-DD') === params.cycleFrom,
        );
        if (exactInList) return exactInList.from;
        return params.cycleFrom;
      }
      const validPrev = prev && viewBetsAllCycles.some((c) => c.from === prev);
      if (validPrev) return prev;
      const fromParam = params.activeCycleKey;
      if (!fromParam) return viewBetsAllCycles[0].from;
      const exact = viewBetsAllCycles.find((c) => c.from === fromParam);
      if (exact) return exact.from;
      const paramTime = new Date(fromParam).getTime();
      if (Number.isNaN(paramTime)) return viewBetsAllCycles[0].from;
      const oneDayMs = 24 * 60 * 60 * 1000;
      const closest = viewBetsAllCycles.reduce<{ cycle: (typeof viewBetsAllCycles)[0]; diff: number } | null>((acc, c) => {
        const diff = Math.abs(new Date(c.from).getTime() - paramTime);
        if (diff <= oneDayMs && (!acc || diff < acc.diff)) return { cycle: c, diff };
        return acc;
      }, null);
      if (closest) return closest.cycle.from;
      if (params.cycleFrom) {
        const byDate = viewBetsAllCycles.find((c) => dayjs(c.from).format('YYYY-MM-DD') === params.cycleFrom);
        if (byDate) return byDate.from;
      }
      return viewBetsAllCycles[0].from;
    });
  }, [open, params, viewBetsAllCycles]);

  const handleClose = () => {
    setViewBetsActiveKey(null);
    setViewBetsDomainFilter(null);
    setViewBetsFullDetail(false);
    setViewBetsFullDetailPage(1);
    onClose();
  };

  const amount = (value: number, currency: string) => <span className={value > 0 ? styles.positive : value < 0 ? styles.negative : styles.secondary}>{formatAmount(value, currency)}</span>
  const basicColumns: DataTableColumn<CommissionHistoryEntry>[] = [
    { key: 'date', header: 'Date', cell: (entry) => dayjs.utc(entry.date).tz('Asia/Kolkata').format('DD MMM HH:mm') },
    { key: 'domain', header: 'Domain', cell: (entry) => <StatusPill>{domainLabel(entry.domain)}</StatusPill> },
    { key: 'stake', header: 'Stake', align: 'right', cell: (entry) => formatAmount(entry.betAmount, entry.currency) },
    { key: 'ggr', header: 'P/L', align: 'right', cell: (entry) => amount(Number(entry.ggr), entry.currency) },
    { key: 'rate', header: 'Rate', align: 'right', cell: (entry) => `${(entry.commissionRate * 100).toFixed(2)}%` },
    { key: 'earned', header: 'Earned', align: 'right', cell: (entry) => <strong>{amount(Number(entry.commissionEarned), entry.currency)}</strong> },
  ]
  const detailColumns: DataTableColumn<CommissionHistoryEntry>[] = [
    { ...basicColumns[0], header: 'Time' }, basicColumns[1],
    { key: 'player', header: 'Player', emphasis: 'key', cell: (entry) => entry.playerName },
    { key: 'detail', header: 'Event / Game / Market', cell: (entry) => <div className={styles.detail}>
      <strong>{entry.domain === 'sports' ? entry.eventName || '—' : entry.domain === 'casino' ? entry.gameName || '—' : entry.marketName || '—'}</strong>
      <span className={styles.secondary}>{entry.domain === 'sports' ? `${entry.marketName || ''}${entry.selectionName ? ` › ${entry.selectionName}` : ''}` :
        entry.domain === 'casino' ? entry.vendorName || '' : [entry.matkaType, entry.bidType, entry.betNumbers].filter(Boolean).join(' · ')}</span>
    </div> },
    { key: 'type', header: 'Type', cell: (entry) => entry.domain === 'sports' && entry.side ? <StatusPill tone={entry.side.toLowerCase() === 'back' ? 'info' : 'warn'}>{entry.side}</StatusPill> : entry.domain === 'matka' ? entry.marketSession || '—' : '—' },
    basicColumns[2],
    { key: 'odds', header: 'Odds', align: 'right', cell: (entry) => entry.domain === 'sports' && entry.odds ? Number(entry.odds).toFixed(2) : entry.domain === 'matka' && entry.payoutMultiplier ? `×${Number(entry.payoutMultiplier).toFixed(1)}` : '—' },
    { key: 'payout', header: 'Payout', align: 'right', cell: (entry) => entry.domain === 'casino' && entry.payout != null ? formatAmount(entry.payout, entry.currency) :
      entry.domain === 'matka' && Number(entry.actualWin ?? 0) > 0 ? amount(Number(entry.actualWin), entry.currency) : '—' },
    { ...basicColumns[3], header: 'P/L (GGR)' },
    { key: 'status', header: 'Status', cell: (entry) => <StatusPill tone={entry.status?.toLowerCase() === 'won' ? 'ok' : entry.status?.toLowerCase() === 'lost' ? 'neg' : ['void', 'cancelled'].includes(entry.status?.toLowerCase() || '') ? 'muted' : 'info'}>{entry.status || '—'}</StatusPill> },
    basicColumns[4], { ...basicColumns[5], header: 'Comm' },
  ]
  const detailPage = Math.min(viewBetsFullDetailPage, Math.max(1, Math.ceil(viewBetsTotal / detailSize)))
  return <Dialog title={params ? `Commission bets — ${params.username ?? 'Agent'}` : 'View Bets'}
    open={open} onOpenChange={(value) => { if (!value) handleClose() }} size={viewBetsFullDetail ? 'xl' : 'lg'}>
    <div className={styles.stack}>
      {cyclesError && <Notice tone="error">{cyclesError.message}</Notice>}
      {historyError && <Notice tone="error">{historyError.message}</Notice>}
      {cyclesLoading && !viewBetsActiveCycle ? <LoadingState label="Loading commission cycles" /> :
        !viewBetsActiveCycle ? <EmptyState title={viewBetsAllCycles.length === 0 && !params?.cycleFrom ? 'No cycles found' : 'Loading selected cycle...'} /> : <>
        <div className={styles.controls}><span className={styles.secondary}>Cycle: {dayjs.utc(viewBetsActiveCycle.from).tz('Asia/Kolkata').format('DD MMM')} - {dayjs.utc(viewBetsActiveCycle.to).tz('Asia/Kolkata').subtract(1, 'day').format('DD MMM YYYY')}</span>
          <Switch label="Full detail" checked={viewBetsFullDetail} onChange={(checked) => { setViewBetsFullDetail(checked); setViewBetsFullDetailPage(1) }} /></div>
        <div className={styles.controls}>
          <SegmentedControl label="Bet domain" value={viewBetsDomainFilter || 'all'} size="sm" options={[
            { value: 'all', label: 'All' }, { value: 'sports', label: 'Sports' }, { value: 'casino', label: 'Casino' }, { value: 'matka', label: 'Matka' },
          ]} onChange={(value) => { setViewBetsDomainFilter(value === 'all' ? null : value as 'sports' | 'casino' | 'matka'); setViewBetsFullDetailPage(1) }} />
          <span className={styles.secondary}>Total: {viewBetsTotal} bets · This page: {viewBetsTopSummary.players} players</span>
        </div>
        {viewBetsLoading ? <LoadingState label="Loading commission bets" /> : !viewBetsEntries.length ? <EmptyState title={viewBetsFullDetail ? 'No bet details found for selected cycle' : 'No bets found for selected cycle'} /> :
          viewBetsFullDetail ? <DataTable columns={detailColumns} rows={viewBetsEntries}
            rowKey={(entry) => entry.id} label="Full commission bet detail" width="wide" density="compact"
            pagination={{ current: detailPage, pageSize: detailSize, total: viewBetsTotal, onChange: setViewBetsFullDetailPage, pageSizeOptions: [25, 50, 100], onPageSizeChange: (size) => { setDetailSize(size); setViewBetsFullDetailPage(1) }, itemName: 'bets' }} /> : <>
            <Pagination loading={viewBetsLoading} current={viewBetsFullDetailPage} pageSize={detailSize} total={viewBetsTotal} onChange={setViewBetsFullDetailPage} onPageSizeChange={size => { setDetailSize(size); setViewBetsFullDetailPage(1) }} pageSizeOptions={[25, 50, 100]} itemName="bets" />
            <div className={styles.metrics}>
              <Stat size="compact" label="Players" value={viewBetsTopSummary.players} />
              <Stat size="compact" label="Page stake" value={formatAmount(viewBetsTopSummary.totalStake, viewBetsCurrency)} />
              {showCasinoInfo && <Stat size="compact" label="Casino GGR" value={amount(viewBetsTopSummary.casinoPL, viewBetsCurrency)} />}
              {showSportsInfo && <Stat size="compact" label="Sport GGR" value={amount(viewBetsTopSummary.sportsPL, viewBetsCurrency)} />}
              {showMatkaInfo && <Stat size="compact" label="Matka GGR" value={amount(viewBetsTopSummary.matkaPL, viewBetsCurrency)} />}
              <Stat size="compact" label="Page GGR" value={amount(viewBetsTopSummary.overallPL, viewBetsCurrency)} />
            </div>
            <div className={styles.stack}>{viewBetsPlayerGroups.map((group) => <details key={group.playerId || group.playerName} className={styles.group}>
              <summary><strong>{group.playerName || 'Unknown'}</strong><span>Total GGR: {amount(group.totalPL, viewBetsCurrency)}</span><span>Total Stake: {formatAmount(group.totalStake, viewBetsCurrency)}</span></summary>
              <DataTable columns={basicColumns} rows={group.entries} rowKey={(entry) => entry.id} label={`Bets for ${group.playerName || 'Unknown'}`} pagination={false} width="wide" density="compact" />
            </details>)}</div>
          </>}
      </>}
    </div>
  </Dialog>
}
