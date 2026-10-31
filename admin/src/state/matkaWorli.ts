import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'

export type WorliStatus = 'SCHEDULED'|'OPENING_SOON'|'OPEN'|'LOCKED'|'CLOSED'|'SETTLING'|'SETTLED'|'PAUSED'|'VOIDED'

interface WorliFiltersState {
  date: string
  marketId?: string
  status: WorliStatus[]
  search?: string
  hasResult?: boolean
  sort?: string
  setDate: (date: string) => void
  setMarketId: (id?: string) => void
  setStatus: (s: WorliStatus[]) => void
  setSearch: (q?: string) => void
  setHasResult: (v?: boolean) => void
  setSort: (s?: string) => void
}

export const useWorliFilters = create<WorliFiltersState>()(persist((set) => ({
  date: formatInTimeZone(new Date(), 'yyyy-MM-dd', DEFAULT_ADMIN_TZ),
  marketId: undefined,
  status: [],
  search: '',
  hasResult: undefined,
  sort: 'closeAt:asc',
  setDate: (date) => set({ date }),
  setMarketId: (marketId) => set({ marketId }),
  setStatus: (status) => set({ status }),
  setSearch: (search) => set({ search }),
  setHasResult: (hasResult) => set({ hasResult }),
  setSort: (sort) => set({ sort }),
}), { name: 'worli-filters' }))

