import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'

/**
 * Sign-out for the profile menu, moved verbatim from components/Topbar.tsx:121-131: tell the server
 * (errors ignored), clear local auth state, go to /login. The mutation modules are still loaded with
 * dynamic import(), as before.
 */
export function useLogout(): () => Promise<void> {
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      const { apolloClient } = await import('@/shared/core/api')
      const { LOGOUT_MUTATION } = await import('@/shared/security/auth')
      await apolloClient.mutate({ mutation: LOGOUT_MUTATION })
    } catch {
      // Ignore errors (e.g. network); still clear local state
    }
    logout()
    navigate('/login')
  }

  return handleLogout
}
