import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useAuthStore } from './authStore'
import { apolloClient } from '@/shared/core/api'
import { MY_ADMIN_PREFERENCES, UPDATE_ADMIN_PREFERENCES } from '@/lib/graphql/adminPreferences'

type Toast = { id: string; title: string; description?: string; status?: 'info'|'success'|'warning'|'error' }

type UIState = {
  commandPaletteOpen: boolean
  toasts: Toast[]
  tenant: string
  directorMode: 'core' | 'whitelabel'
  selectedWhitelabelId: string | null
  addToast: (t: Toast) => void
  removeToast: (id: string) => void
  setCommandPaletteOpen: (open: boolean) => void
  setTenant: (tenant: string, bypassSecurityCheck?: boolean) => void
  setDirectorMode: (mode: 'core' | 'whitelabel') => void
  setSelectedWhitelabelId: (id: string | null) => void
  clearDirectorMode: () => void
  panelCollapsed: boolean
  setPanelCollapsed: (collapsed: boolean) => void
}

// CRITICAL: Load from database on initialization
const loadDirectorPreferences = async (): Promise<{ directorMode: 'core' | 'whitelabel'; selectedWhitelabelId: string | null }> => {
  if (typeof window === 'undefined') {
    return { directorMode: 'core', selectedWhitelabelId: null }
  }
  
  // CRITICAL: Check if user is authenticated and is Super Admin before calling query
  try {
    const authState = useAuthStore.getState()
    const isAuthenticated = !!authState.token
    const roles = authState.roles || []
    const isSuperAdmin = roles.some(r =>
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    
    // Only call query if user is authenticated and is Super Admin
    if (isAuthenticated && isSuperAdmin) {
      try {
        // Try to load from database first
        const result = await apolloClient.query({
          query: MY_ADMIN_PREFERENCES,
          fetchPolicy: 'network-only', // Always fetch fresh data
          errorPolicy: 'all',
        })
        
        if (result.data?.myAdminPreferences) {
          const prefs = result.data.myAdminPreferences
          return {
            directorMode: (prefs.directorMode === 'core' || prefs.directorMode === 'whitelabel') ? prefs.directorMode : 'core',
            selectedWhitelabelId: prefs.selectedWhitelabelId || null,
          }
        }
      } catch {
        // Authorization errors are expected for non-Super-Admin users; nothing to log
      }
    }
  } catch {
    // Auth store might not be ready yet, fall through to localStorage
  }
  
  // Fallback to localStorage if database fails or user not authenticated
  try {
    const storedMode = window.localStorage.getItem('DIRECTOR_MODE')
    const storedWhitelabelId = window.localStorage.getItem('DIRECTOR_SELECTED_WHITELABEL_ID')
    return {
      directorMode: (storedMode === 'core' || storedMode === 'whitelabel') ? storedMode : 'core',
      selectedWhitelabelId: storedWhitelabelId || null,
    }
  } catch {
    return { directorMode: 'core', selectedWhitelabelId: null }
  }
}

// Synchronous fallback for initial state (will be updated by async load)
// Removed unused loadDirectorMode and loadSelectedWhitelabelId functions
// const loadDirectorMode = (): 'core' | 'whitelabel' => {
//   if (typeof window === 'undefined') return 'core'
//   try {
//     const stored = window.localStorage.getItem('DIRECTOR_MODE')
//     if (stored === 'core' || stored === 'whitelabel') {
//       return stored
//     }
//   } catch {}
//   return 'core'
// }

// const loadSelectedWhitelabelId = (): string | null => {
//   if (typeof window === 'undefined') return null
//   try {
//     return window.localStorage.getItem('DIRECTOR_SELECTED_WHITELABEL_ID')
//   } catch {
//     return null
//   }
// }

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
  commandPaletteOpen: false,
  toasts: [],
      tenant: 'default',
      // CRITICAL: Don't initialize from localStorage - wait for database load
      // This prevents localStorage values from overriding database values
      directorMode: 'core' as 'core' | 'whitelabel', // Default, will be updated from database
      selectedWhitelabelId: null, // Default, will be updated from database
      panelCollapsed: false,
  addToast: (t) => set((s) => ({ toasts: [...s.toasts, t] })),
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter(x => x.id !== id) })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setTenant: (tenant, bypassSecurityCheck = false) => {
    // Validate tenant is a non-empty string
    if (!tenant || typeof tenant !== 'string' || tenant.trim() === '') {
      return
    }
    
    const trimmedTenant = tenant.trim()
    
    // SECURITY: Prevent Whitelabel Admins from changing tenant
    // Allow bypass during initial login when tenant comes from backend (authoritative source)
    if (!bypassSecurityCheck) {
      const roles = useAuthStore.getState().roles || []
      const isWhitelabelAdmin = roles.some(r => 
        r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
      )
      
      if (isWhitelabelAdmin) {
        return // Silently ignore tenant change attempts for Whitelabel Admins
      }
    }
    
    // Persist middleware will handle localStorage save automatically
    set({ tenant: trimmedTenant })
  },
  setDirectorMode: (mode) => {
    // SECURITY: Only allow mode changes for Super Admin role
    const roles = useAuthStore.getState().roles || []
    const isSuperAdmin = roles.some(r => 
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    
    if (!isSuperAdmin) {
      return
    }
    
    // CRITICAL: Save to database (async, but don't block)
    // CRITICAL: Skip notification - we don't want to show notification for every mode change
    apolloClient.mutate({
      mutation: UPDATE_ADMIN_PREFERENCES,
      variables: {
        input: {
          directorMode: mode,
          selectedWhitelabelId: mode === 'core' ? null : get().selectedWhitelabelId,
        },
      },
      context: {
        skipNotification: true, // Skip auto-notification from Apollo link
      },
    }).then(result => {
      if (result.data?.updateAdminPreferences?.success) {
        const prefs = result.data.updateAdminPreferences.preferences
        // CRITICAL: Update state with response from database (source of truth)
        const updatedMode = (prefs.directorMode === 'core' || prefs.directorMode === 'whitelabel') 
          ? prefs.directorMode 
          : mode
        const updatedWhitelabelId = prefs.selectedWhitelabelId || null
        
        
        set({
          directorMode: updatedMode as 'core' | 'whitelabel',
          selectedWhitelabelId: updatedWhitelabelId
        })
      } else {
        // No-op: the optimistic update above stays in place until the next successful sync
      }
    }).catch(() => {
      // CRITICAL: Don't fallback to localStorage - database is source of truth
      // If database fails, the optimistic update will remain until next page load
    })
    
    // Update state immediately (optimistic update)
    set({ directorMode: mode })
    if (mode === 'core') {
      set({ selectedWhitelabelId: null })
    }
    
    // CRITICAL: Clear Apollo cache when director mode changes
    // This ensures queries are re-fetched with the correct context
    apolloClient.clearStore().then(() => {
    }).catch(() => {
    })
  },
  setSelectedWhitelabelId: (id) => {
    // SECURITY: Only allow whitelabel selection for Super Admin role
    const roles = useAuthStore.getState().roles || []
    const isSuperAdmin = roles.some(r => 
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    
    if (!isSuperAdmin) {
      return
    }
    
    // Only allow selection in whitelabel mode
    const currentMode = get().directorMode
    if (currentMode !== 'whitelabel') {
      return
    }
    
    // SECURITY: Validate whitelabel ID is not empty
    if (id && (typeof id !== 'string' || id.trim() === '')) {
      return
    }
    
    // CRITICAL: Save to database (async, but don't block)
    // CRITICAL: Skip notification - we don't want to show notification for every whitelabel selection
    apolloClient.mutate({
      mutation: UPDATE_ADMIN_PREFERENCES,
      variables: {
        input: {
          directorMode: currentMode,
          selectedWhitelabelId: id,
        },
      },
      context: {
        skipNotification: true, // Skip auto-notification from Apollo link
      },
    }).then(result => {
      if (result.data?.updateAdminPreferences?.success) {
        const prefs = result.data.updateAdminPreferences.preferences
        // CRITICAL: Use the saved value from database, but fallback to requested value if null
        const savedId = prefs.selectedWhitelabelId || id
        set({ selectedWhitelabelId: savedId })
      } else {
        // No-op: the optimistic update above stays in place until the next successful sync
      }
    }).catch(() => {
      // CRITICAL: Don't fallback to localStorage - database is source of truth
      // If database fails, the optimistic update will remain until next page load
    })
    
    // Update state immediately (optimistic update)
    set({ selectedWhitelabelId: id })
    
    // CRITICAL: Clear Apollo cache when whitelabel changes
    // This ensures queries are re-fetched with the new whitelabel context (headers)
    // Without this, Apollo would serve cached data from the previous whitelabel
    apolloClient.clearStore().then(() => {
    }).catch(() => {
    })
  },
  clearDirectorMode: () => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('DIRECTOR_MODE')
        window.localStorage.removeItem('DIRECTOR_SELECTED_WHITELABEL_ID')
      } catch {
        // Ignoring localStorage removal failures; set() below resets state regardless
      }
    }
    set({ directorMode: 'core', selectedWhitelabelId: null })
  },
  setPanelCollapsed: (collapsed: boolean) => set({ panelCollapsed: collapsed }),
    }),
    {
      name: 'ui-storage',
      storage: createJSONStorage(() => localStorage),
      // Only persist specific fields - exclude toasts and UI state that shouldn't persist
      // CRITICAL: Don't persist directorMode and selectedWhitelabelId - they're always read from localStorage
      partialize: (state) => ({
        tenant: state.tenant,
        panelCollapsed: state.panelCollapsed,
        // directorMode and selectedWhitelabelId are NOT persisted - always read from localStorage
      }),
      // On rehydrate, load directorMode and selectedWhitelabelId from database (only if authenticated)
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          return
        }
        
        if (state && typeof window !== 'undefined') {
          // CRITICAL: Check authentication before loading from database
          const authState = useAuthStore.getState()
          const isAuthenticated = !!authState.token
          const roles = authState.roles || []
          const isSuperAdmin = roles.some(r => 
            r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
            (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
          )
          
          // Only load from database if authenticated and is Super Admin
          if (isAuthenticated && isSuperAdmin) {
            loadDirectorPreferences().then(prefs => {
              const currentState = useUIStore.getState()
              let needsUpdate = false
              const updates: Partial<UIState> = {}
              
              if (currentState.directorMode !== prefs.directorMode) {
                updates.directorMode = prefs.directorMode
                needsUpdate = true
              }
              
              if (currentState.selectedWhitelabelId !== prefs.selectedWhitelabelId) {
                updates.selectedWhitelabelId = prefs.selectedWhitelabelId
                needsUpdate = true
              }
              
              if (needsUpdate) {
                useUIStore.setState(updates)
              }
            }).catch(e => {
              // Silently fail if unauthorized (expected for non-super-admin users)
              if (!e?.message?.includes('Unauthorized') && !e?.message?.includes('Only Super Admin')) {
                // Unexpected error shape; nothing actionable beyond skipping the fallback
              }
              // CRITICAL: Don't fallback to localStorage for Super Admin - database is source of truth
              // If database fails, keep current state (don't override with potentially stale localStorage)
            })
          } else {
            // Not authenticated or not Super Admin - don't load preferences
            // Super Admin preferences should only come from database
          }
        }
      },
    }
  )
)

// CRITICAL: Load preferences from database on store initialization
// Only load if user is authenticated (check on each attempt)
if (typeof window !== 'undefined') {
  // Load preferences from database after a short delay to ensure Apollo Client is ready
  // Also check authentication before loading
  const loadPrefsIfAuthenticated = () => {
    const authState = useAuthStore.getState()
    const isAuthenticated = !!authState.token
    const roles = authState.roles || []
    const isSuperAdmin = roles.some(r => 
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    
    // Only load if authenticated and is Super Admin
    if (isAuthenticated && isSuperAdmin) {
      loadDirectorPreferences().then(prefs => {
        const currentState = useUIStore.getState()
        const updates: Partial<UIState> = {}
        
        if (currentState.directorMode !== prefs.directorMode) {
          updates.directorMode = prefs.directorMode
        }
        if (currentState.selectedWhitelabelId !== prefs.selectedWhitelabelId) {
          updates.selectedWhitelabelId = prefs.selectedWhitelabelId
        }
        
        if (Object.keys(updates).length > 0) {
          useUIStore.setState(updates)
        }
      }).catch(e => {
        // Silently fail - will use localStorage fallback
        if (!e?.message?.includes('Unauthorized') && !e?.message?.includes('Only Super Admin')) {
          // Unexpected error shape; nothing actionable beyond skipping the fallback
        }
      })
    }
  }
  
  // Try immediately (in case user is already logged in)
  setTimeout(loadPrefsIfAuthenticated, 500)
  
  // Also subscribe to auth changes to load preferences when user logs in
  useAuthStore.subscribe(
    (state, prevState) => {
      const token = state.token
      const prevToken = prevState?.token
      if (token && !prevToken) {
        // User just logged in, try loading preferences
        setTimeout(loadPrefsIfAuthenticated, 100)
      }
    }
  )
}

// CRITICAL: Super Admin preferences are stored in database, NOT localStorage
// We don't sync to/from localStorage for Super Admin preferences
// Only use localStorage as a fallback if database fails (for error cases only)

