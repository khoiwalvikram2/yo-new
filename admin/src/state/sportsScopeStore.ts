import { create } from 'zustand'

export type Scope = 'sports' | 'leagues' | 'events' | 'markets'

interface SportsScopeState {
  collapsed: boolean
  width: number
  scope: Scope
  selectedSportId?: string
  selectedLeagueId?: string
  selectedEventId?: string
  setCollapsed: (v: boolean) => void
  setWidth: (w: number) => void
  setScope: (s: Scope) => void
  setSportId: (id?: string) => void
  setLeagueId: (id?: string) => void
  setEventId: (id?: string) => void
}

export const useSportsScopeStore = create<SportsScopeState>((set) => ({
  collapsed: false,
  width: 264,
  scope: 'sports',
  setCollapsed: (v) => set({ collapsed: v }),
  setWidth: (w) => set({ width: Math.min(360, Math.max(200, w)) }),
  setScope: (s) => set(() => {
    // Preserve IDs when switching to their respective scopes
    if (s === 'events') {
      return { scope: s } // preserve selectedLeagueId
    }
    if (s === 'markets') {
      return { scope: s } // preserve selectedEventId
    }
    // Clear IDs when switching away
    return { scope: s, selectedLeagueId: undefined, selectedEventId: undefined }
  }),
  setSportId: (id) => set({ selectedSportId: id, selectedLeagueId: undefined, selectedEventId: undefined }),
  setLeagueId: (id) => set({ selectedLeagueId: id, selectedEventId: undefined }),
  setEventId: (id) => set({ selectedEventId: id }),
}))

