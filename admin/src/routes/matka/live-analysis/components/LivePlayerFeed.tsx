import type { MatkaPlayerEvent } from '../liveUiModel'
import { appendMatkaEvent } from '../liveUiModel'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import styles from '../MatkaLiveUi.module.css'
interface Props { latestEvent: MatkaPlayerEvent | undefined; onBetsCountChange?: (n: number) => void }
/** Kit feed rows (Event detail .ev-bet): the player and time; the matka, market and bid; bet, potential win
 *  and the status. The bet and potential win only with settlements.center view, masked as the Bet List tab masks
 *  the same amounts (owner, 2026-11-04). */
export function LivePlayerFeed({ latestEvent, onBetsCountChange }: Props) {
  const { formatTime } = useFormatDate()
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const amount = (value: number | null | undefined) => (hasFinanceView ? value : '••••')
  const [events, setEvents] = useState<MatkaPlayerEvent[]>([])
  useEffect(() => { if (latestEvent) setEvents(prev => appendMatkaEvent(prev, latestEvent)) }, [latestEvent])
  useEffect(() => { onBetsCountChange?.(events.length) }, [events.length, onBetsCountChange])
  if (!events.length) return <div className={styles.actEmpty}><EmptyState title="No live bets yet" /></div>
  return <ul className={styles.actList}>{events.map((event, index) => <li key={`${event.id || event.at || event.userId}-${index}`} className={styles.actItem}>
    <div className={styles.actTop}><strong className={styles.actPlayer}>{event.userName || `User ${event.userId}`}</strong>{event.at ? <time className={styles.actTime} dateTime={event.at}>{formatTime(event.at, 'h:mm:ss a')}</time> : <span className={styles.actTime}>—</span>}</div>
    <p className={styles.actWhat}>{event.matkaType?.toUpperCase()} · {event.marketName} · {event.bidType}</p>
    <div className={styles.actNums}><span>Bet <b>{amount(event.betAmount)}</b></span>{event.potentialWin != null && <span>Potential <b>{amount(event.potentialWin)}</b></span>}<StatusPill className={styles.actStatus} status={event.status}>{String(event.status || '').toUpperCase()}</StatusPill></div>
  </li>)}</ul>
}
