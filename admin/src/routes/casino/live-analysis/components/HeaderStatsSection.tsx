import { LiveWorkspaceStats, type LiveStatsProps } from '@/routes/live-analysis/LiveWorkspaceStats'

interface HeaderStatsSectionProps extends LiveStatsProps {
  windowMins: number
}

export function HeaderStatsSection(props: HeaderStatsSectionProps) {
  return <LiveWorkspaceStats {...props} feature="casino" />
}

