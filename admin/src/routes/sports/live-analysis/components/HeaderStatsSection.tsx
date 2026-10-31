import { LiveWorkspaceStats, type LiveStatsProps } from '@/routes/live-analysis/LiveWorkspaceStats'

export function HeaderStatsSection(props: LiveStatsProps) {
  return <LiveWorkspaceStats {...props} feature="sports" />
}

