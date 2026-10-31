import type { MatkaPlayerEvent } from '../liveUiModel'
import clsx from 'clsx'
import { IconLayoutSidebarRightCollapse } from '@tabler/icons-react'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { LivePlayerFeed } from './LivePlayerFeed'
import styles from '../MatkaLiveUi.module.css'
interface Props { isLiveActivityCollapsed: boolean; setIsLiveActivityCollapsed: (value: boolean) => void; playerEvent: MatkaPlayerEvent | undefined }
/** The kit side rail (Event detail Bets): "Live Activity" and Live on the bar with a fold icon, then the feed
 *  rows edge to edge. */
export function LiveActivitySection({ isLiveActivityCollapsed, setIsLiveActivityCollapsed, playerEvent }: Props) {
  return <aside className={clsx(styles.activity, isLiveActivityCollapsed && styles.activityCollapsed)} aria-label="Live Activity">
    <Card title={isLiveActivityCollapsed ? undefined : 'Live Activity'} sub={isLiveActivityCollapsed ? undefined : 'Real-time feed'} live={!isLiveActivityCollapsed}
      body={isLiveActivityCollapsed ? 'padded' : 'flush'}
      tools={!isLiveActivityCollapsed && <IconButton className={styles.headIcon} size="sm" label="Collapse Live Activity" icon={<IconLayoutSidebarRightCollapse size={16} stroke={strokeFor(16)} />} onClick={() => setIsLiveActivityCollapsed(true)} />}>
      {isLiveActivityCollapsed && <Button size="sm" block onClick={() => setIsLiveActivityCollapsed(false)} aria-label="Expand Live Activity">Live</Button>}
      <div hidden={isLiveActivityCollapsed}><LivePlayerFeed latestEvent={playerEvent} /></div>
    </Card>
  </aside>
}
