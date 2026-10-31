import { create } from 'zustand'

type SportsConfigState = {
  search: string
  selectedSport: string | null
  selectedLeagues: string[]
  setSearch: (q: string) => void
  setSelectedSport: (sportKey: string | null) => void
  toggleLeague: (leagueKey: string) => void
  setSelectedLeagues: (keys: string[]) => void
  clearSelections: () => void
}

export const useSportsConfigStore = create<SportsConfigState>((set) => ({
  search: '',
  selectedSport: null,
  selectedLeagues: [],
  setSearch: (q) => set({ search: q }),
  setSelectedSport: (sportKey) => set({ selectedSport: sportKey, selectedLeagues: [] }),
  toggleLeague: (leagueKey) => set((s) => ({
    selectedLeagues: s.selectedLeagues.includes(leagueKey)
      ? s.selectedLeagues.filter(k => k !== leagueKey)
      : [...s.selectedLeagues, leagueKey],
  })),
  setSelectedLeagues: (keys) => set({ selectedLeagues: keys }),
  clearSelections: () => set({ selectedSport: null, selectedLeagues: [] }),
}))

