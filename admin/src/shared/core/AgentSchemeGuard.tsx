import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from './authStore'

interface AgentSchemeGuardProps {
  /** The scheme type required to access this route */
  schemeType: 'COMMISSION' | 'SHARING' | 'CREDIT'
  /** The content to render if access is allowed */
  children: ReactNode
  /** Optional redirect path if access is denied (defaults to /reporting/pnl) */
  redirectTo?: string
}

/**
 * Guard component that checks if an agent has a specific scheme type.
 * For admin users, access is always granted.
 * For agents, access is only granted if their schemeType matches.
 */
export function AgentSchemeGuard({ schemeType, children, redirectTo = '/reporting/pnl' }: AgentSchemeGuardProps) {
  const agent = useAuthStore(s => s.agent)
  const isAgent = useAuthStore(s => s.isAgent())

  // Admin users have access to all reports
  if (!isAgent) {
    return <>{children}</>
  }

  // Check if agent has the required scheme type
  const agentScheme = agent?.schemeType?.toUpperCase()
  const hasAccess = agentScheme === schemeType

  if (!hasAccess) {
    // Redirect to a safe page
    return <Navigate to={redirectTo} replace />
  }

  return <>{children}</>
}
