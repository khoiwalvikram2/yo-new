import { LiveWorkspaceNavigation, type LiveNavigationProps } from '@/routes/live-analysis/LiveWorkspaceNavigation'

export function NavigationSidebar(props: LiveNavigationProps) {
  return <LiveWorkspaceNavigation {...props} feature="sports" />
}

