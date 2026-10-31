import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useNotificationSubscription } from './topbar/useNotificationSubscription'
import { useAuthStore } from '@/shared/core/authStore'
import { ErrorBoundary } from '@/shared/core/ErrorBoundary'
import { VersionRefreshBanner } from '@/shared/components/VersionRefreshBanner'
import { AiAssistantLauncher } from '../modules/aiAssistant/AiAssistantLauncher'
import { AppShell } from '@/shell/AppShell'
import { Notice } from '@/ui/components/Notice'
import styles from './Layout.module.css'

/** Admin-only path prefixes; agents must never see these (defense-in-depth). */
const ADMIN_ONLY_PATH_PREFIXES = [
  '/sports-exchange/',
  '/sports/manual-results',
  '/casino/management',
  '/casino/vendors',
  '/casino/providers',
  '/casino/categories',
  '/matka/list',
  '/matka/management',
  '/matka/create',
  '/matka/edit/',
  '/matka/settings',
  '/matka/worli',
]

export function Layout() {
  useNotificationSubscription()
  const location = useLocation()
  const navigate = useNavigate()
  const isAgent = useAuthStore((s) => s.isAgent())
  const isReadOnly = useAuthStore((s) => s.isAgentReadOnly())

  // Defense-in-depth: if agent landed on an admin-only path, redirect to login
  useEffect(() => {
    if (!isAgent) return
    const path = location.pathname
    const isAdminOnly = ADMIN_ONLY_PATH_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix + '/')
    )
    if (isAdminOnly) {
      navigate('/login', { replace: true })
    }
  }, [isAgent, location.pathname, navigate])

  return (
    <AppShell
      banner={
        <>
          <VersionRefreshBanner />
          {isAgent && isReadOnly && (
            <Notice tone="warn" layout="strip" className={styles.readOnlyBanner}>
              Your account is inactive. View-only access — you cannot perform actions.
            </Notice>
          )}
        </>
      }
      overlay={<AiAssistantLauncher />}
    >
      <ErrorBoundary key={location.pathname}>
        <Outlet key={location.pathname} />
      </ErrorBoundary>
    </AppShell>
  )
}
