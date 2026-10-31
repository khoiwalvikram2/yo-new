import { create } from 'zustand'

export type CasinoScope = 'providers' | 'vendors'

interface CasinoScopeState {
  scope: CasinoScope
  selectedProviderId?: string
  setScope: (s: CasinoScope) => void
  setProviderId: (id?: string) => void
}

export const useCasinoScopeStore = create<CasinoScopeState>((set) => ({
  scope: 'providers',
  setScope: (s) => set({ scope: s }),
  setProviderId: (id) => set({ selectedProviderId: id }),
}))

