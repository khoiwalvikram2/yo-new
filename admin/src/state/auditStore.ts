import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuditFilters {
  id?: string
  domain?: string[]
  action?: string[]
  actorId?: string
  resourceType?: string[]
  resourceId?: string
  from?: string
  to?: string
  search?: string
  page: number
  limit: number
  sort: string
}

export interface SavedFilterPreset {
  id: string
  name: string
  filters: AuditFilters
  createdAt: string
}

interface AuditState {
  filters: AuditFilters
  setFilters: (filters: Partial<AuditFilters>) => void
  resetFilters: () => void
  savedPresets: SavedFilterPreset[]
  setSavedPresets: (presets: SavedFilterPreset[]) => void
  addSavedPreset: (preset: SavedFilterPreset) => void
  removeSavedPreset: (id: string) => void
  updateSavedPreset: (id: string, preset: Partial<SavedFilterPreset>) => void
  visibleColumns: string[]
  setVisibleColumns: (columns: string[]) => void
  columnOrder: string[]
  setColumnOrder: (order: string[]) => void
  tableDensity: 'small' | 'middle' | 'large'
  setTableDensity: (density: 'small' | 'middle' | 'large') => void
  autoRefresh: boolean
  setAutoRefresh: (enabled: boolean) => void
  refreshInterval: number
  setRefreshInterval: (interval: number) => void
  recentSearches: string[]
  addRecentSearch: (search: string) => void
  clearRecentSearches: () => void
}

const defaultFilters: AuditFilters = {
  page: 1,
  limit: 100,
  sort: 'timestamp:desc',
}

export const useAuditStore = create<AuditState>()(
  persist(
    (set) => ({
      // Filters state
      filters: defaultFilters,
      setFilters: (newFilters: Partial<AuditFilters>) => {
        set((state) => ({
          filters: { ...state.filters, ...newFilters },
        }))
      },
      resetFilters: () => {
        set({ filters: defaultFilters })
      },
      
      // Saved filter presets
      savedPresets: [],
      setSavedPresets: (presets: SavedFilterPreset[]) => {
        set({ savedPresets: presets })
      },
      addSavedPreset: (preset: SavedFilterPreset) => {
        set((state) => ({
          savedPresets: [...state.savedPresets, preset],
        }))
      },
      removeSavedPreset: (id: string) => {
        set((state) => ({
          savedPresets: state.savedPresets.filter((p) => p.id !== id),
        }))
      },
      updateSavedPreset: (id: string, updates: Partial<SavedFilterPreset>) => {
        set((state) => ({
          savedPresets: state.savedPresets.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }))
      },
      visibleColumns: ['expand', 'id', 'timestamp', 'actor', 'domain', 'action', 'resource', 'details'],
      setVisibleColumns: (columns: string[]) => set({ visibleColumns: columns }),
      columnOrder: ['expand', 'id', 'timestamp', 'actor', 'domain', 'action', 'resource', 'details'],
      setColumnOrder: (order: string[]) => set({ columnOrder: order }),
      tableDensity: 'middle',
      setTableDensity: (density: 'small' | 'middle' | 'large') => set({ tableDensity: density }),
      autoRefresh: false,
      setAutoRefresh: (enabled: boolean) => set({ autoRefresh: enabled }),
      refreshInterval: 30,
      setRefreshInterval: (interval: number) => {
        set({ refreshInterval: Math.max(5, Math.min(300, interval)) })
      },
      recentSearches: [],
      addRecentSearch: (search: string) => {
        const trimmed = search.trim()
        if (!trimmed) return
        set((state) => {
          const filtered = state.recentSearches.filter((s) => s !== trimmed)
          return { recentSearches: [trimmed, ...filtered].slice(0, 10) }
        })
      },
      clearRecentSearches: () => set({ recentSearches: [] }),
    }),
    {
      name: 'audit-store',
      version: 1,
      partialize: (state) => ({
        filters: state.filters,
        savedPresets: state.savedPresets,
        visibleColumns: state.visibleColumns,
        columnOrder: state.columnOrder,
        tableDensity: state.tableDensity,
        autoRefresh: state.autoRefresh,
        refreshInterval: state.refreshInterval,
        recentSearches: state.recentSearches,
      }),
    }
  )
)
