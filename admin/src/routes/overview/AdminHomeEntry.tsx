import { Suspense, lazy } from 'react'
import { Navigate } from 'react-router-dom'
import { LoadingState } from '@/ui/components/LoadingState'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { getAdminDefaultHomePath } from '@/shared/core/adminDefaultHome'
import { ROUTES } from '@/shared/core/constants'

const OverviewPage = lazy(() => import('./OverviewPage'))

/* The dashboard's own Suspense fallback, shown while its chunk loads. It was an antd Spin in a
   Tailwind box; it is the kit's LoadingState now, which is what put this file on the exception list
   (page migration C, W0). `fill` lets it take the content column rather than reserving a viewport
   fraction, so nothing shifts when the dashboard lands. */
const loading = <LoadingState fill label="Loading dashboard" />

/**
 * Renders the analytics dashboard when allowed; otherwise redirects to the first screen
 * the user can access (e.g. withdrawal requests for WDRL-only support admins).
 */
export default function AdminHomeEntry() {
  const permissions = useAuthStore((s) => s.permissions)
  const hasDashboard = hasPermissionWithNested(permissions ?? [], 'overview.dashboard', 'view')

  if (hasDashboard) {
    return (
      <Suspense fallback={loading}>
        <OverviewPage />
      </Suspense>
    )
  }

  const fallback = getAdminDefaultHomePath(permissions)
  if (fallback === ROUTES.OVERVIEW) {
    return (
      <Suspense fallback={loading}>
        <OverviewPage />
      </Suspense>
    )
  }

  return <Navigate to={fallback} replace />
}
