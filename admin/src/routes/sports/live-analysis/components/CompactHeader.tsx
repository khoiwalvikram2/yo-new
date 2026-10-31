import { LiveWorkspaceTitle } from '@/routes/live-analysis/LiveWorkspaceNavigation'

interface CompactHeaderProps {
  activeTab: string
}

export function CompactHeader(props: CompactHeaderProps) {
  return <LiveWorkspaceTitle {...props} feature="sports" />
}

