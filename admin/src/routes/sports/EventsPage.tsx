import { useState, useMemo, useId, type ReactNode } from "react";
import {
  IconBolt,
  IconClearAll,
  IconClock,
  IconFilter,
  IconFlame,
  IconLayoutGrid,
  IconRefresh,
  IconStar,
  IconTable,
} from "@tabler/icons-react";
import { useQuery } from "@apollo/client";
import { useSearchParams } from "react-router-dom";
import { LIST_RUNNING_EVENTS } from "@/lib/graphql/sports";
import { useSearchParamUpdates } from "@/shared/hooks/useSearchParamUpdates";
import { useSportsEventsStore } from "@/state/sportsEventsStore";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { usePageEyebrow } from "@/shell/PageEyebrowContext";
import { Badge } from "@/ui/components/Badge";
import { Button } from "@/ui/components/Button";
import { Card } from "@/ui/components/Card";
import { FilterBar } from "@/ui/components/FilterBar";
import { Page } from "@/ui/components/Page";
import { PageHeader } from "@/ui/components/PageHeader";
import { SearchField } from "@/ui/components/SearchField";
import { SegmentedControl, type SegmentedOption } from "@/ui/components/SegmentedControl";
import { Switch } from "@/ui/components/Switch";
import { Tabs, type TabItem } from "@/ui/components/Tabs";
import { tabId, tabPanelId } from "@/ui/components/tabIds";
import { strokeFor } from "@/ui/components/icons";
import {
  EventsFilters,
  type EventsFiltersValues,
} from "./components/EventsFilters";
import { EventsTable, type SportsEvent } from "./components/EventsTable";
import { EventCards } from "./components/EventCards";
import { EventsStats } from "./components/EventsStats";
import {
  QUICK_FILTERS,
  computeEventsStats,
  countActiveEventFilters,
  eventCompetitionOptions,
  eventCountLabel,
  filterEvents,
  formatCompactAmount,
  isQuickFilter,
  type QuickFilter,
} from "./eventsPageModel";
import { RBACGuard } from "@/shared/core/RBACGuard";
import styles from "./EventsPage.module.css";

export default function EventsPage() {
  return (
    <RBACGuard required={[{ domain: 'sports.events', actions: ['view'] }]} bypassForAgents>
      <EventsPageContent />
    </RBACGuard>
  );
}

// The quick-filter rail shows no button pressed while no quick filter applies.
const NO_QUICK_FILTER = "none";
type QuickFilterValue = QuickFilter | typeof NO_QUICK_FILTER;

const QUICK_FILTER_ICONS: Record<QuickFilter, ReactNode> = {
  live: <IconFlame size={14} stroke={strokeFor(14)} />,
  "high-liquidity": <IconBolt size={14} stroke={strokeFor(14)} />,
  favorite: <IconStar size={14} stroke={strokeFor(14)} />,
  "starting-soon": <IconClock size={14} stroke={strokeFor(14)} />,
};

const QUICK_FILTER_OPTIONS: readonly SegmentedOption<QuickFilterValue>[] = QUICK_FILTERS.map(
  (filter) => ({ ...filter, icon: QUICK_FILTER_ICONS[filter.value] })
);

const VIEW_TABS_ID = "sports-events-view";
const VIEW_TABS: readonly TabItem<"table" | "cards">[] = [
  { value: "table", label: "Table", icon: <IconTable size={15} stroke={strokeFor(15)} /> },
  { value: "cards", label: "Cards", icon: <IconLayoutGrid size={15} stroke={strokeFor(15)} /> },
];

/** The legacy count badge, with the number also said in words for assistive tech. */
function FilterCount({ count, label, tone = "soft" }: { count: number; label: string; tone?: "soft" | "solid" }) {
  if (count <= 0) return null;
  return (
    <span className={styles.filterCount}>
      <Badge count={count} tone={tone} aria-hidden="true" />
      <span className={styles.visuallyHidden}>{label}</span>
    </span>
  );
}

function EventsPageContent() {
  const { viewMode, setViewMode, favoriteEvents } = useSportsEventsStore();
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency();
  const pageEyebrow = usePageEyebrow();
  const filtersPanelId = useId();
  const [filters, setFilters] = useState<EventsFiltersValues>({});
  // A link may carry the search (?search=, the global search's "See all Sports").
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("search") ?? "");
  useSearchParamUpdates(setSearchQuery);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter | null>(null);
  // Clear All also empties the open form, which remounts on the cleared filters.
  const [filtersFormKey, setFiltersFormKey] = useState(0);

  // GraphQL query for events
  const { data, loading, error, refetch } = useQuery(LIST_RUNNING_EVENTS, {
    variables: {
      sport: filters.sport,
      from: filters.timeRange?.[0]?.toISOString(),
      to: filters.timeRange?.[1]?.toISOString(),
    },
    pollInterval: autoRefresh ? 5000 : 0,
    // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    // Whitelabel context is sent via headers, not query variables
    fetchPolicy: "network-only",
  });

  const events = useMemo<SportsEvent[]>(() => data?.runningEvents || [], [data]);
  // The Competition filter offers the competitions of the events loaded (the sport filter included).
  const competitionOptions = useMemo(() => eventCompetitionOptions(events), [events]);

  // Search, status, competition and the quick filter run here, over the server's answer. The
  // favourites are a dependency so un-starring an event leaves the Favorite list at once.
  const filteredEvents = useMemo(
    () =>
      filterEvents(events, {
        searchQuery,
        filters,
        quickFilter,
        isFavorite: (eventId) => favoriteEvents.has(eventId),
        now: Date.now(),
      }),
    [events, searchQuery, filters, quickFilter, favoriteEvents]
  );

  // The header figures, over the events the filters leave.
  const stats = useMemo(() => computeEventsStats(filteredEvents, Date.now()), [filteredEvents]);

  const handleClearFilters = () => {
    setFilters({});
    setSearchQuery("");
    setQuickFilter(null);
    setFiltersFormKey((key) => key + 1);
  };

  // A failed refetch is shown by the error state; it is not thrown a second time.
  const handleRefresh = () => {
    refetch().catch(() => undefined);
  };

  const activeFilterCount = countActiveEventFilters(filters, searchQuery, quickFilter);

  const liabilityDisplay = formatCompactAmount(
    convertFromWhitelabelCurrency(stats.totalLiquidity),
    getCurrencySymbol(),
    formatAmount
  );

  // Any stored view other than "table" shows the cards, as before.
  const view = viewMode === "table" ? "table" : "cards";
  const errorMessage = error?.message;

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Sports Events"
        sub="Monitor and manage live and upcoming sporting events"
        actions={
          <>
            <Switch label="Auto-refresh" checked={autoRefresh} onChange={setAutoRefresh} />
            <Button
              icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
              loading={loading}
              onClick={handleRefresh}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className={styles.content}>
        <EventsStats stats={stats} liability={liabilityDisplay} />

        <FilterBar
          label="Event filters"
          activeCount={activeFilterCount}
          onClearAll={handleClearFilters}
          search={
            <SearchField
              label="Search events"
              placeholder="Search events..."
              size="sm"
              value={searchQuery}
              onChange={setSearchQuery}
            />
          }
        >
          <SegmentedControl<QuickFilterValue>
            className={styles.quick}
            label="Quick filters"
            size="sm"
            value={quickFilter ?? NO_QUICK_FILTER}
            options={QUICK_FILTER_OPTIONS}
            onChange={(value) =>
              setQuickFilter(isQuickFilter(value) && value !== quickFilter ? value : null)
            }
          />
          <Button
            size="sm"
            variant={showFilters ? "primary" : "secondary"}
            icon={<IconFilter size={15} stroke={strokeFor(15)} />}
            aria-expanded={showFilters}
            aria-controls={showFilters ? filtersPanelId : undefined}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters
            <FilterCount count={activeFilterCount} label={`, ${activeFilterCount} applied`} />
          </Button>
        </FilterBar>

        {showFilters ? (
          <Card
            id={filtersPanelId}
            title="Advanced Filters"
            sub="Refine your search with detailed filter criteria"
            tools={
              <>
                <FilterCount
                  count={activeFilterCount}
                  tone="solid"
                  label={`${activeFilterCount} applied`}
                />
                <Button
                  size="sm"
                  variant="danger"
                  icon={<IconClearAll size={15} stroke={strokeFor(15)} />}
                  onClick={handleClearFilters}
                  disabled={activeFilterCount === 0}
                >
                  Clear All
                </Button>
              </>
            }
          >
            <EventsFilters
              key={filtersFormKey}
              onFilter={setFilters}
              loading={loading}
              initialValues={filters}
              competitionOptions={competitionOptions}
            />
          </Card>
        ) : null}

        <Card
          title="Events Management"
          sub={eventCountLabel(filteredEvents.length)}
          body="table"
          tools={
            <Tabs
              label="Events view"
              idPrefix={VIEW_TABS_ID}
              size="sm"
              value={view}
              items={VIEW_TABS}
              onChange={setViewMode}
            />
          }
        >
          <div
            className={styles.viewPanel}
            role="tabpanel"
            id={tabPanelId(VIEW_TABS_ID, view)}
            aria-labelledby={tabId(VIEW_TABS_ID, view)}
          >
            {view === "table" ? (
              <EventsTable
                events={filteredEvents}
                loading={loading}
                error={errorMessage}
                onRetry={handleRefresh}
              />
            ) : (
              <EventCards
                events={filteredEvents}
                loading={loading}
                error={errorMessage}
                onRetry={handleRefresh}
              />
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
