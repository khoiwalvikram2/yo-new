import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nowIST } from '@/shared/utils/date';

export interface ReportingFilters {
  tenant?: string;
  whitelabelId?: string;
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
  sportId?: string;
  leagueId?: string;
  eventId?: string;
  agentId?: string;
  campaignId?: string;
  domain?: 'sports' | 'casino' | 'matka' | 'agents' | 'bonuses' | 'global';
  schemeType?: 'COMMISSION' | 'SHARING' | 'CREDIT';
}

export interface SavedReport {
  id: string;
  name: string;
  description?: string;
  reportType: string;
  filtersJson: Record<string, unknown>;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DrillDownLevel {
  type: 'sport' | 'league' | 'event' | 'agent' | 'player' | 'provider' | 'vendor' | 'game' | 'matkaType' | 'market' | 'session' | 'campaign' | 'all';
  id?: string | number;
  name: string;
}

type ReportingStore = {
  // Global filters
  filters: ReportingFilters;
  setFilters: (filters: Partial<ReportingFilters>) => void;
  resetFilters: () => void;

  // Saved reports
  savedReports: SavedReport[];
  setSavedReports: (reports: SavedReport[]) => void;
  addSavedReport: (report: SavedReport) => void;
  removeSavedReport: (id: string) => void;
  updateSavedReport: (id: string, report: Partial<SavedReport>) => void;

  // Active report type
  activeReportType: string | null;
  setActiveReportType: (type: string | null) => void;

  // Drill-down path management
  drillDownPath: DrillDownLevel[];
  pushDrillDownLevel: (level: DrillDownLevel) => void;
  popDrillDownLevel: () => void;
  resetDrillDownPath: () => void;

  // Persistent filters (separate from drill-down path)
  activeFilters: Record<string, { value: string | number; label: string }>;
  addFilter: (key: string, value: string | number, label: string) => void;
  removeFilter: (key: string) => void;
  clearAllFilters: () => void;
};

const defaultFilters: ReportingFilters = {
  dateFrom: '2000-01-01',
  dateTo: nowIST().format('YYYY-MM-DD'),
  currency: undefined,
};

export const useReportingStore = create<ReportingStore>()(
  persist(
    (set) => ({
      filters: defaultFilters,
      setFilters: (newFilters) =>
        set((state) => ({
          filters: { ...state.filters, ...newFilters },
        })),
      resetFilters: () => set({ filters: defaultFilters }),

      savedReports: [],
      setSavedReports: (reports) => set({ savedReports: reports }),
      addSavedReport: (report) =>
        set((state) => ({
          savedReports: [...state.savedReports, report],
        })),
      removeSavedReport: (id) =>
        set((state) => ({
          savedReports: state.savedReports.filter((r) => r.id !== id),
        })),
      updateSavedReport: (id, updates) =>
        set((state) => ({
          savedReports: state.savedReports.map((r) =>
            r.id === id ? { ...r, ...updates } : r,
          ),
        })),

      activeReportType: null,
      setActiveReportType: (type) => set({ activeReportType: type }),

      // Drill-down path
      drillDownPath: [],
      pushDrillDownLevel: (level) =>
        set((state) => ({
          drillDownPath: [...state.drillDownPath, level],
        })),
      popDrillDownLevel: () =>
        set((state) => ({
          drillDownPath: state.drillDownPath.slice(0, -1),
        })),
      resetDrillDownPath: () => set({ drillDownPath: [] }),

      // Persistent filters
      activeFilters: {},
      addFilter: (key, value, label) =>
        set((state) => ({
          activeFilters: { ...state.activeFilters, [key]: { value, label } },
        })),
      removeFilter: (key) =>
        set((state) => {
          const newFilters = { ...state.activeFilters };
          delete newFilters[key];
          return { activeFilters: newFilters };
        }),
      clearAllFilters: () => set({ activeFilters: {} }),
    }),
    {
      name: 'reporting-store',
      partialize: (state) => ({
        filters: state.filters,
        savedReports: state.savedReports,
        activeReportType: state.activeReportType,
        // Don't persist drill-down path - reset on page load
        // Don't persist activeFilters - reset on page load
      }),
    },
  ),
);

