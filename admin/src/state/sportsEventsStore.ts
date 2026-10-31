import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PriceAlert {
  id: string
  marketId: string
  marketName: string
  targetPrice: number
  condition: 'above' | 'below'
  createdAt: string
}

interface UserPreferences {
  defaultViewMode: 'table' | 'cards'
  favoriteSports: string[]
  savedFilters: Record<string, unknown>
  showAnalytics: boolean
  autoRefresh: boolean
}

interface SportsEventsState {
  favoriteEvents: Set<string>
  viewMode: 'table' | 'cards'
  density: 'compact' | 'comfortable' | 'spacious'
  priceAlerts: PriceAlert[]
  preferences: UserPreferences
  addFavorite: (eventId: string) => void
  removeFavorite: (eventId: string) => void
  toggleFavorite: (eventId: string) => void
  isFavorite: (eventId: string) => boolean
  setViewMode: (mode: 'table' | 'cards') => void
  setDensity: (density: 'compact' | 'comfortable' | 'spacious') => void
  addPriceAlert: (alert: Omit<PriceAlert, 'id' | 'createdAt'>) => void
  removePriceAlert: (alertId: string) => void
  getPriceAlerts: (marketId?: string) => PriceAlert[]
  updatePreferences: (prefs: Partial<UserPreferences>) => void
}

export const useSportsEventsStore = create<SportsEventsState>()(
  persist(
    (set, get) => ({
      favoriteEvents: new Set<string>(),
      viewMode: 'table',
      density: 'comfortable',
      priceAlerts: [],
      preferences: {
        defaultViewMode: 'table',
        favoriteSports: [],
        savedFilters: {},
        showAnalytics: true,
        autoRefresh: true,
      },
      
      addFavorite: (eventId) =>
        set((state) => {
          const newFavorites = new Set(state.favoriteEvents)
          newFavorites.add(eventId)
          return { favoriteEvents: newFavorites }
        }),
      
      removeFavorite: (eventId) =>
        set((state) => {
          const newFavorites = new Set(state.favoriteEvents)
          newFavorites.delete(eventId)
          return { favoriteEvents: newFavorites }
        }),
      
      toggleFavorite: (eventId) => {
        const { favoriteEvents, addFavorite, removeFavorite } = get()
        if (favoriteEvents.has(eventId)) {
          removeFavorite(eventId)
        } else {
          addFavorite(eventId)
        }
      },
      
      isFavorite: (eventId) => get().favoriteEvents.has(eventId),
      
      setViewMode: (mode) => set({ viewMode: mode }),
      
      setDensity: (density) => set({ density }),
      
      addPriceAlert: (alert) =>
        set((state) => ({
          priceAlerts: [
            ...state.priceAlerts,
            {
              ...alert,
              id: `alert-${Date.now()}-${Math.random()}`,
              createdAt: new Date().toISOString(),
            },
          ],
        })),
      
      removePriceAlert: (alertId) =>
        set((state) => ({
          priceAlerts: state.priceAlerts.filter((a) => a.id !== alertId),
        })),
      
      getPriceAlerts: (marketId) => {
        const alerts = get().priceAlerts
        return marketId ? alerts.filter((a) => a.marketId === marketId) : alerts
      },
      
      updatePreferences: (prefs) =>
        set((state) => ({
          preferences: { ...state.preferences, ...prefs },
        })),
    }),
    {
      name: 'sports-events-storage',
      // Custom storage to handle Set serialization
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name)
          if (!str) return null
          const data = JSON.parse(str)
          // Convert array back to Set
          if (data.state.favoriteEvents && Array.isArray(data.state.favoriteEvents)) {
            data.state.favoriteEvents = new Set(data.state.favoriteEvents)
          }
          // Initialize preferences if missing
          if (!data.state.preferences) {
            data.state.preferences = {
              defaultViewMode: 'table',
              favoriteSports: [],
              savedFilters: {},
              showAnalytics: true,
              autoRefresh: true,
            }
          }
          // Initialize priceAlerts if missing
          if (!data.state.priceAlerts) {
            data.state.priceAlerts = []
          }
          return data
        },
        setItem: (name, value) => {
          // Convert Set to array for storage
          const data = {
            ...value,
            state: {
              ...value.state,
              favoriteEvents: Array.from(value.state.favoriteEvents),
            },
          }
          localStorage.setItem(name, JSON.stringify(data))
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
)

