import { create } from 'zustand'

type PresenceState = {
  onlineAdminIds: Set<string>
  setSnapshot: (ids: string[]) => void
  setOnline: (id: string) => void
  setOffline: (id: string) => void
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  onlineAdminIds: new Set<string>(),
  setSnapshot: (ids: string[]) => {
    set({ onlineAdminIds: new Set(ids) })
  },
  setOnline: (id: string) => {
    const next = new Set(get().onlineAdminIds)
    next.add(id)
    set({ onlineAdminIds: next })
  },
  setOffline: (id: string) => {
    const next = new Set(get().onlineAdminIds)
    next.delete(id)
    set({ onlineAdminIds: next })
  },
}))

