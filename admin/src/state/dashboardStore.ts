import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nowIST } from '@/shared/utils/date';

export type DateRangePreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'custom';

/**
 * Every reload, setDateRange and refreshRelativeRange goes through resolveDateRange; setDateRangePreset and
 * resetFilters compute the dates from the preset itself. Either way the applied range always has all three.
 */
export interface DashboardDateRange {
  dateFrom: string;
  dateTo: string;
  preset: DateRangePreset;
}

export interface DashboardFilters {
  dateRange: DashboardDateRange;
  productFilter?: 'all' | 'sports' | 'casino' | 'matka';
}

type DashboardStore = {
  filters: DashboardFilters;
  setDateRange: (dateRange: Partial<DashboardDateRange>) => void;
  setDateRangePreset: (preset: DateRangePreset) => void;
  setProductFilter: (product: 'all' | 'sports' | 'casino' | 'matka') => void;
  resetFilters: () => void;
  /** Recomputes a relative preset's dates once the IST day has moved on; a no-op otherwise. */
  refreshRelativeRange: () => void;
  getDateRangeForQuery: () => { dateFrom?: string; dateTo?: string } | undefined;
};

/**
 * IST calendar boundaries via dayjs (server TZ-agnostic).
 * Avoids `addDays` on Date in UTC-hosted servers, which broke "Yesterday" vs deposit/GGR day buckets.
 */
export function getDateRangeISOForPreset(preset: DateRangePreset): { dateFrom: string; dateTo: string } {
  const base = nowIST();

  switch (preset) {
    case 'today':
      return {
        dateFrom: base.startOf('day').toDate().toISOString(),
        dateTo: base.endOf('day').toDate().toISOString(),
      };
    case 'yesterday': {
      const y = base.subtract(1, 'day');
      return {
        dateFrom: y.startOf('day').toDate().toISOString(),
        dateTo: y.endOf('day').toDate().toISOString(),
      };
    }
    /* 7D and 30D are 7 and 30 IST calendar days with today included (today and the 6 / 29 days
       before it), as the mockup's own ranges read (M:2737 "29 Aug – 04 Sep", M:2748 "06 Aug –
       04 Sep") and as the agent helper counts (agentDashboardDateRange.ts:29-33). Subtracting
       7 / 30 spanned 8 and 31 days. */
    case 'last7days':
      return {
        dateFrom: base.clone().subtract(6, 'day').startOf('day').toDate().toISOString(),
        dateTo: base.endOf('day').toDate().toISOString(),
      };
    case 'last30days':
      return {
        dateFrom: base.clone().subtract(29, 'day').startOf('day').toDate().toISOString(),
        dateTo: base.endOf('day').toDate().toISOString(),
      };
    case 'thisMonth':
      return {
        dateFrom: base.startOf('month').toDate().toISOString(),
        dateTo: base.endOf('day').toDate().toISOString(),
      };
    case 'lastMonth': {
      const lm = base.subtract(1, 'month');
      return {
        dateFrom: lm.startOf('month').toDate().toISOString(),
        dateTo: lm.endOf('month').toDate().toISOString(),
      };
    }
    /* A custom range owns its dates, so a caller that asks for 'custom' here (none does today) or passes
       an unknown preset gets 7D's window. This branch used to subtract 7, an 8-day span that no longer
       matched 7D once 7D became 7 days; delegating keeps the two from drifting apart again. Only this
       module and its test import this function. */
    case 'custom':
    default:
      return getDateRangeISOForPreset('last7days');
  }
}

const RELATIVE_PRESETS: ReadonlySet<DateRangePreset> = new Set<DateRangePreset>([
  'today', 'yesterday', 'last7days', 'last30days', 'thisMonth', 'lastMonth',
]);

/**
 * Built per call: the module-level constant this replaces froze "today" at the moment the chunk
 * loaded, so Reset in a tab left open past midnight gave yesterday.
 */
function makeDefaultFilters(): DashboardFilters {
  return {
    dateRange: { preset: 'today', ...getDateRangeISOForPreset('today') },
    productFilter: 'all',
  };
}

/** A date string the pill (formatDate, new Date) and the query can both use. */
function isDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * A relative preset's dates are a function of the IST clock, not facts to keep, so they are
 * recomputed from the preset every time. Only a custom range owns its dates, and only when both
 * are date strings in order. Anything else (no preset, an unknown one, a custom range missing a
 * date, dates that do not parse or are not strings, an end before its start) falls back to Today:
 * localStorage is untyped, and a truthy 'x' reached the pill as "Invalid Date" while a number or
 * an object made formatDate throw and took the page down to its ErrorBoundary.
 */
export function resolveDateRange(dateRange: Partial<DashboardDateRange> | null | undefined): DashboardDateRange {
  const preset = dateRange?.preset;
  if (preset && RELATIVE_PRESETS.has(preset)) {
    return { preset, ...getDateRangeISOForPreset(preset) };
  }
  const dateFrom: unknown = dateRange?.dateFrom;
  const dateTo: unknown = dateRange?.dateTo;
  if (
    preset === 'custom' &&
    isDateString(dateFrom) &&
    isDateString(dateTo) &&
    Date.parse(dateFrom) <= Date.parse(dateTo)
  ) {
    return { preset, dateFrom, dateTo };
  }
  return makeDefaultFilters().dateRange;
}

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set, get) => ({
      filters: makeDefaultFilters(),

      /* Returns without calling set when nothing moved, so a same-day call (the Overview page
         runs one every minute) keeps the store's identity: no subscriber re-renders, no refetch. */
      refreshRelativeRange: () => {
        const current = get().filters.dateRange;
        const next = resolveDateRange(current);
        if (
          next.preset === current.preset &&
          next.dateFrom === current.dateFrom &&
          next.dateTo === current.dateTo
        ) {
          return;
        }
        set((state) => ({ filters: { ...state.filters, dateRange: next } }));
      },

      setDateRange: (dateRange) =>
        set((state) => ({
          filters: {
            ...state.filters,
            dateRange: resolveDateRange({ ...dateRange, preset: dateRange.preset || 'custom' }),
          },
        })),
      
      setDateRangePreset: (preset) => {
        const range = getDateRangeISOForPreset(preset);
        set((state) => ({
          filters: {
            ...state.filters,
            dateRange: {
              ...range,
              preset,
            },
          },
        }));
      },
      
      setProductFilter: (product) =>
        set((state) => ({
          filters: {
            ...state.filters,
            productFilter: product,
          },
        })),
      
      resetFilters: () => set({ filters: makeDefaultFilters() }),
      
      getDateRangeForQuery: () => {
        const { dateRange } = get().filters;
        if (!dateRange.dateFrom || !dateRange.dateTo) {
          return undefined;
        }
        return {
          dateFrom: dateRange.dateFrom,
          dateTo: dateRange.dateTo,
        };
      },
    }),
    {
      name: 'dashboard-store-v2',
      partialize: (state) => ({
        filters: state.filters,
      }),
      /* Runs on every hydration, before the first render (migrate only runs on a version change,
         and the default merge let the saved filters replace the fresh ones whole). A "today"
         saved yesterday must come back as today, not as yesterday's dates under today's name.
         The key and the saved shape are unchanged, so no version bump is needed. */
      merge: (persisted, current) => {
        const saved = (persisted as { filters?: Partial<DashboardFilters> } | undefined)?.filters;
        return {
          ...current,
          filters: {
            ...current.filters,
            ...saved,
            dateRange: resolveDateRange(saved?.dateRange),
          },
        };
      },
    },
  ),
);

