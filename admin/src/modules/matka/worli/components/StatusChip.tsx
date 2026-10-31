import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { StatusPill } from '@/ui/components/StatusPill'
import { sessionStatusTone, statusCountdown } from '../runningMarketDetailModel'
import styles from '../RunningMarketDetailPage.module.css'

/* The session's status with a live countdown: to the lock while OPEN, to the close while LOCKED or
   OPENING_SOON, ticking every second and urgent under ten minutes, as before. The props are unchanged (the
   unreachable MarketsTable.tsx still compiles against them). */
export function StatusChip({ status, lockAt, closeAt }: { status: string; lockAt?: string | null; closeAt?: string | null }) {
  const [now, setNow] = useState<number>(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const countdown = statusCountdown(status, lockAt, closeAt, now)
  return (
    <span className={styles.statusChip}>
      <StatusPill tone={sessionStatusTone(status)}>{status}</StatusPill>
      {countdown ? (
        <span className={clsx(styles.countdown, countdown.urgent && styles.countdownUrgent)}>
          {countdown.text}
        </span>
      ) : null}
    </span>
  )
}

