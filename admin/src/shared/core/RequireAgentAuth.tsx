import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from './authStore'

const HYDRATION_TIMEOUT_MS = 5_000

const LoadingSpinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
      <p className="mt-2 text-gray-600">Loading...</p>
    </div>
  </div>
)

export function RequireAgentAuth({ children }: { children?: React.ReactNode }) {
  const _hasHydrated = useAuthStore(s => s._hasHydrated)
  const location = useLocation()
  const [forceHydrated, setForceHydrated] = useState(false)

  const token = useAuthStore(s => s.token)
  const agent = useAuthStore(s => s.agent)
  useAuthStore(s => s.isAgent())

  // Safety valve: if hydration doesn't complete within timeout, force-proceed
  useEffect(() => {
    if (_hasHydrated) return
    const timer = setTimeout(() => {
      console.warn('[RequireAgentAuth] Hydration timed out — force-proceeding')
      useAuthStore.getState().setHasHydrated(true)
      setForceHydrated(true)
    }, HYDRATION_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [_hasHydrated])

  // If we have token and agent, allow access immediately (even before hydration)
  if (token && agent) {
    if (agent.status === 'SUSPENDED' || agent.status === 'BLOCKED') {
      useAuthStore.getState().logout()
      return (
        <Navigate
          to="/login"
          replace
          state={{
            from: location,
            error: agent.status === 'SUSPENDED' ? 'Agent account is suspended.' : 'Agent account is blocked.',
          }}
        />
      )
    }
    return children ? <>{children}</> : <Outlet />
  }

  const hydrated = _hasHydrated || forceHydrated

  // Still hydrating — show spinner
  if (!hydrated) {
    return <LoadingSpinner />
  }

  // Hydrated but no auth — redirect to login
  if (!token || !agent) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children ? <>{children}</> : <Outlet />
}

