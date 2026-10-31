// Local Storage Service
export const localStorageService = {
  get: <T = any>(key: string): T | null => {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : null
    } catch (error) {
      return null
    }
  },

  set: <T = any>(key: string, value: T): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
    }
  },

  remove: (key: string): void => {
    try {
      localStorage.removeItem(key)
    } catch (error) {
    }
  },

  clear: (): void => {
    try {
      localStorage.clear()
    } catch (error) {
    }
  },

  exists: (key: string): boolean => {
    return localStorage.getItem(key) !== null
  },
}

// Session Storage Service
export const sessionStorageService = {
  get: <T = any>(key: string): T | null => {
    try {
      const item = sessionStorage.getItem(key)
      return item ? JSON.parse(item) : null
    } catch (error) {
      return null
    }
  },

  set: <T = any>(key: string, value: T): void => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
    }
  },

  remove: (key: string): void => {
    try {
      sessionStorage.removeItem(key)
    } catch (error) {
    }
  },

  clear: (): void => {
    try {
      sessionStorage.clear()
    } catch (error) {
    }
  },

  exists: (key: string): boolean => {
    return sessionStorage.getItem(key) !== null
  },
}

// Storage Keys
export const STORAGE_KEYS = {
  AUTH: 'auth-storage',
  USER_PREFERENCES: 'user-preferences',
  THEME: 'theme',
  LANGUAGE: 'language',
  CURRENCY: 'currency',
  RECENT_SEARCHES: 'recent-searches',
  DRAFT_FORMS: 'draft-forms',
  TABLE_STATE: 'table-state',
  FILTERS: 'filters',
} as const

// User Preferences Service
export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  language: string
  currency: string
  dateFormat: string
  timezone: string
  notifications: {
    email: boolean
    push: boolean
    sms: boolean
  }
  tableSettings: {
    pageSize: number
    sortBy: string
    sortOrder: 'asc' | 'desc'
  }
}

export const userPreferencesService = {
  get: (): UserPreferences => {
    const defaultPreferences: UserPreferences = {
      theme: 'system',
      language: 'en',
      currency: 'USD',
      dateFormat: 'MMM DD, YYYY',
      timezone: 'UTC',
      notifications: {
        email: true,
        push: true,
        sms: false,
      },
      tableSettings: {
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
    }

    return localStorageService.get<UserPreferences>(STORAGE_KEYS.USER_PREFERENCES) || defaultPreferences
  },

  set: (preferences: Partial<UserPreferences>): void => {
    const current = userPreferencesService.get()
    const updated = { ...current, ...preferences }
    localStorageService.set(STORAGE_KEYS.USER_PREFERENCES, updated)
  },

  update: (key: keyof UserPreferences, value: any): void => {
    const current = userPreferencesService.get()
    const updated = { ...current, [key]: value }
    localStorageService.set(STORAGE_KEYS.USER_PREFERENCES, updated)
  },

  reset: (): void => {
    localStorageService.remove(STORAGE_KEYS.USER_PREFERENCES)
  },
}

// Cache Service
export const cacheService = {
  get: <T = any>(key: string): T | null => {
    return localStorageService.get<T>(`cache_${key}`)
  },

  set: <T = any>(key: string, value: T, ttl: number = 3600000): void => {
    const item = {
      value,
      timestamp: Date.now(),
      ttl,
    }
    localStorageService.set(`cache_${key}`, item)
  },

  remove: (key: string): void => {
    localStorageService.remove(`cache_${key}`)
  },

  clear: (): void => {
    const keys = Object.keys(localStorage)
    keys.forEach(key => {
      if (key.startsWith('cache_')) {
        localStorageService.remove(key)
      }
    })
  },

  isExpired: (key: string): boolean => {
    const item = localStorageService.get<{ timestamp: number; ttl: number }>(`cache_${key}`)
    if (!item) return true
    
    return Date.now() - item.timestamp > item.ttl
  },

  getValid: <T = any>(key: string): T | null => {
    if (cacheService.isExpired(key)) {
      cacheService.remove(key)
      return null
    }
    
    const item = localStorageService.get<{ value: T }>(`cache_${key}`)
    return item?.value || null
  },
}
