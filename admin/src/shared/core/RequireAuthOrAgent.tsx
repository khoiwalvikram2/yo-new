import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from './authStore'

const HYDRATION_TIMEOUT_MS = 2_000

/**
 * Auth guard that allows both admins and agents
 * Used for routes that should be accessible to both user types
 */
export function RequireAuthOrAgent({ children }: { children?: React.ReactNode }) {
  const _hasHydrated = useAuthStore(s => s._hasHydrated)
  const location = useLocation()
  const [forceHydrated, setForceHydrated] = useState(false)

  // Safety valve: if hydration doesn't complete within timeout, force-proceed
  useEffect(() => {
    if (_hasHydrated) return
    const timer = setTimeout(() => {
      console.warn('[RequireAuthOrAgent] Hydration timed out — force-proceeding')
      useAuthStore.getState().setHasHydrated(true)
      setForceHydrated(true)
    }, HYDRATION_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [_hasHydrated])

  const hydrated = _hasHydrated || forceHydrated

  // Read auth before the hydration branch — see RequireAuth for why an early
  // return above these selectors changes hook count between renders.
  const token = useAuthStore(s => s.token)
  const user = useAuthStore(s => s.user)
  const agent = useAuthStore(s => s.agent)

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F7F8F5' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!token || (!user && !agent)) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children ? <>{children}</> : <Outlet />
}

