import { LiveWorkspaceTitle } from '@/routes/live-analysis/LiveWorkspaceNavigation'

interface CompactHeaderProps {
  activeTab: string
  windowMins: number
}

export function CompactHeader(props: CompactHeaderProps) {
  return <LiveWorkspaceTitle {...props} feature="casino" />
}

