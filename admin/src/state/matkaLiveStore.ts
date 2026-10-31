import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SavedView {
  id: string
  name: string
  createdAt: string
  view: 'betList' | 'exposure'
  filters: Record<string, string | undefined>
}

interface MatkaLiveState {
  watchlist: string[]
  savedViews: SavedView[]
  addWatch: (key: string) => void
  removeWatch: (key: string) => void
  saveView: (view: SavedView) => void
  deleteView: (id: string) => void
}

export const useMatkaLiveStore = create<MatkaLiveState>()(persist(
  (set, get) => ({
    watchlist: [],
    savedViews: [],
    addWatch: (key: string) => set({ watchlist: Array.from(new Set([...get().watchlist, key])) }),
    removeWatch: (key: string) => set({ watchlist: get().watchlist.filter(k => k !== key) }),
    saveView: (view: SavedView) => {
      const exists = get().savedViews.find(v => v.id === view.id)
      if (exists) {
        set({ savedViews: get().savedViews.map(v => v.id === view.id ? view : v) })
      } else {
        set({ savedViews: [...get().savedViews, view] })
      }
    },
    deleteView: (id: string) => set({ savedViews: get().savedViews.filter(v => v.id !== id) }),
  }),
  {
    name: 'matka-live-store',
    version: 1,
  }
))

