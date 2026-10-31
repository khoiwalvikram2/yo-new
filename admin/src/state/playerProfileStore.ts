import { create } from 'zustand'

type PlayerProfileFilters = {
  activeTab: string
  dateRange: string
  dateFrom: string | null
  dateTo: string | null
}

type PlayerProfileStore = {
  profiles: Record<string, PlayerProfileFilters>
  setActiveTab: (playerId: string, tab: string) => void
  setDateRange: (playerId: string, range: string) => void
  setCustomRange: (playerId: string, from: string, to: string) => void
  resetProfile: (playerId: string) => void
}

export const defaultProfileFilters: PlayerProfileFilters = {
  activeTab: 'overview',
  dateRange: 'today',
  dateFrom: null,
  dateTo: null,
}

export const usePlayerProfileStore = create<PlayerProfileStore>((set) => ({
  profiles: {},
  setActiveTab: (playerId, tab) =>
    set((state) => ({
      profiles: {
        ...state.profiles,
        [playerId]: {
          ...(state.profiles[playerId] ?? defaultProfileFilters),
          activeTab: tab,
        },
      },
    })),
  setDateRange: (playerId, range) =>
    set((state) => ({
      profiles: {
        ...state.profiles,
        [playerId]: {
          ...(state.profiles[playerId] ?? defaultProfileFilters),
          dateRange: range,
          dateFrom: null,
          dateTo: null,
        },
      },
    })),
  setCustomRange: (playerId, from, to) =>
    set((state) => ({
      profiles: {
        ...state.profiles,
        [playerId]: {
          ...(state.profiles[playerId] ?? defaultProfileFilters),
          dateRange: '',
          dateFrom: from,
          dateTo: to,
        },
      },
    })),
  resetProfile: (playerId) =>
    set((state) => {
      const nextProfiles = { ...state.profiles }
      delete nextProfiles[playerId]
      return { profiles: nextProfiles }
    }),
}))

