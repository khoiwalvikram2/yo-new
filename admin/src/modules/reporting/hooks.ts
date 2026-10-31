import { useQuery, useMutation } from '@apollo/client';
import {
  SPORTS_KPIS_QUERY,
  SPORTS_TRENDS_QUERY,
  SPORTS_BREAKDOWN_QUERY,
  TOP_SPORTS_EVENTS_QUERY,
  CASINO_KPIS_QUERY,
  CASINO_TRENDS_QUERY,
  MATKA_KPIS_QUERY,
  MATKA_TRENDS_QUERY,
  AGENT_KPIS_QUERY,
  AGENT_PERFORMANCE_QUERY,
  AGENT_TRENDS_QUERY,
  SAVED_REPORTS_QUERY,
  CREATE_SAVED_REPORT_MUTATION,
  UPDATE_SAVED_REPORT_MUTATION,
  DELETE_SAVED_REPORT_MUTATION,
  CREATE_EXPORT_JOB_MUTATION,
  REFRESH_SNAPSHOTS_MUTATION,
  SPORTS_LEAGUE_BREAKDOWN_QUERY,
  SPORTS_EVENT_BREAKDOWN_QUERY,
  SPORTS_MARKET_BREAKDOWN_QUERY,
  SPORTS_AGENT_BREAKDOWN_QUERY,
  SPORTS_PLAYER_BREAKDOWN_QUERY,
  CASINO_PROVIDER_BREAKDOWN_QUERY,
  CASINO_VENDOR_BREAKDOWN_QUERY,
  CASINO_GAME_BREAKDOWN_QUERY,
  CASINO_AGENT_BREAKDOWN_QUERY,
  CASINO_PLAYER_BREAKDOWN_QUERY,
  MATKA_TYPE_BREAKDOWN_QUERY,
  MATKA_MARKET_BREAKDOWN_QUERY,
  MATKA_SESSION_BREAKDOWN_QUERY,
  MATKA_AGENT_BREAKDOWN_QUERY,
  MATKA_PLAYER_BREAKDOWN_QUERY,
  AGENT_PLAYER_BREAKDOWN_QUERY,
} from './graphql';
import { useReportingStore } from '@/state/reportingStore';
import { notify } from '@/shared/services/notification';

/* Page migration C, W3 Task 120: the success and failure messages below go through the kit notify
   service (bottom-centre kit toasts) instead of antd's `notification`, with every title and text
   unchanged — antd's `message` is notify's title, its `description` notify's text, and both keep
   antd's 4.5-second default. The filter parameters are typed `unknown` instead of `any`, with casts
   where a hook reads them; what each hook sends is unchanged. */

// Fields allowed by SportsReportingFilter (exclude schemeType, domain, etc. from shared store)
const SPORTS_REPORTING_FILTER_KEYS = ['tenant', 'whitelabelId', 'agentId', 'sportId', 'leagueId', 'eventId', 'dateFrom', 'dateTo', 'currency'] as const;

function sportsReportingFilterForApi(filter: unknown) {
  if (!filter || typeof filter !== 'object') return filter;
  const source = filter as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SPORTS_REPORTING_FILTER_KEYS) {
    if (key in source && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// Sports Reporting Hooks
export function useSportsKPIs(filter?: unknown) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  return useQuery(SPORTS_KPIS_QUERY, {
    variables: { filter: sportsReportingFilterForApi(mergedFilter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });
}

export function useSportsTrends(filter?: unknown) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  return useQuery(SPORTS_TRENDS_QUERY, {
    variables: { filter: sportsReportingFilterForApi(mergedFilter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });
}

export function useSportsBreakdown(dimension: 'sport' | 'league' | 'event', filter?: unknown) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  return useQuery(SPORTS_BREAKDOWN_QUERY, {
    variables: { filter: sportsReportingFilterForApi(mergedFilter), dimension },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });
}

export function useTopSportsEvents(limit: number = 10, filter?: unknown) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  return useQuery(TOP_SPORTS_EVENTS_QUERY, {
    variables: { filter: sportsReportingFilterForApi(mergedFilter), limit },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });
}

// Fields allowed by CasinoReportingFilter (no vendorId/gameId etc.)
const CASINO_REPORTING_FILTER_KEYS = ['tenant', 'whitelabelId', 'agentId', 'dateFrom', 'dateTo', 'currency'] as const;

function casinoReportingFilterForApi(filter: unknown) {
  if (!filter || typeof filter !== 'object') return filter;
  const source = filter as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of CASINO_REPORTING_FILTER_KEYS) {
    if (key in source && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// Casino Reporting Hooks
export function useCasinoKPIs(filter?: unknown) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  return useQuery(CASINO_KPIS_QUERY, {
    variables: { filter: casinoReportingFilterForApi(mergedFilter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });
}

export function useCasinoTrends(filter?: unknown) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  return useQuery(CASINO_TRENDS_QUERY, {
    variables: { filter: casinoReportingFilterForApi(mergedFilter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });
}

// Fields allowed by MatkaReportingFilter / MatkaDrillDownFilter (exclude schemeType, domain, etc.)
const MATKA_FILTER_KEYS = ['tenant', 'whitelabelId', 'dateFrom', 'dateTo', 'matkaType', 'matkaId', 'marketSession', 'agentId', 'playerId', 'currency'] as const;

function matkaFilterForApi(filter: unknown) {
  if (!filter || typeof filter !== 'object') return filter;
  const source = filter as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of MATKA_FILTER_KEYS) {
    if (key in source && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// Matka Reporting Hooks
export function useMatkaKPIs(filter?: unknown) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  return useQuery(MATKA_KPIS_QUERY, {
    variables: { filter: matkaFilterForApi(mergedFilter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });
}

export function useMatkaTrends(filter?: unknown) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  return useQuery(MATKA_TRENDS_QUERY, {
    variables: { filter: matkaFilterForApi(mergedFilter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });
}

// Agent Reporting Hooks
export function useAgentKPIs(filter?: unknown, options: { skip?: boolean } = {}) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  // Debug logging

  return useQuery(AGENT_KPIS_QUERY, {
    variables: { filter: mergedFilter },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    skip: options.skip ?? false,
  });
}

export function useAgentPerformance(limit: number = 50, filter?: unknown, options: { skip?: boolean } = {}) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  // Debug logging

  return useQuery(AGENT_PERFORMANCE_QUERY, {
    variables: { filter: mergedFilter, limit },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    skip: options.skip ?? false,
  });
}

export function useAgentTrends(filter?: unknown) {
  const { filters } = useReportingStore();
  const mergedFilter = { ...filters, ...(filter as object | undefined) };

  // Debug logging

  return useQuery(AGENT_TRENDS_QUERY, {
    variables: { filter: mergedFilter },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    skip: false, // Explicitly don't skip
  });
}

// Saved Reports Hooks
export function useSavedReports() {
  return useQuery(SAVED_REPORTS_QUERY, {
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  });
}

export function useCreateSavedReport() {
  const [mutate, { loading }] = useMutation(CREATE_SAVED_REPORT_MUTATION, {
    refetchQueries: [{ query: SAVED_REPORTS_QUERY }],
    onCompleted: () => {
      notify.success('Your report configuration has been saved successfully.', 'Report Saved');
    },
    onError: (error) => {
      notify.error(error.message, 'Failed to Save Report');
    },
  });

  return {
    createSavedReport: mutate,
    loading,
  };
}

export function useUpdateSavedReport() {
  const [mutate, { loading }] = useMutation(UPDATE_SAVED_REPORT_MUTATION, {
    refetchQueries: [{ query: SAVED_REPORTS_QUERY }],
    onCompleted: () => {
      notify.success('Your report configuration has been updated successfully.', 'Report Updated');
    },
    onError: (error) => {
      notify.error(error.message, 'Failed to Update Report');
    },
  });

  return {
    updateSavedReport: mutate,
    loading,
  };
}

export function useDeleteSavedReport() {
  const [mutate, { loading }] = useMutation(DELETE_SAVED_REPORT_MUTATION, {
    refetchQueries: [{ query: SAVED_REPORTS_QUERY }],
    onCompleted: () => {
      notify.success('Your report has been deleted successfully.', 'Report Deleted');
    },
    onError: (error) => {
      notify.error(error.message, 'Failed to Delete Report');
    },
  });

  return {
    deleteSavedReport: mutate,
    loading,
  };
}

export function useCreateExportJob() {
  const [mutate, { loading }] = useMutation(CREATE_EXPORT_JOB_MUTATION, {
    onCompleted: () => {
      notify.success('Your export job has been created and will be processed shortly.', 'Export Job Created');
    },
    onError: (error) => {
      notify.error(error.message, 'Failed to Create Export Job');
    },
  });

  return {
    createExportJob: mutate,
    loading,
  };
}

export function useRefreshSnapshots() {
  const [mutate, { loading }] = useMutation(REFRESH_SNAPSHOTS_MUTATION, {
    onCompleted: () => {
      notify.success('Reporting snapshots have been refreshed successfully.', 'Snapshots Refreshed');
    },
    onError: (error) => {
      notify.error(error.message, 'Failed to Refresh Snapshots');
    },
  });

  return {
    refreshSnapshots: mutate,
    loading,
  };
}

// Sports Drill-Down Hooks
export function useSportsLeagueBreakdown(filter: unknown) {
  return useQuery(SPORTS_LEAGUE_BREAKDOWN_QUERY, {
    variables: { filter: filter ?? {} },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load league breakdown');
    },
  });
}

export function useSportsEventBreakdown(filter: unknown) {
  return useQuery(SPORTS_EVENT_BREAKDOWN_QUERY, {
    variables: { filter: filter ?? {} },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load event breakdown');
    },
  });
}

export function useSportsMarketBreakdown(filter: unknown) {
  return useQuery(SPORTS_MARKET_BREAKDOWN_QUERY, {
    variables: { filter: filter ?? {} },
    skip: !filter || !(filter as { eventId?: unknown })?.eventId,
    errorPolicy: 'all',
    fetchPolicy: 'network-only',
    onError: (error) => {
      notify.error(error.message, 'Failed to load market breakdown');
    },
  });
}

export function useSportsAgentBreakdown(filter: unknown) {
  return useQuery(SPORTS_AGENT_BREAKDOWN_QUERY, {
    variables: { filter: filter ?? {} },
    skip: !filter,
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load agent breakdown');
    },
  });
}

export function useSportsPlayerBreakdown(filter: unknown) {
  return useQuery(SPORTS_PLAYER_BREAKDOWN_QUERY, {
    variables: { filter: filter ?? {} },
    skip: !filter,
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load player breakdown');
    },
  });
}

// Casino Drill-Down Hooks
export function useCasinoProviderBreakdown(filter: unknown) {
  return useQuery(CASINO_PROVIDER_BREAKDOWN_QUERY, {
    variables: { filter: filter ?? {} },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load provider breakdown');
    },
  });
}

export function useCasinoVendorBreakdown(filter: unknown) {
  return useQuery(CASINO_VENDOR_BREAKDOWN_QUERY, {
    variables: { filter: filter ?? {} },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load vendor breakdown');
    },
  });
}

export function useCasinoGameBreakdown(filter: unknown) {
  return useQuery(CASINO_GAME_BREAKDOWN_QUERY, {
    variables: { filter: filter ?? {} },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load game breakdown');
    },
  });
}

function casinoDrillDownFilterForApi(filter: unknown) {
  if (!filter) return {};
  // Drops the page's refetch key and keeps every other own field, as `{ _refreshKey, ...rest }` did.
  const rest = { ...(filter as Record<string, unknown>) };
  delete rest._refreshKey;
  return rest;
}

export function useCasinoAgentBreakdown(filter: unknown) {
  return useQuery(CASINO_AGENT_BREAKDOWN_QUERY, {
    variables: { filter: casinoDrillDownFilterForApi(filter) },
    skip: !filter,
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load agent breakdown');
    },
  });
}

export function useCasinoPlayerBreakdown(filter: unknown) {
  return useQuery(CASINO_PLAYER_BREAKDOWN_QUERY, {
    variables: { filter: casinoDrillDownFilterForApi(filter) },
    skip: !filter,
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load player breakdown');
    },
  });
}

// Matka Drill-Down Hooks (sanitize filter so schemeType etc. are not sent)
export function useMatkaTypeBreakdown(filter: unknown) {
  return useQuery(MATKA_TYPE_BREAKDOWN_QUERY, {
    variables: { filter: matkaFilterForApi(filter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load matka type breakdown');
    },
  });
}

export function useMatkaMarketBreakdown(filter: unknown) {
  return useQuery(MATKA_MARKET_BREAKDOWN_QUERY, {
    variables: { filter: matkaFilterForApi(filter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load market breakdown');
    },
  });
}

export function useMatkaSessionBreakdown(filter: unknown) {
  return useQuery(MATKA_SESSION_BREAKDOWN_QUERY, {
    variables: { filter: matkaFilterForApi(filter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load session breakdown');
    },
  });
}

export function useMatkaAgentBreakdown(filter: unknown) {
  return useQuery(MATKA_AGENT_BREAKDOWN_QUERY, {
    variables: { filter: matkaFilterForApi(filter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load agent breakdown');
    },
  });
}

export function useMatkaPlayerBreakdown(filter: unknown) {
  return useQuery(MATKA_PLAYER_BREAKDOWN_QUERY, {
    variables: { filter: matkaFilterForApi(filter) },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    onError: (error) => {
      notify.error(error.message, 'Failed to load player breakdown');
    },
  });
}

// Agent Drill-Down Hooks
export function useAgentPlayerBreakdown(filter: unknown, options: { skip?: boolean } = {}) {
  // Debug logging

  return useQuery(AGENT_PLAYER_BREAKDOWN_QUERY, {
    variables: { filter },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    skip: options.skip ?? false,
    onError: (error) => {
      notify.error(error.message, 'Failed to load player breakdown');
    },
  });
}


