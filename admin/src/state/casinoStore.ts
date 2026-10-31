import { create } from 'zustand'

export type CasinoMainCategory = 'ALL' | 'LIVE_CASINO' | 'CASINO' | 'SLOTS'

type CasinoState = {
  selectedProviderId: string | null
  selectedCategory: CasinoMainCategory | null
  selectedVendorId: string | null
  selectedVipTierId: string | null
  search: string
  enabled: boolean | null
  page: number
  pageSize: number
  setProvider: (id: string | null) => void
  setCategory: (cat: CasinoMainCategory | null) => void
  setVendor: (id: string | null) => void
  setVipTier: (id: string | null) => void
  setSearch: (q: string) => void
  setEnabled: (v: boolean | null) => void
  setPage: (p: number) => void
  setPageSize: (n: number) => void
  resetFilters: () => void
}

export const useCasinoStore = create<CasinoState>((set) => ({
  selectedProviderId: null,
  selectedCategory: null,
  selectedVendorId: null,
  selectedVipTierId: null,
  search: '',
  enabled: null,
  page: 1,
  pageSize: 20,
  setProvider: (id) => set({ selectedProviderId: id, selectedVendorId: null, page: 1 }),
  setCategory: (cat) => set({ selectedCategory: cat, selectedVendorId: null, page: 1 }),
  setVendor: (id) => set({ selectedVendorId: id, page: 1 }),
  setVipTier: (id) => set({ selectedVipTierId: id, page: 1 }),
  setSearch: (q) => set({ search: q, page: 1 }),
  setEnabled: (v) => set({ enabled: v, page: 1 }),
  setPage: (p) => set({ page: p }),
  setPageSize: (n) => set({ pageSize: n, page: 1 }),
  resetFilters: () => set({ search: '', enabled: null, selectedVipTierId: null, page: 1, pageSize: 20 }),
}))

