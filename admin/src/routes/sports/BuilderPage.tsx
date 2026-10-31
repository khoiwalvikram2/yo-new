import { useMemo, useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";

import { useApolloClient, useQuery, useMutation } from "@apollo/client";
import {
  LIST_SPORTS,
  LIST_LEAGUES,
  LIST_PROVIDER_LEAGUES,
  LIST_PROVIDER_EVENTS,
  PERSIST_SELECTIONS,
  LIST_EXISTING_LEAGUES,
  LIST_EXISTING_EVENTS,
  LIST_AUTO_CONFIGS,
  LIST_AUTO_FREQUENCIES,
} from "@/lib/graphql/sports";
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog'
import { Tabs } from '@/ui/components/Tabs'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Button } from '@/ui/components/Button'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { builderEventPayload, builderRequireSuccess } from './builder-page-components/builderModel'
import styles from './builder-page-components/Builder.module.css'
// extracted components are lazy-loaded below
import type { Sport, League, Event } from "./builder-page-components/types";
const ManualBuilderPanel = lazy(
  () => import("./builder-page-components/ManualBuilderPanel")
);
const AutoBuilderPanel = lazy(
  () => import("./builder-page-components/AutoBuilderPanel")
);
const AuditPanel = lazy(() => import("./builder-page-components/AuditPanel"));
import { RBACGuard } from "@/shared/core/RBACGuard";

export default function SportsBuilderPage() {
  return (
    <RBACGuard required={[{ domain: 'sports.builder', actions: ['view'] }]}>
      <SportsBuilderPageContent />
    </RBACGuard>
  );
}

function SportsBuilderPageContent() {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [mode, setMode] = useState<"Manual" | "Auto" | "Audits">("Manual");
  const eyebrow = usePageEyebrow()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [providerRetry, setProviderRetry] = useState(0)
  // Auto mode state
  const [autoSportKeys, setAutoSportKeys] = useState<string[]>([]);
  const [leaguesOptionsBySport, setLeaguesOptionsBySport] = useState<
    Record<string, Array<{ label: string; value: string }>>
  >({});
  const [leaguesLoadingBySportAuto, setLeaguesLoadingBySportAuto] = useState<
    Record<string, boolean>
  >({});
  const [autoLeagueCodesBySport, setAutoLeagueCodesBySport] = useState<
    Record<string, string[]>
  >({});
  const [autoFrequencyBySport, setAutoFrequencyBySport] = useState<
    Record<string, number>
  >({});
  const [autoActiveBySport, setAutoActiveBySport] = useState<
    Record<string, boolean>
  >({});
  const [sports, setSports] = useState<Sport[]>([]);
  const [sportIdByKey, setSportIdByKey] = useState<Record<string, string>>({});
  const [sportCodeByKey, setSportCodeByKey] = useState<Record<string, string>>({});

  // Helper: shallow equality for Record<string, boolean>
  const shallowEqualBoolMap = (
    a: Record<string, boolean>,
    b: Record<string, boolean>
  ) => {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) if (a[k] !== b[k]) return false;
    return true;
  };

  const { data: sportsData, loading: sportsLoading, error: sportsError, refetch: refetchSports } = useQuery(LIST_SPORTS, {
    fetchPolicy: "cache-and-network",
  });
  const { data: autoConfigsData, loading: configsLoading, error: configsError, refetch: refetchAutoConfigs } = useQuery(
    LIST_AUTO_CONFIGS,
    { fetchPolicy: "cache-and-network", skip: mode !== "Auto" }
  );
  const { data: freqData } = useQuery(LIST_AUTO_FREQUENCIES, {
    fetchPolicy: "cache-first",
    skip: mode !== "Auto",
  });
  const apollo = useApolloClient();
  const [persistSelections] = useMutation(PERSIST_SELECTIONS);

  useEffect(() => {
    const rows = (sportsData?.sports ?? []) as Array<{
      id: string;
      key: string;
      name: string;
      sort: number;
      sportCode?: string;
    }>;
    if (!rows.length) return;
    const idMap: Record<string, string> = {};
    const codeMap: Record<string, string> = {};
    setSports((prev) => {
      const prevSelectedByKey = new Map(prev.map((s) => [s.key, s.selected]));
      const next = rows.map((r) => {
        idMap[r.key] = r.id;
        codeMap[r.key] = r.sportCode as string;
        const lower = r.name.toLowerCase();
        const isDefault = lower === "cricket";
        return {
          key: r.key,
          name: r.name,
          subtitle: "",
          icon: "",
          colorClass: "",
          selected: prevSelectedByKey.get(r.key) ?? isDefault,
        };
      });
      // Avoid unnecessary state updates if equal
      if (
        prev.length === next.length &&
        prev.every((p, i) =>
          p.key === next[i].key &&
          p.name === next[i].name &&
          p.selected === next[i].selected
        )
      ) {
        return prev;
      }
      return next;
    });
    setSportIdByKey(idMap);
    setSportCodeByKey(codeMap);
  }, [sportsData]);

  const keyBySportId = useMemo(() => {
    const map: Record<string, string> = {};
    Object.entries(sportIdByKey).forEach(([k, v]) => {
      map[v] = k;
    });
    return map;
  }, [sportIdByKey]);

  const ensureLeaguesOptionsForSport = useCallback(async (sportKey: string) => {
    if (leaguesOptionsBySport[sportKey]) return;
    const sportId = sportIdByKey[sportKey];
    if (!sportId) return;
    setLeaguesLoadingBySportAuto((prev) => ({ ...prev, [sportKey]: true }));
    try {
      const res = await apollo.query({
        query: LIST_LEAGUES,
        variables: { sportId },
      });
      const items = (res?.data?.leagues ?? []) as Array<{
        id: string;
        name: string;
      }>;
      setLeaguesOptionsBySport((prev) => ({
        ...prev,
        [sportKey]: items.map((i) => ({ label: i.name, value: i.id })),
      }));
    } finally {
      setLeaguesLoadingBySportAuto((prev) => ({ ...prev, [sportKey]: false }));
    }
  }, [apollo, leaguesOptionsBySport, sportIdByKey]);

  // Pre-fill Auto maps from saved configs
  useEffect(() => {
    const rows = (autoConfigsData?.autoSportsConfigs ?? []) as Array<{
      sportId: string;
      leagueCodes?: string[] | null;
      frequencyHours: number;
      active: boolean;
    }>;
    if (!rows.length) return;
    setAutoLeagueCodesBySport((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const sk = keyBySportId[String(r.sportId)];
        if (!sk) continue;
        next[sk] = (r.leagueCodes ?? []) as string[];
      }
      return next;
    });
    setAutoFrequencyBySport((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const sk = keyBySportId[String(r.sportId)];
        if (!sk) continue;
        next[sk] = Number(r.frequencyHours ?? 6);
      }
      return next;
    });
    setAutoActiveBySport((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const sk = keyBySportId[String(r.sportId)];
        if (!sk) continue;
        next[sk] = Boolean(r.active);
      }
      return next;
    });
  }, [autoConfigsData, keyBySportId]);

  useEffect(() => {
    const rows = (autoConfigsData?.autoSportsConfigs ?? []) as Array<{ sportId: string }>
    // Prefetch leagues options for all sports present in saved configs (for table rendering of league names)
    for (const r of rows) {
      const sk = keyBySportId[String(r.sportId)];
      if (sk) {
        void ensureLeaguesOptionsForSport(sk).catch(error => setLoadError(error instanceof Error ? error.message : "Unable to load saved leagues"));
      }
    }
  }, [autoConfigsData, keyBySportId, ensureLeaguesOptionsForSport, providerRetry]);

  const availableFrequencies = useMemo(
    () =>
      (freqData?.availableAutoFrequencies ?? [1, 2, 3, 6, 12, 24]) as number[],
    [freqData]
  );


  const [leagues, setLeagues] = useState<League[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [leaguesExpanded, setLeaguesExpanded] = useState<
    Record<string, boolean>
  >({});

  const [leaguesLoadingBySport, setLeaguesLoadingBySport] = useState<
    Record<string, boolean>
  >({});
  const selectedSports = useMemo(
    () => sports.filter((s) => s.selected),
    [sports]
  );
  const selectedSportsKeys = useMemo(
    () => selectedSports.map((s) => s.key).sort().join("|"),
    [selectedSports]
  );
  useEffect(() => {
    if (mode !== "Manual" || currentStep < 2) return;
    const selected = selectedSports;
    if (selected.length === 0) {
      setLeagues([]);
      setLeaguesLoading(false);
      setLeaguesLoadingBySport({});
      return;
    }
    (async () => {
      // mark all selected sports as loading and auto-expand their sections
      setLeaguesLoadingBySport(
        Object.fromEntries(selected.map((s) => [s.key, true]))
      );
      setLeaguesExpanded((prev) => ({
        ...prev,
        ...Object.fromEntries(selected.map((s) => [s.key, true])),
      }));
      // turn off global loading to show per-sport skeletons
      setLeaguesLoading(false);
      for (const s of selected) {
        const sportCode = sportCodeByKey[s.key];
        const sportId = sportIdByKey[s.key];
        if (!sportCode || !sportId) continue;
        try {
          const [leaguesRes, existingRes] = await Promise.all([
            apollo.query({ query: LIST_PROVIDER_LEAGUES, variables: { sportCode } }),
            apollo.query({
              query: LIST_EXISTING_LEAGUES,
              variables: { sportId },
            }),
          ]);
          const existingCodes = new Set<string>(
            (existingRes?.data?.existingLeagueCodes ?? []).map((x: string) =>
              String(x)
            )
          );
          const items = (leaguesRes?.data?.providerLeagues ?? []) as Array<{
            id: string;
            name: string;
          }>;
          const nextForSport: League[] = items.map((item) => ({
            id: item.id,
            key: `${s.key}-${(item.name || "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")}`,
            sportKey: s.key,
            name: item.name,
            selected: false,
            alreadyAdded: existingCodes.has(String(item.id)),
          }));
          setLeagues((prev) => {
            const withoutSport = prev.filter((l) => l.sportKey !== s.key);
            const merged = [...withoutSport, ...nextForSport.map(item => ({ ...item, selected: prev.find(previous => previous.id === item.id && previous.sportKey === s.key)?.selected ?? item.selected }))];
            // keep alphabetical order by name per sport in UI later
            return merged;
          });
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "Unable to load provider leagues");
        } finally {
          setLeaguesLoadingBySport((prev) => {
            const next = { ...prev };
            delete next[s.key];
            return next;
          });
        }
      }
      // ensure global loading stays off; per-sport flags handle UI now
    })();
  }, [mode, currentStep, selectedSportsKeys, selectedSports, sportIdByKey, sportCodeByKey, apollo, providerRetry]);

  

  // Set leagues expanded by default when leagues are loaded
  useEffect(() => {
    if (leagues.length > 0) {
      setLeaguesExpanded((prev) => {
        const draft: Record<string, boolean> = { ...prev };
        selectedSports.forEach((s) => {
          const hasLeagues = leagues.some((l) => l.sportKey === s.key);
          if (hasLeagues && typeof draft[s.key] === "undefined") {
            draft[s.key] = true; // Default to expanded
          }
        });
        return shallowEqualBoolMap(prev, draft) ? prev : draft;
      });
    }
  }, [leagues, selectedSports]);

  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoadingByLeague, setEventsLoadingByLeague] = useState<
    Record<string, boolean>
  >({});
  const selectedLeaguesKeys = useMemo(
    () =>
      leagues
        .filter((l) => l.selected)
        .map((l) => l.key)
        .sort()
        .join("|"),
    [leagues]
  );

  useEffect(() => {
    if (mode !== "Manual" || currentStep < 3) return;
    const selectedLeagues = leagues.filter((l) => l.selected);
    if (selectedLeagues.length === 0) {
      setEvents([]);
      setEventsLoadingByLeague({});
      return;
    }
    (async () => {
      // mark all selected leagues as loading
      setEventsLoadingByLeague((prev) => ({
        ...prev,
        ...Object.fromEntries(selectedLeagues.map((l) => [l.key, true])),
      }));
      for (const l of selectedLeagues) {
        const providerLeagueId = l.id;
        if (!providerLeagueId) continue;
        try {
          const [eventsRes, existingRes] = await Promise.all([
            apollo.query({
              query: LIST_PROVIDER_EVENTS,
              variables: { leagueId: providerLeagueId },
            }),
            apollo.query({
              query: LIST_EXISTING_EVENTS,
              variables: { leagueCode: providerLeagueId },
            }),
          ]);
          const existingCodes = new Set<string>(
            (existingRes?.data?.existingEventCodes ?? []).map((x: string) =>
              String(x)
            )
          );
          const items = (eventsRes?.data?.providerEvents ?? []) as Array<{
            id: string;
            name: string;
            startTime?: string;
          }>;
          const nextForLeague = items.map((item) => ({
            id: item.id,
            key: `${l.key}-${(item.name || "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")}`,
            leagueKey: l.key,
            sportKey: l.sportKey,
            name: item.name,
            selected: false,
            startTime: item.startTime,
            alreadyAdded: existingCodes.has(String(item.id)),
          })) as Event[];
          setEvents((prev) => {
            const withoutLeague = prev.filter((e) => e.leagueKey !== l.key);
            const merged = [...withoutLeague, ...nextForLeague.map(item => ({ ...item, selected: prev.find(previous => previous.id === item.id && previous.leagueKey === l.key)?.selected ?? item.selected }))];
            return merged.sort((a, b) => {
              const at = a.startTime ? Date.parse(a.startTime) : 0;
              const bt = b.startTime ? Date.parse(b.startTime) : 0;
              if (at !== bt) return at - bt;
              return a.name.localeCompare(b.name);
            });
          });
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "Unable to load provider events");
        } finally {
          setEventsLoadingByLeague((prev) => {
            const next = { ...prev };
            delete next[l.key];
            return next;
          });
        }
      }
    })();
  }, [mode, currentStep, selectedLeaguesKeys, leagues, apollo, providerRetry]);

  const toggleEvent = (eventId: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, selected: !e.selected } : e))
    );
  };

  const onToggleLeagueEvents = (leagueKey: string, checked: boolean) => {
    setEvents((prev) =>
      prev.map((e) =>
        e.leagueKey === leagueKey ? { ...e, selected: checked } : e
      )
    );
  };

  const selectedCount = useMemo(
    () => sports.filter((s) => s.selected).length,
    [sports]
  );

  const leaguesToShow = useMemo(() => {
    const keys = new Set(selectedSports.map((s) => s.key));
    return leagues.filter((l) => keys.has(l.sportKey));
  }, [leagues, selectedSports]);

  // toggleLeague removed; selection handled via section-specific handlers

  // page-level select/clear all across sports not used in UI anymore
  const selectAllLeaguesForSport = (sportKey: string) =>
    setLeagues((prev) =>
      prev.map((l) => (l.sportKey === sportKey ? { ...l, selected: true } : l))
    );
  const clearAllLeaguesForSport = (sportKey: string) =>
    setLeagues((prev) =>
      prev.map((l) => (l.sportKey === sportKey ? { ...l, selected: false } : l))
    );
  const toggleLeague = (leagueKey: string) =>
    setLeagues((prev) =>
      prev.map((l) =>
        l.key === leagueKey ? { ...l, selected: !l.selected } : l
      )
    );
  const toggleSportLeagues = (sportKey: string) =>
    setLeaguesExpanded((prev) => ({ ...prev, [sportKey]: !prev[sportKey] }));
  const expandAllLeagues = () =>
    setLeaguesExpanded(
      Object.fromEntries(selectedSports.map((s) => [s.key, true]))
    );
  const collapseAllLeagues = () =>
    setLeaguesExpanded(
      Object.fromEntries(selectedSports.map((s) => [s.key, false]))
    );

  // no per-event toggles in this step

  // Events section: per-sport collapse state
  const [eventsExpanded, setEventsExpanded] = useState<Record<string, boolean>>(
    {}
  );
  useEffect(() => {
    // Ensure selected sports have an entry (default expanded)
    setEventsExpanded((prev) => {
      const draft: Record<string, boolean> = { ...prev };
      selectedSports.forEach((s) => {
        if (typeof draft[s.key] === "undefined") draft[s.key] = true;
      });
      // Remove keys for unselected sports
      Object.keys(draft).forEach((k) => {
        if (!selectedSports.find((s) => s.key === k)) delete draft[k];
      });
      return shallowEqualBoolMap(prev, draft) ? prev : draft;
    });
  }, [selectedSports]);
  const toggleSportEvents = (sportKey: string) =>
    setEventsExpanded((prev) => ({ ...prev, [sportKey]: !prev[sportKey] }));
  const expandAllEvents = () =>
    setEventsExpanded(
      Object.fromEntries(selectedSports.map((s) => [s.key, true]))
    );
  const collapseAllEvents = () =>
    setEventsExpanded(
      Object.fromEntries(selectedSports.map((s) => [s.key, false]))
    );

  // Review section: per-sport and per-league collapse state
  const [reviewExpanded, setReviewExpanded] = useState<Record<string, boolean>>(
    {}
  );
  const [leagueExpanded, setLeagueExpanded] = useState<Record<string, boolean>>(
    {}
  );
  
  useEffect(() => {
    // Initialize review expanded state for selected sports (default expanded)
    setReviewExpanded((prev) => {
      const draft: Record<string, boolean> = { ...prev };
      selectedSports.forEach((s) => {
        if (typeof draft[s.key] === "undefined") draft[s.key] = true;
      });
      // Remove keys for unselected sports
      Object.keys(draft).forEach((k) => {
        if (!selectedSports.find((s) => s.key === k)) delete draft[k];
      });
      return shallowEqualBoolMap(prev, draft) ? prev : draft;
    });
  }, [selectedSports]);

  const toggleSportReview = (sportKey: string) =>
    setReviewExpanded((prev) => ({ ...prev, [sportKey]: !prev[sportKey] }));
  const toggleLeagueReview = (leagueKey: string) =>
    setLeagueExpanded((prev) => ({ ...prev, [leagueKey]: !prev[leagueKey] }));

  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const confirmationPromise = useRef<Promise<void> | null>(null)

  const toggleSport = (key: string) => {
    setSports((prev) =>
      prev.map((s) => (s.key === key ? { ...s, selected: !s.selected } : s))
    );
  };

  const selectAll = () =>
    setSports((prev) => prev.map((s) => ({ ...s, selected: true })));
  const clearAll = () =>
    setSports((prev) => prev.map((s) => ({ ...s, selected: false })));


  const confirmSelection = async () => {
    if (confirmationPromise.current) return confirmationPromise.current
    const request = (async () => {
      const payload = builderEventPayload(selectedSports, leagues, events, sportIdByKey)
      if (!payload.length) return
      builderRequireSuccess(await persistSelections({ variables: { events: payload } }), 'persistSportsSelections')
      setCurrentStep(1); setLeagues([]); setEvents([]); setLeaguesExpanded({}); setEventsExpanded({}); setReviewExpanded({}); setLeagueExpanded({})
      await apollo.refetchQueries({ include: [LIST_SPORTS] })
      setSports(previous => previous.map(sport => ({ ...sport, selected: sport.name.toLowerCase() === 'cricket' })))
    })()
    confirmationPromise.current = request
    try { await request } finally { confirmationPromise.current = null }
  }
  const selectedEvents = events.filter(event => event.selected && selectedSports.some(sport => sport.key === event.sportKey) && leagues.some(league => league.key === event.leagueKey && league.selected))
  const selectedLeagueCount = leagues.filter(league => league.selected && selectedSports.some(sport => sport.key === league.sportKey) && selectedEvents.some(event => event.leagueKey === league.key)).length
  return <Page><PageHeader title="Sports Builder" eyebrow={eyebrow} sub={mode === 'Manual' ? 'Add sports events to your platform' : mode === 'Auto' ? 'Configure automated sports ingestion' : 'Recent changes & audit trails'}
    actions={<Tabs label="Builder mode" idPrefix="sports-builder" value={mode} onChange={setMode} items={[{ value: 'Manual', label: 'Manual' }, { value: 'Auto', label: 'Auto' }, { value: 'Audits', label: 'Audits' }]} />} />
    <div className={styles.stack}>
      {sportsError && <Notice tone="error" title="Unable to load sports" action={<Button size="sm" onClick={() => { void refetchSports().catch(() => undefined) }}>Retry</Button>}>{sportsError.message}</Notice>}
      {loadError && <Notice tone="error" title="Provider data could not be loaded" action={<Button size="sm" onClick={() => { setLoadError(null); setProviderRetry(value => value + 1) }}>Retry provider data</Button>}>{loadError}</Notice>}
      <div role="tabpanel" id={`sports-builder-panel-${mode}`} aria-labelledby={`sports-builder-tab-${mode}`}>
        {mode === 'Manual' && <Suspense fallback={<LoadingState label="Loading manual builder" />}>
          {sportsLoading && !sportsData ? <LoadingState label="Loading sports" /> : <ManualBuilderPanel
            currentStep={currentStep} onStepChange={setCurrentStep} sports={sports} selectedCount={selectedCount} selectedSports={selectedSports}
            leaguesToShow={leaguesToShow} leagues={leagues} events={events} leaguesLoading={leaguesLoading} leaguesExpanded={leaguesExpanded} leaguesLoadingBySport={leaguesLoadingBySport}
            eventsExpanded={eventsExpanded} eventsLoadingByLeague={eventsLoadingByLeague} reviewExpanded={reviewExpanded} leagueExpanded={leagueExpanded}
            toggleSport={toggleSport} selectAll={selectAll} clearAll={clearAll} selectAllLeaguesForSport={selectAllLeaguesForSport} clearAllLeaguesForSport={clearAllLeaguesForSport}
            toggleLeague={toggleLeague} toggleSportLeagues={toggleSportLeagues} expandAllLeagues={expandAllLeagues} collapseAllLeagues={collapseAllLeagues}
            toggleSportEvents={toggleSportEvents} onToggleLeagueEvents={onToggleLeagueEvents} toggleEvent={toggleEvent} expandAllEvents={expandAllEvents} collapseAllEvents={collapseAllEvents}
            toggleSportReview={toggleSportReview} toggleLeagueReview={toggleLeagueReview} onRequestConfirm={() => setConfirmationOpen(true)} />}
        </Suspense>}
        {mode === 'Auto' && <Suspense fallback={<LoadingState label="Loading auto builder" />}>
          {configsError && <Notice tone="error" title="Unable to load auto configurations" action={<Button size="sm" onClick={() => { void refetchAutoConfigs().catch(() => undefined) }}>Retry</Button>}>{configsError.message}</Notice>}
          {configsLoading && !autoConfigsData ? <LoadingState label="Loading auto configurations" /> : <AutoBuilderPanel sports={sports} autoSportKeys={autoSportKeys} setAutoSportKeys={setAutoSportKeys}
            leaguesOptionsBySport={leaguesOptionsBySport} leaguesLoadingBySportAuto={leaguesLoadingBySportAuto} autoLeagueCodesBySport={autoLeagueCodesBySport} setAutoLeagueCodesBySport={setAutoLeagueCodesBySport}
            autoFrequencyBySport={autoFrequencyBySport} setAutoFrequencyBySport={setAutoFrequencyBySport} autoActiveBySport={autoActiveBySport} setAutoActiveBySport={setAutoActiveBySport}
            sportIdByKey={sportIdByKey} keyBySportId={keyBySportId} ensureLeaguesOptionsForSport={ensureLeaguesOptionsForSport} autoConfigsData={autoConfigsData} refetchAutoConfigs={refetchAutoConfigs} availableFrequencies={availableFrequencies} />}
        </Suspense>}
        {mode === 'Audits' && <Suspense fallback={<LoadingState label="Loading audits" />}><AuditPanel /></Suspense>}
      </div>
    </div>
    <ConfirmDialog open={confirmationOpen} onOpenChange={setConfirmationOpen} title="Confirm Addition" confirmLabel="Confirm & Add"
      description={`Only leagues with selected events will be added: ${selectedCount} sports, ${selectedLeagueCount} leagues and ${selectedEvents.length} events. These items will be added to your sports platform.`}
      onConfirm={confirmSelection} />
  </Page>
}
