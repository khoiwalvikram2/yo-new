import { useEffect, useRef } from 'react'
import { useApolloClient, useQuery } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { useWhitelabels } from '@/shared/core/useWhitelabels'
import type { WhitelabelWithCurrency } from '@/shared/core/useWhitelabels'
import { MY_ADMIN_PREFERENCES } from '@/lib/graphql/adminPreferences'

export type DirectorMode = 'core' | 'whitelabel'

export interface SuperAdminModeState {
  /** isSuperAdmin && isAuthenticated (SuperAdminModeSwitcher.tsx:108-110) */
  visible: boolean
  mode: DirectorMode
  selectedWhitelabelId: string | null
  whitelabels: WhitelabelWithCurrency[]
  whitelabelsLoading: boolean
  /** handleModeChange (SuperAdminModeSwitcher.tsx:112-139) */
  setMode: (mode: DirectorMode) => void
  /** handleWhitelabelChange (SuperAdminModeSwitcher.tsx:141-165) */
  selectWhitelabel: (id: string) => void
}

/**
 * Data logic of components/topbar/SuperAdminModeSwitcher.tsx:12-105 and :112-165, in the same order and
 * unchanged, except that the empty useEffect on directorMode (:21-22) is dropped. Every hook runs
 * unconditionally; the old early return is now `visible`. Mount the container only for Super Admin
 * (Topbar.tsx:216): useWhitelabels() and the reset-to-core effect run whenever this hook runs.
 */
export function useSuperAdminMode(): SuperAdminModeState {
  const roles = useAuthStore(s => s.roles) || []
  const navigate = useNavigate()
  // Subscribe to state changes so the switcher re-renders when the store updates
  const directorMode = useUIStore(s => s.directorMode)
  const selectedWhitelabelId = useUIStore(s => s.selectedWhitelabelId)
  const setDirectorMode = useUIStore(s => s.setDirectorMode)
  const setSelectedWhitelabelId = useUIStore(s => s.setSelectedWhitelabelId)

  const { whitelabels, loading: whitelabelsLoading } = useWhitelabels()
  const apolloClient = useApolloClient()
  const hasInitialized = useRef(false) // Track if we've done initial sync
  const mutationInProgress = useRef(false) // Track if a mutation is in progress (written, never read; kept as today)

  // Check authentication and Super Admin role first
  const token = useAuthStore(s => s.token)
  const isAuthenticated = !!token

  // Only for Super Admin role; check several spellings of the role name
  const isSuperAdmin = roles.some(r => {
    const roleLower = r?.toLowerCase() || ''
    return (
      r === 'Super Admin' ||
      roleLower === 'super_admin' ||
      (roleLower.includes('super') && roleLower.includes('admin'))
    )
  })

  // Skip the query if not authenticated or not Super Admin, so agents and whitelabel admins never run it
  const shouldSkipQuery = !isSuperAdmin || !isAuthenticated

  // Load preferences from the database; only the initial sync may override the store
  const { data: preferencesData, refetch: refetchPreferences, loading: preferencesLoading } = useQuery(MY_ADMIN_PREFERENCES, {
    skip: shouldSkipQuery, // Skip if not Super Admin or not authenticated
    fetchPolicy: 'network-only', // Always fetch fresh data from network (no cache)
    errorPolicy: 'all', // Don't throw errors, just return partial data
    // Only sync on initial load, not on every query update, so the user's manual changes are not overridden
    notifyOnNetworkStatusChange: false,
  })

  // Sync preferences from the database on initial mount or when data changes
  useEffect(() => {
    if (preferencesLoading) return
    if (preferencesData?.myAdminPreferences) {
      const prefs = preferencesData.myAdminPreferences
      if (prefs.directorMode && (prefs.directorMode === 'core' || prefs.directorMode === 'whitelabel')) {
        const currentState = useUIStore.getState()
        const dbMode = prefs.directorMode as 'core' | 'whitelabel'
        const dbWhitelabelId = (prefs.selectedWhitelabelId && prefs.selectedWhitelabelId.trim() !== '')
          ? prefs.selectedWhitelabelId.trim()
          : null
        const currentMode = currentState.directorMode
        const currentWhitelabelId = currentState.selectedWhitelabelId
        const normalizedCurrentWhitelabelId = (currentWhitelabelId && currentWhitelabelId.trim() !== '')
          ? currentWhitelabelId.trim()
          : null
        const needsSync = !hasInitialized.current ||
          (dbMode !== currentMode) ||
          (dbWhitelabelId !== normalizedCurrentWhitelabelId)
        if (needsSync) {
          hasInitialized.current = true
          useUIStore.setState({ directorMode: dbMode, selectedWhitelabelId: dbWhitelabelId })
        }
      }
      // else: prefs not in expected shape, no-op
    }
    // else: no preferences data yet, no-op
  }, [preferencesData?.myAdminPreferences, preferencesLoading])

  // Edge case: if the selected whitelabel is deleted, reset to core
  useEffect(() => {
    if (!hasInitialized.current || whitelabelsLoading) return
    if (directorMode === 'whitelabel') {
      if (whitelabels.length === 0) {
        setDirectorMode('core')
        apolloClient.resetStore().catch(() => {})
      } else if (selectedWhitelabelId) {
        const whitelabelExists = whitelabels.some(wl => wl.id === selectedWhitelabelId)
        if (!whitelabelExists) {
          setDirectorMode('core')
          apolloClient.resetStore().catch(() => {})
        }
      } else if (whitelabels.length > 0) {
        setSelectedWhitelabelId(whitelabels[0].id)
      }
    }
  }, [whitelabels, whitelabelsLoading, selectedWhitelabelId, directorMode, setDirectorMode, setSelectedWhitelabelId, apolloClient])

  const handleModeChange = (mode: 'core' | 'whitelabel') => {
    // Mark mutation as in progress to prevent the query from overriding
    mutationInProgress.current = true

    setDirectorMode(mode)
    if (mode === 'core') {
      setSelectedWhitelabelId(null)
    } else if (mode === 'whitelabel' && whitelabels.length > 0 && !selectedWhitelabelId) {
      // Auto-select first whitelabel if none selected
      setSelectedWhitelabelId(whitelabels[0].id)
    }

    // Clear the Apollo cache when the mode changes so queries refetch with the new tenant context
    apolloClient.resetStore().catch(() => {})

    // Redirect to the dashboard when switching modes, so the user sees fresh data in the new context
    navigate('/')

    // Don't refetch preferences immediately: wait for the store's mutation to update the database
    setTimeout(() => {
      mutationInProgress.current = false
      refetchPreferences().catch(() => {})
    }, 2000) // Wait 2 seconds for mutation to complete and database to update
  }

  const handleWhitelabelChange = (whitelabelId: string) => {
    // SECURITY: Validate whitelabel exists in list
    const whitelabelExists = whitelabels.some(wl => wl.id === whitelabelId)
    if (!whitelabelExists) {
      return
    }

    // Mark mutation as in progress to prevent the query from overriding
    mutationInProgress.current = true

    setSelectedWhitelabelId(whitelabelId)

    // Clear the Apollo cache when the whitelabel changes so queries refetch with the new tenant context
    apolloClient.resetStore().catch(() => {})

    // Refetch after a short delay so stale query data does not override the store
    setTimeout(() => {
      mutationInProgress.current = false
      refetchPreferences().catch(() => {})
    }, 2000) // Wait 2 seconds for mutation to complete and database to update
  }

  return {
    visible: isSuperAdmin && isAuthenticated,
    mode: directorMode,
    selectedWhitelabelId,
    whitelabels,
    whitelabelsLoading,
    setMode: handleModeChange,
    selectWhitelabel: handleWhitelabelChange,
  }
}
