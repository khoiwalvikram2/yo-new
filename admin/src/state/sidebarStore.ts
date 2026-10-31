import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface SidebarState {
  // Favorite items (paths)
  favorites: string[]
  
  // Max favorites to keep
  maxFavorites: number

  // Actions
  addFavorite: (path: string, label: string, icon: string) => boolean
  removeFavorite: (path: string) => void
  isFavorite: (path: string) => boolean
  canAddFavorite: () => boolean

  // Clear all state
  reset: () => void
}

const initialState = {
  favorites: [],
  maxFavorites: 7,
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      // Add a favorite (returns true if added, false if limit reached). label/icon kept for API.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      addFavorite: (path: string, _label: string, _icon: string) => {
        const state = get()
        
          // Don't add if already favorited
          if (state.favorites.includes(path)) {
          return true
        }
        
        // Check if limit reached
        if (state.favorites.length >= state.maxFavorites) {
          return false
        }
        
        set({
            favorites: [...state.favorites, path],
        })
        return true
      },
      
      // Remove a favorite
      removeFavorite: (path: string) => {
        set((state) => ({
          favorites: state.favorites.filter((fav) => fav !== path),
        }))
      },
      
      // Check if a path is favorited
      isFavorite: (path: string) => {
        return get().favorites.includes(path)
      },
      
      // Check if can add more favorites
      canAddFavorite: () => {
        const state = get()
        return state.favorites.length < state.maxFavorites
      },
      
      // Reset all state
      reset: () => {
        set(initialState)
      },
    }),
    {
      name: 'sidebar-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        favorites: state.favorites,
      }),
    }
  )
)

