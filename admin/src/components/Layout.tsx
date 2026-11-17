import { Outlet, useLocation } from 'react-router-dom'
import { useNotificationSubscription } from './topbar/useNotificationSubscription'
import { useAuthStore } from '@/shared/core/authStore'
import { ErrorBoundary } from '@/shared/core/ErrorBoundary'
import { VersionRefreshBanner } from '@/shared/components/VersionRefreshBanner'
import { AiAssistantLauncher } from '../modules/aiAssistant/AiAssistantLauncher'
import { AppShell } from '@/shell/AppShell'
import { Notice } from '@/ui/components/Notice'
import styles from './Layout.module.css'

/* Which pages an agent may open is the router's to decide: every admin-only route is wrapped in AdminOnly
   (app/router/index.tsx), which sends an agent to /agent. This layout used to repeat that for a list of path
   prefixes and send the agent to /login instead. Its effect ran after AdminOnly's, still holding the old
   path, so a signed-in agent landed on the sign-in form (with its session intact) for some pages and on
   /agent for others; two of its prefixes could never match. */
export function Layout() {
  useNotificationSubscription()
  const location = useLocation()
  const isAgent = useAuthStore((s) => s.isAgent())
  const isReadOnly = useAuthStore((s) => s.isAgentReadOnly())

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
