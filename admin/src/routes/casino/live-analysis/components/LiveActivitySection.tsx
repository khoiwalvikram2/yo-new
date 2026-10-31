import clsx from 'clsx'
import { useState } from 'react'
import { IconLayoutSidebarRightCollapse } from '@tabler/icons-react'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { LivePlayerFeed } from '../../components/LivePlayerFeed'
import type { CasinoPlayerEvent } from '../casinoLiveModel'
import styles from '../CasinoLive.module.css'
interface LiveActivitySectionProps { isLiveActivityCollapsed: boolean; setIsLiveActivityCollapsed: (value: boolean) => void; playerEvent?: CasinoPlayerEvent; windowMins: number }
/** The kit side rail (Event detail Bets): "Live Activity", the count and Live on the bar, a fold icon, then
 *  the feed's tools and its rows edge to edge. */
export function LiveActivitySection({ isLiveActivityCollapsed, setIsLiveActivityCollapsed, playerEvent, windowMins }: LiveActivitySectionProps) {
  const [betsCount, setBetsCount] = useState(0)
  return <aside className={clsx(styles.activity, isLiveActivityCollapsed && styles.activityCollapsed)} aria-label="Live Activity">
    <Card title={isLiveActivityCollapsed ? undefined : 'Live Activity'} sub={isLiveActivityCollapsed ? undefined : betsCount > 0 ? `${betsCount.toLocaleString()} activities` : 'Real-time feed'}
      live={!isLiveActivityCollapsed} body={isLiveActivityCollapsed ? 'padded' : 'flush'}
      tools={!isLiveActivityCollapsed && <IconButton className={styles.headIcon} size="sm" label="Collapse Live Activity" icon={<IconLayoutSidebarRightCollapse size={16} stroke={strokeFor(16)} />} onClick={() => setIsLiveActivityCollapsed(true)} />}>
      {isLiveActivityCollapsed && <Button size="sm" block onClick={() => setIsLiveActivityCollapsed(false)} aria-label="Expand Live Activity">Live {betsCount > 0 ? betsCount > 99 ? '99+' : betsCount : ''}</Button>}
      <div hidden={isLiveActivityCollapsed}><LivePlayerFeed latestEvent={playerEvent} windowMins={windowMins} onBetsCountChange={setBetsCount} /></div>
    </Card>
  </aside>
}
