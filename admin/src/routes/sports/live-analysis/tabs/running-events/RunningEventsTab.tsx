import { useState, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { LIST_RUNNING_EVENTS } from '@/lib/graphql/sports';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { FilterBar } from '@/ui/components/FilterBar';
import { SearchField } from '@/ui/components/SearchField';
import { Select } from '@/ui/components/Select';
import { Stat } from '@/ui/components/Stat';
import { StatusPill } from '@/ui/components/StatusPill';
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable';
import { Pagination } from '@/ui/components/Pagination';
import { IconTrophy } from '@tabler/icons-react';
import { strokeFor } from '@/ui/components/icons';
import styles from '../../SportsLive.module.css';
interface RunningEventsTabProps {
  didAnimate: boolean;
}

interface SportsEvent {
  id: string;
  sport: string;
  competition: string;
  name: string;
  startTime: string;
  status: string;
  marketCount: number;
  matchedVolume: number;
  totalLiquidity: number;
  betsCount: number;
  inPlay: boolean;
  updatedAt: string;
  lastBetAt?: string | null;
}

// Import sport icons
const sportImages = import.meta.glob(
  "@/assets/images/sports/*.{png,jpg,jpeg,svg,webp}",
  {
    eager: true,
    import: "default",
  }
) as Record<string, string>;
const sportIconMap: Record<string, string> = Object.entries(
  sportImages
).reduce((acc, [path, url]) => {
  const file = path.split("/").pop() || "";
  const base = file.replace(/\.(png|jpg|jpeg|svg|webp)$/i, "").toLowerCase();
  acc[base] = url as unknown as string;
  return acc;
}, {} as Record<string, string>);


function SportImage({ src, sport }: { src: string; sport: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? <img src={src} alt={sport} className={styles.sportIcon} onError={() => setFailed(true)} /> : <IconTrophy size={22} stroke={strokeFor(22)} aria-hidden="true" />;
}
export function RunningEventsTab(props: RunningEventsTabProps) {
  void props;
  const navigate = useNavigate();
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } =
    useCurrency();
  const { formatDate, formatDateTime } = useFormatDate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchQuery, setSearchQuery] = useState("");
  const [sportFilter, setSportFilter] = useState<string | undefined>();

  const { data, loading, refetch } = useQuery<{ runningEvents: SportsEvent[] }>(LIST_RUNNING_EVENTS, {
    variables: {
      sport: sportFilter || undefined,
      // Note: Agent filtering is handled automatically by backend
      // Backend filters events to only show those where agent's players have bets
      // If agent has no players, returns empty array
    },
    pollInterval: 5000,
    // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    // Whitelabel context is sent via headers, not query variables, so Apollo cache
    // would otherwise serve stale data from the previous whitelabel selection
    fetchPolicy: "network-only",
  });

  const events = useMemo(() => data?.runningEvents || [], [data?.runningEvents]);

  // Filter events by search query
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const matchesSearch =
        !searchQuery ||
        event.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.competition.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.sport.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesSearch;
    });
  }, [events, searchQuery]);

  // Pagination
  const totalEvents = filteredEvents.length;
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedEvents = filteredEvents.slice(startIndex, endIndex);

  // Get unique sports for filter
  const uniqueSports = useMemo(() => {
    const sports = new Set(events.map((e) => e.sport));
    return Array.from(sports).sort();
  }, [events]);

  // Calculate time since last update
  const getTimeSinceUpdate = (updatedAt: string) => {
    const now = new Date().getTime();
    const updated = new Date(updatedAt).getTime();
    const diff = now - updated;

    if (diff < 0) return "Just now";

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return formatDate(updatedAt, "MMM d");
  };

  // Calculate time until event starts
  const getTimeUntilStart = (
    startTime: string,
    status: string,
    inPlay: boolean
  ) => {
    const now = new Date().getTime();
    const start = new Date(startTime).getTime();
    const diff = start - now;

    if (status === "finished") {
      return "Finished";
    }

    if (inPlay) {
      return "LIVE NOW";
    }

    if (diff < 0) {
      return "Started";
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Format currency
  const formatCurrency = (value: number) => {
    const convertedValue = convertFromWhitelabelCurrency(value);
    const symbol = getCurrencySymbol();

    if (convertedValue >= 1000000) {
      return `${symbol}${(convertedValue / 1000000).toFixed(1)}M`;
    }
    if (convertedValue >= 1000) {
      return `${symbol}${(convertedValue / 1000).toFixed(1)}K`;
    }
    return formatAmount(convertedValue, undefined);
  };

  // Get sport image path
  const getSportImage = (sport: string) => {
    const sportKey = sport.toLowerCase().replace(/\s+/g, "-");
    return sportIconMap[sportKey] || sportIconMap["live"] || "";
  };

  const handleViewEvent = (eventId: string) => {
    navigate(`/sports/event/${eventId}`);
  };


  const [sort, setSort] = useState<DataTableSort | null>(null);
  const columns: DataTableColumn<SportsEvent>[] = [
    { key: 'eventDetails', header: 'Event Details', width: 280, cell: event => <div className={styles.event}><SportImage src={getSportImage(event.sport)} sport={event.sport} /><div className={styles.eventText}><Button variant="link" size="sm" onClick={() => handleViewEvent(event.id)} title={event.name}>{event.name}</Button><span className={styles.muted}>{event.sport} • {event.competition}</span>{event.inPlay && <StatusPill tone="ok">Live</StatusPill>}</div></div> },
    { key: 'startTime', header: 'Start Time', width: 130, cell: event => { const timeUntil = getTimeUntilStart(event.startTime, event.status, event.inPlay); const soon = !event.inPlay && event.status !== 'finished' && !['Started', 'Finished', 'LIVE NOW'].includes(timeUntil) && new Date(event.startTime).getTime() - Date.now() < 3600000 && new Date(event.startTime).getTime() > Date.now(); return <div className={styles.eventText}><strong>{formatDateTime(event.startTime, 'MMM d, HH:mm')}</strong><StatusPill tone={event.status === 'finished' ? 'neutral' : event.inPlay ? 'neg' : soon ? 'warn' : 'neutral'}>{event.status === 'finished' ? 'Finished' : event.inPlay ? 'LIVE NOW' : timeUntil}</StatusPill></div> } },
    { key: 'marketCount', header: 'Markets', align: 'center', cell: event => <div className={styles.eventText}><strong>{event.marketCount}</strong><span className={styles.muted}>{event.marketCount > 50 ? 'High' : event.marketCount > 20 ? 'Medium' : 'Low'}</span></div>, sort: (a, b) => a.marketCount - b.marketCount },
    { key: 'exposures', header: 'Exposures', align: 'right', cell: event => <div className={styles.eventText}><strong className={styles.positive}>{formatCurrency(event.totalLiquidity)}</strong><span className={styles.muted}>{event.betsCount?.toLocaleString() || 0} bets</span></div>, sort: (a, b) => a.totalLiquidity - b.totalLiquidity },
    { key: 'status', header: 'Status', align: 'center', cell: event => <StatusPill tone={event.status === 'in_play' || event.inPlay ? 'ok' : event.status === 'suspended' ? 'warn' : event.status === 'finished' ? 'neg' : event.status === 'upcoming' ? 'info' : 'neutral'}>{event.status === 'finished' ? 'FINISHED' : event.status === 'in_play' || event.inPlay ? 'IN_PLAY' : event.status === 'upcoming' ? 'UPCOMING' : event.status === 'suspended' ? 'SUSPENDED' : event.status?.toUpperCase() || 'UPCOMING'}</StatusPill> },
    { key: 'activity', header: 'Recent Activity', cell: event => event.lastBetAt ? <div className={styles.eventText}><strong>{getTimeSinceUpdate(event.lastBetAt)}</strong><span className={styles.muted}>{formatDateTime(event.lastBetAt, 'MMM d, HH:mm')}</span></div> : <span className={styles.muted}>No bets yet</span> },
    { key: 'actions', header: 'Actions', cell: event => <Button variant="primary" size="sm" onClick={() => handleViewEvent(event.id)} aria-label={`View Event ${event.name}`}>View</Button> },
  ];
  // Calculate summary stats
  const summaryStats = useMemo(() => {
    return {
      totalEvents: filteredEvents.length,
      totalMarkets: filteredEvents.reduce((sum, e) => sum + (e.marketCount || 0), 0),
      totalLiquidity: filteredEvents.reduce((sum, e) => sum + (e.totalLiquidity || 0), 0),
      totalBets: filteredEvents.reduce((sum, e) => sum + (e.betsCount || 0), 0),
      inPlayCount: filteredEvents.filter((e) => e.inPlay).length,
    };
  }, [filteredEvents]);

  return <ErrorBoundary><div className={styles.stack}><div className={styles.metrics}><Stat label="Total Events" value={summaryStats.totalEvents} hue="blu" size="compact" /><Stat label="Total Markets" value={summaryStats.totalMarkets} hue="vio" size="compact" /><Stat label="Total Liquidity" value={formatAmount(convertFromWhitelabelCurrency(summaryStats.totalLiquidity))} hue="grn" size="compact" /><Stat label="In Play" value={summaryStats.inPlayCount} hue="red" size="compact" /></div>
    <FilterBar label="Running event filters" activeCount={[searchQuery, sportFilter].filter(Boolean).length} onClearAll={() => { setSearchQuery(''); setSportFilter(undefined); setPage(1); }} search={<SearchField label="Search running events" placeholder="Search events, competitions..." value={searchQuery} onChange={value => { setSearchQuery(value); setPage(1); }} size="sm" />}><Select label="Filter by Sport" value={sportFilter || ''} onChange={value => { setSportFilter(value || undefined); setPage(1); }} options={[{ label: 'All sports', value: '' }, ...uniqueSports.map(sport => ({ label: sport, value: sport }))]} size="sm" /></FilterBar>
    <Card title="Running Events" sub={`${totalEvents} · Auto-refreshing every 5s`} body="table" tools={<Button size="sm" loading={loading} onClick={() => void refetch()}>Refresh</Button>}><DataTable label="Running Events" columns={columns} rows={paginatedEvents} rowKey={event => event.id} pagination={false} sort={sort} onSortChange={setSort} state={loading ? 'loading' : 'ready'} empty={searchQuery || sportFilter ? 'No events found. Try adjusting your filters or search query.' : 'No running events. Events will appear here when they are active.'} />{totalEvents > 0 && <Pagination current={page} pageSize={pageSize} total={totalEvents} onChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1); }} pageSizeOptions={[10, 25, 50, 100]} itemName="events" formatSummary={() => `Showing ${startIndex + 1}–${Math.min(endIndex, totalEvents)} of ${totalEvents.toLocaleString()} ${totalEvents === 1 ? 'event' : 'events'}`} />}</Card>
  </div></ErrorBoundary>;
}

