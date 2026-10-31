import { create } from 'zustand'
import type { Player } from '@/shared/types/player'

type DrawerState = {
  open: boolean
  activeUserId: string | null
  openSection: string
}

type ProfileFilters = {
  activeTab: string
}

type PlayersUiStore = {
  drawer: DrawerState
  profileFilters: Record<string, ProfileFilters>
  selectedUser: Player | null
  setSelectedUser: (user: Player | null) => void
  openDrawer: (user: Player) => void
  closeDrawer: () => void
  setOpenSection: (section: string) => void
  setProfileTab: (userId: string, tab: string) => void
}

const defaultDrawer: DrawerState = {
  open: false,
  activeUserId: null,
  openSection: 'account',
}

const defaultProfileFilters: ProfileFilters = {
  activeTab: 'overview',
}

export const usePlayersUiStore = create<PlayersUiStore>((set) => ({
  drawer: defaultDrawer,
  profileFilters: {},
  selectedUser: null,
  setSelectedUser: (user) => set({ selectedUser: user }),
  openDrawer: (user) =>
    set({
      drawer: { open: true, activeUserId: user.id, openSection: 'account' },
      selectedUser: user,
    }),
  closeDrawer: () =>
    set({
      drawer: defaultDrawer,
      selectedUser: null,
    }),
  setOpenSection: (section) =>
    set((state) => ({
      drawer: { ...state.drawer, openSection: section },
    })),
  setProfileTab: (userId, tab) =>
    set((state) => ({
      profileFilters: {
        ...state.profileFilters,
        [userId]: { ...(state.profileFilters[userId] ?? defaultProfileFilters), activeTab: tab },
      },
    })),
}))

