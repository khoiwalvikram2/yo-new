import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from './authStore'

interface AgentDomainGuardProps {
  /** The domain required to access this route */
  domain: 'sports' | 'casino' | 'matka'
  /** The content to render if access is allowed */
  children: ReactNode
  /** Optional redirect path if access is denied (defaults to /reporting/pnl) */
  redirectTo?: string
}

/**
 * Guard component that checks if an agent has access to a specific domain.
 * For admin users, access is always granted.
 * For agents, access is only granted if the domain is in their allowedDomains.
 */
export function AgentDomainGuard({ domain, children, redirectTo = '/reporting/pnl' }: AgentDomainGuardProps) {
  const agent = useAuthStore(s => s.agent)
  const isAgent = useAuthStore(s => s.isAgent())

  // Admin users have access to all domains
  if (!isAgent) {
    return <>{children}</>
  }

  // Check if agent has access to this domain
  const allowedDomains = agent?.allowedDomains || []
  const hasAccess = allowedDomains.includes(domain)

  if (!hasAccess) {
    // Redirect to a safe page
    return <Navigate to={redirectTo} replace />
  }

  return <>{children}</>
}
