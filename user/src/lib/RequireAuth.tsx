import { useEffect, useRef } from 'react'
import { useAuth } from '@/lib/auth'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, openAuthModal, isHydrating } = useAuth()
  const openedRef = useRef(false)

  useEffect(() => {
    // Avoid showing login while auth state is hydrating
    if (isHydrating) return
    if (!isAuthenticated && !openedRef.current) {
      openedRef.current = true
      openAuthModal('login')
    }
  }, [isAuthenticated, isHydrating, openAuthModal])

  if (!isAuthenticated) {
    return null
  }
  return <>{children}</>
}


