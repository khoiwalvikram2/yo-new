import { LiveWorkspaceHeader, type LiveHeaderProps } from '@/routes/live-analysis/LiveWorkspace'

export function HeaderControls(props: LiveHeaderProps) {
  return <LiveWorkspaceHeader {...props} feature="matka" />
}

