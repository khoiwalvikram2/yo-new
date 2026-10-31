import { LiveWorkspaceStats, type LiveStatsProps } from '@/routes/live-analysis/LiveWorkspaceStats'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

export function HeaderStatsSection(props: LiveStatsProps) {
  const permissions = useAuthStore((state) => state.permissions)
  const canViewFinance = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  return <LiveWorkspaceStats {...props} feature="matka" canViewFinance={canViewFinance} />
}

